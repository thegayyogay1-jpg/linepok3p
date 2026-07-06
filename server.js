// =================================================================
// 👑 [ส่วนที่ 1] ตั้งค่าลำดับและอัตราจ่ายไพ่ 3 ใบ (วางไว้ด้านบนของไฟล์)
// =================================================================
const CARD_RANKS = ['$9', '$8', 't', 'sf', 's', 'h', '9', '8', '7', '6', '5', '4', '3', '2', '1', '0'];
const SPECIAL_MULTIPLIERS = { 
    't': 5,   // ตอง 5 เด้งอัตโนมัติ
    'sf': 5,  // เรียงดอก 5 เด้งอัตโนมัติ
    's': 3,   // เรียง 3 เด้งอัตโนมัติ
    'h': 3    // เซียน 3 เด้งอัตโนมัติ
};

// ฟังก์ชันดึงแต้มและนับจำนวนดาว (*) ของไพ่แต้มปกติ
function getCleanResult(resultStr) {
    if (!resultStr) return { cleanVal: null, bounce: 1 };
    const cleanVal = resultStr.replace(/\*/g, '');
    const bounce = (resultStr.match(/\*/g) || []).length + 1; // ไม่มีดาว=1เด้ง, *=2เด้ง, **=3เด้ง
    return { cleanVal, bounce };
}

// ฟังก์ชันเปรียบเทียบความใหญ่ตามลำดับ RANK ($9 ใหญ่สุด)
function compareCards(playerCard, dealerCard) {
    const pResult = getCleanResult(playerCard);
    const dResult = getCleanResult(dealerCard);
    
    const pIdx = CARD_RANKS.indexOf(pResult.cleanVal);
    const dIdx = CARD_RANKS.indexOf(dResult.cleanVal);
    
    const finalPIdx = pIdx === -1 ? 99 : pIdx;
    const finalDIdx = dIdx === -1 ? 99 : dIdx;
    
    if (finalPIdx < finalDIdx) return 'win';   // ยิ่ง index น้อย ยิ่งใหญ่กว่า
    if (finalPIdx > finalDIdx) return 'lose';
    return 'draw';
}

// ฟังก์ชันหาจำนวนเด้งที่จะได้รับ
function calculateMultiplier(resultStr, isWinner) {
    const { cleanVal, bounce } = getCleanResult(resultStr);
    // ถ้าชนะและเป็นไพ่พิเศษ ดึงแต้มเด้งล็อกเฉพาะตัวออกมาทันทีโดยไม่ต้องพึ่งดาว *
    if (isWinner && SPECIAL_MULTIPLIERS[cleanVal]) {
        return SPECIAL_MULTIPLIERS[cleanVal];
    }
    return bounce;
}

// =================================================================
// 📩 [ส่วนที่ 2] ฟังก์ชันอ่านโพยและล็อกเงินค้ำประกัน 3 เท่า (วางแทนที่ระบบแทงเดิม)
// =================================================================
function parseAndPlaceBet(userId, text) {
    if (!isRoundOpen) return "❌ ขออภัย ระบบยังไม่เปิดให้ส่งโพยในรอบนี้";
    
    // ดึงข้อมูลผู้เล่นจากฐานข้อมูลเดิมของคุณ (ปรับตัวแปรตามของเดิมได้เลย เช่น users[userId])
    let user = usersWallet[userId]; 
    if (!user) return null; 

    const cleanText = text.trim();
    
    // 1. ตรวจจับ มข-50 (แทงผู้เล่นทุกขา 1-6 ขาละ 50)
    if (/^มข-(\d+)$/i.test(cleanText)) {
        const betPerLeg = parseInt(cleanText.match(/^มข-(\d+)$/i)[1]);
        const totalBet = betPerLeg * 6;
        const requiredHold = totalBet * 3; // ล็อกค้ำประกัน 3 เท่า
        
        if (user.credit < requiredHold) return `❌ เครดิตไม่พอค้ำประกัน! มข ต้องการเครดิตค้ำประกัน ${requiredHold} (ยอดแทงรวม ${totalBet})`;
        
        user.credit -= requiredHold; // หักเครดิตค้ำประกันออกจากกระเป๋า
        for (let leg = 1; leg <= 6; leg++) {
            currentRoundBets.push({ userId, type: 'เดี่ยว', leg, betAmount: betPerLeg, holdCredit: betPerLeg * 3 });
        }
        return `✅ รับโพย มัดขา (ขา 1-6) ขาละ ${betPerLeg} [ล็อกทุนค้ำประกัน ${requiredHold} สำเร็จ]`;
    }
    
    // 2. ตรวจจับ มจ-50 (แทงเจ้ามือสู้กับทุกขา 1-6 ขาละ 50)
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

    // 3. ตรวจจับ เดี่ยว (เช่น 123-50) หรือ เจาะขาเจ้ามือ (เช่น จ123-50)
    const singleMatch = cleanText.match(/^(จ)?([1-6]+)-(\d+)$/i);
    if (singleMatch) {
        const isDealerSide = !!singleMatch[1]; // เช็กว่ามีตัว 'จ' นำหน้าหรือไม่
        const legs = singleMatch[2].split('');  // แยกตัวเลขขาออกมาเป็นอาร์เรย์ เช่น ['1', '2']
        const betPerLeg = parseInt(singleMatch[3]);
        const totalBet = betPerLeg * legs.length;
        const requiredHold = totalBet * 3;
        
        if (user.credit < requiredHold) return `❌ เครดิตไม่พอค้ำประกัน! ต้องการ ${requiredHold} เครดิตของคุณคือ ${user.credit}`;
        
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
    
    return null; // หากไม่ตรงรูปแบบโพย ให้ปล่อยผ่านเพื่อไปเช็กคำสั่งอื่น
}

// =================================================================
// 📊 [ส่วนที่ 3] ฟังก์ชันแสดงตัวอย่างการออกผลไพ่ 3 ใบแยก 2 ชุด (ส่งผล 2 แถวพร้อมกัน)
// =================================================================
let lastProcessedCalculations = null; // ตัวแปรพักข้อมูลไว้รอแอดมินพิมพ์ OK

function previewRoundResults(line1, line2) {
    if (!line1.startsWith('/') || !line2.startsWith('//')) {
        return "❌ รูปแบบคำสั่งผิดพลาด! แถวแรกต้องเริ่มด้วย / แถวสองด้วย //";
    }
    
    const cardsSet1 = line1.substring(1).split(',');
    const cardsSet2 = line2.substring(2).split(',');
    const numPlayers = cardsSet1.length - 1; // ตัวสุดท้ายในแถวคือเจ้ามือ
    
    const dealerSet1 = cardsSet1[cardsSet1.length - 1];
    const dealerSet2 = cardsSet2[cardsSet2.length - 1];
    
    let summarySet1 = [];
    let summarySet2 = [];
    let lockedLegs = new Set(); // ขาที่ปิดบิลไปตั้งแต่ชุดที่ 1 (ป๊อก)
    
    // 🔸 ตรวจสอบชุดที่ 1 (ไม่จั่ว)
    for (let i = 0; i < numPlayers; i++) {
        const leg = i + 1;
        const playerCard = cardsSet1[i];
        const { cleanVal } = getCleanResult(playerCard);
        const outcome = compareCards(playerCard, dealerSet1);
        
        let mul = 0, text = "";
        if (outcome === 'win') {
            mul = calculateMultiplier(playerCard, true);
            text = mul > 1 ? `ชนะเจ้า (${mul} เด้ง)` : "ชนะเจ้า";
        } else if (outcome === 'lose') {
            mul = calculateMultiplier(dealerSet1, true);
            text = mul > 1 ? `แพ้เจ้า (เสีย ${mul} เด้ง)` : "แพ้เจ้า";
        } else {
            mul = 0;
            text = "เสมอเจ้า (ป๊อกชน)";
        }
        
        summarySet1.push({ leg, card: playerCard, outcome, multiplier: mul, text });
        
        // กฎล็อกบิล: ถ้าผู้เล่นป๊อก ($9, $8) หรือ เจ้ามือป๊อก ให้จบบิลขานั้นทันที
        if (cleanVal.includes('$') || getCleanResult(dealerSet1).cleanVal.includes('$')) {
            lockedLegs.add(leg);
        }
    }

    // 🔹 ตรวจสอบชุดที่ 2 (จั่วเพิ่ม)
    for (let i = 0; i < numPlayers; i++) {
        const leg = i + 1;
        const playerCard = cardsSet2[i];
        
        if (lockedLegs.has(leg)) {
            summarySet2.push({ leg, text: "🔒 (ปิดบิลไปแล้วในชุดที่ 1)" });
            continue;
        }
        
        const outcome = compareCards(playerCard, dealerSet2);
        let mul = 0, text = "";
        
        if (outcome === 'win') {
            mul = calculateMultiplier(playerCard, true);
            text = SPECIAL_MULTIPLIERS[playerCard.replace(/\*/g, '')] ? `ชนะเจ้า (${mul} เด้งอัตโนมัติ)` : `ชนะเจ้า (${mul} เด้ง)`;
        } else if (outcome === 'lose') {
            // 🛡️ กติกาพิเศษของผู้เล่นแพ้: โดนหักสูงสุดไม่เกิน 3 เท่า ตามยอดเงินค้ำประกัน
            const rawMul = calculateMultiplier(dealerSet2, true);
            mul = Math.min(rawMul, 3);
            text = rawMul > 3 ? `แพ้เจ้า (เสียสูงสุด ${mul} เด้งตามทุนค้ำ)` : `แพ้เจ้า (เสีย ${mul} เด้ง)`;
        } else {
            mul = 0;
            text = "เสมอเจ้า";
        }
        
        summarySet2.push({ leg, card: playerCard, outcome, multiplier: mul, text });
    }

    // เซฟลงหน่วยความจำชั่วคราว
    lastProcessedCalculations = { summarySet1, summarySet2, lockedLegs };

    // ออกแบบหน้าตา UI ข้อความส่งเข้าไลน์ (Scannable Output)
    let output = "📊 **[สรุปผลไพ่รวมประจำรอบ]**\n\n🔸 **ชุดที่ 1 (ไม่จั่ว)**\n👑 เจ้ามือ: " + dealerSet1 + "\n";
    summarySet1.forEach(item => {
        let icon = item.outcome === 'win' ? "🎉" : item.outcome === 'lose' ? "❌" : "🤝";
        output += `  • ขา ${item.leg} — {item.card} (${icon} ${item.text})${lockedLegs.has(item.leg) ? " **[จบบิลขานี้]**" : ""}\n`;
    });
    
    output += "\n------------------------\n\n🔹 **ชุดที่ 2 (จั่วเพิ่ม)**\n👑 เจ้ามือ: " + dealerSet2 + "\n";
    summarySet2.forEach(item => {
        if (item.card) {
            output += `  • ขา ${item.leg} — ${item.card} (🏆 ${item.text})\n`;
        } else {
            output += `  • ขา ${item.leg} — ${item.text}\n`;
        }
    });
    
    output += "\n⚠️ **แอดมินตรวจสอบความถูกต้อง**\nหากถูกต้องพิมพ์ **\"OK\"** เพื่อคิดยอดเงิน หรือผิดพลาดพิมพ์ **\"no\"**";
    return output;
}

// =================================================================
// 💰 [ส่วนที่ 4] ฟังก์ชันตัดยอดบัญชีและเคลียร์บิลจริงเมื่อแอดมินกดยืนยัน OK
// =================================================================
function confirmAndSettleBets() {
    if (!lastProcessedCalculations) return "❌ ไม่มีผลการคำนวณค้างอยู่ในระบบ";
    
    let report = "💰 **[สรุปผลการคิดเงินรายบุคคล]**\n";
    const { summarySet1, summarySet2, lockedLegs } = lastProcessedCalculations;
    
    let legResults = {};
    summarySet1.forEach(item => { legResults[item.leg] = { set1: { outcome: item.outcome, mult: item.multiplier } }; });
    summarySet2.forEach(item => { if (legResults[item.leg]) { legResults[item.leg].set2 = item.card ? { outcome: item.outcome, mult: item.multiplier } : null; } });

    let userSettlements = {};
    
    currentRoundBets.forEach(bet => {
        if (!userSettlements[bet.userId]) userSettlements[bet.userId] = { totalChange: 0, holdReturned: 0 };
        
        let legRes = legResults[bet.leg];
        let finalOutcome = 'draw';
        let finalMultiplier = 0;
        
        if (lockedLegs.has(bet.leg)) {
            finalOutcome = legRes.set1.outcome;
            finalMultiplier = legRes.set1.mult;
        } else if (legRes.set2) {
            finalOutcome = legRes.set2.outcome;
            finalMultiplier = legRes.set2.mult;
        }

        // หากผู้เล่นแทงฝั่งเจ้ามือ ('จ') ให้ทำการสลับฝั่งผลลัพธ์แพ้ชนะ
        if (bet.type === 'จ') {
            if (finalOutcome === 'win') finalOutcome = 'lose';
            else if (finalOutcome === 'lose') finalOutcome = 'win';
        }

        // คืนเงินค้ำประกันที่ดึงไปตอนแรกคืนกระเป๋าก่อน
        userSettlements[bet.userId].holdReturned += bet.holdCredit;
        
        // คำนวณกำไร / ขาดทุนสุทธิ
        if (finalOutcome === 'win') {
            userSettlements[bet.userId].totalChange += (bet.betAmount * finalMultiplier);
        } else if (finalOutcome === 'lose') {
            userSettlements[bet.userId].totalChange -= (bet.betAmount * finalMultiplier);
        }
    });

    // นำผลลัพธ์ทั้งหมดเขียนทับเข้ากระเป๋าเงินผู้เล่นจริงในระบบของคุณ
    Object.keys(userSettlements).forEach(uId => {
        let settlement = userSettlements[uId];
        let user = usersWallet[uId]; // ปรับตามตัวแปรระบบกระเป๋าเดิมของคุณได้เลย
        
        // ยอดเงินอัปเดต = ทุนปัจจุบัน + คืนค่าค้ำประกัน + ผลกำไร/ขาดทุน
        user.credit += settlement.holdReturned + settlement.totalChange;
        
        report += `👤 ${user.name}: ${settlement.totalChange >= 0 ? '🟢 +' : '🔴 '}${settlement.totalChange} (คงเหลือ: ${user.credit} ฿)\n`;
    });

    // 🔄 รีเซ็ตค่าระบบเพื่อเคลียร์กระดานรอบถัดไป
    currentRoundBets = [];
    lastProcessedCalculations = null;
    isRoundOpen = false;
    
    return report + "\n🔒 คิดบัญชีรอบนี้เรียบร้อย เริ่มต้นรอบใหม่ได้เลยครับ!";
}
