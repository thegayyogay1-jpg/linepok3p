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
let currentRound = 0;
// บรรทัดนี้เพื่อจำลำดับรอบปัจจุบัน
let isDrawOpen = false;  // บรรทัดนี้เพื่อเช็กสถานะรอบจั่วไพ่
let tempRoomResults = null; // ใช้พักข้อมูลผลแต้มชั่วคราวที่แอดมินพึ่งพิมพ์ส่งมา
let tempDealerResult = null; // ใช้พักข้อมูลผลแต้มของเจ้ามือชั่วคราว
let matchHistory = [];
// เก็บประวัติสถิติย้อนหลังสูงสุด 5 รอบ
let detailedRoundHistory = {}; // ตัวแปรเก็บข้อมูลสำหรับแอดมินดึงย้อนหลัง
let pastRoundsData = {};
// ถังเก็บประวัติโพยและผลไพ่แยกรายรอบ (สำหรับดึง v,m)

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
            // ==================== [ ระบบเติมเงินแบบติดโปรโบนัสคูณ (B เลขสมาชิก จำนวนเงิน) ] ====================
            else if (command === "B" || command === "b") {
                const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";
                if (userId !== ADMIN_ID) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    const targetMemberId = parseInt(args[1]);
                    const amount = parseFloat(args[2]); // ยอดรวมที่แอดมินพิมพ์มา เช่น 200

                    if (!targetMemberId || isNaN(amount) || amount <= 0) {
                        replyText = `⚠️ รูปแบบโปรโบนัสไม่ถูกต้อง\nกรุณาพิมพ์: B [เลขสมาชิก] [ยอดรวมรวมโบนัส]\n(ตัวอย่าง: B 1 200)`;
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
                            const user = usersWallets[foundUserKey];
                            // 🧮 เติมเงินให้จริง + คำนวณเทิร์น 10 เท่าจากยอดรวมทันที
                            user.balance += amount;
                            user.turnoverTarget = amount * 10; // 200 x 10 = 2000 บาท

                            replyText = `🎁 เติมเครดิตโปรโบนัสให้ [ ${user.memberNumber} ] คุณ ${user.name} สำเร็จ!\n` +
                                        `💰 ยอดสุทธิ: +${amount} บาท\n` +
                                        `🔒 [เปิดระบบล็อกถอน] ต้องทำยอดเทิร์นสะสม (ได้/เสีย) ให้ครบ: ${user.turnoverTarget} บาท`;
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
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งระบบจั่วครับ";
                } else {
                    // 🟢 [ฝั่งเปิดรอบจั่ว oo]
                    if (userMsg === 'oo') {
                        if (isRoundOpen) {
                            replyText = "⚠️ ต้องพิมพ์ปิดรอบแทง (X) ก่อน จึงจะเปิดรอบจั่วได้ครับ";
                        } else if (isDrawOpen) {
                            replyText = `⚠️ [แจ้งเตือน] ตอนนี้ระบบกำลังเปิด "รอบขอจั่วไพ่ใบที่ 3" อยู่แล้วครับ ไม่จำเป็นต้องเปิดซ้ำครับ`;
                        } else {
                            isDrawOpen = true;
                            // เปิดสิทธิ์ให้บอทรับคำสั่งเครื่องหมาย + จากสมาชิก
                            replyText = `🃏 [แอดมิน] เปิดรอบขอจั่วไพ่ใบที่ 3 (รอบที่ ${currentRound}) แล้วครับ!\n➕\n\n📢 สมาชิกขาไหนต้องการจั่วเพิ่ม ให้พิมพ์เลขขาตามด้วยเครื่องหมาย + เช่น พิมพ์ "12+" (ขอจั่วขา 1 และ 2)\n*หากขาไหนต้องการอยู่ (ไม่จั่ว) ไม่ต้องพิมพ์อะไรส่งมาครับ*`;
                        }
                    } 
                    // 🔴 [ฝั่งปิดรอบจั่ว xx + สรุปรายละเอียดรายบุคคล]
                    else if (userMsg === 'xx') {
                        if (!isDrawOpen) {
                            replyText = "⚠️ [แจ้งเตือน] ระบบปิดรอบจั่วไพ่อยู่แล้วครับ ไม่สามารถปิดซ้ำได้";
                        } else {
                            // 1. ปิดระบบรับรอบจั่วทันที
                            isDrawOpen = false;
                            // 2. เริ่มสร้างกล่องข้อความสรุปรายขาของสมาชิกทุกคนในรอบนี้
                            let summaryLegsText = `🔒 **[แอดมิน] ปิดรอบขอจั่วไพ่เรียบร้อยแล้วครับ!**\n` +
                                                  `🎰 ล็อกสถานะไพ่ 2 ใบ / 3 ใบของทุกขาแล้ว รอแอดมินสรุปผลและคิดเงินสักครู่ครับ\n` +
                                                  `──────────────────\n` +
                                                  `📋 **[ รายงานสรุปสถานะโพยและยอดแทงในรอบนี้ ]**\n\n`;
                            let hasBets = false;

                            // วนลูปเช็กข้อมูลโพยของทุกคนในรอบนี้
                            for (let uid in roundBets) {
                                const userBetsArray = roundBets[uid];
                                if (userBetsArray && userBetsArray.length > 0) {
                                    hasBets = true;
                                    const user = usersWallets[uid]; // ดึงข้อมูลโปรไฟล์สมาชิก

                                    let totalRealPlay = 0; // ยอดเล่นรวมจริง
                                    let totalWithBounce = 0; // ยอดค้ำประกัน (รวมค้ำเด้ง 3 เท่า)
                                    let betLegsDetail = []; // เก็บรายละเอียดเบอร์ขาที่แทง
                                    let drawLegsDetail = []; // เก็บรายละเอียดขาที่ขอจั่วเพิ่ม

                                    userBetsArray.forEach((bet) => {
                                        // คำนวณเบอร์ขาฝั่งผู้เล่นปกติ
                                        if (bet.betType !== "มข" && bet.betType !== "มจ" && !bet.betType.startsWith('จ')) {
                                            const individualLegs = bet.betType.split('');
                                            individualLegs.forEach((leg) => {
                                                if (!betLegsDetail.includes(leg)) betLegsDetail.push(leg);
                                                
                                                // เช็กสถานะการจั่วใบที่ 3 ของขานี้
                                                if (bet.drawStatus && bet.drawStatus[leg] === "จั่ว") {
                                                    if (!drawLegsDetail.includes(leg)) drawLegsDetail.push(leg);
                                                }
                                            });
                                        } 
                                        // สำหรับกรณีแทงพิเศษอื่นๆ (มข / มจ / ขาเจ้ามือ)
                                        else {
                                            if (!betLegsDetail.includes(bet.betType)) {
                                                betLegsDetail.push(bet.betType);
                                            }
                                        }

                                        // คำนวณยอดเงินรวม
                                        totalRealPlay += bet.totalPrice || bet.actualBet; // รองรับโครงสร้างชื่อตัวแปรของโพย
                                        totalWithBounce += bet.holdCost; // ดึงยอดค้ำเด้ง 3 เท่าที่ระบบหักไว้จริงมาแสดง
                                    });
                                    // จัดเรียงรายชื่อขาให้สวยงามเพื่ออ่านง่าย
                                    const legsStr = betLegsDetail.sort().join(', ');
                                    const drawStr = drawLegsDetail.length > 0 ? drawLegsDetail.sort().join(', ') : "ไม่มี (อยู่ 2 ใบ)";
                                    // เติมรายงานรายบุคคลเข้าไปในข้อความสรุป
                                    summaryLegsText += `👤 **คุณ: ${user.name} (ID: ${user.memberNumber})**\n` +
                                                       `👉 แทงขา: [ ${legsStr} ]\n` +
                                                       `🃏 ขอจั่วเพิ่มขา: [ ${drawStr} ]\n` +
                                                       `💰 ยอดเล่นรวม: ${totalRealPlay} บาท *(รวมค้ำเด้ง: ${totalWithBounce} บาท)*\n` +
                                                       `──────────────────\n`;
                                }
                            }

                            if (!hasBets) {
                                summaryLegsText += "ℹ️ รอบนี้ไม่มีสมาชิกส่งโพยเดิมพันเข้ามาครับ";
                            }

                            replyText = summaryLegsText;
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
                        // 🔒 [แก้ไขจุดบกพร่อง] ดักจับสถานะล็อกถอนเงิน และสั่งให้บอทยิงข้อความเตือนทันที!
                        if (user && user.isWithdrawLocked) {
                            const lockMsg = `❌ คุณไม่สามารถส่งโพยแทงได้ครับ!\n👤 คุณ ${user.name} (ID: ${user.memberNumber}) อยู่ในระหว่าง "รอแอดมินโอนเงินและอนุมัติยอดถอน" (${user.pendingWithdrawAmount} บาท) บัญชีของคุณจึงถูกล็อกชั่วคราวครับ`;
                            try {
                                await axios.post('https://api.line.me/v2/bot/message/reply', {
                                    replyToken: replyToken,
                                    messages: [{ type: 'text', text: lockMsg }]
                                }, {
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${TOKEN}`
                                    }
                                });
                            } catch (error) {
                                console.error("❌ ส่งข้อความแจ้งเตือนล็อกถอนล้มเหลว:", error.response ? error.response.data : error.message);
                            }
                            return; // ส่งข้อความเสร็จแล้วค่อยตัดจบระบบรับโพย
                        }
                        
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
                    const parseCardStr = (str, isThreeCards = false) => {
                        let cleanStr = str.replace(/[^0-9pPdD]/g, '');
                        let isPok = false;
                        let pokValue = 0;
                        let bounce = 1;
                        let displayScore = "";

                        if ((cleanStr.startsWith('p') || cleanStr.startsWith('P')) && !isThreeCards) {
                            isPok = true;
                            pokValue = parseInt(cleanStr.substring(1));
                            displayScore = `ป๊อก ${pokValue}`;
                            let remainderStr = cleanStr.substring(2);
                            if (remainderStr.startsWith('d') || remainderStr.startsWith('D')) {
                                bounce = parseInt(remainderStr.substring(1)) || 2;
                            }
                        } else if (cleanStr.startsWith('p') || cleanStr.startsWith('P')) {
                            let valueAfterP = cleanStr.substring(1);
                            let scoreNum = parseInt(valueAfterP[0]);
                            displayScore = `${scoreNum} แต้ม`;
                            let remainderStr = valueAfterP.substring(1);
                            if (remainderStr.startsWith('d') || remainderStr.startsWith('D')) {
                                bounce = parseInt(remainderStr.substring(1)) || 2;
                            }
                        } else {
                            let scoreNum = parseInt(cleanStr[0]) || 0;
                            displayScore = `${scoreNum} แต้ม`;
                            let remainderStr = cleanStr.substring(1);
                            if (remainderStr.startsWith('d') || remainderStr.startsWith('D')) {
                                bounce = parseInt(remainderStr.substring(1)) || 2;
                            }
                        }
                        return { isPok, score: isPok ? pokValue : parseInt(cleanStr[0]) || 0, bounce, displayScore };
                    };

                    if (parts.length < 2) {
                        replyText = "⚠️ รูปแบบคำสั่งพิมพ์แต้มไม่ถูกต้อง\nกรุณาพิมพ์ตัวอย่าง: >จ9=1ป8=27=35d2=43=57=64\n(เจ้ามืออยู่ซ้ายสุด ถัดไปหลังเครื่องหมาย = คือเบอร์ขาตามด้วยแต้มขา)";
                    } else {
                        let dealerRaw = parts[0].trim();
                        let parsedDealer = parseCardStr(dealerRaw, false);

                        let legsData = {};
                        for (let i = 1; i < parts.length; i++) {
                            let segment = parts[i].trim();
                            let legNum = segment[0]; 
                            let resultStr = segment.substring(1); 
                            legsData[legNum] = resultStr;
                        }

                        tempRoomResults = legsData;
                        tempDealerResult = parsedDealer;

                        let previewText = `📊 **[ ผลคะแนนรอบที่ ${currentRound} (รอแอดมินพิมพ์ ok เพื่อคิดเงิน) ]**\n\n` +
                                          `👑 เจ้ามือ: **${parsedDealer.displayScore}** ${parsedDealer.bounce > 1 ? `(${parsedDealer.bounce} เด้ง)` : ""}\n` +
                                          `──────────────────\n`;

                        for (let leg = 1; leg <= 6; leg++) {
                            if (legsData[leg]) {
                                let parsedLegPreview = parseCardStr(legsData[leg], false);
                                previewText += `• ขา [ ${leg} ]: **${parsedLegPreview.displayScore}** ${parsedLegPreview.bounce > 1 ? `(${parsedLegPreview.bounce} เด้ง)` : ""}\n`;
                            }
                        }
                        previewText += `\n⚙️ หากข้อมูลถูกต้อง ให้พิมพ์ **ok** เพื่อคำนวณเงินและตัดยอดเครดิตกระเป๋าของสมาชิกทุกคนอัตโนมัติครับ`;
                        replyText = previewText;
                    }
                }
            }
            // ==================== [ 9. แอดมินยืนยันคำสั่ง OK เพื่อคิดเงินตัดยอดแบบอัตโนมัติ ] ====================
            else if (userMsg === "ok") {
                const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";
                if (userId !== ADMIN_ID) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else if (!tempRoomResults || !tempDealerResult) {
                    replyText = "⚠️ ไม่พบข้อมูลผลแต้มค้างในระบบครับ กรุณาพิมพ์ส่งผลคะแนนหลักขึ้นต้นด้วยเครื่องหมาย > ก่อนกด ok ครับ";
                } else {
                    const parseCardStr = (str, isThreeCards = false) => {
                        let cleanStr = str.replace(/[^0-9pPdD]/g, '');
                        let isPok = false;
                        let pokValue = 0;
                        let bounce = 1;
                        let displayScore = "";

                        if ((cleanStr.startsWith('p') || cleanStr.startsWith('P')) && !isThreeCards) {
                            isPok = true;
                            pokValue = parseInt(cleanStr.substring(1));
                            displayScore = `ป๊อก ${pokValue}`;
                            let remainderStr = cleanStr.substring(2);
                            if (remainderStr.startsWith('d') || remainderStr.startsWith('D')) {
                                bounce = parseInt(remainderStr.substring(1)) || 2;
                            }
                        } else if (cleanStr.startsWith('p') || cleanStr.startsWith('P')) {
                            let valueAfterP = cleanStr.substring(1);
                            let scoreNum = parseInt(valueAfterP[0]);
                            displayScore = `${scoreNum} แต้ม`;
                            let remainderStr = valueAfterP.substring(1);
                            if (remainderStr.startsWith('d') || remainderStr.startsWith('D')) {
                                bounce = parseInt(remainderStr.substring(1)) || 2;
                            }
                        } else {
                            let scoreNum = parseInt(cleanStr[0]) || 0;
                            displayScore = `${scoreNum} แต้ม`;
                            let remainderStr = cleanStr.substring(1);
                            if (remainderStr.startsWith('d') || remainderStr.startsWith('D')) {
                                bounce = parseInt(remainderStr.substring(1)) || 2;
                            }
                        }
                        return { isPok, score: isPok ? pokValue : parseInt(cleanStr[0]) || 0, bounce, displayScore };
                    };

                    let finalReportText = `🎰 **สรุปผลการเดิมพันประจำรอบที่: ${currentRound}** 🎉\n` +
                                          `👑 ผลเจ้ามือ: **${tempDealerResult.displayScore}** ${tempDealerResult.bounce > 1 ? `(${tempDealerResult.bounce} เด้ง)` : ""}\n` +
                                          `──────────────────\n\n`;

                    let hasAnyMemberSummary = false;
                    let roundBillDetails = [];

                    for (let uId in roundBets) {
                        const userBetsArray = roundBets[uId];
                        if (!userBetsArray || userBetsArray.length === 0) continue;

                        hasAnyMemberSummary = true;
                        const user = usersWallets[uId];
                        let totalWinLose = 0; 
                        let totalHoldRefund = 0; 
                        let logDetails = [];

                        userBetsArray.forEach((bet) => {
                            totalHoldRefund += bet.holdCost;
                            let betType = bet.betType;
                            let pricePerLeg = bet.pricePerLeg;

                            if (betType === "มข") {
                                for (let l = 1; l <= 6; l++) {
                                    let legRaw = tempRoomResults[l] || "0";
                                    let is3Card = (bet.drawStatus && bet.drawStatus[l] === "จั่ว");
                                    let parsedLeg = parseCardStr(legRaw, is3Card);
                                    let winStatus = "เสมอ";
                                    let multiply = 1;

                                    if (tempDealerResult.isPok && !parsedLeg.isPok) { winStatus = "เสีย"; multiply = tempDealerResult.bounce; }
                                    else if (!tempDealerResult.isPok && parsedLeg.isPok) { winStatus = "ชนะ"; multiply = parsedLeg.bounce; }
                                    else if (parsedLeg.score > tempDealerResult.score) { winStatus = "ชนะ"; multiply = parsedLeg.bounce; }
                                    else if (parsedLeg.score < tempDealerResult.score) { winStatus = "เสีย"; multiply = tempDealerResult.bounce; }
                                    else { if (parsedLeg.bounce > 1 && winStatus === "ชนะ") multiply = parsedLeg.bounce; else if (tempDealerResult.bounce > 1 && winStatus === "เสีย") multiply = tempDealerResult.bounce; }

                                    let amt = pricePerLeg * multiply;
                                    if (winStatus === "ชนะ") { totalWinLose += amt; logDetails.push(`• ขา ${l} (${parsedLeg.displayScore}): ชนะ +${amt}`); }
                                    else if (winStatus === "เสีย") { totalWinLose -= amt; logDetails.push(`• ขา ${l} (${parsedLeg.displayScore}): เสีย -${amt}`); }
                                    else { logDetails.push(`• ขา ${l} (${parsedLeg.displayScore}): เสมอ +0`); }
                                }
                            } else if (betType === "มจ") {
                                for (let l = 1; l <= 6; l++) {
                                    let legRaw = tempRoomResults[l] || "0";
                                    let is3Card = (bet.drawStatus && bet.drawStatus[l] === "จั่ว");
                                    let parsedLeg = parseCardStr(legRaw, is3Card);
                                    let winStatus = "เสมอ";
                                    let multiply = 1;

                                    if (tempDealerResult.isPok && !parsedLeg.isPok) { winStatus = "ชนะ"; multiply = tempDealerResult.bounce; }
                                    else if (!tempDealerResult.isPok && parsedLeg.isPok) { winStatus = "เสีย"; multiply = parsedLeg.bounce; }
                                    else if (tempDealerResult.score > parsedLeg.score) { winStatus = "ชนะ"; multiply = tempDealerResult.bounce; }
                                    else if (tempDealerResult.score < parsedLeg.score) { winStatus = "เสีย"; multiply = parsedLeg.bounce; }
                                    else { if (tempDealerResult.bounce > 1 && winStatus === "ชนะ") multiply = tempDealerResult.bounce; else if (parsedLeg.bounce > 1 && winStatus === "เสีย") multiply = parsedLeg.bounce; }

                                    let amt = pricePerLeg * multiply;
                                    if (winStatus === "ชนะ") { totalWinLose += amt; logDetails.push(`• กินขา ${l} (${parsedLeg.displayScore}): ชนะ +${amt}`); }
                                    else if (winStatus === "เสีย") { totalWinLose -= amt; logDetails.push(`• จ่ายขา ${l} (${parsedLeg.displayScore}): เสีย -${amt}`); }
                                    else { logDetails.push(`• ดึงขา ${l} (${parsedLeg.displayScore}): เสมอ +0`); }
                                }
                            } else if (betType.startsWith('จ')) {
                                let targetedLegs = betType.substring(1).split('');
                                targetedLegs.forEach((l) => {
                                    let legRaw = tempRoomResults[l] || "0";
                                    let is3Card = (bet.drawStatus && bet.drawStatus[l] === "จั่ว");
                                    let parsedLeg = parseCardStr(legRaw, is3Card);
                                    let winStatus = "เสมอ";
                                    let multiply = 1;

                                    if (tempDealerResult.isPok && !parsedLeg.isPok) { winStatus = "ชนะ"; multiply = tempDealerResult.bounce; }
                                    else if (!tempDealerResult.isPok && parsedLeg.isPok) { winStatus = "เสีย"; multiply = parsedLeg.bounce; }
                                    else if (tempDealerResult.score > parsedLeg.score) { winStatus = "ชนะ"; multiply = tempDealerResult.bounce; }
                                    else if (tempDealerResult.score < parsedLeg.score) { winStatus = "เสีย"; multiply = parsedLeg.bounce; }
                                    else { if (tempDealerResult.bounce > 1 && winStatus === "ชนะ") multiply = tempDealerResult.bounce; else if (parsedLeg.bounce > 1 && winStatus === "เสีย") multiply = parsedLeg.bounce; }

                                    let amt = pricePerLeg * multiply;
                                    if (winStatus === "ชนะ") { totalWinLose += amt; logDetails.push(`• กินขา ${l} (${parsedLeg.displayScore}): ชนะ +${amt}`); }
                                    else if (winStatus === "เสีย") { totalWinLose -= amt; logDetails.push(`• จ่ายขา ${l} (${parsedLeg.displayScore}): เสีย -${amt}`); }
                                    else { logDetails.push(`• ดึงขา ${l} (${parsedLeg.displayScore}): เสมอ +0`); }
                                });
                            } else {
                                let chosenLegs = betType.split('');
                                chosenLegs.forEach((l) => {
                                    let legRaw = tempRoomResults[l] || "0";
                                    let is3Card = (bet.drawStatus && bet.drawStatus[l] === "จั่ว");
                                    let parsedLeg = parseCardStr(legRaw, is3Card);
                                    let winStatus = "เสมอ";
                                    let multiply = 1;

                                    if (tempDealerResult.isPok && !parsedLeg.isPok) { winStatus = "เสีย"; multiply = tempDealerResult.bounce; }
                                    else if (!tempDealerResult.isPok && parsedLeg.isPok) { winStatus = "ชนะ"; multiply = parsedLeg.bounce; }
                                    else if (parsedLeg.score > tempDealerResult.score) { winStatus = "ชนะ"; multiply = parsedLeg.bounce; }
                                    else if (parsedLeg.score < tempDealerResult.score) { winStatus = "เสีย"; multiply = tempDealerResult.bounce; }
                                    else { if (parsedLeg.bounce > 1 && winStatus === "ชนะ") multiply = parsedLeg.bounce; else if (tempDealerResult.bounce > 1 && winStatus === "เสีย") multiply = tempDealerResult.bounce; }

                                    let amt = pricePerLeg * multiply;
                                    if (winStatus === "ชนะ") { totalWinLose += amt; logDetails.push(`• ขา ${l} (${parsedLeg.displayScore}): ชนะ +${amt}`); }
                                    else if (winStatus === "เสีย") { totalWinLose -= amt; logDetails.push(`• ขา ${l} (${parsedLeg.displayScore}): เสีย -${amt}`); }
                                    else { logDetails.push(`• ขา ${l} (${parsedLeg.displayScore}): เสมอ +0`); }
                                });
                            }
                        });

                        user.balance += totalHoldRefund; 
                        user.balance += totalWinLose;

                        if (user.turnoverTarget && user.turnoverTarget > 0) {
                            let turnChange = Math.abs(totalWinLose);
                            user.turnoverTarget -= turnChange;
                            if (user.turnoverTarget <= 0) {
                                user.turnoverTarget = 0;
                            }
                        }

                        let userNetResultStr = totalWinLose >= 0 ? `🟢 ได้สุทธิ: +${totalWinLose}` : `🔴 เสียสุทธิ: ${totalWinLose}`;
                        let memberBillStr = `👤 **คุณ: ${user.name} (ID: ${user.memberNumber})**\n` +
                                            logDetails.join('\n') + `\n` +
                                            `📊 สรุป: ${userNetResultStr} บาท\n` +
                                            `💰 เครดิตสุทธิในกระเป๋า: ${user.balance} บาท\n`;

                        if (user.turnoverTarget && user.turnoverTarget > 0) {
                            memberBillStr += `🔒 [ติดโปรล็อกถอน] ยอดเทิร์นที่เหลือ: ${user.turnoverTarget} บาท\n`;
                        } else if (user.turnoverTarget === 0) {
                            memberBillStr += `🔓 [ปลดล็อกถอน] ทำยอดเทิร์นครบถ้วนแล้ว ถอนเงินได้ปกติครับ ✨\n`;
                        }
                        memberBillStr += `──────────────────`;
                        roundBillDetails.push(memberBillStr);
                    }

                    if (!hasAnyMemberSummary) {
                        finalReportText += "ℹ️ รอบนี้ไม่มีสมาชิกคนไหนส่งโพยค้างไว้ให้คำนวณเงินเลยครับ";
                    } else {
                        finalReportText += roundBillDetails.join('\n\n');
                    }

                    let dealerBounceStr = tempDealerResult.bounce > 1 ? `d${tempDealerResult.bounce}` : "";
                    let shortDealerCode = tempDealerResult.isPok ? `P${tempDealerResult.score}${dealerBounceStr}` : `${tempDealerResult.score}${dealerBounceStr}`;
                    matchHistory.unshift(`รอบที่ ${currentRound}: เจ้ามือ ${shortDealerCode}`);
                    if (matchHistory.length > 5) matchHistory.pop();

                    tempRoomResults = null;
                    tempDealerResult = null;
                    isDrawOpen = false;
                    roundBets = {}; 
                    
                    replyText = finalReportText;
                }
            }
            // ==================== [ 7. ระบบลงทะเบียนสมาชิกใหม่ C/ชื่อ (ไม่มีเลขอารบิกบกวน) ] ====================
            else if (originalMsg.startsWith('C/') || originalMsg.startsWith('c/')) {
                let namePart = originalMsg.substring(2).trim();
                const hasNumber = /\d/.test(namePart);

                if (namePart === "") {
                    replyText = "⚠️ รูปแบบลงทะเบียนไม่ถูกต้องครับ\nกรุณาพิมพ์: C/ชื่อเล่น หรือ ชื่อจริง ของท่าน\n(ตัวอย่าง: C/สมชาย)";
                } else if (hasNumber) {
                    replyText = "❌ ลงทะเบียนไม่สำเร็จ: ชื่อสมาชิกห้ามใส่ตัวเลขปนเด็ดขาดครับ กรุณาพิมพ์เป็นตัวอักษรเท่านั้นนะรับ";
                } else {
                    let isAlreadyRegistered = usersWallets[userId] ? true : false;
                    if (isAlreadyRegistered) {
                        const user = usersWallets[userId];
                        replyText = `ℹ️ สมาชิกท่านนี้เคยลงทะเบียนไว้แล้วครับ!\n🆔 เลขสมาชิกของคุณคือ: คนที่ ${user.memberNumber}\n👤 ชื่อที่บันทึก: คุณ ${user.name}\n💰 ยอดเงินคงเหลือ: ${user.balance} บาท`;
                    } else {
                        let assignedId = nextMemberId++;
                        usersWallets[userId] = {
                            memberNumber: assignedId,
                            name: namePart,
                            balance: 0,
                            turnoverTarget: 0,
                            isWithdrawLocked: false,
                            pendingWithdrawAmount: 0,
                            registerTime: new Date().toLocaleDateString('th-TH')
                        };

                        replyText = `🎉 ยินดีด้วยครับ! คุณลงทะเบียนเปิดระบบกระเป๋าเครดิตสำเร็จแล้ว 🎉\n\n` +
                                    `🆔 สมาชิกคนที่: ${assignedId}\n` +
                                    `👤 ชื่อของคุณ: คุณ ${namePart}\n` +
                                    `💰 เครดิตเริ่มต้น: 0 บาท\n` +
                                    `⚙️ สถานะกระเป๋า: เปิดใช้งานพร้อมเล่นคาสิโนออนไลน์แล้วครับ`;
                    }
                }
            }
            // ==================== [ 11. ระบบกดเช็กข้อมูลเครดิต สมาชิกพิมพ์คำว่า "C" หรือ "c" ] ====================
            else if (userMsg === 'c') {
                const isRegistered = usersWallets[userId] ? true : false;
                if (!isRegistered) {
                    replyText = `📢 ยินดีต้อนรับครับ!\n\n⚠️ บัญชี LINE ของคุณยังไม่ได้ลงทะเบียนสมาชิกในคาสิโน\nกรุณาพิมพ์: C/ชื่อเล่น ของคุณเพื่อเปิดกระเป๋าเงินก่อนนะครับ (ตัวอย่าง: C/เฮงเฮง)`;
                } else {
                    const user = usersWallets[userId];
                    let memberInfo = `💳 **[ การ์ดข้อมูลส่วนบุคคลของสมาชิก ]** 💳\n\n` +
                                      `🆔 เลขสมาชิกของคุณ: คนที่ ${user.memberNumber}\n` +
                                      `👤 ชื่อสมาชิก: คุณ ${user.name}\n` +
                                      `💰 เครดิตคงเหลือ: ${user.balance} บาท\n`;

                    if (user.turnoverTarget && user.turnoverTarget > 0) {
                        memberInfo += `🔒 **สถานะกระเป๋า:** ติดโปรโบนัส (ล็อกถอน)\n` +
                                      `🎯 ยอดเทิร์นที่ต้องทำเพิ่ม: ${user.turnoverTarget} บาท\n`;
                    } else {
                        memberInfo += `🔓 **สถานะกระเป๋า:** ปกติ (ถอนเงินได้ทันที)\n`;
                    }

                    if (user.isWithdrawLocked) {
                        memberInfo += `⏳ **รายการถอนเงินค้าง:** รอแอดมินโอนเงินจำนวน ${user.pendingWithdrawAmount} บาท\n`;
                    }

                    memberInfo += `\n──────────────────\n` +
                                  `📖 *คู่มือช่วยเหลือสมาชิก:*\n` +
                                  `👉 พิมพ์ **คส** เพื่อดูคำสั่งทั้งหมด\n` +
                                  `👉 พิมพ์ **บช** หรือ **/บช** เพื่อดูเลขบัญชี\n` +
                                  `👉 พิมพ์ **กต** เพื่ออ่านกติกาห้อง`;

                    replyText = memberInfo;                    
                }
            } // ปิดระบบลงทะเบียนสำเร็จ

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
app.listen(process.env.PORT || 3000, () => { console.log('เซิร์ฟเวอร์ป๊อกเด้งรันเสถียรแล้วครับ'); });
