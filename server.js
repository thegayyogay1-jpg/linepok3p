const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// 🌟 จุดสำคัญ 1: ประกาศตัวแปร Global ไว้บนสุดสำหรับถือข้อมูล Flex Message
global.currentReplyFlex = null;

// 💡 จุดสำคัญ 2: ดึง Token จากตัวแปร Environment ของหลังบ้าน (Render / Railway)
const TOKEN = process.env.CHANNEL_ACCESS_TOKEN;

// 👥 คลังข้อมูลจำลอง (สร้างไว้สำหรับเทสระบบการ์ด)
let usersWallets = {
    "U1234567890abcdef": {
        memberNumber: 99,
        name: "เสี่ยแจ๊ค เด้งดี",
        balance: 5500,
        turnoverTarget: 0
    }
};

// 📝 ข้อมูลโพยจำลองในรอบนั้น ๆ (สำหรับทดสอบให้ดึงไปแปะในการ์ด)
let roundBets = {
    "U1234567890abcdef": [
        { detail: "แทงขา 1 = 500", holdCost: 0 },
        { detail: "แทงขา 2 = 1,000", holdCost: 200, drawStatus: { "ขา 2": "จั่ว" } }
    ]
};

// 🤖 จุดรับ Data จาก LINE Webhook (แก้ไขให้ตรงกับหน้า LINE Developers ของน้าแล้ว)
app.post('/callback', async (req, res) => {
    const events = req.body.events;
    
    if (events && events.length > 0) {
        for (let event of events) {
            // กรองรับเฉพาะข้อความที่เป็นตัวหนังสือเท่านั้น
            if (event.type !== 'message' || event.message.type !== 'text') continue;

            const replyToken = event.replyToken;
            const userId = event.source.userId;
            const userMsg = event.message.text.trim().toLowerCase();
            
            let replyText = "";
            
            // ==================== [ 🛠️ คำสั่งทดสอบ: พิมพ์ c เช็กยอดการ์ดหรู ] ====================
            if (userMsg === 'c') {
                // บังคับล็อกอินดึงข้อมูลจำลองเสี่ยแจ๊คมาแสดง (เพื่อให้น้าทดสอบดูหน้าตากล่องได้ทันที)
                const testUserId = "U1234567890abcdef";
                const user = usersWallets[testUserId];
                
                // 📝 1. ดึงรายการโพยจำลองมาจัดแถวตัวหนังสือย่อยในการ์ด
                let betContents = [];
                const myBets = roundBets[testUserId];
                
                if (myBets && myBets.length > 0) {
                    myBets.forEach((bet, index) => {
                        let betText = `${index + 1}. ${bet.detail}`;
                        if (bet.drawStatus) {
                            let drawLegs = [];
                            for (let leg in bet.drawStatus) {
                                if (bet.drawStatus[leg] === "จั่ว") drawLegs.push(leg);
                            }
                            if (drawLegs.length > 0) {
                                betText += ` 🃏 (จั่ว: ${drawLegs.sort().join(', ')})`;
                            }
                        }
                        betContents.push({
                            type: "text",
                            text: betText,
                            color: "#e0e0e0",
                            size: "xs",
                            wrap: true,
                            margin: "xs"
                        });
                    });
                    
                    const totalHold = myBets.reduce((sum, bet) => sum + bet.holdCost, 0);
                    betContents.push({
                        type: "text",
                        text: `🔒 ประกันเด้งที่ล็อก: ${totalHold} บาท`,
                        color: "#ffaa00",
                        size: "xs",
                        weight: "bold",
                        margin: "sm"
                    });
                } else {
                    betContents.push({
                        type: "text",
                        text: "ไม่มีโพยค้างในรอบนี้",
                        color: "#888888",
                        size: "xs",
                        style: "italic"
                    });
                }

                // 👑 2. เช็กสถานะเทิร์นโอเวอร์
                let turnStatusText = "🔓 ปกติ (ไม่ติดเทิร์น)";
                let turnStatusColor = "#55ff55";

                // 🏆 3. ประกอบร่างกล่อง Flex Message สีดำ-ทอง ตามรูปเป๊ะ ๆ
                global.currentReplyFlex = {
                    type: "flex",
                    altText: "📊 บัตรข้อมูลสมาชิกและยอดเงินของคุณ",
                    contents: {
                        type: "bubble",
                        styles: {
                            header: { backgroundColor: "#141416" },
                            body: { backgroundColor: "#1e1e22" }
                        },
                        header: {
                            type: "box",
                            layout: "vertical",
                            contents: [
                                {
                                    type: "text",
                                    text: "👑 POKDENG PREMIUM MEMBER",
                                    weight: "bold",
                                    color: "#d4af37",
                                    size: "sm",
                                    letterSpacing: "1px"
                                }
                            ]
                        },
                        body: {
                            type: "box",
                            layout: "vertical",
                            contents: [
                                {
                                    type: "box",
                                    layout: "horizontal",
                                    contents: [
                                        { type: "text", text: "👤 สมาชิกคนที่", color: "#8e8e93", size: "xs" },
                                        { type: "text", text: `No. ${user.memberNumber}`, color: "#ffffff", size: "xs", align: "end", weight: "bold" }
                                    ]
                                },
                                {
                                    type: "box",
                                    layout: "horizontal",
                                    margin: "sm",
                                    contents: [
                                        { type: "text", text: "👤 ชื่อลูกค้า", color: "#8e8e93", size: "xs" },
                                        { type: "text", text: `${user.name}`, color: "#ffffff", size: "xs", align: "end", weight: "bold" }
                                    ]
                                },
                                { type: "separator", margin: "md", color: "#3a3a3c" },
                                {
                                    type: "box",
                                    layout: "horizontal",
                                    margin: "md",
                                    contents: [
                                        { type: "text", text: "💵 เครดิตกระเป๋า", color: "#ffffff", size: "sm", weight: "bold" },
                                        { type: "text", text: `${user.balance.toLocaleString()} บาท`, color: "#d4af37", size: "md", align: "end", weight: "bold" }
                                    ]
                                },
                                {
                                    type: "box",
                                    layout: "horizontal",
                                    margin: "sm",
                                    contents: [
                                        { type: "text", text: "📊 สถานะเทิร์น", color: "#8e8e93", size: "xs" },
                                        { type: "text", text: turnStatusText, color: turnStatusColor, size: "xs", align: "end", weight: "bold" }
                                    ]
                                },
                                { type: "separator", margin: "md", color: "#3a3a3c" },
                                {
                                    type: "box",
                                    layout: "vertical",
                                    margin: "md",
                                    contents: [
                                        { type: "text", text: "📝 รายการโพยรอบนี้:", color: "#d4af37", size: "xs", weight: "bold", margin: "xs" },
                                        {
                                            type: "box",
                                            layout: "vertical",
                                            margin: "xs",
                                            contents: betContents
                                        }
                                    ]
                                },
                                { type: "separator", margin: "md", color: "#3a3a3c" },
                                {
                                    type: "box",
                                    layout: "vertical",
                                    margin: "md",
                                    contents: [
                                        { type: "text", text: "📖 คู่มือช่วยเหลือใช้งาน", color: "#8e8e93", size: "xxs", weight: "bold" },
                                        { type: "text", text: "• พิมพ์ คส เพื่อดูคำสั่งทั้งหมด\n• พิมพ์ ฝาก [จำนวน] หรือ ถอน [จำนวน]", color: "#aaaaaa", size: "xxs", margin: "xs", wrap: true }
                                    ]
                                }
                            ]
                        }
                    }
                };
            }

            // ==================== [ 🚀 บล็อกยิงข้อความตอบกลับ LINE ] ====================
            if (replyText || global.currentReplyFlex) {
                try {
                    let sendMessages = [];

                    // ถ้ามีการ์ด Flex Message ให้ยัดลงกล่องส่งข้อมูล
                    if (global.currentReplyFlex) {
                        sendMessages.push(global.currentReplyFlex);
                    } else if (replyText) {
                        sendMessages.push({ type: 'text', text: replyText });
                    }

                    // ล้างค่าแรมตัวแปร Global เคลียร์บิลรอบถัดไป
                    global.currentReplyFlex = null;

                    // ยิงข้อมูลกลับหาผู้ใช้ผ่าน LINE API
                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                        replyToken: replyToken,
                        messages: sendMessages
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

app.get('/', (req, res) => { res.send('บอททดสอบระบบการ์ดว่างใช้งานรันปกติครับน้า'); });
app.listen(process.env.PORT || 3000, () => { console.log('Server is running...'); });
