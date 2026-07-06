const express = require('express');
const axios = require('axios'); // เพิ่มตัวช่วยส่งข้อความกลับหา LINE
const app = express();
app.use(express.json());

// ⚙️ ดึงค่าโทเค็นจาก Environment Variables ของ Render (หรือใส่ Token ของคุณในเครื่องหมายคำพูดได้เลย)
const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN || "ใส่_ACCESS_TOKEN_ของคุณตรงนี้";

// ฐานข้อมูลจำลอง (จำในแรม)
let usersWallets = {}; 
let nextMemberId = 1;  
let isRoundOpen = false;
let roundBets = {}; 

// ตัวแปรระบบสำหรับพักข้อมูลผลไพ่เพื่อรอแอดมินคอนเฟิร์ม
let pendingResults = null; 

// 👑 [ตั้งค่าแอดมิน] ใส่ LINE USER ID ของแอดมินตรงนี้ครับ
const ADMIN_LIST = [
    "U0d1e353091d90af57b37ff38d36e29bc"
]; 

function parseCard(cardStr) {
    if (!cardStr) return { score: 0, deng: 1, label: "0 แต้ม" };
    let str = cardStr.trim().toLowerCase();
    
    let isDeng = false;
    let isTong = false;
    let isStraight = false;

    if (str.startsWith('d')) {
        isDeng = true;
        str = str.substring(1);
    } else if (str.startsWith('ต')) {
        isTong = true;
        str = str.substring(1);
    } else if (str.startsWith('ส')) {
        isStraight = true;
        str = str.substring(1);
    }

    const specialChars = ['t', 'j', 'q', 'k'];
    const getVal = (c) => specialChars.includes(c) ? 0 : parseInt(c);
    let cardCount = str.length;

    if (cardCount === 3 && specialChars.includes(str[0]) && specialChars.includes(str[1]) && specialChars.includes(str[2])) {
        let finalDeng = isDeng ? 3 : 1; 
        return { score: 7.5, deng: finalDeng, label: `7.5 แต้ม (สามเหลือง ${finalDeng} เด้ง)` };
    }

    let totalScore = 0;
    for (let i = 0; i < cardCount; i++) {
        let val = getVal(str[i]);
        if (!isNaN(val)) {
            totalScore += val;
        }
    }
    let finalScore = totalScore % 10;

    let finalDeng = 1;
    let typeLabel = "แต้ม";

    if (isTong) {
        finalDeng = 3;
        typeLabel = "ตอง (3 เด้ง)";
    } else if (isStraight) {
        finalDeng = 3;
        typeLabel = "เรียง (3 เด้ง)";
    } else if (isDeng) {
        finalDeng = (cardCount === 3) ? 3 : 2;
        typeLabel = `${finalDeng} เด้ง`;
    }

    return { score: finalScore, deng: finalDeng, label: `${finalScore} ${typeLabel}` };
}

// 🌐 เส้นทาง Webhook ใช้คำว่า /callback ตามของเดิมของคุณที่รันผ่าน
app.post('/callback', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    for (let event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const replyToken = event.replyToken;
            const userId = event.source.userId;
            const originalMsg = event.message.text.trim();
            const userMsg = originalMsg.toLowerCase().replace(/\s+/g, '');
            
            let replyMessageObject = null; 
            const isAdmin = ADMIN_LIST.includes(userId);

            // 🧪 [เพิ่มสำหรับทดสอบสเต็ป 1] เช็กว่าบอทเชื่อมต่อและยอมตอบกลับไหม
            if (userMsg === 'test') {
                replyMessageObject = { type: 'text', text: "✅ บอทระบบเก่าของคุณเชื่อมต่อสำเร็จและตอบกลับได้แล้วครับ!" };
            }
            // 🧽 คำสั่งล้างระบบเดิมของคุณ
            else if (userMsg === 'ล้างระบบ') {
                if (!isAdmin) {
                    replyMessageObject = { type: 'text', text: "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ" };
                } else {
                    usersWallets = {}; nextMemberId = 1; isRoundOpen = false; roundBets = {}; pendingResults = null;
                    replyMessageObject = { type: 'text', text: "👑 [แอดมิน] ♻️ ล้างระบบสมาชิกเริ่มต้นใหม่เรียบร้อยแล้วครับ!" };
                }
            }
            // (คำสั่งอื่น ๆ ในระบบเดิมของคุณ คงไว้ทั้งหมด...)
            else if (userMsg === 'c') {
                if (!usersWallets[userId]) {
                    usersWallets[userId] = { memberNumber: nextMemberId, memberTitle: `สมาชิกที่ ${nextMemberId}`, name: "ผู้เล่นทั่วไป", balance: 0, isLockWithdraw: false, pendingWithdrawAmount: 0 };
                    nextMemberId++;
                }
                let user = usersWallets[userId];
                replyMessageObject = { type: 'text', text: `👤 ${user.memberTitle}\n💰 ยอดเงินของคุณ: ${user.balance} บาท` };
            }

            // 🚀 ฟังก์ชันส่งข้อความกลับไปที่ LINE (ทำให้บอทพูดได้จริง)
            if (replyMessageObject) {
                try {
                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                        replyToken: replyToken,
                        messages: [replyMessageObject]
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`
                        }
                    });
                } catch (error) {
                    console.error("❌ ส่งข้อความกลับ LINE ล้มเหลว:", error.response ? error.response.data : error.message);
                }
            }
        }
    }
    res.sendStatus(200);
});

// หน้าแรกสำหรับให้ Render ตรวจเช็กสถานะรัน
app.get('/', (req, res) => {
    res.send('✅ เซิร์ฟเวอร์เปิดใช้งานปกติด้วยโครงสร้างโค้ดเดิมของคุณครับ!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});
