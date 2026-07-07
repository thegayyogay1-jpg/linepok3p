const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// 💡 ไม่ต้องใส่ Token ในนี้แล้ว ระบบจะดึงจากตัวแปรบน Render อัตโนมัติ
const TOKEN = process.env.CHANNEL_ACCESS_TOKEN;

// 🗄️ ฐานข้อมูลจำลองสำหรับจำสมาชิก (จะรีเซ็ตเมื่อเซิร์ฟเวอร์ Restart)
let usersWallets = {}; 
let nextMemberId = 1;
let isRoundOpen = false; // ตัวแปรจำสถานะ เปิด/ปิด รอบ
let roundBets = {};      // ตัวแปรสำหรับจำโพยแทงในแต่ละรอบ
let currentRound = 0;    // บรรทัดนี้เพื่อจำลำดับรอบปัจจุบัน
let isDrawOpen = false;  // บรรทัดนี้เพื่อเช็กสถานะรอบจั่วไพ่

app.post('/callback', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    for (let event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const replyToken = event.replyToken;
            const userId = event.source.userId; 
            const originalMsg = event.message.text.trim(); 
            const userMsg = originalMsg.toLowerCase().replace(/\s+/g, ''); 

            let replyText = ""; const args = originalMsg.split(/\s+/); 
const command = args[0]; // ดึงคำแรก เช่น เติม หรือ ลบ

if (command === "เติม" || command === "ลบ") {
    const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";
    // 🔒 เช็กสิทธิ์แอดมินก่อนเลยเป็นอันดับแรก
    if (userId !== ADMIN_ID) {
        replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งจัดการเครดิตครับ";
        } else {
    const targetMemberId = parseInt(args[1]); // เลขสมาชิก
    const amount = parseFloat(args[2]); // จำนวนเงิน

    // 1. เช็กว่าพิมพ์คำสั่งครบและถูกต้องไหม
    if (!targetMemberId || isNaN(amount) || amount <= 0) {
        replyText = `⚠️ รูปแบบคำสั่งไม่ถูกต้อง\nกรุณาพิมพ์: เติม [เลขสมาชิก] [จำนวนเงิน]\n(ตัวอย่าง: เติม 1 2000 หรือ ลบ 1 2000)`;
    } else {
        // 2. วนลูปหา LINE User ID จากเลขสมาชิกที่ระบุมา
        let foundUserKey = null;
        for (let key in usersWallets) {
            if (usersWallets[key].memberNumber === targetMemberId) {
                foundUserKey = key;
                break;
            }
        }

        // 3. ถ้าไม่เจอเลขสมาชิกในระบบ
        if (!foundUserKey) {
            replyText = `❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับ`;
        } else {
            // 4. คิดคำนวณเงินและปรับปรุงยอดในระบบ
            if (command === "เติม") {
                usersWallets[foundUserKey].balance += amount;
                const user = usersWallets[foundUserKey];
                replyText = `💰 เติมเครดิตให้ ${user.memberNumber} คุณ ${user.name} +${amount} สำเร็จ!\nยอดสุทธิ: ${user.balance} บาท`;
            } else if (command === "ลบ") {
                usersWallets[foundUserKey].balance -= amount;
                const user = usersWallets[foundUserKey];
                replyText = `🚨 ลบยอดเครดิตของ ${user.memberNumber} คุณ ${user.name} -${amount}!\nยอดปัจจุบัน: ${user.balance} บาท`;
            }
        }
    }
        } //<-- ปีกกาปิดแอดมิน
} 
//==================== โค้ดสเต็ป3 เปิด/ปิดรอบ ==================
else if (userMsg === 'o' || userMsg === 'x' || userMsg === 'rst') {
    // 👑 1. ตั้งค่า LINE User ID ของแอดมินตรงนี้
    const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db"; 

    if (userId !== ADMIN_ID) {
        replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งควบคุมระบบครับ";
    } else {
        if (userMsg === 'o') {
            // 🔍 เช็กว่าถ้าระบบเปิดอยู่แล้ว ห้ามกดซ้ำ
            if (isRoundOpen) {
                replyText = `⚠️ [แจ้งเตือน] ตอนนี้ระบบกำลังเปิด "รอบที่ ${currentRound}" อยู่แล้วครับ ไม่จำเป็นต้องเปิดซ้ำ ข้อมูลโพยเดิมยังอยู่ครบถ้วนครับ`;
            } else {
                currentRound++; 
                isRoundOpen = true;
                roundBets = {}; 
                replyText = `📢 [แอดมิน] เริ่มเปิดรอบแทงแล้วครับ!\n🎰 รอบที่: ${currentRound}\n\n✨ สมาชิกทุกท่านสามารถส่งโพยเข้ามาได้เลยครับครับ 🎰`;
            }
        } else if (userMsg === 'x') {
            // 🔍 เช็กว่าถ้าระบบปิดอยู่แล้ว ห้ามกดซ้ำ
            if (!isRoundOpen) {
                replyText = `⚠️ [แจ้งเตือน] ระบบปิดรอบแทงอยู่แล้วครับ ไม่สามารถปิดซ้ำได้`;
            } else {
                isRoundOpen = false;
                replyText = `🚫 [แอดมิน] ปิดรอบแทงเรียบร้อยแล้วครับ!\n🏁 จบรอบที่: ${currentRound}\n\n🔒 หยุดรับโพยทุกกรณี รอแอดมินสรุปผลสักครู่ครับ`;
            }
        } else if (userMsg === 'rst') {
            currentRound = 0; 
            isRoundOpen = false;
            roundBets = {};
            replyText = "🔄 [ระบบ] ทำการล้างลำดับรอบเรียบร้อยแล้ว! รอบต่อไปจะเริ่มต้นที่ รอบที่ 1 ครับ ⚙️";
        }
    }
}
    // ==================== [ END: โค้ดสเต็ปที่ 3 เปิดรอบ/ปิดรอบแทง ] =============
    // ==================== [ สเต็ป5 START: แอดมินเปิด/ปิดรอบจั่วไพ่ ] ====================
else if (userMsg === 'oo' || userMsg === 'xx') {
    const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db"; 

    if (userId !== ADMIN_ID) {
        replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งควบคุมระบบจั่วครับ";
    } else {
        if (userMsg === 'oo') {
            if (isRoundOpen) {
                replyText = "⚠️ ต้องพิมพ์ปิดรอบแทง (X) ก่อน จึงจะเปิดรอบจั่วได้ครับ";
            } else if (isDrawOpen) {
                replyText = "⚠️ ระบบกำลังเปิดให้สมาชิกจั่วไพ่อยู่แล้วครับ ไม่ต้องเปิดซ้ำ";
            } else {
                isDrawOpen = true;
                replyText = `🃏 [แอดมิน] เปิดรอบขอจั่วไพ่ใบที่ 3 (รอบที่ ${currentRound}) แล้วครับ!\n\n📣 สมาชิกขาไหนต้องการจั่วเพิ่ม ให้พิมพ์เลขขาตามด้วยเครื่องหมาย + เช่น พิมพ์ "12+" (ขอจั่วขา 1 และ 2)\n*หากขาไหนต้องการอยู่ (ไม่จั่ว) ไม่ต้องพิมพ์อะไรส่งมาครับ*`;
            }
        } else if (userMsg === 'xx') {
            if (!isDrawOpen) {
                replyText = "⚠️ ระบบไม่ได้เปิดรอบจั่วอยู่ครับ";
            } else {
                isDrawOpen = false;
                replyText = `🔒 [แอดมิน] ปิดรอบขอจั่วไพ่เรียบร้อยแล้วครับ!\n🎰 ล็อกสถานะไพ่ 2 ใบ / 3 ใบของทุกขาแล้ว รอแอดมินสรุปผลและคิดเงินสักครู่ครับ`;
            }
        }
    }
// ==================== [ END: แอดมินเปิด/ปิดรอบจั่วไพ่ ] ====================
    
    // ==================== [ START: โค้ดสเต็ปที่ 4 ระบบรับโพยป๊อกเด้ง + หักค้ำประกัน 3 เด้ง ] ====================
else if (originalMsg.includes('-') && !originalMsg.startsWith('C/') && !originalMsg.startsWith('c/')) {
    if (!isRoundOpen) {
        replyText = "🚫 ตอนนี้ระบบปิดรับโพยชั่วคราวครับ กรุณารอแอดมินเปิดรอบใหม่นะรับ";
    } else {
        const isRegistered = usersWallets[userId] ? true : false;
        
        if (!isRegistered) {
            replyText = `📢 ยินดีต้อนรับครับสมาชิกใหม่!\n\n⚠️ คุณยังไม่ได้ลงทะเบียนชื่อจริงในระบบ\nกรุณาพิมพ์: C/ชื่อ-นามสกุล ของท่านเพื่อสมัครสมาชิกก่อนแทงครับ`;
        } else {
            const user = usersWallets[userId];
            const lines = originalMsg.split(/\r?\n/);
            
            let totalActualBet = 0; // ยอดแทงหน้าโพยปกติ
            let totalHoldCost = 0;  // ยอดเงินที่ต้องหักจริง (ยอดแทง x 3 เด้ง)
            let processedBets = [];
            let hasError = false;
            let errorMsg = "";

            // 🎯 กำหนดเลขขาที่อนุญาตในระบบ (ขา 1 ถึง ขา 6)
            const allowedLegs = ['1', '2', '3', '4', '5','6'];

            // 💰 ⚙️ [ตั้งค่ายอดแทงตรงนี้ได้เลยครับ]
            const MIN_BET = 20;    // ยอดแทงขั้นต่ำ ต่อ 1 ขา
            const MAX_BET = 2000;  // ยอดแทงสูงสุด ต่อ 1 ขา

            for (let line of lines) {
                let cleanLine = line.trim().toLowerCase();
                if (cleanLine === "") continue;

                const parts = cleanLine.split('-');
                if (parts.length !== 2) {
                    hasError = true;
                    errorMsg = `⚠️ รูปแบบโพยไม่ถูกต้องในบรรทัด: "${line}"\n(ตัวอย่าง: 1-100 หรือ 123-100)`;
                    break;
                }

                const targetStr = parts[0].trim();
                const price = parseFloat(parts[1].trim());

                if (isNaN(price) || price <= 0) {
                    hasError = true;
                    errorMsg = `⚠️ จำนวนเงินไม่ถูกต้องในบรรทัด: "${line}"`;
                    break;
                }

                // 🔍 [จุดเช็กยอดขั้นต่ำ / สูงสุด ต่อขา]
                if (price < MIN_BET || price > MAX_BET) {
                    hasError = true;
                    errorMsg = `❌ แทงไม่สำเร็จ! ยอดแทงต่อขาต้องอยู่ระหว่าง ${MIN_BET} ถึง ${MAX_BET} บาทครับ\n(คุณพิมพ์มา ขาละ ${price} บาท ในบรรทัด: "${line}")`;
                    break;
                }

                let legsCount = 0;
                let betTypeDetail = "";

                // คำนวณจำนวนขาตามประเภทคำสั่ง
                if (targetStr === "มข") {
                    legsCount = 6; // มาตรฐานห้อง 6 ขาผู้เล่น
                    betTypeDetail = `เหมาขาผู้เล่นสู้เจ้ามือ (6 ขา) ขาละ ${price} บาท`;
                } else if (targetStr === "มจ") {
                    legsCount = 6; // เจ้ามือสู้ผู้เล่น 6 ขา
                    betTypeDetail = `แทงเจ้ามือสู้ทุกขา (6 ขา) ขาละ ${price} บาท`;
                } else if (targetStr.startsWith('จ')) {
                    const legs = targetStr.substring(1);
                    if (legs === "") { hasError = true; errorMsg = `⚠️ ไม่ระบุเลขขาเจ้ามือในบรรทัด: "${line}"`; break; }

                    // 🔍 เช็กว่าขาเจ้ามือที่พิมพ์มา มีเลขเกิน 1-6 ไหม
                    let isLegsValid = legs.split('').every(char => allowedLegs.includes(char));
                    if (!isLegsValid) {
                        hasError = true;
                        errorMsg = `❌ บันทึกโพยล้มเหลว! ห้องนี้มีแค่ ขา 1 ถึง ขา 6 เท่านั้นครับ\n(พบข้อผิดพลาดที่ขาเจ้ามือ: "${line}")`;
                        break;
                    }
                    
                    legsCount = legs.length;
                    betTypeDetail = `เจ้ามือสู้ขา [${legs.split('').join(', ')}] ขาละ ${price} บาท`;
                } else {
                     // 🔍 เช็กว่าขาผู้เล่นปกติที่พิมพ์มา มีเลขเกิน 1-6 ไหม
                    let isLegsValid = targetStr.split('').every(char => allowedLegs.includes(char));
                    if (!isLegsValid) {
                        hasError = true;
                        errorMsg = `❌ บันทึกโพยล้มเหลว! ห้องนี้มีแค่ ขา 1 ถึง ขา 6 เท่านั้นครับ\n(พบข้อผิดพลาดที่ขาผู้เล่น: "${line}")`;
                        break;
                    }
                    legsCount = targetStr.length;
                    betTypeDetail = `แทงขา [${targetStr.split('').join(', ')}] ขาละ ${price} บาท`;
                }

                let currentLineBet = price * legsCount;     // ยอดแทงรวมของบรรทัดนี้
                let currentLineHold = currentLineBet * 3;  // ยอดหักค้ำประกัน 3 เด้งของบรรทัดนี้

                totalActualBet += currentLineBet;
                totalHoldCost += currentLineHold;

                processedBets.push({
                    type: targetStr,
                    detail: betTypeDetail,
                    actualBet: currentLineBet,
                    holdCost: currentLineHold,
                    pricePerLeg: price
                });
            }

            if (hasError) {
                replyText = errorMsg;
            } else if (totalHoldCost === 0) {
                replyText = "⚠️ ไม่พบรายการแทงในข้อความของคุณครับ";
            } else if (user.balance < totalHoldCost) {
                // 💸 เช็กว่าเงินในกระเป๋าพอจ่ายค่าค้ำประกัน 3 เด้งไหม
                replyText = `❌ เครดิตของคุณไม่พอสหรับยอดค้ำประกันเด้ง (คิดสูงสุด 3 เด้ง) ครับ!\n💸 ยอดแทงปกติ: ${totalActualBet} บาท\n🔒 ต้องใช้ยอดค้ำประกันรวม: ${totalHoldCost} บาท\n💰 เครดิตปัจจุบันของคุณมี: ${user.balance} บาท`;
            } else {
                // 💾 เงินพอ -> ทำการหักเงินค้ำประกันทันที
                user.balance -= totalHoldCost;

                if (!roundBets[userId]) {
                    roundBets[userId] = [];
                }

                let summaryText = `✅ บันทึกโพยและหักค้ำประกัน 3 เด้งเรียบร้อย! 🎉\n👤 คุณ: ${user.name} (ID: ${user.memberNumber})\n\n📝 รายการแทงหน้าโพย:\n`;
                
                processedBets.forEach((bet) => {
                    summaryText += `• ${bet.detail}\n`;
                    
                    roundBets[userId].push({
                        name: user.name,
                        memberNumber: user.memberNumber,
                        betType: bet.type,
                        detail: bet.detail,
                        pricePerLeg: bet.pricePerLeg,
                        actualBet: bet.actualBet,
                        holdCost: bet.holdCost, // เก็บยอดที่ล็อคเอาไว้ไปคำนวณคืนเงินในสเต็ปส่งผล
                        time: new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' })
                    });
                });

                summaryText += `\n💵 ยอดแทงรวม: ${totalActualBet} บาท\n🔒 หักค้ำประกันรวม (x3): ${totalHoldCost} บาท\n💰 เครดิตคงเหลือชั่วคราว: ${user.balance} บาท\n*หากผลลัพธ์ไม่ได้แพ้ 3 เด้ง ระบบจะคืนเครดิตส่วนต่างให้ตอนสรุปผลครับ*`;
                replyText = summaryText;
            }
        }
    }
}
    // ==================== [ START: โค้ดระบบคืนโพย / ยกเลิกโพยในรอบ ] ====================
else if (userMsg === "r") {
    // 🔍 1. เช็กก่อนว่าแอดมินเปิดรอบอยู่ไหม (ถ้าปิดรอบแล้ว ห้ามคืน)
    if (!isRoundOpen) {
        replyText = "🚫 ไม่สามารถคืนโพยได้ครับ เนื่องจากแอดมินทำการปิดรอบแทงเรียบร้อยแล้ว";
    } else {
        // 🔍 2. เช็กสถานะการลงทะเบียน
        const isRegistered = usersWallets[userId] ? true : false;
        
        if (!isRegistered) {
            replyText = `📢 คุณยังไม่ได้ลงทะเบียนสมาชิกในระบบเลยครับ`;
        } else {
            const user = usersWallets[userId];
            const myBets = roundBets[userId];

            // 🔍 3. เช็กว่าในรอบนี้เขามีโพยค้างอยู่จริงไหม
            if (!myBets || myBets.length === 0) {
                replyText = `❌ คุณ ${user.name} ไม่มีรายการโพยค้างในรอบนี้ให้ยกเลิกครับ`;
            } else {
                // 🧮 4. คำนวณยอดเงินค้ำประกันทั้งหมดที่ต้องคืนให้
                const totalRefund = myBets.reduce((sum, bet) => sum + bet.holdCost, 0);
                
                // 💰 5. คืนเครดิตเข้ากระเป๋า + ล้างโพยรอบนี้ทิ้ง
                user.balance += totalRefund;
                roundBets[userId] = []; // เคลียร์โพยรอบนี้เป็นค่าว่าง

                replyText = `🗑️ ยกเลิกโพยสำเร็จเรียบร้อยแล้วครับ!\n👤 คุณ: ${user.name} (ID: ${user.memberNumber})\n💰 ระบบได้ทำการคืนเครดิตค้ำประกันให้คุณ: +${totalRefund} บาท\n✨ ยอดเครดิตปัจจุบัน: ${user.balance} บาท\n*(ตอนนี้โพยรอบนี้ของคุณกลายเป็นว่างแล้ว สามารถส่งโพยใหม่ได้ครับ)*`;
            }
        }
    }
}
// ==================== [ END: โค้ดระบบคืนโพย / ยกเลิกโพยในรอบ ] ====================
    // ==================== [ START: ระบบสมาชิกพิมพ์ขอจั่วไพ่ เช่น 12+ ] ====================
else if (originalMsg.endsWith('+')) {
    if (!isDrawOpen) {
        replyText = "🚫 ตอนนี้ระบบไม่ได้เปิดให้ขอจั่วไพ่ครับ หรืออาจจะยังไม่ถึงเวลาจั่ว";
    } else {
        const isRegistered = usersWallets[userId] ? true : false;
        if (!isRegistered) {
            replyText = "📢 คุณยังไม่ได้ลงทะเบียนสมาชิกในระบบครับ";
        } else {
            const user = usersWallets[userId];
            const myBets = roundBets[userId];

            if (!myBets || myBets.length === 0) {
                replyText = `❌ คุณ ${user.name} ไม่มีรายการโพยแทงในรอบนี้ จึงไม่สามารถจั่วไพ่ได้ครับ`;
            } else {
                // ดึงเฉพาะตัวเลขขาออกมาก่อนเครื่องหมาย +
                const drawLegsInput = originalMsg.replace('+', '').trim();
                const allowedLegs = ['1', '2', '3', '4', '5','6'];
                
                // เช็กความถูกต้องของเลขขา
                let isLegsValid = drawLegsInput.split('').every(char => allowedLegs.includes(char));
                
                if (drawLegsInput === "" || !isLegsValid) {
                    replyText = "⚠️ รูปแบบการจั่วไม่ถูกต้อง กรุณาพิมพ์เลขขา 1-5 ตามด้วยเครื่องหมาย + เช่น 12+";
                } else {
                    const drawLegsArray = drawLegsInput.split('');
                    let successCount = 0;

                    // วนลูปเข้าไปติด Tag ในโพยของสมาชิกคนนั้น
                    myBets.forEach((bet) => {
                        // สร้าง Object เก็บสถานะจั่วของแต่ละขาในโพยใบนี้ (ถ้าไม่มีให้สร้างใหม่)
                        if (!bet.drawStatus) {
                            bet.drawStatus = {}; // เก็บค่า เช่น { "1": "จั่ว", "2": "อยู่" }
                        }

                        // ไล่เช็กทีละขาในโพยใบนั้น
                        // ถ้าประเภทเป็น "มข" หรือ "ผู้เล่นปกติ" ที่มีตัวเลขขา
                        drawLegsArray.forEach((leg) => {
                            if (bet.type === "มข" || bet.type.includes(leg)) {
                                bet.drawStatus[leg] = "จั่ว";
                                successCount++;
                            }
                        });
                    });

                    if (successCount === 0) {
                        replyText = `⚠️ คุณพิมพ์จั่วขา [${drawLegsArray.join(', ')}] แต่ในโพยรอบนี้ของคุณไม่ได้แทงขานี้ไว้ครับ เช็กโพยพิมพ์ c`;
                    } else {
                        replyText = `✅ บันทึกสถานะจั่วไพ่ใบที่ 3 สำเร็จ!\n👤 คุณ: ${user.name}\n🃏 ขาที่ขอจั่วเพิ่ม: ขา [${drawLegsArray.join(', ')}]\n*ขาอื่น ๆ ที่คุณแทงไว้แต่นอกเหนือจากนี้ จะถือว่า "อยู่" (2 ใบ) โดยอัตโนมัติครับ*`;
                    }
                }
            }
        }
    }
}
// ==================== [ END: ระบบสมาชิกพิมพ์ขอจั่วไพ่ ] ====================
            else {
// ==================== [ END: โค้ดสเต็ปที่ 4 ระบบรับโพย ] ==================== 
{ 
            // ==================== [ START: โค้ดสเต็ปที่ 1 เช็กก่อนว่าคนนี้เคยลงทะเบียนในระบบหรือยัง ] ====================
const isRegistered = usersWallets[userId] ? true : false;

if (!isRegistered) {
    // 🛑 [กรณีคนใหม่] ยังไม่ได้ลงทะเบียน
    if (originalMsg.startsWith('C/') || originalMsg.startsWith('c/')) {
        const fullName = originalMsg.substring(2).trim(); 

        if (fullName === "") {
            replyText = `⚠️ กรุณากรอกชื่อ-นามสกุลต่อท้ายให้ถูกต้องด้วยครับ\n(ตัวอย่าง: C/นายแจ๊ค เด้งดี)`;
        } else {
            usersWallets[userId] = {
                memberNumber: nextMemberId,
                name: fullName,
                balance: 0
            };

            replyText = `🎉 ลงทะเบียนสมาชิกใหม่สำเร็จ! 🎉\n🆔 คุณคือสมาชิกคนที่: ${nextMemberId}\n👤 ชื่อ-นามสกุล: ${fullName}\n\n💰 ยอดเครดิตเริ่มต้น: 0 บาท\n*ตอนนี้คุณสามารถส่งโพยและพิมพ์ C เพื่อเช็คการ์ดสมาชิกได้แล้วครับ`;
            nextMemberId++;
        }
    } else {
        replyText = `📢 ยินดีต้อนรับครับสมาชิกใหม่!\n\n⚠️ คุณยังไม่ได้ลงทะเบียนชื่อจริงในระบบ\nกรุณาพิมพ์: C/ชื่อ-นามสกุล ของท่านเพื่อเปิดการใช้งานบอทครับ\n(ตัวอย่าง: C/นายแจ๊ค เด้งดี)`;
    }

} else {
    // ✅ [กรณีสมาชิกเก่า] ลงทะเบียนเรียบร้อยแล้ว
    const user = usersWallets[userId];

    if (userMsg === 'c') {
    // 1. ดึงข้อมูลพื้นฐานของสมาชิก
    let memberInfo = `👤 สมาชิกคนที่: ${user.memberNumber}\n👤 ชื่อ-นามสกุล: ${user.name}\n💰 ยอดเครดิตของคุณ: ${user.balance} บาท`;
    
    // 🔍 2. เช็กว่าในรอบปัจจุบัน คนนี้มีโพยที่แทงค้างไว้ไหม
    const myBets = roundBets[userId];
    
    if (myBets && myBets.length > 0) {
        memberInfo += `\n\n📝 รายการโพยค้างในรอบนี้:`;
        myBets.forEach((bet, index) => {
            memberInfo += `\n  ${index + 1}. ${bet.detail}`;
        });
        // คำนวณยอดเงินรวมที่โดนล็อคค้ำประกันไว้ดูเล่น ๆ ได้ด้วย
        const totalHold = myBets.reduce((sum, bet) => sum + bet.holdCost, 0);
        memberInfo += `\n🔒 ยอดค้ำประกันเด้งที่ล็อกไว้: ${totalHold} บาท`;
    } else {
        memberInfo += `\n\n📝 รายการโพยค้างในรอบนี้: ไม่มีโพยค้าง`;
    }

    replyText = memberInfo;
} else if (originalMsg.startsWith('C/') || originalMsg.startsWith('c/')) {
        // ถ้าสมาชิกเก่าเผลอพิมพ์สมัครซ้ำเข้ามา
        replyText = `ℹ️ คุณ ${user.name} ได้ลงทะเบียนในระบบเรียบร้อยแล้วครับ\n🆔 สมาชิกคนที่: ${user.memberNumber}`;
    } else {
        // ถ้าพิมพ์ข้อความอื่น ๆ เข้ามา บอทจะเงียบ (ไม่เซ็ต replyText) เพื่อส่งต่อให้ระบบอื่นทำงาน
        replyText = ""; 
    }
}
    }
    
// ==================== [ END: โค้ดสเต็ปที่ 1 เวอร์ชันแก้ไขใหม่ ] ====================

            // 🚀 ยิงข้อความตอบกลับไปที่ LINE
            if (replyText) {
                try {
                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                        replyToken: replyToken,
                        messages: [{ type: 'text', text: replyText }]
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TOKEN}`
                        }
                    });
                } catch (error) {
                    console.error("❌ ส่งข้อความกลับล้มเหลว:", error.response ? error.response.data : error.message);
                }
            }
        }
    }
    res.sendStatus(200);
});

app.get('/', (req, res) => { res.send('ระบบลงทะเบียนรันปกติ'); });
app.listen(process.env.PORT || 3000, () => { console.log('Server is running...'); });
