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
let currentBets = {};  
let drawStatus = {};   
let tempResults = null; 

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
  
  // ตรวจสอบ/สร้างข้อมูลผู้เล่น
  if (!players[userId]) {
    try {
      let profile = await client.getProfile(userId);
      players[userId] = { name: profile.displayName, credit: 0, pendingWithdraw: 0 };
    } catch (e) {
      players[userId] = { name: 'สมาชิก', credit: 0, pendingWithdraw: 0 };
    }
  }
  
  let user = players[userId];

  // ==========================================
  // 👑 แอดมินจัดการเครดิต
  // ==========================================
  if (text.startsWith('เติม ')) {
    const parts = text.split(' ');
    if (parts.length === 3) {
      const targetId = parts[1];
      const amount = parseInt(parts[2]);
      if (players[targetId] && !isNaN(amount)) {
        players[targetId].credit += amount;
        return client.replyMessage(event.replyToken, { type: 'text', text: `💰 เติมเครดิตให้คุณ ${players[targetId].name} จำนวน +${amount} สำเร็จ!\nยอดคงเหลือสุทธิ: ${players[targetId].credit}` });
      }
    }
  }

  if (text.startsWith('ลบ ')) {
    const parts = text.split(' ');
    if (parts.length === 3) {
      const targetId = parts[1];
      const amount = parseInt(parts[2]);
      if (players[targetId] && !isNaN(amount)) {
        players[targetId].credit = Math.max(0, players[targetId].credit - amount);
        return client.replyMessage(event.replyToken, { type: 'text', text: `🚨 ลบยอดเครดิตของคุณ ${players[targetId].name} ออก -${amount} เรียบร้อย!\nยอดคงเหลือปัจจุบัน: ${players[targetId].credit}` });
      }
    }
  }

  if (text.startsWith('y ') || text.startsWith('Y ')) {
    const targetId = text.substring(2).trim();
    if (players[targetId] && players[targetId].pendingWithdraw > 0) {
      const withdrawAmount = players[targetId].pendingWithdraw;
      players[targetId].pendingWithdraw = 0; 
      return client.replyMessage(event.replyToken, { type: 'text', text: `✅ อนุมัติการถอนเงินของคุณ ${players[targetId].name} จำนวน ${withdrawAmount} บาท เรียบร้อย!` });
    }
  }

  if (text === 'ล้างระบบ') {
    currentBets = {};
    drawStatus = {};
    gameState = 'CLOSED';
    tempResults = null;
    return client.replyMessage(event.replyToken, { type: 'text', text: `🧹 ล้างระบบการเดิมพันและรีเซ็ตห้องให้เป็นสถานะปิดรอบเรียบร้อยแล้ว!` });
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
      let playerReport = `👤 คุณ ${pUser.name}:\n`;

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
  // 👥 คำสั่งของฝั่งผู้เล่น
  // ==========================================
  const betRegex = /^([1-6\s]+)-(\d+)$/;
  if (betRegex.test(text)) {
    if (gameState !== 'BETTING') return null;
    
    const match = text.match(betRegex);
    const legs = match[1].replace(/\s+/g, '').split(''); 
    const baseBet = parseInt(match[2]);
    const requiredDeposit = baseBet * 3 * legs.length;
    
    if (user.credit < requiredDeposit) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `❌ เครดิตไม่พอ! ยอดแทงรวมค้ำประกันเด้งที่ต้องใช้คือ ${requiredDeposit} บาท แต่ยอดปัจจุบันของคุณคือ ${user.credit} บาท`
      });
    }

    if (!currentBets[userId]) currentBets[userId] = {};
    legs.forEach(leg => {
      currentBets[userId][`leg${leg}`] = baseBet;
      if (!drawStatus[userId]) drawStatus[userId] = {};
      drawStatus[userId][`leg${leg}`] = '-';
    });

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `📥 บันทึกโพยสำเร็จ: ขา ${legs.join(',')} ขาละ ${baseBet}\nเครดิตปัจจุบันของคุณคือ: ${user.credit}`
    });
  }

  // คำสั่ง C เวอร์ชันข้อความธรรมดา ชัวร์ 100% ลบโครงสร้าง Flex ออกถาวรแล้ว
  if (text.toLowerCase() === 'c') {
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

    let replyMsg = `👤 [ ข้อมูลสมาชิก ]\n`;
    replyMsg += `• ชื่อ: ${user.name}\n`;
    replyMsg += `-------------------------\n`;
    replyMsg += `💰 ยอดเครดิตคงเหลือ: ${user.credit} บาท\n`;
    replyMsg += `📝 โพยเดิมพันปัจจุบัน:\n${activeBetsText}\n`;
    
    if (currentBets[userId]) {
      replyMsg += `-------------------------\n`;
      replyMsg += `💵 ยอดรวมที่ต้องค้ำเด้ง (3 เท่า): ${totalBetWithIns} บาท`;
    }

    return client.replyMessage(event.replyToken, { type: 'text', text: replyMsg });
  }

  const drawRegex = /^([1-6]+)([+\-])$/;
  if (drawRegex.test(text) && gameState === 'DRAWING') {
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
        return client.replyMessage(event.replyToken, { type: 'text', text: `🃏 คุณ ${user.name} สั่ง ขา ${updatedLegs.join(',')} ให้ [${action === '+' ? 'จั่วไพ่เพิ่ม ➕' : 'อยู่ไม่จั่ว ➖'}] เรียบร้อยครับ` });
      }
    }
  }

  if (text.toLowerCase() === 'r') {
    if (gameState !== 'BETTING') return null;
    if (currentBets[userId]) {
      delete currentBets[userId];
      if (drawStatus[userId]) delete drawStatus[userId];
      return client.replyMessage(event.replyToken, { type: 'text', text: `↩️ คืนโพยเดิมพันทั้งหมดในรอบนี้ของคุณ ${user.name} เรียบร้อยแล้วครับ` });
    }
  }

  if (text === '/บช') {
    return client.replyMessage(event.replyToken, { type: 'text', text: bankAccountInfo });
  }

  if (text.startsWith('ถอน ')) {
    const amount = parseInt(text.replace('ถอน ', ''));
    if (!isNaN(amount) && amount > 0) {
      if (user.pendingWithdraw > 0) {
        return client.replyMessage(event.replyToken, { type: 'text', text: `⚠️ คุณมีรายการถอนเดิมค้างอยู่ ${user.pendingWithdraw} บาท รอดำเนินการ` });
      }
      if (user.credit >= amount) {
        user.credit -= amount;
        user.pendingWithdraw = amount; 
        return client.replyMessage(event.replyToken, { type: 'text', text: `🔔 แจ้งถอนเงินสำเร็จ!\nคุณ ${user.name} แจ้งถอนยอด ${amount} บาท\nรอแอดมินกดยืนยันรายการ` });
      } else {
        return client.replyMessage(event.replyToken, { type: 'text', text: `❌ ยอดเครดิตของท่านไม่พอสำหรับการถอนเงินจำนวนนี้` });
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
      text: `🤖 [คู่มือคำสั่งผู้เล่น]\n• [เลขขา]-[ราคา] : ส่งโพย เช่น 123-100\n• C หรือ c : เช็คเครดิตและรายการโพย\n• R หรือ r : ขอคืนโพยทั้งหมดในรอบนั้น\n• ขาเลข+ : ขอจั่วไพ่ใบที่ 3 เช่น 12+\n• ขาเลข- : ขออยู่ไม่จั่วไพ่เพิ่ม เช่น 3-\n• /บช : ขอดูบัญชีโอนเงินเข้า\n• ถอน [ยอดเงิน] : ทำรายการแจ้งถอนเงิน`
    });
  }
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
