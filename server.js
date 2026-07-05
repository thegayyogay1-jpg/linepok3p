const express = require('express');
const line = require('@line/bot-sdk');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const app = express();
const client = new line.Client(config);

// 🗄️ Database ในหน่วยความจำ (Memory Storage)
let gameState = 'CLOSED'; // CLOSED, BETTING, DRAWING, WAITING_RESULT, CONFIRMING
let players = {};      // { userId: { name, credit, pendingWithdraw } }
let currentBets = {};  // { userId: { leg1: 50, leg2: 50 } }
let drawStatus = {};   // { userId: { leg1: '-', leg2: '+' } }
let tempResults = null; // เก็บผลชั่วคราวรอแอดมินกด OK

// บัญชีธนาคารสำหรับฝากเงิน
let bankAccountInfo = "🏦 ธนาคาร: กสิกรไทย\nเลขบัญชี: xxx-x-xxxxx-x\nชื่อบัญชี: บอทป๊อกเด้งอัจฉริยะ";

app.post('/callback', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.json({ status: 'ok' }))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// ตรวจจับสมาชิกใหม่เข้ากลุ่ม
app.on('memberJoined', async (event) => {
  for (const member of event.joined.members) {
    try {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: `🎉 ยินดีต้อนรับคุณสมาชิกใหม่เข้าสู่ห้องป๊อกเด้ง 3 ใบสุดเร้าใจครับ!\n📌 กรุณาพิมพ์ "C" เพื่อตรวจสอบยอดเครดิตและสร้างบัญชีผู้เล่นครับ`
      });
    } catch (err) { console.error(err); }
  }
});

// ฟังก์ชันแปลงข้อความผลไพ่แอดมินเป็นอ็อบเจกต์คะแนนและตัวคูณ (เวอร์ชันตัด ++ ออก)
function parseCardResult(resultStr) {
  if (!resultStr) return { type: 'POINT', score: 0, multiplier: 1, raw: '' };
  
  let cleaned = resultStr.trim().toLowerCase();
  let multiplier = 1;
  
  // ⭐️ คิดเด้งจากสัญลักษณ์ดาว * ที่แอดมินพิมพ์มาโดยตรง
  if (cleaned.includes('***')) { multiplier = 5; cleaned = cleaned.replace('***', ''); }
  else if (cleaned.includes('**')) { multiplier = 3; cleaned = cleaned.replace('**', ''); }
  else if (cleaned.includes('*')) { multiplier = 2; cleaned = cleaned.replace('*', ''); }

  // เช็คประเภทไพ่พิเศษตามคำนำหน้า
  if (cleaned.startsWith('ป๊อก')) {
    let score = parseInt(cleaned.replace('ป๊อก', ''));
    return { type: 'POK', score: score, multiplier: multiplier, raw: resultStr };
  }
  if (cleaned === 'ตอง') return { type: 'TONG', score: 10, multiplier: multiplier, raw: resultStr };
  if (cleaned === 'สเตรฟรัช') return { type: 'STRAIGHT_FLUSH', score: 9, multiplier: multiplier, raw: resultStr };
  if (cleaned === 'สเตร') return { type: 'STRAIGHT', score: 8, multiplier: multiplier, raw: resultStr };
  if (cleaned === 'เซียน') return { type: 'ZEAN', score: 7, multiplier: multiplier, raw: resultStr };
  
  // กรณีระบุเป็นแต้มตัวเลขธรรมดา
  let score = parseInt(cleaned) || 0;
  return { type: 'POINT', score: score % 10, multiplier: multiplier, raw: resultStr };
}

// ฟังก์ชันเปรียบเทียบผลแพ้ชนะ (ผู้เล่น VS เจ้ามือ)ตามกติกา
function compareHands(player, dealer) {
  const typeOrder = { 'POK': 7, 'TONG': 6, 'STRAIGHT_FLUSH': 5, 'STRAIGHT': 4, 'ZEAN': 3, 'POINT': 2 };
  
  if (typeOrder[player.type] > typeOrder[dealer.type]) return 'WIN';
  if (typeOrder[player.type] < typeOrder[dealer.type]) return 'LOSE';
  
  // ถ้าอยู่ในกลุ่มไพ่ประเภทเดียวกัน
  if (player.type === 'POK' || player.type === 'POINT') {
    if (player.score > dealer.score) return 'WIN';
    if (player.score < dealer.score) return 'LOSE';
    return 'DRAW'; // แต้มเท่ากันในกลุ่มเดียวกัน เจ๊า
  }
  
  return 'DRAW'; // ตองชนตอง, เซียนชนเซียน, สเตรชนสเตร -> เจ๊าหมด ไม่ดูดอกหรือตัวใหญ่กว่า
}

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return null;

  const text = event.message.text.trim();
  const userId = event.source.userId;
  
  // ตรวจสอบ/สร้างข้อมูลผู้เล่นในหน่วยความจำ
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
  // 👑 คำสั่งการจัดการเครดิตของแอดมิน
  // ==========================================
  
  // เติมเงิน: เติม เลขสมาชิก ยอด
  if (text.startsWith('เติม ')) {
    const parts = text.split(' ');
    if (parts.length === 3) {
      const targetId = parts[1];
      const amount = parseInt(parts[2]);
      if (players[targetId] && !isNaN(amount)) {
        players[targetId].credit += amount;
        return client.replyMessage(event.replyToken, { type: 'text', text: `💰 เติมเครดิตให้คุณ ${players[targetId].name} จำนวน +${amount} สำเร็จ! ยอดคงเหลือสุทธิ: ${players[targetId].credit}` });
      }
    }
  }

  // ลบยอดเงิน (กรณีเติมผิด): ลบ เลขสมาชิก ยอด
  if (text.startsWith('ลบ ')) {
    const parts = text.split(' ');
    if (parts.length === 3) {
      const targetId = parts[1];
      const amount = parseInt(parts[2]);
      if (players[targetId] && !isNaN(amount)) {
        players[targetId].credit = Math.max(0, players[targetId].credit - amount);
        return client.replyMessage(event.replyToken, { type: 'text', text: `🚨 แอดมินทำการลบยอดเครดิตของคุณ ${players[targetId].name} ออก -${amount} เรียบร้อย! ยอดคงเหลือปัจจุบัน: ${players[targetId].credit}` });
      }
    }
  }

  // ยืนยันการถอนเงิน: y เลขสมาชิก
  if (text.startsWith('y ') || text.startsWith('Y ')) {
    const targetId = text.substring(2).trim();
    if (players[targetId] && players[targetId].pendingWithdraw > 0) {
      const withdrawAmount = players[targetId].pendingWithdraw;
      players[targetId].pendingWithdraw = 0; // ปลดล็อคสถานะถอนเงิน
      return client.replyMessage(event.replyToken, { type: 'text', text: `✅ อนุมัติการถอนเงินของคุณ ${players[targetId].name} จำนวน ${withdrawAmount} บาท เรียบร้อย!` });
    }
  }

  // ล้างระบบ
  if (text === 'ล้างระบบ') {
    currentBets = {};
    drawStatus = {};
    gameState = 'CLOSED';
    tempResults = null;
    return client.replyMessage(event.replyToken, { type: 'text', text: `🧹 ล้างระบบการเดิมพันและรีเซ็ตห้องให้เป็นสถานะปิดรอบเรียบร้อยแล้ว!` });
  }

  // ==========================================
  // 🎮 คำสั่งโฟลว์เกมหลัก (Game Lifecycle)
  // ==========================================
  
  // o หรือ O -> เปิดรอบเดิมพัน
  if (text.toLowerCase() === 'o') {
    gameState = 'BETTING';
    currentBets = {};
    drawStatus = {};
    tempResults = null;
    return client.replyMessage(event.replyToken, { type: 'text', text: `🟢 [เปิดรับโพย] ป๊อกเด้ง 3 ใบเริ่มขึ้นแล้ว! กรุณาส่งโพยเดิมพันของท่านเข้ามาได้เลยครับ` });
  }

  // x หรือ X -> ปิดรับโพยเดิมพัน
  if (text.toLowerCase() === 'x') {
    if (gameState !== 'BETTING') return null;
    gameState = 'WAITING_DRAW';
    return client.replyMessage(event.replyToken, { type: 'text', text: `🛑 [ปิดรับโพยแทง] ปิดรับโพยประจำรอบแล้ว! ห้ามแก้ไขหรือส่งโพยเพิ่มหลังจากนี้ครับ` });
  }

  // oo หรือ OO -> เปิดรอบเลือกจั่วไพ่ใบที่ 3
  if (text.toLowerCase() === 'oo') {
    if (gameState !== 'WAITING_DRAW') return null;
    gameState = 'DRAWING';
    return client.replyMessage(event.replyToken, { type: 'text', text: `🃏 [เปิดรอบจั่ว] แอดมินถ่ายรูปไพ่ 2 ใบเรียบร้อยแล้ว! สมาชิกต้องการจั่วเพิ่ม พิมพ์เลขขาตามด้วย + (เช่น 12+) ถ้าขาไหนต้องการอยู่ให้เงียบไว้หรือพิมพ์ - ได้เลยครับ` });
  }

  // xx หรือ XX -> ปิดรับสิทธิ์เลือกจั่วไพ่
  if (text.toLowerCase() === 'xx') {
    if (gameState !== 'DRAWING') return null;
    gameState = 'WAITING_RESULT';
    return client.replyMessage(event.replyToken, { type: 'text', text: `🔒 [ปิดรอบจั่ว] หมดเวลาการเลือกจั่วเพิ่มแล้วครับ! ระบบกำลังล็อกคำสั่งและสแตนด์บายรอผลสรุปไพ่จากแอดมิน` });
  }

  // แอดมินส่งผลไพ่ 2 บรรทัดพร้อมกัน: /ผลชุดแรก//ผลชุดสอง
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

  // แอดมินกดยืนยันผล "OK" -> ประมวลผลลัพธ์และตัดเครดิตทันที
  if (text.toUpperCase() === 'OK' && gameState === 'CONFIRMING' && tempResults) {
    let summaryText = `📋 [สรุปผลการคิดบิลป๊อกเด้ง 3 ใบ]\n`;
    const firstSet = tempResults.first;
    const secondSet = tempResults.second;
    
    const dealerFirst = parseCardResult(firstSet[firstSet.length - 1]);
    const dealerSecond = parseCardResult(secondSet[secondSet.length - 1]);
    
    // วนลูปคิดเงินผู้เล่นรายบุคคล
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
          let isDrawing = pDraw[`leg${legNum}`] === '+'; // ดูว่ารายคนนั้นๆ สั่งจั่วหรือไม่ (+ คือจั่ว, นอกนั้นคืออยู่)
          
          let pResult = isDrawing ? parseCardResult(secondSet[i]) : parseCardResult(firstSet[i]);
          let dResult = isDrawing ? dealerSecond : dealerFirst;
          
          // ตรวจสอบเงื่อนไขพิเศษ: แทงขาเจ้ามือ (สมมติให้ขา 6 หรือเงื่อนไขของแอดมินเป็นขาเจ้า)
          // ในที่นี้จะคำนวณตามจริงจากผลที่แอดมินคีย์มาชนกันสู้กับเจ้ามือตามปกติ
          let outcome = compareHands(pResult, dResult);
          let winMult = pResult.multiplier;
          let loseMult = dResult.multiplier;
          
          // กฎข้อ 4: เจ้ามือได้ 5 เด้ง หักประกันคนแทงเสียสูงสุดแค่ 3 เด้ง
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

    // รีเซ็ตสถานะเกมกลับสู่จุดเริ่มต้นหลังจบรอบ
    gameState = 'CLOSED';
    currentBets = {};
    drawStatus = {};
    tempResults = null;

    return client.replyMessage(event.replyToken, { type: 'text', text: summaryText });
  }

  // แอดมินปฏิเสธผล "no"
  if (text.toLowerCase() === 'no' && gameState === 'CONFIRMING') {
    gameState = 'WAITING_RESULT';
    tempResults = null;
    return client.replyMessage(event.replyToken, { type: 'text', text: `❌ ยกเลิกผลไพ่เรียบร้อยแล้ว แอดมินสามารถส่งผลไพ่ 2 บรรทัดใหม่อีกครั้งได้เลยครับ` });
  }

  // ==========================================
  // 👥 คำสั่งของฝั่งผู้เล่น (Player Section)
  // ==========================================
  
  // 1. รับโพยเดิมพันระบบ 3 ใบ (ช่วงสถานะ BETTING เท่านั้น)
  const betRegex = /^([1-6\s]+)-(\d+)$/;
  if (betRegex.test(text)) {
    if (gameState !== 'BETTING') return null;
    
    const match = text.match(betRegex);
    const legs = match[1].replace(/\s+/g, '').split(''); // ลบช่องว่างออกและแยกขา
    const baseBet = parseInt(match[2]);
    
    // คำนวณยอดค้ำประกันสูงสุด (คิดที่ 3 เด้งตามกฎประกันเด้งข้อ 4)
    const requiredDeposit = baseBet * 3 * legs.length;
    
    // ข้อ 10: เช็คยอดเงินจริง ถ้าไม่พอบอทจะไม่จดจำโพยและไม่บันทึกอะไรลงในระบบเลยเด็ดขาด
    if (user.credit < requiredDeposit) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `❌ เครดิตไม่พอ! ยอดแทงรวมค้ำประกันเด้งที่ต้องใช้คือ ${requiredDeposit} บาท แต่ยอดปัจจุบันของคุณคือ ${user.credit} บาท (โพยนี้จะไม่ถูกบันทึก)`
      });
    }

    // บันทึกโพยลงระบบหลังผ่านการเช็คยอดเงินเรียบร้อย
    if (!currentBets[userId]) currentBets[userId] = {};
    legs.forEach(leg => {
      currentBets[userId][`leg${leg}`] = baseBet;
      // ตั้งค่าตั้งต้นรอบจั่วให้เป็นอยู่ไม่จั่ว (-) ไว้ก่อนตามข้อ 11
      if (!drawStatus[userId]) drawStatus[userId] = {};
      drawStatus[userId][`leg${leg}`] = '-';
    });

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `📥 บันทึกโพยสำเร็จ: ขา ${legs.join(',')} ขาละ ${baseBet}\nค้ำประกันเด้งเรียบร้อย ยอดเครดิตคงเหลือชั่วคราว: ${user.credit}`
    });
  }

  // 2. ตรวจสอบสถานะและยอดเงิน (พิมพ์ C หรือ c) - เวอร์ชัน Flex Message ดึงรูปโปรไฟล์
  if (text.toLowerCase() === 'c') {
    // ดึงข้อมูลรูปโปรไฟล์และชื่อสดจาก LINE API
    let profileUrl = "https://scdn.line-apps.com/n/channel_devcenter/img/fx/01_1_cafe.png"; // รูปสำรองกรณีดึงไม่ผ่าน
    try {
      let profile = await client.getProfile(userId);
      if (profile.pictureUrl) {
        profileUrl = profile.pictureUrl;
      }
    } catch (e) {
      console.log("ไม่สามารถดึงรูปโปรไฟล์ได้ ใช้รูปสำรองแทน");
    }

    // เตรียมข้อความโพย
    let activeBetsText = "ไม่มีโพยค้างอยู่";
    let totalBetWithIns = 0;
    
    if (currentBets[userId]) {
      let activeBets = [];
      for (let key in currentBets[userId]) {
        let amt = currentBets[userId][key];
        activeBets.push(`${key.replace('leg', 'ขา ')}: ${amt} บ.`);
        totalBetWithIns += (amt * 3); // ยอดรวมค้ำประกันเด้ง 3 เท่า
      }
      activeBetsText = activeBets.join('\n');
    }

    // สร้างโครงสร้าง Flex Message
    const flexPayload = {
      type: "flex",
      altText: `👤 เช็คยอดเครดิตของคุณ ${user.name}`,
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          spacing: "md",
          contents: [
            // 🖼️ 1. รูปโปรไฟล์สมาชิกกลมๆ อยู่บนสุด
            {
              type: "avatar",
              url: profileUrl,
              size: "xl",
              align: "center"
            },
            // 👤 2. ชื่อสมาชิก
            {
              type: "text",
              text: `👤 สมาชิก: ${user.name}`,
              weight: "bold",
              size: "md",
              align: "center",
              margin: "sm"
            },
            // ➖ เส้นคั่นกลาง
            {
              type: "separator",
              margin: "md"
            },
            // 💰 3. รายละเอียดเครดิตและโพย
            {
              type: "box",
              layout: "vertical",
              margin: "md",
              spacing: "sm",
              contents: [
                {
                  type: "text",
                  text: `💰 ยอดเครดิตคงเหลือ: ${user.credit} บาท`,
                  weight: "bold",
                  size: "sm",
                  color: "#1DB446"
                },
                {
                  type: "text",
                  text: `📝 โพยเดิมพันในรอบนี้:`,
                  size: "sm",
                  color: "#555555",
                  weight: "bold",
                  margin: "md"
                },
                {
                  type: "text",
                  text: activeBetsText,
                  size: "sm",
                  color: "#666666",
                  wrap: true
                }
              ]
            }
          ]
        }
      }
    };

    // หากมีโพยเดิมพันค้างอยู่ ให้แสดงบรรทัดยอดแทงรวมค้ำประกันเพิ่มเข้าไปด้วย
    if (currentBets[userId]) {
      flexPayload.contents.body.contents[3].contents.push({
        type: "text",
        text: `💵 ยอดแทงรวมค้ำเด้ง: ${totalBetWithIns} บาท`,
        size: "xs",
        color: "#aaaaaa",
        margin: "sm"
      });
    }

    return client.replyMessage(event.replyToken, flexPayload);
  }

  // 3. ขอคืนโพย (พิมพ์ r หรือ R)
  if (text.toLowerCase() === 'r') {
    if (gameState !== 'BETTING') return null;
    if (currentBets[userId]) {
      delete currentBets[userId];
      if (drawStatus[userId]) delete drawStatus[userId];
      return client.replyMessage(event.replyToken, { type: 'text', text: `↩️ คืนโพยเดิมพันทั้งหมดในรอบนี้ของคุณ ${user.name} เรียบร้อยแล้วครับ` });
    }
  }

  // 4. ดูเลขบัญชีโอนเงิน (/บช)
  if (text === '/บช') {
    return client.replyMessage(event.replyToken, { type: 'text', text: bankAccountInfo });
  }

  // 5. แจ้งถอนเงิน: ถอน จำนวนเงิน
  if (text.startsWith('ถอน ')) {
    const amount = parseInt(text.replace('ถอน ', ''));
    if (!isNaN(amount) && amount > 0) {
      if (user.pendingWithdraw > 0) {
        return client.replyMessage(event.replyToken, { type: 'text', text: `⚠️ คุณมีรายการถอนเดิมค้างอยู่ ${user.pendingWithdraw} บาท รอดำเนินการ ห้ามทำรายการซ้ำ` });
      }
      if (user.credit >= amount) {
        user.credit -= amount;
        user.pendingWithdraw = amount; // ล็อคยอดการถอนเงิน
        return client.replyMessage(event.replyToken, { type: 'text', text: `🔔 แจ้งถอนเงินสำเร็จ!\nคุณ ${user.name} แจ้งถอนยอด ${amount} บาท\n[ระบบล็อคการเดิมพันและถอนซ้ำชั่วคราว] รอแอดมินกดยืนยัน` });
      } else {
        return client.replyMessage(event.replyToken, { type: 'text', text: `❌ ยอดเครดิตของท่านไม่พอสำหรับการถอนเงินจำนวนนี้` });
      }
    }
  }

  // 6. เมนูกติกาและคำสั่ง
  if (text === 'กติกา') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `📜 [กติกาป๊อกเด้ง 3 ใบสไตล์รีแร็กซ์]\n1. ลำดับไพ่: ป๊อก 9 > ป๊อก 8 > ไพ่ตอง (5 เด้ง) > สเตรฟลัช (5 เด้ง) > สเตร (3 เด้ง) > เซียน (3 เด้ง) > ไพ่แต้ม\n2. ไพ่แต้มรวม 3 ใบ จะเล็กกว่าไพ่ป๊อกเสมอ\n3. เด้งสัญลักษณ์พิเศษ: * = 2 เด้ง, ** = 3 เด้ง, *** = 5 เด้ง\n4. ประกันเด้ง: กรณีเสีย หักสูงสุดแค่ 3 เด้ง แต่กรณีชนะตอง/สเตรฟลัช ได้รับเต็ม 5 เด้ง!`
    });
  }

  if (text === 'คำสั่ง') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `🤖 [คู่มือคำสั่งผู้เล่นกลุ่มป๊อกเด้ง]\n• [เลขขา]-[ราคา] : ส่งโพย เช่น 123-100\n• C หรือ c : เช็คเครดิตและรายการโพย\n• R หรือ r : ขอคืนโพยทั้งหมดในรอบนั้น\n• ขาเลข+ : ขอจั่วไพ่ใบที่ 3 เช่น 12+\n• ขาเลข- : ขออยู่ไม่จั่วไพ่เพิ่ม เช่น 3-\n• /บช : ขอดูบัญชีโอนเงินเข้า\n• ถอน [ยอดเงิน] : ทำรายการแจ้งถอนเงิน`
    });
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
