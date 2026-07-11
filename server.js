const express = require('express');
const axios = require('axios');
const fs = require('fs'); // 📁 Module สำหรับเขียน-บันทึกไฟล์
const app = express();
app.use(express.json());

// 💡 ดึง Token จาก Render เหมือนเดิม
const TOKEN = process.env.CHANNEL_ACCESS_TOKEN;

app.post('/callback', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    for (let event of events) {
        const replyToken = event.replyToken;

        // 📸 ดักจับเฉพาะ "รูปภาพ" (Image) เท่านั้น
        if (event.type === 'message' && event.message.type === 'image') {
            const messageId = event.message.id;
            console.log(`📸 ตรวจพบรูปภาพ! Message ID: ${messageId}`);

            // 🔗 ลิงก์ยิงไปดูดไฟล์รูปดิบจาก Server ของ LINE
            const lineImageUrl = `https://api-data.line.me/v2/bot/message/${messageId}/content`;

            try {
                // 🚀 สั่งดาวน์โหลดรูปภาพแบบ Binary Stream
                const response = await axios({
                    method: 'get',
                    url: lineImageUrl,
                    responseType: 'stream',
                    headers: {
                        'Authorization': `Bearer ${TOKEN}`
                    }
                });

                // 💾 บันทึกรูปภาพลงเซิร์ฟเวอร์ ตั้งชื่อไฟล์ว่า test-slip.jpg
                const writer = fs.createWriteStream('test-slip.jpg');
                response.data.pipe(writer);

                // รอจนกว่าบันทึกไฟล์เสร็จสมบูรณ์
                writer.on('finish', async () => {
                    console.log('✅ บันทึกรูปภาพลงเซิร์ฟเวอร์สำเร็จ! (ไฟล์ชื่อ test-slip.jpg)');
                    
                    // 💬 ตอบกลับผู้ใช้ใน LINE เพื่อยืนยันว่าระบบทำงานได้
                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                        replyToken: replyToken,
                        messages: [{ type: 'text', text: '📸 ระบบทดสอบ: บอทได้รับรูปภาพและบันทึกไฟล์สำเร็จแล้วครับน้า!' }]
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TOKEN}`
                        }
                    });
                });

                writer.on('error', (err) => {
                    console.error('❌ เกิดข้อผิดพลาดในการเขียนไฟล์:', err.message);
                });

            } catch (error) {
                console.error("❌ ดึงรูปจาก LINE ล้มเหลว:", error.response ? error.response.data : error.message);
            }
        }
    }
    res.sendStatus(200);
});

app.get('/', (req, res) => { res.send('ระบบทดสอบดึงรูปภาพรันปกติ'); });
app.listen(process.env.PORT || 3000, () => { console.log('Image Test Server is running...'); });
