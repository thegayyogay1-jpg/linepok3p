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

// ฟังก์ชันวิเคราะห์หน้าไพ่และแต้มอย่างละเอียด (รองรับแต้มภาษาไทยและเด้ง *, **, ***)
function parseCardResult(resultStr) {
  if (!resultStr) return { type: 'POINT', score: 0, multiplier: 1, raw: '0 แต้ม', isPok: false, cardsCount: 2 };
  
  let cleaned = resultStr.trim().toLowerCase();
  let multiplier = 1;
  
  // ตรวจสอบจำนวนเด้ง
  if (cleaned.includes('***')) { multiplier = 5; cleaned = cleaned.replace('***', ''); }
  else if (cleaned.includes('**')) { multiplier = 3; cleaned = cleaned.replace('**', ''); }
  else if (cleaned.includes('*')) { multiplier = 2; cleaned = cleaned.replace('*', ''); }

  // เช็คจำนวนใบจากความยาวตัวอักษรดิบ (ใช้ช่วยกรองตรรกะเปรียบเทียบ)
  let pureDigits = resultStr.replace(/[*_a-zA-Z]/g, '').trim();
  let cardsCount = pureDigits.length >= 3 ? 3 : 2; 

  // 1. ไพ่ป๊อก (ต้องเกิดจาก 2 ใบแรกเท่านั้น)
  if (cleaned.startsWith('ป๊อก')) {
    let score = parseInt(cleaned.replace('ป๊อก', '')) || 0;
    return { type: 'POK', score: score, multiplier: multiplier, raw: `ป๊อก ${score}`, isPok: true, cardsCount: 2 };
  }
  
  // 2. ไพ่ตอง
  if (cleaned === 'ตอง') {
    return { type: 'TONG', score: 10, multiplier: multiplier, raw: 'ตอง (5 เด้ง)', isPok: false, cardsCount: 3 };
  }
  // 3. ไพ่สเตรฟลัช / เรียงดอก
  if (cleaned === 'สเตรฟรัช' || cleaned === 'สเตรฟลัช') {
    return { type: 'STRAIGHT_FLUSH', score: 9, multiplier: multiplier, raw: 'สเตรฟลัช (5 เด้ง)', isPok: false, cardsCount: 3 };
  }
  // 4. ไพ่สเตร / เรียง
  if (cleaned === 'สเตร' || cleaned === 'เรียง') {
    return { type: 'STRAIGHT', score: 8, multiplier: multiplier, raw: 'เรียง (3 เด้ง)', isPok: false, cardsCount: 3 };
  }
  // 5. ไพ่เซียน / สามเหลือง
  if (cleaned === 'เซียน') {
    return { type: 'ZEAN', score: 7, multiplier: multiplier, raw: 'เซียน (3 เด้ง)', isPok: false, cardsCount: 3 };
  }
  
  // 6. ไพ่แต้มปกติ
  let score = parseInt(cleaned) || 0;
  // กรณีระบุมาเป็นตัวเลขตรงๆ เช่น 62 หรือ 72* แต่ไม่ได้พิมพ์คำว่าป๊อกนำหน้า (ระบบจะแปลงเป็นแต้มหลักหน่วย)
  if (score > 9) {
    score = score % 10;
  }
  
  let multText = multiplier > 1 ? ` ${multiplier} เด้ง` : '';
  return { type: 'POINT', score: score, multiplier: multiplier, raw: `${score} แต้ม${multText}`, isPok: false, cardsCount: cardsCount };
}

// ฟังก์ชันเปรียบเทียบผลแพ้ชนะตามกฎป๊อกเด้ง (Fix บั๊ก 3 ใบชนะป๊อกเจ้า)
function compareHands(player, dealer) {
  // กฎเหล็ก: ถ้าเจ้ามือป๊อก (2 ใบ) ขาที่จั่วใบที่ 3 (3 ใบ) จะแพ้ทันทีโดยไม่มีสิทธิ์สู้
  if (dealer.isPok && player.cardsCount === 3) {
    return 'LOSE';
  }
  // ถ้าผู้เล่นป๊อก แต่เจ้ามือจั่ว 3 ใบ ผู้เล่นชนะทันที
  if (player.isPok && dealer.cardsCount === 3) {
    return 'WIN';
  }

  const typeOrder = { 'POK': 7, 'TONG': 6, 'STRAIGHT_FLUSH': 5, 'STRAIGHT': 4, 'ZEAN': 3, 'POINT': 2 };
  
  if (typeOrder[player.type] > typeOrder[dealer.type]) return 'WIN';
  if (typeOrder[player.type] < typeOrder[dealer.type]) return 'LOSE';
  
  // ถ้าไพ่ประเภทเดียวกัน วัดกันที่แต้มสุทธิ
  if (player.score > dealer.score) return 'WIN';
  if (player.score < dealer.score) return 'LOSE';
  
  return 'DRAW'; // แต้มเท่ากัน ไพ่ประเภทเดียวกัน = เจ๊า
}

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return null;

  const text = event.message.text.trim();
  const userId = event.source.userId;
  
  let lineName = "ผู้เล่นทั่วไป";
  try {
    const profile = await client.getProfile(userId);
    lineName = profile.displayName;
  } catch (e) {}

  if (!players[userId]) {
    players[userId] = { memberId: null, realName: lineName, credit: 0, pendingWithdraw: 0 };
  }
  let user = players[userId];

  // ==========================================
  // 📝 ระบบลงทะเบียนสมาชิกด้วย C/ชื่อ-นามสกุล
  // ==========================================
  if (text.toUpperCase().startsWith('C/')) {
    const nameInput = text.substring(2).trim();
    if (!nameInput) return client.replyMessage(event.replyToken, { type: 'text', text: `⚠️ กรุณาระบุ ชื่อ-นามสกุล ให้ถูกต้อง เช่น C/นายสมชาย รักดี` });
    
    if (user.memberId) {
      user.realName = nameInput;
      return client.replyMessage(event.replyToken, { type: 'text', text: `🔄 อัปเดตข้อมูลสำเร็จ!\nสมาชิกคนที่: ${user.memberId}\nเปลี่ยนชื่อเป็น: ${user.realName}` });
    } else {
      memberCount++;
      user.memberId = memberCount;
      user.realName = nameInput;
      memberMap[memberCount] = userId; 
      
      let welcomeMsg = `🎉 ลงทะเบียนสมาชิกใหม่สำเร็จ! 🎉\n🆔 คุณคือสมาชิกคนที่: ${user.memberId}\n👤 ชื่อระบบ: ${user.realName}\n💰 ยอดเครดิตเริ่มต้น: ${user.credit} บาท`;
      return client.replyMessage(event.replyToken, { type: 'text', text: welcomeMsg });
    }
  }

  // ==========================================
  // 👑 แอดมินจัดการเครดิต & เปิดห้อง
  // ==========================================
  if (text.startsWith('เติม ')) {
    const parts = text.split(' ');
    if (parts.length === 3) {
      const mId = parseInt(parts[1]);
      const amount = parseInt(parts[2]);
      const targetUserId = memberMap[mId];
      if (targetUserId && players[targetUserId] && !isNaN(amount)) {
        players[targetUserId].credit += amount;
        return client.replyMessage(event.replyToken, { type: 'text', text: `💰 เติมเครดิตให้ [สมาชิกคนที่ ${mId}] คุณ ${players[targetUserId].realName} +${amount} สำเร็จ!\nยอดสุทธิ: ${players[targetUserId].credit} บาท` });
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
        return client.replyMessage(event.replyToken, { type: 'text', text: `🚨 ลบยอดเครดิตของ [สมาชิกคนที่ ${mId}] คุณ ${players[targetUserId].realName} -${amount} เรียบร้อย!\nยอดปัจจุบัน: ${players[targetUserId].credit} บาท` });
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
      return client.replyMessage(event.replyToken, { type: 'text', text: `✅ อนุมัติการถอนเงินสำเร็จ!\n👤 สมาชิกคนที่ ${mId} (${players[targetUserId].realName}) ยอด ${withdrawAmount} บาท เรียบร้อยครับ` });
    }
  }

  if (text === 'ล้างระบบ') {
    for (const pId in currentBets) {
      let pBet = currentBets[pId];
      let totalLocked = 0;
      for (let leg in pBet) { totalLocked += (pBet[leg] * 3); }
      if (players[pId]) { players[pId].credit += totalLocked; }
    }
    currentBets = {}; drawStatus = {}; gameState = 'CLOSED'; tempResults = null; withdrawQueue = [];
    return client.replyMessage(event.replyToken, { type: 'text', text: `🧹 ล้างระบบการเดิมพัน รีเซ็ตห้องเกม และคืนเงินประกันค้างโพยทั้งหมดเรียบร้อยแล้ว!` });
  }

  if (text.toLowerCase() === 'o') {
    gameState = 'BETTING'; currentBets = {}; drawStatus = {}; tempResults = null;
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
    return client.replyMessage(event.replyToken, { type: 'text', text: `🃏 [เปิดรอบจั่ว] สมาชิกต้องการจั่วเพิ่ม พิมพ์เลขขาตามด้วย + (เช่น 12+) ถ้าขาไหนต้องการอยู่ให้พิมพ์ - ได้เลยครับ` });
  }

  if (text.toLowerCase() === 'xx') {
    if (gameState !== 'DRAWING') return null;
    gameState = 'WAITING_RESULT';
    return client.replyMessage(event.replyToken, { type: 'text', text: `🔒 [ปิดรอบจั่ว] หมดเวลาการเลือกจั่วเพิ่มแล้วครับ! รอกลลัพธ์สรุปไพ่จากแอดมิน` });
  }

  // ==========================================
  // 📊 แอดมินส่งผลไพ่ (แยกหน้าจอสรุปผลรวมทุกขา)
  // ==========================================
  if (text.startsWith('/') && gameState === 'WAITING_RESULT') {
    const lines = text.split('\n');
    if (lines.length >= 2 && lines[0].startsWith('/') && lines[1].startsWith('//')) {
      const firstSet = lines[0].substring(1).split(',');
      const secondSet = lines[1].substring(2).split(',');
      if (firstSet.length < 2 || secondSet.length < 2) return null;
      
      tempResults = { first: firstSet, second: secondSet };
      gameState = 'CONFIRMING';
      
      // ดึงข้อมูลหน้าไพ่ของเจ้ามือ
      const dealerFirst = parseCardResult(firstSet[firstSet.length - 1]);
      const dealerSecond = parseCardResult(secondSet[secondSet.length - 1]);

      let displayMsg = `📊 [สรุปผลไพ่รวมประจำรอบ]\n\n`;
      
      // 1. ชุดที่ 1 ไม่จั่ว (2 ใบแรก)
      displayMsg += `🔸 ชุดที่ 1 (ไม่จั่ว)\n👑 เจ้ามือ: ${dealerFirst.raw}\n`;
      for (let i = 0; i < firstSet.length - 1; i++) {
        let legNum = i + 1;
        let pResult = parseCardResult(firstSet[i]);
        let outcome = compareHands(pResult, dealerFirst);
        let statusText = outcome === 'WIN' ? 'ชนะ 🎉' : (outcome === 'LOSE' ? 'แพ้ ❌' : 'เจ๊า 🤝');
        displayMsg += `  • ขา ${legNum} - ${pResult.raw} (${statusText})\n`;
      }
      
      displayMsg += `\n-------------------------\n\n`;
      
      // 2. ชุดที่ 2 จั่ว (รวมใบที่ 3)
      displayMsg += `🔹 ชุดที่ 2 (จั่วเพิ่ม)\n👑 เจ้ามือ: ${dealerSecond.raw}\n`;
      for (let i = 0; i < secondSet.length - 1; i++) {
        let legNum = i + 1;
        let pResult = parseCardResult(secondSet[i]);
        let outcome = compareHands(pResult, dealerSecond);
        let statusText = outcome === 'WIN' ? 'ชนะ 🎉' : (outcome === 'LOSE' ? 'แพ้ ❌' : 'เจ๊า 🤝');
        displayMsg += `  • ขา ${legNum} - ${pResult.raw} (${statusText})\n`;
      }
      
      displayMsg += `\n⚠️ แอดมินตรวจสอบความถูกต้อง หากถูกต้องพิมพ์ "OK" เพื่อส่งบิลคิดเงินรายบุคคล หากผิดพลาดพิมพ์ "no"`;
      
      return client.replyMessage(event.replyToken, { type: 'text', text: displayMsg });
    }
  }

  // ==========================================
  // 💰 แอดมินพิมพ์ OK -> คำนวณเงินและส่งสรุปรายคน
  // ==========================================
  if (text.toUpperCase() === 'OK' && gameState === 'CONFIRMING' && tempResults) {
    let billSummaryText = `📋 [สรุปบิลได้เสียรายบุคคล]\n-------------------------\n`;
    const firstSet = tempResults.first;
    const secondSet = tempResults.second;
    
    const dealerFirst = parseCardResult(firstSet[firstSet.length - 1]);
    const dealerSecond = parseCardResult(secondSet[secondSet.length - 1]);
    
    let hasBets = false;

    for (const pId in currentBets) {
      hasBets = true;
      let pBet = currentBets[pId];
      let pDraw = drawStatus[pId] || {};
      let pUser = players[pId];
      let totalChange = 0;
      let totalInsuranceRefund = 0;
      
      let detailLines = [];

      for (let i = 0; i < firstSet.length - 1; i++) {
        let legNum = i + 1;
        if (pBet[`leg${legNum}`]) {
          let betAmount = pBet[`leg${legNum}`];
          let isDrawing = pDraw[`leg${legNum}`] === '+'; 
          
          totalInsuranceRefund += (betAmount * 3); // สะสมยอดคืนประกันตัวเต็ม

          let pResult = isDrawing ? parseCardResult(secondSet[i]) : parseCardResult(firstSet[i]);
          let dResult = isDrawing ? dealerSecond : dealerFirst;
          
          let outcome = compareHands(pResult, dResult);
          let winMult = pResult.multiplier;
          let loseMult = dResult.multiplier;
          
          if (loseMult === 5) loseMult = 3; // ล็อกกฎเสียสูงสุดไม่เกิน 3 เท่า

          if (outcome === 'WIN') {
            let winAmt = betAmount * winMult;
            totalChange += winAmt;
            detailLines.push(`ขา ${legNum} (แทง ${betAmount}) ชนะ x${winMult} (+${winAmt})`);
          } else if (outcome === 'LOSE') {
            let loseAmt = betAmount * loseMult;
            totalChange -= loseAmt;
            detailLines.push(`ขา ${legNum} (แทง ${betAmount}) แพ้ x${loseAmt} (-${loseAmt})`);
          } else {
            detailLines.push(`ขา ${legNum} (แทง ${betAmount}) เจ๊า (0)`);
          }
        }
      }
      
      // อัปเดตเงินคืนพูลเครดิตจริง: เงินปัจจุบัน + คืนค่าประกันทั้งหมด + ผลได้เสียรอบนี้
      pUser.credit += (totalInsuranceRefund + totalChange);
      
      billSummaryText += `👤 [รหัสสมาชิก ${pUser.memberId || '?'}] คุณ ${pUser.realName}:\n`;
      billSummaryText += detailLines.map(l => `  • ${l}`).join('\n') + '\n';
      billSummaryText += `💰 สรุปรอบนี้: ${totalChange >= 0 ? '+' : ''}${totalChange} บาท | เครดิตสุทธิ: ${pUser.credit} บาท\n`;
      billSummaryText += `-------------------------\n`;
    }

    if (!hasBets) {
      billSummaryText += `❌ ไม่มีข้อมูลการเดิมพันของสมาชิกในรอบนี้ค่ะ`;
    }

    gameState = 'CLOSED';
    currentBets = {};
    drawStatus = {};
    tempResults = null;
    return client.replyMessage(event.replyToken, { type: 'text', text: billSummaryText });
  }

  if (text.toLowerCase() === 'no' && gameState === 'CONFIRMING') {
    gameState = 'WAITING_RESULT';
    tempResults = null;
    return client.replyMessage(event.replyToken, { type: 'text', text: `❌ ยกเลิกผลไพ่เรียบร้อยแล้ว แอดมินสามารถส่งผลไพ่ 2 บรรทัดใหม่อีกครั้งได้เลยครับ` });
  }

  // ==========================================
  // 👥 คำสั่งของฝั่งผู้เล่น (ระบบวิเคราะห์โพย)
  // ==========================================
  let isBettingMessage = false;
  let parsedLegs = [];
  let parsedPrice = 0;
  let betTypeLabel = "";

  if (gameState === 'BETTING') {
    const เหมาRegex = /^(มข|มจ|เหมาขา|เหมาเจ้า)\s*[- ]?\s*(\d+)$/i;
    const ระบุขาRegex = /^(แทง|จ)?\s*([1-6]+)\s*[- ]\s*(\d+)$/;

    if (เหมาRegex.test(cleanText)) {
      const match = cleanText.match(เหมาRegex);
      const type = match[1];
      parsedPrice = parseInt(match[2]);
      parsedLegs = ['1', '2', '3', '4', '5', '6'];
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

  // ป้องกันการแทงผิดเวลา
  const แทงRegexตรวจสอบ = /^(มข|มจ|เหมาขา|เหมาเจ้า|แทง|จ)?\s*([1-6]*)\s*[- ]?\s*(\d+)$/;
  if (gameState !== 'BETTING' && แทงRegexตรวจสอบ.test(cleanText) && (cleanText.includes('-') || cleanText.includes('มข') || cleanText.includes('มจ') || text.match(/[1-6]+-\d+/))) {
    return client.replyMessage(event.replyToken, { type: 'text', text: `⚠️ [ระบบปิดรับโพย] ขณะนี้ไม่ได้อยู่ในเวลาเปิดรับเดิมพัน หรือรอบการแทงยังไม่เริ่มขึ้นค่ะ` });
  }

  if (isBettingMessage && gameState === 'BETTING') {
    if (user.pendingWithdraw > 0) return client.replyMessage(event.replyToken, { type: 'text', text: `⚠️ บัญชีของคุณถูกล็อกการเดิมพันชั่วคราว เนื่องจากอยู่ในระหว่างรอการอนุมัติถอนเงินยอด ${user.pendingWithdraw} บาทครับ` });

    const requiredDeposit = parsedPrice * 3 * parsedLegs.length; 
    if (user.credit < requiredDeposit) {
      return client.replyMessage(event.replyToken, { type: 'text', text: `❌ เครดิตไม่พอ! รายการ [${betTypeLabel} ขาละ ${parsedPrice}] ต้องใช้ยอดค้ำประกันเด้งรวม ${requiredDeposit} บาท แต่ปัจจุบันคุณมีแค่ ${user.credit} บาท` });
    }

    // หักเงินค้ำประกัน 3 เท่าทันที
    user.credit -= requiredDeposit;

    if (!currentBets[userId]) currentBets[userId] = {};
    parsedLegs.forEach(leg => {
      currentBets[userId][`leg${leg}`] = parsedPrice;
      if (!drawStatus[userId]) drawStatus[userId] = {};
      drawStatus[userId][`leg${leg}`] = '-';
    });

    let betSuccessMsg = `📥 [คนที่ ${user.memberId || 'ใหม่'}] บันทึกโพยสำเร็จ!\n📝 รายการ: ${betTypeLabel} ขาละ ${parsedPrice} บาท\n🔒 ล็อกยอดค้ำประกัน (3 เท่า): -${requiredDeposit} บาท\n💰 เครดิตใช้งานได้จริงคงเหลือ: ${user.credit} บาท`;
    return client.replyMessage(event.replyToken, { type: 'text', text: betSuccessMsg });
  }

  // คำสั่ง C
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

    let replyMsg = `👤 [ ข้อมูลสมาชิกห้องป๊อกเด้ง ]\n🆔 สมาชิกคนที่: ${user.memberId || 'ยังไม่ระบุรหัส'}\n• ชื่อระบบ: ${user.realName}\n-------------------------\n💰 เครดิตคงเหลือถอนได้: ${user.credit} บาท\n📝 โพยเดิมพันปัจจุบัน:\n${activeBetsText}\n`;
    if (currentBets[userId]) replyMsg += `-------------------------\n🔒 ยอดที่ระบบหักค้ำเด้งไว้ชั่วคราว: ${totalBetWithIns} บาท\n`;
    return client.replyMessage(event.replyToken, { type: 'text', text: replyMsg });
  }

  // คำสั่งจั่วไพ่
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
      if (updatedLegs.length > 0) return client.replyMessage(event.replyToken, { type: 'text', text: `🃏 คุณ ${user.realName} สั่ง ขา ${updatedLegs.join(',')} ให้ [${action === '+' ? 'จั่วไพ่เพิ่ม ➕' : 'อยู่ไม่จั่ว ➖'}] เรียบร้อยครับ` });
    }
  }

  // คำสั่งคืนโพย
  if (text.toLowerCase() === 'r') {
    if (gameState !== 'BETTING') return null;
    if (currentBets[userId]) {
      let totalLocked = 0;
      for (let leg in currentBets[userId]) { totalLocked += (currentBets[userId][leg] * 3); }
      user.credit += totalLocked;
      delete currentBets[userId];
      if (drawStatus[userId]) delete drawStatus[userId];
      return client.replyMessage(event.replyToken, { type: 'text', text: `↩️ คืนโพยเรียบร้อย! คืนค่าประกันให้คุณ ${user.realName} +${totalLocked} บาทสำเร็จ` });
    }
  }

  if (text === '/บช') return client.replyMessage(event.replyToken, { type: 'text', text: bankAccountInfo });

  // ระบบถอนเงิน
  if (text.startsWith('ถอน ')) {
    const amount = parseInt(text.replace('ถอน ', ''));
    if (!isNaN(amount) && amount > 0) {
      if (user.pendingWithdraw > 0) return client.replyMessage(event.replyToken, { type: 'text', text: `⚠️ คุณมีรายการถอนเดิมค้างอยู่ ${user.pendingWithdraw} บาท รอดำเนินการอยู่ค่ะ` });
      if (user.credit >= amount) {
        user.credit -= amount; user.pendingWithdraw = amount; 
        withdrawQueue.push({ memberId: user.memberId || 0, amount: amount, userId: userId });
        
        let withdrawReply = `🔔 แจ้งถอนเงินสำเร็จ!\n👤 คุณ ${user.realName}\n💵 ยอดเงิน: ${amount} บาท\n🔢 คิวลำดับที่: [ ${withdrawQueue.length} ]\n-------------------------\n🔗 ลิงก์แอดไลน์: ${adminLineLink}\n🆔 ID LINE: ${adminLineID}`;
        return client.replyMessage(event.replyToken, { type: 'text', text: withdrawReply });
      } else {
        return client.replyMessage(event.replyToken, { type: 'text', text: `❌ เครดิตไม่พอถอน (ปัจจุบันมี ${user.credit} บาท)` });
      }
    }
  }

  if (text === 'กติกา') {
    return client.replyMessage(event.replyToken, { type: 'text', text: `📜 [กติกาป๊อกเด้ง 3 ใบ]\n1. ลำดับไพ่: ป๊อก 9 > ป๊อก 8 > ไพ่ตอง (5 เด้ง) > สเตรฟลัช (5 เด้ง) > สเตร (3 เด้ง) > เซียน (3 เด้ง) > ไพ่แต้ม\n2. ไพ่แต้มรวม 3 ใบ จะเล็กกว่าไพ่ป๊อกเสมอ\n3. เด้งสัญลักษณ์พิเศษ: * = 2 เด้ง, ** = 3 เด้ง, *** = 5 เด้ง\n4. ประกันเด้ง: กรณีเสีย หักสูงสุดแค่ 3 เด้ง แต่กรณีชนะตอง/สเตรฟลัช ได้รับเต็ม 5 เด้ง!` });
  }

  if (text === 'คำสั่ง') {
    return client.replyMessage(event.replyToken, { type: 'text', text: `🤖 [คู่มือคำสั่งผู้เล่น]\n• C/[ชื่อ-นามสกุล] : ลงทะเบียนสมาชิก\n• โพยปกติ : 123-50 หรือ แทง 123-50\n• มข [ราคา] / มจ [ราคา] : เหมาขาผู้เล่น / เหมาเจ้า\n• C หรือ c : เช็คเครดิตตัวเอง\n• R หรือ r : คืนโพยทั้งหมดในรอบ\n• ขาเลข+ / ขาเลข- : สั่งจั่ว/อยู่ไพ่ เช่น 12+ / 3-\n• ถอน [ยอดเงิน] : ทำรายการแจ้งถอนเงิน` });
  }
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
