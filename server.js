const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// 💡 ดึง Token จาก Environment Variables บน Render ของน้า
const TOKEN = process.env.CHANNEL_ACCESS_TOKEN;

// 👥 จำลองกระเป๋าเงินจำลอง (ไม่ต้องเชื่อม Firebase สำหรับทดสอบ)
let mockUsersWallets = {
    // ใส่ User ID LINE ของน้าตรงนี้เพื่อทดสอบเติมเงินเข้าตัวเองได้เลยครับ
    "U2fb9233e5c539ae3970cbd698e2e18db": {
        name: "น้า (ผู้ทดสอบ)",
        balance: 100
    }
};

// 📡 LINE Webhook Endpoint สำหรับทดสอบดักจับแจ้งเตือน
app.post('/callback', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    for (let event of events) {
        // ดึงข้อความแชท
        const userMsg = event.message && event.message.text ? event.message.text.trim() : null;
        const replyToken = event.replyToken;
        const userId = event.source.userId;

        // ==================== [ ⭐ ระบบดักเงินเข้า KDeposit ⭐ ] ====================
        if (userMsg && userMsg.startsWith('KDeposit')) {
            console.log(`🤖 บอททดสอบได้รับข้อความแจ้งเตือน: "${userMsg}"`);
            
            // ดักจับตัวเลขยอดเงิน เช่น KDeposit: 50.00 หรือ ยอดเงินเข้า 50.00 บาท
            const match = userMsg.match(/([0-9]+\.[0-9]{2})/);
            
            if (match) {
                const detectedAmount = parseFloat(match[1]); // แปลงข้อความเป็นตัวเลขทศนิยม เช่น 50.00
                console.log(`💰 ตรวจพบยอดเงินโอนเข้าจำนวน: ${detectedAmount} บาท`);

                // 🎯 [ระบบเทส] เนื่องจากยังไม่ต่อ Firebase จะถือว่าเติมเครดิตให้คนที่พิมพ์หรือส่งข้อความเข้ามาโดยตรง
                if (mockUsersWallets[userId]) {
                    // ทำการบวกเครดิตในตัวแปรจำลอง
                    mockUsersWallets[userId].balance += detectedAmount;
                    
                    console.log(`✅ เติมเงินจำลองสำเร็จ! บัญชี: ${mockUsersWallets[userId].name} | ยอดเดิม: ${mockUsersWallets[userId].balance - detectedAmount} | ยอดใหม่: ${mockUsersWallets[userId].balance}`);

                    // ยิงข้อความตอบกลับเข้า LINE ทันทีเพื่อทดสอบว่าระบบตอบสนองไหม
                    try {
                        await axios.post('https://api.line.me/v2/bot/message/reply', {
                            replyToken: replyToken,
                            messages: [
                                {
                                    "type": "text",
                                    "text": `🤖 [บอททดสอบออโต้]\n✅ ตรวจพบยอดโอนเงินจำนวน: ${detectedAmount} บาท!\n👤 เติมให้คุณ: ${mockUsersWallets[userId].name}\n💳 เครดิตจำลองปัจจุบันของคุณคือ: ${mockUsersWallets[userId].balance} บาท`
                                }
                            ]
                        }, { 
                            headers: { 
                                'Content-Type': 'application/json', 
                                'Authorization': `Bearer ${TOKEN}` 
                            } 
                        });
                        console.log("✉️ ยิงข้อความทดสอบกลับเข้า LINE สำเร็จแล้ว!");
                    } catch (lineErr) {
                        console.error("❌ ส่งข้อความทดสอบกลับ LINE ล้มเหลว:", lineErr.response ? lineErr.response.data : lineErr.message);
                    }
                } else {
                    console.log(`⚠️ ไม่พบประวัติบัญชีทดสอบสำหรับ UserId: ${userId} (กรุณาเอา UID นี้ไปใส่ใน mockUsersWallets ด้านบน)`);
                    
                    // แจ้งเตือนบอก UID ให้แอดมินรู้เพื่อเอาไปลงทะเบียนเทส
                    try {
                        await axios.post('https://api.line.me/v2/bot/message/reply', {
                            replyToken: replyToken,
                            messages: [
                                {
                                    "type": "text",
                                    "text": `⚠️ ไม่พบกระเป๋าเงินทดสอบของคุณในระบบ\nรหัส UID ของคุณคือ:\n${userId}\n\n(ให้น้าก๊อปรหัสนี้ไปแปะในตัวแปร mockUsersWallets แถวบรรทัดที่ 11 ในโค้ดก่อนนะครับถึงจะทดสอบเติมเข้าตัวเองได้)`
                                }
                            ]
                        }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
                    } catch (err) { console.error(err); }
                }
            } else {
                console.log("🔍 ตรวจสอบข้อความ KDeposit แล้ว แต่ไม่พบตัวเลขยอดทศนิยมที่ถูกต้อง");
            }
            continue; // ทำงานนี้เสร็จ ข้ามไปวนลูปข้อความถัดไปทันที
        }
        // ===========================================================================
        
    } // จบลูป event
    return res.sendStatus(200);
});

// 🌐 ส่วนเปิดพอร์ตเชื่อมต่อ (วางไว้ล่างสุดของไฟล์เสมอ)
app.get('/', (req, res) => { 
    res.send('บอททดสอบระบบฝากเงินออโต้วิ่งปกติจ้า'); 
});

app.listen(process.env.PORT || 3000, () => { 
    console.log('Test Server is running...'); 
});
