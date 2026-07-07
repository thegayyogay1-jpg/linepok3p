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
    const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";
    // 🔒 เช็กสิทธิ์แอดมินก่อนเลยเป็นอันดับแรก
    if (userId !== ADMIN_ID) {
        replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งจัดการเครดิตครับ";
        } else {
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
        } //<-- ปีกกาปิดแอดมิน
} else if (userMsg === 'o' || userMsg === 'x') 
{ //==================== โค้ดสเต็ป3 เปิด/ปิดรอบ ==================
    // 👑 1. ตั้งค่า LINE User ID ของแอดมินตรงนี้ (เอา ID ของคุณมาใส่เพื่อสิทธิ์สั่งการ)
    const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db"; 

    if (userId !== ADMIN_ID) {
        replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งควบคุมระบบครับ";
    } else {
        if (userMsg === 'o') {
            isRoundOpen = true;
            roundBets = {}; // ล้างข้อมูลโพยเก่าของรอบที่แล้วทิ้งทันทีเพื่อเริ่มรอบใหม่
            replyText = "📢 [แอดมิน] เริ่มเปิดรอบแทงแล้วครับ! สมาชิกทุกท่านสามารถส่งโพยเข้ามาได้เลยครับ 🎰";
        } else if (userMsg === 'x') {
            isRoundOpen = false;
            replyText = "🚫 [แอดมิน] ปิดรอบแทงเรียบร้อยแล้วครับ! หยุดรับโพยทุกกรณี รอแอดมินสรุปผลสักครู่ครับ";
        }
    }
} // ==================== [ START: โค้ดสเต็ปที่ 4 ระบบรับโพยป๊อกเด้ง + หักเครดิต ] ====================
else if (originalMsg.includes('-') && !originalMsg.startsWith('C/') && !originalMsg.startsWith('c/')) {
    // 🔍 1. เช็กก่อนว่าแอดมินเปิดรอบอยู่ไหม
    if (!isRoundOpen) {
        replyText = "🚫 ตอนนี้ระบบปิดรับโพยชั่วคราวครับ กรุณารอแอดมินเปิดรอบใหม่นะรับ";
    } else {
        // 🔍 2. เช็กสถานะการลงทะเบียน
        const isRegistered = usersWallets[userId] ? true : false;
        
        if (!isRegistered) {
            replyText = `📢 ยินดีต้อนรับครับสมาชิกใหม่!\n\n⚠️ คุณยังไม่ได้ลงทะเบียนชื่อจริงในระบบ\nกรุณาพิมพ์: C/ชื่อ-นามสกุล ของท่านเพื่อสมัครสมาชิกก่อนแทงครับ`;
        } else {
            const user = usersWallets[userId];
            
            // ✂️ รองรับการกดเว้นบรรทัด (Split ด้วยขึ้นบรรทัดใหม่)
            const lines = originalMsg.split(/\r?\n/);
            let totalActualBet = 0; // ยอดแทงหน้าโพยปกติ
            let totalHoldCost = 0;  // ยอดเงินที่ต้องหักจริง (ยอดแทง x 3 เด้ง)
            let processedBets = [];
            let hasError = false;
            let errorMsg = "";

            // 🔄 วนลูปอ่านโพยทีละบรรทัดเพื่อคิดเงินรวมก่อน
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

                let legsCount = 0;
                let betTypeDetail = "";

                // 🧮 ตรรกะแยกประเภทการแทง
                if (targetStr === "มข") {
                    // มข-100 (สมมติมาตรฐานห้องมี 6 ขาผู้เล่น)
                    const legsCount = 6; 
                    totalCost += (price * legsCount);
                    processedBets.push({ type: "มข", detail: `เหมาขาผู้เล่นสู้เจ้ามือ (6 ขา) ขาละ ${price} บาท`, cost: price * legsCount });
                } else if (targetStr === "มจ") {
                    // มจ-100 (เจ้ามือสู้ผู้เล่นทุกขา สมมติ 6 ขา)
                    const legsCount = 6;
                    totalCost += (price * legsCount);
                    processedBets.push({ type: "มจ", detail: `แทงเจ้ามือสู้ทุกขา (6 ขา) ขาละ ${price} บาท`, cost: price * legsCount });
                } else if (targetStr.startsWith('จ')) {
                    // จ1-100 หรือ จ123-100 (เจ้ามือสู้ขานั้นๆ)
                    const legs = targetStr.substring(1); // ตัด 'จ' ออก เหลือแต่เลขขา
                    if (legs === "") { hasError = true; errorMsg = `⚠️ ไม่ระบุเลขขาเจ้ามือในบรรทัด: "${line}"`; break; }
                    totalCost += (price * legs.length);
                    processedBets.push({ type: "เจ้ามือ", detail: `เจ้ามือสู้ขา [${legs.split('').join(', ')}] ขาละ ${price} บาท`, cost: price * legs.length });
                } else {
                    // 1-100 หรือ 123-100 (ผู้เล่นปกติ)
                    totalCost += (price * targetStr.length);
                    processedBets.push({ type: "ผู้เล่น", detail: `แทงขา [${targetStr.split('').join(', ')}] ขาละ ${price} บาท`, cost: price * targetStr.length });
                }
                let currentLineBet = price * legsCount;     // ยอดแทงรวมของบรรทัดนี้
                let currentLineHold = currentLineBet * 3;  // ยอดหักค้ำประกัน 3 เด้งของบรรทัดนี้

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

            // ❌ ถ้ามีบรรทัดไหนพิมพ์ผิดกติกา ส่งสัญญานเตือนทันที
            if (hasError) {
                replyText = errorMsg;
            } else if (totalCost === 0) {
                replyText = "⚠️ ไม่พบรายการแทงในข้อความของคุณครับ";
            } else if (user.balance < totalCost) {
                // 💸 3. เช็กเงินเครดิตว่าพอไหม
                replyText = `❌ เครดิตของคุณไม่พอครับ!\n💸 ยอดโพยนี้รวมทั้งหมด: ${totalCost} บาท\n💰 เครดิตปัจจุบันของคุณมี: ${user.balance} บาท\n*(กรุณาติดต่อแอดมินเพื่อเติมเงิน)*`;
            } else {
                // 💾 4. ผ่านฉลุย! หักเงินและจดบันทึกโพย
                user.balance -= totalCost; // หักเงินออกจากระบบทันที

                if (!roundBets[userId]) {
                    roundBets[userId] = [];
                }

                // สรุปข้อความเพื่อตอบกลับผู้ใช้
                let summaryText = `✅ จดบันทึกโพยสำเร็จ & หักเครดิตแล้ว! 🎉\n👤 คุณ: ${user.name} (ID: ${user.memberNumber})\n\n📝 รายการที่บันทึก:\n`;
                
                processedBets.forEach((bet) => {
                    summaryText += `• ${bet.detail}\n`;
                    // เซฟลงฐานข้อมูลรอบ
                    roundBets[userId].push({
                        name: user.name,
                        memberNumber: user.memberNumber,
                        betType: bet.type,
                        detail: bet.detail,
                        cost: bet.cost,
                        time: new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' })
                    });
                });

                summaryText += `\n💸 ยอดเดิมพันรวมรอบนี้: ${totalCost} บาท\n💰 เครดิตคงเหลือ: ${user.balance} บาท\n*รอแอดมินประกาศผลรอบนี้ครับ*`;
                replyText = summaryText;
            }
        }
    }
}
// ==================== [ END: โค้ดสเต็ปที่ 4 ระบบรับโพยป๊อกเด้ง + หักเครดิต ] ====================
            else {
// ==================== [ END: โค้ดสเต็ปที่ 4 ระบบรับโพย ] ==================== 
// ==================== [ END: โค้ดสเต็ปที่ 3 เปิดรอบ/ปิดรอบแทง จบบรรทัด85 ] ===================={ 
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
