const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// 💡 ไม่ต้องใส่ Token ในนี้แล้ว ระบบจะดึงจากตัวแปรบน Render อัตโนมัติ
const TOKEN = process.env.CHANNEL_ACCESS_TOKEN;

// 🗄️ ฐานข้อมูลจำลองสำหรับจำสมาชิก (จะรีเซ็ตเมื่อเซิร์ฟเวอร์ Restart)
let usersWallets = {}; 
let nextMemberId = 1;  

app.post('/callback', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    for (let event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const replyToken = event.replyToken;
            const userId = event.source.userId; 
            const originalMsg = event.message.text.trim(); 
            const userMsg = originalMsg.toLowerCase().replace(/\s+/g, ''); 

            let replyText = ""; const args = originalMsg.split(/\s+/); 
const command = args[0]; // ดึงคำแรก เช่น เติม หรือ ลบ

if (command === "เติม" || command === "ลบ") {
    const targetMemberId = parseInt(args[1]); // เลขสมาชิก
    const amount = parseFloat(args[2]); // จำนวนเงิน

    // 1. เช็กว่าพิมพ์คำสั่งครบและถูกต้องไหม
    if (!targetMemberId || isNaN(amount) || amount <= 0) {
        replyText = `⚠️ รูปแบบคำสั่งไม่ถูกต้อง\nกรุณาพิมพ์: เติม [เลขสมาชิก] [จำนวนเงิน]\n(ตัวอย่าง: เติม 1 2000 หรือ ลบ 1 2000)`;
    } else {
        // 2. วนลูปหา LINE User ID จากเลขสมาชิกที่ระบุมา
        let foundUserKey = null;
        for (let key in usersWallets) {
            if (usersWallets[key].memberNumber === targetMemberId) {
                foundUserKey = key;
                break;
            }
        }

        // 3. ถ้าไม่เจอเลขสมาชิกในระบบ
        if (!foundUserKey) {
            replyText = `❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับ`;
        } else {
            // 4. คิดคำนวณเงินและปรับปรุงยอดในระบบ
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
} else { 
            // ==================== [ START: โค้ดสเต็ปที่ 1 เช็กก่อนว่าคนนี้เคยลงทะเบียนในระบบหรือยัง ] ====================
const isRegistered = usersWallets[userId] ? true : false;

if (!isRegistered) {
    // 🛑 [กรณีคนใหม่] ยังไม่ได้ลงทะเบียน
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
    // ✅ [กรณีสมาชิกเก่า] ลงทะเบียนเรียบร้อยแล้ว
    const user = usersWallets[userId];

    if (userMsg === 'c') {
        // กด C ตัวเดียวเพื่อดูสถานะตัวเอง
        replyText = `👤 สมาชิกคนที่: ${user.memberNumber}\n👤 ชื่อ-นามสกุล: ${user.name}\n💰 ยอดเครดิตของคุณ: ${user.balance} บาท`;
    } else if (originalMsg.startsWith('C/') || originalMsg.startsWith('c/')) {
        // ถ้าสมาชิกเก่าเผลอพิมพ์สมัครซ้ำเข้ามา
        replyText = `ℹ️ คุณ ${user.name} ได้ลงทะเบียนในระบบเรียบร้อยแล้วครับ\n🆔 สมาชิกคนที่: ${user.memberNumber}`;
    } else {
        // ถ้าพิมพ์ข้อความอื่น ๆ เข้ามา บอทจะเงียบ (ไม่เซ็ต replyText) เพื่อส่งต่อให้ระบบอื่นทำงาน
        replyText = ""; 
    }
}
    }
    
// ==================== [ END: โค้ดสเต็ปที่ 1 เวอร์ชันแก้ไขใหม่ ] ====================

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
