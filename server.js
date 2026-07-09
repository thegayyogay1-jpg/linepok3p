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
let detailedRoundHistory = {}; // ตัวแปรเก็บข้อมูลสำหรับแอดมินดึงย้อนหลัง
let pastRoundsData = {}; //  ถังเก็บประวัติโพยและผลไพ่แยกรายรอบ (สำหรับดึง v,m)
let withdrawQueue = []; // 📦 ถังสำหรับเก็บคิวสมาชิกที่แจ้งถอนเงิน

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
                                replyText = `💰 เติมเครดิตสมาชิกที่ ${user.memberNumber} \n คุณ ${user.name} +${amount} สำเร็จ!\n──────────────────\nยอดสุทธิ: ${user.balance} บาท`;
                            } else if (command === "ลบ") {
                                usersWallets[foundUserKey].balance -= amount;
                                const user = usersWallets[foundUserKey];
                                replyText = `🚨 ลบยอดเครดิตสมาชิกที่ ${user.memberNumber} \n คุณ ${user.name} -${amount}!\n──────────────────\nยอดปัจจุบัน: ${user.balance} บาท`;
                            }
                        }
                    }
                }
            }
                // ==================== [ ระบบเติมเงินแบบติดโปรโบนัสคูณ 10 (B เลขสมาชิก จำนวนเงิน) ] ====================
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

                            replyText = `🎁 เติมโบนัสให้สมาชิกที่ [ ${user.memberNumber} ] \n คุณ ${user.name} สำเร็จ!\n──────────────────\n` +
                                        `💰 ยอดสุทธิ: +${amount} บาท\n──────────────────\n` +
                                        `🔒 เงื่อนไข ต้องทำยอดเทิร์นสะสม (ได้/เสีย) ให้ครบ: ${user.turnoverTarget} บาท`;
                        }
                    }
                }
            }
                else if (userMsg.startsWith('bb')) {
                const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";
                if (userId !== ADMIN_ID) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    // แกะเอาเฉพาะตัวเลขสมาชิกออกมา (ตัดคำว่า bb และลบช่องว่างออก)
                    const targetMemberId = parseInt(userMsg.replace('bb', '').trim());
                    
                    if (isNaN(targetMemberId)) {
                        replyText = `⚠️ รูปแบบคำสั่งไม่ถูกต้อง\nกรุณาพิมพ์: bbตามด้วยเลขสมาชิก\n(ตัวอย่างเช่น: bb1)`;
                    } else {
                        let targetUserId = null;
                        // ค้นหา ID ผู้ใช้งานในระบบผ่าน memberNumber
                        for (let id in usersWallets) {
                            if (usersWallets[id].memberNumber === targetMemberId) {
                                targetUserId = id;
                                break;
                            }
                        }

                        if (targetUserId) {
                            // 🔓 ทำการรีเซ็ตยอดเทิร์นเป้าหมายและจำนวนเทิร์นที่นับได้ให้กลายเป็น 0 ทันที
                            usersWallets[targetUserId].turnoverTarget = 0;
                            usersWallets[targetUserId].turnoverCount = 0;
                            
                            replyText = `🔓 ล้างยอดเทิร์นสำเร็จ!\n👤 สมาชิกคนที่: ${targetMemberId}\n👤 ชื่อ: ${usersWallets[targetUserId].name}\n\n✨ สถานะปัจจุบัน: ปกติ (ถอนเงินได้เลยไม่ติดโปร)`;
                        } else {
                            replyText = `❌ ไม่พบข้อมูลสมาชิกคนที่ ${targetMemberId} ในระบบครับ`;
                        }
                    }
                }
            }
                // ==================== [ คำสั่งแอดมิน: ชถ (เช็กรายการรอถอนเงินทั้งหมด) ] ====================
            else if (userMsg.trim() === 'ชถ') {
                const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";
                if (userId !== ADMIN_ID) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    if (withdrawQueue.length === 0) {
                        replyText = "🎉 [ระบบคิวถอน] ไม่มีรายการค้างถอนในขณะนี้ครับ! สบายใจได้";
                    } else {
                        let queueText = "📋 [รายการรอถอนเงินทั้งหมด] 📋\n(เรียงตามลำดับก่อน-หลัง)\n────────────────\n";
                        
                        withdrawQueue.forEach((item, index) => {
                            queueText += `${index + 1}. 👤 สมาชิกคนที่: ${item.memberNumber}\n`;
                            queueText += `   📛 ชื่อ: คุณ ${item.name}\n`;
                            queueText += `   💰 ยอดถอน: ${item.amount} บาท\n`;
                            queueText += `   🕒 เวลา: ${item.time} น.\n────────────────\n`;
                        });
                        
                        queueText += `📌 รวมทั้งหมด: ${withdrawQueue.length} รายการค้างถอน\n💡 วิธีเคลียร์คิว: พิมพ์ "y เลขสมาชิก" (เช่น: y 1 หรือโอนพร้อมกันหลายคนพิมพ์: y 1 3 5)`;
                        replyText = queueText;
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
                replyText = `⚠️ ตอนนี้ระบบกำลังเปิด "รอบที่ ${currentRound}" อยู่แล้วครับ`;
            } 
            // 🚨 [แก้ไขจุดบั๊ก] เช็กเพียงแค่ว่าถ้ารอบจั่วยังเปิดค้างอยู่ (isDrawOpen === true) เท่านั้นค่อยบล็อก
            else if (isDrawOpen) { 
            replyText = `❌ ไม่สามารถเปิดรอบใหม่ได้ครับ!\nเนื่องจาก "รอบที่ ${currentRound}" ยังดำเนินรายการจั่วไพ่ไม่เสร็จสิ้น\n\n💡 หากต้องการเปิดรอบจั่ว ให้พิมพ์ oo\n💡 หากต้องการจบขั้นตอนจั่ว ให้พิมพ์ xx ก่อนครับ`;
            } else {
                            currentRound++;
                            isRoundOpen = true;
                            roundBets = {}; // ล้างข้อมูลโพยเก่าออกเพื่อเริ่มรอบใหม่
                            
                            // --- สร้างข้อความสถิติย้อนหลังแบบแยกขา ---
                            let historyText = "";
                            if (matchHistory.length > 0) {
                                historyText = `📈 สถิติผลเจ้ามือ 5 รอบล่าสุด:\n──────────────────\n`;
                                matchHistory.forEach((h) => {
                                    historyText += `${h}\n──────────────────\n`;
                                });
                            } else {
                                historyText = `📈 สถิติย้อนหลัง: ยังไม่มีข้อมูล`;
                            }

                            replyText = `📢 เริ่มเปิดรอบแทงแล้วครับ!\n🎰 รอบที่: ${currentRound}\n──────────────────\n${historyText}✨ สมาชิกสามารถส่งโพยเข้ามาได้เลยครับครับ 🎰`;
                        }
        } else if (userMsg === 'x') {
                        if (!isRoundOpen) {
                            replyText = `⚠️ ระบบปิดรอบแทงอยู่แล้วครับ ไม่สามารถปิดซ้ำได้`;
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

                                betSummaryText += `• [ ${user.memberNumber} ] ${user.name} ➡️ ยอดแทง: ${userTotalBetAmt} บาท`;
                            }
                            let closingBetSection = "";
                            if (hasAnyBet) {
                                closingBetSection = `📝 สรุปยอดแทงประจำรอบ\n──────────────────\n${betSummaryText}\n──────────────────`;
                            } else {
                                closingBetSection = `📝 สรุปยอดแทงประจำรอบ\n──────────────────\n• ไม่มีสมาชิกส่งโพยเดิมพันในรอบนี้`;
                            }

                            replyText = `🚫ปิดรอบแทงเรียบร้อยแล้วครับ\n🏁 จบรอบที่: ${currentRound}\n──────────────────\n${closingBetSection}\n🔒 หยุดรับโพยทุกกรณี รอแอดมินสรุปผลสักครู่ครับ`;
                        }
                    } else if (userMsg === 'rst') {
            currentRound = 0;
            isRoundOpen = false;
            isDrawOpen = false; // ล้างสถานะจั่วไปด้วยเลยตอนเซ็ตศูนย์
            roundBets = {};
            replyText = "🔄 ทำการล้างลำดับรอบเรียบร้อยแล้ว! รอบต่อไปจะเริ่มต้นที่ รอบที่ 1 ครับ ⚙️";
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
                            replyText = `⚠️ ตอนนี้ระบบกำลังเปิด "รอบขอจั่วไพ่ใบที่ 3" อยู่แล้วครับ ไม่จำเป็นต้องเปิดซ้ำครับ`;
                        } else {
                            isDrawOpen = true; // เปิดสิทธิ์ให้บอทรับคำสั่งเครื่องหมาย + จากสมาชิก
                            replyText = `🃏 เปิดรอบขอจั่วไพ่ใบที่ 3 (รอบที่ ${currentRound})\n──────────────────\n📢 หากต้องการจั่วเพิ่ม ให้พิมพ์เลขขาตามด้วย + เช่น พิมพ์ "1+" หรือ "12+" \n──────────────────\n⚠️หากขาไหนต้องการอยู่ (ไม่จั่ว) ไม่ต้องพิมพ์อะไรส่งมาครับ`;
                        }
                    } 
                    // 🔴 [ฝั่งปิดรอบจั่ว xx + สรุปรายละเอียดรายบุคคล]
                    else if (userMsg === 'xx') {
                        if (!isDrawOpen) {
                            replyText = "⚠️ ระบบปิดรอบจั่วไพ่อยู่แล้วครับ ไม่สามารถปิดซ้ำได้";
                        } else {
                            // 1. ปิดระบบรับรอบจั่วทันที
                            isDrawOpen = false;

                            // 2. เริ่มสร้างกล่องข้อความสรุปรายขาของสมาชิกทุกคนในรอบนี้
                            let summaryLegsText = `🔒 ปิดรอบขอจั่วไพ่เรียบร้อยแล้วครับ\n` +
                                                  `🎰 ล็อกสถานะไพ่ 2 ใบ/ 3 ใบของทุกขาแล้ว รอสรุปผลและคิดเงินสักครู่ครับ\n` +
                                                  `──────────────────\n` +
                                                  `📋รายงานสรุปโพยและยอดแทงในรอบนี้\n`+
                                                  `──────────────────\n`;

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
                                    summaryLegsText += `👤 คุณ: ${user.name} (ID: ${user.memberNumber})\n` +
                                                       `👉 แทงขา: [ ${legsStr} ]\n` +
                                                       `🃏 ขอจั่วเพิ่มขา: [ ${drawStr} ]\n` +
                                                       `💰 ยอดเล่นรวม: ${totalRealPlay} บาท (รวมค้ำเด้ง: ${totalWithBounce} บาท)\n` +
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
                    replyText = "🚫 ตอนนี้ระบบปิดรับโพยชั่วคราวครับ กรุณารอแอดมินเปิดรอบใหม่";
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

                            let summaryText = `✅ บันทึกโพยและหักค้ำประกัน 3 เด้งเรียบร้อย 🎉\n──────────────────\n👤 คุณ: ${user.name} (ID: ${user.memberNumber})\n──────────────────\n📝 รายการแทง\n──────────────────\n`;
                            
                            processedBets.forEach((bet) => {
                                summaryText += `• ${bet.detail}`;
                                
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
                            summaryText += `\n──────────────────\n💵 ยอดแทงรวม: ${totalActualBet} บาท\n🔒 หักค้ำประกันรวม (x3): ${totalHoldCost} บาท\n💰 เครดิตคงเหลือ: ${user.balance} บาท\n──────────────────\n 🔔หากแพ้ไม่เกิน 3 เด้ง ระบบจะคืนเครดิตส่วนต่างให้ตอนสรุปผลครับ`;
                            replyText = summaryText;
                        }
                    }
                }
            }
            // ==================== [ 5. ระบบคืนโพย / ยกเลิกโพยในรอบ ] ====================
            else if (userMsg === "r") {
                if (!isRoundOpen) {
                    replyText = "🚫 ไม่สามารถคืนโพยได้ครับ เนื่องจากปิดรอบแทงเรียบร้อยแล้ว";
                } else {
                    const isRegistered = usersWallets[userId] ? true : false;
                    if (!isRegistered) {
                        replyText = `📢 คุณยังไม่ได้ลงทะเบียนสมาชิกในระบบครับ`;
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
                    replyText = "⚠️ ระบบยังไม่ได้เปิดรอบจั่วไพ่ใบที่ 3 หรือ แอดมินปิดรอบจั่วไปแล้วครับ";
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
                            replyText = `🃏 สมาชิกคุณ ${user.name} (ID: ${user.memberNumber})\n──────────────────\nจั่วไพ่เพิ่มที่ ➡️ ขา: ${sortedLegs} `;
                        } else {
                            // ถ้าคนนั้นมีแต่โพยฝั่งเจ้ามืออย่างเดียว บอทจะแจ้งเตือนตัดสิทธิ์ทันที
                            replyText = "⚠️ คำสั่งไม่ทำงาน: เนื่องจากคุณแทงฝั่งเจ้ามือไว้ โพยฝั่งเจ้ามือไม่สามารถขอจั่วไพ่ได้ครับ";
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

            if (clean === 't') { rawScore = 700; multiplier = 5; typeName = "ตอง"; } 
            else if (clean === 'sf') { rawScore = 600; multiplier = 5; typeName = "สเตฟฟลัช"; } 
            else if (clean === 'h') { rawScore = 500; multiplier = 3; typeName = "เซียน/3เหลือง"; } 
            else if (clean === 's') { rawScore = 400; multiplier = 3; typeName = "เรียง"; } 
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
        let checkText = `📊 ตรวจสอบผลการเล่น รอบที่: ${currentRound}\n──────────────────\n`;
        checkText += `👑 เจ้ามือ: ${dealerResult.name} (${dealerResult.mult} เด้ง)\n──────────────────\n`;
        checkText += `📝 ลำดับหน้าไพ่และผลแพ้ชนะ:\n──────────────────\n`;

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
                checkText += `   - [2ใบ]: ${res.twoCards.name} (${res.twoCards.mult}เด้ง) ${status2Str}\n`;
                checkText += `   - [3ใบ]: ${res.threeCards.name} (${res.threeCards.mult}เด้ง) ${status3Str}\n──────────────────\n`;
            } else {
                checkText += `• ขา ${leg} -> ⚠️ ไม่มีผลไพ่ (ระบบตีเป็นบอด แพ้เจ้ามือ 🔴)\n`;
            }
        }
        
        checkText += `🚨 กรุณาตรวจเช็คผลที่ส่ง\n หากข้อมูลถูกต้อง ให้พิมพ์: ok\nหากพิมพ์ผิดให้พิมพ์: no`;
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
            let summaryPayoutText = `💰 สรุปยอดได้/เสีย รอบที่: ${currentRound}\n──────────────────\n`;
            summaryPayoutText += `👑 เจ้ามือ: ${tempDealerResult.name}\n──────────────────\n`;
            
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
                                if (loseMultiplier > 3) {
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

                // 📊 [ระบบคำนวณและหักยอดเทิร์นอัตโนมัติ]
                if (user.turnoverTarget > 0 && userTotalWinLoss !== 0) {
                    // คิดยอดที่มีผลได้เสียจริง (ชนะหรือแพ้กี่บาทก็นับเป็นยอดเทิร์นทั้งหมด / ส่วนผลเสมอจะเป็น 0 ไม่นับ)
                    let currentTurnoverMade = Math.abs(userTotalWinLoss); 
                    
                    // หักลบยอดเทิร์นค้าง
                    user.turnoverTarget -= currentTurnoverMade;
                    if (user.turnoverTarget < 0) user.turnoverTarget = 0; // ถ้าเล่นเกินเป้าแล้วให้เซ็ตเป็น 0 (ปลดล็อก)
                }

                let sign = userTotalWinLoss > 0 ? "🟢 +" : (userTotalWinLoss < 0 ? "🔴 " : "🟡 ");
                
                // ตรวจสอบว่าในรอบนี้ยูสเซอร์แทงฝั่งเจ้ามือหรือไม่ เพื่อความสวยงามในการแสดงข้อความท้ายรายงาน
                let isUserBettingOnDealer = userBetsArray.some(b => b.betType === "มจ" || b.betType.startsWith('จ'));
                let feeNote = (isUserBettingOnDealer && userTotalWinLoss !== 0) ? " \n(หักต๋งขาเจ้ามือที่ชนะแล้ว)" : "";
                
                let turnNote = user.turnoverTarget > 0 ? ` ⚠️ (เหลือเทิร์น: ${user.turnoverTarget} บ.)` : " 🟢 (เทิร์นครบแล้ว)";
                summaryPayoutText += `👤 ${user.name} (ID: ${user.memberNumber})\n  ยอดสุทธิ: ${sign}${userTotalWinLoss} บาท${feeNote}\n เครดิตคงเหลือ: ${user.balance} บ.\n──────────────────\n`;
            } // ปิดลูป for (let uId in roundBets)

            if (!hasAnyBet) {
                summaryPayoutText += "📝 รอบนี้ไม่มีสมาชิกส่งโพยเดิมพันเข้ามาครับ\n";
            }

            summaryPayoutText += `✨ ระบบได้ทำการคำนวณเงินและอัปเดตกระเป๋าเงินให้ทุกคนเรียบร้อยแล้วครับ 🏁`;
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

            // 💾 [ฝังชิปแอบจำ] วางอยู่ตรงนี้ ก่อนโดนเคลียร์ค่า!
            pastRoundsData[currentRound] = {
                dealer: JSON.parse(JSON.stringify(tempDealerResult)),
                rooms: JSON.parse(JSON.stringify(tempRoomResults)),
                bets: JSON.parse(JSON.stringify(roundBets))
            };
            
            // 💾 [เพิ่มคำสั่งนี้] บันทึกรายงานสรุปยอดของรอบปัจจุบันเก็บไว้ในระบบก่อนล้างสมองบอท
            detailedRoundHistory[currentRound] = summaryPayoutText;

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
                                `🔹 **C** ➡️ เช็กเลขสมาชิก ยอดเครดิต และสลิปโพยค้าง + เลขบัญชี\n` +
                                `🔹 **บช** ➡️ ดูเลขบัญชีธนาคารสำหรับเติมเงิน\n` +
                                `🔹 **[เลขขา]-[จำนวนเงิน]** ➡️ ส่งโพยเดิมพัน (เช่น 123-100)\n` +
                                `🔹 **มข-[จำนวนเงิน]** ➡️ แทงเหมาหมดทุกขา ขาละเท่าๆ กัน\n` +
                                `🔹 **มจ-[จำนวนเงิน]** ➡️ แทงเจ้ามือชนผู้เล่นทุกขา ขาละเท่าๆ กัน\n` +
                                `🔹 **R** ➡️ ขอดึงโพยคืน/ยกเลิกโพยทั้งหมดในรอบนั้น (ตอนเปิดแทง)\n` +
                                `🔹 **[เลขขา]+** ➡️ ขอจั่วไพ่ใบที่ 3 เพิ่มเติม (เฉพาะขาผู้เล่นปกติ)\n\n` +
                                `💡 *หมายเหตุ: ทุกคำสั่งสามารถพิมพ์ได้ทั้งตัวพิมพ์เล็กและตัวพิมพ์ใหญ่ครับ*`;
                } 
                else if (userMsg === 'กต') {
                    replyText = `💡 สมาชิกพิมพ์ "คส" เพื่อดูวิธีการส่งโพยและคำสั่งอื่นๆ`;
                }
                else if (userMsg === 'บช' || userMsg === '/บช') {
                    // 🏦 บล็อกข้อความตอบกลับเรื่องบัญชีธนาคารโดยเฉพาะ
                    replyText = `🏦 **[ ช่องทางการโอนเงินเติมเครดิต ]** 🏦\n\n` +
                                `🔹 **ธนาคาร:** กสิกรไทย (KBank)\n` +
                                `🔹 **เลขบัญชี:** 037-1556-125\n` +
                                `🔹 **ชื่อบัญชี:** นาย ภาณุวัฒก์ ก้องกุล\n\n` +
                                `⚠️ **ข้อควรระวัง:**\n` +
                                `เมื่อโอนเงินเสร็จแล้ว กรุณาส่งสลิปหลักฐานเข้ามาในแชทนี้ เพื่อให้แอดมินเติมยอดเครดิตให้ครับ 🎉`;
                }
            }
                // ==================== [ ระบบดึงโพยและผลไพ่ย้อนหลังรายบุคคล (vรอบ,mสมาชิก) ] ====================
            else if (userMsg.startsWith('v') && userMsg.includes(',m')) {
                // แยกข้อความด้วยเครื่องหมายจุลภาค (,)
                const parts = userMsg.split(',');
                const roundTarget = parseInt(parts[0].replace('v', '')); // ดึงเลขรอบ เช่น v12 -> 12
                const memberTarget = parseInt(parts[1].replace('m', '')); // ดึงเลขสมาชิก เช่น m5 -> 5

                if (isNaN(roundTarget) || isNaN(memberTarget)) {
                    replyText = "⚠️ รูปแบบคำสั่งไม่ถูกต้องครับน้า\nกรุณาพิมพ์ เช่น v12,m5 (เพื่อดูรอบที่ 12 ของสมาชิกคนที่ 5)";
                } else if (!pastRoundsData[roundTarget]) {
                    replyText = `❌ ไม่พบข้อมูลการเล่นของ "รอบที่ ${roundTarget}" ในระบบครับ (อาจจะเป็นรอบเก่าก่อนระบบเปิด หรือเซิร์ฟเวอร์เพิ่งรีสตาร์ท)`;
                } else {
                    const historicalRound = pastRoundsData[roundTarget];
                    const historicalDealer = historicalRound.dealer;
                    const historicalRooms = historicalRound.rooms;
                    const historicalBets = historicalRound.bets;

                    // 1. ค้นหาหาชื่อและข้อมูลของสมาชิกคนนี้จากข้อมูลที่บันทึกไว้ในรอบนั้น
                    let targetUid = null;
                    for (let uid in historicalBets) {
                        if (historicalBets[uid][0] && historicalBets[uid][0].memberNumber === memberTarget) {
                            targetUid = uid;
                            break;
                        }
                    }

                    if (!targetUid || !historicalBets[targetUid] || historicalBets[targetUid].length === 0) {
                        replyText = `❌ ไม่พบโพยเดิมพันของ สมาชิกคนที่ ${memberTarget} ในรอบที่ ${roundTarget} ครับ`;
                    } else {
                        const userBets = historicalBets[targetUid];
                        const userName = userBets[0].name;

                        // 2. สร้างหัวข้อรายงานผลไพ่รวมของรอบนั้น
                        let reportText = `🔍 ดึงข้อมูลโพยรายบุคคลย้อนหลัง\n──────────────────\n`;
                        reportText += `🎬 รอบที่: ${roundTarget} \n สมาชิกคนที่ ${memberTarget} (${userName})\n `;
                        reportText += `──────────────────\n`;
                        reportText += `👑 เจ้ามือ: ${historicalDealer.name} (${historicalDealer.mult} เด้ง)\n──────────────────\n`;
                        reportText += `📝 ผลไพ่กระดานรอบที่ ${roundTarget} \n──────────────────\n`;

                        // ลูปพ่นผลไพ่ทั้ง 6 ขาของรอบนั้น
                        for (let leg = 1; leg <= 6; leg++) {
                            if (historicalRooms[leg]) {
                                const res = historicalRooms[leg];
                                let s2 = res.twoCards.score > historicalDealer.score ? "🟢 ชนะ" : (res.twoCards.score < historicalDealer.score ? "🔴 แพ้" : "🟡 เสมอ");
                                let s3 = res.threeCards.score > historicalDealer.score ? "🟢 ชนะ" : (res.threeCards.score < historicalDealer.score ? "🔴 แพ้" : "🟡 เสมor");
                                
                                reportText += `• ขา ${leg}:\n`;
                                reportText += `   - [2ใบ]: ${res.twoCards.name} (${res.twoCards.mult}เด้ง) ${s2}\n`;
                                reportText += `   - [3ใบ]: ${res.threeCards.name} (${res.threeCards.mult}เด้ง) ${s3}\n──────────────────\n`;
                            } else {
                                reportText += `• ขา ${leg} -> ⚠️ ไม่มีผลไพ่ (🔴 แพ้เจ้ามือ)\n`;
                            }
                        }

                        reportText += `📋 โพยรอบนี้ของคุณ \n ${userName} \n──────────────────\n`;

                        let totalWinLoss = 0;
                        let detailRows = "";

                        // 3. เจาะลึกวิเคราะห์โพยและคิดเงินย้อนหลังเพื่อโชว์หลักฐานมัดตัว
                        userBets.forEach((bet) => {
                            let legsToCalc = [];
                            if (bet.betType === "มข" || bet.betType === "มจ") {
                                legsToCalc = ['1', '2', '3', '4', '5', '6'];
                            } else if (bet.betType.startsWith('จ')) {
                                legsToCalc = bet.betType.substring(1).split('');
                            } else {
                                legsToCalc = bet.betType.split('');
                            }

                            // แตกโพยรายบรรทัดส่งโชว์
                            reportText += `- แทงขา [${legsToCalc.join(', ')}] ขาละ ${bet.pricePerLeg} บาท\n`;
                            
                            let drawLegs = [];
                            if (bet.drawStatus) {
                                for (let l in bet.drawStatus) {
                                    if (bet.drawStatus[l] === "จั่ว") drawLegs.push(l);
                                }
                            }
                            if (drawLegs.length > 0) {
                                reportText += `- ขอจั่วเพิ่มขา: [${drawLegs.sort().join(', ')}]\n`;
                            }

                            // คำนวณสรุปรายขาแบบเรียลไทม์เพื่อทำป้ายสรุป
                            legsToCalc.forEach((legStr) => {
                                const legNum = parseInt(legStr);
                                const matchResult = historicalRooms[legNum];
                                if (!matchResult) return;

                                const isBettingOnDealer = (bet.betType === "มจ" || bet.betType.startsWith('จ'));
                                let finalCard;
                                let statusAction = "[อยู่]";

                                if (!isBettingOnDealer) {
                                    const isUserDrawn = (bet.drawStatus && bet.drawStatus[legStr] === "จั่ว");
                                    finalCard = isUserDrawn ? matchResult.threeCards : matchResult.twoCards;
                                    if (isUserDrawn) statusAction = "[จั่ว]";

                                    if (finalCard.score > historicalDealer.score) {
                                        let profit = bet.pricePerLeg * finalCard.mult;
                                        totalWinLoss += profit;
                                        detailRows += `ขาที่ ${legStr} ${statusAction} ชนะ +${profit}\n`;
                                    } else if (finalCard.score < historicalDealer.score) {
                                        let loseMultiplier = historicalDealer.mult;
                                        if (loseMultiplier > 3) {
                                            loseMultiplier = 3;
                                        }        
                                        let loss = bet.pricePerLeg * loseMultiplier;
                                        totalWinLoss -= loss;
                                        detailRows += `ขาที่ ${legStr} ${statusAction} แพ้ -${loss}\n`;
                                    } else {
                                        detailRows += `ขาที่ ${legStr} ${statusAction} เสมอ +0\n`;
                                    }
                                } else {
                                    // สำหรับกรณีแทงฝั่งเจ้ามือ
                                    if (matchResult.twoCards.score <= 4 && matchResult.twoCards.mult === 1) {
                                        finalCard = matchResult.threeCards;
                                        statusAction = "[ชน3ใบ]";
                                    } else {
                                        finalCard = matchResult.twoCards;
                                        statusAction = "[ชน2ใบ]";
                                    }

                                    if (historicalDealer.score > finalCard.score) {
                                        let grossWin = bet.pricePerLeg * historicalDealer.mult;
                                        let netWin = Math.floor(grossWin * 0.9);
                                        totalWinLoss += netWin;
                                        detailRows += `ขาที่ ${legStr} ${statusAction} เจ้าชนะ +${netWin} (หักต๋งแล้ว)\n`;
                                    } else if (historicalDealer.score < finalCard.score) {
                                        let loss = bet.pricePerLeg * finalCard.mult;
                                        totalWinLoss -= loss;
                                        detailRows += `ขาที่ ${legStr} ${statusAction} เจ้าแพ้ -${loss}\n`;
                                    } else {
                                        detailRows += `ขาที่ ${legStr} ${statusAction} เสมอ +0\n`;
                                    }
                                }
                            });
                        });

                        // 4. ประกอบร่างข้อความสรุปท้ายกระดาษ
                        let signStr = totalWinLoss > 0 ? `กำไร +${totalWinLoss}` : (totalWinLoss < 0 ? `ขาดทุน ${totalWinLoss}` : `เสมอตัว +0`);
                        reportText += `──────────────────\n📊 สรุปดีเทลการเล่น \n──────────────────\n${detailRows}`;
                        reportText += `──────────────────\n👉 ยอดกำไร/ขาดทุนในรอบนี้: ${signStr} บาท`;                   

                        replyText = reportText;
                    }
                }
            }
                // ==================== [ ระบบสมาชิกแจ้งถอนเงิน - รูปแบบพิมติดกัน (ถอน500) ] ====================
            else if (userMsg.startsWith('ถอน')) {
                const user = usersWallets[userId];
                
                if (!user) {
                    replyText = "⚠️ คุณยังไม่ได้ลงทะเบียนสมาชิกในระบบครับ";
                } 
                else if (user.isWithdrawLocked) {
                    replyText = `❌ ไม่สามารถทำรายการซ้ำได้ครับ!\n👤 คุณ ${user.name} มีรายการแจ้งถอนค้างอยู่จำนวน ${user.pendingWithdrawAmount} บาท อยู่ในระหว่างรอแอดมินอนุมัติครับ`;
                } 
                else if (user.turnoverTarget > 0) {
                    replyText = `❌ ไม่สามารถแจ้งถอนเงินได้ครับน้า!\n👤 คุณ: ${user.name} (ID: ${user.memberNumber})\n\n🚨 เนื่องจากคุณเลือกรับโบนัสและยังทำยอดเทิร์นไม่ครบ\n📉 ยอดเทิร์นคงค้างที่ต้องเล่นเพิ่มอีก: ${user.turnoverTarget} บาท จึงจะถอนเงินได้ครับ`;
                }
                else {
                    // 🔍 ดึงตัวเลขทั้งหมดที่ต่อท้ายคำว่า "ถอน" ออกมาโดยตรง (พิมพ์ ถอน500 หรือ ถอน 500 ก็ดึงได้หมด)
                    const withdrawAmount = parseInt(userMsg.replace('ถอน', '').trim());

                    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
                        replyText = "⚠️ รูปแบบคำสั่งไม่ถูกต้องครับ กรุณาพิมพ์ระบุจำนวนเงิน เช่น ถอน500";
                    } else if (user.balance < withdrawAmount) {
                        replyText = `❌ แจ้งถอนล้มเหลว: ยอดเครดิตของคุณมีไม่เพียงพอครับ (เครดิตปัจจุบัน: ${user.balance} บาท)`;
                    } else {
                        // 🔒 สั่งล็อกสถานะบัญชี และจำยอดเงินที่ต้องการถอนไว้ (ยังไม่หักเครดิตจริง)
                        user.isWithdrawLocked = true;
                        user.pendingWithdrawAmount = withdrawAmount;

                        // 💡 [วางโค้ดที่นี่] เพิ่มเข้าคิวตามที่แจ้งมาครับ
            withdrawQueue.push({ 
                memberNumber: user.memberNumber, 
                name: user.name, 
                amount: withdrawAmount, // ดึงจากตัวแปร withdrawAmount ที่เช็กผ่านแล้ว
                time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) 
            });
                        
                        replyText = `⏳ [ระบบรับเรื่องแจ้งถอน] ⏳\n` +
                                    `👤 คุณ: ${user.name} (ID: ${user.memberNumber})\n` +
                                    `💰 ยอดที่แจ้งถอน: ${withdrawAmount} บาท\n` +
                                    `──────────────────\n` +
                                    `⚠️ **สถานะบัญชี:** บัญชีของคุณถูกล็อกชั่วคราว! ระหว่างนี้จะไม่สามารถส่งโพยแทง หรือแจ้งถอนซ้ำได้ จนกว่าแอดมินจะกดยืนยันยอดโอนสำเร็จครับ\n\n` +
                                    `📢 @Admin มีรายการแจ้งถอนเงินจาก ID: ${user.memberNumber} กรุณาตรวจสอบและอนุมัติพิมพ์: y ${user.memberNumber}`;
                    }
                }
            }
                // ==================== [ ระบบแอดมินอนุมัติการถอนเงิน (y เลขสมาชิก แบบคนเดียว หรือ หลายคนพร้อมกัน) ] ====================
else if (command.toLowerCase() === "y") {
    const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";
    if (userId !== ADMIN_ID) {
        replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งอนุมัติยอดถอนเงินครับ";
    } else {
        // 🎯 ดึงเลขสมาชิกทั้งหมดจากตัวแปร args (เช่น พิมพ์ "y 1 2" -> args จะได้ ['1', '2'])
        // แต่ถ้าแอดมินพิมพ์แค่ "y" ลอยๆ args ตัวแรกสุด (args[0]) อาจจะเป็นคำว่า y ให้ข้ามไปเอาตัวถัดไป
        let targetMemberIds = args.map(id => parseInt(id)).filter(id => !isNaN(id));
        
        // ถ้าพิมพ์ y 1 แล้ว args ดึงมาได้เลขเลย ให้ใช้ได้เลย แต่ถ้าไม่มีเลข ลองแกะจากข้อความเต็ม (userMsg) เผื่อไว้
        if (targetMemberIds.length === 0) {
            targetMemberIds = userMsg.replace(/y|Y/, '').trim().split(/\s+/).map(id => parseInt(id)).filter(id => !isNaN(id));
        }

        if (targetMemberIds.length === 0) {
            replyText = "⚠️ รูปแบบคำสั่งไม่ถูกต้อง กรุณาพิมพ์: y ตามด้วยเลขสมาชิก\n(ตัวอย่างเช่น: Y 1 หรือโอนพร้อมกันหลายคนพิมพ์: Y 1 2 3)";
        } else {
            let successReports = [];
            let errorReports = [];

            // วนลูปประมวลผลเลขสมาชิกทุกคนที่ส่งมาพร้อมกัน
            for (let targetMemberId of targetMemberIds) {
                let foundUserKey = null;
                for (let key in usersWallets) {
                    if (usersWallets[key].memberNumber === targetMemberId) {
                        foundUserKey = key;
                        break;
                    }
                }

                if (!foundUserKey) {
                    errorReports.push(`❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับ`);
                } else {
                    const user = usersWallets[foundUserKey];
                    
                    if (!user.isWithdrawLocked) {
                        errorReports.push(`⚠️ สมาชิก ID: ${targetMemberId} คุณ ${user.name} ไม่ได้มียอดแจ้งถอนค้างไว้ครับ`);
                    } else {
                        const finalAmount = user.pendingWithdrawAmount;
                        
                        // ✅ 1. ทำการหักเงินเครดิตจริงออกจากกระเป๋า
                        user.balance -= finalAmount;
                        
                        // 🔓 2. ทำการปลดล็อกบัญชีให้ส่งโพยใหม่ได้ตามปกติ
                        user.isWithdrawLocked = false;
                        user.pendingWithdrawAmount = 0;

                        // 🗑️ 3. ลบสมาชิกคนนี้ออกจากคิวรอถอน (withdrawQueue) ทันที ยอดใน "ชถ" จะหายไป
                        if (typeof withdrawQueue !== 'undefined') {
                            withdrawQueue = withdrawQueue.filter(item => item.memberNumber !== targetMemberId);
                        }

                        // เก็บข้อความสำเร็จของแต่ละคนไว้ประกอบร่างตอนท้าย
                        successReports.push(
                            `👤 คุณ: ${user.name} (ID: ${user.memberNumber})\n` +
                            `💸 หักเครดิตเรียบร้อย: -${finalAmount} บาท\n` +
                            `💰 ยอดเครดิตคงเหลือ: ${user.balance} บาท\n` +
                            `🔓 สถานะบัญชี: ปลดล็อกเรียบร้อย ทำรายการต่อได้ปกติครับ`
                        );
                    }
                }
            }

            // --- จัดรูปแบบข้อความแสดงผลลัพธ์ให้สวยงาม ---
            let finalReply = "";
            if (successReports.length > 0) {
                finalReply += `✅ [อนุมัติถอนเงินสำเร็จ] 🎉\n──────────────────\n` + successReports.join('\n──────────────────\n');
            }
            if (errorReports.length > 0) {
                if (finalReply !== "") finalReply += `\n\n──────────────────\n🚨 รายงานข้อผิดพลาด:\n`;
                finalReply += errorReports.join('\n');
            }

            // แสดงยอดคงค้างในคิวปัจจุบันพ่วงท้าย
            const queueCount = typeof withdrawQueue !== 'undefined' ? withdrawQueue.length : 0;
            finalReply += `\n\n📊 คงเหลือในคิวรอถอน: ${queueCount} รายการ (พิมพ์ "ชถ" เพื่อดูคิวปัจจุบัน)`;

            replyText = finalReply;
        }
    }
}
                // ==================== [ ระบบแอดมินเรียกดูรายงานผลและโพยย้อนหลัง (v เลขรอบ) ] ====================
            else if (command.toLowerCase() === "v") {
                const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";
                if (userId !== ADMIN_ID) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งดึงข้อมูลย้อนหลังครับ";
                } else {
                    const targetRound = parseInt(args[1]);

                    if (!targetRound || isNaN(targetRound)) {
                        replyText = "⚠️ รูปแบบคำสั่งไม่ถูกต้อง กรุณาพิมพ์: v [เลขรอบ] หรือ V [เลขรอบ] (ตัวอย่างเช่น: V 5)";
                    } else {
                        // ค้นหาข้อความรายงานในคลังประวัติ
                        const savedReport = detailedRoundHistory[targetRound];

                        if (!savedReport) {
                            replyText = `❌ ไม่พบข้อมูลบันทึกสรุปผลของ "รอบที่ ${targetRound}" ในระบบครับ (ระบบจะจำข้อมูลตั้งแต่เปิดเซิร์ฟเวอร์ล่าสุดครับ)`;
                        } else {
                            // 📄 ดีดรายงานสรุปยอดโชว์ใหม่อีกครั้ง
                            replyText = `📋 **[ ค้นพบข้อมูลย้อนหลัง ]** 📋\n` +
                                        `🔍 แอดมินเรียกดูประวัติเก่าของ รอบที่: ${targetRound}\n` +
                                        `──────────────────\n\n` + 
                                        savedReport;
                        }
                    }
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
                                balance: 0, 
                                turnoverTarget: 0,
                                turnoverCount: 0     
                        };
                            replyText = `🎉 ลงทะเบียนสมาชิกใหม่สำเร็จ! 🎉\n──────────────────\n🆔 คุณคือสมาชิกคนที่: ${nextMemberId}\n👤 ชื่อ-นามสกุล: ${fullName}\n💰 ยอดคงเหลือ: 0 บาท\n──────────────────\nตอนนี้คุณสามารถส่งโพยหรือพิมพ์ C เพื่อเช็คการ์ดสมาชิก`;
                            nextMemberId++;
                        }
                    } else {
                        replyText = `📢 ยินดีต้อนรับครับสมาชิกใหม่\n──────────────────\n⚠️ คุณยังไม่ได้ลงทะเบียนในระบบ\n──────────────────\nกรุณาพิมพ์: C/ชื่อ-นามสกุล เพื่อลงทะเบียนใช้งาน และ ใช้ในการถอนเครดิต\n(ตัวอย่าง: C/นายแจ๊ค เด้งดี)\n──────────────────\n⚠️กรุณาใช้ชื่อ-นามสกุลให้ตรงกันกับ บช. ที่ใช้ในการฝากของท่าน⚠️`;
                    }
                } else {
                    const user = usersWallets[userId];
                    if (userMsg === 'c') {
                        let memberInfo = `👤 สมาชิกคนที่: ${user.memberNumber}\n👤 ชื่อ-นามสกุล: ${user.name}\n💰 ยอดเงิน: ${user.balance} บาท`;
                        if (user.turnoverTarget > 0) {
                            memberInfo += `\n🔒 เทิร์นคงค้าง: ${user.turnoverTarget} บาท \n──────────────────\n`;
                        } else {
                        memberInfo += `\n🔓 สถานะเทิร์น: ปกติ\n──────────────────\n `;
                        }
                        const myBets = roundBets[userId];
                        if (myBets && myBets.length > 0) {
                            memberInfo += `📝 โพยในรอบนี้\n──────────────────`;
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
                                        memberInfo += ` 🃏 (จั่วเพิ่มขา: ${drawLegs.sort().join(', ')})`;
                                    }
                                }
                            });
                            const totalHold = myBets.reduce((sum, bet) => sum + bet.holdCost, 0);
                        memberInfo += `\n──────────────────\n🔒 ยอดประกันเด้งที่ล็อกไว้: ${totalHold} บาท`;
                    } else {
                        memberInfo += `📝 โพยในรอบนี้ ไม่มีโพยค้าง`;
                    }

                    // 💡 [เพิ่มป้ายแนะนำคำสั่งและกติกาพ่วงท้ายกล่องข้อความตอนกด c]
                    memberInfo += `\n──────────────────\n` +
                                  `📖 คู่มือช่วยเหลือสมาชิก\n` +
                                  `👉 พิมพ์ คส เพื่อดูคำสั่งทั้งหมด\n` +
                                  `👉 พิมพ์ บช หรือ /บช เพื่อดูเลขบัญชี\n` +
                                  `👉 พิมพ์ กต เพื่ออ่านกติกาห้อง`;

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
                    // 1. สร้างถังเก็บข้อความเริ่มต้น (ใส่ข้อความตัวหนังสือเดิมไว้ก่อน)
                    let sendMessages = [{ type: 'text', text: replyText }];

                    // 2. ดักเช็ก: ถ้าแอดมินพิมพ์เปิดรอบ 'o' ให้ใส่รูปเปิดรอบเข้าไปข้างหน้าข้อความ
                    if (userMsg === 'o') {
                        sendMessages.unshift({
                            type: 'image',
                            originalContentUrl: 'https://img2.pic.in.th/-__-----4b1c38e0628ea626.jpg', // 🔗 ใส่ลิงก์รูปเปิดรอบของคุณตรงนี้
                            previewImageUrl: 'https://img2.pic.in.th/-__-----4b1c38e0628ea626.jpg'     // 🔗 ใส่ลิงก์รูปเดียวกัน
                        });
                    }
                    // 3. ดักเช็ก: ถ้าแอดมินพิมพ์ปิดรอบ 'x' ให้ใส่รูปปิดรอบเข้าไปข้างหน้าข้อความ
                    else if (userMsg === 'x') {
                        sendMessages.unshift({
                            type: 'image',
                            originalContentUrl: 'https://img2.pic.in.th/-__-----2cccaadd8f93c70b.jpg', // 🔗 ใส่ลิงก์รูปปิดรอบของคุณตรงนี้
                            previewImageUrl: 'https://img2.pic.in.th/-__-----2cccaadd8f93c70b.jpg'     // 🔗 ใส่ลิงก์รูปเดียวกัน
                        });
                    }
                    // 4. ดักเช็ก: ถ้าแอดมินพิมพ์ปิดรอบจั่ว 'oo' ให้ใส่รูปปิดรอบเข้าไปข้างหน้าข้อความ
                    else if (userMsg === 'oo') {
                        sendMessages.unshift({
                            type: 'image',
                            originalContentUrl: 'https://img2.pic.in.th/-__-----7fcbb7b1eadadfe1.jpg', // 🔗 ใส่ลิงก์รูปปิดรอบของคุณตรงนี้
                            previewImageUrl: 'https://img2.pic.in.th/-__-----7fcbb7b1eadadfe1.jpg'     // 🔗 ใส่ลิงก์รูปเดียวกัน
                        });
                    }
                    // 5. ดักเช็ก: ถ้าแอดมินพิมพ์ปิดรอบจั่ว 'xx' ให้ใส่รูปปิดรอบเข้าไปข้างหน้าข้อความ
                    else if (userMsg === 'xx') {
                        sendMessages.unshift({
                            type: 'image',
                            originalContentUrl: 'https://img2.pic.in.th/-__-----17ded3ef1c297156.jpg', // 🔗 ใส่ลิงก์รูปปิดรอบของคุณตรงนี้
                            previewImageUrl: 'https://img2.pic.in.th/-__-----17ded3ef1c297156.jpg'     // 🔗 ใส่ลิงก์รูปเดียวกัน
                        });
                    }
                    // 6. ดักเช็ก: ถ้าพิมพ์กติกา 'กต' ให้ใส่รูปปิดรอบเข้าไปข้างหน้าข้อความ
                    else if (userMsg === 'กต') {
                        sendMessages.unshift({
                            type: 'image',
                            originalContentUrl: 'https://img2.pic.in.th/Modern-Game-Rules-Poster-for-Pokdeng.jpg', // 🔗 ใส่ลิงก์รูปปิดรอบของคุณตรงนี้
                            previewImageUrl: 'https://img2.pic.in.th/Modern-Game-Rules-Poster-for-Pokdeng.jpg'     // 🔗 ใส่ลิงก์รูปเดียวกัน
                        },
                                      {
                            type: 'image',
                            originalContentUrl: 'https://img2.pic.in.th/Abstract-Playful-Classroom-Rules.jpg', // 🔗 ใส่ลิงก์รูปปิดรอบของคุณตรงนี้
                            previewImageUrl: 'https://img2.pic.in.th/Abstract-Playful-Classroom-Rules.jpg'     // 🔗 ใส่ลิงก์รูปเดียวกัน
                        });
                    }
                    // 7. ดักเช็ก: ถ้าแอดมินพิมพ์ปิดรอบจั่ว 'คส' ให้ใส่รูปปิดรอบเข้าไปข้างหน้าข้อความ
                    else if (userMsg === 'คส') {
                        sendMessages=[{
                            type: 'image',
                            originalContentUrl: 'https://img1.pic.in.th/images/546565.png', // 🔗 ใส่ลิงก์รูปปิดรอบของคุณตรงนี้
                            previewImageUrl: 'https://img1.pic.in.th/images/546565.png'     // 🔗 ใส่ลิงก์รูปเดียวกัน
                        }];
                    }
                    // ส่งข้อความทั้งหมดออกไปหาผู้ใช้
                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                        replyToken: replyToken,
                        messages: sendMessages // 📦 ส่งทั้งรูปและข้อความไปพร้อมกันในชุดเดียว
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
