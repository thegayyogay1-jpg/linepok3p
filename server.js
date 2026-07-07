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
let tempRoomResults = null; // ใช้พักข้อมูลผลแต้มชั่วคราวที่แอดมินพึ่งพิมพ์ส่งมา
let tempDealerResult = null; // ใช้พักข้อมูลผลแต้มของเจ้ามือชั่วคราว
let matchHistory = []; // เก็บประวัติสถิติย้อนหลังสูงสุด 5 รอบ

app.post('/callback', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    for (let event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const replyToken = event.replyToken;
            const userId = event.source.userId; 
            const originalMsg = event.message.text.trim(); 
            const userMsg = originalMsg.toLowerCase().replace(/\s+/g, ''); 

            let replyText = ""; 
            const args = originalMsg.split(/\s+/); 
            const command = args[0]; // ดึงคำแรก เช่น เติม หรือ ลบ

            // ==================== [ 1. ระบบเติมเงิน/ลบเงิน ] ====================
            if (command === "เติม" || command === "ลบ") {
                const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";
                if (userId !== ADMIN_ID) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งจัดการเครดิตครับ";
                } else {
                    const targetMemberId = parseInt(args[1]); 
                    const amount = parseFloat(args[2]);      

                    if (!targetMemberId || isNaN(amount) || amount <= 0) {
                        replyText = `⚠️ รูปแบบคำสั่งไม่ถูกต้อง\nกรุณาพิมพ์: เติม [เลขสมาชิก] [จำนวนเงิน]\n(ตัวอย่าง: เติม 1 2000 หรือ ลบ 1 2000)`;
                    } else {
                        let foundUserKey = null;
                        for (let key in usersWallets) {
                            if (usersWallets[key].memberNumber === targetMemberId) {
                                foundUserKey = key;
                                break;
                            }
                        }

                        if (!foundUserKey) {
                            replyText = `❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับ`;
                        } else {
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
                }
            } 
            // ==================== [ 2. แอดมิน เปิด/ปิดรอบแทง - เวอร์ชันป้องกันมือลั่น ] ====================
else if (userMsg === 'o' || userMsg === 'x' || userMsg === 'rst') {
    const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";
    if (userId !== ADMIN_ID) {
        replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งควบคุมระบบครับ";
    } else {
        if (userMsg === 'o') {
            if (isRoundOpen) {
                replyText = `⚠️ [แจ้งเตือน] ตอนนี้ระบบกำลังเปิด "รอบที่ ${currentRound}" อยู่แล้วครับ ไม่จำเป็นต้องเปิดซ้ำ ข้อมูลโพยเดิมยังอยู่ครบถ้วนครับ`;
            } 
            // 🚨 [แก้ไขจุดบั๊ก] เช็กเพียงแค่ว่าถ้ารอบจั่วยังเปิดค้างอยู่ (isDrawOpen === true) เท่านั้นค่อยบล็อก
            else if (isDrawOpen) { 
            replyText = `❌ [ระงับคำสั่ง] ไม่สามารถเปิดรอบใหม่ได้ครับ!\nเนื่องจาก "รอบที่ ${currentRound}" ยังดำเนินรายการจั่วไพ่ไม่เสร็จสิ้น\n\n💡 หากต้องการเปิดรอบจั่ว ให้พิมพ์ oo\n💡 หากต้องการจบขั้นตอนจั่ว ให้พิมพ์ xx ก่อนครับ`;
            } else {
                            currentRound++;
                            isRoundOpen = true;
                            roundBets = {}; // ล้างข้อมูลโพยเก่าออกเพื่อเริ่มรอบใหม่
                            
                            // --- สร้างข้อความสถิติย้อนหลังแบบแยกขา ---
                            let historyText = "";
                            if (matchHistory.length > 0) {
                                historyText = `\n\n📈 **สถิติผลเจ้ามือ 5 รอบล่าสุด:**\n`;
                                matchHistory.forEach((h) => {
                                    historyText += `• ${h}\n`;
                                });
                            } else {
                                historyText = `\n\n📈 **สถิติย้อนหลัง:** ยังไม่มีข้อมูลในเซสชันนี้`;
                            }

                            replyText = `📢 [แอดมิน] เริ่มเปิดรอบแทงแล้วครับ!\n🎰 รอบที่: ${currentRound}${historyText}\n✨ สมาชิกทุกท่านสามารถส่งโพยเข้ามาได้เลยครับครับ 🎰`;
                        }
        } else if (userMsg === 'x') {
                        if (!isRoundOpen) {
                            replyText = `⚠️ [แจ้งเตือน] ระบบปิดรอบแทงอยู่แล้วครับ ไม่สามารถปิดซ้ำได้`;
                        } else {
                            isRoundOpen = false;
                            
// --- 📊 [สรุปยอดแทงรายบุคคล ดึงจากยอด actualBet ที่บันทึกไว้จริง] ---
                            let betSummaryText = "";
                            let hasAnyBet = false;

                            for (let uId in roundBets) {
                                const userBetsArray = roundBets[uId];
                                if (!userBetsArray || userBetsArray.length === 0) continue;

                                hasAnyBet = true;
                                const user = usersWallets[uId];
                                let userTotalBetAmt = 0;

                                // วนลูปดึงค่า actualBet ของทุกโพยที่คนนี้แทงในรอบนี้มาบวกรวมกัน
                                userBetsArray.forEach((b) => {
                                    if (b.actualBet) {
                                        userTotalBetAmt += b.actualBet;
                                    }
                                });

                                betSummaryText += `• [ ${user.memberNumber} ] ${user.name} ➡️ ยอดแทง: ${userTotalBetAmt} บาท\n`;
                            }
                            let closingBetSection = "";
                            if (hasAnyBet) {
                                closingBetSection = `\n\n📝 **สรุปยอดแทงประจำรอบ:**\n${betSummaryText}`;
                            } else {
                                closingBetSection = `\n\n📝 **สรุปยอดแทงประจำรอบ:**\n• ไม่มีสมาชิกส่งโพยเดิมพันในรอบนี้`;
                            }

                            replyText = `🚫 [แอดมิน] ปิดรอบแทงเรียบร้อยแล้วครับ!\n🏁 จบรอบที่: ${currentRound}${closingBetSection}\n\n🔒 หยุดรับโพยทุกกรณี รอแอดมินสรุปผลสักครู่ครับ`;
                        }
                    } else if (userMsg === 'rst') {
            currentRound = 0;
            isRoundOpen = false;
            isDrawOpen = false; // ล้างสถานะจั่วไปด้วยเลยตอนเซ็ตศูนย์
            roundBets = {};
            replyText = "🔄 [ระบบ] ทำการล้างลำดับรอบเรียบร้อยแล้ว! รอบต่อไปจะเริ่มต้นที่ รอบที่ 1 ครับ ⚙️";
        }
    }
}
            // ==================== [ 3. แอดมิน เปิด/ปิดรอบจั่วไพ่ - เวอร์ชันบล็อกพิมพ์ซ้ำ ] ====================
else if (userMsg === 'oo' || userMsg === 'xx') {
    const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";
    if (userId !== ADMIN_ID) {
        replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งควบคุมระบบจั่วครับ";
    } else {
        if (userMsg === 'oo') {
            if (isRoundOpen) {
                replyText = "⚠️ ต้องพิมพ์ปิดรอบแทง (X) ก่อน จึงจะเปิดรอบจั่วได้ครับ";
            } else if (isDrawOpen) {
                // 🔍 [เช็กบล็อกซ้ำ] ถ้าระบบเปิดรอบจั่วอยู่แล้ว ห้ามกดซ้ำ
                replyText = `⚠️ [แจ้งเตือน] ตอนนี้ระบบกำลังเปิด "รอบขอจั่วไพ่ใบที่ 3" อยู่แล้วครับ ไม่จำเป็นต้องเปิดซ้ำ ข้อมูลการจั่วเดิมยังอยู่ครบถ้วนครับ`;
            } else {
                isDrawOpen = true;
                replyText = `🃏 [แอดมิน] เปิดรอบขอจั่วไพ่ใบที่ 3 (รอบที่ ${currentRound}) แล้วครับ!\n\n📣 สมาชิกขาไหนต้องการจั่วเพิ่ม ให้พิมพ์เลขขาตามด้วยเครื่องหมาย + เช่น พิมพ์ "12+" (ขอจั่วขา 1 และ 2)\n*หากขาไหนต้องการอยู่ (ไม่จั่ว) ไม่ต้องพิมพ์อะไรส่งมาครับ*`;
            }
        } else if (userMsg === 'xx') {
            if (!isDrawOpen) {
                // 🔍 [เช็กบล็อกซ้ำ] ถ้าระบบปิดรอบจั่วอยู่แล้ว ห้ามกดซ้ำ
                replyText = "⚠️ [แจ้งเตือน] ระบบปิดรอบจั่วไพ่อยู่แล้วครับ ไม่สามารถปิดซ้ำได้";
            } else {
                isDrawOpen = false;
                replyText = `🔒 [แอดมิน] ปิดรอบขอจั่วไพ่เรียบร้อยแล้วครับ!\n🎰 ล็อกสถานะไพ่ 2 ใบ / 3 ใบของทุกขาแล้ว รอแอดมินสรุปผลและคิดเงินสักครู่ครับ`;
            }
        }
    }
}
            // ==================== [ 4. ระบบรับโพยป๊อกเด้ง + หักค้ำประกัน 3 เด้ง ] ====================
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
                        
                        let totalActualBet = 0; 
                        let totalHoldCost = 0;
                        let processedBets = [];
                        let hasError = false;
                        let errorMsg = "";

                        const allowedLegs = ['1', '2', '3', '4', '5', '6'];
                        const MIN_BET = 20;
                        const MAX_BET = 2000;

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

                            if (price < MIN_BET || price > MAX_BET) {
                                hasError = true;
                                errorMsg = `❌ แทงไม่สำเร็จ! ยอดแทงต่อขาต้องอยู่ระหว่าง ${MIN_BET} ถึง ${MAX_BET} บาทครับ\n(คุณพิมพ์มา ขาละ ${price} บาท ในบรรทัด: "${line}")`;
                                break;
                            }

                            let legsCount = 0;
                            let betTypeDetail = "";

                            if (targetStr === "มข") {
                                legsCount = 6;
                                betTypeDetail = `เหมาขาผู้เล่นสู้เจ้ามือ (6 ขา) ขาละ ${price} บาท`;
                            } else if (targetStr === "มจ") {
                                legsCount = 6;
                                betTypeDetail = `แทงเจ้ามือสู้ทุกขา (6 ขา) ขาละ ${price} บาท`;
                            } else if (targetStr.startsWith('จ')) {
                                const legs = targetStr.substring(1);
                                if (legs === "") { 
                                    hasError = true; 
                                    errorMsg = `⚠️ ไม่ระบุเลขขาเจ้ามือในบรรทัด: "${line}"`; 
                                    break;
                                }

                                let isLegsValid = legs.split('').every(char => allowedLegs.includes(char));
                                if (!isLegsValid) {
                                    hasError = true;
                                    errorMsg = `❌ บันทึกโพยล้มเหลว! ห้องนี้มีแค่ ขา 1 ถึง ขา 6 เท่านั้นครับ\n(พบข้อผิดพลาดที่ขาเจ้ามือ: "${line}")`;
                                    break;
                                }
                                
                                legsCount = legs.length;
                                betTypeDetail = `เจ้ามือสู้ขา [${legs.split('').join(', ')}] ขาละ ${price} บาท`;
                            } else {
                                let isLegsValid = targetStr.split('').every(char => allowedLegs.includes(char));
                                if (!isLegsValid) {
                                    hasError = true;
                                    errorMsg = `❌ บันทึกโพยล้มเหลว! ห้องนี้มีแค่ ขา 1 ถึง ขา 6 เท่านั้นครับ\n(พบข้อผิดพลาดที่ขาผู้เล่น: "${line}")`;
                                    break;
                                }
                                legsCount = targetStr.length;
                                betTypeDetail = `แทงขา [${targetStr.split('').join(', ')}] ขาละ ${price} บาท`;
                            }

                            let currentLineBet = price * legsCount;
                            let currentLineHold = currentLineBet * 3;

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
                            replyText = `❌ เครดิตของคุณไม่พอสหรับยอดค้ำประกันเด้ง (คิดสูงสุด 3 เด้ง) ครับ!\n💸 ยอดแทงปกติ: ${totalActualBet} บาท\n🔒 ต้องใช้ยอดค้ำประกันรวม: ${totalHoldCost} บาท\n💰 เครดิตปัจจุบันของคุณมี: ${user.balance} บาท`;
                        } else {
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
                                    holdCost: bet.holdCost, 
                                    time: new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' })
                                });
                            });
                            summaryText += `\n💵 ยอดแทงรวม: ${totalActualBet} บาท\n🔒 หักค้ำประกันรวม (x3): ${totalHoldCost} บาท\n💰 เครดิตคงเหลือชั่วคราว: ${user.balance} บาท\n*หากผลลัพธ์ไม่ได้แพ้ 3 เด้ง ระบบจะคืนเครดิตส่วนต่างให้ตอนสรุปผลครับ*`;
                            replyText = summaryText;
                        }
                    }
                }
            }
            // ==================== [ 5. ระบบคืนโพย / ยกเลิกโพยในรอบ ] ====================
            else if (userMsg === "r") {
                if (!isRoundOpen) {
                    replyText = "🚫 ไม่สามารถคืนโพยได้ครับ เนื่องจากแอดมินทำการปิดรอบแทงเรียบร้อยแล้ว";
                } else {
                    const isRegistered = usersWallets[userId] ? true : false;
                    if (!isRegistered) {
                        replyText = `📢 คุณยังไม่ได้ลงทะเบียนสมาชิกในระบบเลยครับ`;
                    } else {
                        const user = usersWallets[userId];
                        const myBets = roundBets[userId];

                        if (!myBets || myBets.length === 0) {
                            replyText = `❌ คุณ ${user.name} ไม่มีรายการโพยค้างในรอบนี้ให้ยกเลิกครับ`;
                        } else {
                            const totalRefund = myBets.reduce((sum, bet) => sum + bet.holdCost, 0);
                            user.balance += totalRefund;
                            roundBets[userId] = []; 

                            replyText = `🗑️ ยกเลิกโพยสำเร็จเรียบร้อยแล้วครับ!\n👤 คุณ: ${user.name} (ID: ${user.memberNumber})\n💰 ระบบได้ทำการคืนเครดิตค้ำประกันให้คุณ: +${totalRefund} บาท\n✨ ยอดเครดิตปัจจุบัน: ${user.balance} บาท\n*(ตอนนี้โพยรอบนี้ของคุณกลายเป็นว่างแล้ว สามารถส่งโพยใหม่ได้ครับ)*`;
                        }
                    }
                }
            }
            // ==================== [ 6. ระบบสมาชิกพิมพ์ขอจั่วไพ่ เช่น 12+ ] ====================
           else if (userMsg.endsWith('+')) {
                if (!isDrawOpen) {
                    replyText = "⚠️ [แจ้งเตือน] ระบบยังไม่ได้เปิดรอบจั่วไพ่ใบที่ 3 หรือ แอดมินปิดรอบจั่วไปแล้วครับ";
                } else {
                    const userBetsArray = roundBets[userId];
                    if (!userBetsArray || userBetsArray.length === 0) {
                        replyText = "⚠️ คุณยังไม่ได้ส่งโพยเดิมพันในรอบนี้ จึงไม่สามารถขอจั่วไพ่ได้ครับ";
                    } else {
                        const legsToDraw = userMsg.replace('+', '').split('');
                        let drawSuccessLegs = [];

                        userBetsArray.forEach((bet) => {
                            // 👑 [จุดแก้ไขบั๊ก] เช็กว่าโพยใบนี้เป็นโพยแทงฝั่งเจ้ามือสู้ขา (จ) หรือเหมาเจ้า (มจ) หรือไม่
                            const isBettingOnDealer = (bet.betType === "มจ" || bet.betType.startsWith('จ'));
                            
                            // 🛑 ถ้าเป็นโพยแทงฝั่งเจ้ามือ ให้ข้ามไปเลย ไม่ทำการเปิดสิทธิ์จั่วเด็ดขาด
                            if (isBettingOnDealer) return;

                            // 👤 ปรับสถานะเฉพาะโพยฝั่งผู้เล่นปกติเท่านั้น
                            if (!bet.drawStatus) bet.drawStatus = {};

                            legsToDraw.forEach((leg) => {
                                let hasThisLeg = false;
                                if (bet.betType === "มข") {
                                    hasThisLeg = ['1', '2', '3', '4', '5', '6'].includes(leg);
                                } else {
                                    hasThisLeg = bet.betType.includes(leg);
                                }

                                if (hasThisLeg) {
                                    bet.drawStatus[leg] = "จั่ว";
                                    if (!drawSuccessLegs.includes(leg)) {
                                        drawSuccessLegs.push(leg);
                                    }
                                }
                            });
                        });

                        if (drawSuccessLegs.length > 0) {
                            const sortedLegs = drawSuccessLegs.sort((a, b) => a - b).join(', ');
                            const user = usersWallets[userId];
                            replyText = `🃏 [ระบบจั่วไพ่] สมาชิกคุณ ${user.name} (ID: ${user.memberNumber}) ขอจั่วไพ่เพิ่มที่ ➡️ ขา: ${sortedLegs} ครับ ➕`;
                        } else {
                            // ถ้าคนนั้นมีแต่โพยฝั่งเจ้ามืออย่างเดียว บอทจะแจ้งเตือนตัดสิทธิ์ทันที
                            replyText = "⚠️ คำสั่งไม่ทำงาน: เนื่องจากคุณแทงฝั่งเจ้ามือไว้ โพยฝั่งเจ้ามือไม่สามารถขอจั่วไพ่ได้ครับ (ระบบจะรันกฎอัตโนมัติตอนคิดเงิน)";
                        }
                    }
                }
            }
                // ==================== [ 8. ระบบแอดมินส่งผลสรุปคำนวณแต้ม - เวอร์ชันใช้เครื่องหมาย = คั่นแยกขา (แก้ไขบั๊กตำแหน่งสลับ) ] ====================
else if (originalMsg.startsWith('>')) {
    const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";
    if (userId !== ADMIN_ID) {
        replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งสรุปผลคะแนนครับ";
    } else if (isRoundOpen) {
        replyText = "⚠️ ต้องพิมพ์ปิดรอบแทง (X) และทำขั้นตอนจั่วไพ่ให้เสร็จก่อน จึงจะสรุปผลได้ครับ";
    } else {
        // เอาเครื่องหมาย > ออกก่อน แล้วตัดแบ่งข้อความด้วยเครื่องหมาย = ตรงๆ เลย
        let textWithoutArrow = originalMsg.substring(1).trim();
        const parts = textWithoutArrow.split('='); // แยกชิ้นส่วนด้วย =
        
        // ฟังก์ชันสำหรับแกะรหัสไพ่ (isThreeCards = true คือล็อกว่าห้ามติดป๊อกเด็ดขาด)
        const parseCardStr = (str, isDealer = false, isThreeCards = false) => {
            let clean = str.trim().toLowerCase();
            let isPok = false;
            let multiplier = 1; 
            let typeName = "แต้มปกติ";
            let rawScore = 0;

            if (clean.includes('**')) { multiplier = 3; clean = clean.replace('**', ''); } 
            else if (clean.includes('*')) { multiplier = 2; clean = clean.replace('*', ''); }

            if (isDealer && clean.includes('#')) { isPok = true; clean = clean.replace('#', ''); }

            if (clean === 't') { rawScore = 700; multiplier = 5; typeName = "ตอง (5 เท่า)"; } 
            else if (clean === 'sf') { rawScore = 600; multiplier = 5; typeName = "สเตฟฟลัช (5 เท่า)"; } 
            else if (clean === 'h') { rawScore = 500; multiplier = 3; typeName = "เซียน/สามเหลือง (3 เท่า)"; } 
            else if (clean === 's') { rawScore = 400; multiplier = 3; typeName = "เรียง (3 เท่า)"; } 
            else {
                let pts = parseInt(clean);
                if (isNaN(pts)) pts = 0;
                
                if (!isThreeCards && (isPok || (!isDealer && !str.includes('/')))) {
                    if (pts === 9) { rawScore = 900; typeName = "ป๊อก 9"; }
                    else if (pts === 8) { rawScore = 800; typeName = "ป๊อก 8"; }
                    else { rawScore = pts; typeName = `${pts} แต้ม`; }
                } else {
                    rawScore = pts; typeName = `${pts} แต้ม`;
                }
            }
            return { score: rawScore, v: clean, mult: multiplier, name: typeName };
        };

        // 👑 ชิ้นส่วนแรก (parts[0]) จะเป็นผลของฝั่งเจ้ามือเสมอ เช่น "จ5" หรือ "จ5*"
        const dealerRawStr = parts[0] ? parts[0].replace('จ', '').trim() : '0';
        const dealerResult = parseCardStr(dealerRawStr, true, false);

        let roomResults = {}; 
        let currentLeg = 1; 

        // ชิ้นส่วนที่เหลือตั้งแต่ตำแหน่งที่ 1 เป็นต้นไป จะไล่เป็น ขา 1, ขา 2, ขา 3 อัตโนมัติ
        for (let i = 1; i < parts.length; i++) {
            let innerContent = parts[i].trim();
            if (innerContent === "") continue;
            if (currentLeg > 6) break; 

            let result2Cards = null;
            let result3Cards = null;

            if (innerContent.includes('/')) {
                const subParts = innerContent.split('/');
                result2Cards = parseCardStr(subParts[0], false, false); // 2 ใบแรก (มีสิทธิ์ป๊อก)
                result3Cards = parseCardStr(subParts[1], false, true);  // 3 ใบ (ไม่มีทางป๊อก บั๊กเคลียร์!)
            } else {
                result2Cards = parseCardStr(innerContent, false, false);
                result3Cards = parseCardStr(innerContent, false, false);
            }

            roomResults[currentLeg] = {
                leg: currentLeg,
                twoCards: result2Cards,
                threeCards: result3Cards
            };

            currentLeg++; 
        }

        tempRoomResults = roomResults;
        tempDealerResult = dealerResult;

        // --- พ่นรายงานสรุปผลกระดานให้ตรวจสอบพร้อมสถานะ 🟢🔴 ---
        let checkText = `📊 [ตรวจสอบผลการเล่น] รอบที่: ${currentRound}\n`;
        checkText += `👑 เจ้ามือ: ${dealerResult.name} (${dealerResult.mult} เด้ง)\n\n`;
        checkText += `📝 ลำดับหน้าไพ่และการประเมินผล:\n`;

        for (let leg = 1; leg <= 6; leg++) {
            if (roomResults[leg]) {
                const res = roomResults[leg];
                
                let status2Str = "🟡 เสมอ";
                if (res.twoCards.score > dealerResult.score) status2Str = "🟢 ชนะ";
                else if (res.twoCards.score < dealerResult.score) status2Str = "🔴 แพ้";

                let status3Str = "🟡 เสมอ";
                if (res.threeCards.score > dealerResult.score) status3Str = "🟢 ชนะ";
                else if (res.threeCards.score < dealerResult.score) status3Str = "🔴 แพ้";

                checkText += `• ขา ${leg}:\n`;
                checkText += `   - [อยู่ 2ใบ]: ${res.twoCards.name} (${res.twoCards.mult}เด้ง) -> ${status2Str}\n`;
                checkText += `   - [จั่ว 3ใบ]: ${res.threeCards.name} (${res.threeCards.mult}เด้ง) -> ${status3Str}\n`;
            } else {
                checkText += `• ขา ${leg} -> ⚠️ ไม่มีผลไพ่ (ระบบตีเป็นบอด แพ้เจ้ามือ 🔴)\n`;
            }
        }
        
        checkText += `\n🚨 [ระบบล็อกเพื่อความปลอดภัย]\n หากข้อมูลถูกต้อง ให้พิมพ์: ok\nหากพิมพ์ผิดให้พิมพ์: no`;
        replyText = checkText;
    }
}

// ==================== [ 9. ระบบแอดมินยืนยันผลคำนวณเงินจริง OK / NO (Settlement Engine) ] ====================
else if (userMsg === 'ok' || userMsg === 'no') {
    const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";
    if (userId !== ADMIN_ID) return;

    if (!tempRoomResults || !tempDealerResult) {
        replyText = "⚠️ ไม่มีข้อมูลผลแต้มค้างอยู่ในระบบครับ กรุณาส่งผลแต้มด้วยเครื่องหมาย > ก่อนครับ";
    } else {
        if (userMsg === 'ok') {
            let summaryPayoutText = `💰 [สรุปยอดรับ-จ่ายเงินรางวัล] รอบที่: ${currentRound}\n`;
            summaryPayoutText += `👑 เจ้ามือ: ${tempDealerResult.name}\n----------------------------------\n`;
            
            let hasAnyBet = false;

            // วนลูปสมาชิกทุกคนที่มีการแทงในรอบนี้เพื่อคิดเงิน
            for (let uId in roundBets) {
                const userBetsArray = roundBets[uId];
                if (!userBetsArray || userBetsArray.length === 0) continue;

                hasAnyBet = true;
                const user = usersWallets[uId];
                let userTotalWinLoss = 0; 
                let totalHoldRefund = 0;   

                userBetsArray.forEach((bet) => {
                    totalHoldRefund += bet.holdCost; // ดึงเงินค้ำประกัน 3 เท่ากลับมาคืนก่อน

                    // แกะข้อมูลตามประเภทโพย (เช่น "1", "มข", "จ12")
                    let legsToCalculate = [];
                    if (bet.betType === "มข" || bet.betType === "มจ") {
                        legsToCalculate = ['1', '2', '3', '4', '5', '6'];
                    } else if (bet.betType.startsWith('จ')) {
                        legsToCalculate = bet.betType.substring(1).split('');
                    } else {
                        legsToCalculate = bet.betType.split('');
                    }

                    // คำนวณเงินแยกตามรายขาในโพยใบนี้
                    legsToCalculate.forEach((leg) => {
                        const legNum = parseInt(leg);
                        const matchResult = tempRoomResults[legNum];
                        if (!matchResult) return; // ป้องกันกรณีขาไม่มีข้อมูลผล
                        
                        // 🔍 ตรวจสอบประเภทโพย: เป็นการแทงฝั่งเจ้ามือสู้ขาผู้เล่นใช่หรือไม่
                        const isBettingOnDealer = (bet.betType === "มจ" || bet.betType.startsWith('จ'));

                        let finalCard;
                        const betPrice = bet.pricePerLeg; // ยอดแทงต่อ 1 ขา

                        if (!isBettingOnDealer) {
                            // 👤 [ฝั่งคนแทงผู้เล่นปกติ] -> รันระบบเดิมของคุณที่สมบูรณ์แบบอยู่แล้ว 100%
                            const isUserDrawn = (bet.drawStatus && bet.drawStatus[leg] === "จั่ว");
                            finalCard = isUserDrawn ? matchResult.threeCards : matchResult.twoCards;

                            // คำนวณผลได้เสียของฝั่งผู้เล่นปกติ
                            if (finalCard.score > tempDealerResult.score) {
                                let winMultiplier = finalCard.mult;
                                userTotalWinLoss += (betPrice * winMultiplier);
                            } 
                            else if (finalCard.score < tempDealerResult.score) {
                                let loseMultiplier = tempDealerResult.mult;
                                if (isUserDrawn && (finalCard.v === 't' || finalCard.v === 'sf' || finalCard.v === 's' || finalCard.v === 'h')) {
                                    loseMultiplier = 3;
                                }
                                userTotalWinLoss -= (betPrice * loseMultiplier);
                            }
                        } 
                        else {
                            // 👑 [ฝั่งคนแทงเจ้ามือ (จ หรือ มจ)] -> ใช้กฎตายตัวแยกคำนวณเด็ดขาด
                            let playerTwoCardScore = matchResult.twoCards.score;
                            let playerTwoCardMult = matchResult.twoCards.mult;

                            // รันกฎตายตัว: ขาผู้เล่นได้ 4 แต้มหรือต่ำกว่า (และไม่ใช่ 4 แต้มเด้ง) ให้เจ้ามือไปสู้กับผล 3 ใบ
                            if (playerTwoCardScore <= 4 && playerTwoCardMult === 1) {
                                finalCard = matchResult.threeCards; // ชนกับผลไพ่ 3 ใบ
                            } else {
                                finalCard = matchResult.twoCards;   // ชนกับผลไพ่ 2 ใบ (5 แต้มขึ้นไป หรือ 4 แต้มเด้ง)
                            }

                            // 🧮 ตรรกะคิดเงินของฝั่งคนแทงเจ้ามือ (หักต๋ง 10% เฉพาะขาที่ได้กำไร)
                            if (tempDealerResult.score > finalCard.score) {
                                // เจ้ามือชนะขาผู้เล่นคนนั้น = คนแทงฝั่งเจ้าได้กำไร!
                                let winMultiplier = tempDealerResult.mult;
                                let grossWin = betPrice * winMultiplier; // กำไรเต็มก่อนหัก
                                
                                // 🔥 หักต๋งรายขาทันที 10% (เหลือจ่ายจริง 90%)
                                let netWin = Math.floor(grossWin * 0.9);
                                userTotalWinLoss += netWin;
                            } 
                            else if (tempDealerResult.score < finalCard.score) {
                                // เจ้ามือแพ้ขาผู้เล่นคนนั้น = คนแทงฝั่งเจ้าเสียเต็มจำนวนตามจำนวนเด้งของขานั้นๆ
                                let loseMultiplier = finalCard.mult;
                                userTotalWinLoss -= (betPrice * loseMultiplier);
                            }
                        }
                    });
                }); // ปิด userBetsArray.forEach

                // 🧮 อัปเดตกระเป๋าเงินจริงหลังคิดยอดสุทธิสุทธิ
                user.balance = user.balance + totalHoldRefund + userTotalWinLoss;

                let sign = userTotalWinLoss > 0 ? "🟢 +" : (userTotalWinLoss < 0 ? "🔴 " : "🟡 ");
                
                // ตรวจสอบว่าในรอบนี้ยูสเซอร์แทงฝั่งเจ้ามือหรือไม่ เพื่อความสวยงามในการแสดงข้อความท้ายรายงาน
                let isUserBettingOnDealer = userBetsArray.some(b => b.betType === "มจ" || b.betType.startsWith('จ'));
                let feeNote = (isUserBettingOnDealer && userTotalWinLoss !== 0) ? " (คิดต๋งขาชนะ 10% แล้ว)" : "";

                summaryPayoutText += `👤 ${user.name} (ID: ${user.memberNumber})\n   ยอดสุทธิ: ${sign}${userTotalWinLoss} บาท${feeNote} (เครดิต: ${user.balance} บ.)\n`;
            } // ปิดลูป for (let uId in roundBets)

            if (!hasAnyBet) {
                summaryPayoutText += "📝 รอบนี้ไม่มีสมาชิกส่งโพยเดิมพันเข้ามาครับ\n";
            }

            summaryPayoutText += `\n✨ ระบบได้ทำการคำนวณเงินและอัปเดตกระเป๋าเงินให้ทุกคนเรียบร้อยแล้วครับ! 🏁`;
            replyText = summaryPayoutText;

            // 📊 [ระบบบันทึกสถิติแบบละเอียดแยกขา] 
            let dealerDisplay = ""; 
            if (tempDealerResult.name.includes("ป๊อก 9")) dealerDisplay = "9ป";
            else if (tempDealerResult.name.includes("ป๊อก 8")) dealerDisplay = "8ป";
            else if (tempDealerResult.name.includes("ตอง")) dealerDisplay = "ตอง";
            else if (tempDealerResult.name.includes("สเตฟฟลัช")) dealerDisplay = "สเตฟ";
            else if (tempDealerResult.name.includes("เซียน")) dealerDisplay = "เซียน";
            else if (tempDealerResult.name.includes("เรียง")) dealerDisplay = "เรียง";
            else dealerDisplay = `${tempDealerResult.score}แต้ม`;

            let legsStatusStr = ""; 
            for (let leg = 1; leg <= 6; leg++) {
                if (tempRoomResults[leg]) {
                    const legRes = tempRoomResults[leg];
                    if (tempDealerResult.score > legRes.twoCards.score) {
                        legsStatusStr += `[${leg}🔴]`; 
                    } else if (tempDealerResult.score < legRes.twoCards.score) {
                        legsStatusStr += `[${leg}🟢]`; 
                    } else {
                        legsStatusStr += `[${leg}🟡]`; 
                    }
                } else {
                    legsStatusStr += `[${leg}🔴]`;
                }
            }

            let historySummary = `รอบที่ ${currentRound}: [👑${dealerDisplay}] ⚔️${legsStatusStr}`;
            matchHistory.push(historySummary);
            if (matchHistory.length > 5) {
                matchHistory.shift(); 
            }

            // ล้างสมองบอทหลังคิดเงินเสร็จเพื่อเริ่มตาใหม่
            tempRoomResults = null;
            tempDealerResult = null;
            isDrawOpen = false;
            roundBets = {}; 

        } else if (userMsg === 'no') {
            tempRoomResults = null;
            tempDealerResult = null;
            replyText = "❌ ยกเลิกผลการเล่นเรียบร้อยแล้วครับ! แอดมินสามารถส่งผลใหม่อีกครั้งด้วยเครื่องหมาย > ได้ทันทีครับ 🔄";
        }
    }
}
    // ====// ==================== [ 10. ระบบคู่มือ: คำสั่งสมาชิก (คส), กติกา (กต) และ บัญชี (บช) ] ====================
            else if (userMsg === 'คส' || userMsg === 'กต' || userMsg === 'บช' || userMsg === '/บช') {
                if (userMsg === 'คส') {
                    replyText = `📜 **[ คู่มือคำสั่งสำหรับสมาชิกทุกท่าน ]** 📜\n\n` +
                                `🔹 **c** ➡️ เช็กเลขสมาชิก ยอดเครดิต และสลิปโพยค้าง + เลขบัญชี\n` +
                                `🔹 **บช** หรือ **/บช** ➡️ ดูเลขบัญชีธนาคารสำหรับเติมเงิน\n` +
                                `🔹 **[เลขขา]-[จำนวนเงิน]** ➡️ ส่งโพยเดิมพัน (เช่น 123-100)\n` +
                                `🔹 **มข-[จำนวนเงิน]** ➡️ แทงเหมาหมดทุกขา ขาละเท่าๆ กัน\n` +
                                `🔹 **มจ-[จำนวนเงิน]** ➡️ แทงเจ้ามือชนผู้เล่นทุกขา ขาละเท่าๆ กัน\n` +
                                `🔹 **r** ➡️ ขอดึงโพยคืน/ยกเลิกโพยทั้งหมดในรอบนั้น (ตอนเปิดแทง)\n` +
                                `🔹 **[เลขขา]+** ➡️ ขอจั่วไพ่ใบที่ 3 เพิ่มเติม (เฉพาะขาผู้เล่นปกติ)\n\n` +
                                `💡 *หมายเหตุ: ทุกคำสั่งสามารถพิมพ์ได้ทั้งตัวพิมพ์เล็กและตัวพิมพ์ใหญ่ครับ*`;
                } 
                else if (userMsg === 'กต') {
                    replyText = `🃏 **[ กติกาการเล่นป๊อกเด้งเบื้องต้น ]** 🃏\n\n` +
                                `• [ข้อที่ 1] กรุณาใส่กติกาของคุณตรงนี้...\n` +
                                `• [ข้อที่ 2] กรุณาใส่กติกาของคุณตรงนี้...\n` +
                                `• [ข้อที่ 3] กรุณาใส่กติกาของคุณตรงนี้...\n\n` +
                                `💡 สมาชิกสามารถพิมพ์ "คส" เพื่อดูวิธีการส่งโพยและคำสั่งต่างๆ ได้ครับ`;
                }
                else if (userMsg === 'บช' || userMsg === '/บช') {
                    // 🏦 บล็อกข้อความตอบกลับเรื่องบัญชีธนาคารโดยเฉพาะ
                    replyText = `🏦 **[ ช่องทางการโอนเงินเติมเครดิต ]** 🏦\n\n` +
                                `🔹 **ธนาคาร:** กสิกรไทย (KBank)\n` +
                                `🔹 **เลขบัญชี:** 123-4-56789-0\n` +
                                `🔹 **ชื่อบัญชี:** นายสมชาย รวยเด้งดี\n\n` +
                                `⚠️ **ข้อควรระวัง:**\n` +
                                `เมื่อโอนเงินเสร็จแล้ว กรุณาส่งสลิปหลักฐานเข้ามาในแชทนี้ เพื่อให้แอดมินทำการตรวจสอบและเติมยอดเครดิตในระบบให้ครับ 🎉`;
                }
            }
            // ==================== [ 7. ระบบลงทะเบียน / เช็กบัตรสมาชิก (กรณีทั่วไป) ] ====================
            else {
                const isRegistered = usersWallets[userId] ? true : false;

                if (!isRegistered) {
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
                    const user = usersWallets[userId];
                    if (userMsg === 'c') {
                        let memberInfo = `👤 สมาชิกคนที่: ${user.memberNumber}\n👤 ชื่อ-นามสกุล: ${user.name}\n💰 ยอดเครดิตของคุณ: ${user.balance} บาท`;
                        const myBets = roundBets[userId];
                        if (myBets && myBets.length > 0) {
                            memberInfo += `\n\n📝 รายการโพยค้างในรอบนี้:`;
                            myBets.forEach((bet, index) => {
                                memberInfo += `\n  ${index + 1}. ${bet.detail}`;
                                
                                // 🔥 [เพิ่มใหม่] ตรวจสอบสถานะการจั่วไพ่เพื่อนำมาแสดงผลตอนกด c
                                if (bet.drawStatus) {
                                    let drawLegs = [];
                                    for (let leg in bet.drawStatus) {
                                        if (bet.drawStatus[leg] === "จั่ว") {
                                            drawLegs.push(leg);
                                        }
                                    }
                                    if (drawLegs.length > 0) {
                                        memberInfo += ` 🃏 (ขอจั่วเพิ่มขา: ${drawLegs.sort().join(', ')})`;
                                    }
                                }
                            });
                            const totalHold = myBets.reduce((sum, bet) => sum + bet.holdCost, 0);
                        memberInfo += `\n🔒 ยอดค้ำประกันเด้งที่ล็อกไว้: ${totalHold} บาท`;
                    } else {
                        memberInfo += `\n\n📝 รายการโพยค้างในรอบนี้: ไม่มีโพยค้าง`;
                    }

                    // 💡 [เพิ่มป้ายแนะนำคำสั่งและกติกาพ่วงท้ายกล่องข้อความตอนกด c]
                    memberInfo += `\n\n──────────────────\n` +
                                  `📖 *คู่มือช่วยเหลือสมาชิก:*\n` +
                                  `👉 พิมพ์ **คส** เพื่อดูคำสั่งทั้งหมด\n` +
                                  `👉 พิมพ์ **บช** หรือ **/บช** เพื่อดูเลขบัญชี\n` +
                                  `👉 พิมพ์ **กต** เพื่ออ่านกติกาห้อง`;

                    replyText = memberInfo;
                    } else if (originalMsg.startsWith('C/') || originalMsg.startsWith('c/')) {
                        replyText = `ℹ️ คุณ ${user.name} ได้ลงทะเบียนในระบบเรียบร้อยแล้วครับ\n🆔 สมาชิกคนที่: ${user.memberNumber}`;
                    } else {
                        replyText = "";
                    }
                }
            } // ปิดระบบลงทะเบียน

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
