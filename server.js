const express = require('express');
const line = require('@line/bot-sdk');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const app = express();
const client = new line.Client(config);

// 🗄️ ฐานข้อมูลจำลองในหน่วยความจำ (Memory DB)
let gameState = 'CLOSED'; // STATES: CLOSED, BETTING, DRAWING, WAITING_RESULT
let players = {}; // เก็บเครดิตสมาชิก { userId: { name: 'แอดมิน', credit: 1000 } }
let currentBets = {}; // เก็บโพยรอบปัจจุบัน { userId: { leg1: 50, leg2: 50 } }
let drawStatus = {}; // เก็บสถานะการจั่วรายคนแยกขา { userId: { leg1: '-', leg2: '+' } }

app.post('/callback', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.json({ status: 'ok' }))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return null;

  const text = event.message.text.trim();
  const userId = event.source.userId;
  
  // ดึงข้อมูลโปรไฟล์ผู้ส่ง
  let profile = { displayName: 'ผู้เล่นทั่วไป' };
  try { profile = await client.getProfile(userId); } catch (e) {}

  // ==========================================
  // 👑 แผงควบคุมสำหรับแอดมิน (Admin Commands)
  // ==========================================
  
  // 1. เปิดรอบแทง (พิมพ์ O)
  if (text.toUpperCase() === 'O') {
    gameState = 'BETTING';
    currentBets = {};
    drawStatus = {};
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '🟢 [เปิดรับโพย] ป๊อกเด้ง 3 ใบเริ่มแล้ว! ส่งโพยของท่านเข้ามาได้เลยครับ'
    });
  }

  // 2. ปิดรับโพย (พิมพ์ X)
  if (text.toUpperCase() === 'X' && gameState === 'BETTING') {
    gameState = 'DRAWING';
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '🛑 [ปิดรับโพยแทง] ขณะนี้เข้าสู่ช่วงกติกาจั่วไพ่! รอแอดมินหงาย 2 ใบแรก แล้วพิมพ์สถานะจั่ว (+ หรือ -) ได้เลยครับ'
    });
  }

  // ==========================================
  // 🃏 ระบบรับโพยและระบบจั่วสด (Player Commands)
  // ==========================================
  
  // ระบบรับข้อความผู้เล่นในช่วงเปิดจั่ว (เช่น พิมพ์ 12+ หรือ 3-)
  if (gameState === 'DRAWING') {
    // ตรวจสอบสัญลักษณ์จั่วด้วย Regex เช่น 12+ หรือ 1-
    const drawRegex = /^([1-6]+)([+\-])$/;
    if (drawRegex.test(text)) {
      const match = text.match(drawRegex);
      const legs = match[1].split(''); // แยกขา เช่น ['1', '2']
      const action = match[2]; // '+' หรือ '-'

      if (!drawStatus[userId]) drawStatus[userId] = {};
      
      legs.forEach(leg => {
        drawStatus[userId][`leg${leg}`] = action;
      });

      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `📥 บันทึกสถานะขา ${legs.join(', ')} ของคุณ ${profile.displayName} เป็น: [ ${action === '+' ? 'จั่วเพิ่ม' : 'อยู่ไม่จั่ว'} ] เรียบร้อยแล้ว`
      });
    }
  }

  // ข้อความเริ่มต้นหากระบบยังทำงานไม่ถึงคำสั่งอื่น
  if (text === 'เช็คระบบ') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `🤖 บอตป๊อกเด้ง 3 ใบสแตนด์บาย! สถานะห้องปัจจุบัน: ${gameState}`
    });
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
