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
} 
    // ==================== [ START: โค้ดสเต็ปที่ 4 ระบบรับโพยป๊อกเด้ง + หักค้ำประกัน 3 เด้ง ] ====================
else if (originalMsg.includes('-') && !originalMsg.startsWith('C/') && !originalMsg.startsWith('c/')) {
    if (!isRoundOpen) {
        replyText = "🚫 ตอนนี้ระบบปิดรับโพยชั่วคราวครับ กรุณารอแอดมินเปิดรอบใหม่นะรับ";
    } else {
        const isRegistered = usersWallets[userId] ? true : false;
        
        if (!isRegistered) {
            replyText = `📢 ยินดีต้อนรับครับสมาชิกใหม่!\n\n⚠️ คุณยังไม่ได้ลงทะเบียนชื่อจริงในระบบ\nกรุณาพิมพ์: C/ชื่อ-นามสกุล ของท่านเพื่อสมัครสมาชิกก่อนแทงครับ`;
        } else {
            const user = usersWallets[userId];
            const lines = originalMsg.split(/\r?\n/);
            
            let totalActualBet = 0; // ยอดแทงหน้าโพยปกติ
            let totalHoldCost = 0;  // ยอดเงินที่ต้องหักจริง (ยอดแทง x 3 เด้ง)
            let processedBets = [];
            let hasError = false;
            let errorMsg = "";

            // 🎯 กำหนดเลขขาที่อนุญาตในระบบ (ขา 1 ถึง ขา 6)
            const allowedLegs = ['1', '2', '3', '4', '5','6'];

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

                // คำนวณจำนวนขาตามประเภทคำสั่ง
                if (targetStr === "มข") {
                    legsCount = 6; // มาตรฐานห้อง 6 ขาผู้เล่น
                    betTypeDetail = `เหมาขาผู้เล่นสู้เจ้ามือ (6 ขา) ขาละ ${price} บาท`;
                } else if (targetStr === "มจ") {
                    legsCount = 6; // เจ้ามือสู้ผู้เล่น 6 ขา
                    betTypeDetail = `แทงเจ้ามือสู้ทุกขา (6 ขา) ขาละ ${price} บาท`;
                } else if (targetStr.startsWith('จ')) {
                    const legs = targetStr.substring(1);
                    if (legs === "") { hasError = true; errorMsg = `⚠️ ไม่ระบุเลขขาเจ้ามือในบรรทัด: "${line}"`; break; }

                    // 🔍 เช็กว่าขาเจ้ามือที่พิมพ์มา มีเลขเกิน 1-6 ไหม
                    let isLegsValid = legs.split('').every(char => allowedLegs.includes(char));
                    if (!isLegsValid) {
                        hasError = true;
                        errorMsg = `❌ บันทึกโพยล้มเหลว! ห้องนี้มีแค่ ขา 1 ถึง ขา 6 เท่านั้นครับ\n(พบข้อผิดพลาดที่ขาเจ้ามือ: "${line}")`;
                        break;
                    }
                    
                    legsCount = legs.length;
                    betTypeDetail = `เจ้ามือสู้ขา [${legs.split('').join(', ')}] ขาละ ${price} บาท`;
                } else {
                     // 🔍 เช็กว่าขาผู้เล่นปกติที่พิมพ์มา มีเลขเกิน 1-6 ไหม
                    let isLegsValid = targetStr.split('').every(char => allowedLegs.includes(char));
                    if (!isLegsValid) {
                        hasError = true;
                        errorMsg = `❌ บันทึกโพยล้มเหลว! ห้องนี้มีแค่ ขา 1 ถึง ขา 6 เท่านั้นครับ\n(พบข้อผิดพลาดที่ขาผู้เล่น: "${line}")`;
                        break;
                    }
                    legsCount = targetStr.length;
                    betTypeDetail = `แทงขา [${targetStr.split('').join(', ')}] ขาละ ${price} บาท`;
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

            if (hasError) {
                replyText = errorMsg;
            } else if (totalHoldCost === 0) {
                replyText = "⚠️ ไม่พบรายการแทงในข้อความของคุณครับ";
            } else if (user.balance < totalHoldCost) {
                // 💸 เช็กว่าเงินในกระเป๋าพอจ่ายค่าค้ำประกัน 3 เด้งไหม
                replyText = `❌ เครดิตของคุณไม่พอสหรับยอดค้ำประกันเด้ง (คิดสูงสุด 3 เด้ง) ครับ!\n💸 ยอดแทงปกติ: ${totalActualBet} บาท\n🔒 ต้องใช้ยอดค้ำประกันรวม: ${totalHoldCost} บาท\n💰 เครดิตปัจจุบันของคุณมี: ${user.balance} บาท`;
            } else {
                // 💾 เงินพอ -> ทำการหักเงินค้ำประกันทันที
                user.balance -= totalHoldCost;

                if (!roundBets[userId]) {
                    roundBets[userId] = [];
                }

                let summaryText = `✅ บันทึกโพยและหักค้ำประกัน 3 เด้งเรียบร้อย! 🎉\n👤 คุณ: ${user.name} (ID: ${user.memberNumber})\n\n📝 รายการแทงหน้าโพย:\n`;
                
                processedBets.forEach((bet) => {
                    summaryText += `• ${bet.detail}\n`;
                    
                    roundBets[userId].push({
                        name: user.name,
                        memberNumber: user.memberNumber,
                        betType: bet.type,
                        detail: bet.detail,
                        pricePerLeg: bet.pricePerLeg,
                        actualBet: bet.actualBet,
                        holdCost: bet.holdCost, // เก็บยอดที่ล็อคเอาไว้ไปคำนวณคืนเงินในสเต็ปส่งผล
                        time: new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' })
                    });
                });

                summaryText += `\n💵 ยอดแทงรวม: ${totalActualBet} บาท\n🔒 หักค้ำประกันรวม (x3): ${totalHoldCost} บาท\n💰 เครดิตคงเหลือชั่วคราว: ${user.balance} บาท\n*หากผลลัพธ์ไม่ได้แพ้ 3 เด้ง ระบบจะคืนเครดิตส่วนต่างให้ตอนสรุปผลครับ*`;
                replyText = summaryText;
            }
        }
    }
}
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
    // 1. ดึงข้อมูลพื้นฐานของสมาชิก
    let memberInfo = `👤 สมาชิกคนที่: ${user.memberNumber}\n👤 ชื่อ-นามสกุล: ${user.name}\n💰 ยอดเครดิตของคุณ: ${user.balance} บาท`;
    
    // 🔍 2. เช็กว่าในรอบปัจจุบัน คนนี้มีโพยที่แทงค้างไว้ไหม
    const myBets = roundBets[userId];
    
    if (myBets && myBets.length > 0) {
        memberInfo += `\n\n📝 รายการโพยค้างในรอบนี้:`;
        myBets.forEach((bet, index) => {
            memberInfo += `\n  ${index + 1}. ${bet.detail}`;
        });
        // คำนวณยอดเงินรวมที่โดนล็อคค้ำประกันไว้ดูเล่น ๆ ได้ด้วย
        const totalHold = myBets.reduce((sum, bet) => sum + bet.holdCost, 0);
        memberInfo += `\n🔒 ยอดค้ำประกันเด้งที่ล็อกไว้: ${totalHold} บาท`;
    } else {
        memberInfo += `\n\n📝 รายการโพยค้างในรอบนี้: ไม่มีโพยค้าง`;
    }

    replyText = memberInfo;
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
