const express = require('express');
const axios = require('axios');
const fs = require('fs'); // 📁 เติมตรงนี้เพื่อให้ระบบรู้จักการเขียนไฟล์ลงเครื่องครับน้า
const app = express();
app.use(express.json());

// 💡 ไม่ต้องใส่ Token ในนี้แล้ว ระบบจะดึงจากตัวแปรบน Render อัตโนมัติ
const TOKEN = process.env.CHANNEL_ACCESS_TOKEN;

// 👥 [กล่องรวม ID แอดมินกลาง] มีแอดมินเพิ่มมาใส่เพิ่มตรงนี้ที่เดียวจบเลยครับน้า!
const ADMIN_IDS = [
    "U2fb9233e5c539ae3970cbd698e2e18db", // แอดมินคนที่ 1
    "Uf48148ba5a3bfd14d4e81213daf56ef4" // แอดมินคนที่ 2
];

// 📡 ลิงก์เชื่อมโยงไปยังฐานข้อมูล Firebase ถาวร 
const FIREBASE_URL = "https://my-pokdeng-bot-default-rtdb.asia-southeast1.firebasedatabase.app/"; 

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
let usersRoundCrossCheck = {}; // 🌟 เพิ่มบรรทัดนี้ไว้บนสุดของไฟล์

// 🔄 ฟังก์ชันอัตโนมัติ: ดึงข้อมูลจาก Firebase มาอัปเดตลงในบอททันทีที่เปิดเครื่อง (แก้ไขดึงครบทุกกล่องแล้ว)
async function loadDataFromFirebase() {
    try {
        const response = await axios.get(`${FIREBASE_URL}system_data.json`);
        if (response.data) {
            usersWallets = response.data.usersWallets || {};
            nextMemberId = response.data.nextMemberId || 1;
            isRoundOpen = response.data.isRoundOpen !== undefined ? response.data.isRoundOpen : false;
            roundBets = response.data.roundBets || {};
            currentRound = response.data.currentRound || 0;
            isDrawOpen = response.data.isDrawOpen !== undefined ? response.data.isDrawOpen : false;
            matchHistory = response.data.matchHistory || [];
            detailedRoundHistory = response.data.detailedRoundHistory || {};
            pastRoundsData = response.data.pastRoundsData || {};
            withdrawQueue = response.data.withdrawQueue || [];
            console.log("✅ ดึงข้อมูลระบบทั้งหมดจาก Firebase สำเร็จเรียบร้อย!");
        }
    } catch (error) {
        console.error("❌ ไม่สามารถดึงข้อมูลจาก Firebase ได้:", error.message);
    }
}
loadDataFromFirebase(); // สั่งให้ทำงานทันทีที่บอทรัน

// 💾 ฟังก์ชันอัตโนมัติ: สั่งบันทึกข้อมูลปัจจุบันยิงกลับไปเก็บที่ตึก Firebase
async function saveDataToFirebase() {
    try {
        await axios.put(`${FIREBASE_URL}system_data.json`, {
            usersWallets: usersWallets,
            nextMemberId: nextMemberId,
            isRoundOpen: isRoundOpen,         // 💾 จำสถานะ เปิด/ปิด รอบ
            roundBets: roundBets,             // 💾 จำโพยแทงในแต่ละรอบ
            currentRound: currentRound,       // 💾 จำลำดับรอบปัจจุบัน
            isDrawOpen: isDrawOpen,           // 💾 จำสถานะรอบจั่วไพ่
            matchHistory: matchHistory,       // 💾 จำประวัติสถิติย้อนหลัง 5 รอบ
            detailedRoundHistory: detailedRoundHistory, // 💾 จำข้อมูลแอดมินดึงย้อนหลัง
            pastRoundsData: pastRoundsData,   // 💾 จำประวัติโพยและผลไพ่แยกรายรอบ (v,m)
            withdrawQueue: withdrawQueue       // 💾 จำคิวสมาชิกที่แจ้งถอนเงิน
        });
        console.log("💾 บันทึกข้อมูลลง Firebase เรียบร้อย!");
    } catch (error) {
        console.error("❌ บันทึกข้อมูลลง Firebase ล้มเหลว:", error.message);
    }
}

app.post('/callback', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    for (let event of events) {
       // =================================================================
        // 📸 [ระบบฟิวชั่น ร่างอัปเกรดเตือนภัย] ดักจับรูปภาพสลิป + เตือนแอดมินถ้าส่งช้าเกิน 5 นาที
        // =================================================================
        if (event.type === 'message' && event.message.type === 'image') {
            const replyToken = event.replyToken;
            const userId = event.source.userId;

            if (global.depositQueue && global.depositQueue[userId] && global.depositQueue[userId].status === 'WAITING_ADMIN') {
                const currentQueue = global.depositQueue[userId];
                const messageId = event.message.id;
                const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";
                
                // ⏱️ คำนวณเวลาที่ใช้ไปนับตั้งแต่กดฝาก (หน่วยเป็นนาที)
                const timeElapsed = (Date.now() - currentQueue.createdAt) / 1000 / 60;

                // 🚨 สร้างป้ายเตือนภัย ถ้าส่งสลิปช้ากว่า 5 นาที
                let timeWarningTag = "";
                if (timeElapsed > 5) {
                    timeWarningTag = `\n\n⚠️ [แจ้งเตือนภัย] สลิปนี้ส่งเลทเกิน 5 นาทีนะน้า! (ส่งช้าไปประมาณ ${Math.floor(timeElapsed)} นาที) เช็กเวลาโอนบนสลิปและสเตทเม้นท์ให้ดีๆ ก่อนกดเติมเงินครับ!`;
                }

                const filename = `slip-${currentQueue.memberId}.jpg`;

                try {
                    // 📁 1. ดาวน์โหลดรูปภาพสลิปดิบจาก LINE API
                    const response = await axios({
                        method: 'get',
                        url: `https://api-data.line.me/v2/bot/message/${messageId}/content`,
                        responseType: 'stream',
                        headers: { 'Authorization': `Bearer ${TOKEN}` }
                    });

                    // 💾 2. บันทึกรูปภาพลงบนเซิร์ฟเวอร์ Render
                    const writer = fs.createWriteStream(filename);
                    response.data.pipe(writer);

                    await new Promise((resolve, reject) => {
                        writer.on('finish', resolve);
                        writer.on('error', reject);
                    });

                    const myServerUrl = `https://linepok3p.onrender.com/${filename}`;

                    // 🔔 3. เตรียมข้อความสรุปข้อมูลส่งให้แอดมิน + แปะป้ายเตือนภัยเข้าไปด้วย
                    const adminNotifyMessage = `🔔 มีรายการแจ้งโอนเงินใหม่!\n──────────────────\n` +
                                               `🆔 สมาชิกลำดับที่: ${currentQueue.memberId}\n` +
                                               `👤 ชื่อ: ${currentQueue.name}\n` +
                                               `💰 ยอดที่ต้องตรงกับสลิป:\n ${currentQueue.displayAmount} บาท ${timeWarningTag}\n──────────────────\n` +
                                               `👉 อนุมัติเติมเงินพิมพ์: เติม ${currentQueue.memberId} ${currentQueue.rawAmount}\n` +
                                               `👉 อนุมัติแบบติดโปรพิมพ์: B ${currentQueue.memberId} [ยอดรวมโบนัส]`+
                                               `👉 ปฏิเสธพิมพ์: cc ${currentQueue.memberId}n`;

                    // 🚀 4. สั่ง Push ส่งรูปภาพ + ข้อความ หาแอดมินพร้อมกัน
                    await axios.post('https://api.line.me/v2/bot/message/push', {
                        to: ADMIN_ID,
                        messages: [
                            { type: 'image', originalContentUrl: myServerUrl, previewImageUrl: myServerUrl },
                            { type: 'text', text: adminNotifyMessage }
                        ]
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TOKEN}`
                        }
                    });

                    // 💬 5. ตอบกลับแจ้งสมาชิกฝั่งลูกค้าตามปกติ
                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                        replyToken: replyToken,
                        messages: [{ type: 'text', text: `✅ ได้รับรูปภาพสลิปยอด ${currentQueue.displayAmount} บาท เรียบร้อยแล้ว!\n\n⏳ ระบบกำลังตรวจสอบความถูกต้อง รอเครดิตเข้าสักครู่ครับ` }]
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TOKEN}`
                        }
                    });

                } catch (err) {
                    console.error("❌ ระบบแจ้งเตือนรูปสลิปล้มเหลว:", err.message);
                }
                return res.sendStatus(200); 
            }
            
            return res.sendStatus(200);
        }
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
                // 🚨 เปลี่ยนตรงนี้: เช็กว่า ID คนพิมพ์อยู่ในกล่องแอดมินไหม
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
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
                                // 🚨 [ดักคนเหลี่ยม] เช็กก่อนว่าสมาชิกคนนี้ได้พิมพ์ "ฝาก" เพื่อเปิดยอดฝากไว้จริงไหม
                                if (!global.depositQueue || !global.depositQueue[foundUserKey] || global.depositQueue[foundUserKey].status !== 'WAITING_ADMIN') {
                                    replyText = `❌ เติมเงินไม่สำเร็จ! \n สมาชิกเลข ${targetMemberId} ยังไม่ได้พิมพ์ฝากเข้ามาในระบบ หรือยอดนี้เคยเติมไป`;
                                } else {
                                    usersWallets[foundUserKey].balance += amount;
                                    const user = usersWallets[foundUserKey];
                                    
                                    // 🧼 ล้างคิวฝากทิ้งทันที
                                    delete global.depositQueue[foundUserKey]; 

                                    await saveDataToFirebase(); 
                                    replyText = `💰 เติมเครดิตสมาชิกที่ ${user.memberNumber} \n คุณ ${user.name} +${amount} สำเร็จ!\n──────────────────\nยอดสุทธิ: ${user.balance} บาท`;
                                }
                            } else if (command === "ลบ") {
                                usersWallets[foundUserKey].balance -= amount;
                                const user = usersWallets[foundUserKey];
                                await saveDataToFirebase(); 
                                replyText = `🚨 ลบยอดเครดิตสมาชิกที่ ${user.memberNumber} \n คุณ ${user.name} -${amount}!\n──────────────────\nยอดปัจจุบัน: ${user.balance} บาท`;
                            }
                        }
                    }
                }
            }
// ==================== [ ระบบเติมเงินแบบติดโปรโบนัสคูณ 25 (B เลขสมาชิก จำนวนเงิน) ] ====================
            else if (command === "B" || command === "b") {
                // 🚨 เช็กว่า ID คนพิมพ์อยู่ในกล่องแอดมินไหม
                if (!ADMIN_IDS.includes(userId)) {
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
                            // 🚨 [ดักคนเหลี่ยม] เช็กคิวฝากเงินก่อนให้โปรโบนัส
                            if (!global.depositQueue || !global.depositQueue[foundUserKey] || global.depositQueue[foundUserKey].status !== 'WAITING_ADMIN') {
                                replyText = `❌ เติมโบนัสไม่สำเร็จ! สมาชิกหมายเลข ${targetMemberId} ยังไม่ได้พิมพ์เปิดยอดฝากเข้ามาในระบบ หรือยอดนี้เคยถูกเติมไปแล้วครับน้า`;
                            } else {
                                const user = usersWallets[foundUserKey];
                                user.balance += amount;

                                // 🔄 คำนวณยอดเทิร์นใหม่ของบิลนี้
                                let newTurnoverTarget = amount * 25; 

                                // 📊 ดึงยอดเทิร์นเดิมมาเช็ก ถ้าไม่มีหรือเป็นค่าว่างให้เริ่มต้นจาก 0 แล้วบวกทบเข้าไป
                                let currentTurnover = user.turnoverTarget;
                                if (!currentTurnover || isNaN(currentTurnover)) {
                                    currentTurnover = 0;
                                }
                                user.turnoverTarget = currentTurnover + newTurnoverTarget;
                                
                                // 🧼 ล้างคิวฝากทิ้งทันที
                                delete global.depositQueue[foundUserKey];
                                await saveDataToFirebase();

                                replyText = `🎁 เติมโบนัสให้สมาชิกที่ [ ${user.memberNumber} ] \n คุณ ${user.name} สำเร็จ!\n──────────────────\n` +
                                            `💰 ยอดสุทธิ: +${amount} บาท\n──────────────────\n` +
                                            `🔒 เงื่อนไข ต้องทำยอดเทิร์นสะสม (ได้/เสีย) เพิ่ม: +${newTurnoverTarget} บาท\n` +
                                            `📊 ยอดเทิร์นคงเหลือรวมทั้งหมด: ${user.turnoverTarget} บาท`;
                            }
                        }
                    }
                }
            }
                // ==================== [ 🧼 คำสั่งแอดมินพิเศษ: ล้างยอดเทิร์นโอเวอร์สมาชิก (พิมพ์: bb [เลขสมาชิก]) ] ====================
            else if (command === "bb") {
                // 👥 เช็กสิทธิ์แอดมินจากกล่องรวมกลาง
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    const targetMemberId = parseInt(args[1]);

                    if (!targetMemberId || isNaN(targetMemberId)) {
                        replyText = `⚠️ รูปแบบคำสั่งไม่ถูกต้องน้า\nกรุณาพิมพ์: bb [เลขสมาชิก]\n(ตัวอย่างเช่น: bb 1)`;
                    } else {
                        let foundUserKey = null;
                        for (let key in usersWallets) {
                            if (usersWallets[key].memberNumber === targetMemberId) {
                                foundUserKey = key;
                                break;
                            }
                        }

                        if (!foundUserKey) {
                            replyText = `❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับน้า`;
                        } else {
                            const user = usersWallets[foundUserKey];
                            
                            // 🧼 เคลียร์ยอดเทิร์นค้างเก่าทั้งหมดให้เป็น 0 ชัวร์ ๆ
                            user.turnoverTarget = 0;
                            
                            // 💾 บันทึกการเปลี่ยนแปลงลง Firebase ถาวร
                            await saveDataToFirebase();

                            replyText = `🧼 [ระบบล้างยอดเทิร์นโอเวอร์] \n👤 คุณ ${user.name} (สมาชิกที่ ${user.memberNumber})\n✅ ทำการล้างยอดเทิร์นค้างเก่าทั้งหมดสำเร็จแล้วครับ!\n──────────────────\n📊 ยอดเทิร์นคงเหลือที่ต้องทำ: 0 บาท\n💰 เครดิตคงเหลือในกระเป๋า: ${user.balance} บาท`;
                        }
                    }
                }
            }
// =================================================================
// ❌ [คำสั่งแอดมิน] ยกเลิกคิวแจ้งฝากเงิน (พิมพ์: cc [เลขสมาชิก])
// =================================================================
            else if (command === "cc" || command === "Cc" || command === "CC") {
                // 🚨 เปลี่ยนตรงนี้: เช็กว่า ID คนพิมพ์อยู่ในกล่องแอดมินไหม
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    const targetMemberId = parseInt(args[1]); // ดึงเลขสมาชิกจากช่องที่สอง เช่น cc 1

                    if (!targetMemberId || isNaN(targetMemberId)) {
                        replyText = "❌ รูปแบบผิดครับน้า! ต้องพิมพ์เช่น: cc [เลขสมาชิก] (ตัวอย่าง: cc 12)";
                    } else {
                        // ค้นหาในคิวฝากว่า เลขสมาชิกนี้ตรงกับ userId ไหนในระบบ RAM
                        let foundUserKey = null;

                        if (global.depositQueue) {
                            for (let key in global.depositQueue) {
                                if (global.depositQueue[key].memberId === targetMemberId) {
                                    foundUserKey = key;
                                    break;
                                }
                            }
                        }

                        // 🧼 ถ้าเจอคิว ให้ทำการลบออกจากระบบทันที
                        if (foundUserKey) {
                            const currentQueue = global.depositQueue[foundUserKey];
                            delete global.depositQueue[foundUserKey]; // ล้างคิวออกจาก RAM
                            
                            replyText = `❌ [แอดมินสั่งยกเลิก] ทำการยกเลิกและล้างคิวฝากของ สมาชิกลำดับที่: ${targetMemberId} เรียบร้อยแล้วครับน้า!`;

                            // 💬 ส่งข้อความไปเตือนฝั่งลูกค้าให้รู้ตัวด้วยว่าโดนปฏิเสธคิว
                            try {
                                await axios.post('https://api.line.me/v2/bot/message/push', {
                                    to: foundUserKey,
                                    messages: [{ 
                                        type: 'text', 
                                        text: `❌ รายการแจ้งฝากยอดเงินของถูกปฏิเสธ/ยกเลิกโดยแอดมินครับ\n\n⚠️ เหตุผล: สลิปไม่ถูกต้อง หรือยอดเงินไม่ตรง\n👉 หากต้องการทำรายการใหม่ กรุณาพิมพ์คำสั่ง "ฝาก [ยอดเงิน]" อีกครั้ง\n────────────────\nหรือติดต่อแอดมิน\n🔻🔻🔻🔻\nhttps://lin.ee/ySA60EA` 
                                    }]
                                }, {
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${TOKEN}`
                                    }
                                });
                            } catch (err) {
                                console.error("❌ ส่งข้อความแจ้งยกเลิกหาลูกค้าล้มเหลว:", err.message);
                            }

                        } else {
                            replyText = `❌ ไม่พบรายการคิวฝากค้างในระบบที่ตรงกับสมาชิกลำดับที่ ${targetMemberId} ครับน้า เช็กตัวเลขดีๆ อีกทีครับ`;
                        }
                    }
                }
            }
             // ==================== [ 🛠️ คำสั่งแอดมินพิเศษ: เติมเครดิตฉุกเฉิน/แจกทุน+ติดเทิร์น (พิมพ์: @ [เลขสมาชิก] [จำนวนเงิน] หรือ @ [เลขสมาชิก] [จำนวนเงิน]#[ยอดเทิร์น]) ] ====================
            else if (command === "@") {
                // 👥 เช็กสิทธิ์แอดมินจากกล่องรวมกลาง
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    const targetMemberId = parseInt(args[1]);
                    let rawAmountStr = args[2] ? args[2].toString() : "";      

                    if (!targetMemberId || !rawAmountStr) {
                        replyText = `⚠️ รูปแบบคำสั่งไม่ถูกต้องน้า\n👉 เติมปกติ: @ [เลขสมาชิก] [จำนวนเงิน] (เช่น: @ 1 200)\n👉 แจกทุนติดเทิร์น: @ [เลขสมาชิก] [จำนวนเงิน]#[ยอดเทิร์น] (เช่น: @ 1 200#1000)`;
                    } else {
                        let amount = 0;
                        let turnoverRequirement = 0;

                        // 🔍 ตรวจสอบว่ามีการใส่สัญลักษณ์ # เพื่อกำหนดเทิร์นโอเวอร์ไหม
                        if (rawAmountStr.includes('#')) {
                            const parts = rawAmountStr.split('#');
                            amount = parseFloat(parts[0]);
                            turnoverRequirement = parseFloat(parts[1]);
                        } else {
                            amount = parseFloat(rawAmountStr);
                        }

                        if (isNaN(amount) || amount <= 0 || isNaN(turnoverRequirement) || turnoverRequirement < 0) {
                            replyText = `⚠️ จำนวนเงิน หรือยอดเทิร์นโอเวอร์ไม่ถูกต้องครับน้า กรุณาเช็กตัวเลขอีกครั้งครับ`;
                        } else {
                            let foundUserKey = null;
                            for (let key in usersWallets) {
                                if (usersWallets[key].memberNumber === targetMemberId) {
                                    foundUserKey = key;
                                    break;
                                }
                            }

                            if (!foundUserKey) {
                                replyText = `❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับน้า`;
                            } else {
                                // 🚀 บวกเงินเข้ากระเป๋าทันที ทะลุทุกระบบล็อก!
                                usersWallets[foundUserKey].balance += amount;
                                
                                // 📝 บันทึกยอดเทิร์นโอเวอร์สะสมเข้าไปในตัวแปรหลัก (ดักจับถ้าเป็นค่าว่างให้เป็น 0 ก่อนแล้วค่อยบวกทบ)
                                if (turnoverRequirement > 0) {
                                    let currentTurnover = usersWallets[foundUserKey].turnoverTarget;
                                    if (!currentTurnover || isNaN(currentTurnover)) {
                                        currentTurnover = 0;
                                    }
                                    usersWallets[foundUserKey].turnoverTarget = currentTurnover + turnoverRequirement;
                                }

                                const user = usersWallets[foundUserKey];
                                await saveDataToFirebase(); 
                                
                                // 📱 ประกอบข้อความแจ้งเตือนแอดมินและสมาชิก
                                replyText = `⚡ [ระบบจัดการเครดิตแอดมิน] \n👤 คุณ ${user.name} (สมาชิกที่ ${user.memberNumber})\n💰 ได้รับเครดิต: +${amount} บาท\n`;
                                if (turnoverRequirement > 0) {
                                    replyText += `⚠️ [ติดเงื่อนไข] ต้องทำยอดเทิร์นเพิ่ม: +${turnoverRequirement} บาท\n`;
                                    replyText += `📊 ยอดเทิร์นคงเหลือรวมที่ต้องทำ: ${user.turnoverTarget || 0} บาท\n`;
                                } else {
                                    replyText += `✅ รูปแบบ: เติมเงินสดปกติ (ไม่ติดเทิร์น)\n`;
                                }
                                replyText += `──────────────────\n💰 ยอดเงินปัจจุบัน: ${user.balance} บาท`;
                            }
                        }
                    }
                }
            }
// ==================== [ ระบบแจ้งฝากเงินสุ่มเศษสตางค์ ] ====================
            else if (command === "ฝาก") {
                const amount = parseInt(args[1]);

                if (!amount || isNaN(amount) || amount <= 0) {
                    replyText = '❌ พิมพ์รูปแบบผิดครับน้า! ต้องพิมพ์เช่น: ฝาก 500';
                } else {
                    const walletData = usersWallets[userId];

                    if (!walletData) {
                        replyText = '❌ ยังไม่ได้สมัครสมาชิก \n พิมพ์ C/ชื่อ-นามสกุล,ธนาคาร,เลขธนาคาร เพื่อสมัครก่อนครับ';
                    } else {
                        if (!global.depositQueue) global.depositQueue = {};

                        const currentQueue = global.depositQueue[userId];

                        if (currentQueue && currentQueue.status === 'WAITING_ADMIN') {
                            replyText = `⚠️ มีรายการแจ้งฝากค้างอยู่ในระบบ\n💰 ยอดที่ต้องโอน: ${currentQueue.displayAmount} บาท\n────────────────\n🔒 ระบบล็อกไม่ให้แจ้งฝากซ้ำ \n จนกว่าจะอนุมัติเติมเงินจากแอดมิน`;
                        } else {
                            const randomSatang = (Math.floor(Math.random() * 99) + 1) / 100;
                            const totalWithSatang = amount + randomSatang;
                            const displayAmount = totalWithSatang.toFixed(2);

                            global.depositQueue[userId] = {
                                memberId: walletData.memberNumber,
                                name: walletData.name || 'ไม่ระบุชื่อ',
                                rawAmount: amount,
                                displayAmount: displayAmount,
                                status: 'WAITING_ADMIN'
                            };

                            replyText = `📥 รับแจ้งฝากเรียบร้อ\n────────────────\n💸 กรุณาโอนเงินจำนวน:  ${displayAmount} บาท\nเข้า บัญชี ด่านล่างนี้เท่านั้น\n────────────────\nเลขบัญชีการโอน\n037-1556-125\nธนาคาร กสิกร\nชื่อ นาย ภาณุวัฒก์ ก้องกุล\n────────────────\⚠️ สำคัญมาก: กรุณาโอนยอดเงินและใส่เศษสตางค์ให้ตรงตามที่ระบบแจ้งพร้อมส่งสลิป\n เพื่อความรวดเร็วในการตรวจสอบ`;
                        }
                    }
                }
            }
                // ==================== [ คำสั่งแอดมิน: ชถ (เช็กรายการรอถอนเงินทั้งหมด) ] ====================
            else if (userMsg.trim() === 'ชถ') {
               // 🚨 เปลี่ยนตรงนี้: เช็กว่า ID คนพิมพ์อยู่ในกล่องแอดมินไหม
                if (!ADMIN_IDS.includes(userId)) {
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
    if (!ADMIN_IDS.includes(userId)) {
    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
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
            usersRoundCrossCheck = {};

            await saveDataToFirebase(); //💾เซฟถาวร
            
            replyText = "🔄 ทำการล้างลำดับรอบเรียบร้อยแล้ว! รอบต่อไปจะเริ่มต้นที่ รอบที่ 1 ครับ ⚙️";
        }
    }
}
            // ==================== [ 3. แอดมิน เปิด/ปิดรอบจั่วไพ่ - เวอร์ชันบล็อกพิมพ์ซ้ำ ] ====================
else if (userMsg === 'oo' || userMsg === 'xx') {
                if (!ADMIN_IDS.includes(userId)) {
    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
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
                        if (!usersRoundCrossCheck[userId]) {
                            usersRoundCrossCheck[userId] = {};
                        }
                        let betTracker = usersRoundCrossCheck[userId];

                        const allowedLegs = ['1', '2', '3', '4', '5', '6'];
                        const MIN_BET = 10;
                        const MAX_BET = 2500;

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
                                // 🟠 [แทรกดัก มข] วนเช็กขา 1-6 ว่ามีใครแทงฝั่งเจ้ามือ (dealer) ค้างไว้ไหม
                                for (let c = 1; c <= 6; c++) {
                                    if (betTracker[c] && betTracker[c] === 'dealer') {
                                        hasError = true;
                                        errorMsg = `❌ แทง มข ไม่ได้! ขา ${c} มีการแทงฝั่งเจ้ามือค้างไว้แล้วในรอบนี้`;
                                        break;
                                    }
                                }
                                if (hasError) break; // ถ้าเออเร่อ ให้หลุดออกจากลูปตรวจโพยทันที
                                
                                // ถ้าผ่านหมด ให้บันทึกว่าทั้ง 6 ขาถูกจองฝั่งผู้เล่น (player)
                                for (let c = 1; c <= 6; c++) { betTracker[c] = 'player'; }
                                
                            } else if (targetStr === "มจ") {
                                legsCount = 6;
                                betTypeDetail = `แทงเจ้ามือสู้ทุกขา (6 ขา) ขาละ ${price} บาท`;
                                // 🟠 [แทรกดัก มจ] วนเช็กขา 1-6 ว่ามีใครแทงฝั่งผู้เล่น (player) ค้างไว้ไหม
                                for (let c = 1; c <= 6; c++) {
                                    if (betTracker[c] && betTracker[c] === 'player') {
                                        hasError = true;
                                        errorMsg = `❌ แทง มจ ไม่ได้! ขา ${c} มีการแทงฝั่งผู้เล่นค้างไว้แล้วในรอบนี้`;
                                        break;
                                    }
                                }
                                if (hasError) break; // ถ้าเออเร่อ ให้หลุดออกจากลูปตรวจโพยทันที

                                // ถ้าผ่านหมด ให้บันทึกว่าทั้ง 6 ขาถูกจองฝั่งเจ้ามือ (dealer)
                                for (let c = 1; c <= 6; c++) { betTracker[c] = 'dealer'; }
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
                                // 🟠 [แทรกดัก จ+เลขขา] ตรวจสอบทีละขาที่พิมพ์มา
                                const targetLegs = legs.split('');
                                for (let c of targetLegs) {
                                    if (betTracker[c] && betTracker[c] === 'player') {
                                        hasError = true;
                                        errorMsg = `❌ แทงสวนไม่ได้! ขา ${c} มีการแทงฝั่งผู้เล่นไปแล้วในรอบนี้`;
                                        break;
                                    }
                                }
                                if (hasError) break;

                                // ถ้าผ่านหมด บันทึกฝั่งเจ้ามือลงไปในขานั้น ๆ
                                for (let c of targetLegs) { betTracker[c] = 'dealer'; }
                            } else {
                                let isLegsValid = targetStr.split('').every(char => allowedLegs.includes(char));
                                if (!isLegsValid) {
                                    hasError = true;
                                    errorMsg = `❌ บันทึกโพยล้มเหลว! ห้องนี้มีแค่ ขา 1 ถึง ขา 6 เท่านั้นครับ\n(พบข้อผิดพลาดที่ขาผู้เล่น: "${line}")`;
                                    break;
                                }
                                legsCount = targetStr.length;
                                betTypeDetail = `แทงขา [${targetStr.split('').join(', ')}] ขาละ ${price} บาท`;
                                // 🟠 [แทรกดัก ผู้เล่นรายขา] ตรวจสอบทีละขาที่พิมพ์มา
                                const targetLegs = targetStr.split('');
                                for (let c of targetLegs) {
                                    if (betTracker[c] && betTracker[c] === 'dealer') {
                                        hasError = true;
                                        errorMsg = `❌ แทงสวนไม่ได้! ขา ${c} มีการแทงฝั่งเจ้ามือไปแล้วในรอบนี้`;
                                        break;
                                    }
                                }
                                if (hasError) break;

                                // ถ้าผ่านหมด บันทึกฝั่งผู้เล่นลงไปในขานั้น ๆ
                                for (let c of targetLegs) { betTracker[c] = 'player'; }
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

                        // ==================== [ 🌟 เริ่มต้นระบบค้ำประกันเด้งอัจฉริยะ ] ====================
                        if (!hasError && totalActualBet > 0) {
                            let finalHoldCost = 0;
                            let maxHandMultiplier = 3; // ค่าตั้งต้นคือค้ำ 3 เด้งปกติ
                            let limitReasonText = "";

                            const doubleHoldCost = totalActualBet * 2; // ยอดค้ำประกันขั้นต่ำ (2 เด้ง)
                            const tripleHoldCost = totalActualBet * 3; // ยอดค้ำประกันปกติ (3 เด้ง)

                            if (user.balance < doubleHoldCost) {
                                // ❌ เคสเงินไม่พอแม้กระทั่ง 2 เด้ง -> ไม่ให้แทง
                                replyText = `❌ เครดิตของคุณไม่พอสำหรับค้ำประกันขั้นต่ำ (2 เด้ง) ครับ!\n💸 ยอดแทงรวม: ${totalActualBet} บาท\n🔒 ต้องใช้ยอดค้ำประกันขั้นต่ำ (x2): ${doubleHoldCost} บาท\n💰 เครดิตปัจจุบันของคุณมี: ${user.balance} บาท`;
                                hasError = true;
                            } 
                            else if (user.balance >= doubleHoldCost && user.balance < tripleHoldCost) {
                                // 🍊 เคสเงินพอแค่ 2 เด้ง แต่ไม่ถึง 3 เด้ง -> ยอมให้แทงแต่จำกัดสิทธิ์จ่าย/หักสูงสุดแค่ 2 เด้ง
                                maxHandMultiplier = 2;
                                finalHoldCost = doubleHoldCost;
                                limitReasonText = `\n⚠️ เนื่องจากเครดิตของคุณไม่พอค้ำประกัน 3 เด้ง (ขาดอีก ${tripleHoldCost - user.balance} บาท)\n──────────────────\n🎯 โพยชุดนี้ระบบจะคิดผลได้-เสียให้สูงสุด "ไม่เกิน 2 เด้ง" เท่านั้น`;
                            } 
                            else {
                                // 🟢 เคสเงินพอค้ำ 3 เด้งสมบูรณ์แบบ
                                maxHandMultiplier = 3;
                                finalHoldCost = tripleHoldCost;
                            }

                            // ถ้าผ่านด่านการเงิน (ไม่มี Error) ทำการบันทึกและตัดยอดเครดิต
                            if (!hasError) {
                                user.balance -= finalHoldCost; // หักเงินค้ำประกันตามจริง (x2 หรือ x3)
                                await saveDataToFirebase();
                                
                                if (!roundBets[userId]) {
                                    roundBets[userId] = [];
                                }

                                let summaryText = `✅ บันทึกโพยเรียบร้อย 🎉\n──────────────────\n👤 คุณ: ${user.name} (ID: ${user.memberNumber})\n──────────────────\n📝 รายการแทง\n──────────────────\n`;
                                
                                processedBets.forEach((bet) => {
                                    summaryText += `• ${bet.detail}\n`; 
                                    
                                    roundBets[userId].push({
                                        name: user.name,
                                        memberNumber: user.memberNumber,
                                        betType: bet.type,
                                        detail: bet.detail,
                                        pricePerLeg: bet.pricePerLeg,
                                        actualBet: bet.actualBet,
                                        holdCost: (bet.actualBet * maxHandMultiplier), // บันทึกยอดค้ำตามจริงลงฐานข้อมูล
                                        maxMultiplier: maxHandMultiplier, // 🔑 คีย์เวิร์ดสำคัญส่งไปให้ระบบคิดผลได้เสียอ่านค่า
                                        time: new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' })
                                    });
                                });
                                
                                summaryText += `──────────────────\n💵 ยอดแทงรวม: ${totalActualBet} บาท\n🔒 หักค้ำประกันรอบนี้ (x${maxHandMultiplier}): ${finalHoldCost} บาท\n💰 เครดิตคงเหลือ: ${user.balance} บาท\n──────────────────${limitReasonText}\n 🔔 ระบบจะคืนเครดิตส่วนต่างให้ตอนสรุปผลครับ`;
                                replyText = summaryText;
                            }
                        } else if (!hasError && totalActualBet === 0) {
                            replyText = "⚠️ ไม่พบรายการแทงในข้อความของคุณครับ";
                        }

                        if (hasError && errorMsg !== "") {
                            replyText = errorMsg;
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
                            await saveDataToFirebase(); //💾เซฟถาวร
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
               // ==================== [ 8. ระบบแอดมินส่งผลสรุปคำนวณแต้ม - เวอร์ชันชำแหละ RegEx แยกฝั่งขาด (เด้ง=/ , ป๊อก=*) ] ====================
else if (originalMsg.startsWith('>')) {
    if (!ADMIN_IDS.includes(userId)) {
        replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งสรุปผลคะแนนครับ";
    } else if (isRoundOpen) {
        replyText = "⚠️ ต้องพิมพ์ปิดรอบแทง (X) และทำขั้นตอนจั่วไพ่ให้เสร็จก่อน จึงจะสรุปผลได้ครับ";
    } else {
        let textWithoutArrow = originalMsg.substring(1).trim();
        const parts = textWithoutArrow.split(/\s+/); // แยกชิ้นส่วนด้วยเว้นวรรคหรือขึ้นบรรทัดใหม่
        
        if (parts.length < 2) {
            replyText = "⚠️ รูปแบบผิดครับน้า! ต้องพิมพ์เรียง ขา1 ขา2 ... และตัวสุดท้ายคือเจ้ามือ (คั่นด้วยเว้นวรรค)";
            return res.sendStatus(200);
        }

        // 🛠️ ฟังก์ชันแกะรหัสไพ่ (นับสแลชแม่นยำ ไม่โดนตัวอื่นแย่ง)
        const parseCardStr = (str, isDealer = false, isThreeCards = false, forcePok = false) => {
            let clean = str.trim().toLowerCase();
            let isPok = forcePok; 
            let multiplier = 1; 
            let typeName = "แต้มปกติ";
            let rawScore = 0;

            // 🎯 นับเครื่องหมาย / เพื่อคิดเด้งแบบตรงตัว
            const slashCount = (clean.match(/\//g) || []).length;
            if (slashCount === 2) { multiplier = 3; }
            else if (slashCount === 1) { multiplier = 2; }
            
            // ลบเครื่องหมาย / ออกทั้งหมดเพื่อส่องดูแต้มเนื้อๆ
            clean = clean.replace(/\//g, '');

            // เช็กป๊อกเจ้ามือ
            if (isDealer && clean.includes('*')) { isPok = true; clean = clean.replace('*', ''); }

            // แปลงแต้มพิเศษ (รองรับทั้งไทยและอังกฤษ)
            if (clean === 't' || clean === 'ต') { rawScore = 700; multiplier = 5; typeName = "ตอง"; } 
            else if (clean === 'sf') { rawScore = 600; multiplier = 5; typeName = "สเตฟฟลัช"; } 
            else if (clean === 'h') { rawScore = 500; multiplier = 3; typeName = "เซียน/3เหลือง"; } 
            else if (clean === 's' || clean === 'ร') { rawScore = 400; multiplier = 3; typeName = "เรียง"; } 
            else {
                let pts = parseInt(clean);
                if (isNaN(pts)) pts = 0;
                
                // สำหรับผู้เล่น ถ้าแต้มเป็น 8 หรือ 9 โดดๆ ให้ถือเป็นไพ่ป๊อกอัตโนมัติ
                if (!isDealer && (pts === 8 || pts === 9)) {
                    isPok = true;
                }

                if (isPok) {
                    if (pts === 9) { rawScore = 900; typeName = "ป๊อก 9"; }
                    else if (pts === 8) { rawScore = 800; typeName = "ป๊อก 8"; }
                    else { rawScore = pts; typeName = `${pts} แต้ม`; }
                } else {
                    rawScore = pts; typeName = `${pts} แต้ม`;
                }
            }
            return { score: rawScore, v: clean, mult: multiplier, name: typeName };
        };

        // 👑 แกะรหัสเจ้ามือ (ตัวสุดท้าย)
        const dealerRawStr = parts[parts.length - 1]; 
        const dealerResult = parseCardStr(dealerRawStr, true, false);

        let roomResults = {}; 
        const totalLegsToSend = Math.min(parts.length - 1, 6);

        // 🔄 วนลูปแกะรหัสผู้เล่นรายขา
        for (let i = 0; i < totalLegsToSend; i++) {
            let innerContent = parts[i].trim();
            if (innerContent === "") continue;

            let currentLeg = i + 1;
            let result2Cards = null;
            let result3Cards = null;

            // 🔥 [ใช้ระบบ RegEx ชำแหละข้อความขั้นสูง] แยกกลุ่มตัวเลขและเครื่องหมายสแลชออกจากกัน
            // มองหาโครงสร้าง: (แต้มตัวแรก+สแลชฝั่งซ้าย) ตามด้วย (แต้มตัวหลัง+สแลชฝั่งขวา)
            const match = innerContent.match(/^([0-9tshfตร]\/*)([0-9tshfตร]\/*)$/i);

            if (match) {
                // ผ่าแยกฝั่งซ้าย (2 ใบ) และ ฝั่งขวา (3 ใบ) ออกจากกันแบบเด็ดขาดร้อยเปอร์เซ็นต์!
                const part1 = match[1]; // เช่น "6/"
                const part2 = match[2]; // เช่น "6//"
                
                result2Cards = parseCardStr(part1, false, false);
                result3Cards = parseCardStr(part2, false, true);
            } 
            // กรณีพิมพ์ตัวเดียวโดดๆ เช่น "6" หรือป๊อกโดดๆ เช่น "8", "9"
            else {
                let pts = parseInt(innerContent);
                if (!isNaN(pts) && (pts === 8 || pts === 9)) {
                    result2Cards = parseCardStr(innerContent, false, false, true);
                    result3Cards = parseCardStr(innerContent, false, true, true);
                } else {
                    result2Cards = parseCardStr(innerContent, false, false, false);
                    result3Cards = parseCardStr(innerContent, false, true, false);
                }
            }

            roomResults[currentLeg] = {
                leg: currentLeg,
                twoCards: result2Cards,
                threeCards: result3Cards
            };
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
                checkText += `    - [2ใบ]: ${res.twoCards.name} (${res.twoCards.mult}เด้ง) ${status2Str}\n`;
                checkText += `    - [3ใบ]: ${res.threeCards.name} (${res.threeCards.mult}เด้ง) ${status3Str}\n──────────────────\n`;
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
    if (!ADMIN_IDS.includes(userId)) return;

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
                                // 🌟 [จุดเปลี่ยนที่ 1]: ดักเพดานเด้งฝั่งผู้เล่นชนะตามจริงที่มีการค้ำประกันไว้ (x2 หรือ x3)
                                if (bet.maxMultiplier && winMultiplier > bet.maxMultiplier) {
                                    winMultiplier = bet.maxMultiplier;
                                }
                                userTotalWinLoss += (betPrice * winMultiplier);
                            } 
                            else if (finalCard.score < tempDealerResult.score) {
                                let loseMultiplier = tempDealerResult.mult;
                                if (loseMultiplier > 3) {
                                    loseMultiplier = 3;
                                }
                                // 🌟 [จุดเปลี่ยนที่ 2]: ดักเพดานเด้งฝั่งผู้เล่นแพ้ (ถ้าเขาค้ำไว้แค่ 2 เด้ง ก็โดนหักสูงสุดแค่ 2 เด้ง)
                                if (bet.maxMultiplier && loseMultiplier > bet.maxMultiplier) {
                                    loseMultiplier = bet.maxMultiplier;
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
                                // 🌟 [จุดเปลี่ยนที่ 3]: ดักเพดานเด้งฝั่งคนแทงเจ้าชนะตามสิทธิ์ที่ค้ำประกันไว้
                                if (bet.maxMultiplier && winMultiplier > bet.maxMultiplier) {
                                    winMultiplier = bet.maxMultiplier;
                                }
                                let grossWin = betPrice * winMultiplier; // กำไรเต็มก่อนหัก
                                
                                // 🔥 หักต๋งรายขาทันที 10% (เหลือจ่ายจริง 90%)
                                let netWin = Math.floor(grossWin * 0.9);
                                userTotalWinLoss += netWin;
                            } 
                            else if (tempDealerResult.score < finalCard.score) {
                                // เจ้ามือแพ้ขาผู้เล่นคนนั้น = คนแทงฝั่งเจ้าเสียเต็มจำนวนตามจำนวนเด้งของขานั้นๆ
                                let loseMultiplier = finalCard.mult;
                                // 🌟 [จุดเปลี่ยนที่ 4]: ดักเพดานเด้งฝั่งคนแทงเจ้าเสีย (ถ้าเขาค้ำไว้ 2 เด้ง ก็ลบไม่เกิน 2 เด้ง)
                                if (bet.maxMultiplier && loseMultiplier > bet.maxMultiplier) {
                                    loseMultiplier = bet.maxMultiplier;
                                }
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

                await saveDataToFirebase(); //เซฟถาวร

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

            await saveDataToFirebase(); //เซฟถาวร

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
                                        // 🌟 คำนวณหาเพดานค้ำประกันสูงสุดแบบชัวร์ ๆ
    let maxLimit = 3; // ค่าตั้งต้น
    if (bet.maxMultiplier) {
        maxLimit = bet.maxMultiplier;
    } else if (bet.holdCost && bet.actualBet) {
        maxLimit = Math.round(bet.holdCost / bet.actualBet);
    }

    // 🌟 ดักเพดานตัวคูณชนะ ไม่ให้เกินที่ค้ำประกันไว้ในโพย
    let winMultiplier = finalCard.mult;
    if (winMultiplier > maxLimit) {
        winMultiplier = maxLimit;
    }

    let profit = bet.pricePerLeg * winMultiplier;
    totalWinLoss += profit;
    detailRows += `ขาที่ ${legStr} ${statusAction} ชนะ +${profit} (x${winMultiplier})\n`;
} else if (finalCard.score < historicalDealer.score) {
                                        let loseMultiplier = historicalDealer.mult;
                                        if (loseMultiplier > 3) {
                                            loseMultiplier = 3;
                                        }
                                        // 🌟 ดักเพดานตัวคูณแพ้ ไม่ให้เกินที่ค้ำประกันไว้ในโพยเช่นกัน
                                    if (bet.maxMultiplier && loseMultiplier > bet.maxMultiplier) {
                                    loseMultiplier = bet.maxMultiplier;
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
    // 🌟 คำนวณหาเพดานค้ำประกันสูงสุดแบบชัวร์ ๆ
    let maxLimit = 3;
    if (bet.maxMultiplier) {
        maxLimit = bet.maxMultiplier;
    } else if (bet.holdCost && bet.actualBet) {
        maxLimit = Math.round(bet.holdCost / bet.actualBet);
    }

    let dealerWinMult = historicalDealer.mult;
    if (dealerWinMult > maxLimit) {
        dealerWinMult = maxLimit;
    }

    let grossWin = bet.pricePerLeg * dealerWinMult;
    let netWin = Math.floor(grossWin * 0.9);
    totalWinLoss += netWin;
    detailRows += `ขาที่ ${legStr} ${statusAction} เจ้าชนะ +${netWin} (หักต๋งแล้ว) (x${dealerWinMult})\n`;
} else if (historicalDealer.score < finalCard.score) {
    // 🌟 คำนวณหาเพดานค้ำประกันสูงสุดแบบชัวร์ ๆ
    let maxLimit = 3;
    if (bet.maxMultiplier) {
        maxLimit = bet.maxMultiplier;
    } else if (bet.holdCost && bet.actualBet) {
        maxLimit = Math.round(bet.holdCost / bet.actualBet);
    }

    let dealerLoseMult = finalCard.mult;
    if (dealerLoseMult > maxLimit) {
        dealerLoseMult = maxLimit;
    }

    let loss = bet.pricePerLeg * dealerLoseMult;
    totalWinLoss -= loss;
    detailRows += `ขาที่ ${legStr} ${statusAction} เจ้าแพ้ -${loss} (x${dealerLoseMult})\n`;
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
                        await saveDataToFirebase(); //เซฟถาวร
                        
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
    if (!ADMIN_IDS.includes(userId)) {
    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
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
                        await saveDataToFirebase();
                        
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
                            `🔓 สถานะบัญชี: ปลดล็อกเรียบร้อย`
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
            finalReply += `\n──────────────────\n📊 คงเหลือในคิวรอถอน: ${queueCount} รายการ (พิมพ์ "ชถ" เพื่อดูคิวปัจจุบัน)`;

            replyText = finalReply;
        }
    }
}
                // ==================== [ ระบบแอดมินเรียกดูรายงานผลและโพยย้อนหลัง (v เลขรอบ) ] ====================
            else if (command.toLowerCase() === "v") {
                if (!ADMIN_IDS.includes(userId)) {
    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
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
                        const registerData = originalMsg.substring(2).trim();
                        
                        // ตัดแบ่งข้อความด้วยเครื่องหมายจุลภาค ( , ) เพื่อแยก ชื่อ, ธนาคาร, เลขบัญชี
                        const dataParts = registerData.split(',');
                        const fullName = dataParts[0] ? dataParts[0].trim() : "";
                        const bankName = dataParts[1] ? dataParts[1].trim() : "";
                        const bankAccount = dataParts[2] ? dataParts[2].trim() : "";

                        // 🚨 [เช็กความครบถ้วน] ถ้าขาดสิ่งใดสิ่งหนึ่งไป หรือลืมใส่เครื่องหมายจุลภาค บอทจะไม่ให้ผ่าน!
                        if (fullName === "" || bankName === "" || bankAccount === "") {
                            replyText = `❌ สมัครสมาชิกไม่สำเร็จครับน้า ข้อมูลไม่ครบ!\n──────────────────\n⚠️ กรุณาพิมพ์คั่นด้วยเครื่องหมายจุลภาค ( , ) ให้ครบทั้ง 3 ส่วน\n📌 รูปแบบ: C/ชื่อ-นามสกุล,ธนาคาร,เลขบัญชี\n👉 ตัวอย่าง: C/นายแจ๊ค เด้งดี,กสิกร,1234567890`;
                        } else {
                            usersWallets[userId] = {
                                memberNumber: nextMemberId,
                                name: fullName,
                                balance: 0, 
                                turnoverTarget: 0,
                                turnoverCount: 0,
                                isWithdrawLocked: false,     // เพิ่มไว้รองรับระบบถอน
                                pendingWithdrawAmount: 0,    // เพิ่มไว้รองรับระบบถอน
                                bankName: bankName,          // 🏦 เก็บข้อมูลธนาคารหลังบ้าน
                                bankAccount: bankAccount     // 💳 เก็บเลขบัญชีหลังบ้าน
                            };
                            replyText = `🎉 ลงทะเบียนสมาชิกใหม่สำเร็จ! 🎉\n──────────────────\n🆔 คุณคือสมาชิกคนที่: ${nextMemberId}\n👤 ชื่อ-นามสกุล: ${fullName}\n🏦 ธนาคาร: ${bankName}\n💰 ยอดคงเหลือ: 0 บาท\n🔒 ข้อมูลบัญชีธนาคาร: บันทึกเข้าคลังหลังบ้านเรียบร้อยแล้ว ปลอดภัย ไม่แสดงหน้ากลุ่มค่ะ\n──────────────────\nตอนนี้คุณสามารถส่งโพยหรือพิมพ์ C เพื่อเช็คการ์ดสมาชิก\n──────────────────\nหรือฝากเครดิต พิม ฝาก จำนวนเงิน`;
                            nextMemberId++;
                            await saveDataToFirebase();
                        }
                    } else {
                        replyText = `📢 ยินดีต้อนรับครับสมาชิกใหม่\n──────────────────\n⚠️ คุณยังไม่ได้ลงทะเบียนในระบบ\n──────────────────\nกรุณาพิมพ์: C/ชื่อ-นามสกุล,ธนาคาร,เลขบัญชี เพื่อลงทะเบียนใช้งาน และ ใช้ในการถอนเครดิต\n(ตัวอย่าง: C/นายแจ๊ค เด้งดี,กสิกร,1234567890)\n──────────────────\n⚠️กรุณาใช้ชื่อ-นามสกุลให้ตรงกันกับ บช. ที่ใช้ในการฝากของท่าน⚠️`;
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

                        memberInfo += `\n──────────────────\n` +
                                      `📖 คู่มือช่วยเหลือสมาชิก\n` +
                                      `👉 พิมพ์ คส เพื่อดูคำสั่งทั้งหมด\n` +
                                      `👉 พิมพ์ ฝาก จำนวน เพื่อฝากยอด\n` +
                                      `👉 พิมพ์ ถอน จำนวน เพื่อถอนยอด\n` +
                                      `👉 พิมพ์ กต เพื่ออ่านกติกาห้อง`;

                        replyText = memberInfo;
                    } else if (originalMsg.startsWith('C/') || originalMsg.startsWith('c/')) {
                        // 🔒 [แก้ไขใหม่: บล็อกเหลี่ยม!] ป้องกันคนเก่าแอบพิมพ์ C/ มาเปลี่ยนชื่อหรือเลขบัญชีเองหลังบ้าน
                        replyText = `❌ ไม่สามารถเปลี่ยนข้อมูลเองได้ค่ะคุณ ${user.name}!\n──────────────────\n⚠️ เนื่องจากระบบได้ผูกบัญชีธนาคารของคุณไว้ในคลังความปลอดภัยแล้ว\n\n📌 หากต้องการเปลี่ยน ชื่อ-นามสกุล หรือ เลขบัญชีธนาคาร กรุณาทักแชทติดต่อแอดมินโดยตรงเพื่อขออัปเดตข้อมูลนะคะ 🙏`;
                    } else {
                        replyText = "";
                    }
                }
            } // ปิดระบบลงทะเบียน
            
            // ==================== [ แก้ไขบั๊ก m 1 2: คำสั่ง m เช็กบัญชีแยกรายคนด้วยเว้นวรรคอย่างแม่นยำ ] ====================
            if (userMsg.startsWith('m') && !userMsg.includes('-') && !userMsg.endsWith('+') && userMsg !== 'มข' && userMsg !== 'มจ') {
                // 🚨 กรองขั้นสูงสุด: ถ้าไม่ใช่แอดมินในกล่องกลาง หรือ แอดมินไม่ได้สั่งในแชทส่วนตัว (1 ต่อ 1) ให้บอทเงียบกริบไม่ตอบ
                if (!ADMIN_IDS.includes(userId) || event.source.type !== 'user') {
                    return res.sendStatus(200);
                }

                const args = userMsg.split(/\s+/);

                // 🛠️ แก้ไขจุดนี้: ดึงข้อความดิบทั้งหมดที่ต่อจากตัว m (เก็บเว้นวรรคเอาไว้ตัดแบ่ง)
                const rawData = originalMsg.substring(1).trim(); 
                
                // ตัดแบ่งข้อความด้วยช่องว่าง (เว้นวรรคกี่ช่องก็ได้) เพื่อแยกเป็นอาร์เรย์ตัวเลขเด็ดขาด
                const memberIds = rawData.split(/\s+/).map(id => parseInt(id)).filter(id => !isNaN(id));

                if (memberIds.length === 0) {
                    replyText = "⚠️ รูปแบบคำสั่งไม่ถูกต้องครับน้า กรุณาระบุเลขสมาชิกด้วยครับ เช่น m1 หรือ m 1 2 3";
                } else {
                    let totalReport = ""; // ตัวแปรสำหรับรวบรวมรายงานของทุกคน

                    // วนลูปตรวจสอบข้อมูลตามรายชื่อเลขสมาชิกที่ส่งเข้ามา
                    memberIds.forEach((targetMemberId, index) => {
                        let foundUser = null;
                        for (let id in usersWallets) {
                            if (usersWallets[id].memberNumber === targetMemberId) {
                                foundUser = usersWallets[id];
                                break;
                            }
                        }

                        // ถ้าตรวจสอบแล้วเจอข้อมูลสมาชิกในระบบ
                        if (foundUser) {
                            let withdrawStatusText = "🟢 ไม่มีการแจ้งถอน";
                            if (foundUser.isWithdrawLocked && foundUser.pendingWithdrawAmount > 0) {
                                withdrawStatusText = `🚨 แจ้งถอน: ${foundUser.pendingWithdrawAmount.toLocaleString()} บาท`;
                            }

                            totalReport += `📋 ข้อมูลสมาชิกหมายเลข [ ${foundUser.memberNumber} ]\n` +
                                           `👤 ชื่อ: คุณ ${foundUser.name}\n` +
                                           `💰 เงินในระบบ: ${foundUser.balance.toLocaleString()} บาท\n` +
                                           ` ${withdrawStatusText}\n` +
                                           `🏦 ธนาคาร: ${foundUser.bankName || "ไม่ได้ระบุ"}\n` +
                                           `💳 เลข บช: ${foundUser.bankAccount || "ไม่ได้ระบุ"}`;
                        } else {
                            // ถ้าหาคนไหนไม่เจอ ให้รายงานแจ้งเตือนแยกคนไว้
                            totalReport += `❌ ไม่พบข้อมูลสมาชิกหมายเลข ${targetMemberId} ในระบบครับน้า`;
                        }

                        // ถ้ายังไม่ถึงคนสุดท้าย ให้ขีดเส้นคั่นแยกกล่องข้อมูลให้ชัดเจน
                        if (index < memberIds.length - 1) {
                            totalReport += `\n──────────────────\n`;
                        }
                    });

                    replyText = totalReport;
                }
            }
               // ==================== [ เพิ่มใหม่: คำสั่งแอดมินส่องภาพรวมสมาชิกทุกคน (พิมพ์: oball) ] ====================
            else if (userMsg === 'oball' || userMsg === 'Oball' || userMsg === 'OBALL') {
                // 🚨 กรองขั้นสูงสุด: ถ้าไม่ใช่แอดมิน หรือ แอดมินไม่ได้สั่งในแชทส่วนตัว (1 ต่อ 1) ให้บอทเงียบกริบไม่ตอบ
                if (!ADMIN_IDS.includes(userId) || event.source.type !== 'user') {
                    return res.sendStatus(200);
                }

                let memberListText = `📊 [ รายงานข้อมูลสมาชิกทั้งหมด ]\n──────────────────\n`;
                let totalMembers = 0;

                // วนลูปดึงข้อมูลจาก usersWallets ทั้งหมดมาต่อกัน
                for (let key in usersWallets) {
                    const user = usersWallets[key];
                    totalMembers++;

                    // 💸 เช็กสถานะการแจ้งถอนเงิน (เลียนแบบล็อกเดียวกับคำสั่ง m)
                    let withdrawStatusText = "🔔 สถานะถอน: ไม่ได้แจ้งถอน";
                    if (global.withdrawQueue && global.withdrawQueue[key]) {
                        withdrawStatusText = `🚨 สถานะถอน: ❌ แจ้งถอนอยู่ [ ${global.withdrawQueue[key].amount.toLocaleString()} บาท ]`;
                    }

                    memberListText += `📋 ข้อมูลสมาชิกหมายเลข [ ${user.memberNumber} ]\n` +
                                      `👤 ชื่อ: คุณ ${user.name}\n` +
                                      `💰 เงินในระบบ: ${user.balance.toLocaleString()} บาท\n` +
                                      ` ${withdrawStatusText}\n` +
                                      `🏦 ธนาคาร: ${user.bankName || "ไม่ได้ระบุ"}\n` +
                                      `💳 เลข บช: ${user.bankAccount || "ไม่ได้ระบุ"}\n` +
                                      `🔒 เป้าเทิร์น: ${(user.turnoverTarget || 0).toLocaleString()} บาท\n` +
                                      `──────────────────\n`;
                }

                if (totalMembers === 0) {
                    replyText = "📭 ปัจจุบันยังไม่มีสมาชิกสมัครเข้ามาในระบบเลยครับ";
                } else {
                    memberListText += `👥 รวมสมาชิกทั้งหมด: ${totalMembers} คน`;
                    replyText = memberListText;
                }
            }
            // ==================== [ เพิ่มใหม่: คำสั่งแอดมินลบสมาชิกรายคนผ่านแชทส่วนตัว (del1, del2...) ] ====================
            else if (userMsg.startsWith('d') && !userMsg.includes('-') && !userMsg.endsWith('+')) {
                if (!ADMIN_IDS.includes(userId) || event.source.type !== 'user') {
                    return res.sendStatus(200);
                }

                // ตัดคำว่า del ออกเพื่อเอาตัวเลขสมาชิกที่น้าต้องการลบ
                const targetIdStr = userMsg.replace('d', '').trim();
                const targetMemberId = parseInt(targetIdStr);

                if (!isNaN(targetMemberId)) {
                    let targetUserIdInFirebase = null;
                    let targetName = "";

                    // วนลูปค้นหาเพื่อถอดไอดี LINE ดิบของสมาชิกคนนั้นออกมาจากคลัง
                    for (let id in usersWallets) {
                        if (usersWallets[id].memberNumber === targetMemberId) {
                            targetUserIdInFirebase = id;
                            targetName = usersWallets[id].name;
                            break;
                        }
                    }

                    if (!targetUserIdInFirebase) {
                        replyText = `❌ ไม่พบข้อมูลสมาชิกหมายเลข ${targetMemberId} ในระบบครับน้า`;
                    } else {
                        // ❌ ทำการลบข้อมูลของสมาชิกคนนั้นออกจากออบเจกต์ระบบทันที
                        delete usersWallets[targetUserIdInFirebase];
                        
                        // บันทึกการเปลี่ยนแปลงขึ้นไปบนคลัง Firebase หลังบ้าน
                        await saveDataToFirebase();

                        replyText = `🗑️ ลบข้อมูลสำเร็จเรียบร้อยครับน้า!\n──────────────────\n🆔 สมาชิกหมายเลข: [ ${targetMemberId} ]\n👤 ชื่อเดิม: คุณ ${targetName}\n──────────────────\n✨ ตอนนี้สถานะของเขาถูกเคลียร์เป็นศูนย์เรียบร้อย สามารถให้เขาพิมพ์สมัครสมาชิกผูกบัญชีใหม่ในกลุ่มหลักได้เลยครับ`;
                    }
                }
            }
                // ==================== [ เพิ่มใหม่: คำสั่งแอดมินเช็ก ID LINE ตัวจริงของสมาชิก (id1, id2...) ] ====================
            else if (userMsg.startsWith('id') && !userMsg.includes('-') && !userMsg.endsWith('+')) {
                
                // 🚨 กรองขั้นสูงสุด: ถ้าไม่ใช่แอดมินในกล่องกลาง หรือ แอดมินไม่ได้สั่งในแชทส่วนตัว (1 ต่อ 1) ให้บอทเงียบกริบไม่ตอบ
                if (!ADMIN_IDS.includes(userId) || event.source.type !== 'user') {
                    return res.sendStatus(200);
                }

                const args = userMsg.split(/\s+/);
                const targetMemberId = parseInt(args[0].replace('id', '')); // ดึงตัวเลขจากคำว่า id12 -> 12

                if (!targetMemberId || isNaN(targetMemberId)) {
                    replyText = "❌ รูปแบบผิดครับน้า! ต้องพิมพ์เช่น: id12 (เพื่อเช็ก ID LINE ของสมาชิกเลขที่ 12)";
                } else {
                    let foundUserKey = null;
                    // ค้นหาในฐานข้อมูลกระเป๋าตังค์
                    for (let key in usersWallets) {
                        if (usersWallets[key].memberNumber === targetMemberId) {
                            foundUserKey = key; // key ก็คือ ID LINE (U...) นั่นเองครับ
                            break;
                        }
                    }

                    if (foundUserKey) {
                        const user = usersWallets[foundUserKey];
                        // 👑 พ่น ID LINE ตัวจริงออกมาให้แอดมินก๊อปปี้ได้ง่ายๆ
                        replyText = `👑 [ข้อมูล ID LINE สมาชิก]\n` +
                                    `──────────────────\n` +
                                    `🆔 สมาชิกลำดับที่: ${user.memberNumber}\n` +
                                    `👤 ชื่อ: ${user.name}\n` +
                                    `🔑 ID LINE (ก๊อปปี้ช่องนี้): \n\`${foundUserKey}\``; 
                                    // การใส่ `ครอบไว้ จะทำให้บนหน้าจอไลน์ของน้ากดจิ้มทีเดียวแล้วก๊อปปี้ข้อความได้เลยครับ
                    } else {
                        replyText = `❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับน้า`;
                    }
                }
            }
            // ==================== [  คำสั่งแอดมินรีเซ็ตระบบล้างกระดานผ่านแชทส่วนตัว (resetall) ] ====================
            else if (userMsg === 'ล้างระบบ') {
                const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db"; // 👑 ไอดี LINE ของคุณน้า
                
                // 🚨 กรองขั้นสูงสุด: ถ้าไม่ใช่แอดมิน หรือ แอดมินไม่ได้สั่งในแชทส่วนตัว (1 ต่อ 1) ให้บอทเงียบกริบไม่ตอบ
                if (userId !== ADMIN_ID || event.source.type !== 'user') {
                    return res.sendStatus(200);
                }

                // 🔄 วนลูปเคลียร์ค่าสถานะการเงินและการเล่นของทุกคนในคลัง (แต่ยังคงเก็บข้อมูลบัญชีธนาคารและชื่อเอาไว้)
                for (let id in usersWallets) {
                    usersWallets[id].balance = 0;
                    usersWallets[id].turnoverTarget = 0;
                    usersWallets[id].turnoverCount = 0;
                    usersWallets[id].isWithdrawLocked = false;
                    usersWallets[id].pendingWithdrawAmount = 0;
                }

                // 🗑️ ล้างกระดานโพยเดิมที่ค้างอยู่ในรอบนั้นๆ ทั้งหมดให้โล่งสะอาด
                for (let id in roundBets) {
                    delete roundBets[id];
                }

                // บันทึกการล้างกระดานขึ้นไปบนคลัง Firebase หลังบ้านทันที
                await saveDataToFirebase();

                replyText = `♻️ รีเซ็ตระบบล้างกระดานสำเร็จเรียบร้อยครับน้า!\n──────────────────\n💰 เครดิตสมาชิกทุกคน: ปรับเป็น 0 บาท\n🔒 เคลียร์ค่าเทิร์นคงค้าง: ปกติทั้งหมด\n📝 ข้อมูลโพยเดิมในรอบ: ล้างกระดานโล่ง 100%\n──────────────────\n✨ พร้อมสำหรับเริ่มเปิดห้องรอบใหม่แล้วครับโผม!`;
            }

            // ==================== [ จุดตรวจสอบคัดกรอง: ป้องกันไม่ให้บุคคลทั่วไปใช้งานบอทในแชทส่วนตัว ] ====================
            if (event.source.type === 'user') {
                // 👥 เช็กว่า ID คนทักอยู่ในกล่องแอดมินรวมไหม ถ้ายืนยันว่าไม่ใช่แอดมิน ให้บอท "นิ่งเงียบสนิท" ทันที
                if (!ADMIN_IDS.includes(userId)) {
                    return res.sendStatus(200);
                }
            }

            //==========================================================
        
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
// เปิดทางให้เข้าถึงไฟล์รูปภาพสลิปที่เซฟไว้ในเครื่องได้ตรงๆ
app.use(express.static(__dirname));
