const express = require('express');
const line = require('@line/bot-sdk');
const app = express();

// ⚙️ คอนฟิกสำหรับเชื่อมต่อ LINE (ดึงค่าจาก Environment Variables บน Render เพื่อความปลอดภัย)
const config = {
    channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.messagingApi.MessagingApiClient({
    channelAccessToken: config.channelAccessToken
});

// 📥 ฟังก์ชันรับข้อความและตอบกลับพื้นฐาน
async handleEvent(event) {
    // บอทจะสนใจเฉพาะข้อความที่เป็นตัวหนังสือ (Text) เท่านั้น
    if (event.type !== 'message' || event.message.type !== 'text') {
        return null;
    }

    const txt = event.message.text.trim().toUpperCase();
    let replyText = null;

    // 🧪 ทดสอบพิมพ์คำสั่งพื้นฐาน เพื่อเช็กว่าบอทอ่านและตอบกลับได้ไหม
    if (txt === 'C') {
        replyText = "💳 ระบบทดสอบ: เครดิตของคุณคือ 1,000 ฿ (เชื่อมต่อสำเร็จ!)";
    } else if (txt === 'X') {
        replyText = "🔒 ระบบทดสอบ: ปิดรับโพยชั่วคราว (เชื่อมต่อสำเร็จ!)";
    } else if (txt === 'O') {
        replyText = "🔓 ระบบทดสอบ: เปิดรับโพย (เชื่อมต่อสำเร็จ!)";
    }

    // ถ้ามีข้อความตอบกลับ ให้ส่งกลับไปที่ LINE ทันที
    if (replyText) {
        return client.replyMessage({
            replyToken: event.replyToken,
            messages: [{ type: 'text', text: replyText }]
        });
    }
    return null;
}

// 🌐 เส้นทางรับข้อมูล (Webhook) จาก LINE
app.post('/webhook', line.middleware(config), (req, res) => {
    Promise
        .all(req.body.events.map(handleEvent))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error("❌ Webhook Error:", err);
            res.status(500).end();
        });
});

// 🏠 หน้าเว็บหลักสำหรับเช็กสถานะรันบน Render
app.get('/', (req, res) => {
    res.send('✅ บอททดสอบเชื่อมต่อ LINE ทำงานปกติอยู่บน Render ครับ!');
});

// เปิดพอร์ตเซิร์ฟเวอร์ตามที่ Render กำหนด
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});
