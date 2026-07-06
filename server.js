const express = require('express');
const app = express();
app.use(express.json());

// พอร์ตสำหรับให้ Render ตรวจสอบสถานะการทำงาน (Web Service Health Check)
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('🎲 บอทคำนวณระบบไพ่ 3 ใบทำงานปกติบน Render!'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// ----------------------------------------------------
// 💾 ฐานข้อมูลจำลอง (ในระบบจริงควรเชื่อมต่อ MongoDB / SQL)
// ----------------------------------------------------
let usersWallet = {
    "user_01": { name: "ผู้เล่น A", credit: 1000 },
    "user_02": { name: "ผู้เล่น B", credit: 500 },
    "admin": { name: "แอดมินระบบ", credit: 999999 }
};

let currentRoundBets = []; // เก็บโพยเดิมพันในรอบปัจจุบัน
let isRoundOpen = false;   // สถานะเปิด-ปิดรับโพย

// 👑 ลำดับความใหญ่ของไพ่ (Rank)
const CARD_RANKS = ['$9', '$8', 't', 'sf', 's', 'h', '9', '8', '7', '6', '5', '4', '3', '2', '1', '0'];
const SPECIAL_MULTIPLIERS = { 't': 5, 'sf': 5, 's': 3, 'h': 3 };

// ----------------------------------------------------
// ⚙️ ฟังก์ชันตัวช่วยคำนวณไพ่ (Core Logic)
// ----------------------------------------------------
function getCleanResult(resultStr) {
    if (!resultStr) return { cleanVal: null, bounce: 1 };
    const cleanVal = resultStr.replace(/\*/g, '');
    const bounce = (resultStr.match(/\*/g) || []).length + 1;
    return { cleanVal, bounce };
}

function compareCards(playerCard, dealerCard) {
    const pResult = getCleanResult(playerCard);
    const dResult = getCleanResult(dealerCard);
    const pIdx = CARD_RANKS.indexOf(pResult.cleanVal);
    const dIdx = CARD_RANKS.indexOf(dResult.cleanVal);
    const finalPIdx = pIdx === -1 ? 99 : pIdx;
    const finalDIdx = dIdx === -1 ? 99 : dIdx;
    
    if (finalPIdx < finalDIdx) return 'win';
    if (finalPIdx > finalDIdx) return 'lose';
    return 'draw';
}

function calculateMultiplier(resultStr, isWinner) {
    const { cleanVal, bounce } = getCleanResult(resultStr);
    if (isWinner && SPECIAL_MULTIPLIERS[cleanVal]) return SPECIAL_MULTIPLIERS[cleanVal];
    return bounce;
}

// ----------------------------------------------------
// 📩 ฟังก์ชันประมวลผลการส่งโพย (พิมพ์แทง)ของผู้เล่น
// ----------------------------------------------------
function parseAndPlaceBet(userId, text) {
    if (!isRoundOpen) return "❌ ขออภัย ระบบยังไม่เปิดให้ส่งโพยในรอบนี้";
    if (!usersWallet[userId]) usersWallet[userId] = { name: `ผู้เล่น_${userId.substring(0,4)}`, credit: 0 };
    
    let user = usersWallet[userId];
    const cleanText = text.trim();
    
    // Pattern 1: มข-50 (แทงผู้เล่นทุกขา 1-6 ขาละ 50)
    if (/^มข-(\d+)$/i.test(cleanText)) {
        const betPerLeg = parseInt(cleanText.match(/^มข-(\d+)$/i)[1]);
        const totalBet = betPerLeg * 6;
        const requiredHold = totalBet * 3; // ค้ำประกัน 3 เท่า ของยอดรวมทั้งหมด
        
        if (user.credit < requiredHold) return `❌ เครดิตไม่พอค้ำประกัน! มข ต้องการเครดิตค้ำประกัน ${requiredHold} (ยอดแทงรวม 6 ขา = ${totalBet})`;
        
        user.credit -= requiredHold; // ล็อกทุนค้ำประกัน
        for (let leg = 1; leg <= 6; leg++) {
            currentRoundBets.push({ userId, type: 'เดี่ยว', leg, betAmount: betPerLeg, holdCredit: betPerLeg * 3 });
        }
        return `✅ รับโพย มัดขา (ขา 1-6) ขาละ ${betPerLeg} [ล็อกทุนค้ำประกัน ${requiredHold} สำเร็จ]`;
    }
    
    // Pattern 2: มจ-50 (แทงเจ้ามือสู้กับทุกขา 1-6 ขาละ 50)
    if (/^มจ-(\d+)$/i.test(cleanText)) {
        const betPerLeg = parseInt(cleanText.match(/^มจ-(\d+)$/i)[1]);
        const totalBet = betPerLeg * 6;
        const requiredHold = totalBet * 3;
        
        if (user.credit < requiredHold) return `❌ เครดิตไม่พอค้ำประกัน! มจ ต้องการเครดิตค้ำประกัน ${requiredHold}`;
        
        user.credit -= requiredHold;
        for (let leg = 1; leg <= 6; leg++) {
            currentRoundBets.push({ userId, type: 'จ', leg, betAmount: betPerLeg, holdCredit: betPerLeg * 3 });
        }
        return `✅ รับโพย มัดเจาะ (เจ้ามือสู้ทุกขา 1-6) ขาละ ${betPerLeg} [ล็อกทุนค้ำประกัน ${requiredHold} สำเร็จ]`;
    }

    // Pattern 3: เดี่ยว (เช่น 123-50) หรือ เจาะ (เช่น จ123-50)
    const singleMatch = cleanText.match(/^(จ)?([1-6]+)-(\d+)$/i);
    if (singleMatch) {
        const isDealerSide = !!singleMatch[1]; // มี 'จ' นำหน้าหรือไม่
        const legs = singleMatch[2].split('');  // แยกตัวเลขขา เช่น ['1', '2', '3']
        const betPerLeg = parseInt(singleMatch[3]);
        const totalBet = betPerLeg * legs.length;
        const requiredHold = totalBet * 3;
        
        if (user.credit < requiredHold) return `❌ เครดิตไม่พอค้ำประกัน! ต้องการ ${requiredHold} เครดิตคงเหลือของคุณคือ ${user.credit}`;
        
        user.credit -= requiredHold;
        legs.forEach(legStr => {
            currentRoundBets.push({
                userId,
                type: isDealerSide ? 'จ' : 'เดี่ยว',
                leg: parseInt(legStr),
                betAmount: betPerLeg,
                holdCredit: betPerLeg * 3
            });
        });
        
        return `✅ รับโพย [${isDealerSide ? 'แทงฝั่งเจ้ามือสู้ขา' : 'แทงฝั่งผู้เล่นขา'}: ${singleMatch[2]}] ขาละ ${betPerLeg} [ล็อกทุนค้ำประกัน ${requiredHold} สำเร็จ]`;
    }
    
    return null; // ถ้าไม่ตรงรูปแบบข้อความใดเลย ให้คืนค่า Null เพื่อให้ระบบปล่อยผ่าน
}

// ----------------------------------------------------
// 📊 ฟังก์ชันตรวจสอบและจัดหน้าตา UI การออกผล (แอดมินส่งคำสั่ง)
// ----------------------------------------------------
let lastProcessedCalculations = null; // เก็บผลการคำนวณรอยืนยัน OK

function previewRoundResults(line1, line2) {
    if (!line1.startsWith('/') || !line2.startsWith('//')) return "❌ รูปแบบคำสั่งผิดพลาด! แถวแรกต้องเริ่มด้วย / แถวสองด้วย //";
    
    const cardsSet1 = line1.substring(1).split(',');
    const cardsSet2 = line2.substring(2).split(',');
    const numPlayers = cardsSet1.length - 1;
    const dealerSet1 = cardsSet1[cardsSet1.length - 1];
    const dealerSet2 = cardsSet2[cardsSet2.length - 1];
    
    let summarySet1 = [];
    let summarySet2 = [];
    let lockedLegs = new Set();
    
    // ประมวลชุดที่ 1
    for (let i = 0; i < numPlayers; i++) {
        const leg = i + 1;
        const playerCard = cardsSet1[i];
        const { cleanVal } = getCleanResult(playerCard);
        const outcome = compareCards(playerCard, dealerSet1);
        
        let mul = 0, text = "";
        if (outcome === 'win') { mul = calculateMultiplier(playerCard, true); text = mul > 1 ? `ชนะเจ้า (${mul} เด้ง)` : "ชนะเจ้า"; }
        else if (outcome === 'lose') { mul = calculateMultiplier(dealerSet1, true); text = mul > 1 ? `แพ้เจ้า (เสีย ${mul} เด้ง)` : "แพ้เจ้า"; }
        else { mul = 0; text = "เสมอเจ้า (ป๊อกชน)"; }
        
        summarySet1.push({ leg, card: playerCard, outcome, multiplier: mul, text });
        if (cleanVal.includes('$') || getCleanResult(dealerSet1).cleanVal.includes('$')) lockedLegs.add(leg);
    }

    // ประมวลชุดที่ 2
    for (let i = 0; i < numPlayers; i++) {
        const leg = i + 1;
        const playerCard = cardsSet2[i];
        if (lockedLegs.has(leg)) { summarySet2.push({ leg, text: "🔒 (ปิดบิลไปแล้วในชุดที่ 1)" }); continue; }
        
        const outcome = compareCards(playerCard, dealerSet2);
        let mul = 0, text = "";
        if (outcome === 'win') {
            mul = calculateMultiplier(playerCard, true);
            text = SPECIAL_MULTIPLIERS[playerCard.replace(/\*/g, '')] ? `ชนะเจ้า (${mul} เด้งอัตโนมัติ)` : `ชนะเจ้า (${mul} เด้ง)`;
        } else if (outcome === 'lose') {
            const rawMul = calculateMultiplier(dealerSet2, true);
            mul = Math.min(rawMul, 3); // 🛡️ แพ้เสียสูงสุดไม่เกิน 3 เท่าตามเงินค้ำประกัน
            text = rawMul > 3 ? `แพ้เจ้า (เสียสูงสุด ${mul} เด้งตามทุนค้ำ)` : `แพ้เจ้า (เสีย ${mul} เด้ง)`;
        } else { mul = 0; text = "เสมอเจ้า"; }
        
        summarySet2.push({ leg, card: playerCard, outcome, multiplier: mul, text });
    }

    // เซฟเก็บข้อมูลดิบไว้เพื่อรอแอดมินพิมพ์ OK
    lastProcessedCalculations = { summarySet1, summarySet2, lockedLegs };

    // คืนค่ารูปแบบ UI ข้อความไปให้บอทพิมพ์
    let output = "📊 **[สรุปผลไพ่รวมประจำรอบ]**\n\n🔸 **ชุดที่ 1 (ไม่จั่ว)**\n👑 เจ้ามือ: " + dealerSet1 + "\n";
    summarySet1.forEach(item => {
        let icon = item.outcome === 'win' ? "🎉" : item.outcome === 'lose' ? "❌" : "🤝";
        output += `  • ขา ${item.leg} — ${item.card} (${icon} ${item.text})${lockedLegs.has(item.leg) ? " **[จบบิลขานี้]**" : ""}\n`;
    });
    output += "\n------------------------\n\n🔹 **ชุดที่ 2 (จั่วเพิ่ม)**\n👑 เจ้ามือ: " + dealerSet2 + "\n";
    summarySet2.forEach(item => {
        if (item.card) { output += `  • ขา ${item.leg} — ${item.card} (🏆 ${item.text})\n`; }
        else { output += `  • ขา ${item.leg} — ${item.text}\n`; }
    });
    output += "\n⚠️ **แอดมินตรวจสอบความถูกต้อง**\nหากถูกต้องพิมพ์ **\"OK\"** เพื่อคิดยอดเงิน หรือผิดพลาดพิมพ์ **\"no\"**";
    return output;
}

// ----------------------------------------------------
// 💰 ฟังก์ชันจ่ายเงิน/หักบิลเมื่อแอดมินพิมพ์ OK
// ----------------------------------------------------
function confirmAndSettleBets() {
    if (!lastProcessedCalculations) return "❌ ไม่มีผลการคำนวณค้างอยู่";
    
    let report = "💰 **[สรุปผลการคิดเงินรายบุคคล]**\n";
    const { summarySet1, summarySet2, lockedLegs } = lastProcessedCalculations;
    
    // รวมผลแพ้ชนะของแต่ละขาเพื่อนำไปคำนวณบิล
    let legResults = {};
    summarySet1.forEach(item => {
        legResults[item.leg] = { set1: { outcome: item.outcome, mult: item.multiplier } };
    });
    summarySet2.forEach(item => {
        if (legResults[item.leg]) {
            legResults[item.leg].set2 = item.card ? { outcome: item.outcome, mult: item.multiplier } : null;
        }
    });

    // ค้นหาและคำนวณผลเงินให้คนที่มีโพยรอบนี้
    let userSettlements = {};
    currentRoundBets.forEach(bet => {
        if (!userSettlements[bet.userId]) userSettlements[bet.userId] = { totalChange: 0, holdReturned: 0 };
        
        let legRes = legResults[bet.leg];
        let finalOutcome = 'draw';
        let finalMultiplier = 0;
        
        // คัดแยกผลตามชุดที่ทำงานจริง
        if (lockedLegs.has(bet.leg)) {
            finalOutcome = legRes.set1.outcome;
            finalMultiplier = legRes.set1.mult;
        } else if (legRes.set2) {
            finalOutcome = legRes.set2.outcome;
            finalMultiplier = legRes.set2.mult;
        }

        // หากผู้เล่นเดิมพันฝั่งเจ้ามือ ('จ') ให้สลับผลการตัดสินแพ้ชนะ
        if (bet.type === 'จ') {
            if (finalOutcome === 'win') finalOutcome = 'lose';
            else if (finalOutcome === 'lose') finalOutcome = 'win';
        }

        // คืนเงินทุนค้ำประกันสะสมก่อน
        userSettlements[bet.userId].holdReturned += bet.holdCredit;
        
        // คำนวณกำไร / ขาดทุน
        if (finalOutcome === 'win') {
            userSettlements[bet.userId].totalChange += (bet.betAmount * finalMultiplier);
        } else if (finalOutcome === 'lose') {
            userSettlements[bet.userId].totalChange -= (bet.betAmount * finalMultiplier);
        }
    });

    // อัปเดตยอดจริงเข้ากระเป๋าเงินผู้เล่น
    Object.keys(userSettlements).forEach(uId => {
        let settlement = userSettlements[uId];
        let user = usersWallet[uId];
        // ยอดเงินสุดท้าย = เครดิตปัจจุบัน + คืนค่าค้ำประกัน + ผลกำไร/ขาดทุน
        user.credit += settlement.holdReturned + settlement.totalChange;
        
        report += `👤 ${user.name}: ${settlement.totalChange >= 0 ? '🟢 +' : '🔴 '}${settlement.totalChange} (คงเหลือ: ${user.credit} ฿)\n`;
    });

    // เคลียร์ค่าระบบเพื่อเริ่มรอบใหม่
    currentRoundBets = [];
    lastProcessedCalculations = null;
    isRoundOpen = false;
    
    return report + "\n🔒 ปิดยอดรอบนี้สำเร็จ เครดิตอัปเดตเรียบร้อย!";
}

// ----------------------------------------------------
// 🤖 ฟังก์ชันรับข้อความหลักจาก Webhook ของคุณ (Line / Discord บอท)
// ----------------------------------------------------
function onIncomingMessage(userId, text, isAdmin = false) {
    const txt = text.trim();
    
    // คำสั่งแอดมินเปิดระบบ
    if (isAdmin && txt.toUpperCase() === 'O') {
        isRoundOpen = true;
        currentRoundBets = [];
        return "🔓 [ระบบเปิดรับโพยไพ่ 3 ใบ] ส่งโพยแทงเข้ามาได้เลยครับ!";
    }
    
    // คำสั่งตรวจเช็กเงินเครดิต
    if (txt.toUpperCase() === 'C' || txt === '/บช') {
        const user = usersWallet[userId] || { name: "ผู้เล่นใหม่", credit: 0 };
        return `💳 กระเป๋าเงินของคุณ: ${user.credit} ฿`;
    }
    
    // ตรวจจับระบบการแทง (ผู้เล่นส่งโพย)
    const betResult = parseAndPlaceBet(userId, txt);
    if (betResult) return betResult;
    
    // คำสั่งแอดมินส่งผลไพ่ 2 บรรทัดพร้อมกัน
    if (isAdmin && txt.includes('\n')) {
        const lines = txt.split('\n');
        if (lines[0].startsWith('/') && lines[1].startsWith('//')) {
            return previewRoundResults(lines[0], lines[1]);
        }
    }
    
    // แอดมินกดยืนยันผล
    if (isAdmin && txt.toUpperCase() === 'OK') {
        return confirmAndSettleBets();
    }
    
    if (isAdmin && txt.toUpperCase() === 'NO') {
        lastProcessedCalculations = null;
        return "❌ ยกเลิกผลการออกไพ่เมื่อครู่ แอดมินกรุณาส่งผลใหม่อีกครั้ง";
    }

    return null; // ปล่อยผ่านข้อความทั่วไป
}
