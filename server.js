const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// 🔴 วาง Channel Access Token ตัวยาวๆ ของคุณแทนที่ข้อความข้างล่างนี้ได้เลยครับ
const TOKEN = "วxEszMbi11/cVOhDJ+IukVkKyalX6rmatci8oR0TpViEGLq/Ikxr0CPve/CUyw8GV/GpbPTPmUXzWjnuXJhHCGGYfpWZW6a5XxL1hr7pboeq0o9sIMappR8ZIaqpYynfbjfo7JSIs/GgKGakpfm2vHwdB04t89/1O/w1cDnyilFU=";

app.post('/callback', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    for (let event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const replyToken = event.replyToken;

            // พิมพ์อะไรมา บอทจะตอบกลับคำนี้เสมอ
            const replyMessage = { type: 'text', text: 'สวัสดีครับ ระบบเชื่อมต่อสำเร็จแล้ว!' };

            try {
                await axios.post('https://api.line.me/v2/bot/message/reply', {
                    replyToken: replyToken,
                    messages: [replyMessage]
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
    res.sendStatus(200);
});

app.get('/', (req, res) => { res.send('เซิร์ฟเวอร์ทดสอบรันปกติ'); });

app.listen(process.env.PORT || 3000, () => { console.log('Server is running...'); });
