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
let pastRoundsData = {}; // ถังเก็บประวัติโพยและผลไพ่แยกรายรอบ (สำหรับดึง v,m)

app.post('/callback', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    for (let event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const replyToken = event.replyToken;
            const originalMsg = event.message.text.trim(); // ข้อความดิบ
            const userMsg = originalMsg.replace(/\s+/g, ' '); // ข้อความที่ตัดเว้นวรรคซ้ำออก
            const userId = event.source.userId;

            // แยกข้อความด้วยเว้นวรรคเพื่อดึงคำสั่ง (เผื่อกรณีแอดมินใช้คำสั่งเติมเงิน)
            const args = userMsg.split(' ');
            const command = args[0];

            let replyText = ""; // ตัวแปรสำหรับเก็บข้อความที่จะตอบกลับ

            // ==================== [ 1. ระบบเติมเงิน / ลบเงิน ของแอดมิน ] ====================
            if (command === "เติม" || command === "ลบ") {
                const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db"; // LINE ID แอดมิน
                if (userId !== ADMIN_ID) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    const targetMemberId = parseInt(args[1]);
                    const amount = parseFloat(args[2]);

                    if (!targetMemberId || isNaN(amount) || amount <= 0) {
                        replyText = `⚠️ รูปแบบคำสั่งไม่ถูกต้องครับแอดมิน\nกรุณาพิมพ์: เติม [เลขสมาชิก] [จำนวนเงิน] หรือ ลบ [เลขสมาชิก] [จำนวนเงิน]\n(ตัวอย่างเช่น: เติม 1 500)`;
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
                                replyText = `💰 ทำการเติมเครดิตให้ สมาชิก ID: ${targetMemberId} คุณ ${usersWallets[foundUserKey].name} เรียบร้อยแล้วครับ!\n➕ ยอดเงิน: +${amount} บาท\n💳 เครดิตคงเหลือปัจจุบัน: ${usersWallets[foundUserKey].balance} บาท`;
                            } else if (command === "ลบ") {
                                if (usersWallets[foundUserKey].balance < amount) {
                                    replyText = `❌ หักเครดิตล้มเหลว: ยอดเงินของสมาชิก ID: ${targetMemberId} มีไม่เพียงพอให้หักครับ (เครดิตปัจจุบัน: ${usersWallets[foundUserKey].balance} บาท)`;
                                } else {
                                    usersWallets[foundUserKey].balance -= amount;
                                    replyText = `💸 ทำการหักเครดิตจาก สมาชิก ID: ${targetMemberId} คุณ ${usersWallets[foundUserKey].name} เรียบร้อยแล้วครับ!\n➖ ยอดเงิน: -${amount} บาท\n💳 เครดิตคงเหลือปัจจุบัน: ${usersWallets[foundUserKey].balance} บาท`;
                                }
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
                    const amount = parseFloat(args[2]);

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
                            user.balance += amount;
                            user.turnoverTarget = amount * 10; // ยอดเทิร์น 10 เท่าจากยอดรวม

                            replyText = `🎁 เติมเครดิตโปรโบนัสให้ [ ${user.memberNumber} ] คุณ ${user.name} สำเร็จ!\n` +
                                        `💰 ยอดสุทธิ: +${amount} บาท\n` +
                                        `🔒 [เปิดระบบล็อกถอน] ต้องทำยอดเทิร์นสะสม (ได้/เสีย) ให้ครบ: ${user.turnoverTarget} บาท`;
                        }
                    }
                }
            }

            // ==================== [ 2. ระบบสมาชิกแจ้งถอนเงิน - รูปแบบพิมพ์ติดกัน (ถอน500) ] ====================
            else if (userMsg.startsWith('ถอน')) {
                const user = usersWallets[userId];
                
                if (!user) {
                    replyText = "⚠️ คุณยังไม่ได้ลงทะเบียนสมาชิกในระบบครับ";
                } 
                else if (user.isWithdrawLocked) {
                    replyText = `❌ 不 สามารถทำรายการซ้ำได้ครับ!\n👤 คุณ ${user.name} มีรายการแจ้งถอนค้างอยู่จำนวน ${user.pendingWithdrawAmount} บาท อยู่ในระหว่างรอแอดมินอนุมัติครับ`;
                } 
                else if (user.turnoverTarget > 0) {
                    replyText = `❌ ไม่สามารถแจ้งถอนเงินได้ครับน้า!\n👤 คุณ: ${user.name} (ID: ${user.memberNumber})\n\n🚨 เนื่องจากคุณเลือกรับโบนัสและยังทำยอดเทิร์นไม่ครบ\n📉 ยอดเทิร์นคงค้างที่ต้องเล่นเพิ่มอีก: ${user.turnoverTarget} บาท จึงจะถอนเงินได้ครับ`;
                } 
                else {
                    const withdrawAmount = parseInt(userMsg.replace('ถอน', '').trim());

                    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
                        replyText = "⚠️ รูปแบบคำสั่งไม่ถูกต้องครับ กรุณาพิมพ์ระบุจำนวนเงิน เช่น ถอน500";
                    } else if (user.balance < withdrawAmount) {
                        replyText = `❌ แจ้งถอนล้มเหลว: ยอดเครดิตของคุณมีไม่เพียงพอครับ (เครดิตปัจจุบัน: ${user.balance} บาท)`;
                    } else {
                        user.isWithdrawLocked = true;
                        user.pendingWithdrawAmount = withdrawAmount;
                        
                        replyText = `⏳ [ระบบรับเรื่องแจ้งถอน] ⏳\n` +
                                    `👤 คุณ: ${user.name} (ID: ${user.memberNumber})\n` +
                                    `💰 ยอดที่แจ้งถอน: ${withdrawAmount} บาท\n` +
                                    `──────────────────\n` +
                                    `⚠️ **สถานะบัญชี:** บัญชีของคุณถูกล็อกชั่วคราว! ระหว่างนี้จะไม่สามารถส่งโพยแทง หรือแจ้งถอนซ้ำได้ จนกว่าแอดมินจะกดยืนยันยอดโอนสำเร็จครับ\n\n` +
                                    `📢 @Admin มีรายการแจ้งถอนเงินจาก ID: ${user.memberNumber} กรุณาตรวจสอบและอนุมัติพิมพ์: y ${user.memberNumber}`;
                    }
                }
            }

            // ==================== [ 3. ระบบแอดมินอนุมัติการถอนเงิน (รองรับ Y และ y) ] ====================
            else if (command.toLowerCase() === "y") {
                const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";
                if (userId !== ADMIN_ID) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งอนุมัติยอดถอนเงินครับ";
                } else {
                    const targetMemberId = parseInt(args[1]);

                    if (!targetMemberId || isNaN(targetMemberId)) {
                        replyText = "⚠️ รูปแบบคำสั่งไม่ถูกต้อง กรุณาพิมพ์: y [เลขสมาชิก] หรือ Y [เลขสมาชิก] (ตัวอย่างเช่น: Y 1)";
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
                            
                            if (!user.isWithdrawLocked) {
                                replyText = `⚠️ สมาชิก ID: ${targetMemberId} คุณ ${user.name} ไม่ได้มียอดแจ้งถอนค้างไว้ในระบบครับ`;
                            } else {
                                const finalAmount = user.pendingWithdrawAmount;
                                user.balance -= finalAmount;
                                user.isWithdrawLocked = false;
                                user.pendingWithdrawAmount = 0;

                                replyText = `✅ [อนุมัติถอนเงินสำเร็จ] 🎉\n` +
                                            `👤 สมาชิก: ${user.name} (ID: ${user.memberNumber})\n` +
                                            `💸 หักเครดิตเรียบร้อย: -${finalAmount} บาท\n` +
                                            `💰 ยอดเครดิตคงเหลือ: ${user.balance} บาท\n` +
                                            `🔓 **สถานะบัญชี:** ปลดล็อกเรียบร้อย สามารถทำรายการส่งโพยรอบถัดไปได้ปกติครับ 🏁`;
                            }
                        }
                    }
                }
            }

            // ==================== [ 4. แอดมิน เปิด/ปิด รอบรับโพยประจำตา (!เลขรอบ และ X) ] ====================
            else if (userMsg.startsWith('!') || userMsg === 'X' || userMsg === 'x') {
                const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";
                if (userId !== ADMIN_ID) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์เปิด/ปิด รอบเดิมพันครับ";
                } else {
                    if (userMsg.startsWith('!')) {
                        const roundNumber = parseInt(userMsg.substring(1).trim());
                        if (isNaN(roundNumber) || roundNumber <= 0) {
                            replyText = "⚠️ กรุณาระบุหมายเลขรอบให้ถูกต้องหลังเครื่องหมาย ! เช่น !1 หรือ !12";
                        } else if (isRoundOpen) {
                            replyText = `⚠️ ตอนนี้ระบบกำลังเปิด "รอบที่ ${currentRound}" อยู่แล้วครับ กรุณาพิมพ์ X เพื่อปิดรอบเดิมก่อนครับ`;
                        } else {
                            isRoundOpen = true;
                            isDrawOpen = false;
                            currentRound = roundNumber;
                            roundBets = {}; // ล้างข้อมูลโพยเพื่อเริ่มรอบใหม่
                            replyText = `🟢 [แอดมิน] เปิดรับโพย "ป๊อกเด้ง รอบที่ ${currentRound}" เรียบร้อยแล้วครับ! 🃏\n📢 สมาชิกทุกท่านสามารถส่งโพยแทงเข้ามาได้เลยครับน้า!`;
                        }
                    } else if (userMsg === 'X' || userMsg === 'x') {
                        if (!isRoundOpen) {
                            replyText = "⚠️ ตอนนี้ระบบปิดรับโพยอยู่แล้ว ไม่จำเป็นต้องปิดซ้ำครับ";
                        } else {
                            isRoundOpen = false;
                            replyText = `🔴 [แอดมิน] ปิดรับโพย "รอบที่ ${currentRound}" เรียบร้อยแล้วครับ! 🔒\n⏳ (อยู่ระหว่างแอดมินคัดแยกขาโพย รอเปิดรอบจั่วไพ่สักครู่ครับ)`;
                        }
                    }
                }
            }

            // ==================== [ 5. ระบบตรวจเช็คและรับโพยจากสมาชิก ] ====================
            else if (/^\d/.test(userMsg) && userMsg.includes('-') && !userMsg.includes('+')) {
                const user = usersWallets[userId];
                
                if (!user) {
                    replyText = "⚠️ คุณยังไม่ได้ลงทะเบียนสมาชิก ไม่สามารถส่งโพยได้ครับ กรุณาพิมพ์ C/ชื่อ-นามสกุล";
                } else if (user.isWithdrawLocked) {
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
                    return;
                } else if (!isRoundOpen) {
                    replyText = "⚠️ [แจ้งเตือน] ระบบปิดรับโพยชั่วคราว หรือยังไม่ได้เปิดรอบใหม่ครับน้า";
                } else {
                    const lines = originalMsg.split(/\r?\n/);
                    let processedLines = [];
                    let totalRoundCost = 0;
                    let hasError = false;
                    let errorDetail = "";
                    let tempBetsStore = [];

                    for (let line of lines) {
                        line = line.trim();
                        if (line === "") continue;

                        const parts = line.split('-');
                        if (parts.length !== 2) {
                            hasError = true;
                            errorDetail = `รูปแบบไม่ถูกต้องในบรรทัด: "${line}"`;
                            break;
                        }

                        let betType = parts[0].trim();
                        const priceStr = parts[1].trim();
                        const price = parseFloat(priceStr);

                        if (isNaN(price) || price <= 0) {
                            hasError = true;
                            errorDetail = `จำนวนเงินไม่ถูกต้องในบรรทัด: "${line}"`;
                            break;
                        }

                        let legCount = 0;
                        if (betType === "มข" || betType === "มจ") {
                            legCount = 6;
                        } else if (betType.startsWith('จ')) {
                            const rawLegs = betType.substring(1);
                            if (!/^[1-6]+$/.test(rawLegs)) {
                                hasError = true;
                                errorDetail = `ระบุขาเจ้ามือไม่ถูกต้อง (เลือกได้เฉพาะเลข 1-6) ในบรรทัด: "${line}"`;
                                break;
                            }
                            legCount = rawLegs.length;
                        } else {
                            if (!/^[1-6]+$/.test(betType)) {
                                hasError = true;
                                errorDetail = `ระบุขาไม่ถูกต้อง (เลือกได้เฉพาะเลข 1-6) ในบรรทัด: "${line}"`;
                                break;
                            }
                            legCount = betType.length;
                        }

                        const totalPrice = price * legCount;
                        const holdCost = totalPrice * 3; // ล็อกค้ำ 3 เท่า
                        totalRoundCost += holdCost;

                        tempBetsStore.push({
                            betType: betType,
                            pricePerLeg: price,
                            legCount: legCount,
                            totalPrice: totalPrice,
                            holdCost: holdCost,
                            detail: `แทง [${betType}] ขาละ ${price} บ. (รวมล็อกทุน: ${holdCost} บ.)`,
                            drawStatus: {} 
                        });
                        processedLines.push(`• แทง [${betType}] ขาละ ${price} บ. (ใช้ทุนค้ำ: ${holdCost} บ.)`);
                    }

                    if (hasError) {
                        replyText = `❌ ส่งโพยล้มเหลว!\n⚠️ ${errorDetail}\n💡 รูปแบบที่ถูกต้อง เช่น 123-50 หรือ มข-20`;
                    } else if (user.balance < totalRoundCost) {
                        replyText = `❌ ส่งโพยล้มเหลว!\n👤 คุณ: ${user.name}\n💰 เครดิตมีอยู่: ${user.balance} บาท\n📉 ทุนค้ำประกันที่ต้องใช้: ${totalRoundCost} บาท\n⚠️ ยอดเงินของคุณไม่เพียงพอสำหรับค้ำเด้ง (3 เท่า) ของโพยนี้ครับ`;
                    } else {
                        if (!roundBets[userId]) roundBets[userId] = [];
                        tempBetsStore.forEach(b => {
                            b.memberNumber = user.memberNumber;
                            b.name = user.name;
                            roundBets[userId].push(b);
                        });
                        
                        replyText = `✅ [ระบบรับโพยสำเร็จ - รอบที่ ${currentRound}] 🎉\n👤 คุณ: ${user.name} (ID: ${user.memberNumber})\n──────────────────\n${processedLines.join('\n')}\n──────────────────\n💰 รวมล็อกทุนค้ำเด้งรอบนี้: ${totalRoundCost} บาท\n💳 เครดิตคงเหลือให้แทงเพิ่ม: ${user.balance - totalRoundCost} บาท`;
                    }
                }
            }

            // ==================== [ 6 & 7. ระบบแอดมินเปิดรอบจั่ว (oo) และ ปิดรอบจั่วสรุปรายขา (xx) ] ====================
            else if (userMsg === 'oo' || userMsg === 'xx') {
                const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";
                if (userId !== ADMIN_ID) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งระบบจั่วครับ";
                } else {
                    if (userMsg === 'oo') {
                        if (isRoundOpen) {
                            replyText = "⚠️ ต้องพิมพ์ปิดรอบแทง (X) ก่อน จึงจะเปิดรอบจั่วได้ครับ";
                        } else if (isDrawOpen) {
                            replyText = `⚠️ [แจ้งเตือน] ตอนนี้ระบบกำลังเปิด "รอบขอจั่วไพ่ใบที่ 3" อยู่แล้วครับ ไม่จำเป็นต้องเปิดซ้ำครับ`;
                        } else {
                            isDrawOpen = true; 
                            replyText = `🃏 [แอดมิน] เปิดรอบขอจั่วไพ่ใบที่ 3 (รอบที่ ${currentRound}) แล้วครับ! ➕\n\n📢 สมาชิกขาไหนต้องการจั่วเพิ่ม ให้พิมพ์เลขขาตามด้วยเครื่องหมาย + เช่น พิมพ์ "12+" (ขอจั่วขา 1 และ 2)\n*หากขาไหนต้องการอยู่ (ไม่จั่ว) ไม่ต้องพิมพ์อะไรส่งมาครับ*`;
                        }
                    } 
                    else if (userMsg === 'xx') {
                        if (!isDrawOpen) {
                            replyText = "⚠️ [แจ้งเตือน] ระบบปิดรอบจั่วไพ่อยู่แล้วครับ ไม่สามารถปิดซ้ำได้";
                        } else {
                            isDrawOpen = false;

                            let summaryLegsText = `🔒 **[แอดมิน] ปิดรอบขอจั่วไพ่เรียบร้อยแล้วครับ!**\n` +
                                                  `🎰 ล็อกสถานะไพ่ 2 ใบ / 3 ใบของทุกขาแล้ว รอแอดมินสรุปผลและคิดเงินสักครู่ครับ\n` +
                                                  `──────────────────\n` +
                                                  `📋 **[ รายงานสรุปสถานะโพยและยอดแทงในรอบนี้ ]**\n\n`;

                            let hasBets = false;

                            for (let uid in roundBets) {
                                const userBetsArray = roundBets[uid];
                                if (userBetsArray && userBetsArray.length > 0) {
                                    hasBets = true;
                                    const user = usersWallets[uid]; 

                                    let totalRealPlay = 0; 
                                    let totalWithBounce = 0; 
                                    let betLegsDetail = []; 
                                    let drawLegsDetail = []; 

                                    userBetsArray.forEach((bet) => {
                                        if (bet.betType !== "มข" && bet.betType !== "มज" && !bet.betType.startsWith('จ')) {
                                            const individualLegs = bet.betType.split('');
                                            individualLegs.forEach((leg) => {
                                                if (!betLegsDetail.includes(leg)) betLegsDetail.push(leg);
                                                if (bet.drawStatus && bet.drawStatus[leg] === "จั่ว") {
                                                    if (!drawLegsDetail.includes(leg)) drawLegsDetail.push(leg);
                                                }
                                            });
                                        } else {
                                            if (!betLegsDetail.includes(bet.betType)) {
                                                betLegsDetail.push(bet.betType);
                                            }
                                        }
                                        totalRealPlay += bet.totalPrice;
                                        totalWithBounce += bet.holdCost;
                                    });

                                    const legsStr = betLegsDetail.sort().join(', ');
                                    const drawStr = drawLegsDetail.length > 0 ? drawLegsDetail.sort().join(', ') : "ไม่มี (อยู่ 2 ใบ)";

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

            // ==================== [ 8. สมาชิกพิมพ์ส่งคำสั่งจั่วไพ่ใบที่ 3 เช่น 12+ หรือ 3+ ] ====================
            else if (/^[1-6]+\+$/.test(userMsg)) {
                const user = usersWallets[userId];
                if (!user) {
                    replyText = "⚠️ คุณยังไม่ได้ลงทะเบียนสมาชิกในระบบครับ";
                } else if (!isDrawOpen) {
                    replyText = "⚠️ [ปฏิเสธ] ตอนนี้แอดมินยังไม่ได้เปิดรอบขอจั่วไพ่ หรือถูกปิดรอบจั่วไปแล้วครับ";
                } else {
                    const myBets = roundBets[userId];
                    if (!myBets || myBets.length === 0) {
                        replyText = `⚠️ คุณ ${user.name} ไม่มียอดโพยเดิมพันค้างในรอบนี้ จึงไม่สามารถกดจั่วไพ่ได้ครับ`;
                    } else {
                        const drawLegs = userMsg.replace('+', '').split('');
                        let successLogs = [];
                        let failLogs = [];

                        myBets.forEach(bet => {
                            if (bet.betType === "มข" || bet.betType === "มจ" || bet.betType.startsWith('จ')) {
                                failLogs.push(`โพยพิเศษ [${bet.betType}] ไม่ต้องกดจั่วรายขาครับ ระบบจัดการให้อัตโนมัติ`);
                                return;
                            }
                            drawLegs.forEach(leg => {
                                if (bet.betType.includes(leg)) {
                                    bet.drawStatus[leg] = "จั่ว";
                                    if (!successLogs.includes(leg)) successLogs.push(leg);
                                } else {
                                    if (!failLogs.includes(leg) && !bet.betType.includes(leg)) {
                                        failLogs.push(`ขา ${leg} (คุณไม่ได้แทงขานี้ไว้)`);
                                    }
                                }
                            });
                        });

                        if (successLogs.length > 0) {
                            replyText = `✅ [บันทึกการจั่วไพ่สำเร็จ] ➕\n👤 คุณ: ${user.name} (ID: ${user.memberNumber})\n🃏 ขอจั่วไพ่ใบที่ 3 เพิ่มที่ ขา: [ ${successLogs.sort().join(', ')} ] เรียบร้อยครับ`;
                        } else {
                            replyText = `❌ จั่วไพ่ล้มเหลว!\n⚠️ เหตุผล: ${failLogs.join(', ')}`;
                        }
                    }
                }
            }

            // ==================== [ 9. แอดมินสรุปคะแนนไพ่ประจำรอบและคิดเงินอัตโนมัติ ] ====================
            else if (userMsg.startsWith('จ') && userMsg.includes('=')) {
                const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";
                if (userId !== ADMIN_ID) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ส่งผลคำนวณเงินครับ";
                } else if (isRoundOpen || isDrawOpen) {
                    replyText = "⚠️ กรุณาพิมพ์คำสั่ง X เพื่อปิดรอบแทง และพิมพ์ xx เพื่อปิดรอบจั่วไพ่ให้เสร็จสิ้นก่อนส่งผลไพ่ครับ";
                } else {
                    try {
                        const cleanMsg = userMsg.replace(/ /g, '');
                        const mainParts = cleanMsg.split(',');
                        
                        let dealerPart = mainParts[0];
                        let roomParts = mainParts.slice(1);

                        const dMatch = dealerPart.match(/^จ([0-9พปภ])([เเ]*[1-5]*)$/);
                        if (!dMatch) throw new Error("รูปแบบแต้มเจ้ามือไม่ถูกต้อง");

                        let dScoreRaw = dMatch[1];
                        let dMultRaw = dMatch[2];
                        let dScore = dScoreRaw === 'พ' ? 7.1 : dScoreRaw === 'ป' ? 8 : dScoreRaw === 'ภ' ? 9 : parseInt(dScoreRaw);
                        let dMult = dMultRaw.includes('เ') || dMultRaw.includes('เเ') ? (dMultRaw.length) : 1;
                        let dName = dScoreRaw === 'พ' ? "พิเศษพิเศษ" : dScoreRaw === 'ป' ? "ป๊อก 8" : dScoreRaw === 'ภ' ? "ป๊อก 9" : `${dScore} แต้ม`;

                        let dealerResult = { score: dScore, mult: dMult, name: dName };
                        let roomsResults = {};

                        roomParts.forEach(p => {
                            const rMatch = p.match(/^([1-6])=([0-9พปภ])([เเ]*[1-5]*)\/([0-9พปภ])([เเ]*[1-5]*)$/);
                            if (!rMatch) throw new Error(`รูปแบบขา ${p} ไม่ถูกต้อง ต้องระบุคะแนนแบบ 2ใบ/3ใบ`);

                            let roomNum = parseInt(rMatch[1]);
                            let s2Raw = rMatch[2];
                            let m2Raw = rMatch[3];
                            let s3Raw = rMatch[4];
                            let m3Raw = rMatch[5];

                            let s2 = s2Raw === 'พ' ? 7.1 : s2Raw === 'ป' ? 8 : s2Raw === 'ภ' ? 9 : parseInt(s2Raw);
                            let m2 = m2Raw.includes('เ') || m2Raw.includes('เเ') ? (m2Raw.length) : 1;
                            let n2 = s2Raw === 'พ' ? "พิเศษ" : s2Raw === 'ป' ? "ป๊อก 8" : s2Raw === 'ภ' ? "ป๊อก 9" : `${s2} แต้ม`;

                            let s3 = s3Raw === 'พ' ? 7.1 : s3Raw === 'ป' ? 8 : s3Raw === 'ภ' ? 9 : parseInt(s3Raw);
                            let m3 = m3Raw.includes('เ') || m3Raw.includes('เเ') ? (m3Raw.length) : 1;
                            let n3 = s3Raw === 'พ' ? "พิเศษ" : s3Raw === 'ป' ? "ป๊อก 8" : s3Raw === 'ภ' ? "ป๊อก 9" : `${s3} แต้ม`;

                            roomsResults[roomNum] = {
                                twoCards: { score: s2, mult: m2, name: n2, v: s2Raw },
                                threeCards: { score: s3, mult: m3, name: n3, v: s3Raw }
                            };
                        });

                        tempRoomResults = roomsResults;
                        tempDealerResult = dealerResult;

                        let previewText = `📊 [ ระบบประมวลผลแต้มเสร็จสิ้น - รอบที่ ${currentRound} ] 📊\n`;
                        previewText += `👑 เจ้ามือ: ${dealerResult.name} (${dealerResult.mult} เด้ง)\n`;
                        previewText += `──────────────────\n`;

                        for (let r in roomsResults) {
                            previewText += `• ขา ${r} :\n`;
                            previewText += `   - อยู่ 2 ใบ: ${roomsResults[r].twoCards.name} (${roomsResults[r].twoCards.mult} เด้ง)\n`;
                            previewText += `   - จั่ว 3 ใบ: ${roomsResults[r].threeCards.name} (${roomsResults[r].threeCards.mult} เด้ง)\n`;
                        }
                        previewText += `──────────────────\n📢 หากตรวจสอบความถูกต้องเรียบร้อยแล้ว แอดมินพิมพ์ส่งคำสั่ง "ok" เพื่อตัดเงินจริงได้เลยครับ`;
                        replyText = previewText;

                    } catch (err) {
                        replyText = `❌ รูปแบบการส่งแต้มไม่ถูกต้องครับแอดมิน!\n⚠️ ตัวอย่างวิธีพิมพ์ที่ถูกต้อง:\nจ5, 1=6/ภเเ, 2=ปเเ/5, 3=4/0\n*(อธิบาย: เจ้า5แต้ม1เด้ง, ขา1 สองใบได้6แต้ม สามใบได้ป๊อก9สองเด้ง...)*`;
                    }
                }
            }

            // ==================== [ ระบบยืนยันตัดยอดเงินจริงหลังแอดมินพิมพ์ ok ] ====================
            else if (userMsg === 'ok' || userMsg === 'OK') {
                const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";
                if (userId !== ADMIN_ID) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์สั่งอนุมัติคำนวณเงินครับ";
                } else if (!tempDealerResult || !tempRoomResults) {
                    replyText = "⚠️ ไม่พบยอดแต้มที่ค้างประมวลผลอยู่ครับ กรุณาส่งแต้มไพ่ก่อนพิมพ์ ok";
                } else {
                    let summaryPayoutText = `🏁 [ ใบสรุปบัญชีเงินเครดิต - ป๊อกเด้งรอบที่ ${currentRound} ] 🏁\n`;
                    summaryPayoutText += `👑 ผลเจ้ามือ: ${tempDealerResult.name} (${tempDealerResult.mult} เด้ง)\n`;
                    summaryPayoutText += `──────────────────\n\n`;

                    let hasProcessed = false;

                    for (let uid in roundBets) {
                        const userBetsArray = roundBets[uid];
                        if (!userBetsArray || userBetsArray.length === 0) continue;

                        hasProcessed = true;
                        const user = usersWallets[uid];
                        let userTotalWinLoss = 0;
                        let totalHoldRefund = 0;
                        let adminFee = 0;

                        userBetsArray.forEach((bet) => {
                            totalHoldRefund += bet.holdCost;
                            let legsToCalc = [];

                            if (bet.betType === "มข" || bet.betType === "มจ") {
                                legsToCalc = ['1', '2', '3', '4', '5', '6'];
                            } else if (bet.betType.startsWith('จ')) {
                                legsToCalc = bet.betType.substring(1).split('');
                            } else {
                                legsToCalc = bet.betType.split('');
                            }

                            legsToCalc.forEach((legStr) => {
                                const legNum = parseInt(legStr);
                                const matchResult = tempRoomResults[legNum];
                                if (!matchResult) return;

                                const isBettingOnDealer = (bet.betType === "มจ" || bet.betType.startsWith('จ'));
                                let finalCard;

                                if (!isBettingOnDealer) {
                                    const isUserDrawn = (bet.drawStatus && bet.drawStatus[legStr] === "จั่ว");
                                    finalCard = isUserDrawn ? matchResult.threeCards : matchResult.twoCards;

                                    if (finalCard.score > tempDealerResult.score) {
                                        userTotalWinLoss += (bet.pricePerLeg * finalCard.mult);
                                    } else if (finalCard.score < tempDealerResult.score) {
                                        let loseMultiplier = tempDealerResult.mult;
                                        if (isUserDrawn && (finalCard.v === 't' || finalCard.v === 'sf' || finalCard.v === 's' || finalCard.v === 'h')) {
                                            loseMultiplier = 3;
                                        }
                                        userTotalWinLoss -= (bet.pricePerLeg * loseMultiplier);
                                    }
                                } else {
                                    if (matchResult.twoCards.score <= 4 && matchResult.twoCards.mult === 1) {
                                        finalCard = matchResult.threeCards;
                                    } else {
                                        finalCard = matchResult.twoCards;
                                    }

                                    if (tempDealerResult.score > finalCard.score) {
                                        let grossWin = bet.pricePerLeg * tempDealerResult.mult;
                                        let netWin = Math.floor(grossWin * 0.9);
                                        adminFee += (grossWin - netWin);
                                        userTotalWinLoss += netWin;
                                    } else if (tempDealerResult.score < finalCard.score) {
                                        userTotalWinLoss -= (bet.pricePerLeg * finalCard.mult);
                                    }
                                }
                            });
                        });

                        user.balance = user.balance + totalHoldRefund + userTotalWinLoss;

                        // 📊 [ระบบคำนวณและหักยอดเทิร์นอัตโนมัติ] 
                        if (user.turnoverTarget > 0 && userTotalWinLoss !== 0) {
                            let currentTurnoverMade = Math.abs(userTotalWinLoss); 
                            user.turnoverTarget -= currentTurnoverMade;
                            if (user.turnoverTarget < 0) user.turnoverTarget = 0;
                        }

                        let sign = userTotalWinLoss > 0 ? "🟢 +" : (userTotalWinLoss < 0 ? "🔴 " : "🟡 ");
                        let feeNote = adminFee > 0 ? ` *(หักต๋งเข้าเจ้ามือ ${adminFee} บ.)*` : "";
                        let turnNote = user.turnoverTarget > 0 ? ` ⚠️ (เหลือเทิร์น: ${user.turnoverTarget} บ.)` : " 🟢 (เทิร์นครบแล้ว)";
                        
                        summaryPayoutText += `👤 ${user.name} (ID: ${user.memberNumber})\n   ยอดสุทธิ: ${sign}${userTotalWinLoss} บาท${feeNote} (เครดิต: ${user.balance} บ.)${turnNote}\n`;
                    }

                    if (!hasProcessed) summaryPayoutText += "ℹ️ รอบนี้ไม่มีผู้เล่นถูกคิดเงินครับ\n";

                    let historySummary = `รอบที่ ${currentRound}: เจ้ามือได้ ${tempDealerResult.name}`;
                    matchHistory.push(historySummary);
                    if (matchHistory.length > 5) matchHistory.shift();

                    summaryPayoutText += `──────────────────\n📋 สถิติล่าสุด: \n${matchHistory.join('\n')}\n`;
                    summaryPayoutText += `\n🏁 จบรอบที่ ${currentRound} สั่งเปิดรอบใหม่โดยพิมพ์เครื่องหมาย ! ตามด้วยเลขรอบถัดไปได้เลยครับน้า`;

                    detailedRoundHistory[currentRound] = summaryPayoutText;
                    pastRoundsData[currentRound] = {
                        dealer: JSON.parse(JSON.stringify(tempDealerResult)),
                        rooms: JSON.parse(JSON.stringify(tempRoomResults)),
                        bets: JSON.parse(JSON.stringify(roundBets))
                    };

                    replyText = summaryPayoutText;

                    tempRoomResults = null;
                    tempDealerResult = null;
                    isDrawOpen = false;
                    roundBets = {}; 
                }
            }

            // ==================== [ ระบบดึงโพยและผลไพ่ย้อนหลังรายบุคคล (vรอบ,mสมาชิก) ] ====================
            else if (userMsg.startsWith('v') && userMsg.includes(',m')) {
                const parts = userMsg.split(',');
                const roundTarget = parseInt(parts[0].replace('v', '')); 
                const memberTarget = parseInt(parts[1].replace('m', '')); 

                if (isNaN(roundTarget) || isNaN(memberTarget)) {
                    replyText = "⚠️ รูปแบบคำสั่งไม่ถูกต้องครับน้า\nกรุณาพิมพ์ เช่น v12,m5 (เพื่อดูรอบที่ 12 ของสมาชิกคนที่ 5)";
                } else if (!pastRoundsData[roundTarget]) {
                    replyText = `❌ ไม่พบข้อมูลการเล่นของ "รอบที่ ${roundTarget}" ในระบบครับ`;
                } else {
                    const historicalRound = pastRoundsData[roundTarget];
                    const historicalDealer = historicalRound.dealer;
                    const historicalRooms = historicalRound.rooms;
                    const historicalBets = historicalRound.bets;

                    let targetUid = null;
                    for (let uid in historicalBets) {
                        if (historicalBets[uid][0] && historicalBets[uid][0].memberNumber === memberTarget) {
                            targetUid = uid;
                            break;
                        }
                    }

                    if (!targetUid || !historicalBets[targetUid] || historicalBets[targetUid].length === 0) {
                        replyText = `❌ 不พบโพยเดิมพันของ สมาชิกคนที่ ${memberTarget} ในรอบที่ ${roundTarget} ครับ`;
                    } else {
                        const userBets = historicalBets[targetUid];
                        const userName = userBets[0].name;

                        let reportText = `🔍 **[ ดึงข้อมูลโพยรายบุคคลย้อนหลัง ]**\n`;
                        reportText += `🎬 รอบที่: ${roundTarget} ของสมาชิกคนที่ ${memberTarget} (${userName})\n`;
                        reportText += `──────────────────\n`;
                        reportText += `👑 เจ้ามือ: ${historicalDealer.name} (${historicalDealer.mult} เด้ง)\n\n`;
                        reportText += `📝 **ผลไพ่กระดานรอบที่ ${roundTarget} :**\n`;

                        for (let leg = 1; leg <= 6; leg++) {
                            if (historicalRooms[leg]) {
                                const res = historicalRooms[leg];
                                let s2 = res.twoCards.score > historicalDealer.score ? "🟢 ชนะ" : (res.twoCards.score < historicalDealer.score ? "🔴 แพ้" : "🟡 เสมอ");
                                let s3 = res.threeCards.score > historicalDealer.score ? "🟢 ชนะ" : (res.threeCards.score < historicalDealer.score ? "🔴 แพ้" : "🟡 เสมอ");
                                
                                reportText += `• ขา ${leg}:\n`;
                                reportText += `   - [อยู่ 2ใบ]: ${res.twoCards.name} (${res.twoCards.mult}เด้ง) -> ${s2}\n`;
                                reportText += `   - [จั่ว 3ใบ]: ${res.threeCards.name} (${res.threeCards.mult}เด้ง) -> ${s3}\n`;
                            } else {
                                reportText += `• ขา ${leg} -> ⚠️ ไม่มีผลไพ่ (🔴 แพ้เจ้ามือ)\n`;
                            }
                        }

                        reportText += `──────────────────\n`;
                        reportText += `📋 **โพยรอบนี้ของคุณ ${userName} :**\n`;

                        let totalWinLoss = 0;
                        let detailRows = "";

                        userBets.forEach((bet) => {
                            let legsToCalc = [];
                            if (bet.betType === "มข" || bet.betType === "มจ") {
                                legsToCalc = ['1', '2', '3', '4', '5', '6'];
                            } else if (bet.betType.startsWith('จ')) {
                                legsToCalc = bet.betType.substring(1).split('');
                            } else {
                                legsToCalc = bet.betType.split('');
                            }

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
                                        if (isUserDrawn && (finalCard.v === 't' || finalCard.v === 'sf' || finalCard.v === 's' || finalCard.v === 'h')) {
                                            loseMultiplier = 3;
                                        }
                                        let loss = bet.pricePerLeg * loseMultiplier;
                                        totalWinLoss -= loss;
                                        detailRows += `ขาที่ ${legStr} ${statusAction} แพ้ -${loss}\n`;
                                    } else {
                                        detailRows += `ขาที่ ${legStr} ${statusAction} เสมอ +0\n`;
                                    }
                                } else {
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

                        let signStr = totalWinLoss > 0 ? `กำไร +${totalWinLoss}` : (totalWinLoss < 0 ? `ขาดทุน ${totalWinLoss}` : `เสมอตัว +0`);
                        reportText += `\n📊 **สรุปดีเทลการเล่น :**\n${detailRows}`;
                        reportText += `👉 ยอดกำไร/ขาดทุนในรอบนี้: **${signStr} บาท**\n`;
                        reportText += `💡 *หมายเหตุ: หากต้องการเช็คยอดเครดิตปัจจุบันล่าสุด ให้สมาชิกพิมพ์คำสั่ง "c" ครับ*`;

                        replyText = reportText;
                    }
                }
            }

            // ==================== [ แอดมินพิมพ์เรียกดูรายงานสรุปแบบย่อ (v เลขรอบ) ] ====================
            else if (command.toLowerCase() === "v") {
                const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";
                if (userId !== ADMIN_ID) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งดึงข้อมูลย้อนหลังครับ";
                } else {
                    const targetRound = parseInt(args[1]);

                    if (!targetRound || isNaN(targetRound)) {
                        replyText = "⚠️ รูปแบบคำสั่งไม่ถูกต้อง กรุณาพิมพ์: v [เลขรอบ] หรือ V [เลขรอบ] (ตัวอย่างเช่น: V 5)";
                    } else {
                        const savedReport = detailedRoundHistory[targetRound];

                        if (!savedReport) {
                            replyText = `❌ ไม่พบข้อมูลบันทึกสรุปผลของ "รอบที่ ${targetRound}" ในระบบครับ`;
                        } else {
                            replyText = `📋 **[ ค้นพบข้อมูลย้อนหลัง ]** 📋\n🔍 แอดมินเรียกดูประวัติเก่าของ รอบที่: ${targetRound}\n──────────────────\n\n` + savedReport;
                        }
                    }
                }
            }

            // ==================== [ 10. ระบบลงทะเบียน / เช็กบัตรสมาชิก (กรณีทั่วไป) ] ====================
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
                                turnoverTarget: 0 
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

                        if (user.turnoverTarget > 0) {
                            memberInfo += `\n\n🚨 **ยอดเทิร์นโบนัสคงเหลือ:** ${user.turnoverTarget} บาท\n*(ต้องทำยอดให้ครบ 0 บ. จึงจะถอนเงินได้)*`;
                        } else {
                            memberInfo += `\n\n🟢 **สถานะการถอน:** ปลดล็อกเทิร์นแล้ว ถอนเงินได้ปกติ`;
                        }

                        memberInfo += `\n\n──────────────────\n` +
                                      `📖 *คู่มือช่วยเหลือสมาชิก:*\n` +
                                      `👉 พิมพ์ **คส** เพื่อดูคำสั่งทั้งหมด\n` +
                                      `👉 พิมพ์ **บช** หรือ **/บช** เพื่อดูเลขบัญชี\n` +
                                      `👉 พิมพ์ **กต** เพื่ออ่านกติกาห้อง`;

                        replyText = memberInfo;
                    } else if (originalMsg.startsWith('C/') || originalMsg.startsWith('c/')) {
                        replyText = `ℹ️ คุณ ${user.name} ได้ลงทะเบียนในระบบเรียบร้อยแล้วครับ\n🆔 สมาชิกคนที่: ${user.memberNumber}`;
                    } else if (userMsg === 'คส' || userMsg === 'คำสั่ง') {
                        replyText = `📋 [ รายการคำสั่งสำหรับสมาชิก ] 📋\n──────────────────\n` +
                                    `👉 พิมพ์ **c** หรือ **C** : ตรวจสอบข้อมูลกระเป๋าเงินและโพยค้างของตนเอง\n` +
                                    `👉 พิมพ์ **ถอน[จำนวนเงิน]** : แจ้งถอนเงินสดดิบ ๆ (เช่น ถอน500)\n` +
                                    `👉 พิมพ์ **บช** หรือ **/บช** : ดูเลขบัญชีธนาคารสำหรับโอนฝากเงิน\n` +
                                    `👉 พิมพ์ **กต** : อ่านกติกาวิธีการเล่นของห้องนี้\n\n` +
                                    `🃏 *วิธีส่งโพยเดิมพัน:* พิมพ์ [เลขขา]-[จำนวนเงิน]\n(ตัวอย่างเช่น: 123-50 หรือ มข-100)`;
                    } else if (userMsg === 'บช' || userMsg === '/บช') {
                        replyText = `🏦 **ช่องทางการฝากเงิน (ระบบออโต้)** 🏦\n──────────────────\n` +
                                    `ธนาคาร: กสิกรไทย (K-Bank)\n` +
                                    `เลขที่บัญชี: xxx-x-xxxxx-x\n` +
                                    `ชื่อบัญชี: ระบบบอทป๊อกเด้ง ออโต้\n──────────────────\n` +
                                    `⚠️ *สำคัญมาก:* หลังจากโอนเงินสำเร็จแล้ว กรุณาส่งสลิปเข้ามาในไลน์กลุ่มนี้ทันที เพื่อให้แอดมินตรวจสอบและเติมเครดิตให้นะครับน้า 🙏`;
                    } else if (userMsg === 'กต' || userMsg === 'กติกา') {
                        replyText = `📜 **กติกาการเดิมพันห้องป๊อกเด้งออโต้** 📜\n──────────────────\n` +
                                    `1. สมาชิกเลือกแทงขา 1 ถึง ขา 6 ได้อย่างอิสระ (ขาละเท่าๆ กัน)\n` +
                                    `2. ระบบจะล็อกทุนค้ำประกันเด้งไว้ **3 เท่า** ของยอดแทงจริง เพื่อป้องกันกรณีเจ้ามือชนะเด้งสูงสุด\n` +
                                    `3. หลังจากปิดรอบแทง (X) แอดมินจะเปิดรอบจั่ว (oo) ขาไหนแต้มต่ำกว่า 5 หรืออยากสู้เพิ่ม ให้พิมพ์เลขขาตามด้วยเครื่องหมาย + เช่น พิมพ์ "13+"\n` +
                                    `4. กรณีได้ ป๊อก 8 หรือ ป๊อก 9 ระบบจะล็อคอยู่ให้อัตโนมัติที่ 2 ใบ ไม่สามารถจั่วเพิ่มได้ครับ\n` +
                                    `5. คิดเงินตามอัตราตัวคูณเด้งจริงของไพ่กระดานนั้นๆ หักต๋งเฉพาะฝั่งแทงเจ้ามือ 10% ครับ`;
                    } else {
                        replyText = "";
                    }
                }
            }

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
app.listen(process.env.PORT || 3000, () => { console.log('Server is running'); });
