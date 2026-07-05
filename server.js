const express = require('express');
const line = require('@line/bot-sdk');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const app = express();
const client = new line.Client(config);

// 🗄️ Database ในหน่วยความจำ (Memory Storage)
let gameState = 'CLOSED'; 
let players = {};         
let memberMap = {};       
let currentBets = {};  
let drawStatus = {};   
let tempResults = null; 
let memberCount = 0;      

// 💸 ระบบคิวถอนเงิน
let withdrawQueue = [];   

// 💬 🔗 ส่วนตั้งค่าข้อมูลติดต่อ
const adminLineID = "@LINE_ADMIN"; 
const adminLineLink = "https://line.me/ti/p/~ไอดีไลน์ของแอดมิน"; 
let bankAccountInfo = "🏦 ธนาคาร: กสิกรไทย\nเลขบัญชี: xxx-x-xxxxx-x\nชื่อบัญชี: บอทป๊อกเด้งอัจฉริยะ";

app.post('/callback', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.json({ status: 'ok' }))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

function parseCardResult(resultStr) {
  if (!resultStr) return { type: 'POINT', score: 0, multiplier: 1, raw: '' };
  let cleaned = resultStr.trim().toLowerCase();
  let multiplier = 1;
  
  if (cleaned.includes('***')) { multiplier = 5; cleaned = cleaned.replace('***', ''); }
  else if (cleaned.includes('**')) { multiplier = 3; cleaned = cleaned.replace('**', ''); }
  else if (cleaned.includes('*')) { multiplier = 2; cleaned = cleaned.replace('*', ''); }

  if (cleaned.startsWith('ป๊อก')) {
    let score = parseInt(cleaned.replace('ป๊อก', ''));
    return { type: 'POK', score: score, multiplier: multiplier, raw: resultStr };
  }
  if (cleaned === 'ตอง') return { type: 'TONG', score: 10, multiplier: multiplier, raw: resultStr };
  if (cleaned === 'สเตรฟรัช') return { type: 'STRAIGHT_FLUSH', score: 9, multiplier: multiplier, raw: resultStr };
  if (cleaned === 'สเตร') return { type: 'STRAIGHT', score: 8, multiplier: multiplier, raw: resultStr };
  if (cleaned === 'เซียน') return { type: 'ZEAN', score: 7, multiplier: multiplier, raw: resultStr };
  
  let score = parseInt(cleaned) || 0;
  return { type: 'POINT', score: score % 10, multiplier: multiplier, raw: resultStr };
}

function compareHands(player, dealer) {
  const typeOrder = { 'POK': 7, 'TONG': 6, 'STRAIGHT_FLUSH': 5, 'STRAIGHT': 4, 'ZEAN': 3, 'POINT': 2 };
  if (typeOrder[player.type] > typeOrder[dealer.type]) return 'WIN';
  if (typeOrder[player.type] < typeOrder[dealer.type]) return 'LOSE';
  
  if (player.type === 'POK' || player.type === 'POINT') {
    if (player.score > dealer.score) return 'WIN';
    if (player.score < dealer.score) return 'LOSE';
    return 'DRAW'; 
  }
  return 'DRAW'; 
}

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return null;

  const text = event.message.text.trim();
  const userId = event.source.userId;
  
  if (!players[userId]) {
    players[userId] = { 
      memberId: null, 
      realName: null, 
      credit: 0, 
      pendingWithdraw: 0 
    };
  }
  
  let user = players[userId];

  // ==========================================
  // 📝 ระบบลงทะเบียนสมาชิกด้วย C/ชื่อ-นามสกุล
  // ==========================================
  if (text.toUpperCase().startsWith('C/')) {
    const nameInput = text.substring(2).trim();
    if (!nameInput) {
      return client.replyMessage(event.replyToken, { type: 'text', text: `⚠️ กรุณาระบุ ชื่อ-นามสกุล ให้ถูกต้อง เช่น C/นายสมชาย รักดี` });
    }
    
    if (user.realName) {
      user.realName = nameInput;
      return client.replyMessage(event.replyToken, { 
        type: 'text', 
        text: `🔄 อัปเดตข้อมูลสำเร็จ!\nสมาชิกคนที่: ${user.memberId}\nเปลี่ยนชื่อเป็น: ${user.realName}` 
      });
    } else {
      memberCount++;
      user.memberId = memberCount;
      user.realName = nameInput;
      memberMap[memberCount] = userId; 
      
      let welcomeMsg = `🎉 ลงทะเบียนสมาชิกใหม่สำเร็จ! 🎉\n`;
      welcomeMsg += `🆔 คุณคือสมาชิกคนที่: ${user.memberId}\n`;
      welcomeMsg += `👤 ชื่อ-นามสกุล: ${user.realName}\n\n`;
      welcomeMsg += `💰 ยอดเครดิตเริ่มต้น: ${user.credit} บาท\n`;
      welcomeMsg += `*ตอนนี้คุณสามารถส่งโพยและพิมพ์ C เพื่อเช็คการ์ดสมาชิกได้แล้วครับ`;
      
      return client.replyMessage(event.replyToken, { type: 'text', text: welcomeMsg });
    }
  }

  // ==========================================
  // 👑 แอดมินจัดการเครดิต
  // ==========================================
  if (text.startsWith('เติม ')) {
    const parts = text.split(' ');
    if (parts.length === 3) {
      const mId = parseInt(parts[1]);
      const amount = parseInt(parts[2]);
      const targetUserId = memberMap[mId];
      
      if (targetUserId && players[targetUserId] && !isNaN(amount)) {
        players[targetUserId].credit += amount;
        return client.replyMessage(event.replyToken, { type: 'text', text: `💰 เติมเครดิตให้ [สมาชิกคนที่ ${mId}] คุณ ${players[targetUserId].realName} จำนวน +${amount} สำเร็จ!\nยอดคงเหลือสุทธิ: ${players[targetUserId].credit} บาท` });
      }
    }
  }

  if (text.startsWith('ลบ ')) {
    const parts = text.split(' ');
    if (parts.length === 3) {
      const mId = parseInt(parts[1]);
      const amount = parseInt(parts[2]);
      const targetUserId = memberMap[mId];
      
      if (targetUserId && players[targetUserId] && !isNaN(amount)) {
        players[targetUserId].credit = Math.max(0, players[targetUserId].credit - amount);
        return client.replyMessage(event.replyToken, { type: 'text', text: `🚨 ลบยอดเครดิตของ [สมาชิกคนที่ ${mId}] คุณ ${players[targetUserId].realName} ออก -${amount} เรียบร้อย!\nยอดคงเหลือปัจจุบัน: ${players[targetUserId].credit} บาท` });
      }
    }
  }

  if (text.toLowerCase().startsWith('y ')) {
    const mId = parseInt(text.substring(2).trim());
    const targetUserId = memberMap[mId];
    
    if (targetUserId && players[targetUserId] && players[targetUserId].pendingWithdraw > 0) {
      const withdrawAmount = players[targetUserId].pendingWithdraw;
      players[targetUserId].pendingWithdraw = 0; 
      
      withdrawQueue = withdrawQueue.filter(q => q.memberId !== mId);
      
      return client.replyMessage(event.replyToken, { 
        type: 'text', 
        text: `✅ อนุมัติการถอนเงินสำเร็จ!\n👤 สมาชิกคนที่ ${mId} (${players[targetUserId].realName})\n💵 ยอดเงินถอน: ${withdrawAmount} บาท ถูกหักออกจากเครดิตและปลดล็อกระบบเรียบร้อยครับ` 
      });
    }
  }

  if (text === 'ล้างระบบ') {
    currentBets = {};
    drawStatus = {};
    gameState = 'CLOSED';
    tempResults = null;
    withdrawQueue = [];
    return client.replyMessage(event.replyToken, { type: 'text', text: `🧹 ล้างระบบการเดิมพัน รีเซ็ตห้องเกม และล้างคิวถอนเงินทั้งหมดเรียบร้อยแล้ว!` });
  }

  // ==========================================
  // 🎮 โฟลว์เกมหลัก
  // ==========================================
  if (text.toLowerCase() === 'o') {
    gameState = 'BETTING';
    currentBets = {};
    drawStatus = {};
    tempResults = null;
    return client.replyMessage(event.replyToken, { type: 'text', text: `🟢 [เปิดรับโพย] ป๊อกเด้ง 3 ใบเริ่มขึ้นแล้ว! กรุณาส่งโพยเดิมพันของท่านเข้ามาได้เลยครับ` });
  }

  if (text.toLowerCase() === 'x') {
    if (gameState !== 'BETTING') return null;
    gameState = 'WAITING_DRAW';
    return client.replyMessage(event.replyToken, { type: 'text', text: `🛑 [ปิดรับโพยแทง] ปิดรับโพยประจำรอบแล้ว! ห้ามแก้ไขหรือส่งโพยเพิ่มหลังจากนี้ครับ` });
  }

  if (text.toLowerCase() === 'oo') {
    if (gameState !== 'WAITING_DRAW') return null;
    gameState = 'DRAWING';
    return client.replyMessage(event.replyToken, { type: 'text', text: `🃏 [เปิดรอบจั่ว] แอดมินถ่ายรูปไพ่ 2 ใบเรียบร้อยแล้ว! สมาชิกต้องการจั่วเพิ่ม พิมพ์เลขขาตามด้วย + (เช่น 12+) ถ้าขาไหนต้องการอยู่ให้พิมพ์ - ได้เลยครับ` });
  }

  if (text.toLowerCase() === 'xx') {
    if (gameState !== 'DRAWING') return null;
    gameState = 'WAITING_RESULT';
    return client.replyMessage(event.replyToken, { type: 'text', text: `🔒 [ปิดรอบจั่ว] หมดเวลาการเลือกจั่วเพิ่มแล้วครับ! ระบบกำลังล็อกคำสั่งและสแตนด์บายรอผลสรุปไพ่จากแอดมิน` });
  }

  if (text.startsWith('/') && gameState === 'WAITING_RESULT') {
    const lines = text.split('\n');
    if (lines.length >= 2 && lines[0].startsWith('/') && lines[1].startsWith('//')) {
      const firstSet = lines[0].substring(1).split(',');
      const secondSet = lines[1].substring(2).split(',');
      if (firstSet.length < 2 || secondSet.length < 2) return null;
      
      tempResults = { first: firstSet, second: secondSet };
      gameState = 'CONFIRMING';
      
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `📊 [ระบบตรวจพบผลไพ่]\nชุด 2 ใบแรก: ${firstSet.join(' | ')}\nชุดรวมใบที่ 3: ${secondSet.join(' | ')}\n\n⚠️ แอดมินกรุณาตรวจสอบความถูกต้อง หากถูกต้องพิมพ์ "OK" เพื่อคำนวณบิล หากผิดพลาดพิมพ์ "no" เพื่อส่งใหม่`
      });
    }
  }

  if (text.toUpperCase() === 'OK' && gameState === 'CONFIRMING' && tempResults) {
    let summaryText = `📋 [สรุปผลการคิดบิลป๊อกเด้ง 3 ใบ]\n`;
    const firstSet = tempResults.first;
    const secondSet = tempResults.second;
    
    const dealerFirst = parseCardResult(firstSet[firstSet.length - 1]);
    const dealerSecond = parseCardResult(secondSet[secondSet.length - 1]);
    
    for (const pId in currentBets) {
      let pBet = currentBets[pId];
      let pDraw = drawStatus[pId] || {};
      let pUser = players[pId];
      let totalChange = 0;
      let playerReport = `👤 [คนที่ ${pUser.memberId || '?'}] คุณ ${pUser.realName || 'ไม่ระบุชื่อ'}:\n`;

      for (let i = 0; i < firstSet.length - 1; i++) {
        let legNum = i + 1;
        if (pBet[`leg${legNum}`]) {
          let betAmount = pBet[`leg${legNum}`];
          let isDrawing = pDraw[`leg${legNum}`] === '+'; 
          
          let pResult = isDrawing ? parseCardResult(secondSet[i]) : parseCardResult(firstSet[i]);
          let dResult = isDrawing ? dealerSecond : dealerFirst;
          
          let outcome = compareHands(pResult, dResult);
          let winMult = pResult.multiplier;
          let loseMult = dResult.multiplier;
          
          if (loseMult === 5) loseMult = 3;

          if (outcome === 'WIN') {
            let winAmt = betAmount * winMult;
            totalChange += winAmt;
            playerReport += `  - ขา ${legNum} [${pResult.raw} VS ${dResult.raw}] ชนะ 🎉 (+${winAmt})\n`;
          } else if (outcome === 'LOSE') {
            let loseAmt = betAmount * loseMult;
            totalChange -= loseAmt;
            playerReport += `  - ขา ${legNum} [${pResult.raw} VS ${dResult.raw}] แพ้ ❌ (-${loseAmt})\n`;
          } else {
            playerReport += `  - ขา ${legNum} [${pResult.raw} VS ${dResult.raw}] เจ๊า 🤝 (0)\n`;
          }
        }
      }
      
      pUser.credit += totalChange;
      playerReport += `💰 ยอดรวมรอบนี้: ${totalChange >= 0 ? '+' : ''}${totalChange} | เครดิตสุทธิ: ${pUser.credit}\n\n`;
      summaryText += playerReport;
    }

    gameState = 'CLOSED';
    currentBets = {};
    drawStatus = {};
    tempResults = null;
    return client.replyMessage(event.replyToken, { type: 'text', text: summaryText });
  }

  if (text.toLowerCase() === 'no' && gameState === 'CONFIRMING') {
    gameState = 'WAITING_RESULT';
    tempResults = null;
    return client.replyMessage(event.replyToken, { type: 'text', text: `❌ ยกเลิกผลไพ่เรียบร้อยแล้ว แอดมินสามารถส่งผลไพ่ 2 บรรทัดใหม่อีกครั้งได้เลยครับ` });
  }

  // ==========================================
  // 👥 คำสั่งของฝั่งผู้เล่น (ระบบวิเคราะห์โพยอัจฉริยะ)
  // ==========================================
  
  // ตรวจจับโพยแทงรูปแบบต่าง ๆ (123-50, แทง 123-50, จ123 50, มข 50, มจ 50)
  let isBettingMessage = false;
  let parsedLegs = [];
  let parsedPrice = 0;
  let betTypeLabel = "";

  if (gameState === 'BETTING') {
    let cleanText = text.replace(/\s+/g, ' '); // ยุบช่องว่างที่ซ้ำกัน
    
    // 1. เคสมเหมาขา หรือ เหมาเจ้า (มข / มจ) -> ตัวอย่าง: มข 50, มจ 100, เหมาขา 50, เหมาเจ้า 50
    const เหมาRegex = /^(มข|มจ|เหมาขา|เหมาเจ้า)\s*[- ]?\s*(\d+)$/i; // 👈 เติมช่องว่างระหว่าง const กับ เหมาRegex

    if (เหมาRegex.test(cleanText)) {
    // 2. เคสระบุขาปกติ -> ตัวอย่าง: 123-50, แทง 123-50, จ123-50, จ123 50
    const ระบุขาRegex = /^(แทง|จ)?\s*([1-6]+)\s*[- ]\s*(\d+)$/;

    if (เหมาRegex.test(cleanText)) {
      const match = cleanText.match(เหมาRegex);
      const type = match[1];
      parsedPrice = parseInt(match[2]);
      parsedLegs = ['1', '2', '3', '4', '5', '6']; // เหมาหมดทุกขาผู้เล่น
      betTypeLabel = (type === 'มข' || type === 'เหมาขา') ? "เหมาขาผู้เล่น" : "เหมาเจ้าสู้ทุกขา";
      isBettingMessage = true;
    } else if (ระบุขาRegex.test(cleanText)) {
      const match = cleanText.match(ระบุขาRegex);
      parsedLegs = match[2].split('');
      parsedPrice = parseInt(match[3]);
      betTypeLabel = `ขา ${parsedLegs.join(',')}`;
      isBettingMessage = true;
    }
  }

  // ทำการบันทึกโพยแทงเมื่อตรงเงื่อนไข
  if (isBettingMessage) {
    if (!user.realName) {
      return client.replyMessage(event.replyToken, { type: 'text', text: `🔒 คุณยังไม่ได้ลงทะเบียนสมาชิกกลุ่ม!\nกรุณาพิมพ์ C/ตามด้วยชื่อ-นามสกุล ก่อนทำรายการครับ\n(ตัวอย่าง: C/นายรักดี เล่นป๊อก)` });
    }
    if (user.pendingWithdraw > 0) {
      return client.replyMessage(event.replyToken, { type: 'text', text: `⚠️ บัญชีของคุณถูกล็อกการเดิมพันชั่วคราว เนื่องจากอยู่ในระหว่างรอการอนุมัติถอนเงินยอด ${user.pendingWithdraw} บาทครับ` });
    }

    const requiredDeposit = parsedPrice * 3 * parsedLegs.length; // ทุนค้ำประกันเด้ง 3 เท่า
    
    if (user.credit < requiredDeposit) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `❌ เครดิตไม่พอ! รายการ [${betTypeLabel} ขาละ ${parsedPrice}] ต้องใช้ยอดค้ำประกันเด้งรวม ${requiredDeposit} บาท แต่ปัจจุบันคุณมีแค่ ${user.credit} บาท`
      });
    }

    if (!currentBets[userId]) currentBets[userId] = {};
    parsedLegs.forEach(leg => {
      currentBets[userId][`leg${leg}`] = parsedPrice;
      if (!drawStatus[userId]) drawStatus[userId] = {};
      drawStatus[userId][`leg${leg}`] = '-';
    });

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `📥 [คนที่ ${user.memberId}] บันทึกโพยสำเร็จ: ${betTypeLabel} ขาละ ${parsedPrice}\n💰 เครดิตคงเหลือของคุณคือ: ${user.credit} บาท`
    });
  }

  // คำสั่ง C
  if (text.toLowerCase() === 'c') {
    if (!user.realName) {
      return client.replyMessage(event.replyToken, { 
        type: 'text', 
        text: `📢 ยินดีต้อนรับครับสมาชิกใหม่!\n\n⚠️ คุณยังไม่ได้ลงทะเบียนชื่อจริงในระบบ\nกรุณาพิมพ์: C/ชื่อ-นามสกุล ของท่านเพื่อเปิดการใช้งานบอทครับ\n(ตัวอย่าง: C/นายแจ๊ค เด้งดี)` 
      });
    }

    let activeBetsText = "❌ ไม่มีโพยค้างอยู่ในรอบนี้";
    let totalBetWithIns = 0;
    
    if (currentBets[userId]) {
      let activeBets = [];
      for (let key in currentBets[userId]) {
        let amt = currentBets[userId][key];
        activeBets.push(`  • ${key.replace('leg', 'ขา ')}: ${amt} บาท`);
        totalBetWithIns += (amt * 3);
      }
      activeBetsText = activeBets.join('\n');
    }

    let replyMsg = `👤 [ ข้อมูลสมาชิกห้องป๊อกเด้ง ]\n`;
    replyMsg += `🆔 สมาชิกคนที่: ${user.memberId}\n`;
    replyMsg += `• ชื่อจริง: ${user.realName}\n`;
    replyMsg += `-------------------------\n`;
    replyMsg += `💰 ยอดเครดิตคงเหลือ: ${user.credit} บาท\n`;
    if (user.pendingWithdraw > 0) {
      replyMsg += `⏳ ยอดที่กำลังรอถอน: ${user.pendingWithdraw} บาท\n`;
    }
    replyMsg += `📝 โพยเดิมพันปัจจุบัน:\n${activeBetsText}\n`;
    
    if (currentBets[userId]) {
      replyMsg += `-------------------------\n`;
      replyMsg += `💵 ยอดรวมที่ต้องค้ำเด้ง (3 เท่า): ${totalBetWithIns} บาท\n`;
    }

    return client.replyMessage(event.replyToken, { type: 'text', text: replyMsg });
  }

  // คำสั่งจั่วไพ่
  const drawRegex = /^([1-6]+)([+\-])$/;
  if (drawRegex.test(text) && gameState === 'DRAWING') {
    if (!user.realName) return null;
    const match = text.match(drawRegex);
    const legs = match[1].split('');
    const action = match[2]; 
    
    if (currentBets[userId]) {
      let updatedLegs = [];
      legs.forEach(leg => {
        if (currentBets[userId][`leg${leg}`]) {
          if (!drawStatus[userId]) drawStatus[userId] = {};
          drawStatus[userId][`leg${leg}`] = action;
          updatedLegs.push(leg);
        }
      });
      if (updatedLegs.length > 0) {
        return client.replyMessage(event.replyToken, { type: 'text', text: `🃏 สมาชิกคนที่ ${user.memberId} (${user.realName}) สั่ง ขา ${updatedLegs.join(',')} ให้ [${action === '+' ? 'จั่วไพ่เพิ่ม ➕' : 'อยู่ไม่จั่ว ➖'}] เรียบร้อยครับ` });
      }
    }
  }

  // คำสั่งคืนโพย
  if (text.toLowerCase() === 'r') {
    if (!user.realName) return null;
    if (gameState !== 'BETTING') return null;
    if (currentBets[userId]) {
      delete currentBets[userId];
      if (drawStatus[userId]) delete drawStatus[userId];
      return client.replyMessage(event.replyToken, { type: 'text', text: `↩️ คืนโพยเดิมพันทั้งหมดในรอบนี้ของ สมาชิกคนที่ ${user.memberId} (${user.realName}) เรียบร้อยแล้วครับ` });
    }
  }

  if (text === '/บช') {
    return client.replyMessage(event.replyToken, { type: 'text', text: bankAccountInfo });
  }

  // ระบบถอนเงิน
  if (text.startsWith('ถอน ')) {
    if (!user.realName) return null;
    const amount = parseInt(text.replace('ถอน ', ''));
    if (!isNaN(amount) && amount > 0) {
      if (user.pendingWithdraw > 0) {
        return client.replyMessage(event.replyToken, { type: 'text', text: `⚠️ คุณมีรายการถอนเดิมค้างอยู่ ${user.pendingWithdraw} บาท รอดำเนินการอนุมัติอยู่ครับ` });
      }
      if (user.credit >= amount) {
        user.credit -= amount;
        user.pendingWithdraw = amount; 
        
        withdrawQueue.push({
          memberId: user.memberId,
          amount: amount,
          userId: userId
        });
        
        const currentQueueIndex = withdrawQueue.length;

        let withdrawReply = `🔔 แจ้งถอนเงินสำเร็จ! (ระบบหักเครดิตรอโอนแล้ว)\n`;
        withdrawReply += `👤 สมาชิกคนที่ ${user.memberId} (${user.realName})\n`;
        withdrawReply += `💵 ยอดเงินแจ้งถอน: ${amount} บาท\n`;
        withdrawReply += `🔢 คุณอยู่ในคิวถอนเงินลำดับที่: [ ${currentQueueIndex} ]\n`;
        withdrawReply += `-------------------------\n`;
        withdrawReply += `📲 กรุณากดลิงก์ด้านล่างเพื่อส่งเลขบัญชีให้แอดมินโอนยอดได้ทันทีครับ:\n`;
        withdrawReply += `🔗 ลิงก์แอดไลน์: ${adminLineLink}\n`;
        withdrawReply += `🆔 ID LINE: ${adminLineID}\n\n`;
        withdrawReply += `*เมื่อแอดมินโอนสำเร็จ ระบบจะแจ้งอนุมัติในกลุ่มนี้อีกครั้งครับ`;

        return client.replyMessage(event.replyToken, { type: 'text', text: withdrawReply });
      } else {
        return client.replyMessage(event.replyToken, { type: 'text', text: `❌ ยอดเครดิตของท่านไม่พอสำหรับการถอนเงินจำนวนนี้ (เครดิตปัจจุบันของคุณคือ ${user.credit} บาท)` });
      }
    }
  }

  if (text === 'กติกา') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `📜 [กติกาป๊อกเด้ง 3 ใบ]\n1. ลำดับไพ่: ป๊อก 9 > ป๊อก 8 > ไพ่ตอง (5 เด้ง) > สเตรฟลัช (5 เด้ง) > สเตร (3 เด้ง) > เซียน (3 เด้ง) > ไพ่แต้ม\n2. ไพ่แต้มรวม 3 ใบ จะเล็กกว่าไพ่ป๊อกเสมอ\n3. เด้งสัญลักษณ์พิเศษ: * = 2 เด้ง, ** = 3 เด้ง, *** = 5 เด้ง\n4. ประกันเด้ง: กรณีเสีย หักสูงสุดแค่ 3 เด้ง แต่กรณีชนะตอง/สเตรฟลัช ได้รับเต็ม 5 เด้ง!`
    });
  }

  if (text === 'คำสั่ง') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `🤖 [คู่มือคำสั่งผู้เล่น]\n• C/[ชื่อ-นามสกุล] : ลงทะเบียนสมาชิกครั้งแรก\n• โพยปกติ : 123-50 หรือ แทง 123-50\n• มข [ราคา] : เหมาขาผู้เล่นทุกคนสู้เจ้า เช่น มข 50\n• มจ [ราคา] : เหมาขาเจ้าสู้ผู้เล่นทุกคน เช่น มจ 50\n• C หรือ c : เช็คเครดิตตัวเอง\n• R หรือ r : คืนโพยทั้งหมดในรอบ\n• ขาเลข+ / ขาเลข- : สั่งจั่ว/อยู่ไพ่ เช่น 12+ / 3-\n• ถอน [ยอดเงิน] : ทำรายการแจ้งถอนเงิน`
    });
  }
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
