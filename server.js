const express = require('express');
const axios = require('axios');
const fs = require('fs'); // 📁 เติมตรงนี้เพื่อให้ระบบรู้จักการเขียนไฟล์ลงเครื่องครับน้า
const admin = require('firebase-admin'); // 👈 เพิ่มการดึง Library Firebase Admin
const app = express();
app.use(express.json());
global.currentReplyFlex = null; // 👈 แทรกบรรทัดนี้ลงไปตรงนี้ครับ

// 💡 ไม่ต้องใส่ Token ในนี้แล้ว ระบบจะดึงจากตัวแปรบน Render อัตโนมัติ
const TOKEN = process.env.CHANNEL_ACCESS_TOKEN;

// 👥 [กล่องรวม ID แอดมินกลาง] มีแอดมินเพิ่มมาใส่เพิ่มตรงนี้ที่เดียวจบเลยครับน้า!
const ADMIN_IDS = [
    "U2fb9233e5c539ae3970cbd698e2e18db", // แอดมินคนที่ 1
    "Uf48148ba5a3bfd14d4e81213daf56ef4" // แอดมินคนที่ 2
];

// 📡 ลิงก์เชื่อมโยงไปยังฐานข้อมูล Firebase ถาวร 
const FIREBASE_URL = "https://my-pokdeng-bot-default-rtdb.asia-southeast1.firebasedatabase.app/"; 

// 🔥 [แก้ไขจุดนี้] ตั้งค่าเชื่อมต่อ Firebase Admin สำหรับ API ของหน้าเว็บ LIFF
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
        }),
        databaseURL: FIREBASE_URL
    });
}

// 📌 [สำคัญที่สุด] ประกาศตัวแปร db ให้ระบบรู้จัก (แก้ปัญหา Server Error: db is not defined)
const db = admin.database();

let usersWallets = {};
let nextMemberId = 1;
let maxLegs = 6; // ค่าเริ่มต้นคือ 6 ขาผู้เล่น
let cardMode = 3;  // จำนวนใบไพ่ (ค่าเริ่มต้น 3 ใบ)
let isRoundOpen = false; // ตัวแปรจำสถานะ เปิด/ปิด รอบ
let roundBets = {};      // ตัวแปรสำหรับจำโพยแทงในแต่ละรอบ
let hiloUserTrackers = {}; // ตัวแปรเก็บประวัติการแทงสวน/กั๊กไฮโลของผู้เล่นแต่ละคนในรอบนั้นๆ
let isHiloRoundOpen = false; // 🎲 ตัวแปรจำสถานะ เปิด/ปิด รับแทงไฮโล
let hiloRoundBets = {};      // 🎲 ตัวแปรเก็บโพยแทงไฮโลประจำรอบ
let tempHiloDices = [];
let promotions = {};
let currentRound = 0;    // บรรทัดนี้เพื่อจำลำดับรอบปัจจุบัน
let isDrawOpen = false;  // บรรทัดนี้เพื่อเช็กสถานะรอบจั่วไพ่
let tempRoomResults = null; // ใช้พักข้อมูลผลแต้มชั่วคราวที่แอดมินพึ่งพิมพ์ส่งมา
let tempDealerResult = null; // ใช้พักข้อมูลผลแต้มของเจ้ามือชั่วคราว
let matchHistory = []; // เก็บประวัติสถิติย้อนหลังสูงสุด 5 รอบ
let detailedRoundHistory = {}; // ตัวแปรเก็บข้อมูลสำหรับแอดมินดึงย้อนหลัง
let pastRoundsData = {}; //  ถังเก็บประวัติโพยและผลไพ่แยกรายรอบ (สำหรับดึง v,m)
let withdrawQueue = []; // 📦 ถังสำหรับเก็บคิวสมาชิกที่แจ้งถอนเงิน
let usersRoundCrossCheck = {}; // 🌟 เพิ่มบรรทัดนี้ไว้บนสุดของไฟล์
global.depositQueue = {}; // 👈 เพิ่มบรรทัดนี้เพื่อเตรียมถังคิวฝากเงินออโต้ไม่ให้เป็นค่าว่างครับน้า!
if (!global.satangCounter) global.satangCounter = 0;

// 🔄 ฟังก์ชันดึงยอดเงินล่าสุดจาก Firebase แบบตรงเป้า 100%
async function getLatestWallet(userId) {
    try {
        const res = await axios.get(`${FIREBASE_URL}system_data/usersWallets/${userId}.json`);
        if (res.data) {
            usersWallets[userId] = res.data;
            return res.data;
        }
    } catch (e) {
        console.error("❌ Sync error:", e.message);
    }
    return usersWallets[userId];
}
// ⚡ ฟังก์ชันอัปเดตยอดเงินรายคนลง Firebase ทันที (วางไว้ตรงนี้ครับ)
async function updateSingleUserWallet(userId, updatedData) {
    usersWallets[userId] = updatedData; // อัปเดตใน RAM
    try {
        await axios.patch(`${FIREBASE_URL}system_data/usersWallets/${userId}.json`, updatedData);
        console.log(`⚡ [Direct Sync] อัปเดตยอดเงินของ ${userId} เรียบร้อย!`);
    } catch (e) {
        console.error("❌ Update error:", e.message);
    }
}

// 🔄 ฟังก์ชันอัตโนมัติ: ดึงข้อมูลจาก Firebase มาอัปเดตลงในบอททันทีที่เปิดเครื่อง (แก้ไขดึงครบทุกกล่องแล้ว)
async function loadDataFromFirebase() {
    try {
        const response = await axios.get(`${FIREBASE_URL}system_data.json`);
        if (response.data) {
            usersWallets = response.data.usersWallets || {};
            nextMemberId = response.data.nextMemberId || 1;
            maxLegs = response.data.maxLegs || 6;
            cardMode = response.data.cardMode || 3;
            isRoundOpen = response.data.isRoundOpen !== undefined ? response.data.isRoundOpen : false;
            roundBets = response.data.roundBets || {};
            currentRound = response.data.currentRound || 0;
            promotions = response.data.promotions || {};
            isDrawOpen = response.data.isDrawOpen !== undefined ? response.data.isDrawOpen : false;
            matchHistory = response.data.matchHistory || [];
            detailedRoundHistory = response.data.detailedRoundHistory || {};
            pastRoundsData = response.data.pastRoundsData || {};
            withdrawQueue = response.data.withdrawQueue || [];
            console.log("✅ ดึงข้อมูลระบบทั้งหมดจาก Firebase สำเร็จเรียบร้อย!");
            isHiloRoundOpen = response.data.isHiloRoundOpen !== undefined ? response.data.isHiloRoundOpen : false;
            hiloRoundBets = response.data.hiloRoundBets || {};
            tempHiloDices = response.data.tempHiloDices || [];
        }
    } catch (error) {
        console.error("❌ ไม่สามารถดึงข้อมูลจาก Firebase ได้:", error.message);
    }
}
loadDataFromFirebase(); // สั่งให้ทำงานทันทีที่บอทรัน

// ==========================================
// 🎲 ฟังก์ชันจัดกลุ่มและจัดฟอร์แมตการแสดงผลไฮโล
// ==========================================
function formatGroupedHiloBets(userHiloArray) {
    if (!userHiloArray || userHiloArray.length === 0) return 'ไม่ได้แทง';

    let groups = {
        ten: [],    // เต็ง
        tod: [],    // โต๊ด (2 ตัว และ 3 ตัว)
        hl: [],     // สูง/ต่ำ ธรรมดา
        evod: [],   // คู่/คี่ ธรรมดา
        pair: []    // ต่ำ/สูง/เต็ง คู่กับเลข
    };

    userHiloArray.forEach(hb => {
        let bName = hb.category || hb.type || hb.target || "ไฮโล";
        const bPrice = hb.totalPrice || hb.actualBet || hb.price || 0;

        // ทำความสะอาดชื่อรายการแทง
        let cleanName = bName.trim()
            .replace(/^เต็ง\s*/g, '')
            .replace(/^โต๊ด\s*(2\s*ตัว|3\s*ตัว)?\s*/g, '')
            .replace(/คู่กับ/g, '')
            .replace(/\s+/g, '');

        // คัดแยกเข้าหมวดหมู่ตามรูปแบบประเภทการแทง
        if (bName.includes('โต๊ด') || /^[1-6]{2,3}$/.test(cleanName) || /^\d-\d(-\d)?$/.test(cleanName)) {
            cleanName = cleanName.replace(/-/g, '');
            groups.tod.push(`${cleanName}(${bPrice})`);
        } else if (bName.includes('คู่กับ') || /^(สูง|ต่ำ|[1-6])[1-6]$/.test(cleanName)) {
            groups.pair.push(`${cleanName}(${bPrice})`);
        } else if (bName === 'สูง' || bName === 'ต่ำ') {
            groups.hl.push(`${cleanName}(${bPrice})`);
        } else if (bName === 'คู่' || bName === 'คี่') {
            groups.evod.push(`${cleanName}(${bPrice})`);
        } else {
            // เต็ง หรืออื่นๆ
            groups.ten.push(`${cleanName}(${bPrice})`);
        }
    });

    let resultSections = [];
    if (groups.ten.length > 0) resultSections.push(groups.ten.join(' I '));
    if (groups.tod.length > 0) resultSections.push(`โต๊ด ${groups.tod.join(' I ')}`);
    if (groups.hl.length > 0) resultSections.push(groups.hl.join(' I '));
    if (groups.evod.length > 0) resultSections.push(groups.evod.join(' I '));
    if (groups.pair.length > 0) resultSections.push(groups.pair.join(' I '));

    return resultSections.join('\n    ');
}

// 🎲 ฟังก์ชันเช็คว่าในรายการตัวเลขมีเลขซ้ำกันหรือไม่
function hasDuplicateNumbers(numString) {
    // ดึงเฉพาะตัวเลขออกมาเป็น Array เช่น "223" -> ['2', '2', '3']
    const nums = numString.replace(/\D/g, '').split('');
    // ถ้า Set มีขนาดน้อยกว่า Array แปลว่ามีตัวเลขซ้ำกัน
    return new Set(nums).size !== nums.length;
}

// 🤖 [ระบบฝากออโต้] ฟังก์ชันตรวจสอบยอดเงินจากเศษสตางค์
async function checkAutoDeposit() {
    if (!global.depositQueue) return;
    
    try {
        // 💡 ดึงข้อมูล Statement ล่าสุดของน้าจาก API หรือจุดเช็กยอดโอน (ตัวอย่างจำลองสถานการณ์)
        // const response = await axios.get('ลิงก์_API_เช็กยอดโอนของน้า');
        // const bankTransactions = response.data.transactions || [];
        
        const bankTransactions = global.bankTransactions || []; // 📝 เปลี่ยนเป็นข้อมูลสเตทเม้นท์จริงที่ดึงได้นะน้า

        for (let userId in global.depositQueue) {
            const queue = global.depositQueue[userId];

            if (!queue || queue.status !== 'WAITING_ADMIN') continue;

            // 🔍 ค้นหาในรายการโอนเงินว่ามียอดเงิน + เศษสตางค์ที่ตรงกับคิวไหม
            const matchIndex = bankTransactions.findIndex(tx => 
                parseFloat(tx.amount).toFixed(2) === parseFloat(queue.displayAmount).toFixed(2)
            );

            // 💰 2. ถ้ามียอดโอนตรงกับเศษสตางค์ที่กำหนดไว้
            if (matchIndex !== -1) {
                const user = usersWallets[userId];

                if (user) {
                    // 2.1 เติมเครดิตเข้ากระเป๋าผู้ใช้ทันที
                    user.balance = (user.balance || 0) + Number(queue.rawAmount);

                    // 2.2 เซฟข้อมูลถาวรลง Firebase
                    await saveDataToFirebase();

                    // 2.3 ลบลายเซ็นรายการโอนนี้ออกจาก bankTransactions (กันสแกนซ้ำ)
                    bankTransactions.splice(matchIndex, 1);

                    // 2.4 ล้างคิวฝากของยูสเซอร์รายนี้ออก
                    delete global.depositQueue[userId];

                    // 📝 แสดง Log ใน Server ให้แอดมินรู้ว่าเติมเรียบร้อยแล้ว
                    console.log(`✅ [เติมเงียบสำเร็จ] ยูสเซอร์ [${user.memberNumber || '-'}] ${user.nickname || user.name} | ยอด ${queue.displayAmount} ฿ -> เครดิตใหม่: ${user.balance} ฿`);
                }
            }
        }
    } catch (err) {
        console.error("❌ ระบบตรวจสอบฝากออโต้ผิดพลาด:", err.message);
    }
}

// ⏱️ สั่งให้ระบบลูปตรวจสอบทุกๆ 10-30 วินาทีอัตโนมัติ
setInterval(checkAutoDeposit, 15000);


// 💾 ฟังก์ชันอัตโนมัติ: สั่งบันทึกข้อมูลปัจจุบันยิงกลับไปเก็บที่ตึก Firebase
async function saveDataToFirebase() {
    try {
        await axios.put(`${FIREBASE_URL}system_data.json`, {
            usersWallets: usersWallets,
            nextMemberId: nextMemberId,
            maxLegs: maxLegs,
            cardMode: cardMode,
            isRoundOpen: isRoundOpen,         // 💾 จำสถานะ เปิด/ปิด รอบ
            roundBets: roundBets,             // 💾 จำโพยแทงในแต่ละรอบ
            hiloRoundBets: hiloRoundBets,   // 💾บันทึกโหนดไฮโลแยกต่างหาก
            tempHiloDices: tempHiloDices,
            promotions : promotions,
            currentRound: currentRound,       // 💾 จำลำดับรอบปัจจุบัน
            isDrawOpen: isDrawOpen,           // 💾 จำสถานะรอบจั่วไพ่
            matchHistory: matchHistory,       // 💾 จำประวัติสถิติย้อนหลัง 5 รอบ
            detailedRoundHistory: detailedRoundHistory, // 💾 จำข้อมูลแอดมินดึงย้อนหลัง
            pastRoundsData: pastRoundsData,   // 💾 จำประวัติโพยและผลไพ่แยกรายรอบ (v,m)
            withdrawQueue: withdrawQueue       // 💾 จำคิวสมาชิกที่แจ้งถอนเงิน
        });
        console.log("💾 บันทึกข้อมูลลง Firebase เรียบร้อย!");
    } catch (error) {
        console.error("❌ บันทึกข้อมูลลง Firebase ล้มเหลว:", error.message);
    }
}
// =================================================================
// 🃏 [แทรกตรงนี้] ฟังก์ชันกลางประมวลผลโพยป๊อกเด้ง (LINE Bot + LIFF Web)
// =================================================================
async function processPokDengBet(userId, betText) {
    if (!isRoundOpen) {
        return { success: false, message: "🚫 ตอนนี้ระบบปิดรับโพยชั่วคราวครับ" };
    }

    const user = usersWallets[userId];
    if (!user) {
        return { success: false, message: "📢 คุณยังไม่ได้ลงทะเบียนในระบบ" };
    }

    const displayName = user.nickname || user.name || "ไม่ระบุชื่อ";

    if (user.isWithdrawLocked) {
        return { 
            success: false, 
            message: `❌ คุณอยู่ในระหว่างรออนุมัติยอดถอน (${user.pendingWithdrawAmount} บาท) บัญชีถูกล็อกชั่วคราว` 
        };
    }

    // ล้างความจำขยะรอบเก่าถ้ายังไม่มีโพย
    if (!roundBets[userId] || roundBets[userId].length === 0) {
        usersRoundCrossCheck[userId] = {};
    }
    if (!usersRoundCrossCheck[userId]) {
        usersRoundCrossCheck[userId] = {};
    }
    let betTracker = usersRoundCrossCheck[userId];

    const lines = betText.split(/\r?\n/);
    let totalActualBet = 0;
    let processedBets = [];
    let hasError = false;
    let errorMsg = "";

    const allowedLegs = ['1', '2', '3', '4', '5', '6'];
    const MIN_BET = 10;
    const MAX_BET = 2500;

    for (let line of lines) {
        let cleanLine = line.trim().toLowerCase();
        if (cleanLine === "") continue;

        const parts = cleanLine.split('-');
        if (parts.length !== 2) {
            hasError = true;
            errorMsg = `⚠️ รูปแบบโพยไม่ถูกต้อง: "${line}" (ตัวอย่าง: 1-100)`;
            break;
        }

        const targetStr = parts[0].trim();
        const price = parseFloat(parts[1].trim());

        if (isNaN(price) || price <= 0) {
            hasError = true;
            errorMsg = `⚠️ จำนวนเงินไม่ถูกต้องในบรรทัด: "${line}"`;
            break;
        }

        if (price < MIN_BET || price > MAX_BET) {
            hasError = true;
            errorMsg = `❌ ยอดแทงต่อขาต้องอยู่ระหว่าง ${MIN_BET} ถึง ${MAX_BET} บาท`;
            break;
        }

        let legsCount = 0;
        let betTypeDetail = "";

        if (targetStr === "รข") {
            legsCount = maxLegs;
            betTypeDetail = `เหมาขาผู้เล่นสู้เจ้ามือ (${maxLegs} ขา) ขาละ ${price} บาท`;
            for (let c = 1; c <= maxLegs; c++) {
                if (betTracker[c] === 'dealer') {
                    hasError = true;
                    errorMsg = `❌ แทง รข ไม่ได้! ขา ${c} มีการแทงฝั่งเจ้ามือค้างไว้แล้ว`;
                    break;
                }
            }
            if (hasError) break;
            for (let c = 1; c <= maxLegs; c++) { betTracker[c] = 'player'; }

        } else if (targetStr === "รจ") {
            legsCount = maxLegs;
            betTypeDetail = `แทงเจ้ามือสู้ทุกขา (${maxLegs} ขา) ขาละ ${price} บาท`;
            for (let c = 1; c <= maxLegs; c++) {
                if (betTracker[c] === 'player') {
                    hasError = true;
                    errorMsg = `❌ แทง รจ ไม่ได้! ขา ${c} มีการแทงฝั่งผู้เล่นค้างไว้แล้ว`;
                    break;
                }
            }
            if (hasError) break;
            for (let c = 1; c <= maxLegs; c++) { betTracker[c] = 'dealer'; }

        } else if (targetStr.startsWith('จ')) {
            const legs = targetStr.substring(1);
            if (legs === "") {
                hasError = true;
                errorMsg = `⚠️ ไม่ระบุเลขขาเจ้ามือในบรรทัด: "${line}"`;
                break;
            }

            let isLegsValid = legs.split('').every(char => allowedLegs.includes(char));
            if (!isLegsValid) {
                hasError = true;
                errorMsg = `❌ บันทึกโพยล้มเหลว! ห้องนี้มีแค่ ขา 1 ถึง ขา 6 เท่านั้น`;
                break;
            }

            legsCount = legs.length;
            betTypeDetail = `เจ้ามือสู้ขา [${legs.split('').join(', ')}] ขาละ ${price} บาท`;
            const targetLegs = legs.split('');
            for (let c of targetLegs) {
                if (betTracker[c] === 'player') {
                    hasError = true;
                    errorMsg = `❌ แทงสวนไม่ได้! ขา ${c} มีการแทงฝั่งผู้เล่นไปแล้ว`;
                    break;
                }
            }
            if (hasError) break;
            for (let c of targetLegs) { betTracker[c] = 'dealer'; }

        } else {
            let isLegsValid = targetStr.split('').every(char => allowedLegs.includes(char));
            if (!isLegsValid) {
                hasError = true;
                errorMsg = `❌ บันทึกโพยล้มเหลว! ห้องนี้มีแค่ ขา 1 ถึง ขา 6 เท่านั้น`;
                break;
            }
            legsCount = targetStr.length;
            betTypeDetail = `แทงขา [${targetStr.split('').join(', ')}] ขาละ ${price} บาท`;
            const targetLegs = targetStr.split('');
            for (let c of targetLegs) {
                if (betTracker[c] === 'dealer') {
                    hasError = true;
                    errorMsg = `❌ แทงสวนไม่ได้! ขา ${c} มีการแทงฝั่งเจ้ามือไปแล้ว`;
                    break;
                }
            }
            if (hasError) break;
            for (let c of targetLegs) { betTracker[c] = 'player'; }
        }

        let currentLineBet = price * legsCount;
        totalActualBet += currentLineBet;

        processedBets.push({
            type: targetStr,
            detail: betTypeDetail,
            actualBet: currentLineBet,
            pricePerLeg: price
        });
    }

    if (hasError) {
        return { success: false, message: errorMsg };
    }

    if (totalActualBet === 0) {
        return { success: false, message: "⚠️ ไม่พบรายการแทงในข้อความของคุณ" };
    }

    // คำนวณยอดค้ำประกัน
    let finalHoldCost = 0;
    let maxHandMultiplier = 3;
    const doubleHoldCost = totalActualBet * 2;
    const tripleHoldCost = totalActualBet * 3;

    if (user.balance < doubleHoldCost) {
        return { 
            success: false, 
            message: `❌ เครดิตไม่พอค้ำประกันขั้นต่ำ (2 เด้ง)! ยอดแทงรวม ${totalActualBet} บ. ต้องใช้ค้ำประกัน ${doubleHoldCost} บ. (เครดิตมี ${user.balance} บ.)` 
        };
    } else if (user.balance >= doubleHoldCost && user.balance < tripleHoldCost) {
        maxHandMultiplier = 2;
        finalHoldCost = doubleHoldCost;
    } else {
        maxHandMultiplier = 3;
        finalHoldCost = tripleHoldCost;
    }

    // หักเงินค้ำประกันและบันทึกโพย
    user.balance -= finalHoldCost;

    if (!roundBets[userId]) {
        roundBets[userId] = [];
    }

    processedBets.forEach((bet) => {
        roundBets[userId].push({
            name: displayName,
            memberNumber: user.memberNumber,
            betType: bet.type,
            detail: bet.detail,
            pricePerLeg: bet.pricePerLeg,
            actualBet: bet.actualBet,
            holdCost: (bet.actualBet * maxHandMultiplier),
            maxMultiplier: maxHandMultiplier,
            time: new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' }),
            source: 'web'
        });
    });

    // ซิงก์ลง Firebase
    await db.ref(`system_data/roundBets/${userId}`).set(roundBets[userId]);
    await saveDataToFirebase();

    return { 
        success: true, 
        message: `บันทึกโพยสำเร็จ! หักค้ำประกัน (${maxHandMultiplier} เด้ง) เป็นเงิน ${finalHoldCost} บาท` 
    };
}
// ==================== [ CENTRAL HILO PROCESSOR ] ====================
async function processHiloBetSubmission(userId, rawMessage, source = 'web') {
    if (!isHiloRoundOpen) {
        return { success: false, message: "🎲 ตอนนี้ระบบปิดรับโพยไฮโลชั่วคราวครับ กรุณารอแอดมินเปิดรอบใหม่" };
    }

    const user = usersWallets[userId];
    if (!user) {
        return { success: false, message: "📢 คุณยังไม่ได้ลงทะเบียนสมาชิกในระบบ" };
    }

    const displayName = user.nickname || user.name || "ไม่ระบุชื่อ";

    // 🔒 ดักจับสถานะล็อกถอนเงิน
    if (user.isWithdrawLocked) {
        return { 
            success: false, 
            message: `❌ คุณไม่สามารถส่งโพยแทงได้ครับ!\n👤 คุณ ${displayName} (ID: ${user.memberNumber}) อยู่ในระหว่าง "รอแอดมินโอนเงินและอนุมัติยอดถอน" (${user.pendingWithdrawAmount} บาท)` 
        };
    }

    // 🔄 ดึงข้อมูลการแทงไฮโลในรอบปัจจุบันของผู้เล่นขึ้นมาเช็คแทงสวน/กั๊ก
    if (!hiloUserTrackers[userId]) {
        hiloUserTrackers[userId] = { side: null, singles: new Set() };
    }
    let tracker = hiloUserTrackers[userId];

    let tempSide = tracker.side;
    let tempSingles = new Set(tracker.singles);

    // 💡 คำนวณยอดแทงสะสมในรอบปัจจุบัน
    let existingCategoryTotals = {};
    let existingSingleTotals = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0 };

    if (hiloRoundBets[userId] && hiloRoundBets[userId].length > 0) {
        hiloRoundBets[userId].forEach(prevBet => {
            const bType = prevBet.betType;
            const bPrice = prevBet.pricePerLeg || prevBet.price;

            if (bType === "เต็ง") {
                const digits = (prevBet.target || "").split('');
                digits.forEach(d => {
                    if (existingSingleTotals[d] !== undefined) {
                        existingSingleTotals[d] += bPrice;
                    }
                });
            } else {
                const key = `${bType}_${prevBet.target}`;
                existingCategoryTotals[key] = (existingCategoryTotals[key] || 0) + bPrice;
            }
        });
    }

    const lines = rawMessage.split(/\r?\n/);
    let totalHiloBet = 0;
    let processedHiloBets = [];
    let hasError = false;
    let errorMsg = "";

    const MIN_BET = 10;
    const MAX_BET_MAP = {
        "ส/ต": 2500,
        "11": 1000,
        "เต็ง": 1000,
        "โต๊ด2": 1000,
        "โต๊ด3": 1000,
        "คู่ส/ต": 1000,
        "ตองรวม": 500,
        "ตองเจาะ": 100
    };

    for (let line of lines) {
        let cleanLine = line.trim().toLowerCase();
        if (cleanLine === "") continue;

        if (cleanLine.startsWith('z')) {
            cleanLine = cleanLine.substring(1).trim();
        }

        const parts = cleanLine.split('-');
        if (parts.length !== 2) {
            hasError = true;
            errorMsg = `⚠️ รูปแบบโพยไฮโลไม่ถูกต้องในบรรทัด: "${line}"`;
            break;
        }

        const targetStr = parts[0].trim();
        const price = parseFloat(parts[1].trim());

        if (isNaN(price) || price <= 0) {
            hasError = true;
            errorMsg = `⚠️ จำนวนเงินไม่ถูกต้องในบรรทัด: "${line}"`;
            break;
        }

        let categoryName = "";
        let betType = "";
        let isValidType = false;

        // 1. ตรวจสอบกลุ่ม สูง / ต่ำ
        let currentLineSide = null;
        if (targetStr === "ส" || targetStr === "สูง" || (targetStr.startsWith("ส") && targetStr.length === 2 && ['1','2','3','4','5','6'].includes(targetStr[1]))) {
            currentLineSide = "HIGH";
        } else if (targetStr === "ต" || targetStr === "ต่ำ" || (targetStr.startsWith("ต") && targetStr.length === 2 && ['1','2','3','4','5','6'].includes(targetStr[1]))) {
            currentLineSide = "LOW";
        }

        if (currentLineSide) {
            if (tempSide && tempSide !== currentLineSide) {
                hasError = true;
                errorMsg = `❌ แทงสวนไม่ได้! คุณมีรายการแทงฝั่ง "${tempSide === 'HIGH' ? 'สูง' : 'ต่ำ'}" ไว้แล้วในรอบนี้`;
                break;
            }
            tempSide = currentLineSide;
        }

        // 2. แปลงคำและประเภทเดิมพัน
        if (targetStr === "11") {
            categoryName = "11 ไฮโล"; betType = "11"; isValidType = true;
        } else if (targetStr === "ส" || targetStr === "สูง") { categoryName = "สูง"; betType = "ส/ต"; isValidType = true; }
        else if (targetStr === "ต" || targetStr === "ต่ำ") { categoryName = "ต่ำ"; betType = "ส/ต"; isValidType = true; }
        else if (targetStr === "ตอง") { categoryName = "ตองรวม (ตองใดๆ)"; betType = "ตองรวม"; isValidType = true; }
        else if (targetStr.startsWith("ตอง") && targetStr.length === 4) {
            const num = targetStr.substring(3);
            if (['1','2','3','4','5','6'].includes(num)) {
                categoryName = `ตอง ${num}`; betType = "ตองเจาะ"; isValidType = true;
            }
        } else if ((targetStr.startsWith("ต") || targetStr.startsWith("ส")) && targetStr.length === 2) {
            const side = targetStr.startsWith("ต") ? "ต่ำ" : "สูง";
            const num = targetStr.substring(1);
            if (['1','2','3','4','5','6'].includes(num)) {
                categoryName = `${side}${num}`; betType = "คู่ส/ต"; isValidType = true;
            }
        } else if (targetStr.split('').every(c => ['1','2','3','4','5','6'].includes(c))) {
            const nums = targetStr.split('');
            if (nums.length === 2) {
                if (nums[0] === nums[1]) {
                    hasError = true;
                    errorMsg = `❌ ส่งโพยไม่ถูกต้อง! โต๊ด 2 ตัว ต้องเป็นเลขคนละตัวกัน (${targetStr})`;
                    break;
                } else {
                    categoryName = `โต๊ด${nums[0]}${nums[1]}`; betType = "โต๊ด2"; isValidType = true;
                }
            } else if (nums.length === 3) {
                if (new Set(nums).size !== 3) {
                    hasError = true;
                    errorMsg = `❌ ส่งโพยไม่ถูกต้อง! โต๊ด 3 ตัว ห้ามมีเลขซ้ำกัน (${targetStr})`;
                    break;
                } else {
                    categoryName = `โต๊ด${nums[0]}${nums[1]}${nums[2]}`; betType = "โต๊ด3"; isValidType = true;
                }
            } else {
                if (new Set(nums).size !== nums.length) {
                    hasError = true;
                    errorMsg = `❌ ส่งโพยไม่ถูกต้อง! พบเลขซ้ำกันในรายการเต็งหลายหน้า (${targetStr})`;
                    break;
                }
                const digits = Array.from(new Set(nums));
                digits.forEach(d => tempSingles.add(d));

                if (tempSingles.size > 5) {
                    hasError = true;
                    errorMsg = `❌ แทงกั๊กไม่ได้! ระบบอนุญาตให้แทงเต็งได้สูงสุดไม่เกิน 5 หน้าต่อรอบครับ`;
                    break;
                }
                betType = "เต็ง"; isValidType = true;
                categoryName = digits.length === 1 ? `เต็ง ${digits[0]}` : `เต็ง ${digits.length} หน้า (${digits.join(', ')})`;
            }
        }

        if (!isValidType) {
            hasError = true;
            errorMsg = `❌ ประเภทการแทงไฮโลไม่ถูกต้องในบรรทัด: "${line}"`;
            break;
        }

        // 3. ตรวจสอบยอดอั้น
        const maxAllowed = MAX_BET_MAP[betType];
        if (!maxAllowed) {
            hasError = true; errorMsg = `⚠️ ไม่พบการตั้งค่าอั้นสำหรับประเภท [${betType}]`; break;
        }

        if (price < MIN_BET || price > maxAllowed) {
            hasError = true;
            errorMsg = `❌ แทงไม่สำเร็จ! ยอดแทงประเภท [${categoryName}] ต้องอยู่ระหว่าง ${MIN_BET} ถึง ${maxAllowed} บาทครับ`;
            break;
        }

        if (betType === "เต็ง") {
            const digits = targetStr.split('');
            for (let d of digits) {
                const currentDigitTotal = (existingSingleTotals[d] || 0) + price;
                if (currentDigitTotal > maxAllowed) {
                    hasError = true;
                    errorMsg = `❌ แทงไม่สำเร็จ! เต็งหน้า ${d} มียอดแทงสะสมเกินลิมิตสูงสุด ${maxAllowed} บาทต่อหน้า`;
                    break;
                }
            }
            if (hasError) break;
            digits.forEach(d => { existingSingleTotals[d] = (existingSingleTotals[d] || 0) + price; });
        } else {
            const key = `${betType}_${targetStr}`;
            const currentCategoryTotal = (existingCategoryTotals[key] || 0) + price;
            if (currentCategoryTotal > maxAllowed) {
                hasError = true;
                errorMsg = `❌ แทงไม่สำเร็จ! รายการ [${categoryName}] มียอดแทงสะสมเกินลิมิตสูงสุด ${maxAllowed} บาท`;
                break;
            }
            existingCategoryTotals[key] = currentCategoryTotal;
        }

        let lineTotalPrice = (betType === "เต็ง" && targetStr.length > 1) ? price * targetStr.length : price;
        totalHiloBet += lineTotalPrice;
        processedHiloBets.push({
            target: targetStr,
            category: categoryName,
            betType: betType,
            pricePerLeg: price,
            price: lineTotalPrice
        });
    }

    if (hasError) {
        return { success: false, message: errorMsg };
    }

    if (totalHiloBet <= 0) {
        return { success: false, message: "⚠️ ไม่พบรายการแทงที่ถูกต้อง" };
    }

    if (user.balance < totalHiloBet) {
        return { 
            success: false, 
            message: `❌ เครดิตของคุณไม่พอสำหรับแทงไฮโลครับ!\n💸 ยอดแทงรวม: ${totalHiloBet} บาท\n💰 เครดิตคงเหลือ: ${user.balance} บาท` 
        };
    }

    // บันทึกการเปลี่ยนแปลงเมื่อสำเร็จ
    hiloUserTrackers[userId].side = tempSide;
    hiloUserTrackers[userId].singles = tempSingles;
    user.balance -= totalHiloBet;

    await saveDataToFirebase();

    if (!hiloRoundBets[userId]) {
        hiloRoundBets[userId] = [];
    }

    processedHiloBets.forEach(hb => {
        hiloRoundBets[userId].push({
            name: displayName,
            memberNumber: user.memberNumber,
            target: hb.target,
            category: hb.category,
            betType: hb.betType,
            pricePerLeg: hb.pricePerLeg,
            price: hb.price,
            time: new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' }),
            source: source // ระบุว่ามาจาก 'line' หรือ 'web'
        });
    });

    return { 
        success: true, 
        message: "บันทึกโพยสำเร็จ", 
        newBalance: user.balance, 
        processedBets: processedHiloBets 
    };
}

app.post('/callback', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    for (let event of events) {
        
      // =================================================================
        // 🎯 1. [ระบบจัดการการกดปุ่ม Postback VIP] (เมื่อมีคนเอานิ้วกดปุ่มบนการ์ด)
        // =================================================================
        if (event.type === 'postback') {
            const postbackData = event.postback.data;
            const dataParams = new URLSearchParams(event.postback.data);
            const action = dataParams.get('action');
            const userId = event.source.userId;

            if (action === 'claim_vip') {
                const clickerId = event.source.userId;
                const ownerId = dataParams.get('ownerId');
                let replyMessages = [];

                // ❌ 1.1 กันคนอื่นมาแอบกดปุ่มบัตรคนอื่น
                if (clickerId !== ownerId) {
                    replyMessages = [{
                        type: 'flex',
                        altText: 'แจ้งเตือนสิทธิ์',
                        contents: {
                            type: 'bubble',
                            size: 'kilo',
                            body: {
                                type: 'box',
                                layout: 'vertical',
                                backgroundColor: '#FFF0F3',
                                paddingAll: 'lg',
                                contents: [
                                    { type: 'text', text: 'ปฏิเสธการทำรายการ', weight: 'bold', color: '#FF4D6D', size: 'md' },
                                    { type: 'text', text: 'คุณไม่มีสิทธิ์กดรับรางวัลแทนผู้อื่นครับ!', color: '#594A4E', size: 'sm', margin: 'md', wrap: true }
                                ]
                            }
                        }
                    }];
                } else {
                    const user = usersWallets[ownerId];

                    if (user) {
                        const vipConfig = [
                            { level: 1, reqTurn: 500, reward: 10 },
                            { level: 2, reqTurn: 1000, reward: 20 },
                            { level: 3, reqTurn: 3000, reward: 30 },
                            { level: 4, reqTurn: 5000, reward: 50 },
                            { level: 5, reqTurn: 10000, reward: 120 },
                            { level: 6, reqTurn: 30000, reward: 300 },
                            { level: 7, reqTurn: 50000, reward: 600 },
                            { level: 8, reqTurn: 100000, reward: 1200 },
                            { level: 9, reqTurn: 150000, reward: 1800 },
                            { level: 10, reqTurn: 250000, reward: 4000 }
                        ];

                        const userTurn = user.totalTurnover || 0;
                        const currentVip = user.vipLevel || 0;

                        let totalRewardToClaim = 0;
                        let newVipLevel = currentVip;

                        // 🔄 1.2 คำนวณข้ามขั้น VIP
                        for (let config of vipConfig) {
                            if (config.level > currentVip && userTurn >= config.reqTurn) {
                                totalRewardToClaim += config.reward;
                                newVipLevel = config.level;
                            }
                        }

                        // ❌ กรณีเลเวลไม่เพิ่มขึ้น
                        if (newVipLevel === currentVip) {
                            const nextConfig = vipConfig.find(v => v.level === currentVip + 1);
                            
                            let warningTitle = 'เงื่อนไขยังไม่ครบ';
                            let warningDetail = '';

                            if (nextConfig) {
                                const diff = nextConfig.reqTurn - userTurn;
                                warningDetail = `ขาดยอดเทิร์นอีก ${diff.toLocaleString()} บาท\nถึงจะรับ VIP ${nextConfig.level} ได้ครับ`;
                            } else {
                                warningTitle = 'ระดับสูงสุดแล้ว';
                                warningDetail = 'คุณได้รับโบนัส VIP ครบทุกระดับเรียบร้อยแล้วครับ!';
                            }

                            replyMessages = [{
                                type: 'flex',
                                altText: 'แจ้งเตือน VIP',
                                contents: {
                                    type: 'bubble',
                                    size: 'kilo',
                                    body: {
                                        type: 'box',
                                        layout: 'vertical',
                                        backgroundColor: '#FFF0F5',
                                        paddingAll: 'lg',
                                        contents: [
                                            { type: 'text', text: warningTitle, weight: 'bold', color: '#D47FA6', size: 'md' },
                                            { type: 'text', text: warningDetail, color: '#5C4A52', size: 'sm', margin: 'md', wrap: true },
                                            { type: 'separator', color: '#F7C5D9', margin: 'md' },
                                            {
                                                type: 'box',
                                                layout: 'horizontal',
                                                margin: 'md',
                                                contents: [
                                                    { type: 'text', text: 'ยอดสะสมปัจจุบัน:', color: '#8A737C', size: 'xs' },
                                                    { type: 'text', text: `${userTurn.toLocaleString()} บาท`, color: '#B56587', size: 'xs', align: 'end', weight: 'bold' }
                                                ]
                                            }
                                        ]
                                    }
                                }
                            }];
                        } 
                        // ✅ 1.3 ผ่านเงื่อนไข! รับโบนัสรวดเดียว
                        else {
                            user.vipLevel = newVipLevel;
                            user.balance = (user.balance || 0) + totalRewardToClaim;
                            user.turnoverTarget = (user.turnoverTarget || 0) + totalRewardToClaim;

                            // 🎨 Flex Message ถูกต้องตามสเปก LINE API
                            replyMessages = [{
                                type: 'flex',
                                altText: `ยินดีด้วย! อัปเกรด VIP ${newVipLevel}`,
                                contents: {
                                    type: 'bubble',
                                    header: {
                                        type: 'box',
                                        layout: 'vertical',
                                        backgroundColor: '#FFB6C1',
                                        paddingAll: 'lg',
                                        contents: [
                                            { type: 'text', text: '👑 อัปเกรดระดับ VIP สำเร็จ! ✨', weight: 'bold', color: '#FFFFFF', size: 'md', align: 'center', wrap: true },
                                            { type: 'text', text: `ยินดีด้วยนะค้าบคุณ ${user.nickname || user.name} 💕`, color: '#FFF0F5', size: 'xs', align: 'center', margin: 'xs', wrap: true }
                                        ]
                                    },
                                    body: {
                                        type: 'box',
                                        layout: 'vertical',
                                        backgroundColor: '#FFF8FA',
                                        paddingAll: 'lg',
                                        contents: [
                                            {
                                                type: 'box',
                                                layout: 'horizontal',
                                                contents: [
                                                    { type: 'text', text: 'ระดับใหม่:', color: '#8C7A82', size: 'sm' },
                                                    { type: 'text', text: `VIP ${newVipLevel}`, color: '#D4AF37', weight: 'bold', size: 'sm', align: 'end' }
                                                ]
                                            },
                                            {
                                                type: 'box',
                                                layout: 'horizontal',
                                                margin: 'sm',
                                                contents: [
                                                    { type: 'text', text: 'โบนัสรวมที่ได้รับ:', color: '#8C7A82', size: 'sm' },
                                                    { type: 'text', text: `+${totalRewardToClaim.toLocaleString()} ฿`, color: '#2E8B57', weight: 'bold', size: 'sm', align: 'end' }
                                                ]
                                            },
                                            {
                                                type: 'box',
                                                layout: 'horizontal',
                                                margin: 'sm',
                                                contents: [
                                                    { type: 'text', text: 'ติดเทิร์นเพิ่ม (1x):', color: '#8C7A82', size: 'sm' },
                                                    { type: 'text', text: `${totalRewardToClaim.toLocaleString()} ฿`, color: '#E65C00', weight: 'bold', size: 'sm', align: 'end' }
                                                ]
                                            },
                                            { type: 'separator', color: '#F4CFDF', margin: 'lg' },
                                            {
                                                type: 'box',
                                                layout: 'horizontal',
                                                margin: 'lg',
                                                contents: [
                                                    { type: 'text', text: '💳 ยอดเงินคงเหลือ:', color: '#4A3B40', size: 'sm', weight: 'bold' },
                                                    { type: 'text', text: `${user.balance.toLocaleString()} ฿`, color: '#B8860B', weight: 'bold', size: 'sm', align: 'end' }
                                                ]
                                            }
                                        ]
                                    },
                                    footer: {
                                        type: 'box',
                                        layout: 'vertical',
                                        backgroundColor: '#FFF0F5',
                                        paddingAll: 'md',
                                        contents: [
                                            { type: 'text', text: '💖 ขอบคุณที่ร่วมสนุกกับเรา ขอให้โชคดีนะค้าบ 💖', color: '#A0808B', size: 'xxs', align: 'center', wrap: true }
                                        ]
                                    }
                                }
                            }];

                            // 💾 3. บันทึกลง Firebase พร้อมดัก Error
                            try {
                                await saveDataToFirebase();
                                console.log("💾 บันทึกข้อมูลโบนัส VIP ลง Firebase เรียบร้อย!");
                            } catch (err) {
                                console.error("❌ บันทึกข้อมูลลง Firebase ล้มเหลว:", err.message);
                            }
                        }
                    }
                }

                // 📤 ตอบกลับ LINE
                if (replyMessages.length > 0) {
                    try {
                        await axios.post('https://api.line.me/v2/bot/message/reply', {
                            replyToken: event.replyToken,
                            messages: replyMessages
                        }, {
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${TOKEN}`
                            }
                        });
                    }catch (error) {
                            console.error("LINE API Details Error:", JSON.stringify(error.response.data, null, 2));
                        }
                    }
                }
           // ==================== [ 1.2 รับคืนยอดเสีย ] ====================
else if (action === 'ยอดเสีย' || postbackData.includes("action=ยอดเสีย")) {
    const ownerId = dataParams.get("ownerId");
    let replyText = "";

    // 🔒 ป้องกันคนอื่นมาแอบกดปุ่มในการ์ดคนอื่น
    if (!ownerId || ownerId === 'undefined' || userId !== ownerId) {
        replyText = "⚠️ คุณสามารถกดรับยอดเสียจากการ์ดข้อมูลของตัวเองเท่านั้น!";
    } else if (!global.isCashbackOpen) {
        replyText = "⚠️ ขณะนี้ **ยังไม่ถึงเวลาเปิดให้รับยอดเสีย**";
    } else {
        const user = usersWallets[ownerId] || usersWallets[userId];

        if (!user) {
            replyText = "❌ ไม่พบข้อมูลสมาชิกในระบบครับ";
        }
        // 🛑 1. เช็กว่าเคยรับยอดเสียของรอบนี้ไปหรือยัง
        else if (user.hasClaimedCashback === true) {
            replyText = `⚠️ คุณ ${user.name} ได้รับยอดเสียของรอบนี้ไปเรียบร้อยแล้ว!\n(สามารถกดรับได้เพียง 1 ครั้ง/วัน)`;
        }else {
            const totalDeposit = user.totalDeposit || 0;
            const totalWithdraw = user.totalWithdraw || 0;
            const currentBalance = user.balance || 0;

            // 🧮 คำนวณยอดเสียสุทธิ
            const netLoss = totalDeposit - totalWithdraw - currentBalance;

            if (netLoss <= 0) {
                replyText = `⚠️ คุณ ${user.name} (ID: ${user.memberNumber}) ยังไม่อยู่ในเงื่อนไขรับยอดเสียครับ\n(ยอดเสียสุทธิ: 0 บาท)`;
            } else {
                const cashBackRate = 0.05; // 5%
                const cashbackAmount = Math.floor(netLoss * cashBackRate);

                if (cashbackAmount <= 0) {
                    replyText = `⚠️ ยอดเสียคงเหลือของคุณน้อยเกินไปที่จะคำนวณคืน 5% ครับ`;
                } else {
                    // 💰 1. เติมเงินยอดเสียเข้า balance
                    user.balance = (user.balance || 0) + cashbackAmount;

                    // 🎯 2. ตั้งค่าเทิร์นโอเวอร์ 1 เท่า
                    user.turnoverTarget = (user.turnoverTarget || 0) + cashbackAmount;
                    user.turnoverStatus = "ติดเทิร์น";

                    // 🚩 บันทึกสิทธิ์ว่า "กดรับยอดเสียรอบนี้ไปแล้ว"
                    user.hasClaimedCashback = true;

                    // 🔄 3. รีเซ็ตค่าเพื่อไม่ให้กดรับซ้ำในรอบเดียวกันได้
                    user.totalDeposit = user.balance;
                    user.totalWithdraw = 0;

                    try {
                        await saveDataToFirebase();
                        console.log("💾 บันทึกข้อมูลลง Firebase เรียบร้อย!");
                    } catch (err) {
                        console.error("❌ บันทึกข้อมูลลง Firebase ล้มเหลว:", err.message);
                    }

                    // 🎨 สร้าง Flex Message ตอบกลับแบบน่ารักสดใส
                    const flexCashbackSuccess = {
                        type: 'flex',
                        altText: '🎁 คืนยอดเสียสำเร็จแล้วนะค้าบ!',
                        contents: {
                            type: 'bubble',
                            size: 'kilo',
                            header: {
                                type: 'box',
                                layout: 'vertical',
                                backgroundColor: '#FFF0F5',
                                paddingAll: 'lg',
                                contents: [
                                    {
                                        type: 'text',
                                        text: '🎁 คืนยอดเสียสำเร็จ! ✨',
                                        weight: 'bold',
                                        color: '#FF6B81',
                                        size: 'lg',
                                        align: 'center'
                                    },
                                    {
                                        type: 'text',
                                        text: `ไม่ต้องเสียใจน้า ต่อทุนรอบนี้แตกแน่นอน! 💕`,
                                        color: '#A0808B',
                                        size: 'xs',
                                        align: 'center',
                                        margin: 'xs'
                                    }
                                ]
                            },
                            body: {
                                type: 'box',
                                layout: 'vertical',
                                backgroundColor: '#FFFFFF',
                                paddingAll: 'md',
                                contents: [
                                    {
                                        type: 'box',
                                        layout: 'vertical',
                                        backgroundColor: '#FFF9F0',
                                        cornerRadius: 'md',
                                        paddingAll: 'md',
                                        contents: [
                                            {
                                                type: 'box',
                                                layout: 'horizontal',
                                                contents: [
                                                    { type: 'text', text: '👤 สมาชิก:', color: '#8A7A80', size: 'xs' },
                                                    { type: 'text', text: `${user.name || 'สมาชิก'}`, color: '#4A3B40', size: 'xs', align: 'end', weight: 'bold' }
                                                ]
                                            },
                                            {
                                                type: 'box',
                                                layout: 'horizontal',
                                                margin: 'xs',
                                                contents: [
                                                    { type: 'text', text: '📉 ยอดเสียสุทธิ:', color: '#8A7A80', size: 'xs' },
                                                    { type: 'text', text: `${netLoss.toLocaleString()} บาท`, color: '#FF4757', size: 'xs', align: 'end', weight: 'bold' }
                                                ]
                                            },
                                            {
                                                type: 'box',
                                                layout: 'horizontal',
                                                margin: 'xs',
                                                contents: [
                                                    { type: 'text', text: '💸 อัตราคืนเงิน:', color: '#8A7A80', size: 'xs' },
                                                    { type: 'text', text: '5%', color: '#FFA502', size: 'xs', align: 'end', weight: 'bold' }
                                                ]
                                            },
                                            { type: 'separator', color: '#FFE0B2', margin: 'md' },
                                            {
                                                type: 'box',
                                                layout: 'horizontal',
                                                margin: 'md',
                                                contents: [
                                                    { type: 'text', text: '💰 เครดิตเข้ากระเป๋า:', color: '#2ED573', weight: 'bold', size: 'sm' },
                                                    { type: 'text', text: `+${cashbackAmount.toLocaleString()} บาท`, color: '#2ED573', weight: 'bold', size: 'md', align: 'end' }
                                                ]
                                            }
                                        ]
                                    },
                                    {
                                        type: 'box',
                                        layout: 'vertical',
                                        margin: 'sm',
                                        contents: [
                                            {
                                                type: 'text',
                                                text: `🔒 ติดเทิร์น 1 เท่า (${cashbackAmount.toLocaleString()} บาท) | ยอดคงเหลือใหม่: ${user.balance.toLocaleString()} บาท`,
                                                color: '#B5A6AD',
                                                size: 'xxs',
                                                align: 'center',
                                                wrap: true
                                            }
                                        ]
                                    }
                                ]
                            },
                            footer: {
                                type: 'box',
                                layout: 'vertical',
                                backgroundColor: '#FFF0F5',
                                paddingAll: 'sm',
                                contents: [
                                    {
                                        type: 'text',
                                        text: '💳 ยอดฝาก-ถอนสะสมถูกรีเซ็ตเพื่อเริ่มรอบใหม่แล้วครับ 🚀',
                                        color: '#FF6B81',
                                        size: 'xxs',
                                        align: 'center',
                                        wrap: true
                                    }
                                ]
                            }
                        }
                    };

                    // 📤 ส่ง Flex Message เมื่อรับสำเร็จ
                    try {
                        await axios.post('https://api.line.me/v2/bot/message/reply', {
                            replyToken: event.replyToken,
                            messages: [flexCashbackSuccess]
                        }, {
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${TOKEN}`
                            }
                        });
                    } catch (error) {
                        console.error("LINE API Cashback Flex Reply Error:", error.response ? error.response.data : error.message);
                    }

                    return res.sendStatus(200);
                }
            }
        }
    }   
}
        }
      // =================================================================
        // 📸 [ระบบฟิวชั่น ร่างอัปเกรดเตือนภัย] ดักจับรูปภาพสลิป + เตือนแอดมินถ้าส่งช้าเกิน 5 นาที
        // =================================================================
        if (event.type === 'message' && event.message.type === 'image') {
            const replyToken = event.replyToken;
            const userId = event.source.userId;

            if (global.depositQueue && global.depositQueue[userId] && global.depositQueue[userId].status === 'WAITING_ADMIN') {
                const currentQueue = global.depositQueue[userId];
                const messageId = event.message.id;
                const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";
                
                // ⏱️ คำนวณเวลาที่ใช้ไปนับตั้งแต่กดฝาก (หน่วยเป็นนาที)
                const timeElapsed = (Date.now() - currentQueue.createdAt) / 1000 / 60;

                // 🚨 สร้างป้ายเตือนภัย ถ้าส่งสลิปช้ากว่า 5 นาที
                let timeWarningTag = "";
                if (timeElapsed > 5) {
                    timeWarningTag = `\n\n⚠️ [แจ้งเตือนภัย] สลิปนี้ส่งเลทเกิน 5 นาทีนะน้า! (ส่งช้าไปประมาณ ${Math.floor(timeElapsed)} นาที) เช็กเวลาโอนบนสลิปและสเตทเม้นท์ให้ดีๆ ก่อนกดเติมเงินครับ!`;
                }

                const filename = `slip-${currentQueue.memberId}.jpg`;

                try {
                    // 📁 1. ดาวน์โหลดรูปภาพสลิปดิบจาก LINE API
                    const response = await axios({
                        method: 'get',
                        url: `https://api-data.line.me/v2/bot/message/${messageId}/content`,
                        responseType: 'stream',
                        headers: { 'Authorization': `Bearer ${TOKEN}` }
                    });

                    // 💾 2. บันทึกรูปภาพลงบนเซิร์ฟเวอร์ Render (ตรรกะเดิมที่ทำงานได้สมบูรณ์แบบห้ามแตะต้อง)
                    const writer = fs.createWriteStream(filename);
                    response.data.pipe(writer);

                    await new Promise((resolve, reject) => {
                        writer.on('finish', resolve);
                        writer.on('error', reject);
                    });

                    const myServerUrl = `https://linepok3p.onrender.com/${filename}`;

                   // 🔔 3. เปลี่ยนจากข้อความธรรมดา เป็นการส่ง Flex Message หาแอดมิน (มีปุ่มกดสะดวกรวดเร็ว)
                    const adminFlexMessage = {
                        "type": "flex",
                        "altText": `🔔 แจ้งโอนเงินจากสมาชิกที่ ${currentQueue.memberId}`,
                        "contents": {
                            "type": "bubble",
                            "size": "giga",
                            "styles": {
                                "header": { "backgroundColor": "#111111" },
                                "body": { "backgroundColor": "#1c1c1c" },
                                "footer": { "backgroundColor": "#111111" }
                            },
                            "header": {
                                "type": "box",
                                "layout": "vertical",
                                "contents": [
                                    { "type": "text", "text": "🔔 มีรายการแจ้งโอนเงินใหม่!", "weight": "bold", "color": "#ffbb00", "size": "md", "align": "center" }
                                ]
                            },
                            "body": {
                                "type": "box",
                                "layout": "vertical",
                                "spacing": "sm",
                                "contents": [
                                    { "type": "text", "text": `🆔 สมาชิกลำดับที่: ${currentQueue.memberId}`, "color": "#ffffff", "size": "sm" },
                                    { "type": "text", "text": `👤 ชื่อ: คุณ ${currentQueue.name}`, "color": "#cccccc", "size": "sm" },
                                    { "type": "text", "text": `💰 ยอดเงินในคิว: ${currentQueue.displayAmount} บาท`, "color": "#00ffcc", "weight": "bold", "size": "md" },
                                    { "type": "separator", "color": "#333333", "margin": "md" },
                                    { "type": "text", "text": "🤖 [ระบบออโต้]: กำลังรอเช็กยอดโอนและเศษสตางค์ตรงกับระบบแจ้งเตือน...", "color": "#888888", "size": "xs", "wrap": true, "margin": "sm" },
                                    { "type": "text", "text": "💡 หากยอดไม่เข้า หรือน้าตรวจสอบแล้วถูกต้อง สามารถใช้ปุ่มลัดด้านล่างเพื่อจัดการแบบแมนนวลได้ทันทีครับ", "color": "#ff8800", "size": "xs", "wrap": true }
                                ]
                            },
                            "footer": {
                                "type": "box",
                                "layout": "vertical",
                                "spacing": "sm",
                                "contents": [
                                    {
                                        "type": "button",
                                        "style": "primary",
                                        "color": "#00aa5b",
                                        "height": "sm",
                                        "action": {
                                            "type": "message",
                                            "label": "✅ เติมเงินปกติ",
                                            "text": `เติม ${currentQueue.memberId} ${currentQueue.rawAmount}`
                                        }
                                    },
                                    {
                                        "type": "button",
                                        "style": "primary",
                                        "color": "#0088cc",
                                        "height": "sm",
                                        "action": {
                                            "type": "message",
                                            "label": "🎁 เติมแบบติดโปร (B)",
                                            "text": `B ${currentQueue.memberId} [ใส่ยอดรวมโบนัสตรงนี้ด้วยนะน้า]`
                                        }
                                    },
                                    {
                                        "type": "button",
                                        "style": "secondary",
                                        "color": "#cc3333",
                                        "height": "sm",
                                        "action": {
                                            "type": "message",
                                            "label": "❌ ปฏิเสธรายการ (cc)",
                                            "text": `cc ${currentQueue.memberId}`
                                        }
                                    }
                                ]
                            }
                        }
                    };

                    // 🚀 4. สั่ง Push ส่งรูปภาพ + Flex Message ที่มีปุ่มกด หาแอดมินพร้อมกัน
                    await axios.post('https://api.line.me/v2/bot/message/push', {
                        to: ADMIN_ID,
                        messages: [
                            { type: 'image', originalContentUrl: myServerUrl, previewImageUrl: myServerUrl },
                            adminFlexMessage // 👈 เปลี่ยนจาก adminNotifyMessage (ข้อความธรรมดา) มาเป็นตัวปุ่มกดนี้แทนครับ
                        ]
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TOKEN}`
                        }
                    });

                    // 💬 5. ตอบกลับแจ้งสมาชิกฝั่งลูกค้าด้วย Flex Message ธีมธุรกรรมฝากเงินสีเขียวนีออนสุดเท่ 
                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                        replyToken: replyToken,
                        messages: [
                            {
                                "type": "flex",
                                "altText": "✅ ได้รับสลิปเรียบร้อยแล้วค่ะ",
                                "contents": {
                                    "type": "bubble",
                                    "styles": { "body": { "backgroundColor": "#09120e" } },
                                    "body": {
                                        "type": "box",
                                        "layout": "vertical",
                                        "spacing": "md",
                                        "contents": [
                                            { "type": "text", "text": "✅ ได้รับรูปภาพสลิปแล้ว", "weight": "bold", "color": "#00ff88", "size": "md", "align": "center" },
                                            { "type": "separator", "color": "#12251c" },
                                            {
                                                "type": "box",
                                                "layout": "horizontal",
                                                "contents": [
                                                    { "type": "text", "text": "💰 ยอดโอนในคิว:", "size": "sm", "color": "#8caf9c" },
                                                    { "type": "text", "text": `${currentQueue.displayAmount} บาท`, "size": "sm", "color": "#00ff88", "weight": "bold", "align": "end" }
                                                ]
                                            },
                                            { "type": "separator", "color": "#12251c" },
                                            { "type": "text", "text": "⏳ ระบบกำลังตรวจสอบความถูกต้องของสลิปและยอดโอน กรุณารอเครดิตเข้ากระเป๋าสักครู่เดียวค่ะ 🏁", "size": "xs", "color": "#cccccc", "wrap": true, "align": "center" }
                                        ]
                                    }
                                }
                            }
                        ]
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TOKEN}`
                        }
                    });

                } catch (err) {
                    console.error("❌ ระบบแจ้งเตือนรูปสลิปล้มเหลว:", err.message);
                }
                return res.sendStatus(200); 
            }
            
            return res.sendStatus(200);
        }
        if (event.type === 'message' && event.message.type === 'text') {
            const replyToken = event.replyToken;
            const userId = event.source.userId; 
            const originalMsg = event.message.text.trim(); 
            const userMsg = originalMsg.toLowerCase().replace(/\s+/g, ''); 

            let replyText = ""; 
            const args = originalMsg.split(/\s+/); 
            const command = args[0]; // ดึงคำแรก เช่น เติม หรือ ลบ
        
        // ==================== [ 🤖 ระบบดักจับแจ้งเตือนธนาคารและอัปยอดออโต้ ] ====================
        if (userMsg.includes('kdeposit')) { // ใช้ includes แทน และเช็กจาก userMsg ที่เป็นพิมพ์เล็กหมดแล้ว
            console.log(`🤖 บอทได้รับแจ้งเตือนธนาคารจาก MacroDroid: "${originalMsg}"`);
            
            // 🔍 แกะตัวเลขทศนิยมออกมา เช่น 10.68 จากข้อความจริง (originalMsg)
            const match = originalMsg.match(/([0-9]+\.[0-9]{2})/);
            if (match) {
                const bankAmount = parseFloat(match[1]); // จะได้เลข 10.68 เป็นทศนิยม
                console.log(`🔍 ค้นหาในคิวระบบ ยอดที่ตรงกับ: ${bankAmount} บาท...`);

                // ค้นหาคิวยูสเซอร์ที่มีสถานะรอโอน และยอดตรงกับเศษสตางค์
                let foundUserId = null;
                for (let uId in global.depositQueue) {
                    const queue = global.depositQueue[uId];
                    if (queue.status === 'WAITING_ADMIN' && parseFloat(queue.displayAmount) === bankAmount) {
                        foundUserId = uId;
                        break;
                    }
                }

                if (foundUserId) {
                    const matchedQueue = global.depositQueue[foundUserId];
                    
                    // 💰 1. เติมเครดิตเข้ากระเป๋าของลูกค้า
            if (usersWallets[foundUserId]) {
                const user = usersWallets[foundUserId];

                // 🔄 [เพิ่มจุดนี้] เช็กและตัดโบนัสเก่าออกก่อนฝากใหม่
                if (user.activePromotion) {
                    const previousBonus = user.activeBonusAmount || 0;
                    user.balance = user.balance - previousBonus;
                    
                    if (user.balance < 0) {
                        user.balance = 0; // ถ้าหักโบนัสแล้วติดลบ ให้เซ็ตเป็น 0
                    }

                    // ล้างค่าโปรโมชั่นและเทิร์นโอเวอร์เก่าทิ้ง
                    user.activePromotion = null;
                    user.turnoverTarget = 0;
                    user.activeBonusAmount = 0;
                    
                    console.log(`🧹 ล้างโปรโมชั่นติดค้างของสมาชิกที่ ${user.memberNumber} เรียบร้อยแล้ว`);
                }

                // 💵 บวกเงินฝากใหม่เข้ากระเป๋า
                user.balance += matchedQueue.rawAmount;

                // 🟢 สะสมยอดฝากสำเร็จของสมาชิกออโต้
                user.totalDeposit = (user.totalDeposit || 0) + matchedQueue.rawAmount;
                
                // 🌟 บันทึกยอดฝากล่าสุดของสมาชิก
                user.lastDeposit = matchedQueue.rawAmount;
                        
                        console.log(`✅ [จับคู่สำเร็จ] เติมเงินให้สมาชิกที่ ${usersWallets[foundUserId].memberNumber} จำนวน ${matchedQueue.rawAmount} บาท!`);

                        // 🧼 2. ล้างคิวฝากเงินชิ้นนี้ทิ้ง ป้องกันสลิปซ้ำ
                        delete global.depositQueue[foundUserId];

                        // 🎯 [เพิ่มจุดนี้] ถ้าระบบไม่มีคิวฝากค้างอยู่เลย ให้รีเซ็ตเศษสตางค์กลับไปเริ่ม 0.01 ใหม่
                        if (Object.keys(global.depositQueue).length === 0) {
                            global.satangCounter = 0;
                        }

                        // 💾 3. บันทึกลง Firebase ถาวรทันที
                        await saveDataToFirebase();
                        
                    } else {
                        console.log(`⚠️ พบยอดโอนตรงในคิว แต่ยูสเซอร์ ${foundUserId} ไม่มีกระเป๋าเงินในระบบ`);
                    }
                } else {
                    console.log(`❌ ไม่พบใบสั่งฝากเงินในระบบที่ตรงกับยอด ${bankAmount} บาท`);
                }
            }
            return res.sendStatus(200); // 👈 แก้ตรงนี้! ส่ง Status 200 กลับหาเว็บฮุกทันทีโดยตรง ไม่รันต่อให้เกิดบั๊กสลิปซ้ำ
        }

            // ==================== [ 1. ระบบเติมเงิน/ลบเงิน ] ====================
            if (command === "เติม" || command === "ลบ") {
                // 🚨 เปลี่ยนตรงนี้: เช็กว่า ID คนพิมพ์อยู่ในกล่องแอดมินไหม
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    const targetMemberId = parseInt(args[1]); 
                    const amount = parseFloat(args[2]);      

                    if (!targetMemberId || isNaN(amount) || amount <= 0) {
                        replyText = `⚠️ รูปแบบคำสั่งไม่ถูกต้อง\nกรุณาพิมพ์: เติม [เลขสมาชิก] [จำนวนเงิน]\n(ตัวอย่าง: เติม 1 2000 หรือ ลบ 1 2000)`;
                    } else {
                        let foundUserKey = null;
                        for (let key in usersWallets) {
                            if (usersWallets[key].memberNumber === targetMemberId) {
                                foundUserKey = key;
                                break;
                            }
                        }

                        if (!foundUserKey) {
                            replyText = `❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับ`;
                        } else {
                            if (command === "เติม") {
                                // 🚨 [ดักคนเหลี่ยม] เช็กก่อนว่าสมาชิกคนนี้ได้พิมพ์ "ฝาก" เพื่อเปิดยอดฝากไว้จริงไหม
                                if (!global.depositQueue || !global.depositQueue[foundUserKey] || global.depositQueue[foundUserKey].status !== 'WAITING_ADMIN') {
                                    replyText = `❌ เติมเงินไม่สำเร็จ! \n สมาชิกเลข ${targetMemberId} ยังไม่ได้พิมพ์ฝากเข้ามาในระบบ หรือยอดนี้เคยเติมไป`;
                                } else {
                                    const user = usersWallets[foundUserKey];

                                    // 🔄 [เพิ่มจุดนี้] เช็กและตัดโบนัสเก่าออกก่อนฝากใหม่
                                    if (user.activePromotion) {
                                        const previousBonus = user.activeBonusAmount || 0;
                                        user.balance = user.balance - previousBonus;
                                        
                                        if (user.balance < 0) {
                                            user.balance = 0;
                                        }
            
                                        // ล้างค่าโปรโมชั่นและเทิร์นโอเวอร์เก่าทิ้ง
                                        user.activePromotion = null;
                                        user.turnoverTarget = 0;
                                        user.activeBonusAmount = 0;
                                    }
            
                                    // 💵 บวกเงินเติมใหม่เข้ากระเป๋า
                                    user.balance += amount;
            
                                    // 🟢 สะสมยอดฝากสำเร็จ
                                    user.totalDeposit = (user.totalDeposit || 0) + amount;
                                    
                                    // 🌟 บันทึกยอดฝากล่าสุดของสมาชิก
                                    user.lastDeposit = amount;
                                    
                                    // 🧼 ล้างคิวฝากทิ้งทันที
                                    delete global.depositQueue[foundUserKey]; 

                                    // 🎯 [เพิ่มจุดนี้] ถ้าระบบไม่มีคิวฝากค้างอยู่เลย ให้รีเซ็ตเศษสตางค์กลับไปเริ่ม 0.01 ใหม่
                                    if (Object.keys(global.depositQueue).length === 0) {
                                        global.satangCounter = 0;
                                     }

                                    await saveDataToFirebase(); 
                                    replyText = `💰 เติมเครดิตสมาชิกที่ ${user.memberNumber} \n คุณ ${user.name} +${amount} สำเร็จ!\n──────────────────\nยอดสุทธิ: ${user.balance} บาท`;
                                }
                            } else if (command === "ลบ") {
                                usersWallets[foundUserKey].balance -= amount;
                                const user = usersWallets[foundUserKey];
                                await saveDataToFirebase(); 
                                replyText = `🚨 ลบยอดเครดิตสมาชิกที่ ${user.memberNumber} \n คุณ ${user.name} -${amount}!\n──────────────────\nยอดปัจจุบัน: ${user.balance} บาท`;
                            }
                        }
                    }
                }
            }
// ==================== [ ระบบเติมเงินแบบติดโปรโบนัสคูณ 20 (B เลขสมาชิก จำนวนเงิน) ] ====================
            else if (command === "B" || command === "b") {
                // 🚨 เช็กว่า ID คนพิมพ์อยู่ในกล่องแอดมินไหม
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    const targetMemberId = parseInt(args[1]);
                    const amount = parseFloat(args[2]); 

                    if (!targetMemberId || isNaN(amount) || amount <= 0) {
                        replyText = `⚠️ รูปแบบโปรโบนัสไม่ถูกต้อง\nกรุณาพิมพ์: B [เลขสมาชิก] [ยอดรวมรวมโบนัส]\n(ตัวอย่าง: B 1 200)`;
                    } else {
                        let foundUserKey = null;
                        for (let key in usersWallets) {
                            if (usersWallets[key].memberNumber === targetMemberId) {
                                foundUserKey = key;
                                break;
                            }
                        }

                        if (!foundUserKey) {
                            replyText = `❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับ`;
                        } else {
                            // 🚨 [ดักคนเหลี่ยม] เช็กคิวฝากเงินก่อนให้โปรโบนัส
                            if (!global.depositQueue || !global.depositQueue[foundUserKey] || global.depositQueue[foundUserKey].status !== 'WAITING_ADMIN') {
                                replyText = `❌ เติมโบนัสไม่สำเร็จ! สมาชิกหมายเลข ${targetMemberId} ยังไม่ได้พิมพ์เปิดยอดฝากเข้ามาในระบบ หรือยอดนี้เคยถูกเติมไปแล้วครับน้า`;
                            } else {
                                const user = usersWallets[foundUserKey];
                                user.balance += amount;

                                // 🔄 คำนวณยอดเทิร์นใหม่ของบิลนี้
                                let newTurnoverTarget = amount * 20; 

                                // 📊 ดึงยอดเทิร์นเดิมมาเช็ก ถ้าไม่มีหรือเป็นค่าว่างให้เริ่มต้นจาก 0 แล้วบวกทบเข้าไป
                                let currentTurnover = user.turnoverTarget;
                                if (!currentTurnover || isNaN(currentTurnover)) {
                                    currentTurnover = 0;
                                }
                                user.turnoverTarget = currentTurnover + newTurnoverTarget;
                                
                                // 🧼 ล้างคิวฝากทิ้งทันที
                                delete global.depositQueue[foundUserKey];
                                await saveDataToFirebase();

                                replyText = `🎁 เติมโบนัสให้สมาชิกที่ [ ${user.memberNumber} ] \n คุณ ${user.name} สำเร็จ!\n──────────────────\n` +
                                            `💰 ยอดสุทธิ: +${amount} บาท\n──────────────────\n` +
                                            `🔒 เงื่อนไข ต้องทำยอดเทิร์นสะสม (ได้/เสีย) เพิ่ม: +${newTurnoverTarget} บาท\n` +
                                            `📊 ยอดเทิร์นคงเหลือรวมทั้งหมด: ${user.turnoverTarget} บาท`;
                            }
                        }
                    }
                }
            }
                // ==================== [ 🧼 คำสั่งแอดมินพิเศษ: ล้างยอดเทิร์นโอเวอร์สมาชิก (พิมพ์: bb [เลขสมาชิก]) ] ====================
            else if (command === "Bb" || command === "bb") {
                // 👥 เช็กสิทธิ์แอดมินจากกล่องรวมกลาง
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    const targetMemberId = parseInt(args[1]);

                    if (!targetMemberId || isNaN(targetMemberId)) {
                        replyText = `⚠️ รูปแบบคำสั่งไม่ถูกต้องน้า\nกรุณาพิมพ์: bb [เลขสมาชิก]\n(ตัวอย่างเช่น: bb 1)`;
                    } else {
                        let foundUserKey = null;
                        for (let key in usersWallets) {
                            if (usersWallets[key].memberNumber === targetMemberId) {
                                foundUserKey = key;
                                break;
                            }
                        }

                        if (!foundUserKey) {
                            replyText = `❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับน้า`;
                        } else {
                            const user = usersWallets[foundUserKey];
                            
                            // 🧼 เคลียร์ยอดเทิร์นค้างเก่าทั้งหมดให้เป็น 0 ชัวร์ ๆ
                            user.turnoverTarget = 0;
                            
                            // 💾 บันทึกการเปลี่ยนแปลงลง Firebase ถาวร
                            await saveDataToFirebase();

                            replyText = `🧼 [ระบบล้างยอดเทิร์นโอเวอร์] \n👤 คุณ ${user.name} (สมาชิกที่ ${user.memberNumber})\n✅ ทำการล้างยอดเทิร์นค้างเก่าทั้งหมดสำเร็จแล้วครับ!\n──────────────────\n📊 ยอดเทิร์นคงเหลือที่ต้องทำ: 0 บาท\n💰 เครดิตคงเหลือในกระเป๋า: ${user.balance} บาท`;
                        }
                    }
                }
            }
// =================================================================
// ❌ [คำสั่งแอดมิน] ยกเลิกคิวแจ้งฝากเงิน (พิมพ์: cc [เลขสมาชิก])
// =================================================================
            else if (command === "cc" || command === "Cc" || command === "CC") {
                // 🚨 เปลี่ยนตรงนี้: เช็กว่า ID คนพิมพ์อยู่ในกล่องแอดมินไหม
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    const targetMemberId = parseInt(args[1]); // ดึงเลขสมาชิกจากช่องที่สอง เช่น cc 1

                    if (!targetMemberId || isNaN(targetMemberId)) {
                        replyText = "❌ รูปแบบผิดครับน้า! ต้องพิมพ์เช่น: cc [เลขสมาชิก] (ตัวอย่าง: cc 12)";
                    } else {
                        // ค้นหาในคิวฝากว่า เลขสมาชิกนี้ตรงกับ userId ไหนในระบบ RAM
                        let foundUserKey = null;

                        if (global.depositQueue) {
                            for (let key in global.depositQueue) {
                                if (global.depositQueue[key].memberId === targetMemberId) {
                                    foundUserKey = key;
                                    break;
                                }
                            }
                        }

                        // 🧼 ถ้าเจอคิว ให้ทำการลบออกจากระบบทันที
                        if (foundUserKey) {
                            const currentQueue = global.depositQueue[foundUserKey];
                            delete global.depositQueue[foundUserKey]; // ล้างคิวออกจาก RAM
                            
                            replyText = `❌ [แอดมินสั่งยกเลิก] ทำการยกเลิกและล้างคิวฝากของ สมาชิกลำดับที่: ${targetMemberId} เรียบร้อยแล้วครับน้า!`;

                            // 💬 ส่งข้อความไปเตือนฝั่งลูกค้าให้รู้ตัวด้วยว่าโดนปฏิเสธคิว
                            try {
                                await axios.post('https://api.line.me/v2/bot/message/push', {
                                    to: foundUserKey,
                                    messages: [{ 
                                        type: 'text', 
                                        text: `❌ รายการแจ้งฝากยอดเงินของถูกปฏิเสธ/ยกเลิกโดยแอดมินครับ\n\n⚠️ เหตุผล: สลิปไม่ถูกต้อง หรือยอดเงินไม่ตรง\n👉 หากต้องการทำรายการใหม่ กรุณาพิมพ์คำสั่ง "ฝาก [ยอดเงิน]" อีกครั้ง\n────────────────\nหรือติดต่อแอดมิน\n🔻🔻🔻🔻\nhttps://lin.ee/ySA60EA` 
                                    }]
                                }, {
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${TOKEN}`
                                    }
                                });
                            } catch (err) {
                                console.error("❌ ส่งข้อความแจ้งยกเลิกหาลูกค้าล้มเหลว:", err.message);
                            }

                        } else {
                            replyText = `❌ ไม่พบรายการคิวฝากค้างในระบบที่ตรงกับสมาชิกลำดับที่ ${targetMemberId} ครับน้า เช็กตัวเลขดีๆ อีกทีครับ`;
                        }
                    }
                }
            }
             // ==================== [ 🛠️ คำสั่งแอดมินพิเศษ: เติมเครดิตฉุกเฉิน/แจกทุน+ติดเทิร์น (พิมพ์: @ [เลขสมาชิก] [จำนวนเงิน] หรือ @ [เลขสมาชิก] [จำนวนเงิน]#[ยอดเทิร์น]) ] ====================
            else if (command === "@") {
                // 👥 เช็กสิทธิ์แอดมินจากกล่องรวมกลาง
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    const targetMemberId = parseInt(args[1]);
                    let rawAmountStr = args[2] ? args[2].toString() : "";      

                    if (!targetMemberId || !rawAmountStr) {
                        replyText = `⚠️ รูปแบบคำสั่งไม่ถูกต้องน้า\n👉 เติมปกติ: @ [เลขสมาชิก] [จำนวนเงิน] (เช่น: @ 1 200)\n👉 แจกทุนติดเทิร์น: @ [เลขสมาชิก] [จำนวนเงิน]#[ยอดเทิร์น] (เช่น: @ 1 200#1000)`;
                    } else {
                        let amount = 0;
                        let turnoverRequirement = 0;

                        // 🔍 ตรวจสอบว่ามีการใส่สัญลักษณ์ # เพื่อกำหนดเทิร์นโอเวอร์ไหม
                        if (rawAmountStr.includes('#')) {
                            const parts = rawAmountStr.split('#');
                            amount = parseFloat(parts[0]);
                            turnoverRequirement = parseFloat(parts[1]);
                        } else {
                            amount = parseFloat(rawAmountStr);
                        }

                        if (isNaN(amount) || amount <= 0 || isNaN(turnoverRequirement) || turnoverRequirement < 0) {
                            replyText = `⚠️ จำนวนเงิน หรือยอดเทิร์นโอเวอร์ไม่ถูกต้องครับน้า กรุณาเช็กตัวเลขอีกครั้งครับ`;
                        } else {
                            let foundUserKey = null;
                            for (let key in usersWallets) {
                                if (usersWallets[key].memberNumber === targetMemberId) {
                                    foundUserKey = key;
                                    break;
                                }
                            }

                            if (!foundUserKey) {
                                replyText = `❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับน้า`;
                            } else {
                                // 🚀 บวกเงินเข้ากระเป๋าทันที ทะลุทุกระบบล็อก!
                                usersWallets[foundUserKey].balance += amount;
                                
                                // 📝 บันทึกยอดเทิร์นโอเวอร์สะสมเข้าไปในตัวแปรหลัก (ดักจับถ้าเป็นค่าว่างให้เป็น 0 ก่อนแล้วค่อยบวกทบ)
                                if (turnoverRequirement > 0) {
                                    let currentTurnover = usersWallets[foundUserKey].turnoverTarget;
                                    if (!currentTurnover || isNaN(currentTurnover)) {
                                        currentTurnover = 0;
                                    }
                                    usersWallets[foundUserKey].turnoverTarget = currentTurnover + turnoverRequirement;
                                }

                                const user = usersWallets[foundUserKey];
                                await saveDataToFirebase(); 
                                
                                // 📱 ประกอบข้อความแจ้งเตือนแอดมินและสมาชิก
                                replyText = `⚡ [ระบบจัดการเครดิตแอดมิน] \n👤 คุณ ${user.name} (สมาชิกที่ ${user.memberNumber})\n💰 ได้รับเครดิต: +${amount} บาท\n`;
                                if (turnoverRequirement > 0) {
                                    replyText += `⚠️ [ติดเงื่อนไข] ต้องทำยอดเทิร์นเพิ่ม: +${turnoverRequirement} บาท\n`;
                                    replyText += `📊 ยอดเทิร์นคงเหลือรวมที่ต้องทำ: ${user.turnoverTarget || 0} บาท\n`;
                                } else {
                                    replyText += `✅ รูปแบบ: เติมเงินสดปกติ (ไม่ติดเทิร์น)\n`;
                                }
                                replyText += `──────────────────\n💰 ยอดเงินปัจจุบัน: ${user.balance} บาท`;
                            }
                        }
                    }
                }
            }
// ==================== [ ระบบแจ้งฝากเงินสุ่มเศษสตางค์ ] ====================
               else if (userMsg.startsWith("ฝาก")) {
            // 🔍 ดึงตัวเลขด้วยวิธีเดียวกับระบบถอนของน้าเป๊ะๆ เลยครับ!
            const amount = parseInt(userMsg.replace('ฝาก', '').trim());
                   
                if (!amount || isNaN(amount) || amount <= 0) {
                    try {
                        await axios.post('https://api.line.me/v2/bot/message/reply', {
                            replyToken: replyToken,
                            messages: [
                                {
                                    "type": "flex",
                                    "altText": "⚠️ รูปแบบการฝากเงินไม่ถูกต้อง",
                                    "contents": {
                                        "type": "bubble",
                                        "styles": { "body": { "backgroundColor": "#0d1b15" } },
                                        "body": {
                                            "type": "box",
                                            "layout": "vertical",
                                            "spacing": "md",
                                            "contents": [
                                                { "type": "text", "text": "❌ พิมพ์รูปแบบผิดครับน้า!", "weight": "bold", "color": "#ff3333", "size": "md", "align": "center" },
                                                { "type": "separator", "color": "#183226" },
                                                { "type": "text", "text": "กรุณาพิมพ์ระบุจำนวนเงินที่ต้องการฝากด้วยค่ะ", "size": "xs", "color": "#cccccc", "align": "center" },
                                                {
                                                    "type": "box",
                                                    "layout": "vertical",
                                                    "backgroundColor": "#12261d",
                                                    "paddingAll": "sm",
                                                    "contents": [
                                                        { "type": "text", "text": "📌 รูปแบบ: ฝาก [จำนวนเงิน]", "size": "xs", "color": "#00ffcc", "weight": "bold", "align": "center" },
                                                        { "type": "text", "text": "👉 ตัวอย่าง: ฝาก 500", "size": "xs", "color": "#8abf9e", "align": "center" }
                                                    ]
                                                }
                                            ]
                                        }
                                    }
                                }
                            ]
                        }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
                    } catch (err) { console.error("Error sending deposit invalid flex:", err); }
                    return res.sendStatus(200);
                } else {
                    const walletData = usersWallets[userId];

                    if (!walletData) {
                        try {
                            await axios.post('https://api.line.me/v2/bot/message/reply', {
                                replyToken: replyToken,
                                messages: [
                                    {
                                        "type": "flex",
                                        "altText": "⚠️ สมาชิกยังไม่ได้ลงทะเบียน",
                                        "contents": {
                                            "type": "bubble",
                                            "styles": { "body": { "backgroundColor": "#0d1b15" } },
                                            "body": {
                                                "type": "box",
                                                "layout": "vertical",
                                                "spacing": "md",
                                                "contents": [
                                                    { "type": "text", "text": "❌ ยังไม่ได้สมัครสมาชิก", "weight": "bold", "color": "#ff3333", "size": "md", "align": "center" },
                                                    { "type": "separator", "color": "#183226" },
                                                    { "type": "text", "text": "กรุณาลงทะเบียนเป็นสมาชิกกับเราก่อนเริ่มฝากเงินค่ะ", "size": "xs", "color": "#cccccc", "wrap": true, "align": "center" },
                                                    {
                                                        "type": "box",
                                                        "layout": "vertical",
                                                        "backgroundColor": "#12261d",
                                                        "paddingAll": "sm",
                                                        "contents": [
                                                            { "type": "text", "text": "พิมพ์: C/ชื่อ-นามสกุล,ธนาคาร,เลขบัญชี", "size": "xs", "color": "#00ffcc", "wrap": true },
                                                            { "type": "text", "text": "ตัวอย่าง: C/นายแจ๊ค เด้งดี,กสิกร,1234567890", "size": "xs", "color": "#8abf9e", "wrap": true }
                                                        ]
                                                    }
                                                ]
                                            }
                                        }
                                    }
                                ]
                            }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
                        } catch (err) { console.error("Error sending deposit non-regist flex:", err); }
                        return res.sendStatus(200);
                    } else {
                        if (!global.depositQueue) global.depositQueue = {};

                        const currentQueue = global.depositQueue[userId];

                        if (currentQueue && currentQueue.status === 'WAITING_ADMIN') {
                            try {
                                await axios.post('https://api.line.me/v2/bot/message/reply', {
                                    replyToken: replyToken,
                                    messages: [
                                        {
                                            "type": "flex",
                                            "altText": "⚠️ มีรายการฝากค้างอยู่",
                                            "contents": {
                                                "type": "bubble",
                                                "styles": { "body": { "backgroundColor": "#0d1b15" } },
                                                "body": {
                                                    "type": "box",
                                                    "layout": "vertical",
                                                    "spacing": "md",
                                                    "contents": [
                                                        { "type": "text", "text": "⚠️ มีรายการแจ้งฝากค้างอยู่ในระบบ", "weight": "bold", "color": "#ffcc00", "size": "md", "align": "center" },
                                                        { "type": "separator", "color": "#183226" },
                                                        {
                                                            "type": "box",
                                                            "layout": "horizontal",
                                                            "contents": [
                                                                { "type": "text", "text": "💰 ยอดที่ต้องโอน:", "size": "sm", "color": "#8abf9e" },
                                                                { "type": "text", "text": `${currentQueue.displayAmount} บาท`, "size": "sm", "color": "#00ffcc", "weight": "bold", "align": "end" }
                                                            ]
                                                        },
                                                        { "type": "separator", "color": "#183226" },
                                                        { "type": "text", "text": "🔒 ระบบล็อกไม่ให้แจ้งฝากซ้ำ จนกว่าแอดมินจะอนุมัติรายการเดิมเรียบร้อยค่ะ", "size": "xs", "color": "#ffaa00", "wrap": true, "align": "center" }
                                                    ]
                                                }
                                            }
                                        }
                                    ]
                                }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
                            } catch (err) { console.error("Error sending pending deposit alert flex:", err); }
                            return res.sendStatus(200);
                        } else {
                            global.satangCounter = (global.satangCounter % 99) + 1;
                            const satangValue = global.satangCounter / 100;
                            const totalWithSatang = amount + satangValue;
                            const displayAmount = totalWithSatang.toFixed(2);

// 🎯 1. ดึง Payload PromptPay จากเลข 15 หลัก K PLUS
const generatePayload = require('promptpay-qr');
const promptpayNumber = "004999031203416"; // 👈 เลข 15 หลัก K PLUS ของน้า
const payload = generatePayload(promptpayNumber, { amount: Number(displayAmount) });

// 🎯 2. สร้างลิงก์รูปภาพ QR Code ชัดๆ ผ่าน API ปลอดภัย
const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(payload)}`;

global.depositQueue[userId] = {
    memberId: walletData.memberNumber,
    name: walletData.name || 'ไม่ระบุชื่อ',
    rawAmount: amount,
    displayAmount: displayAmount,
    status: 'WAITING_ADMIN'
};

                            // ==================== [ 🚀 ใบแจ้งฝากสไตล์บิลธนาคาร + QR Code แบบย่อ ] ====================
try {
    // 🔍 ดึงชื่อเล่นจากข้อมูลสมาชิก (ถ้าไม่มีให้แสดงเป็นชื่อเต็ม หรือ fallback เป็น 'สมาชิก')
    const nickname = walletData.nickname || walletData.name || 'สมาชิก';
    const memberId = walletData.memberNumber || walletData.memberId || '-';
    await axios.post('https://api.line.me/v2/bot/message/reply', {
        replyToken: replyToken,
        messages: [
            {
                "type": "flex",
                "altText": `📥 ใบสั่งฝากเครดิต ยอดโอน: ${displayAmount} บาท`,
                "contents": {
                    "type": "bubble",
                    "styles": { "body": { "backgroundColor": "#09120e" } },
                    "body": {
                        "type": "box",
                        "layout": "vertical",
                        "spacing": "md",
                        "contents": [
                            { "type": "text", "text": "📥 ใบสั่งรายการฝากเงิน", "weight": "bold", "color": "#00ff88", "size": "md", "align": "center" },
                            {
                                "type": "box",
                                "layout": "horizontal",
                                "backgroundColor": "#0f1f17",
                                "paddingAll": "sm",
                                "contents": [
                                    { "type": "text", "text": `👤 คุณ: ${nickname}`, "size": "xs", "color": "#ffffff", "weight": "bold" },
                                    { "type": "text", "text": `ID: ${memberId}`, "size": "xs", "color": "#00ff88", "align": "end", "weight": "bold" }
                                ]
                            },
                            { "type": "separator", "color": "#12251c" },
                            {
                                "type": "box",
                                "layout": "vertical",
                                "spacing": "xs",
                                "contents": [
                                    { "type": "text", "text": "💸 กรุณาโอนเงินยอดสุทธิ:", "size": "xs", "color": "#8caf9c" },
                                    { "type": "text", "text": `${displayAmount} บาท`, "size": "xxl", "color": "#00ff88", "weight": "bold", "align": "center", "margin": "sm" },
                                    { "type": "text", "text": "(กรุณาโอนเศษสตางค์ให้ตรงเพื่ออัปยอดไวที่สุด)", "size": "10px", "color": "#ffaa00", "align": "center" }
                                ]
                            },
                            {
                                "type": "image",
                                "url": qrCodeUrl,
                                "size": "4xl",
                                "aspectRatio": "1:1",
                                "aspectMode": "fit",
                                "margin": "md"
                            },
                            { "type": "separator", "color": "#12251c" },
                            // เหลือไว้เฉพาะชื่อบัญชีตามที่ต้องการ
                            { 
                                "type": "text", 
                                "text": "👤 ชื่อบัญชี: นาย ภาณุวัฒก์ ก้องกุล", 
                                "size": "xs", 
                                "color": "#ffffff", 
                                "align": "center", 
                                "weight": "bold" 
                            },
                            { "type": "separator", "color": "#12251c" },
                            { "type": "text", "text": "⚠️ โอนตามยอดที่มีเศษสตางค์ แล้วส่งสลิปเพื่อยืนยันรายการได้เลยครับ", "size": "11px", "color": "#ff4444", "wrap": true, "align": "center", "weight": "bold" }
                        ]
                    }
                }
            }
        ]
    }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
} catch (err) { 
    console.error("Error sending deposit bill flex:", err.response ? err.response.data : err.message); 
}
                    }
                }
            }
               }

                // ==================== [ คำสั่งแอดมิน: ชถ (เช็กรายการรอถอนเงินทั้งหมด) ] ====================
            else if (userMsg.trim() === 'ชถ') {
               // 🚨 เปลี่ยนตรงนี้: เช็กว่า ID คนพิมพ์อยู่ในกล่องแอดมินไหม
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    if (withdrawQueue.length === 0) {
                        replyText = "🎉 [ระบบคิวถอน] ไม่มีรายการค้างถอนในขณะนี้ครับ! สบายใจได้";
                    } else {
                        let queueText = "📋 [รายการรอถอนเงินทั้งหมด] 📋\n(เรียงตามลำดับก่อน-หลัง)\n────────────────\n";
                        
                        withdrawQueue.forEach((item, index) => {
                            queueText += `${index + 1}. 👤 สมาชิกคนที่: ${item.memberNumber}\n`;
                            queueText += `   📛 ชื่อ: คุณ ${item.name}\n`;
                            queueText += `   💰 ยอดถอน: ${item.amount} บาท\n`;
                            queueText += `   🕒 เวลา: ${item.time} น.\n────────────────\n`;
                        });
                        
                        queueText += `📌 รวมทั้งหมด: ${withdrawQueue.length} รายการค้างถอน\n💡 วิธีเคลียร์คิว: พิมพ์ "y เลขสมาชิก" (เช่น: y 1 หรือโอนพร้อมกันหลายคนพิมพ์: y 1 3 5)`;
                        replyText = queueText;
                    }
                }
            }
                // ==================== [ 2. คำสั่งเปลี่ยน ขา / ใบ ] ====================
else if (/^(?:เปลี่ยน|ขา)\s*([1-6])(?:\s*(?:บ)?([2-3]))?$/i.test(userMsg)) {
    if (!ADMIN_IDS.includes(userId)) {
        replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
    } else {
        const match = userMsg.match(/^(?:เปลี่ยน|ขา)\s*([1-6])(?:\s*(?:บ)?([2-3]))?$/i);
        const targetLegs = parseInt(match[1]);
        const targetCards = match[2] ? parseInt(match[2]) : 3;

        maxLegs = targetLegs;
        cardMode = targetCards;

        await saveDataToFirebase();

        replyText = `✅ ตั้งค่าระบบเรียบร้อย:\n• จำนวนขาผู้เล่น: ${maxLegs} ขา (+เจ้ามือ 1)\n• โหมดการเล่น: ${cardMode} ใบ`;
    }
}
           // ==================== [ 2. แอดมิน เปิด/ปิดรอบแทง - เวอร์ชันป้องกันมือลั่น ] ====================
else if (userMsg === 'o' || userMsg === 'x' || userMsg === 'rst') {
    if (!ADMIN_IDS.includes(userId)) {
        replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
    } else {
        // 🖼️ [ตั้งค่าลิงก์รูปภาพของน้าที่นี่] 
        // ⚠️ น้าเอาลิงก์ URL รูปภาพเปิด/ปิดรอบของน้า (ที่ขึ้นต้นด้วย https://) มาใส่แทนที่ในเครื่องหมายคำพูดได้เลยครับ
        const openRoundImgUrl = "https://img2.pic.in.th/-__-----4b1c38e0628ea626.jpg"; 
        const closeRoundImgUrl = "https://img2.pic.in.th/-__-----2cccaadd8f93c70b.jpg";

        if (userMsg === 'o') {
            if (isRoundOpen) {
                replyText = `⚠️ ตอนนี้ระบบกำลังเปิด "รอบที่ ${currentRound}" อยู่แล้วครับ`;
            } 
            else if (isDrawOpen) { 
                replyText = `❌ ไม่สามารถเปิดรอบใหม่ได้ครับ!\nเนื่องจาก "รอบที่ ${currentRound}" ยังดำเนินรายการจั่วไพ่ไม่เสร็จสิ้น\n\n💡 หากต้องการเปิดรอบจั่ว ให้พิมพ์ oo\n💡 หากต้องการจบขั้นตอนจั่ว ให้พิมพ์ xx ก่อนครับ`;
            } else {
                currentRound++;
                isRoundOpen = true;
                isHiloRoundOpen = true; // 🎲 [จุดที่ 1] เปิดรับแทงไฮโลพร้อมป๊อกเด้ง
                roundBets = {}; // ล้างข้อมูลโพยป๊อกเด้งเก่า
                hiloUserTrackers = {}; // ล้างความจำการดักแทงสวนไฮโลของทุกคนทันทีเมื่อเปิดรอบใหม่
                hiloRoundBets = {}; // 🎲 [จุดที่ 1] ล้างข้อมูลโพยไฮโลเก่า
                await saveDataToFirebase();
                
                // 📊 --- [สร้างตารางสถิติแบบย่อยบรรทัด อ่านง่ายไม่ล้นจอ] ---
        let historyFlexContents = [];

        // ฟังก์ชันคำนวณสีพื้นหลังกรอบ
        const getBgColor = (playerCard, dealerCard) => {
            if (!playerCard || !dealerCard) return "#424242"; 
            let pScore = playerCard.score;
            let dScore = dealerCard.score;

            if (pScore > dScore) return "#2ebd6e"; // ชนะ = เขียว
            if (pScore < dScore) return "#d32f2f"; // แพ้ = แดง
            return "#f57f17"; // เสมอ = เหลือง
        };

        if (matchHistory && matchHistory.length > 0) {
            const historyCopy = [...matchHistory];
            
            historyCopy.forEach(item => {
                if (typeof item === 'object' && item.legs) {
                    
                    // --- 1. แถวบน: รอบ + เจ้ามือ + ขา 1, 2, 3 ---
                    let row1Contents = [
                        { "type": "text", "text": `#${item.round}`, "size": "xxs", "color": "#ffcc00", "weight": "bold", "flex": 2, "align": "center", "gravity": "center" },
                        { 
                            "type": "box", "layout": "vertical", "flex": 3, "backgroundColor": "#0288d1", "cornerRadius": "sm", "paddingAll": "xs",
                            "contents": [{ "type": "text", "text": `${item.dealer}`, "size": "xxs", "color": "#ffffff", "weight": "bold", "align": "center" }] 
                        }
                    ];

                    for (let l = 1; l <= 3; l++) {
                        const legData = (l <= maxLegs) ? (item.legs[l] || { display2: '-', display3: '-' }) : null;
                        
                        // 📌 ใส่เส้นแบ่งเฉพาะกรณีที่ไม่ใช่คอลัมน์แรก
                        if (l > 1) {
                            row1Contents.push({ "type": "separator", "color": "#80deea" });
                        }

                        if (legData) {
                            const bg2 = getBgColor(legData.two, item.dealerObj);
                            const bg3 = getBgColor(legData.three, item.dealerObj);
                            
                            // 📌 1. สร้างบล็อกของใบที่ 1-2 ไว้เสมอ
                            let legBoxContents = [
                                {
                                    "type": "box", "layout": "vertical", "flex": 1, "backgroundColor": bg2, "cornerRadius": "xs", "paddingAll": "xs",
                                    "contents": [{ "type": "text", "text": `${legData.display2}`, "size": "xxs", "color": "#ffffff", "align": "center", "weight": "bold" }]
                                }
                            ];

                            // 📌 2. ถ้าเป็นโหมด 3 ใบ ค่อยดันบล็อกใบที่ 3 เพิ่มเข้าไป
                            if (cardMode === 3) {
                                legBoxContents.push({
                                    "type": "box", "layout": "vertical", "flex": 1, "backgroundColor": bg3, "cornerRadius": "xs", "paddingAll": "xs",
                                    "contents": [{ "type": "text", "text": `${legData.display3}`, "size": "xxs", "color": "#ffffff", "align": "center", "weight": "bold" }]
                                });
                            }

                            row1Contents.push({
                                "type": "box", "layout": "horizontal", "flex": 4, "spacing": "xs",
                                "contents": legBoxContents
                            });
                        } else {
                            // ช่องว่างดันทรงสัดส่วน (Spacer)
                            row1Contents.push({ "type": "box", "layout": "vertical", "flex": 4, "contents": [{ "type": "text", "text": " ", "size": "xxs" }] });
                        }
                    }

                    historyFlexContents.push({
                        "type": "box", "layout": "horizontal", "spacing": "xs", "margin": "xs", "contents": row1Contents
                    });

                    // --- 2. แถวล่าง: ขา 4 ถึง 6 (แสดงเฉพาะเมื่อ maxLegs > 3) ---
                    if (maxLegs > 3) {
                        let row2Contents = [
                            { "type": "box", "layout": "vertical", "flex": 2, "contents": [{ "type": "text", "text": " ", "size": "xxs" }] },
                            { "type": "box", "layout": "vertical", "flex": 3, "contents": [{ "type": "text", "text": " ", "size": "xxs" }] }
                        ];

                        for (let l = 4; l <= 6; l++) {
                            const legData = (l <= maxLegs) ? (item.legs[l] || { display2: '-', display3: '-' }) : null;

                            // 📌 ปรับแก้ไข: ใส่เส้นแบ่งเฉพาะเมื่อมีปุ่มสถิติจริงทั้งช่องก่อนหน้าและช่องนี้
                            if (l > 4 && l <= maxLegs) {
                                row2Contents.push({ "type": "separator", "color": "#80deea" });
                            } else if (l > 4) {
                                // ถ้าเป็นช่องว่าง Spacer ให้ใส่กล่องใสไร้เส้นแทนเพื่อรักษาความกว้างเท่ากับ separator
                                row2Contents.push({ "type": "box", "layout": "vertical", "width": "1px", "contents": [{ "type": "text", "text": " ", "size": "xxs" }] });
                            }

                           if (legData) {
                                const bg2 = getBgColor(legData.two, item.dealerObj);
                                const bg3 = getBgColor(legData.three, item.dealerObj);

                                // 📌 สร้างบล็อกใบที่ 1-2 ไว้ก่อน
                                let legBoxContents = [
                                    {
                                        "type": "box", "layout": "vertical", "flex": 1, "backgroundColor": bg2, "cornerRadius": "xs", "paddingAll": "xs",
                                        "contents": [{ "type": "text", "text": `${legData.display2}`, "size": "xxs", "color": "#ffffff", "align": "center", "weight": "bold" }]
                                    }
                                ];

                                // 📌 ถ้าเป็นโหมด 3 ใบ ค่อยดันบล็อกใบที่ 3 เพิ่มเข้ามา
                                if (cardMode === 3) {
                                    legBoxContents.push({
                                        "type": "box", "layout": "vertical", "flex": 1, "backgroundColor": bg3, "cornerRadius": "xs", "paddingAll": "xs",
                                        "contents": [{ "type": "text", "text": `${legData.display3}`, "size": "xxs", "color": "#ffffff", "align": "center", "weight": "bold" }]
                                });
                                }

                                row2Contents.push({
                                    "type": "box", "layout": "horizontal", "flex": 4, "spacing": "xs",
                                    "contents": legBoxContents
                                });
                            } else {
                                // 📌 ช่องว่าง Spacer ดันตำแหน่งให้อยู่ตรงกับขา 1 ด้านบนพอดี
                                row2Contents.push({ "type": "box", "layout": "vertical", "flex": 4, "contents": [{ "type": "text", "text": " ", "size": "xxs" }] });
                            }
                        }

                        historyFlexContents.push({
                            "type": "box", "layout": "horizontal", "spacing": "xs", "margin": "xs", "contents": row2Contents
                        });
                    }

                    // --- 3. บรรทัดสรุปผลไฮโล (จัด UI ใหม่เข้าเซ็ตกับตาราง) ---
                    const hiloDisplay = (item && item.hilo && item.hilo !== '-') ? item.hilo : null;

                    if (hiloDisplay) {
                        // แยกข้อความ เช่น "4-2-3 (9แต้ม) ต่ำ" ออกเป็นชิ้นๆ
                        const parts = hiloDisplay.split(" ");
                        const diceText = parts[0] || "-";
                        const scoreText = (parts[1] || "").replace(/[\(\)]/g, '');
                        let resultText = parts[2] || "";

                        // เลือกสีเน้นผลลัพธ์: สูง = แดง, ต่ำ = ฟ้า/น้ำเงิน, 11ไฮโล = ทอง
                        let resultBgColor = "#0288d1"; 
                        if (resultText.includes("ตอง")) {
                            resultBgColor = "#9c27b0"; // สีม่วง
                            resultText = "ตอง";
                        } else if (resultText.includes("11") || resultText.includes("ไฮโล")) {
                            resultBgColor = "#ffb74d"; // สีส้ม/ทอง
                            resultText = "ไฮโล"; // 👈 เปลี่ยนเป็น "11ไฮโล" (หรือเปลี่ยนเป็น "ไฮโล" ตามที่ชอบได้เลยครับ)
                        } else if (resultText.includes("สูง")) {
                            resultBgColor = "#d32f2f"; // สีแดง
                            resultText = "สูง";
                        } else if (resultText.includes("ต่ำ")) {
                            resultBgColor = "#0288d1"; // สีฟ้า
                            resultText = "ต่ำ";
                        }
                        // 📌 เส้นแบ่งแนวนอน คั่นระหว่างไพ่ป๊อกเด้ง กับ แถวไฮโล
                        historyFlexContents.push({ 
                            "type": "separator", 
                            "color": "#e8eaf6", 
                            "margin": "sm" 
                        });

                        historyFlexContents.push({
                            "type": "box",
                            "layout": "horizontal",
                            "margin": "xs",
                            "spacing": "xs",
                            "contents": [
                                // ช่อง 1: หัวข้อ ไฮโล
                                {
                                    "type": "box", "layout": "vertical", "flex": 3, "backgroundColor": "#2a1b38", "cornerRadius": "xs", "paddingAll": "xs",
                                    "contents": [{ "type": "text", "text": "🎲 ไฮโล", "size": "xxs", "color": "#ffcc00", "weight": "bold", "align": "center" }]
                                },
                                // ช่อง 2: หน้าเต๋า
                                {
                                    "type": "box", "layout": "vertical", "flex": 5, "backgroundColor": "#ba68c8", "cornerRadius": "xs", "paddingAll": "xs",
                                    "contents": [{ "type": "text", "text": diceText, "size": "xxs", "color": "#ffffff", "weight": "bold", "align": "center" }]
                                },
                                // ช่อง 3: รวมแต้ม
                                {
                                    "type": "box", "layout": "vertical", "flex": 4, "backgroundColor": "#9575cd", "cornerRadius": "xs", "paddingAll": "xs",
                                    "contents": [{ "type": "text", "text": scoreText, "size": "xxs", "color": "#ffcc00", "weight": "bold", "align": "center" }]
                                },
                                // ช่อง 4: ผล สูง/ต่ำ
                                {
                                    "type": "box", "layout": "vertical", "flex": 3, "backgroundColor": resultBgColor, "cornerRadius": "xs", "paddingAll": "xs",
                                    "contents": [{ "type": "text", "text": resultText || "ผล", "size": "xxs", "color": "#ffffff", "weight": "bold", "align": "center" }]
                                }
                            ]
                        });
                    }

                    historyFlexContents.push({ "type": "separator", "color": "#F2E9D3", "margin": "sm" });

                } else {
                    historyFlexContents.push({
                        "type": "text", "text": String(item), "size": "xxs", "color": "#E2E1E4", "wrap": true
                    });
                }
            });
        } else {
            historyFlexContents.push({
                "type": "text", "text": "• ยังไม่มีข้อมูลสถิติย้อนหลัง", "size": "xs", "color": "#E2E1E4", "style": "italic", "align": "center"
            });
        }

        // 🚀 ยิงข้อความเปิดรอบ
        try {
            await axios.post('https://api.line.me/v2/bot/message/reply', {
                replyToken: replyToken,
                messages: [
                    {
                        "type": "image",
                        "originalContentUrl": openRoundImgUrl,
                        "previewImageUrl": openRoundImgUrl
                    },
                    {
                        "type": "flex",
                        "altText": `🟢 เริ่มเปิดรอบแทงแล้ว! รอบที่ ${currentRound}`,
                        "contents": {
                            "type": "bubble",
                            "styles": { "body": { "backgroundColor": "#130f17" } },
                            "body": {
                                "type": "box", "layout": "vertical", "spacing": "md",
                                "contents": [
                                    { "type": "text", "text": "🎰 เริ่มเปิดรอบแทงแล้วครับ 🎉", "weight": "bold", "color": "#00ff66", "size": "md", "align": "center" },
                                    { "type": "text", "text": `รอบที่: ${currentRound}`, "weight": "bold", "color": "#ffffff", "size": "xl", "align": "center", "margin": "none" },
                                    { "type": "separator", "color": "#F2E9D3" },
                                    { "type": "text", "text": "📊 สถิติผลการเล่น 5 รอบล่าสุด", "size": "xs", "color": "#ffcc00", "weight": "bold" },
                                    
                                    // หัวตารางแบบชัดเจน (ขา 1/4 | ขา 2/5 | ขา 3/6)
                                    {
                                        "type": "box", "layout": "horizontal", "backgroundColor": "#2a1b38", "paddingAll": "xs", "cornerRadius": "xs", "spacing": "sm",
                                        "contents": [
                                            { "type": "text", "text": "รอบ", "size": "xxs", "color": "#aaaaaa", "flex": 2, "align": "center", "weight": "bold" },
                                            { "type": "text", "text": "เจ้า", "size": "xxs", "color": "#0288d1", "flex": 3, "align": "center", "weight": "bold" },
                                            { "type": "text", "text": "ขา 1/4", "size": "xxs", "color": "#ffffff", "flex": 4, "align": "center", "weight": "bold" },
                                            { "type": "text", "text": "ขา 2/5", "size": "xxs", "color": "#ffffff", "flex": 4, "align": "center", "weight": "bold" },
                                            { "type": "text", "text": "ขา 3/6", "size": "xxs", "color": "#ffffff", "flex": 4, "align": "center", "weight": "bold" }
                                        ]
                                    },

                                    { 
                                        "type": "box", "layout": "vertical", "spacing": "xs", "contents": historyFlexContents 
                                    },
                                    
                                    { "type": "separator", "color": "#F2E9D3" },
                                    { "type": "text", "text": "✨ สมาชิกสามารถส่งโพยเข้ามาได้เลยครับ 🎰", "size": "sm", "color": "#ffffff", "wrap": true, "align": "center", "weight": "bold" }
                                ]
                            }
                        }
                    }
                ]
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TOKEN}`
                }
            });
        } catch (error) {
            console.error("❌ ส่งรูปภาพและ Flex เปิดรอบล้มเหลว:", error.response ? error.response.data : error.message);
        }
        return; 
    }
} else if (userMsg === 'x') {
            if (!isRoundOpen) {
                replyText = `⚠️ ระบบปิดรอบแทงอยู่แล้วครับ ไม่สามารถปิดซ้ำได้`;
            } else {
                isRoundOpen = false;
                isHiloRoundOpen = false; // 🎲 [จุดที่ 2] ปิดรับแทงไฮโลทันที
                await saveDataToFirebase();
                
                // --- 📊 [สรุปยอดแทงรายบุคคลเพื่อใส่ใน Flex] ---
                let summaryFlexContents = [];
                let hasAnyBet = false;

                // 💡 ฟังก์ชันช่วยแปลง betType ให้กลายเป็นข้อความอ่านง่าย
                const formatLegDisplay = (bet) => {
                    if (!bet || !bet.betType) return "ไม่ระบุขา";
                    const type = bet.betType;
                    const price = bet.pricePerLeg || 0;

                    if (type === "รข") return `เหมาขา (${price})`;
                    if (type === "รจ") return `เหมาเจ้า (${price})`;
                    if (type.startsWith('จ')) {
                        const legs = type.substring(1).split('').join(', ');
                        return `แทงเจ้าสู้ขา ${legs} (${price}/ขา)`;
                    }
                    // กรณีแทงขาผู้เล่นปกติ เช่น "12" -> "ขา 1, 2 (20/ขา)"
                    const legs = type.split('').join(', ');
                    return `ขา ${legs} (${price}/ขา)`;
                };
                // 🎲 [จุดที่ 2] รวม UID ผู้เล่นจากทั้งป๊อกเด้งและไฮโล
                const allUserIds = Array.from(new Set([
                    ...Object.keys(roundBets || {}),
                    ...Object.keys(hiloRoundBets || {})
                ]));

                for (let uId of allUserIds) {
                    const userBetsArray = (roundBets && roundBets[uId]) ? roundBets[uId] : [];
                    const userHiloArray = (hiloRoundBets && hiloRoundBets[uId]) ? hiloRoundBets[uId] : [];
                    if (userBetsArray.length === 0 && userHiloArray.length === 0) continue;

                    hasAnyBet = true;
                    const user = usersWallets[uId] || {};    
                    const displayName = user.nickname || user.name || "สมาชิก";
                    
                    let userTotalBetAmt = 0;
                    let legsList = [];
                    userBetsArray.forEach((b) => {
                        // สะสมยอดค้ำ/ยอดแทงจริง
                        if (b.actualBet) {
                            userTotalBetAmt += b.actualBet;
                        }

                        // 🛠️ แก้ไขจุดนี้: ดึงขาที่แทงจาก b.betType ผ่านฟังก์ชันจัดรูปแบบ
                        const legDisplay = formatLegDisplay(b);
                        legsList.push(legDisplay);
                    });

                    // ถ้าไม่มีโพยป๊อกเด้ง ให้ขึ้นว่า "ไม่ได้แทง"
                    const legTextDisplay = legsList.length > 0 ? legsList.join(', ') : 'ไม่ได้แทง';
                
                    // 3. คำนวณฝั่ง "ไฮโล"
                    let totalHiloAmt = userHiloArray.reduce((sum, hb) => sum + (hb.totalPrice || hb.actualBet || hb.price || 0), 0);
                    const hiloTextDisplay = formatGroupedHiloBets(userHiloArray);

                   // 3. สร้าง UI Box แสดงผล (บรรทัดแรก: เลขสมาชิก + ชื่อเล่น + ยอดรวม, บรรทัดสอง: ขาที่ลง)
                    summaryFlexContents.push({
                        "type": "box",
                        "layout": "vertical",
                        "margin": "md",
                        "contents": [
                            {
                                "type": "box",
                                "layout": "horizontal",
                                "contents": [
                                    { 
                                        "type": "text", 
                                        "text": `• [ ${user.memberNumber || '-'} ] ${displayName}`, 
                                        "size": "sm", 
                                        "color": "#ffffff", 
                                        "weight": "bold",
                                        "flex": 5, 
                                        "wrap": true 
                                    },
                                    { 
                                        "type": "text", 
                                        "text": `${userTotalBetAmt + totalHiloAmt} ฿`, 
                                        "size": "sm", 
                                        "color": "#ffaa00", 
                                        "align": "end", 
                                        "weight": "bold", 
                                        "flex": 3 
                                    }
                                ]
                            },
                            {
                                "type": "text",
                                "text": `   🎯 ขาที่ลง: ${legTextDisplay}`,
                                "size": "xs",
                                "color": "#aaaaaa",
                                "wrap": true,
                                "margin": "xs"
                            },
                            
                            //แบ่งเส้น
                            { "type": "separator", "color": "#33281a", "margin": "xs" },
                            
                            {
                                "type": "text",
                                "text": `   🎲 ไฮโล: ${hiloTextDisplay}`,
                                "size": "xs",
                                "color": "#ffcc00",
                                "wrap": true,
                                "margin": "none"
                            }
                        ]
                    });
                }

                if (!hasAnyBet) {
                    summaryFlexContents.push({
                        "type": "text",
                        "text": "• ไม่มีสมาชิกส่งโพยเดิมพันในรอบนี้",
                        "size": "sm",
                        "color": "#888888",
                        "style": "italic",
                        "align": "center"
                    });
                }

                // 🚀 ยิงข้อความแพ็คคู่: [1. รูปภาพปิดรอบ] + [2. Flex Message สไลด์ carousel รายชื่อ]
                try {
                    // 1. ฟังก์ชันช่วยเหลือสำหรับตัดแบ่ง array ออกเป็นหน้าๆ (Chunking)
                    const chunkSize = 4; // ปรับเหลือ 4 รายชื่อต่อหน้า เพื่อรองรับบรรทัดแสดงขาแทงไม่ให้ล้นการ์ด
                    const flexPages = [];
                    for (let i = 0; i < summaryFlexContents.length; i += chunkSize) {
                        flexPages.push(summaryFlexContents.slice(i, i + chunkSize));
                    }

                    // 2. ถ้าไม่มีคนแทงเลย ให้สร้างการ์ดเปล่าป้องกันโค้ดรวน
                    if (flexPages.length === 0) {
                        flexPages.push([{ "type": "text", "text": "ไม่มีรายการแทงในรอบนี้", "color": "#aaaaaa", "size": "xs", "align": "center" }]);
                    }

                    // 3. วนลูปสร้างการ์ด Bubble แต่ละหน้าสำหรับ Carousel
                    const carouselBubbles = flexPages.map((pageContents, index) => ({
                        "type": "bubble",
                        "styles": { "body": { "backgroundColor": "#1A1A1A" } },
                        "body": {
                            "type": "box", "layout": "vertical", "spacing": "md",
                            "contents": [
                                { "type": "text", "text": "🚫 ปิดรอบแทงเรียบร้อยแล้วครับ 🏁", "weight": "bold", "color": "#E9100F", "size": "md", "align": "center" },
                                { "type": "text", "text": `จบรอบที่: ${currentRound} (หน้า ${index + 1}/${flexPages.length})`, "weight": "bold", "color": "#ffffff", "size": "sm", "align": "center" },
                                { "type": "separator", "color": "#3a2222" },
                                { "type": "text", "text": "📝 สรุปยอดแทงประจำรอบ", "size": "xs", "color": "#FFCE00", "weight": "bold" },
                                { "type": "box", "layout": "vertical", "spacing": "xs", "contents": pageContents },
                                { "type": "separator", "color": "#3a2222" },
                                { "type": "text", "text": "🔒 หยุดรับโพยทุกกรณี รอแอดมินเปิดรอบจั่ว", "size": "sm", "color": "#E9100F", "wrap": true, "align": "center", "weight": "bold" }
                            ]
                        }
                    }));

                    // 4. ส่ง API ไปยัง LINE
                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                        replyToken: replyToken,
                        messages: [
                            {
                                "type": "image",
                                "originalContentUrl": closeRoundImgUrl,
                                "previewImageUrl": closeRoundImgUrl
                            },
                            {
                                "type": "flex",
                                "altText": `🚫 ปิดรอบแทงเรียบร้อย รอบที่ ${currentRound}`,
                                "contents": {
                                    "type": "carousel",
                                    "contents": carouselBubbles
                                }
                            }
                        ]
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TOKEN}`
                        }
                    });
                } catch (error) {
                    console.error("❌ ส่งรูปภาพและ Flex ปิดรอบล้มเหลว:", error.response ? error.response.data : error.message);
                }
                return;
            }
        } else if (userMsg === 'rst') {
            currentRound = 0;
            isRoundOpen = false;
            isDrawOpen = false; // ล้างสถานะจั่วไปด้วยเลยตอนเซ็ตศูนย์
            isHiloRoundOpen = false; // 🎲 [จุดที่ 3] ล้างสถานะไฮโล
            roundBets = {};
            hiloRoundBets = {}; // 🎲 [จุดที่ 3] ล้างโพยไฮโลทั้งหมด
            usersRoundCrossCheck = {};
            matchHistory = []; // รีเซ็ตประวัติ 5 รอบย้อนหลังออกไปด้วย
            pastRoundsData = {};

            await saveDataToFirebase(); //💾เซฟถาวร
            
            replyText = "🔄 ทำการล้างลำดับรอบเรียบร้อยแล้ว! รอบต่อไปจะเริ่มต้นที่ รอบที่ 1 ครับ ⚙️";
        }
    }
}
            // ==================== [ 3. แอดมิน เปิด/ปิดรอบจั่วไพ่ - เวอร์ชันบล็อกพิมพ์ซ้ำ ] ====================
else if (userMsg === 'oo' || userMsg === 'xx') {
    if (!ADMIN_IDS.includes(userId)) {
        replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
    } else {
        // 🖼️ [ตั้งค่าลิงก์รูปภาพของน้าที่นี่]
        // ⚠️ น้าเอาลิงก์ URL รูปภาพเปิดจั่ว/ปิดจั่วของน้า (ที่ขึ้นต้นด้วย https://) มาใส่แทนที่ได้เลยครับ
        const openDrawImgUrl = "https://img2.pic.in.th/-__-----7fcbb7b1eadadfe1.jpg";
        const closeDrawImgUrl = "https://img2.pic.in.th/-__-----17ded3ef1c297156";

        // 🟢 [ฝั่งเปิดรอบจั่ว oo]
        if (userMsg === 'oo') {
            if (isRoundOpen) {
                replyText = "⚠️ ต้องพิมพ์ปิดรอบแทง (X) ก่อน จึงจะเปิดรอบจั่วได้ครับ";
            } else if (isDrawOpen) {
                replyText = `⚠️ ตอนนี้ระบบกำลังเปิด "รอบขอจั่วไพ่ใบที่ 3" อยู่แล้วครับ ไม่จำเป็นต้องเปิดซ้ำครับ`;
            } else {
                isDrawOpen = true; // เปิดสิทธิ์ให้บอทรับคำสั่งเครื่องหมาย + จากสมาชิก

                // 🚀 ยิงข้อความแพ็คคู่: [1. รูปภาพเปิดจั่วของน้า] + [2. Flex Message เปิดจั่วอย่างเป็นทางการ]
                try {
                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                        replyToken: replyToken,
                        messages: [
                            // 📸 ข้อความที่ 1: รูปเปิดจั่วของน้า
                            {
                                "type": "image",
                                "originalContentUrl": openDrawImgUrl,
                                "previewImageUrl": openDrawImgUrl
                            },
                            // 📊 ข้อความที่ 2: Flex Message เปิดจั่ว
                            {
                                "type": "flex",
                                "altText": `🃏 เปิดรอบขอจั่วไพ่ใบที่ 3 (รอบที่ ${currentRound})`,
                                "contents": {
                                    "type": "bubble",
                                    "styles": { "body": { "backgroundColor": "#0b1528" } }, // ธีมน้ำเงินเข้มคาสิโน
                                    "body": {
                                        "type": "box", "layout": "vertical", "spacing": "md",
                                        "contents": [
                                            { "type": "text", "text": "🃏 เปิดรอบขอจั่วไพ่ใบที่ 3 แล้วครับ 🎉", "weight": "bold", "color": "#3399ff", "size": "md", "align": "center" },
                                            { "type": "text", "text": `รอบที่: ${currentRound}`, "weight": "bold", "color": "#ffffff", "size": "lg", "align": "center", "margin": "none" },
                                            { "type": "separator", "color": "#1b2a47" },
                                            { "type": "text", "text": "💡 สำหรับสมาชิกที่ต้องการจั่วไพ่เพิ่ม\nให้พิมพ์เลขขาตามด้วยเครื่องหมายบวก (+)\nเช่น พิมพ์ \"1+\" หรือ \"12+\"", "size": "sm", "color": "#dddddd", "wrap": true, "align": "center" },
                                            { "type": "separator", "color": "#1b2a47" },
                                            { "type": "text", "text": "⚠️ หากขาไหนต้องการอยู่ (ไม่จั่ว) ไม่ต้องพิมพ์อะไรส่งมาครับ", "size": "xs", "color": "#ffcc00", "wrap": true, "align": "center" }
                                        ]
                                    }
                                }
                            }
                        ]
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TOKEN}`
                        }
                    });
                } catch (error) {
                    console.error("❌ ส่งรูปภาพและ Flex เปิดจั่วล้มเหลว:", error.response ? error.response.data : error.message);
                }
                return; // จบกระบวนการเปิดจั่วอย่างสมบูรณ์ บอทไม่ทำงานซ้ำซ้อน
            }
        } 
        // 🔴 [ฝั่งปิดรอบจั่ว xx + สรุปรายละเอียดรายบุคคล]
        else if (userMsg === 'xx') {
            if (!isDrawOpen) {
                replyText = "⚠️ ระบบปิดรอบจั่วไพ่อยู่แล้วครับ ไม่สามารถปิดซ้ำได้";
            } else {
                // 1. ปิดระบบรับรอบจั่วทันที
                isDrawOpen = false;

                // 2. ดำเนินการวนลูปดึงข้อมูลจากโค้ดหลักของน้าแบบไม่มีตกหล่น
                let summaryFlexContents = [];
                let hasBets = false;

                // 🎲 [จุดที่แก้] ดึง UID ผู้เล่นจากทั้งป๊อกเด้งและไฮโลมารวมกัน
                const allUserIds = Array.from(new Set([
                    ...Object.keys(roundBets || {}),
                    ...Object.keys(hiloRoundBets || {})
                ]));

                // วนลูปเช็กข้อมูลโพยของทุกคนในรอบนี้ (ตามตรรกะเดิมเป๊ะๆ)
                for (let uid of allUserIds) {
                    const userBetsArray = (roundBets && roundBets[uid]) ? roundBets[uid] : [];
                    const userHiloArray = (hiloRoundBets && hiloRoundBets[uid]) ? hiloRoundBets[uid] : [];
                    
                    if (userBetsArray.length === 0 && userHiloArray.length === 0) continue;
                        hasBets = true;
                        const user = (usersWallets && usersWallets[uid]) ? usersWallets[uid] : {}; // ดึงข้อมูลโปรไฟล์สมาชิก
                        // 💡 ดึงชื่อเล่น (ถ้าน้าไม่ได้ตั้ง nickname ไว้ ระบบจะถอยไปใช้ user.name อัตโนมัติ)
                        const displayName = user.nickname || user.name || "สมาชิก";

                        let totalRealPlay = 0; // ยอดเล่นรวมจริง
                        let totalWithBounce = 0; // ยอดค้ำประกัน (รวมค้ำเด้ง 3 เท่า)
                        let betLegsDetail = []; // เก็บรายละเอียดเบอร์ขาที่แทง
                        let drawLegsDetail = []; // เก็บรายละเอียดขาที่ขอจั่วเพิ่ม
                        // คำนวณเบอร์ขาฝั่งผู้เล่นปกติ
                        userBetsArray.forEach((bet) => {
                            if (bet.betType !== "รข" && bet.betType !== "รจ" && !bet.betType.startsWith('จ')) {
                                const individualLegs = bet.betType.split('');
                                individualLegs.forEach((leg) => {
                                    if (!betLegsDetail.includes(leg)) betLegsDetail.push(leg);
                                    
                                    // เช็กสถานะการจั่วใบที่ 3 ของขานี้
                                    if (bet.drawStatus && bet.drawStatus[leg] === "จั่ว") {
                                        if (!drawLegsDetail.includes(leg)) drawLegsDetail.push(leg);
                                    }
                                });
                            } 
                            // สำหรับกรณีแทงพิเศษอื่นๆ (รข / รจ / ขาเจ้ามือ)
                            else {
                                if (!betLegsDetail.includes(bet.betType)) {
                                    betLegsDetail.push(bet.betType);
                                }
                            }

                            // คำนวณยอดเงินรวม
                            totalRealPlay += bet.totalPrice || bet.actualBet; // รองรับโครงสร้างชื่อตัวแปรของโพย
                            totalWithBounce += bet.holdCost || bet.totalPrice || (bet.actualBet ? bet.actualBet * 3 : 0); // ดึงยอดค้ำเด้ง 3 เท่าที่ระบบหักไว้จริงมาแสดง
                        });
                    
                        // --- คำนวณฝั่งไฮโล ---
                        let totalHiloAmt = userHiloArray.reduce((sum, hb) => sum + (hb.totalPrice || hb.actualBet || hb.price || 0), 0);
                        const hiloTextDisplay = formatGroupedHiloBets(userHiloArray);

                        // 💡 คำนวณรวมทั้งหมด (เล่นป๊อก + เล่นไฮโล + ค้ำป๊อก)
                        const totalAllWithHold = totalWithBounce + totalHiloAmt;

                        // จัดเรียงรายชื่อขาให้สวยงามเพื่ออ่านง่าย
                        const legsStr = betLegsDetail.length > 0 ? betLegsDetail.sort().join(', ') : "ไม่ได้แทง";
                        const drawStr = drawLegsDetail.length > 0 ? drawLegsDetail.sort().join(', ') : (userBetsArray.length > 0 ? "ไม่มี (อยู่ 2 ใบ)" : "-");
                    
                        // นำข้อมูลที่ประมวลผลได้มาแพ็คใส่รูปแบบ Flex Layout เพื่อความสวยงามและแสดงผลเป็นระเบียบ
                        summaryFlexContents.push({
                            "type": "box", "layout": "vertical", "margin": "md", "spacing": "xs",
                            "contents": [
                                { "type": "text", "text": `👤 [ ${user.memberNumber || '-'} ] ${displayName}`, "weight": "bold", "color": "#ffffff", "size": "sm" },
                                {
                                    "type": "box", "layout": "horizontal",
                                    "contents": [
                                        { "type": "text", "text": `👉 แทงขา: [ ${legsStr} ]`, "size": "xs", "color": "#cccccc", "flex": 5 },
                                        { "type": "text", "text": `🃏 จั่วเพิ่ม: [ ${drawStr} ]`, "size": "xs", "color": "#3399ff", "flex": 5, "weight": "bold", "align": "end" }
                                    ]
                                },
                                
                                //แบ่งเส้น
                                { "type": "separator", "color": "#33281a", "margin": "xs" },
                                
                                {
                                    "type": "box", "layout": "horizontal",
                                    "contents": [
                                        { "type": "text", "text": `🎲 ไฮโล: ${hiloTextDisplay}`, "size": "xs", "color": "#ffcc00", "flex": 1, "wrap": true }
                                    ]
                                },
                                
                                //แบ่งเส้น
                                { "type": "separator", "color": "#33281a", "margin": "xs" },
                                
                                {
                                "type": "box", "layout": "horizontal", "margin": "xs",
                                "contents": [
                                    { 
                                        "type": "text", 
                                        "text": `💰 ยอดเล่น: [Hi ${totalHiloAmt}][Pok ${totalRealPlay}]`, 
                                        "size": "xs", 
                                        "color": "#cccccc", 
                                        "flex": 6 
                                    },
                                    { 
                                        "type": "text", 
                                        "text": `(รวม+ค้ำ: ${totalAllWithHold} ฿)`, 
                                        "size": "xs", 
                                        "color": "#00ff66", 
                                        "weight": "bold", 
                                        "flex": 4, 
                                        "align": "end" 
                                    }
                                ]
                            },
                            { "type": "separator", "color": "#2c2214", "margin": "xs" }
                        ]
                    });
                }

                if (!hasBets) {
                    summaryFlexContents.push({
                        "type": "text",
                        "text": "• รอบนี้ไม่มีสมาชิกส่งโพยเดิมพันเข้ามาครับ",
                        "size": "sm",
                        "color": "#888888",
                        "style": "italic",
                        "align": "center"
                    });
                }

                // 🚀 ยิงข้อความตอบกลับ
                try {
                    const chunkSize = 4;
                    const flexPages = [];
                    for (let i = 0; i < summaryFlexContents.length; i += chunkSize) {
                        flexPages.push(summaryFlexContents.slice(i, i + chunkSize));
                    }

                    if (flexPages.length === 0) {
                        flexPages.push([{ "type": "text", "text": "ไม่มีรายการแทงในรอบนี้", "color": "#aaaaaa", "size": "xs", "align": "center" }]);
                    }

                    const carouselBubbles = flexPages.map((pageContents, index) => ({
                        "type": "bubble",
                        "styles": { "body": { "backgroundColor": "#1a140d" } },
                        "body": {
                            "type": "box", "layout": "vertical", "spacing": "sm",
                            "contents": [
                                { "type": "text", "text": "🔒 ปิดรอบขอจั่วไพ่เรียบร้อยแล้วครับ 🏁", "weight": "bold", "color": "#ffaa00", "size": "md", "align": "center" },
                                { "type": "text", "text": `รอบที่: ${currentRound} (หน้า ${index + 1}/${flexPages.length})`, "size": "xs", "color": "#ffffff", "align": "center" },
                                { "type": "separator", "color": "#3a2d1f" },
                                { "type": "text", "text": "📋 รายงานสรุปโพยป๊อกเด้ง + ไฮโล บุคคล", "size": "xs", "color": "#ffaa00", "weight": "bold" },
                                { "type": "box", "layout": "vertical", "spacing": "xs", "contents": pageContents },
                                { "type": "text", "text": "ℹ️ รอสรุปผลและคิดเงินสักครู่ครับ", "size": "xs", "color": "#aaaaaa", "align": "center", "margin": "sm" }
                            ]
                        }
                    }));

                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                        replyToken: replyToken,
                        messages: [
                            {
                                "type": "image",
                                "originalContentUrl": closeDrawImgUrl,
                                "previewImageUrl": closeDrawImgUrl
                            },
                            {
                                "type": "flex",
                                "altText": `🚫 ปิดรอบขอจั่วไพ่เรียบร้อยแล้ว (รอบที่ ${currentRound})`,
                                "contents": {
                                    "type": "carousel",
                                    "contents": carouselBubbles
                                }
                            }
                        ]
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TOKEN}`
                        }
                    });
                } catch (error) {
                    console.error("❌ ส่งรูปภาพและ Flex ปิดจั่วล้มเหลว:", error.response ? JSON.stringify(error.response.data) : error.message);
                }
                return;
            }
        }
    }
}
   // ==================== [ 1. คำสั่งแอดมิน: เพิ่มโปรโมชั่น ] ====================
else if (userMsg.startsWith("+")) {
    if (!ADMIN_IDS.includes(userId)) {
        replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
    } else {
        // ใช้ข้อความดั้งเดิมเพื่อป้องกันปัญหารูปแบบอักขระ
        const rawText = (typeof originalMsg !== 'undefined' && originalMsg) ? originalMsg.trim() : userMsg.trim();
        
        // แยกข้อความด้วยช่องว่าง
        const parts = rawText.split(/\s+/).filter(p => p !== "");

        let promoCode = "";
        let rawBonus = "";
        let rawTurnover = "";
        let rawMaxBonus = "";

        // กรณีที่ 1: พิมพ์แบบเว้นวรรค เช่น "+ รับ1 20ป 2ท" (parts จะมี 4 ชิ้น: ["+", "รับ1", "20ป", "2ท"])
        if (parts[0] === "+" && parts.length >= 4) {
            promoCode = parts[1];
            rawBonus = parts[2];
            rawTurnover = parts[3];
            if (parts[4]) rawMaxBonus = parts[4];
        } 
        // กรณีที่ 2: พิมพ์ติดกัน เช่น "+รับ1 20ป 2ท" (parts จะมี 3 ชิ้น: ["+รับ1", "20ป", "2ท"])
        else if (parts[0].startsWith("+") && parts[0].length > 1 && parts.length >= 3) {
            promoCode = parts[0].substring(1);
            rawBonus = parts[1];
            rawTurnover = parts[2];
            if (parts[3]) rawMaxBonus = parts[3];
        }

        if (!promoCode || !rawBonus || !rawTurnover) {
            replyText = "⚠️ รูปแบบคำสั่งไม่ถูกต้องครับน้า\n👉 พิมพ์: + [รหัส] [โบนัส] [เทิร์น]ท\n• แบบ %: + รับ1 20ป 2ท\n• แบบบาท: + รับ2 50 2ท";
        } else {
            // ดึงเฉพาะตัวเลขออกมาจากช่องโบนัสและเทิร์น
            const bonusNumMatch = rawBonus.match(/\d+(?:\.\d+)?/);
            const turnoverNumMatch = rawTurnover.match(/\d+(?:\.\d+)?/);
            const maxBonusMatch = rawMaxBonus ? rawMaxBonus.match(/\d+(?:\.\d+)?/) : null;

            if (!bonusNumMatch || !turnoverNumMatch) {
                replyText = "⚠️ ตัวเลขโบนัสหรือยอดเทิร์นไม่ถูกต้องครับน้า กรุณาระบุตัวเลขให้ชัดเจน";
            } else {
                const bonusValue = parseFloat(bonusNumMatch[0]);
                const turnoverMultiplier = parseFloat(turnoverNumMatch[0]);
                const maxBonus = maxBonusMatch ? parseFloat(maxBonusMatch[0]) : null; // ถ้าไม่ใส่ ให้เป็น null

                // เช็กว่ามีคำว่า 'ป', 'p', '%' หรือไม่ เพื่อกำหนดประเภท
                const isPercent = /[ปp%]/i.test(rawBonus);
                const bonusType = isPercent ? 'percent' : 'fixed';

                if (isNaN(bonusValue) || bonusValue <= 0 || isNaN(turnoverMultiplier) || turnoverMultiplier <= 0) {
                    replyText = "⚠️ จำนวนโบนัส หรือ ยอดเทิร์นโอเวอร์ต้องมากกว่า 0 ครับน้า";
                } else {
                    // 💾 บันทึกโปรโมชั่นลงระบบ
                    promotions[promoCode] = {
                        code: promoCode,
                        type: bonusType,
                        value: bonusValue,
                        turnoverMultiplier: turnoverMultiplier,
                        maxBonus: maxBonus
                    };

                    await saveDataToFirebase(); // บันทึกลง Firebase

                    const typeText = bonusType === 'percent' ? `${bonusValue}% (จากยอดฝากล่าสุด)` : `${bonusValue} บาท`;
                    const limitText = maxBonus ? `\n🛑 โบนัสสูงสุด: ${maxBonus.toLocaleString()} บาท` : `\n🛑 โบนัสสูงสุด: ไม่จำกัด`;
                    replyText = `✅ เพิ่มโปรโมชั่นสำเร็จเรียบร้อย!\n📌 รหัสโปร: ${promoCode}\n🎁 โบนัส: ${typeText}\n🛑 โบนัสสูงสุด: ${maxBonus}\n🔄 เงื่อนไขเทิร์น: ${turnoverMultiplier} เท่า`;
                }
            }
        }
    }
}
// ==================== [ 2. คำสั่งแอดมิน: ลบโปรโมชั่นรายตัว + ล้างประวัติสมาชิกอัตโนมัติ ] ====================
// รูปแบบ: "ลบโปร รับ1"
else if (userMsg.startsWith("ลบโปร")) {
    if (!ADMIN_IDS.includes(userId)) {
        replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
    } else {
        const promoCode = userMsg.replace("ลบโปร", "").trim();
        if (!promoCode) {
            replyText = "⚠️ กรุณาระบุรหัสโปรโมชั่นที่ต้องการลบ เช่น: ลบโปร รับ1";
        } else if (!promotions[promoCode]) {
            replyText = `❌ ไม่พบรหัสโปรโมชั่น [ ${promoCode} ] ในระบบครับ`;
        } else {
            // 1. ลบโปรโมชั่นออกจากระบบหลัก
            delete promotions[promoCode];

            // 2. 🟢 [เพิ่มส่วนนี้] วนลูปตามไปล้างประวัติการรับโปรนี้ออกจากสมาชิกทุกคน
            let clearedCount = 0;
            for (let uKey in usersWallets) {
                const user = usersWallets[uKey];
                if (user.claimedPromotions && user.claimedPromotions.includes(promoCode)) {
                    user.claimedPromotions = user.claimedPromotions.filter(code => code !== promoCode);
                    clearedCount++;
                }
            }

            await saveDataToFirebase();
            replyText = `🗑️ ลบโปรโมชั่น [ ${promoCode} ] เรียบร้อยแล้ว!\n🧹 ล้างประวัติออกจากสมาชิก: ${clearedCount} คน`;
        }
    }
}

// ==================== [ 3. คำสั่งแอดมิน: รีเซ็ตโปรทั้งหมด + ล้างประวัติสมาชิกทั้งหมดเป็น 0 ] ====================
// รูปแบบ: "รีเซ็ตโปร" หรือ "ล้างโปร"
else if (userMsg === "รีเซ็ตโปร" || userMsg === "ล้างโปร") {
    if (!ADMIN_IDS.includes(userId)) {
        replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
    } else {
        // 1. ล้างรายการโปรโมชั่นทั้งหมดในระบบ
        promotions = {}; 

        // 2. 🟢 [เพิ่มส่วนนี้] วนลูปตามไปล้างประวัติ claimedPromotions ของสมาชิกทุกคนให้เป็น Array ว่าง
        for (let uKey in usersWallets) {
            if (usersWallets[uKey]) {
                usersWallets[uKey].claimedPromotions = [];
            }
        }

        await saveDataToFirebase();
        replyText = "🧹 รีเซ็ตและล้างรายการโปรโมชั่นพร้อมประวัติการรับของสมาชิกทั้งหมดเรียบร้อยแล้วครับ!";
    }
}

// ==================== [ 4. คำสั่งเช็กโปรโมชั่นทั้งหมด (ทุกคนใช้ได้) ] ====================
// รูปแบบ: "เช็คโปร" หรือ "โปรโมชั่น"
else if (userMsg === "เช็คโปร" || userMsg === "โปรโมชั่น" || userMsg === "โปร") {
    const promoList = Object.keys(promotions);

    if (promoList.length === 0) {
        replyText = "📢 ตอนนี้ยังไม่มีโปรโมชั่นเปิดใช้งานในระบบครับน้า";
    } else {
        let text = "🎁 [ รายการโปรโมชั่นทั้งหมด ] 🎁\n──────────────────\n";
        promoList.forEach((code, index) => {
            const p = promotions[code];
            const bonusStr = p.type === 'percent' ? `${p.value}%` : `${p.value} บาท`;
            text += `${index + 1}. รหัสพิมพ์รับ: [ ${p.code} ]\n`;
            text += `   • โบนัส: ${bonusStr}\n`;
            text += `   • สูงสุด: ${p.maxBonus} บาท\n`;
            text += `   • ติดเทิร์น: ${p.turnoverMultiplier} เท่า\n`;
            text += `──────────────────\n`;
        });
        text += "👉 วิธีรับโปร: พิมพ์รหัสโปรโมชั่นได้เลย เช่น รับ1";
        replyText = text;
    }
}
   // ==================== [ 2. ส่วนของสมาชิก: พิมพ์รหัสเพื่อขอรับโปรโมชั่น ] ====================
else if (promotions[userMsg.trim()]) {
    const promoCode = userMsg.trim();
    const promo = promotions[promoCode];

    // ดึงข้อมูลผู้ใช้ (หากยังไม่มีโครงสร้าง ให้สร้างค่าเริ่มต้น)
    if (!usersWallets[userId]) {
        usersWallets[userId] = { 
            balance: 0, 
            lastDeposit: 0, 
            activePromotion: null, 
            turnoverTarget: 0, 
            activeBonusAmount: 0, 
            claimedPromotions: [] 
        };
    }
    const user = usersWallets[userId];

    // จัดการค่า Array/Field เพื่อป้องกัน Error กรณีเป็นผู้เล่นเก่า
    if (!user.claimedPromotions) user.claimedPromotions = [];
    if (user.activePromotion === undefined) user.activePromotion = null;
    if (user.turnoverTarget === undefined) user.turnoverTarget = 0;
    if (user.activeBonusAmount === undefined) user.activeBonusAmount = 0;

    // คำนวณยอดเงินคงค้างเดิม ก่อนที่จะรวมยอดฝากรอบล่าสุด
    const depositAmount = user.lastDeposit || 0;
    const previousBalance = (user.balance || 0) - depositAmount;

    // 🔴 [เงื่อนไขที่ 1] เช็กว่ากำลังติดโปรโมชั่นอื่นอยู่หรือไม่ (ห้ามรับซ้อน)
    if (user.activePromotion !== null) {
        replyText = `❌ คุณไม่สามารถรับโปรโมชั่นซ้อนได้ครับ\n📌 โปรที่ใช้งานอยู่ปัจจุบัน: [ ${user.activePromotion} ]\n⚠️ ต้องทำการฝากยอดใหม่ก่อนจึงจะรับโปรใหม่ได้ครับ`;
    }
    // 🔴 [เงื่อนไขที่ 2] เช็กว่าเคยรับโปรโมชั่นนี้ไปแล้วหรือยัง (รับได้แค่ 1 ครั้ง)
    else if (user.claimedPromotions.includes(promoCode)) {
        replyText = `❌ โปรโมชั่น [ ${promoCode} ] สามารถรับได้เพียง 1 ครั้งเท่านั้นครับ`;
    }
    // 🔴 [เงื่อนไขที่ 3] เช็กยอดฝากล่าสุด
    else if (!user.lastDeposit || user.lastDeposit <= 0) {
        replyText = `⚠️ ไม่พบยอดฝากล่าสุดของคุณ ไม่สามารถรับโปรโมชั่นได้ครับ`;
    }
        // 🔴 [เงื่อนไขที่ 4 - เพิ่มใหม่ตามวิธีที่ 1] เช็กยอดเงินค้างในกระเป๋าเดิมก่อนฝากใหม่ (ต้องไม่เกิน 5 บาท)
    else if (previousBalance > 5) {
        replyText = `❌ ไม่สามารถรับโปรโมชั่นได้ครับ!\n📌 คุณมียอดเงินคงค้างเดิมในกระเป๋า (${previousBalance} บาท)\n⚠️ กรุณาทำการถอนเงินออกก่อน หรือ มียอดไม่เกิน 5 บาท จึงจะรับโปรโมชั่นฝากใหม่ได้ครับ`;
    }
    else {
        let bonusAmount = 0;

       if (promo.type === 'percent') {
            // 1. คำนวณโบนัสตาม %
            let calculatedBonus = Math.floor(depositAmount * (promo.value / 100));

            // 2. 🛑 เช็กเพดานสูงสุด (Limit): ถ้ามีตั้งค่า maxBonus ไว้ ให้ใช้ค่าน้อยกว่า
            if (promo.maxBonus && promo.maxBonus > 0) {
                bonusAmount = Math.min(calculatedBonus, promo.maxBonus);
            } else {
                bonusAmount = calculatedBonus;
            }
        } else {
            bonusAmount = promo.value; // คำนวณโบนัสแบบจำนวนเงินคงที่
        }

        // คำนวณยอดเทิร์นโอเวอร์ที่ต้องทำ = (ยอดฝากล่าสุด + โบนัสที่ได้รับจริง) * เท่าเทิร์น
        const totalTurnoverRequired = Math.floor((depositAmount + bonusAmount) * promo.turnoverMultiplier);

        // 💾 อัปเดตข้อมูลผู้เล่น
        user.balance = (user.balance || 0) + bonusAmount;
        user.activePromotion = promoCode;
        user.activeBonusAmount = bonusAmount;
        user.turnoverTarget = totalTurnoverRequired;
        user.claimedPromotions.push(promoCode);
        user.lastDeposit = 0;

        await saveDataToFirebase(); // บันทึกลง Firebase

        // สรุปข้อความโบนัสสำหรับแสดงใน Flex
        let bonusDetail = promo.type === 'percent' ? `${promo.value}%` : `คงที่`;
        if (promo.maxBonus) {
            bonusDetail += ` (สูงสุด ${promo.maxBonus.toLocaleString()}฿)`;
        }

        // 🚀 สั่งยิง Flex Message ดีไซน์ส้ม-ทอง-ไฟ แจ้งรับโปรโมชั่นสำเร็จทันทีตรงนี้
        try {
            await axios.post('https://api.line.me/v2/bot/message/reply', {
                replyToken: replyToken,
                messages: [{
                    "type": "flex",
                    "altText": "🔥 คุณได้รับโปรโมชั่นสำเร็จเรียบร้อยแล้ว!",
                    "contents": {
                        "type": "bubble",
                        "size": "mega",
                        "header": {
                            "type": "box",
                            "layout": "vertical",
                            "contents": [
                                { "type": "text", "text": "🔥 รับโปรโมชั่นสำเร็จ! 🔥", "weight": "bold", "color": "#FFFFFF", "size": "xl", "align": "center" },
                                { "type": "text", "text": "จัดเต็มโบนัส พร้อมลุยแล้ววันนี้! 🚀", "color": "#FFE0B2", "size": "xs", "align": "center", "margin": "xs" }
                            ],
                            "backgroundColor": "#FF6F00",
                            "paddingAll": "15px"
                        },
                        "body": {
                            "type": "box",
                            "layout": "vertical",
                            "contents": [
                                {
                                    "type": "box", "layout": "horizontal",
                                    "contents": [
                                        { "type": "text", "text": "📌 รหัสโปรโมชั่น:", "color": "#666666", "size": "sm", "flex": 5 },
                                        { "type": "text", "text": `${promoCode}`, "color": "#D84315", "weight": "bold", "size": "sm", "align": "end", "flex": 5 }
                                    ],
                                    "margin": "md"
                                },
                                {
                                    "type": "box", "layout": "horizontal",
                                    "contents": [
                                        { "type": "text", "text": "💰 ยอดฝากอ้างอิง:", "color": "#666666", "size": "sm", "flex": 5 },
                                        { "type": "text", "text": `${depositAmount.toLocaleString()} บาท`, "color": "#333333", "weight": "bold", "size": "sm", "align": "end", "flex": 5 }
                                    ],
                                    "margin": "md"
                                },
                                {
                                    "type": "box", "layout": "horizontal",
                                    "contents": [
                                        { "type": "text", "text": "🎁 โบนัสที่ได้รับ:", "color": "#666666", "size": "sm", "flex": 5 },
                                        { "type": "text", "text": `+${bonusAmount.toLocaleString()} บาท`, "color": "#2E7D32", "weight": "bold", "size": "sm", "align": "end", "flex": 5 }
                                    ],
                                    "margin": "md"
                                },
                                {
                                    "type": "box", "layout": "horizontal",
                                    "contents": [
                                        { "type": "text", "text": "🔄 ยอดเทิร์นที่ต้องทำ:", "color": "#666666", "size": "sm", "flex": 5 },
                                        { "type": "text", "text": `${totalTurnoverRequired.toLocaleString()} บาท`, "color": "#E65100", "weight": "bold", "size": "sm", "align": "end", "flex": 5 }
                                    ],
                                    "margin": "md"
                                },
                                { "type": "separator", "margin": "lg", "color": "#FFE0B2" },
                                {
                                    "type": "box", "layout": "horizontal",
                                    "contents": [
                                        { "type": "text", "text": "💳 เครดิตคงเหลือ:", "color": "#1A237E", "weight": "bold", "size": "sm", "flex": 6 },
                                        { "type": "text", "text": `${user.balance.toLocaleString()} บาท`, "color": "#E65100", "weight": "bold", "size": "sm", "align": "end", "flex": 4 }
                                    ],
                                    "margin": "lg"
                                }
                            ],
                            "backgroundColor": "#FFF8E1",
                            "paddingAll": "18px"
                        },
                        "footer": {
                            "type": "box", "layout": "vertical",
                            "contents": [
                                { "type": "text", "text": "⚡ ขอให้โชคดี ระเบิดแจ็กพอตแตกหนักๆ นะครับ! ⚡", "color": "#BF360C", "weight": "bold", "size": "xs", "align": "center" }
                            ],
                            "backgroundColor": "#FFE0B2",
                            "paddingAll": "12px"
                        }
                    }
                }]
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TOKEN}`
                }
            });
        } catch (error) {
            console.error("❌ ส่ง Flex Message รับโปรโมชั่นล้มเหลว:", error.response ? error.response.data : error.message);
        }
        return;
    }
}
        // ==================== [ 4. ระบบรับโพยป๊อกเด้ง + หักค้ำประกัน 3 เด้ง ] ====================
        else if (originalMsg.includes('-') && !originalMsg.trim().toLowerCase().startsWith('c/') && !originalMsg.trim().toLowerCase().startsWith('z')) {
                if (!isRoundOpen) {
                    replyText = "🚫 ตอนนี้ระบบปิดรับโพยชั่วคราวครับ กรุณารอแอดมินเปิดรอบใหม่";
                } else {
                    const isRegistered = usersWallets[userId] ? true : false;
                    if (!isRegistered) {
                        replyText = `📢 ยินดีต้อนรับครับสมาชิกใหม่!\n\n⚠️ คุณยังไม่ได้ลงทะเบียนชื่อจริงในระบบ\nกรุณาพิมพ์: C/ชื่อ-นามสกุล ของท่านเพื่อสมัครสมาชิกก่อนแทงครับ`;
                    } else {
                        const user = usersWallets[userId];

                        // 💡 สร้างตัวแปรชื่อเล่นสำหรับแสดงผล (ถ้าไม่มี nickname ให้ถอยไปใช้ name)
                        const displayName = user.nickname || user.name || "ไม่ระบุชื่อ";

                        // 🔒 [แก้ไขจุดบกพร่อง] ดักจับสถานะล็อกถอนเงิน และสั่งให้บอทยิงข้อความเตือนทันที!
                        if (user && user.isWithdrawLocked) {
                            const lockMsg = `❌ คุณไม่สามารถส่งโพยแทงได้ครับ!\n👤 คุณ ${displayName} (ID: ${user.memberNumber}) อยู่ในระหว่าง "รอแอดมินโอนเงินและอนุมัติยอดถอน" (${user.pendingWithdrawAmount} บาท) บัญชีของคุณจึงถูกล็อกชั่วคราวครับ`;
                            
                            try {
                                await axios.post('https://api.line.me/v2/bot/message/reply', {
                                    replyToken: replyToken,
                                    messages: [{ type: 'text', text: lockMsg }]
                                }, {
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${TOKEN}`
                                    }
                                });
                            } catch (error) {
                                console.error("❌ ส่งข้อความแจ้งเตือนล็อกถอนล้มเหลว:", error.response ? error.response.data : error.message);
                            }
                            return; 
                        }
                        const lines = originalMsg.split(/\r?\n/);
                        
                        let totalActualBet = 0; 
                        let totalHoldCost = 0;
                        let processedBets = [];
                        let hasError = false;
                        let errorMsg = "";

                        // 🔄 [แก้ไขบั๊ก จ โดนบล็อก] ตรวจสอบรอบแทง ถ้าผู้เล่นยังไม่มีโพยในรอบนี้เลย ให้ล้างค่าดักแทงสวนของเก่าทิ้งก่อน
                        if (!roundBets[userId] || roundBets[userId].length === 0) {
                            usersRoundCrossCheck[userId] = {}; // ล้างความจำขยะรอบเก่าทันที
                        }

                        if (!usersRoundCrossCheck[userId]) {
                            usersRoundCrossCheck[userId] = {};
                        }
                        let betTracker = usersRoundCrossCheck[userId];

                        // 💡 [เพิ่มระบบคำนวณยอดแทงสะสมรายขาในรอบปัจจุบัน]
                        let existingLegBets = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
                        if (roundBets[userId] && roundBets[userId].length > 0) {
                            roundBets[userId].forEach(prevBet => {
                                const type = prevBet.betType;
                                const p = prevBet.pricePerLeg;

                                if (type === "รข" || type === "รจ") {
                                    for (let i = 1; i <= 6; i++) existingLegBets[i] += p;
                                } else if (type.startsWith("จ")) {
                                    const legs = type.substring(1).split('');
                                    legs.forEach(l => { if (existingLegBets[l] !== undefined) existingLegBets[l] += p; });
                                } else {
                                    const legs = type.split('');
                                    legs.forEach(l => { if (existingLegBets[l] !== undefined) existingLegBets[l] += p; });
                                }
                            });
                        }

                        const allowedLegs = ['1', '2', '3', '4', '5', '6'];
                        const MIN_BET = 10;
                        const MAX_BET = 2500;

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

                            if (price < MIN_BET || price > MAX_BET) {
                                hasError = true;
                                errorMsg = `❌ แทงไม่สำเร็จ! ยอดแทงต่อขาต้องอยู่ระหว่าง ${MIN_BET} ถึง ${MAX_BET} บาทครับ\n(คุณพิมพ์มา ขาละ ${price} บาท ในบรรทัด: "${line}")`;
                                break;
                            }

                            // 🔍 ตรวจสอบรายการขาที่จะถูกแทงในบรรทัดนี้เพื่อเช็คยอดรวมสะสม
                            let targetLegsArr = [];
                            if (targetStr === "รข" || targetStr === "รจ") {
                                targetLegsArr = ['1', '2', '3', '4', '5', '6'];
                            } else if (targetStr.startsWith('จ')) {
                                targetLegsArr = targetStr.substring(1).split('');
                            } else {
                                targetLegsArr = targetStr.split('');
                            }

                            // 🚫 ตรวจเช็คว่าเมื่อรวมโพยเก่า + โพยใหม่ ยอดแทงขานั้นเกิน MAX_BET หรือไม่
                            for (let leg of targetLegsArr) {
                                const currentLegTotal = (existingLegBets[leg] || 0) + price;
                                if (currentLegTotal > MAX_BET) {
                                    hasError = true;
                                    const prevAmount = existingLegBets[leg] || 0;
                                    errorMsg = `❌ แทงไม่สำเร็จ! ขา ${leg} มียอดแทงรวมสะสมเกินลิมิตสูงสุด ${MAX_BET} บาทต่อขา\n(ยอดเดิม: ${prevAmount} บ. + ยอดใหม่: ${price} บ. = ${currentLegTotal} บ.)`;
                                    break;
                                }
                            }
                            if (hasError) break;

                            // 🔄 อัปเดตยอดสะสมชั่วคราวสำหรับรองรับกรณีแทงหลายบรรทัดในโพยเดียวกัน
                            targetLegsArr.forEach(leg => {
                                existingLegBets[leg] = (existingLegBets[leg] || 0) + price;
                            });

                            let legsCount = 0;
                            let betTypeDetail = "";

                            if (targetStr === "รข") {
                                legsCount = maxLegs;
                                betTypeDetail = `เหมาขาผู้เล่นสู้เจ้ามือ (6 ขา) ขาละ ${price} บาท`;
                                for (let c = 1; c <= 6; c++) {
                                    if (betTracker[c] && betTracker[c] === 'dealer') {
                                        hasError = true;
                                        errorMsg = `❌ แทง รข ไม่ได้! ขา ${c} มีการแทงฝั่งเจ้ามือค้างไว้แล้วในรอบนี้`;
                                        break;
                                    }
                                }
                                if (hasError) break; 
                                for (let c = 1; c <= 6; c++) { betTracker[c] = 'player'; }
                                
                            } else if (targetStr === "รจ") {
                                legsCount = maxLegs;
                                betTypeDetail = `แทงเจ้ามือสู้ทุกขา (4 ขา) ขาละ ${price} บาท`;
                                for (let c = 1; c <= 6; c++) {
                                    if (betTracker[c] && betTracker[c] === 'player') {
                                        hasError = true;
                                        errorMsg = `❌ แทง รจ ไม่ได้! ขา ${c} มีการแทงฝั่งผู้เล่นค้างไว้แล้วในรอบนี้`;
                                        break;
                                    }
                                }
                                if (hasError) break; 
                                for (let c = 1; c <= 6; c++) { betTracker[c] = 'dealer'; }
                            } else if (targetStr.startsWith('จ')) {
                                const legs = targetStr.substring(1);
                                if (legs === "") { 
                                    hasError = true; 
                                    errorMsg = `⚠️ ไม่ระบุเลขขาเจ้ามือในบรรทัด: "${line}"`; 
                                    break;
                                }

                                let isLegsValid = legs.split('').every(char => allowedLegs.includes(char));
                                if (!isLegsValid) {
                                    hasError = true;
                                    errorMsg = `❌ บันทึกโพยล้มเหลว! ห้องนี้มีแค่ ขา 1 ถึง ขา 6 เท่านั้นครับ\n(พบข้อผิดพลาดที่ขาเจ้ามือ: "${line}")`;
                                    break;
                                }
                                
                                legsCount = legs.length;
                                betTypeDetail = `เจ้ามือสู้ขา [${legs.split('').join(', ')}] ขาละ ${price} บาท`;
                                const targetLegs = legs.split('');
                                for (let c of targetLegs) {
                                    if (betTracker[c] && betTracker[c] === 'player') {
                                        hasError = true;
                                        errorMsg = `❌ แทงสวนไม่ได้! ขา ${c} มีการแทงฝั่งผู้เล่นไปแล้วในรอบนี้`;
                                        break;
                                    }
                                }
                                if (hasError) break;

                                for (let c of targetLegs) { betTracker[c] = 'dealer'; }
                            } else {
                                let isLegsValid = targetStr.split('').every(char => allowedLegs.includes(char));
                                if (!isLegsValid) {
                                    hasError = true;
                                    errorMsg = `❌ บันทึกโพยล้มเหลว! ห้องนี้มีแค่ ขา 1 ถึง ขา 6 เท่านั้นครับ\n(พบข้อผิดพลาดที่ขาผู้เล่น: "${line}")`;
                                    break;
                                }
                                legsCount = targetStr.length;
                                betTypeDetail = `แทงขา [${targetStr.split('').join(', ')}] ขาละ ${price} บาท`;
                                const targetLegs = targetStr.split('');
                                for (let c of targetLegs) {
                                    if (betTracker[c] && betTracker[c] === 'dealer') {
                                        hasError = true;
                                        errorMsg = `❌ แทงสวนไม่ได้! ขา ${c} มีการแทงฝั่งเจ้ามือไปแล้วในรอบนี้`;
                                        break;
                                    }
                                }
                                if (hasError) break;

                                for (let c of targetLegs) { betTracker[c] = 'player'; }
                            }

                            let currentLineBet = price * legsCount;
                            let currentLineHold = currentLineBet * 3;

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

                        // ==================== [ 🌟 เริ่มต้นระบบค้ำประกันเด้งอัจฉริยะ ] ====================
                        if (!hasError && totalActualBet > 0) {
                            let finalHoldCost = 0;
                            let maxHandMultiplier = 3; 
                            let limitReasonText = "✨ ค้ำประกัน 3 เด้งสมบูรณ์แบบ";

                            const doubleHoldCost = totalActualBet * 2; 
                            const tripleHoldCost = totalActualBet * 3; 

                            if (user.balance < doubleHoldCost) {
                                replyText = `❌ เครดิตของคุณไม่พอสำหรับค้ำประกันขั้นต่ำ (2 เด้ง) ครับ!\n💸 ยอดแทงรวม: ${totalActualBet} บาท\n🔒 ต้องใช้ยอดค้ำประกันขั้นต่ำ (x2): ${doubleHoldCost} บาท\n💰 เครดิตปัจจุบันของคุณมี: ${user.balance} บาท`;
                                hasError = true;
                            } 
                            else if (user.balance >= doubleHoldCost && user.balance < tripleHoldCost) {
                                maxHandMultiplier = 2;
                                finalHoldCost = doubleHoldCost;
                                limitReasonText = `⚠️ คิดผลสูงสุดไม่เกิน 2 เด้ง (เครดิตไม่พอค้ำ 3 เด้ง)`;
                            } 
                            else {
                                maxHandMultiplier = 3;
                                finalHoldCost = tripleHoldCost;
                            }

                            if (!hasError) {
    user.balance -= finalHoldCost; 
    
    // 1. ตรวจสอบว่ามี Array roundBets ของยูสเซอร์นี้หรือยัง ถ้ายังไม่มีให้สร้างใหม่
    if (!roundBets[userId]) {
        roundBets[userId] = [];
    }

    // 2. นำโพยจากไลน์ (processedBets) Push ต่อท้ายใน roundBets เดิม (เพื่อไม่ให้โพยหน้าเว็บหาย)
    processedBets.forEach((bet) => {
        roundBets[userId].push({
            name: displayName,
            memberNumber: user.memberNumber,
            betType: bet.type,
            detail: bet.detail,
            pricePerLeg: bet.pricePerLeg,
            actualBet: bet.actualBet,
            holdCost: (bet.actualBet * maxHandMultiplier), 
            maxMultiplier: maxHandMultiplier, 
            time: new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' }),
            source: 'line' // ระบุว่ามาจากไลน์
        });
    });

                                // 🌟 3. [วางตรงนี้] บันทึกแบบ Batch Update (ตัวเดียวจบ + ปลอดภัย 100%)
                                try {
                                    const updates = {};
                                    // รวมการอัปเดตโพย และ ยอดเงินกระเป๋า ไว้ใน Request เดียว
                                    updates[`system_data/roundBets/${userId}`] = roundBets[userId];
                                    updates[`system_data/usersWallets/${userId}/balance`] = user.balance;
                                    if (user.totalTurnover !== undefined) {
                                        updates[`system_data/usersWallets/${userId}/totalTurnover`] = (user.totalTurnover || 0) + totalActualBet;
                                    }
                            
                                    // ยืนยันการเขียน Firebase แบบครั้งเดียวจบ (ใช้เวลาเพียง ~0.03 วินาที)
                                    await db.ref().update(updates);
                                } catch (dbErr) {
                                    console.error("❌ บันทึกข้อมูลลง Firebase ล้มเหลว:", dbErr.message);
                                    // คืนเงินค้ำประกันเข้า RAM หาก Firebase บันทึกไม่สำเร็จ
                                    user.balance += finalHoldCost; 
                                    
                                    // แจ้งเตือนข้อผิดพลาดกลับไปยังผู้ใช้งาน
                                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                                        replyToken: replyToken,
                                        messages: [{ type: "text", text: "❌ เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองส่งโพยใหม่อีกครั้งครับ" }]
                                    }, { headers: { 'Authorization': `Bearer ${TOKEN}` } });
                                    return;
                                }

                                // 4. 🌟 [แก้ตรงนี้] ประกาศ Array สำหรับ Flex Message
                                let itemsFlexContents = [];
                                processedBets.forEach((bet) => {
                                    itemsFlexContents.push({
                                        "type": "text",
                                        "text": `• ${bet.detail}`,
                                        "size": "sm",
                                        "color": "#dddddd",
                                        "wrap": true
                                    });
                                });
                                
                                try {
                                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                                        replyToken: replyToken,
                                        messages: [{
                                            "type": "flex",
                                            "altText": "🧾 บันทึกโพยสำเร็จเรียบร้อยแล้ว",
                                            "contents": {
                                                "type": "bubble",
                                                "styles": { "body": { "backgroundColor": "#111111" } },
                                                "body": {
                                                    "type": "box", "layout": "vertical", "spacing": "md",
                                                    "contents": [
                                                        { "type": "text", "text": "✅ บันทึกโพยเรียบร้อย 🎉", "weight": "bold", "color": "#ffcc00", "size": "md", "align": "center" },
                                                        { "type": "separator", "color": "#333333" },
                                                        {
                                                            "type": "box", "layout": "horizontal",
                                                            "contents": [
                                                                { "type": "text", "text": "👤 ผู้แทง:", "size": "sm", "color": "#888888", "flex": 2 },
                                                                { "type": "text", "text": `${displayName} (ID: ${user.memberNumber})`, "size": "sm", "color": "#ffffff", "flex": 5, "weight": "bold" }
                                                            ]
                                                        },
                                                        { "type": "separator", "color": "#333333" },
                                                        { "type": "text", "text": "📝 รายการแทง", "size": "xs", "color": "#ffcc00", "weight": "bold" },
                                                        { "type": "box", "layout": "vertical", "spacing": "xs", "contents": itemsFlexContents },
                                                        { "type": "separator", "color": "#333333" },
                                                        {
                                                            "type": "box", "layout": "vertical", "spacing": "xs",
                                                            "contents": [
                                                                {
                                                                    "type": "box", "layout": "horizontal",
                                                                    "contents": [
                                                                        { "type": "text", "text": "💵 ยอดแทงรวม:", "size": "sm", "color": "#aaa9aa" },
                                                                        { "type": "text", "text": `${totalActualBet} บาท`, "size": "sm", "color": "#ffffff", "align": "end", "weight": "bold" }
                                                                    ]
                                                                },
                                                                {
                                                                    "type": "box", "layout": "horizontal",
                                                                    "contents": [
                                                                        { "type": "text", "text": `🔒 หักค้ำประกัน (x${maxHandMultiplier}):`, "size": "sm", "color": "#aaa9aa" },
                                                                        { "type": "text", "text": `${finalHoldCost} บาท`, "size": "sm", "color": "#ff3333", "align": "end", "weight": "bold" }
                                                                    ]
                                                                },
                                                                {
                                                                    "type": "box", "layout": "horizontal",
                                                                    "contents": [
                                                                        { "type": "text", "text": "💰 เครดิตคงเหลือ:", "size": "sm", "color": "#aaa9aa" },
                                                                        { "type": "text", "text": `${user.balance} บาท`, "size": "sm", "color": "#00ff00", "align": "end", "weight": "bold" }
                                                                    ]
                                                                }
                                                            ]
                                                        },
                                                        { "type": "separator", "color": "#333333" },
                                                        { "type": "text", "text": limitReasonText, "size": "xs", "color": "#ffaa00", "wrap": true, "align": "center" },
                                                        { "type": "text", "text": "🔔 ระบบจะคืนเครดิตส่วนต่างให้ตอนสรุปผลครับ", "size": "xxs", "color": "#888888", "align": "center" }
                                                    ]
                                                }
                                            }
                                        }]
                                    }, {
                                        headers: {
                                            'Content-Type': 'application/json',
                                            'Authorization': `Bearer ${TOKEN}`
                                        }
                                    });
                                } catch (error) {
                                    console.error("❌ ส่ง Flex Message โพยแทงล้มเหลว:", error.response ? error.response.data : error.message);
                                }
                                return; 
                            }
                        } else if (!hasError && totalActualBet === 0) {
                            replyText = "⚠️ ไม่พบรายการแทงในข้อความของคุณครับ";
                        }

                        if (hasError && errorMsg !== "") {
                            replyText = errorMsg;
                        }
                    }
                }
            }
                 // ==================== [ 4.1 ระบบรับโพยไฮโล (รองรับ z นำหน้า + กันแทงสวน/แทงกั๊ก) ] ====================
else if (originalMsg.trim().toLowerCase().startsWith('z')) {
    if (!isHiloRoundOpen) {
        replyText = "🎲 ตอนนี้ระบบปิดรับโพยไฮโลชั่วคราวครับ กรุณารอแอดมินเปิดรอบใหม่";
    } else {
        const isRegistered = usersWallets[userId] ? true : false;
        if (!isRegistered) {
            replyText = `📢 ยินดีต้อนรับครับสมาชิกใหม่!\n\n⚠️ คุณยังไม่ได้ลงทะเบียนชื่อจริงในระบบ\nกรุณาพิมพ์: C/ชื่อ-นามสกุล ของท่านเพื่อสมัครสมาชิกก่อนแทงครับ`;
        } else {
            const user = usersWallets[userId];
            const displayName = user.nickname || user.name || "ไม่ระบุชื่อ";

            // 🔒 ดักจับสถานะล็อกถอนเงิน
            if (user && user.isWithdrawLocked) {
                const lockMsg = `❌ คุณไม่สามารถส่งโพยแทงได้ครับ!\n👤 คุณ ${displayName} (ID: ${user.memberNumber}) อยู่ในระหว่าง "รอแอดมินโอนเงินและอนุมัติยอดถอน" (${user.pendingWithdrawAmount} บาท) บัญชีของคุณจึงถูกล็อกชั่วคราวครับ`;
                try {
                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                        replyToken: replyToken,
                        messages: [{ type: 'text', text: lockMsg }]
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TOKEN}`
                        }
                    });
                } catch (error) {
                    console.error("❌ ส่งข้อความแจ้งเตือนล็อกถอนล้มเหลว:", error.response ? error.response.data : error.message);
                }
                return;
            }

            // 🔄 ดึงข้อมูลการแทงไฮโลในรอบปัจจุบันของผู้เล่นขึ้นมาเช็คแทงสวน/กั๊ก
            if (!hiloUserTrackers[userId]) {
                hiloUserTrackers[userId] = {
                    side: null, // 'HIGH' หรือ 'LOW'
                    singles: new Set() // เก็บเลขเต็งที่แทงไปแล้ว เช่น Set('1', '2')
                };
            }
            let tracker = hiloUserTrackers[userId];

            // สร้าง ตัวแปรชั่วคราว ไว้ทดลองจำลองการแทงก่อนบันทึกจริง
            let tempSide = tracker.side;
            let tempSingles = new Set(tracker.singles);

            // 💡 [เพิ่มระบบคำนวณยอดแทงสะสมในรอบปัจจุบัน]
            let existingCategoryTotals = {}; 
            let existingSingleTotals = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0 };

            if (hiloRoundBets[userId] && hiloRoundBets[userId].length > 0) {
                hiloRoundBets[userId].forEach(prevBet => {
                    const bType = prevBet.betType;
                    const bPrice = prevBet.pricePerLeg || prevBet.price; // ราคาทุนต่อรายการ/ต่อหน้า
                    
                    if (bType === "เต็ง") {
                        // สะสมยอดรายตัวเลขสำหรับเต็ง
                        const digits = (prevBet.target || "").split('');
                        digits.forEach(d => {
                            if (existingSingleTotals[d] !== undefined) {
                                existingSingleTotals[d] += bPrice;
                            }
                        });
                    } else {
                        // สะสมยอดสำหรับหมวดหมู่อื่นๆ โดยใช คีย์ = "betType_target"
                        const key = `${bType}_${prevBet.target}`;
                        existingCategoryTotals[key] = (existingCategoryTotals[key] || 0) + bPrice;
                    }
                });
            }

            const lines = originalMsg.split(/\r?\n/);
            let totalHiloBet = 0;
            let processedHiloBets = [];
            let hasError = false;
            let errorMsg = "";

            // 💰 อั้นไฮโล
            const MIN_BET = 10;
            const MAX_BET_MAP = {
                "ส/ต": 2500,
                "11": 1000,
                "เต็ง": 1000,
                "โต๊ด2": 1000,
                "โต๊ด3": 1000,
                "คู่ส/ต": 1000,
                "ตองรวม": 500,
                "ตองเจาะ": 100
            };

            for (let line of lines) {
                let cleanLine = line.trim().toLowerCase();
                if (cleanLine === "") continue;

                // ถ้านำหน้าด้วย z ให้ตัด z ออก
                if (cleanLine.startsWith('z')) {
                    cleanLine = cleanLine.substring(1).trim();
                }

                const parts = cleanLine.split('-');
                if (parts.length !== 2) {
                    hasError = true;
                    errorMsg = `⚠️ รูปแบบโพยไฮโลไม่ถูกต้องในบรรทัด: "${line}"\n(ตัวอย่าง: z1-100 หรือ ต-100 หรือ 1234-100)`;
                    break;
                }

                const targetStr = parts[0].trim();
                const price = parseFloat(parts[1].trim());

                if (isNaN(price) || price <= 0) {
                    hasError = true;
                    errorMsg = `⚠️ จำนวนเงินไม่ถูกต้องในบรรทัด: "${line}"`;
                    break;
                }

                let categoryName = "";
                let betType = ""; // เก็บหมวดหมู่ไว้เช็คยอดอั้น
                let isValidType = false;

                // ---------------- 1. ตรวจสอบกลุ่ม สูง / ต่ำ ----------------
                let currentLineSide = null;
                if (targetStr === "ส" || targetStr === "สูง" || (targetStr.startsWith("ส") && targetStr.length === 2 && ['1','2','3','4','5','6'].includes(targetStr[1]))) {
                    currentLineSide = "HIGH";
                } else if (targetStr === "ต" || targetStr === "ต่ำ" || (targetStr.startsWith("ต") && targetStr.length === 2 && ['1','2','3','4','5','6'].includes(targetStr[1]))) {
                    currentLineSide = "LOW";
                }

                // 🛡️ เช็คกฎการแทงสวน สูง-ต่ำ
                if (currentLineSide) {
                    if (tempSide && tempSide !== currentLineSide) {
                        hasError = true;
                        errorMsg = `❌ แทงสวนไม่ได้! คุณมีรายการแทงฝั่ง "${tempSide === 'HIGH' ? 'สูง' : 'ต่ำ'}" ไว้แล้วในรอบนี้ ห้ามแทงฝั่งตรงข้ามครับ`;
                        break;
                    }
                    tempSide = currentLineSide; // บันทึกฝั่งชั่วคราว
                }

                // ---------------- 2. แปลงคำและประเภทเดิมพัน ----------------
                // 2.1 [กรณีพิเศษ] 11 ไฮโล
                if (targetStr === "11") { 
                    categoryName = "11ไฮโล"; 
                    betType = "11"; 
                    isValidType = true; 
                }

                // 2.2 ตัวอักษร ส / ต
                else if (targetStr === "ส" || targetStr === "สูง") { categoryName = "สูง"; betType = "ส/ต"; isValidType = true; }
                else if (targetStr === "ต" || targetStr === "ต่ำ") { categoryName = "ต่ำ"; betType = "ส/ต"; isValidType = true; }

                // 2.3 ตอง
                else if (targetStr === "ตอง") { categoryName = "ตองรวม (ตองใดๆ)"; betType = "ตองรวม"; isValidType = true; }
                else if (targetStr.startsWith("ตอง") && targetStr.length === 4) {
                    const num = targetStr.substring(3);
                    if (['1','2','3','4','5','6'].includes(num)) {
                        categoryName = `ตอง ${num}`;
                        betType = "ตองเจาะ";
                        isValidType = true;
                    }
                }

                // 2.4 คู่ สูง/ต่ำ + เลข (เช่น ต1, ส6)
                else if ((targetStr.startsWith("ต") || targetStr.startsWith("ส") || targetStr.startsWith("ต่ำ") || targetStr.startsWith("สูง")) && targetStr.length === 2) {
                    const side = targetStr.startsWith("ต") ? "ต่ำ" : "สูง";
                    const num = targetStr.substring(1);
                    if (['1','2','3','4','5','6'].includes(num)) {
                        categoryName = `${side}${num}`;
                        betType = "คู่ส/ต";
                        isValidType = true;
                    }
                }

                // 2.5 กลุ่มตัวเลข 1-6 เพียวๆ (เต็ง, โต๊ด2, โต๊ด3)
                else if (targetStr.split('').every(c => ['1','2','3','4','5','6'].includes(c))) {
                    const nums = targetStr.split('');

                    // --- โต๊ด 2 ตัว (ความยาว 2 ตัว เช่น 23, 56) ---
                    if (nums.length === 2) {
                        if (nums[0] === nums[1]) {
                            hasError = true;
                            errorMsg = `❌ ส่งโพยไม่ถูกต้อง! โต๊ด 2 ตัว ต้องเป็นเลขคนละตัวกัน (${targetStr})\n👉 หากต้องการแทงเต็ง ให้ส่งเช่น z${nums[0]}-${price}`;
                            break;
                        } else {
                            categoryName = `โต๊ด${nums[0]}${nums[1]}`;
                            betType = "โต๊ด2";
                            isValidType = true;
                        }
                    }
                    // --- โต๊ด 3 ตัว (ความยาว 3 ตัว เช่น 123, 456) ---
                    else if (nums.length === 3) {
                        if (new Set(nums).size !== 3) {
                            hasError = true;
                            errorMsg = `❌ ส่งโพยไม่ถูกต้อง! โต๊ด 3 ตัว ห้ามมีเลขซ้ำกัน (${targetStr})\n👉 หากต้องการแทงตอง ให้พิมพ์ "ตอง" หรือ "ตอง${nums[0]}"`;
                            break;
                        } else {
                            categoryName = `โต๊ด${nums[0]}${nums[1]}${nums[2]}`;
                            betType = "โต๊ด3";
                            isValidType = true;
                        }
                    }
                    // --- เต็งตัวเลข (1 ตัว หรือเต็งหลายหน้า 4-5 ตัว เช่น 1, 12, 1234) ---
                    else {
                        if (new Set(nums).size !== nums.length) {
                            hasError = true;
                            errorMsg = `❌ ส่งโพยไม่ถูกต้อง! พบเลขซ้ำกันในรายการเต็งหลายหน้า (${targetStr})`;
                            break;
                        }

                        const digits = Array.from(new Set(nums));
                        digits.forEach(d => tempSingles.add(d));
                        
                        if (tempSingles.size > 5) {
                            hasError = true;
                            errorMsg = `❌ แทงกั๊กไม่ได้! ระบบอนุญาตให้แทงเต็งได้สูงสุดไม่เกิน 5 หน้าต่อรอบครับ\n(รวมของเดิม คุณแทงไปแล้ว ${tempSingles.size} หน้า)`;
                            break;
                        }

                        betType = "เต็ง";
                        isValidType = true;

                        if (digits.length === 1) {
                            categoryName = `เต็ง ${digits[0]}`;
                        } else {
                            categoryName = `เต็ง ${digits.length} หน้า (${digits.join(', ')}) [ขาละ ${price} บ.]`;
                        }
                    }
                }

                if (!isValidType) {
                    hasError = true;
                    errorMsg = `❌ ประเภทการแทงไฮโลไม่ถูกต้องในบรรทัด: "${line}"`;
                    break;
                }

                // ---------------- 3. ตรวจสอบอั้นจาก MAX_BET_MAP ----------------
                const maxAllowed = MAX_BET_MAP[betType];
                
                if (!maxAllowed) {
                    hasError = true;
                    errorMsg = `⚠️ ไม่พบการตั้งค่าอั้นสำหรับประเภท [${betType}]`;
                    break;
                }

                if (price < MIN_BET || price > maxAllowed) {
                    hasError = true;
                    errorMsg = `❌ แทงไม่สำเร็จ! ยอดแทงประเภท [${categoryName}] ต้องอยู่ระหว่าง ${MIN_BET} ถึง ${maxAllowed} บาทครับ\n(คุณพิมพ์มา ${price} บาท ในบรรทัด: "${line}")`;
                    break;
                }

                // 🔍 ตรวจเช็คยอดสะสมตามประเภท
                if (betType === "เต็ง") {
                    const digits = targetStr.split('');
                    for (let d of digits) {
                        const currentDigitTotal = (existingSingleTotals[d] || 0) + price;
                        if (currentDigitTotal > maxAllowed) {
                            hasError = true;
                            const prevAmount = existingSingleTotals[d] || 0;
                            errorMsg = `❌ แทงไม่สำเร็จ! เต็งหน้า ${d} มียอดแทงสะสมเกินลิมิตสูงสุด ${maxAllowed} บาทต่อหน้า\n(ยอดเดิม: ${prevAmount} บ. + ยอดใหม่: ${price} บ. = ${currentDigitTotal} บ.)`;
                            break;
                        }
                    }
                    if (hasError) break;

                    // อัปเดตยอดสะสมชั่วคราว
                    digits.forEach(d => {
                        existingSingleTotals[d] = (existingSingleTotals[d] || 0) + price;
                    });
                } else {
                    const key = `${betType}_${targetStr}`;
                    const currentCategoryTotal = (existingCategoryTotals[key] || 0) + price;
                    if (currentCategoryTotal > maxAllowed) {
                        hasError = true;
                        const prevAmount = existingCategoryTotals[key] || 0;
                        errorMsg = `❌ แทงไม่สำเร็จ! รายการ [${categoryName}] มียอดแทงสะสมเกินลิมิตสูงสุด ${maxAllowed} บาท\n(ยอดเดิม: ${prevAmount} บ. + ยอดใหม่: ${price} บ. = ${currentCategoryTotal} บ.)`;
                        break;
                    }
                    
                    // อัปเดตยอดสะสมชั่วคราว
                    existingCategoryTotals[key] = currentCategoryTotal;
                }

                // คำนวณราคารวมจริง (กรณีเต็งหลายหน้า)
                let lineTotalPrice = price;
                if (betType === "เต็ง" && targetStr.length > 1) {
                    lineTotalPrice = price * targetStr.length;
                }

               totalHiloBet += lineTotalPrice;
                processedHiloBets.push({
                    target: targetStr,
                    category: categoryName,
                    betType: betType,
                    pricePerLeg: price,
                    price: lineTotalPrice
                });
            }
            // 💰 บันทึกยอดเมื่อไม่มีข้อผิดพลาด
            if (!hasError && totalHiloBet > 0) {
                if (user.balance < totalHiloBet) {
                    replyText = `❌ เครดิตของคุณไม่พอสำหรับแทงไฮโลครับ!\n💸 ยอดแทงรวม: ${totalHiloBet} บาท\n💰 เครดิตคงเหลือของคุณ: ${user.balance} บาท`;
                } else {
                    // ยืนยันการลงข้อมูลป้องกันแทงสวน/กั๊ก
                    hiloUserTrackers[userId].side = tempSide;
                    hiloUserTrackers[userId].singles = tempSingles;

                    user.balance -= totalHiloBet;
                    await saveDataToFirebase();

                    if (!hiloRoundBets[userId]) {
                        hiloRoundBets[userId] = [];
                    }
                    let itemsFlexContents = [];
                    processedHiloBets.forEach(hb => {
                        hiloRoundBets[userId].push({
                            name: displayName,
                            memberNumber: user.memberNumber,
                            target: hb.target,
                            category: hb.category,
                            betType: hb.betType,
                            pricePerLeg: hb.pricePerLeg,
                            price: hb.price,
                            time: new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' }),
                            source: 'line'
                        });

                        itemsFlexContents.push({
                            "type": "text",
                            "text": `• ${hb.category} : ${hb.price} บาท`,
                            "size": "sm",
                            "color": "#dddddd",
                            "wrap": true
                        });
                    });

                    // 🌟 บันทึกข้อมูลลง Firebase แบบ Batch Update (ปลอดภัยและรวดเร็ว)
                    try {
                        const updates = {};
                        updates[`system_data/hiloRoundBets/${userId}`] = hiloRoundBets[userId];
                        updates[`system_data/usersWallets/${userId}/balance`] = user.balance;
                        if (user.totalTurnover !== undefined) {
                            updates[`system_data/usersWallets/${userId}/totalTurnover`] = (user.totalTurnover || 0) + totalHiloBet;
                        }

                        await db.ref().update(updates);
                    } catch (dbErr) {
                        console.error("❌ บันทึกข้อมูลไฮโลลง Firebase ล้มเหลว:", dbErr.message);
                        user.balance += totalHiloBet; // คืนเงินหากบันทึกไม่สำเร็จ
                        
                        await axios.post('https://api.line.me/v2/bot/message/reply', {
                            replyToken: replyToken,
                            messages: [{ type: "text", text: "❌ เกิดข้อผิดพลาดในการบันทึกโพยไฮโล กรุณาลองส่งใหม่อีกครั้งครับ" }]
                        }, { headers: { 'Authorization': `Bearer ${TOKEN}` } });
                        return;
                    }

                    // 🚀 ส่ง Flex Message ยืนยันโพยไฮโล
                    try {
                        await axios.post('https://api.line.me/v2/bot/message/reply', {
                            replyToken: replyToken,
                            messages: [{
                                "type": "flex",
                                "altText": "🎲 บันทึกโพยไฮโลสำเร็จเรียบร้อยแล้ว",
                                "contents": {
                                    "type": "bubble",
                                    "styles": { "body": { "backgroundColor": "#111111" } },
                                    "body": {
                                        "type": "box", "layout": "vertical", "spacing": "md",
                                        "contents": [
                                            { "type": "text", "text": "🎲 บันทึกโพยไฮโลเรียบร้อย 🎉", "weight": "bold", "color": "#ffcc00", "size": "md", "align": "center" },
                                            { "type": "separator", "color": "#333333" },
                                            {
                                                "type": "box", "layout": "horizontal",
                                                "contents": [
                                                    { "type": "text", "text": "👤 ผู้แทง:", "size": "sm", "color": "#888888", "flex": 2 },
                                                    { "type": "text", "text": `${displayName} (ID: ${user.memberNumber})`, "size": "sm", "color": "#ffffff", "flex": 5, "weight": "bold" }
                                                ]
                                            },
                                            { "type": "separator", "color": "#333333" },
                                            { "type": "text", "text": "📝 รายการเดิมพันไฮโล", "size": "xs", "color": "#ffcc00", "weight": "bold" },
                                            { "type": "box", "layout": "vertical", "spacing": "xs", "contents": itemsFlexContents },
                                            { "type": "separator", "color": "#333333" },
                                            {
                                                "type": "box", "layout": "vertical", "spacing": "xs",
                                                "contents": [
                                                    {
                                                        "type": "box", "layout": "horizontal",
                                                        "contents": [
                                                            { "type": "text", "text": "💵 ยอดแทงไฮโลรวม:", "size": "sm", "color": "#aaa9aa" },
                                                            { "type": "text", "text": `${totalHiloBet} บาท`, "size": "sm", "color": "#ffaa00", "align": "end", "weight": "bold" }
                                                        ]
                                                    },
                                                    {
                                                        "type": "box", "layout": "horizontal",
                                                        "contents": [
                                                            { "type": "text", "text": "💰 เครดิตคงเหลือ:", "size": "sm", "color": "#aaa9aa" },
                                                            { "type": "text", "text": `${user.balance} บาท`, "size": "sm", "color": "#00ff00", "align": "end", "weight": "bold" }
                                                        ]
                                                    }
                                                ]
                                            }
                                        ]
                                    }
                                }
                            }]
                        }, {
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${TOKEN}`
                            }
                        });
                    } catch (error) {
                        console.error("❌ ส่ง Flex Message โพยไฮโลล้มเหลว:", error.response ? error.response.data : error.message);
                    }
                    return;
                }
            } else if (!hasError && totalHiloBet === 0) {
                replyText = "⚠️ ไม่พบรายการแทงไฮโลในข้อความของคุณครับ";
            }

            if (hasError && errorMsg !== "") {
                replyText = errorMsg;
            }
        }
    }
}
            // ==================== [ 5. ระบบคืนโพย / ยกเลิกโพยในรอบ ] ====================
            else if (userMsg === "r") {
                if (!isRoundOpen) {
                    replyText = "🚫 ไม่สามารถคืนโพยได้ครับ เนื่องจากปิดรอบแทงเรียบร้อยแล้ว";
                } else {
                    const isRegistered = usersWallets[userId] ? true : false;
                    if (!isRegistered) {
                        replyText = `📢 คุณยังไม่ได้ลงทะเบียนสมาชิกในระบบครับ`;
                    } else {
                        const user = usersWallets[userId];
                        const myBets = roundBets[userId];

                        if (!myBets || myBets.length === 0) {
                            replyText = `❌ คุณ ${user.name} ไม่มีรายการโพยค้างในรอบนี้ให้ยกเลิกครับ`;
                        } else {
                            const totalRefund = myBets.reduce((sum, bet) => sum + bet.holdCost, 0);
                            user.balance += totalRefund;
                            
                            // 🔄 [เพิ่มจุดสำคัญ] ล้างประวัติการจำฝั่งแทงสวนออกด้วยเมื่อมีการคืนโพย เพื่อให้ส่งโพยใหม่สลับฝั่งได้ทันที
                            usersRoundCrossCheck[userId] = {};

                            await saveDataToFirebase(); //💾เซฟถาวร
                            roundBets[userId] = []; 

                            // 🚀 สั่งยิง Flex Message ดีไซน์ดำ-แดง แจ้งยกเลิกโพยทันทีตรงนี้
                            try {
                                await axios.post('https://api.line.me/v2/bot/message/reply', {
                                    replyToken: replyToken,
                                    messages: [{
                                        "type": "flex",
                                        "altText": "🗑️ ยกเลิกโพยสำเร็จเรียบร้อยแล้ว",
                                        "contents": {
                                            "type": "bubble",
                                            "styles": { "body": { "backgroundColor": "#141414" } },
                                            "body": {
                                                "type": "box", "layout": "vertical", "spacing": "md",
                                                "contents": [
                                                    { "type": "text", "text": "🗑️ ยกเลิกโพยสำเร็จเรียบร้อย 🎉", "weight": "bold", "color": "#ff3333", "size": "md", "align": "center" },
                                                    { "type": "separator", "color": "#333333" },
                                                    {
                                                        "type": "box", "layout": "horizontal",
                                                        "contents": [
                                                            { "type": "text", "text": "👤 สมาชิก:", "size": "sm", "color": "#888888", "flex": 2 },
                                                            { "type": "text", "text": `${user.name} (ID: ${user.memberNumber})`, "size": "sm", "color": "#ffffff", "flex": 5, "weight": "bold" }
                                                        ]
                                                    },
                                                    { "type": "separator", "color": "#333333" },
                                                    {
                                                        "type": "box", "layout": "vertical", "spacing": "sm",
                                                        "contents": [
                                                            {
                                                                "type": "box", "layout": "horizontal",
                                                                "contents": [
                                                                    { "type": "text", "text": "💰 คืนเครดิตค้ำประกัน:", "size": "sm", "color": "#aaa9aa" },
                                                                    { "type": "text", "text": `+${totalRefund} บาท`, "size": "sm", "color": "#00ff00", "align": "end", "weight": "bold" }
                                                                ]
                                                            },
                                                            {
                                                                "type": "box", "layout": "horizontal",
                                                                "contents": [
                                                                    { "type": "text", "text": "✨ เครดิตปัจจุบัน:", "size": "sm", "color": "#aaa9aa" },
                                                                    { "type": "text", "text": `${user.balance} บาท`, "size": "sm", "color": "#ffffff", "align": "end", "weight": "bold" }
                                                                ]
                                                            }
                                                        ]
                                                    },
                                                    { "type": "separator", "color": "#333333" },
                                                    { "type": "text", "text": "💡 ตอนนี้โพยรอบนี้ของคุณว่างแล้ว\nท่านสามารถส่งโพยชุดใหม่เข้ามาใหม่ได้ทันทีครับ", "size": "xs", "color": "#aaaaaa", "wrap": true, "align": "center" }
                                                ]
                                            }
                                        }
                                    }]
                                }, {
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${TOKEN}`
                                    }
                                });
                            } catch (error) {
                                console.error("❌ ส่ง Flex Message คืนโพยล้มเหลว:", error.response ? error.response.data : error.message);
                            }
                            return; // 🌟 ทำงานเสร็จแล้วจบคำสั่งตรงนี้เลย บอทไม่รวนแน่นอน
                        }
                    }
                }
            }
                // ==================== [ 5.1 ระบบคืนโพยไฮโล (rz) ] ====================
                else if (userMsg === "rz") {
                    if (!isHiloRoundOpen) {
                        replyText = "🚫 ไม่สามารถคืนโพยไฮโลได้ครับ เนื่องจากปิดรอบแทงเรียบร้อยแล้ว";
                    } else {
                        const isRegistered = usersWallets[userId] ? true : false;
                        if (!isRegistered) {
                            replyText = `📢 คุณยังไม่ได้ลงทะเบียนสมาชิกในระบบครับ`;
                        } else {
                            const user = usersWallets[userId];
                            const displayName = user.nickname || user.name || "ไม่ระบุชื่อ";
                            const myHiloBets = hiloRoundBets[userId];
                
                            if (!myHiloBets || myHiloBets.length === 0) {
                                replyText = `❌ คุณ ${displayName} ไม่มีรายการโพยไฮโลค้างในรอบนี้ให้ยกเลิกครับ`;
                            } else {
                                // คำนวณยอดเงินรวมที่จะคืน
                                const totalHiloRefund = myHiloBets.reduce((sum, bet) => sum + bet.price, 0);
                                user.balance += totalHiloRefund;
                
                                // 🔄 ล้างประวัติการจำฝั่งแทงสวน และการนับหน้าเต็งของไฮโล
                                hiloUserTrackers[userId] = {
                                    side: null,
                                    singles: new Set()
                                };
                
                                // 🗑️ ล้างรายการโพยไฮโลในรอบปัจจุบัน
                                hiloRoundBets[userId] = [];
                
                                await saveDataToFirebase(); // 💾 บันทึกข้อมูลลงฐานข้อมูล
                
                                // 🚀 ส่ง Flex Message แจ้งยกเลิกโพยไฮโล (ธีมส้ม-ดำ)
                                try {
                                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                                        replyToken: replyToken,
                                        messages: [{
                                            "type": "flex",
                                            "altText": "🗑️ ยกเลิกโพยไฮโลสำเร็จเรียบร้อยแล้ว",
                                            "contents": {
                                                "type": "bubble",
                                                "styles": { "body": { "backgroundColor": "#141414" } },
                                                "body": {
                                                    "type": "box", "layout": "vertical", "spacing": "md",
                                                    "contents": [
                                                        { "type": "text", "text": "🎲 ยกเลิกโพยไฮโลสำเร็จ 🎉", "weight": "bold", "color": "#ffaa00", "size": "md", "align": "center" },
                                                        { "type": "separator", "color": "#333333" },
                                                        {
                                                            "type": "box", "layout": "horizontal",
                                                            "contents": [
                                                                { "type": "text", "text": "👤 สมาชิก:", "size": "sm", "color": "#888888", "flex": 2 },
                                                                { "type": "text", "text": `${displayName} (ID: ${user.memberNumber})`, "size": "sm", "color": "#ffffff", "flex": 5, "weight": "bold" }
                                                            ]
                                                        },
                                                        { "type": "separator", "color": "#333333" },
                                                        {
                                                            "type": "box", "layout": "vertical", "spacing": "sm",
                                                            "contents": [
                                                                {
                                                                    "type": "box", "layout": "horizontal",
                                                                    "contents": [
                                                                        { "type": "text", "text": "💰 คืนเครดิตไฮโล:", "size": "sm", "color": "#aaa9aa" },
                                                                        { "type": "text", "text": `+${totalHiloRefund} บาท`, "size": "sm", "color": "#00ff00", "align": "end", "weight": "bold" }
                                                                    ]
                                                                },
                                                                {
                                                                    "type": "box", "layout": "horizontal",
                                                                    "contents": [
                                                                        { "type": "text", "text": "✨ เครดิตปัจจุบัน:", "size": "sm", "color": "#aaa9aa" },
                                                                        { "type": "text", "text": `${user.balance} บาท`, "size": "sm", "color": "#ffffff", "align": "end", "weight": "bold" }
                                                                    ]
                                                                }
                                                            ]
                                                        },
                                                        { "type": "separator", "color": "#333333" },
                                                        { "type": "text", "text": "💡 ยกเลิกโพยไฮโลเรียบร้อยแล้ว\nท่านสามารถส่งโพยไฮโลชุดใหม่เข้ามาได้ทันทีครับ", "size": "xs", "color": "#aaaaaa", "wrap": true, "align": "center" }
                                                    ]
                                                }
                                            }
                                        }]
                                    }, {
                                        headers: {
                                            'Content-Type': 'application/json',
                                            'Authorization': `Bearer ${TOKEN}`
                                        }
                                    });
                                } catch (error) {
                                    console.error("❌ ส่ง Flex Message คืนโพยไฮโลล้มเหลว:", error.response ? error.response.data : error.message);
                                }
                                return;
                            }
                        }
                    }
                }
            // ==================== [ 6. ระบบสมาชิกพิมพ์ขอจั่วไพ่ เช่น 12+ ] ====================
            else if (userMsg.endsWith('+')) {
                if (!isDrawOpen) {
                    replyText = "⚠️ ระบบยังไม่ได้เปิดรอบจั่วไพ่ใบที่ 3 หรือ แอดมินปิดรอบจั่วไปแล้วครับ";
                } else {
                    const userBetsArray = roundBets[userId];
                    if (!userBetsArray || userBetsArray.length === 0) {
                        replyText = "⚠️ คุณยังไม่ได้ส่งโพยเดิมพันในรอบนี้ จึงไม่สามารถขอจั่วไพ่ได้ครับ";
                    } else {
                        const legsToDraw = userMsg.replace('+', '').split('');
                        let drawSuccessLegs = [];
                        let alreadyDrawnLegs = []; // 📌 [เพิ่มใหม่] เก็บขาที่เคยจั่วไปแล้ว เพื่อนำมาแจ้งเตือน

                        userBetsArray.forEach((bet) => {
                            // 👑 [จุดแก้ไขบั๊ก] เช็กว่าโพยใบนี้เป็นโพยแทงฝั่งเจ้ามือสู้ขา (จ) หรือเหมาเจ้า (รจ) หรือไม่
                            const isBettingOnDealer = (bet.betType === "รจ" || bet.betType.startsWith('จ'));
                            
                            // 🛑 ถ้าเป็นโพยแทงฝั่งเจ้ามือ ให้ข้ามไปเลย ไม่ทำการเปิดสิทธิ์จั่วเด็ดขาด
                            if (isBettingOnDealer) return;

                            // 👤 ปรับสถานะเฉพาะโพยฝั่งผู้เล่นปกติเท่านั้น
                            if (!bet.drawStatus) bet.drawStatus = {};

                            legsToDraw.forEach((leg) => {
                                let hasThisLeg = false;
                                if (bet.betType === "รข") {
                                    hasThisLeg = ['1', '2', '3', '4','5', '6'].includes(leg);
                                } else {
                                    hasThisLeg = bet.betType.includes(leg);
                                }

                                if (hasThisLeg) {
                                   // 🚨 [จุดแก้ไขหลัก]: เช็กว่าขานี้เคยจั่วไปแล้วหรือยัง?
                        if (bet.drawStatus[leg] === "จั่ว") {
                            // ถ้าเคยจั่วไปแล้ว ให้เก็บบันทึกไว้ว่าส่งซ้ำ (ไม่ใส่ใน drawSuccessLegs)
                            if (!alreadyDrawnLegs.includes(leg)) {
                                alreadyDrawnLegs.push(leg);
                            }
                        } else {
                            // 🟢 ถ้ายังไม่เคยจั่ว ให้ปรับสถานะ และบันทึกการจั่วสำเร็จ
                            bet.drawStatus[leg] = "จั่ว";
                            if (!drawSuccessLegs.includes(leg)) {
                                drawSuccessLegs.push(leg);
                            }
                        }
                    }
                });
            });

                        if (drawSuccessLegs.length > 0) {
                            const sortedLegs = drawSuccessLegs.sort((a, b) => a - b).join(', ');
                            const user = usersWallets[userId] || {};

                            // 💡 ดึงชื่อเล่น (ถ้าน้าไม่ได้ตั้ง nickname ไว้ ระบบจะถอยไปใช้ user.name อัตโนมัติ)
                            const displayName = user.nickname || user.name || "สมาชิก";
                            
                            // 🚀 สั่งยิง Flex Message ดีไซน์ดำ-น้ำเงิน แจ้งขอจั่วไพ่ใบที่ 3 ทันทีตรงนี้
                            try {
                                await axios.post('https://api.line.me/v2/bot/message/reply', {
                                    replyToken: replyToken,
                                    messages: [{
                                        "type": "flex",
                                        "altText": "🃏 ${displayName} บันทึกการขอจั่วไพ่ใบที่ 3 สำเร็จ",
                                        "contents": {
                                            "type": "bubble",
                                            "styles": { "body": { "backgroundColor": "#121620" } },
                                            "body": {
                                                "type": "box", "layout": "vertical", "spacing": "md",
                                                "contents": [
                                                    { "type": "text", "text": "🃏 ขอจั่วไพ่ใบที่ 3 สำเร็จ 🎉", "weight": "bold", "color": "#3399ff", "size": "md", "align": "center" },
                                                    { "type": "separator", "color": "#222a3a" },
                                                    {
                                                        "type": "box", "layout": "horizontal",
                                                        "contents": [
                                                            { "type": "text", "text": "👤 ผู้จั่ว:", "size": "sm", "color": "#8894a6", "flex": 2 },
                                                            { "type": "text", "text": `[ ${user.memberNumber || '-'} ] ${displayName}`, "size": "sm", "color": "#ffffff", "flex": 5, "weight": "bold" }
                                                        ]
                                                    },
                                                    { "type": "separator", "color": "#222a3a" },
                                                    {
                                                        "type": "box", "layout": "vertical", "spacing": "xs",
                                                        "contents": [
                                                            { "type": "text", "text": "📍 ขาที่ต้องการจั่วเพิ่ม", "size": "xs", "color": "#3399ff", "weight": "bold" },
                                                            {
                                                                "type": "box", "layout": "horizontal", "spacing": "sm", "margin": "sm",
                                                                "contents": [
                                                                    { "type": "text", "text": "➡️ ขาผู้เล่น:", "size": "sm", "color": "#aaa9aa", "flex": 3 },
                                                                    { "type": "text", "text": `[ ขา ${sortedLegs} ]`, "size": "sm", "color": "#00ff00", "weight": "bold", "flex": 5 }
                                                                ]
                                                            }
                                                        ]
                                                    },
                                                    { "type": "separator", "color": "#222a3a" },
                                                    { "type": "text", "text": "📢 สถานะ: รอดำเนินการจั่วไพ่จากแอดมิน", "size": "xs", "color": "#aaaaaa", "align": "center" }
                                                ]
                                            }
                                        }
                                    }]
                                }, {
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${TOKEN}`
                                    }
                                });
                            } catch (error) {
                                console.error("❌ ส่ง Flex Message ขอจั่วไพ่ล้มเหลว:", error.response ? error.response.data : error.message);
                            }
                            return; // 🌟 ทำงานเสร็จแล้ว ตัดจบตรงนี้เลย
                            
                            // 🔴 กรณีที่กดพิมพ์จั่วซ้ำ (ไม่มีขาใหม่ให้จั่วแล้ว)
                        } else if (alreadyDrawnLegs.length > 0) {
                const dupLegs = alreadyDrawnLegs.sort((a, b) => a - b).join(', ');
                replyText = `⚠️ ขา [ ${dupLegs} ] ของคุณได้บันทึกการขอจั่วไปแล้วครับ ไม่สามารถจั่วซ้ำได้!`;
            
            // 🟡 กรณีพิมพ์ขาที่ตัวเองไม่ได้แทงไว้
            } else {
                replyText = "⚠️ คำสั่งไม่ทำงาน: เนื่องจากคุณไม่ได้ลงเดิมพันในขาที่คุณระบุจั่ว หรือแทงเฉพาะฝั่งเจ้ามือไว้ครับ";
            }
        }
    }
}               
             // ==================== [ 8. ระบบแอดมินส่งผลสรุปคำนวณแต้ม - เวอร์ชันพ่วง Flex Message ] ====================
else if (originalMsg.startsWith('>')) {
    if (!ADMIN_IDS.includes(userId)) {
        replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งสรุปผลคะแนนครับ";
    } else if (isRoundOpen) {
        replyText = "⚠️ ต้องพิมพ์ปิดรอบแทง (X) และทำขั้นตอนจั่วไพ่ให้เสร็จก่อน จึงจะสรุปผลได้ครับ";
    } else {
        // 1. แยกข้อความออกเป็น 2 ส่วนด้วยสัญลักษณ์ > (ป๊อกเด้ง และ ไฮโล)
        const rawSections = originalMsg.split('>').map(s => s.trim()).filter(s => s.length > 0);
        
        const pokdengRaw = rawSections[0] || ""; // ส่วนของป๊อกเด้ง
        const hiloRaw = rawSections[1] || "";    // ส่วนของไฮโล (ถ้ามี)

        // ----------------------------------------------------
        // 🃏 [ส่วนที่ 1: แกะผลป๊อกเด้ง]
        // ----------------------------------------------------
        const parts = pokdengRaw.split(/\s+/);
        if (parts.length < 2) {
            replyText = "⚠️ รูปแบบป๊อกเด้งผิดครับ! ต้องมีอย่างน้อย 1 ขา และตัวสุดท้ายคือเจ้ามือ";
            return res.sendStatus(200);
        }

        // 🛠️ ฟังก์ชันแกะรหัสไพ่ (นับสแลชแม่นยำ ไม่โดนตัวอื่นแย่ง)
        const parseCardStr = (str, isDealer = false, isThreeCards = false, forcePok = false) => {
            let clean = str.trim().toLowerCase();
            let isPok = forcePok; 
            let multiplier = 1; 
            let typeName = "แต้มปกติ";
            let rawScore = 0;

            // 🎯 นับเครื่องหมาย / เพื่อคิดเด้งแบบตรงตัว
            const slashCount = (clean.match(/\//g) || []).length;
            if (slashCount === 2) { multiplier = 3; }
            else if (slashCount === 1) { multiplier = 2; }
            
            // ลบเครื่องหมาย / ออกทั้งหมดเพื่อส่องดูแต้มเนื้อๆ
            clean = clean.replace(/\//g, '');

            // เช็กป๊อกเจ้ามือ
            // ✅ โค้ดใหม่ (เช็ก * ทั้งผู้เล่นและเจ้ามือ)
if (clean.includes('*')) { 
    isPok = true; 
    clean = clean.replace(/\*/g, ''); 
}
            
            // แปลงแต้มพิเศษ (รองรับทั้งไทยและอังกฤษ)
            if (clean === 't' || clean === 'ต') { rawScore = 700; multiplier = 5; typeName = "ตอง"; }    
            else if (clean === 'f') { rawScore = 600; multiplier = 5; typeName = "เรียงสี"; } 
            else if (clean === 'h') { rawScore = 400; multiplier = 3; typeName = "เซียน/3เหลือง"; } 
            else if (clean === 's' || clean === 'ร') { rawScore = 500; multiplier = 3; typeName = "เรียง"; }
            else if (clean === '7.5') { rawScore = 7.5; typeName = "7.5"; }
                
            else {
                let pts = parseInt(clean);
                if (isNaN(pts)) pts = 0;
                
                // สำหรับผู้เล่น ถ้าแต้มเป็น 8 หรือ 9 โดดๆ ให้ถือเป็นไพ่ป๊อกอัตโนมัติ
                if (isPok) {
            if (pts === 9) { rawScore = 900; typeName = "ป๊อก 9"; }
            else if (pts === 8) { rawScore = 800; typeName = "ป๊อก 8"; }
            else { rawScore = pts; typeName = `${pts} แต้ม`; }
        } else {
            rawScore = pts; typeName = `${pts} แต้ม`;
        }
    }
    return { score: rawScore, v: clean, mult: multiplier, name: typeName };
};

        // 👑 แกะรหัสเจ้ามือ (ตัวสุดท้าย)
        const dealerRawStr = parts[parts.length - 1]; 
        const dealerResult = parseCardStr(dealerRawStr, true, false);

        let roomResults = {}; 
        const totalLegsToSend = Math.min(parts.length - 1, maxLegs);

        // 🔄 วนลูปแกะรหัสผู้เล่นรายขา
        for (let i = 0; i < totalLegsToSend; i++) {
            let innerContent = parts[i].trim();
            if (innerContent === "") continue;

            let currentLeg = i + 1;
            let result2Cards = null;
            let result3Cards = null;

            // 🔥 [ใช้ระบบ RegEx ชำแหละข้อความขั้นสูง] แยกกลุ่มตัวเลขและเครื่องหมายสแลชออกจากกัน
           if (innerContent.includes(',')) {
    // 1. ถ้าแอดมินพิมพ์แบบมีคอมม่าคั่น เช่น 5,sf หรือ 1,s
    const splitParts = innerContent.split(',');
    const part1 = splitParts[0].trim();
    const part2 = splitParts[1].trim();
    
    result2Cards = parseCardStr(part1, false, false);
    result3Cards = parseCardStr(part2, false, true);
    } else {
    // 2. ถ้าพิมพ์ติดกันแบบปกติ ไม่มีคอมม่า ให้ใช้ RegEx ช่วยผ่าแยก
    const match = innerContent.match(/^([0-9tshfตร]+(?:\/*))([0-9tshfตร]+(?:\/*))$/i);
    
    if (match) {
        const part1 = match[1]; 
        const part2 = match[2]; 
        
        result2Cards = parseCardStr(part1, false, false);
        result3Cards = parseCardStr(part2, false, true);
    } else {
            // 3. กรณีพิมพ์ตัวเดียวโดดๆ เช่น 8* หรือ 8 (ไม่มีจั่วใบที่ 3)
                    const singleResult = parseCardStr(innerContent, false, false);
                    result2Cards = singleResult;
                    result3Cards = singleResult; // ใช้ผลเดียวกันทั้ง 2 ใบและ 3 ใบ
                }
            }
            roomResults[currentLeg] = {
                leg: currentLeg,
                twoCards: result2Cards,
                threeCards: result3Cards
            };
        }
        // ----------------------------------------------------
        // 🎲 [ส่วนที่ 2: แกะผลไฮโล]
        // ----------------------------------------------------
        let hiloDices = [];
        let hiloTotalScore = 0;
        let hiloResultText = "ไม่มีการส่งผลไฮโล";

        if (hiloRaw) {
            // ดึงเฉพาะตัวเลข 3 ตัว เช่น 456
            const diceMatches = hiloRaw.replace(/[^1-6]/g, '').slice(0, 3);
            if (diceMatches.length === 3) {
                hiloDices = diceMatches.split('').map(Number);
                hiloTotalScore = hiloDices.reduce((a, b) => a + b, 0);
                
                // ตรวจสอบ ตอง / สูง / ต่ำ / 11 ไฮโล
                const isTriple = (hiloDices[0] === hiloDices[1] && hiloDices[1] === hiloDices[2]);
                let highLowText = "";
                if (isTriple) highLowText = "ตอง 💥";
                else if (hiloTotalScore === 11) highLowText = "ไฮโล 🎲";
                else if (hiloTotalScore >= 12) highLowText = "สูง 🔴";
                else highLowText = "ต่ำ 🔵";

                hiloResultText = `${highLowText}`;
            }
        }

        // 💾 บันทึกผลไว้ในตัวแปร Temp เพื่อรอแอดมินกด "ok" ตัดเงิน
        tempRoomResults = roomResults;
        tempDealerResult = dealerResult;
        tempHiloDices = hiloDices; // (อย่าลืมประกาศตัวแปร tempHiloDices ไว้ด้านบนสุดของไฟล์ด้วยครับ)
        
        // --- 📊 [เตรียมตัวแปรสำหรับแสดงผลไฮโล] ---
        let hiloDicesText = "-";
        let hiloTotalText = "-";
        let hiloResultType = "-";

        if (hiloDices && hiloDices.length === 3) {
            hiloDicesText = hiloDices.join(" - ");
            hiloTotalText = `${hiloTotalScore} แต้ม`;
            hiloResultType = hiloResultText;
        }
        

       // --- 📊 [ส่วนสร้างโครงสร้างข้อมูลจัดระเบียบส่งเข้า Flex Message] ---
        
        // ฟังก์ชันสร้าง Box สำหรับขาแต่ละขา (ปรับให้กระชับสำหรับ Grid 3 ช่อง)
        function createLegBox(leg) {
            if (!roomResults[leg]) {
                return {
                    "type": "box",
                    "layout": "vertical",
                    "flex": 1,
                    "backgroundColor": "#1a1520",
                    "cornerRadius": "md",
                    "paddingAll": "sm",
                    "contents": [
                        { "type": "text", "text": `🃏 ขาที่ ${leg}`, "weight": "bold", "color": "#aaaaaa", "size": "xxs", "align": "center" },
                        { "type": "text", "text": "ไม่มีผลไพ่", "size": "xxs", "color": "#888888", "style": "italic", "align": "center", "margin": "xs" },
                        { "type": "text", "text": "แพ้ 🔴", "size": "xs", "color": "#ff3333", "align": "center", "weight": "bold", "margin": "xs" }
                    ]
                };
            }

            const res = roomResults[leg];

            let status2Str = "เสมอ 🟡"; let color2 = "#ffcc00";
            if (res.twoCards.score > dealerResult.score) { status2Str = "ชนะ 🟢"; color2 = "#00ff66"; }
            else if (res.twoCards.score < dealerResult.score) { status2Str = "แพ้ 🔴"; color2 = "#ff3333"; }

            let status3Str = "เสมอ 🟡"; let color3 = "#ffcc00";
            if (res.threeCards.score > dealerResult.score) { status3Str = "ชนะ 🟢"; color3 = "#00ff66"; }
            else if (res.threeCards.score < dealerResult.score) { status3Str = "แพ้ 🔴"; color3 = "#ff3333"; }

            return {
                "type": "box",
                "layout": "vertical",
                "flex": 1,
                "backgroundColor": "#221929",
                "cornerRadius": "md",
                "paddingAll": "sm",
                "contents": [
                    { "type": "text", "text": `🃏 ขาที่ ${leg}`, "weight": "bold", "color": "#ffffff", "size": "xs", "align": "center" },
                    { "type": "separator", "color": "#3a2d48", "margin": "xs" },
                    // [2ใบ]
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "xs",
                        "contents": [
                            { "type": "text", "text": `2ใบ: ${res.twoCards.name}`, "size": "xxs", "color": "#cccccc" },
                            { "type": "text", "text": `${status2Str} (${res.twoCards.mult}เด้ง)`, "size": "xxs", "color": color2, "weight": "bold" }
                        ]
                    },
                    // [3ใบ]
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "xs",
                        "contents": [
                            { "type": "text", "text": `3ใบ: ${res.threeCards.name}`, "size": "xxs", "color": "#cccccc" },
                            { "type": "text", "text": `${status3Str} (${res.threeCards.mult}เด้ง)`, "size": "xxs", "color": color3, "weight": "bold" }
                        ]
                    }
                ]
            };
        }

        // จัดกลุ่มเป็นแถวบน (ขา 1, 2, 3) และแถวล่าง (ขา 4, 5, 6)
        const topRowContents = [createLegBox(1), createLegBox(2), createLegBox(3)];
        const bottomRowContents = [createLegBox(4), createLegBox(5), createLegBox(6)];

        // 🚀 ยิงข้อความแพ็คคู่: รูปภาพหัวข้อผลลัพธ์ + Flex Message สรุปผลคะแนน
        const summaryImgUrl = "https://img2.pic.in.th/-__-----4b1c38e0628ea626.jpg";

        try {
            await axios.post('https://api.line.me/v2/bot/message/reply', {
                replyToken: replyToken,
                messages: [
                    {
                        "type": "image",
                        "originalContentUrl": summaryImgUrl,
                        "previewImageUrl": summaryImgUrl
                    },
                    {
                        "type": "flex",
                        "altText": `📊 ตรวจสอบผลการเล่น รอบที่ ${currentRound}`,
                        "contents": {
                            "type": "bubble",
                            "styles": { "body": { "backgroundColor": "#130f17" } },
                            "body": {
                                "type": "box",
                                "layout": "vertical",
                                "spacing": "md",
                                "contents": [
                                    { "type": "text", "text": "📊 ผลป๊อกเด้ง และ ไอโล 🎰", "weight": "bold", "color": "#b8860b", "size": "md", "align": "center" },
                                    { "type": "text", "text": `รอบที่: ${currentRound}`, "weight": "bold", "color": "#ffffff", "size": "sm", "align": "center" },
                                    { "type": "separator", "color": "#2a2233" },
                                    
                                    // 👑 เจ้ามือ
                                    {
                                        "type": "box",
                                        "layout": "horizontal",
                                        "backgroundColor": "#221929",
                                        "cornerRadius": "md",
                                        "paddingAll": "sm",
                                        "contents": [
                                            { "type": "text", "text": "👑 เจ้ามือ:", "weight": "bold", "color": "#ffaa00", "size": "sm" },
                                            { "type": "text", "text": `${dealerResult.name} (${dealerResult.mult} เด้ง)`, "weight": "bold", "color": "#ffffff", "size": "sm", "align": "end" }
                                        ]
                                    },
                                    { "type": "separator", "color": "#2a2233" },
                                    
                                    // 📝 ลำดับหน้าไพ่ Grid 3 ช่อง (บน 3 ขา / ล่าง 3 ขา)
                                    { "type": "text", "text": "📝 ลำดับหน้าไพ่และผลแพ้ชนะแต่ละขา", "size": "xs", "color": "#ffaa00", "weight": "bold" },
                                    {
                                        "type": "box",
                                        "layout": "vertical",
                                        "spacing": "sm",
                                        "contents": [
                                            { "type": "box", "layout": "horizontal", "spacing": "sm", "contents": topRowContents },
                                            { "type": "box", "layout": "horizontal", "spacing": "sm", "contents": bottomRowContents }
                                        ]
                                    },
                                    
                                    // 🎲 แสดงผลไฮโล แยกเป็น 3 กล่องเรียงข้างกัน
                                    { "type": "separator", "color": "#2a2233" },
                                    { "type": "text", "text": "🎲 ผลการออกรางวัลไฮโล", "size": "xs", "color": "#ffaa00", "weight": "bold" },
                                    {
                                        "type": "box",
                                        "layout": "horizontal",
                                        "spacing": "xs",
                                        "contents": [
                                            // กล่องที่ 1: หน้าลูกเต๋า
                                            {
                                                "type": "box",
                                                "layout": "vertical",
                                                "flex": 1,
                                                "backgroundColor": "#221929",
                                                "cornerRadius": "md",
                                                "paddingAll": "xs",
                                                "contents": [
                                                    { "type": "text", "text": "ลูกเต๋า", "size": "xxs", "color": "#aaaaaa", "align": "center" },
                                                    { "type": "text", "text": hiloDicesText || "-", "size": "xs", "color": "#ffffff", "weight": "bold", "align": "center", "margin": "xs" }
                                                ]
                                            },
                                            // กล่องที่ 2: แต้มรวม
                                            {
                                                "type": "box",
                                                "layout": "vertical",
                                                "flex": 1,
                                                "backgroundColor": "#221929",
                                                "cornerRadius": "md",
                                                "paddingAll": "xs",
                                                "contents": [
                                                    { "type": "text", "text": "แต้มรวม", "size": "xxs", "color": "#aaaaaa", "align": "center" },
                                                    { "type": "text", "text": hiloTotalText || "-", "size": "xs", "color": "#ffcc00", "weight": "bold", "align": "center", "margin": "xs" }
                                                ]
                                            },
                                            // กล่องที่ 3: สูง/ต่ำ/11/ตอง
                                            {
                                                "type": "box",
                                                "layout": "vertical",
                                                "flex": 1,
                                                "backgroundColor": "#221929",
                                                "cornerRadius": "md",
                                                "paddingAll": "xs",
                                                "contents": [
                                                    { "type": "text", "text": "ผลลัพธ์", "size": "xxs", "color": "#aaaaaa", "align": "center" },
                                                    { "type": "text", "text": hiloResultType || "-", "size": "xs", "color": "#00ff66", "weight": "bold", "align": "center", "margin": "xs" }
                                                ]
                                            }
                                        ]
                                    },
                                    
                                    { "type": "separator", "color": "#2a2233" },
                                    
                                    // 🔘 ชุดปุ่มกด ยืนยัน (ok) / ยกเลิก (no)
                                    {
                                        "type": "box",
                                        "layout": "horizontal",
                                        "spacing": "sm",
                                        "margin": "md",
                                        "contents": [
                                            {
                                                "type": "button",
                                                "style": "primary",
                                                "color": "#00c853",
                                                "height": "sm",
                                                "action": {
                                                    "type": "message",
                                                    "label": "✅ ยืนยัน",
                                                    "text": "ok"
                                                }
                                            },
                                            {
                                                "type": "button",
                                                "style": "primary",
                                                "color": "#d32f2f",
                                                "height": "sm",
                                                "action": {
                                                    "type": "message",
                                                    "label": "❌ ยกเลิก",
                                                    "text": "no"
                                                }
                                            }
                                        ]
                                    }
                                ]
                            }
                        }
                    }
                ]
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TOKEN}`
                }
            });
        } catch (error) {
            console.error("❌ ส่งรูปภาพและ Flex ตรวจสอบผลล้มเหลว:", error.response ? error.response.data : error.message);
        }
        return res.sendStatus(200);
            }
        }
    else if (userMsg === 'checkbets') {
    if (!ADMIN_IDS.includes(userId)) return;
    console.log("=== DEBUG roundBets ===", JSON.stringify(roundBets, null, 2));
    replyText = `🔍 ข้อมูล roundBets ปัจจุบัน:\n` + JSON.stringify(roundBets, null, 2);
}
   // ==================== [ 9. ระบบแอดมินยืนยันผลคำนวณเงินจริง OK / NO (Settlement Engine) ] ====================
else if (userMsg === 'ok' || userMsg === 'no') {
    if (!ADMIN_IDS.includes(userId)) return;

    if (!tempRoomResults || !tempDealerResult) {
        replyText = "⚠️ ไม่มีข้อมูลผลแต้มค้างอยู่ในระบบครับ กรุณาส่งผลแต้มด้วยเครื่องหมาย > ก่อนครับ";
    } else {
        if (userMsg === 'ok') {
            let summaryPayoutText = `💰 สรุปยอดได้/เสีย รอบที่: ${currentRound}\n──────────────────\n`;
            summaryPayoutText += `👑 เจ้ามือ: ${tempDealerResult.name}\n──────────────────\n`;
            
            let hasAnyBet = false;
            let flexUserContents = []; // 🎨 อาเรย์สำหรับเก็บดีไซน์กล่องรายคนใน Flex Message

            // 🎲 ดึงข้อมูลโพยไฮโลจาก Firebase / Variable (หากไม่มีให้เป็นวัตถุว่าง)
            const activeHiloBets = hiloRoundBets || {};

            // 🔗 รวบรวม uId ของผู้เล่นทุกคนที่มีการแทง (ทั้ง ป๊อกเด้ง และ ไฮโล)
            const allUserIds = Array.from(new Set([
                ...Object.keys(roundBets || {}),
                ...Object.keys(activeHiloBets)
            ]));

            // วนลูปสมาชิกทุกคนที่มีการแทงในรอบนี้เพื่อคิดเงิน
            for (let uId of allUserIds) {
                try {
                    const userBetsArray = roundBets[uId] || []; // โพยป๊อกเด้ง
                    const hiloBetsArray = activeHiloBets[uId] || []; // โพยไฮโล
                    
                    if (userBetsArray.length === 0 && hiloBetsArray.length === 0) continue;
                    
                const user = usersWallets[uId];
                // 🚨 [เพิ่มจุดนี้] ป้องกันระบบล่มถ้าหา Wallet สมาชิกไม่เจอ
                if (!user) {
                    console.error(`⚠️ ไม่พบข้อมูล usersWallets ของ userId: ${uId}`);
                    continue; // ให้ข้ามไปคิดเงินคนถัดไป ไม่ให้ลูปค้าง/ดับ
                }

                // 💡 ดึงชื่อเล่น (ถ้าน้าไม่ได้ตั้ง nickname ไว้ ระบบจะถอยไปใช้ user.name อัตโนมัติ)
                const displayName = user.nickname || user.name || "สมาชิก";
                    
                hasAnyBet = true;
                let pokdengWinLoss = 0; 
                let totalHoldRefund = 0;   
                let totalBetAmountThisRound = 0; // 📊 ตัวแปรเพิ่มใหม่สำหรับเก็บยอดแทงรวมแท้จริงในตานี้เพื่อเอาไปคิดเทิร์น

                userBetsArray.forEach((bet) => {
                    totalHoldRefund += bet.holdCost; // ดึงเงินค้ำประกัน 3 เท่ากลับมาคืนก่อน

                    // แกะข้อมูลตามประเภทโพย (เช่น "1", "รข", "จ12")
                    let legsToCalculate = [];
                    if (bet.betType === "รข" || bet.betType === "รจ") {
                        legsToCalculate = ['1', '2', '3', '4', '5', '6'];
                    } else if (bet.betType.startsWith('จ')) {
                        legsToCalculate = bet.betType.substring(1).split('');
                    } else {
                        legsToCalculate = bet.betType.split('');
                    }

                    // 🧮 สะสมยอดเดิมพันรวมจากราคารายขาคูณจำนวนขาที่เปิดสู้จริงในตานี้
                    totalBetAmountThisRound += (bet.pricePerLeg * legsToCalculate.length);

                    // คำนวณเงินแยกตามรายขาในโพยใบนี้
                    legsToCalculate.forEach((leg) => {
                        const legNum = parseInt(leg);
                        const matchResult = tempRoomResults[legNum];
                        if (!matchResult) return; // ป้องกันกรณีขาไม่มีข้อมูลผล
                        
                        // 🔍 ตรวจสอบประเภทโพย: เป็นการแทงฝั่งเจ้ามือสู้ขาผู้เล่นใช่หรือไม่
                        const isBettingOnDealer = (bet.betType === "รจ" || bet.betType.startsWith('จ'));

                        let finalCard;
                        const betPrice = bet.pricePerLeg; // ยอดแทงต่อ 1 ขา

                        if (!isBettingOnDealer) {
                            // 👤 [ฝั่งคนแทงผู้เล่นปกติ] -> รันระบบเดิมของคุณที่สมบูรณ์แบบอยู่แล้ว 100%
                            const isUserDrawn = (bet.drawStatus && bet.drawStatus[leg] === "จั่ว");
                            finalCard = isUserDrawn ? matchResult.threeCards : matchResult.twoCards;
                            // 🟢 ฝั่งผู้เล่นชนะ:
                            if (finalCard.score > tempDealerResult.score) {
                                let winMultiplier = finalCard.mult;
                                // 🛡️ ถ้าค้ำประกันมาแค่ 2 เด้ง ชนะเท่าไหร่ก็โดนแคปให้ได้ไม่เกิน 2 เด้ง (ถ้าค้ำครบ 3 เด้งจะปล่อยได้เต็ม 5 เด้ง)
                                if (bet.maxMultiplier && bet.maxMultiplier < 3 && winMultiplier > bet.maxMultiplier) {
                                    winMultiplier = bet.maxMultiplier;
                                }
                                pokdengWinLoss += (betPrice * winMultiplier);
                            } 
                            // 🔴 ฝั่งผู้เล่นแพ้:
                            else if (finalCard.score < tempDealerResult.score) {
                                let loseMultiplier = tempDealerResult.mult;
                                // ล็อกเพดานแพ้สูงสุดไม่เกิน 3 เด้งสำหรับคนค้ำครบ
                                if (loseMultiplier > 3) {
                                loseMultiplier = 3;
                                }
                                // 🛡️ ถ้าค้ำประกันมาน้อยกว่า (เช่น 2 เด้ง) ก็หักแพ้ตามเพดานค้ำจริง (ไม่เกิน 2)
                                if (bet.maxMultiplier && loseMultiplier > bet.maxMultiplier) {
                                    loseMultiplier = bet.maxMultiplier;
                                }
                                pokdengWinLoss -= (betPrice * loseMultiplier);
                            }
                        }
                        else {
                            // 👑 [ฝั่งคนแทงเจ้ามือ (จ หรือ มจ)] -> ใช้กฎตายตัวแยกคำนวณเด็ดขาด
                            let playerTwoCardScore = matchResult.twoCards.score;
                            let playerTwoCardMult = matchResult.twoCards.mult;

                            // รันกฎตายตัว: ขาผู้เล่นได้ 4 แต้มหรือต่ำกว่า (และไม่ใช่ 4 แต้มเด้ง) ให้เจ้ามือไปสู้กับผล 3 ใบ
                            if (playerTwoCardScore <= 4 || (playerTwoCardScore === 4 && playerTwoCardMult === 1)) {
                                finalCard = matchResult.threeCards; // ชนกับผลไพ่ 3 ใบ
                            } else {
                                finalCard = matchResult.twoCards;   // ชนกับผลไพ่ 2 ใบ (5 แต้มขึ้นไป หรือ 4 แต้มเด้ง)
                            }

                            // 🧮 ตรรกะคิดเงินของฝั่งคนแทงเจ้ามือ (หักต๋ง 10% เฉพาะขาที่ได้กำไร)
                            if (tempDealerResult.score > finalCard.score) {
                                let winMultiplier = tempDealerResult.mult; // ไม่ต้องเอา bet.maxMultiplier มาล็อคแล้ว                              
                                if (tempDealerResult.rawMult) {
                                    winMultiplier = tempDealerResult.rawMult;
                                }
                                // 🛡️ ถ้าค้ำประกันมาแค่ 2 เด้ง ชนะเท่าไหร่ก็โดนแคปไม่เกิน 2 เด้ง (ถ้าค้ำครบ 3 เด้งปล่อยได้เต็ม)
                                if (bet.maxMultiplier && bet.maxMultiplier < 3 && winMultiplier > bet.maxMultiplier) {
                                    userTotalWinLoss = bet.maxMultiplier;
                                 }
                                
                                let grossWin = betPrice * winMultiplier; // กำไรเต็มก่อนหัก
                                
                                // 🔥 หักต๋งรายขาทันที 10% (เหลือจ่ายจริง 90%)
                                let netWin = Math.floor(grossWin * 0.9);
                                pokdengWinLoss += netWin;
                            } 
                           // 🔴 ฝั่งคนแทงเจ้ามือแพ้:
                        else if (tempDealerResult.score < finalCard.score) {
                            let loseMultiplier = finalCard.mult;
                            // ล็อกเพดานแพ้สูงสุดไม่เกิน 3 เด้งสำหรับคนค้ำครบ
                            if (loseMultiplier > 3) {
                            loseMultiplier = 3;
                            }
                            // 🛡️ ถ้าค้ำประกันมาน้อยกว่า (เช่น 2 เด้ง) หักแพ้ไม่เกินเพดานค้ำจริง
                            if (bet.maxMultiplier && loseMultiplier > bet.maxMultiplier) {
                            loseMultiplier = bet.maxMultiplier;
                            }
                            pokdengWinLoss -= (betPrice * loseMultiplier);
                            }
                        }
                    });
                }); // ปิด userBetsArray.forEach

// =========================================================================
// 🎲 [2. โค้ดคำนวณผลไฮโล - แก้ไข Bug แปลง Type & เช็กผลแม่นยำ]
// =========================================================================
let hiloNetWinLoss = 0;

const dice = (Array.isArray(tempHiloDices) && tempHiloDices.length === 3) ? tempHiloDices : [0, 0, 0];
const diceSum = dice.reduce((a, b) => a + b, 0);
const isTriple = (dice[0] > 0 && dice[0] === dice[1] && dice[1] === dice[2]);

const hiloList = activeHiloBets[uId] || hiloRoundBets[uId] || [];

hiloList.forEach((hBet) => {
    if (!hBet) return;

    const price = Number(hBet.price || hBet.amount || 0);
    totalBetAmountThisRound += price; // สะสมยอดคิดเทิร์น

    totalHoldRefund += price;

    const target = String(hBet.target || hBet.category || "").trim();
    if (!target) return;

    let winMultiplier = 0;
    let isWin = false;

    // 1️⃣ สูง / ต่ำ
    if (target === "ส" || target === "สูง") {
        if (!isTriple && diceSum >= 12 && diceSum <= 17) { isWin = true; winMultiplier = 1; }
    } else if (target === "ต" || target === "ต่ำ") {
        if (!isTriple && diceSum >= 4 && diceSum <= 10) { isWin = true; winMultiplier = 1; }
    }

    // 2️⃣ 11 ไฮโล
    else if (target === "11" || target === "11ไฮโล") {
        if (diceSum === 11) { isWin = true; winMultiplier = 7; }
    }

    // 3️⃣ เต็งหน้า 1 ถึง 6
    else if (["1", "2", "3", "4", "5", "6"].includes(target)) {
        const targetNum = parseInt(target);
        const matchCount = dice.filter(d => d === targetNum).length;
        if (matchCount === 1) { isWin = true; winMultiplier = 1; }
        else if (matchCount === 2) { isWin = true; winMultiplier = 2; }
        else if (matchCount === 3) { isWin = true; winMultiplier = 5; }
    }

    // 4️⃣ โต๊ด 2 ตัว
    else if (target.length === 2 && !isNaN(target) && !target.startsWith("ต") && !target.startsWith("ส")) {
        const n1 = parseInt(target[0]);
        const n2 = parseInt(target[1]);
        if (dice.includes(n1) && dice.includes(n2)) {
            if (n1 !== n2 || dice.filter(d => d === n1).length >= 2) {
                isWin = true; winMultiplier = 5;
            }
        }
    }

    // 5️⃣ โต๊ด 3 ตัว
    else if (target.length === 3 && !isNaN(target) && !target.startsWith("ตอง")) {
        const targets = target.split("").map(Number);
        const matchCount = targets.filter(t => dice.includes(t)).length;
        if (matchCount === 3) { isWin = true; winMultiplier = 5; }
        else if (matchCount === 2) { isWin = true; winMultiplier = 1; }
    }

    // 6️⃣ ตองรวม
    else if (target === "ตองรวม" || target === "ตอง") {
        if (isTriple) { isWin = true; winMultiplier = 25; }
    }

    // 7️⃣ ตองเจาะ
    else if (target.startsWith("ตอง")) {
        const targetNum = parseInt(target.replace("ตอง", ""));
        if (isTriple && dice[0] === targetNum) { isWin = true; winMultiplier = 100; }
    }

    // 8️⃣ ต่ำ + หน้าเต๋า
    else if (target.startsWith("ต") && target.length === 2 && !isNaN(target[1])) {
        const targetNum = parseInt(target[1]);
        const isLow = (!isTriple && diceSum >= 4 && diceSum <= 10);
        if (isLow && dice.includes(targetNum)) {
            isWin = true;
            if (targetNum === 1 || targetNum === 2) winMultiplier = 2;
            else if (targetNum === 3) winMultiplier = 3;
            else if (targetNum === 4) winMultiplier = 4;
            else if (targetNum === 5) winMultiplier = 6;
            else if (targetNum === 6) winMultiplier = 9;
        }
    }

    // 9️⃣ สูง + หน้าเต๋า
    else if (target.startsWith("ส") && target.length === 2 && !isNaN(target[1])) {
        const targetNum = parseInt(target[1]);
        const isHigh = (!isTriple && diceSum >= 12 && diceSum <= 17);
        if (isHigh && dice.includes(targetNum)) {
            isWin = true;
            if (targetNum === 6 || targetNum === 5) winMultiplier = 2;
            else if (targetNum === 4) winMultiplier = 3;
            else if (targetNum === 3) winMultiplier = 4;
            else if (targetNum === 2) winMultiplier = 6;
            else if (targetNum === 1) winMultiplier = 9;
        }
    }
    // ----------------------------------------------------
    // ⚔️ คำนวณผลได้/เสียสุทธิ
    // ----------------------------------------------------
    if (isWin) {
        hiloNetWinLoss += (price * winMultiplier);
    } else {
        hiloNetWinLoss -= price;
    }
}); 
                    
// 💥 🎯 รวมยอดได้/เสียทั้งหมด (ป๊อกเด้ง + ไฮโล)
// ----------------------------------------------------
const userTotalWinLoss = pokdengWinLoss + hiloNetWinLoss;
                    
                // 🧮 อัปเดตกระเป๋าเงินจริงหลังคิดยอดสุทธิ
                user.balance = user.balance + totalHoldRefund + userTotalWinLoss;

                // 📊 [ระบบคำนวณและหักยอดเทิร์นอัตโนมัติ - เวอร์ชันสากลหักตามยอดแทงจริงที่มีผลได้เสีย]
                if (user.turnoverTarget > 0 && userTotalWinLoss !== 0) {
                    let currentTurnoverMade = totalBetAmountThisRound; // หักลดลงเท่ากับยอดแทงจริง ไม่สนจำนวนเด้ง
                    user.turnoverTarget -= currentTurnoverMade;
                    if (user.turnoverTarget < 0) user.turnoverTarget = 0; 
                }
                    // 🌟 [เพิ่มบรรทัดนี้เข้าไปครับ] สะสมยอดเทิร์นเพื่อดันเลเวล VIP
                    user.totalTurnover = (user.totalTurnover || 0) + totalBetAmountThisRound;

                let sign = userTotalWinLoss > 0 ? "+" : "";
                let displayColor = userTotalWinLoss > 0 ? "#00ff66" : (userTotalWinLoss < 0 ? "#ff3333" : "#ffcc00");
                
                let isUserBettingOnDealer = userBetsArray.some(b => b.betType === "รจ" || b.betType.startsWith('จ'));
                let feeNote = (isUserBettingOnDealer && userTotalWinLoss !== 0) ? " (หักต๋งแล้ว)" : "";

                // ฟังก์ชันสร้างเครื่องหมาย + หรือ -
                const fmt = (num) => (num > 0 ? `+${num}` : `${num}`);
                    
                // 🛠️ 1. สร้าง Array สำหรับเก็บแถบข้อความแบบ Dynamic
            let userBoxContents = [
                { "type": "text", "text": `👤 [ ${user.memberNumber || '-'} ] ${displayName}`, "weight": "bold", "color": "#ffffff", "size": "sm" }
            ];

            // 🎯 2. ถ้ามีผลป๊อกเด้ง ให้ดันแถบป๊อกเด้งเข้ากล่อง
            if (pokdengWinLoss !== 0) {
                userBoxContents.push({
                    "type": "box",
                    "layout": "horizontal",
                    "contents": [
                        { "type": "text", "text": `♠️ป๊อกเด้ง:${feeNote}`, "size": "xs", "color": "#cccccc" },
                        { "type": "text", "text": `${pokdengWinLoss > 0 ? '+' : ''}${pokdengWinLoss} บาท`, "size": "xs", "color": pokdengWinLoss > 0 ? "#55ff55" : "#ff5555", "align": "end" }
                    ]
                });
            }

            // 🎲 3. ถ้ามีผลไฮโล ให้ดันแถบไฮโลเข้ากล่อง
            if (hiloNetWinLoss !== 0) {
                userBoxContents.push({
                    "type": "box",
                    "layout": "horizontal",
                    "contents": [
                        { "type": "text", "text": `🎲ไฮโล:`, "size": "xs", "color": "#cccccc" },
                        { "type": "text", "text": `${hiloNetWinLoss > 0 ? '+' : ''}${hiloNetWinLoss} บาท`, "size": "xs", "color": hiloNetWinLoss > 0 ? "#55ff55" : "#ff5555", "align": "end" }
                    ]
                });
            }

            // 💰 4. คำนวณสีของยอดสุทธิรวม (อ้างอิงจากตัวแปรเดิมของน้า)
            displayColor = userTotalWinLoss > 0 ? "#00ff66" : (userTotalWinLoss < 0 ? "#ff3333" : "#ffcc00");

            // 📊 5. ดันแถบ "ยอดสุทธิ" รวมเข้ากล่อง
            userBoxContents.push({
                "type": "box",
                "layout": "horizontal",
                "contents": [
                    { "type": "text", "text": `• ยอดสุทธิรวม:`, "size": "xs", "color": "#ffffff", "weight": "bold" },
                    { "type": "text", "text": `${sign}${userTotalWinLoss} บาท`, "size": "xs", "color": displayColor, "align": "end", "weight": "bold" }
                ]
            });

            // 💳 6. ดันแถบ "เครดิตคงเหลือ" เข้ากล่อง
            userBoxContents.push({
                "type": "box",
                "layout": "horizontal",
                "contents": [
                    { "type": "text", "text": `• เครดิตคงเหลือ:`, "size": "xs", "color": "#cccccc" },
                    { "type": "text", "text": `${user.balance} บ.`, "size": "xs", "color": "#ffffff", "align": "end" }
                ]
            });

            // ➖ 7. ปิดท้ายด้วยเส้นคั่น
            userBoxContents.push({ "type": "separator", "color": "#2a2233", "margin": "xs" });

            // 🚀 8. ประกอบร่างลง flexUserContents ตัวใหญ่
            flexUserContents.push({
                "type": "box",
                "layout": "vertical",
                "margin": "md",
                "spacing": "xs",
                "contents": userBoxContents
            });

                // เก็บลงตัวแปร text ระบบเดิมด้วยเพื่อไม่ให้ระบบหลังบ้านรวน
                let oldSign = userTotalWinLoss > 0 ? "🟢 +" : (userTotalWinLoss < 0 ? "🔴 " : "🟡 ");
                let oldFeeNote = (isUserBettingOnDealer && userTotalWinLoss !== 0) ? " \n(หักต๋งขาเจ้ามือที่ชนะแล้ว)" : "";
                summaryPayoutText += `👤 [ ${user.memberNumber || '-'} ] ${displayName}\n  ยอดสุทธิ: ${oldSign}${userTotalWinLoss} บาท${oldFeeNote}\n เครดิตคงเหลือ: ${user.balance} บ.\n──────────────────\n`;
            } catch (error) {
                 // 🛡️ หากเกิด Error กับคนไหน ให้พ่น Log บอก แล้วไปคิดเงินคนถัดไปทันที ลูปไม่ดับแน่นอน
                 console.error(`❌ เกิดข้อผิดพลาดในการคิดเงินของ uId ${uId}:`, error);
            }    
        } // ปิดลูป for (let uId in roundBets)

            // 🛡️ เซฟลง Firebase แบบปลอดภัย หาก DB กระตุก บอทจะไม่ค้างและยังส่ง Flex สรุปยอดได้ปกติ
        try {
            await saveDataToFirebase();
        } catch (dbError) {
            console.error("❌ เกิดข้อผิดพลาดขณะเซฟลง Firebase:", dbError);
        }

            if (!hasAnyBet) {
                summaryPayoutText += "📝 รอบนี้ไม่มีสมาชิกส่งโพยเดิมพันเข้ามาครับ\n";
                flexUserContents.push({
                    "type": "text",
                    "text": "📝 รอบนี้ไม่มีสมาชิกส่งโพยเดิมพันเข้ามาครับ",
                    "size": "xs",
                    "color": "#888888",
                    "style": "italic",
                    "align": "center"
                });
            }

            summaryPayoutText += `✨ ระบบได้ทำการคำนวณเงินและอัปเดตกระเป๋าเงินให้ทุกคนเรียบร้อยแล้วครับ 🏁`;
            
            // 📊 [ระบบบันทึกสถิติแบบละเอียดแยกขา + ผลไฮโล + ชื่อไพ่ถูกต้อง]
            
            // 1. จัดการชื่อเจ้ามือ
            let dealerDisplay = ""; 
            if (tempDealerResult.name.includes("ป๊อก 9")) dealerDisplay = "P9";
            else if (tempDealerResult.name.includes("ป๊อก 8")) dealerDisplay = "P8";
            else if (tempDealerResult.name.includes("ตอง")) dealerDisplay = "ต";
            else if (tempDealerResult.name.includes("สเตฟฟลัช")) dealerDisplay = "รส";
            else if (tempDealerResult.name.includes("เซียน")) dealerDisplay = "ซ";
            else if (tempDealerResult.name.includes("เรียง")) dealerDisplay = "ร";
            else dealerDisplay = `${tempDealerResult.score}`; // แต้มปกติ

            let legHistoryData = {};
            for (let leg = 1; leg <= maxLegs; leg++) {
                if (tempRoomResults[leg]) {
                    const legRes = tempRoomResults[leg];

                    let name2 = legRes.twoCards ? legRes.twoCards.name.replace("แต้มปกติ", "").replace("แต้ม", "").trim() : '-';
                    let name3 = legRes.threeCards ? legRes.threeCards.name.replace("แต้มปกติ", "").replace("แต้ม", "").trim() : '-';

                    if (name2.includes("ป๊อก 9")) name2 = "P9";
                    else if (name2.includes("ป๊อก 8")) name2 = "P8";
                    else if (name2.includes("สเตฟฟลัช")) name3 = "รส";
                    else if (name2.includes("ตอง")) name3 = "ต";
                    else if (name2.includes("เซียน")) name3 = "ซ";
                    else if (name2.includes("เรียง")) name3 = "ร";
                    
                    if (name3.includes("ตอง")) name3 = "ต";
                    else if (name3.includes("สเตฟฟลัช")) name3 = "รส";
                    else if (name3.includes("ป๊อก 9")) name3 = "P9";
                    else if (name3.includes("ป๊อก 8")) name3 = "P8";
                    else if (name3.includes("เซียน")) name3 = "ซ";
                    else if (name3.includes("เรียง")) name3 = "ร";

                    legHistoryData[leg] = {
                        display2: name2,
                        display3: name3,
                        two: legRes.twoCards ? JSON.parse(JSON.stringify(legRes.twoCards)) : null,
                        three: legRes.threeCards ? JSON.parse(JSON.stringify(legRes.threeCards)) : null
                    };
                } else {
                    legHistoryData[leg] = { display2: "-", display3: "-", two: null, three: null };
                }
            }
            
            // 🎲 ตรวจสอบและดึงผลไฮโลให้ชัวร์
            let hiloSummaryText = "-";
            
            // 1. เช็กจาก tempHiloDices (ตามที่เก็บใน Firebase)
            if (typeof tempHiloDices !== 'undefined' && Array.isArray(tempHiloDices) && tempHiloDices.length === 3) {
                const totalScore = tempHiloDices.reduce((a, b) => a + Number(b), 0);
                
                let hiLoResult = "";
                
                // 📌 เช็กตอง (ถ้าเต๋า 3 ลูกเท่ากันหมด)
                const isTriple = tempHiloDices[0] == tempHiloDices[1] && tempHiloDices[1] == tempHiloDices[2];
                
                if (isTriple) {
                    hiLoResult = "ตอง";
                } else if (totalScore === 11) {
                    hiLoResult = "11ไฮโล";
                } else if (totalScore >= 12) {
                    hiLoResult = "สูง";
                } else {
                    hiLoResult = "ต่ำ";
                }

                hiloSummaryText = `${tempHiloDices.join("-")} (${totalScore}แต้ม) ${hiLoResult}`;
            } 
            // 2. เผื่อใช้ตัวแปร hiloDices
            else if (typeof hiloDices !== 'undefined' && Array.isArray(hiloDices) && hiloDices.length > 0) {
                let scoreText = typeof hiloTotalScore !== 'undefined' ? hiloTotalScore : '';
                let resultText = typeof hiloResultText !== 'undefined' ? hiloResultText : '';
                hiloSummaryText = `${hiloDices.join("-")} ${scoreText}แต้ม ${resultText}`.trim();
            } 
            // 3. เผื่อใช้ lastHiloResult
            else if (typeof lastHiloResult !== 'undefined' && lastHiloResult) {
                hiloSummaryText = lastHiloResult;
            }

            matchHistory.push({
                round: currentRound,
                dealer: dealerDisplay,
                dealerObj: JSON.parse(JSON.stringify(tempDealerResult)),
                legs: legHistoryData,
                hilo: hiloSummaryText // บันทึกผลไฮโลลง Array
            });

            if (matchHistory.length > 5) matchHistory.shift(); 

            pastRoundsData[currentRound] = {
                dealer: JSON.parse(JSON.stringify(tempDealerResult)),
                rooms: JSON.parse(JSON.stringify(tempRoomResults)),
                bets: JSON.parse(JSON.stringify(roundBets)),
                hilo: hiloSummaryText // 👈 ยัดเก็บไว้ใน pastRoundsData ด้วย
            };
            
           // ==================== [ส่วนแปลงเป็น CAROUSEL สไลด์ข้าง] ====================
// 1. ตัดแบ่ง flexUserContents ออกเป็นหน้าๆ (แนะนำหน้าละ 3 คนเพื่อให้เห็นยอดคงเหลือชัดเจน)
const chunkSize = 5; 
const userPages = [];
for (let i = 0; i < flexUserContents.length; i += chunkSize) {
    userPages.push(flexUserContents.slice(i, i + chunkSize));
}

// ป้องกันกรณีไม่มีผู้เล่นในรอบ
if (userPages.length === 0) {
    userPages.push([{ "type": "text", "text": "ไม่มีรายการคำนวณในรอบนี้", "color": "#aaaaaa", "size": "xs", "align": "center" }]);
}

// 2. สร้างการ์ด Carousel
const winLossBubbles = userPages.map((pageContents, index) => {
    const isLastPage = index === userPages.length - 1;

    return {
        "type": "bubble",
        "styles": {
            "body": { "backgroundColor": "#191424" } // 🎨 ใช้สีม่วงดำสำหรับสรุปผล
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "md",
            "contents": [
                { "type": "text", "text": "💰 สรุปยอดได้/เสีย ประจำรอบ 🎉", "weight": "bold", "color": "#ffaa00", "size": "md", "align": "center" },
                { "type": "text", "text": `รอบที่: ${currentRound} (หน้า ${index + 1}/${userPages.length})`, "weight": "bold", "color": "#ffffff", "size": "xl", "align": "center", "margin": "none" },
                { "type": "text", "text": `👑 เจ้ามือ: ${tempDealerResult.name}`, "size": "xs", "color": "#aaaaaa", "align": "center" },
                { "type": "separator", "color": "#2a2a35" },
                
                // 👤 รายชื่อสมาชิก
                {
                    "type": "box",
                    "layout": "vertical",
                    "spacing": "sm",
                    "contents": pageContents
                },
                
                { "type": "separator", "color": "#2a2a35" },
                { "type": "text", "text": "✅ ระบบทำการเคลียร์ยอดเงินในรอบนี้เสร็จสิ้นแล้วครับ!", "size": "xs", "color": "#00ff66", "align": "center", "weight": "bold" },
                
                // 🔘 ถ้าเป็นหน้าสุดท้าย ให้แสดงปุ่มกดเปิดรอบถัดไปได้ทันที
                ...(isLastPage ? [
                    {
                        "type": "button",
                        "style": "primary",
                        "color": "#ffaa00",
                        "height": "sm",
                        "margin": "md",
                        "action": {
                            "type": "message",
                            "label": "🚀 เปิดรอบแทงถัดไป",
                            "text": "o" // 👈 เปลี่ยนเป็นคำสั่งเปิดรอบของน้าได้เลยครับ
                        }
                    }
                ] : [])
            ]
        }
    };
});

// 3. กำหนดค่า Carousel Flex
global.currentReplyFlex = {
    "type": "flex",
    "altText": `💰 สรุปยอดได้/เสีย รอบที่: ${currentRound}`,
    "contents": {
        "type": "carousel",
        "contents": winLossBubbles
    }
};
// =========================================================================
            // กำหนดให้ส่งทั้งข้อความธรรมดา (เก็บประวัติ) และแนบกล่องดีไซน์ไปด้วยครับน้า
            tempRoomResults = null;
            tempDealerResult = null;
            roundBets = {};
            hiloRoundBets = {};
            
            replyText = ""; 
        }     
        else if (userMsg === 'no') {
            replyText = "❌ แอดมินยกเลิกผลคำนวณรอบนี้เรียบร้อยครับ สามารถส่งแต้มเข้ามาใหม่ได้เลย";
            tempRoomResults = null;
            tempDealerResult = null;
        }
    } // ปิดตัว else ของเงื่อนไขตรวจเช็กแต้มค้างคัดกรองหลัก
}
            
            // ==================== [ 10. ระบบคู่มือ: คำสั่งสมาชิก (คส), กติกา (กต) และ บัญชี (บช) ] ====================
            else if (userMsg === 'คส' || userMsg === 'กต' || userMsg === 'บช' || userMsg === '/บช') {
                if (userMsg === 'คส') {
                    replyText = `📜 **[ คู่มือคำสั่งสำหรับสมาชิกทุกท่าน ]** 📜\n\n` +
                                `🔹 **C** ➡️ เช็กเลขสมาชิก ยอดเครดิต และสลิปโพยค้าง + เลขบัญชี\n` +
                                `🔹 **บช** ➡️ ดูเลขบัญชีธนาคารสำหรับเติมเงิน\n` +
                                `🔹 **[เลขขา]-[จำนวนเงิน]** ➡️ ส่งโพยเดิมพัน (เช่น 123-100)\n` +
                                `🔹 **รข-[จำนวนเงิน]** ➡️ แทงเหมาหมดทุกขา ขาละเท่าๆ กัน\n` +
                                `🔹 **รจ-[จำนวนเงิน]** ➡️ แทงเจ้ามือชนผู้เล่นทุกขา ขาละเท่าๆ กัน\n` +
                                `🔹 **R** ➡️ ขอดึงโพยคืน/ยกเลิกโพยทั้งหมดในรอบนั้น (ตอนเปิดแทง)\n` +
                                `🔹 **[เลขขา]+** ➡️ ขอจั่วไพ่ใบที่ 3 เพิ่มเติม (เฉพาะขาผู้เล่นปกติ)\n\n` +
                                `💡 *หมายเหตุ: ทุกคำสั่งสามารถพิมพ์ได้ทั้งตัวพิมพ์เล็กและตัวพิมพ์ใหญ่ครับ*`;
                } 
                else if (userMsg === 'กต') {
                    replyText = `💡 สมาชิกพิมพ์ "คส" เพื่อดูวิธีการส่งโพยและคำสั่งอื่นๆ`;
                }
                else if (userMsg === 'บช' || userMsg === '/บช') {
                    // 🏦 บล็อกข้อความตอบกลับเรื่องบัญชีธนาคารโดยเฉพาะ
                    replyText = `🏦 [ กรุณา พิม ฝากจำนวนเงิน ] 🏦`;
                }
            }
                // ==================== [ ระบบดึงโพยและผลไพ่ย้อนหลังรายบุคคล (vรอบ,mสมาชิก) ] ====================
            else if (userMsg.startsWith('v') && userMsg.includes(',m')) {
                // แยกข้อความด้วยเครื่องหมายจุลภาค (,)
                const parts = userMsg.split(',');
                const roundTarget = parseInt(parts[0].replace('v', '')); // ดึงเลขรอบ เช่น v12 -> 12
                const memberTarget = parseInt(parts[1].replace('m', '')); // ดึงเลขสมาชิก เช่น m5 -> 5

                if (isNaN(roundTarget) || isNaN(memberTarget)) {
                    replyText = "⚠️ รูปแบบคำสั่งไม่ถูกต้องครับน้า\nกรุณาพิมพ์ เช่น v12,m5 (เพื่อดูรอบที่ 12 ของสมาชิกคนที่ 5)";
                } else if (!pastRoundsData[roundTarget]) {
                    replyText = `❌ ไม่พบข้อมูลการเล่นของ "รอบที่ ${roundTarget}" ในระบบครับ\n(อาจจะเป็นรอบเก่าก่อนระบบเปิด หรือเซิร์ฟเวอร์เพิ่งรีสตาร์ท)`;
                } else {
                    const historicalRound = pastRoundsData[roundTarget];
                    const historicalDealer = historicalRound.dealer;
                    const historicalRooms = historicalRound.rooms;
                    const historicalBets = historicalRound.bets;

                    // 1. ค้นหาหาชื่อและข้อมูลของสมาชิกคนนี้จากข้อมูลที่บันทึกไว้ในรอบนั้น
                    let targetUid = null;
                    for (let uid in historicalBets) {
                        if (historicalBets[uid][0] && historicalBets[uid][0].memberNumber === memberTarget) {
                            targetUid = uid;
                            break;
                        }
                    }

                    if (!targetUid || !historicalBets[targetUid] || historicalBets[targetUid].length === 0) {
                        replyText = `❌ ไม่พบโพยเดิมพันของ สมาชิกคนที่ ${memberTarget} ในรอบที่ ${roundTarget} ครับ`;
                    } else {
                        const userBets = historicalBets[targetUid];
                        const userName = userBets[0].name;

                        // 2. สร้างหัวข้อรายงานผลไพ่รวมของรอบนั้น
                        let reportText = `🔍 ดึงข้อมูลโพยรายบุคคลย้อนหลัง\n──────────────────\n`;
                        reportText += `🎬 รอบที่: ${roundTarget} \n สมาชิกคนที่ ${memberTarget} (${userName})\n `;
                        reportText += `──────────────────\n`;
                        reportText += `👑 เจ้ามือ: ${historicalDealer.name} (${historicalDealer.mult} เด้ง)\n──────────────────\n`;
                        reportText += `📝 ผลไพ่กระดานรอบที่ ${roundTarget} \n──────────────────\n`;

                        // ลูปพ่นผลไพ่ทั้ง 6 ขาของรอบนั้น
                        for (let leg = 1; leg <= 6; leg++) {
                            if (historicalRooms[leg]) {
                                const res = historicalRooms[leg];
                                let s2 = res.twoCards.score > historicalDealer.score ? "🟢 ชนะ" : (res.twoCards.score < historicalDealer.score ? "🔴 แพ้" : "🟡 เสมอ");
                                let s3 = res.threeCards.score > historicalDealer.score ? "🟢 ชนะ" : (res.threeCards.score < historicalDealer.score ? "🔴 แพ้" : "🟡 เสมor");
                                
                                reportText += `• ขา ${leg}:\n`;
                                reportText += `   - [2ใบ]: ${res.twoCards.name} (${res.twoCards.mult}เด้ง) ${s2}\n`;
                                reportText += `   - [3ใบ]: ${res.threeCards.name} (${res.threeCards.mult}เด้ง) ${s3}\n──────────────────\n`;
                            } else {
                                reportText += `• ขา ${leg} -> ⚠️ ไม่มีผลไพ่ (🔴 แพ้เจ้ามือ)\n`;
                            }
                        }

                        reportText += `📋 โพยรอบนี้ของคุณ \n ${userName} \n──────────────────\n`;

                        let totalWinLoss = 0;
                        let detailRows = "";

                        // 3. เจาะลึกวิเคราะห์โพยและคิดเงินย้อนหลังเพื่อโชว์หลักฐานมัดตัว
                        userBets.forEach((bet) => {
                            let legsToCalc = [];
                            if (bet.betType === "รข" || bet.betType === "รจ") {
                                legsToCalc = ['1', '2', '3', '4', '5', '6'];
                            } else if (bet.betType.startsWith('จ')) {
                                legsToCalc = bet.betType.substring(1).split('');
                            } else {
                                legsToCalc = bet.betType.split('');
                            }

                            // แตกโพยรายบรรทัดส่งโชว์
                            reportText += `- แทงขา [${legsToCalc.join(', ')}] ขาละ ${bet.pricePerLeg} บาท\n`;
                            
                            let drawLegs = [];
                            if (bet.drawStatus) {
                                for (let l in bet.drawStatus) {
                                    if (bet.drawStatus[l] === "จั่ว") drawLegs.push(l);
                                }
                            }
                            if (drawLegs.length > 0) {
                                reportText += `- ขอจั่วเพิ่มขา: [${drawLegs.sort().join(', ')}]\n`;
                            }

                            // คำนวณสรุปรายขาแบบเรียลไทม์เพื่อทำป้ายสรุป
                            legsToCalc.forEach((legStr) => {
                                const legNum = parseInt(legStr);
                                const matchResult = historicalRooms[legNum];
                                if (!matchResult) return;

                                const isBettingOnDealer = (bet.betType === "รจ" || bet.betType.startsWith('จ'));
                                let finalCard;
                                let statusAction = "[อยู่]";

                                if (!isBettingOnDealer) {
                                    const isUserDrawn = (bet.drawStatus && bet.drawStatus[legStr] === "จั่ว");
                                    finalCard = isUserDrawn ? matchResult.threeCards : matchResult.twoCards;
                                    if (isUserDrawn) statusAction = "[จั่ว]";

                                    if (finalCard.score > historicalDealer.score) {
                                        // 🌟 คำนวณหาเพดานค้ำประกันสูงสุดแบบชัวร์ ๆ
    let maxLimit = 3; // ค่าตั้งต้น
    if (bet.maxMultiplier) {
        maxLimit = bet.maxMultiplier;
    } else if (bet.holdCost && bet.actualBet) {
        maxLimit = Math.round(bet.holdCost / bet.actualBet);
    }

    // 🌟 ดักเพดานตัวคูณชนะ ไม่ให้เกินที่ค้ำประกันไว้ในโพย
    let winMultiplier = finalCard.mult;
    if (winMultiplier > maxLimit) {
        winMultiplier = maxLimit;
    }

    let profit = bet.pricePerLeg * winMultiplier;
    totalWinLoss += profit;
    detailRows += `ขาที่ ${legStr} ${statusAction} ชนะ +${profit} (x${winMultiplier})\n`;
} else if (finalCard.score < historicalDealer.score) {
                                        let loseMultiplier = historicalDealer.mult;
                                        if (loseMultiplier > 3) {
                                            loseMultiplier = 3;
                                        }
                                        // 🌟 ดักเพดานตัวคูณแพ้ ไม่ให้เกินที่ค้ำประกันไว้ในโพยเช่นกัน
                                    if (bet.maxMultiplier && loseMultiplier > bet.maxMultiplier) {
                                    loseMultiplier = bet.maxMultiplier;
                                    }
                                        let loss = bet.pricePerLeg * loseMultiplier;
                                        totalWinLoss -= loss;
                                        detailRows += `ขาที่ ${legStr} ${statusAction} แพ้ -${loss}\n`;
                                    } else {
                                        detailRows += `ขาที่ ${legStr} ${statusAction} เสมอ +0\n`;
                                    }
                                } else {
                                    // สำหรับกรณีแทงฝั่งเจ้ามือ
                                    if (matchResult.twoCards.score <= 4 && matchResult.twoCards.mult === 1) {
                                        finalCard = matchResult.threeCards;
                                        statusAction = "[ชน3ใบ]";
                                    } else {
                                        finalCard = matchResult.twoCards;
                                        statusAction = "[ชน2ใบ]";
                                    }

                                    if (historicalDealer.score > finalCard.score) {
    // 🌟 คำนวณหาเพดานค้ำประกันสูงสุดแบบชัวร์ ๆ
    let maxLimit = 3;
    if (bet.maxMultiplier) {
        maxLimit = bet.maxMultiplier;
    } else if (bet.holdCost && bet.actualBet) {
        maxLimit = Math.round(bet.holdCost / bet.actualBet);
    }

    let dealerWinMult = historicalDealer.mult;
    if (dealerWinMult > maxLimit) {
        dealerWinMult = maxLimit;
    }

    let grossWin = bet.pricePerLeg * dealerWinMult;
    let netWin = Math.floor(grossWin * 0.9);
    totalWinLoss += netWin;
    detailRows += `ขาที่ ${legStr} ${statusAction} เจ้าชนะ +${netWin} (หักต๋งแล้ว) (x${dealerWinMult})\n`;
} else if (historicalDealer.score < finalCard.score) {
    // 🌟 คำนวณหาเพดานค้ำประกันสูงสุดแบบชัวร์ ๆ
    let maxLimit = 3;
    if (bet.maxMultiplier) {
        maxLimit = bet.maxMultiplier;
    } else if (bet.holdCost && bet.actualBet) {
        maxLimit = Math.round(bet.holdCost / bet.actualBet);
    }

    let dealerLoseMult = finalCard.mult;
    if (dealerLoseMult > maxLimit) {
        dealerLoseMult = maxLimit;
    }

    let loss = bet.pricePerLeg * dealerLoseMult;
    totalWinLoss -= loss;
    detailRows += `ขาที่ ${legStr} ${statusAction} เจ้าแพ้ -${loss} (x${dealerLoseMult})\n`;
} else {
    detailRows += `ขาที่ ${legStr} ${statusAction} เสมอ +0\n`;
}
                                }
                            });
                        });

                        // 4. ประกอบร่างข้อความสรุปท้ายกระดาษ
                        let signStr = totalWinLoss > 0 ? `กำไร +${totalWinLoss}` : (totalWinLoss < 0 ? `ขาดทุน ${totalWinLoss}` : `เสมอตัว +0`);
                        reportText += `──────────────────\n📊 สรุปดีเทลการเล่น \n──────────────────\n${detailRows}`;
                        reportText += `──────────────────\n👉 ยอดกำไร/ขาดทุนในรอบนี้: ${signStr} บาท`;                   

                        replyText = reportText;
                    }
                }
            }
               
                // ==================== [ ระบบสมาชิกแจ้งถอนเงิน - รูปแบบพิมติดกัน (ถอน500) ] ====================
            else if (userMsg.startsWith('ถอน')) {
                const user = usersWallets[userId];
                
                if (!user) {
                    replyText = "⚠️ คุณยังไม่ได้ลงทะเบียนสมาชิกในระบบครับ";
                } 
                else if (user.isWithdrawLocked) {
                    replyText = `❌ ไม่สามารถทำรายการซ้ำได้ครับ!\n👤 คุณ ${user.name} 有รายการแจ้งถอนค้างอยู่จำนวน ${user.pendingWithdrawAmount} บาท อยู่ในระหว่างรอแอดมินอนุมัติครับ`;
                } 
                else if (user.turnoverTarget > 0) {
                    replyText = `❌ ไม่สามารถแจ้งถอนเงินได้ครับน้า!\n👤 คุณ: ${user.name} (ID: ${user.memberNumber})\n\n🚨 เนื่องจากคุณเลือกรับโบนัสและยังทำยอดเทิร์นไม่ครบ\n📉 ยอดเทิร์นคงค้างที่ต้องเล่นเพิ่มอีก: ${user.turnoverTarget} บาท จึงจะถอนเงินได้ครับ`;
                }
                else {
                    // 🔍 ดึงตัวเลขทั้งหมดที่ต่อท้ายคำว่า "ถอน" ออกมาโดยตรง (พิมพ์ ถอน500 หรือ ถอน 500 ก็ดึงได้หมด)
                    const withdrawAmount = parseInt(userMsg.replace('ถอน', '').trim());

                    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
                        replyText = "⚠️ รูปแบบคำสั่งไม่ถูกต้องครับ กรุณาพิมพ์ระบุจำนวนเงิน เช่น ถอน500";
                    } else if (user.balance < withdrawAmount) {
                        replyText = `❌ แจ้งถอนล้มเหลว: ยอดเครดิตของคุณมีไม่เพียงพอครับ (เครดิตปัจจุบัน: ${user.balance} บาท)`;
                    } else {
                        // 🔒 สั่งล็อกสถานะบัญชี และจำยอดเงินที่ต้องการถอนไว้ (ยังไม่หักเครดิตจริง)
                        user.isWithdrawLocked = true;
                        user.pendingWithdrawAmount = withdrawAmount;

                        // 💡 เพิ่มเข้าคิวถอนเงิน
                        withdrawQueue.push({ 
                            memberNumber: user.memberNumber, 
                            name: user.name, 
                            amount: withdrawAmount, 
                            time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) 
                        });
                        
                        await saveDataToFirebase(); // เซฟถาวรลง Firebase

                       // 🔔 [อัปเดตขั้นสุด] ดึงข้อมูลธนาคาร เลขบัญชี และเครดิตสุทธิคงเหลือในระบบขึ้นโชว์ในการ์ดแอดมิน
                        const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db"; // ไอดีไลน์ส่วนตัวของน้า
                        
                        const adminWithdrawAlertFlex = {
                            "type": "flex",
                            "altText": `🚨 แจ้งถอนใหม่! คุณ ${user.name} ยอด ${withdrawAmount} บาท`,
                            "contents": {
                                "type": "bubble",
                                "styles": {
                                    "header": { "backgroundColor": "#141416" },
                                    "body": { "backgroundColor": "#1e1e22" },
                                    "footer": { "backgroundColor": "#141416" }
                                },
                                "header": {
                                    "type": "box",
                                    "layout": "vertical",
                                    "contents": [
                                        { "type": "text", "text": "🚨 มีรายการแจ้งถอนเงินใหม่!", "weight": "bold", "color": "#ff3b47", "size": "md", "align": "center" }
                                    ]
                                },
                                "body": {
                                    "type": "box",
                                    "layout": "vertical",
                                    "spacing": "sm",
                                    "contents": [
                                        {
                                            "type": "box",
                                            "layout": "horizontal",
                                            "contents": [
                                                { "type": "text", "text": "🆔 สมาชิกเด่น:", "size": "sm", "color": "#8e8e93" },
                                                { "type": "text", "text": `ลำดับที่ ${user.memberNumber}`, "size": "sm", "color": "#ffffff", "weight": "bold", "align": "end" }
                                            ]
                                        },
                                        {
                                            "type": "box",
                                            "layout": "horizontal",
                                            "contents": [
                                                { "type": "text", "text": "👤 ชื่อลูกค้า:", "size": "sm", "color": "#8e8e93" },
                                                { "type": "text", "text": `คุณ ${user.name}`, "size": "sm", "color": "#ffffff", "weight": "bold", "align": "end" }
                                            ]
                                        },
                                        {
                                            "type": "box",
                                            "layout": "horizontal",
                                            "contents": [
                                                { "type": "text", "text": "🏦 ธนาคาร:", "size": "sm", "color": "#8e8e93" },
                                                { "type": "text", "text": `${user.bankName || "ไม่ได้ระบุ"}`, "size": "sm", "color": "#ffffff", "weight": "bold", "align": "end" }
                                            ]
                                        },
                                        {
                                            "type": "box",
                                            "layout": "horizontal",
                                            "contents": [
                                                { "type": "text", "text": "💳 เลขบัญชี:", "size": "sm", "color": "#8e8e93" },
                                                { "type": "text", "text": `${user.bankAccount || "ไม่ได้ระบุ"}`, "size": "sm", "color": "#00bfff", "weight": "bold", "align": "end" }
                                            ]
                                        },
                                        { "type": "separator", "margin": "xs", "color": "#3a3a3c" },
                                        {
                                            "type": "box",
                                            "layout": "horizontal",
                                            "contents": [
                                                { "type": "text", "text": "💰 เงินรวมในระบบ:", "size": "sm", "color": "#ffaa00", "weight": "bold" },
                                                { "type": "text", "text": `${user.balance.toLocaleString()} บาท`, "size": "sm", "color": "#ffaa00", "weight": "bold", "align": "end" }
                                            ]
                                        },
                                        {
                                            "type": "box",
                                            "layout": "horizontal",
                                            "contents": [
                                                { "type": "text", "text": "💸 ยอดที่แจ้งถอน:", "size": "sm", "color": "#ffffff", "weight": "bold" },
                                                { "type": "text", "text": `${withdrawAmount.toLocaleString()} บาท`, "size": "md", "color": "#ff3b47", "weight": "bold", "align": "end" }
                                            ]
                                        },
                                        { "type": "separator", "margin": "xs", "color": "#3a3a3c" },
                                        { "type": "text", "text": "💡 ตรวจสอบยอด 'เงินรวมในระบบ' เทียบกับ 'ยอดที่แจ้งถอน' ให้เรียบร้อยก่อนกดอนุมัตินะครับน้า", "color": "#aaaaaa", "size": "xs", "wrap": true, "margin": "sm" }
                                    ]
                                },
                                "footer": {
                                    "type": "box",
                                    "layout": "vertical",
                                    "spacing": "sm",
                                    "contents": [
                                        {
                                            "type": "button",
                                            "style": "primary",
                                            "color": "#00aa5b",
                                            "height": "sm",
                                            "action": {
                                                "type": "message",
                                                "label": "✅ อนุมัติโอนเงินสำเร็จ (y)",
                                                "text": `y ${user.memberNumber}`
                                            }
                                        }
                                    ]
                                }
                            }
                        };

                        // ยิงการ์ดตรงเข้าแชทส่วนตัวแอดมิน
                        try {
                            await axios.post('https://api.line.me/v2/bot/message/push', {
                                to: ADMIN_ID,
                                messages: [adminWithdrawAlertFlex]
                            }, {
                                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` }
                            });
                            console.log("✅ ส่งการ์ดแจ้งถอนเข้าแอดมินเรียบร้อยแล้ว");
                        } catch (err) {
                            console.error("❌ ส่งแจ้งถอนเข้าแชทส่วนตัวแอดมินล้มเหลว:", err.message);
                        }

                        // 🏆 ประกอบร่างกล่อง Flex Message แจ้งถอนเงิน สีดำ-ทอง วิ่งตรงเข้าตัวแปร Global
                        global.currentReplyFlex = {
                            type: "flex",
                            altText: "⏳ ระบบรับเรื่องแจ้งถอนเงินสำเร็จ",
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
                                            text: "⏳ ระบบรับเรื่องแจ้งถอนเงิน",
                                            weight: "bold",
                                            color: "#d4af37",
                                            size: "sm"
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
                                                { type: "text", text: "👤 ชื่อลูกค้า", color: "#8e8e93", size: "xs" },
                                                { type: "text", text: `${user.name} (ID: ${user.memberNumber})`, color: "#ffffff", size: "xs", align: "end", weight: "bold" }
                                            ]
                                        },
                                        {
                                            type: "box",
                                            layout: "horizontal",
                                            margin: "sm",
                                            contents: [
                                                { type: "text", text: "💰 ยอดที่แจ้งถอน", color: "#ffffff", size: "sm", weight: "bold" },
                                                { type: "text", text: `${withdrawAmount.toLocaleString()} บาท`, color: "#e53e3e", size: "md", align: "end", weight: "bold" }
                                            ]
                                        },
                                        { type: "separator", margin: "md", color: "#3a3a3c" },
                                        {
                                            type: "text",
                                            text: "⚠️ สถานะบัญชี: ถูกล็อกชั่วคราว! ระหว่างนี้จะไม่สามารถส่งโพยแทง หรือแจ้งถอนซ้ำได้ จนกว่าแอดมินจะกดยืนยันยอดโอนสำเร็จครับ",
                                            color: "#aaaaaa",
                                            size: "xxs",
                                            margin: "md",
                                            wrap: true
                                        },
                                        { type: "separator", margin: "md", color: "#3a3a3c" },
                                        {
                                            type: "box",
                                            layout: "vertical",
                                            margin: "md",
                                            contents: [
                                                { type: "text", text: "📢 สำหรับแอดมินอนุมัติ", color: "#d4af37", size: "xxs", weight: "bold" },
                                                { type: "text", text: `กรุณาตรวจสอบยอดโอน และพิมพ์คำสั่งนี้เพื่ออนุมัติ:\ny ${user.memberNumber}`, color: "#ffffff", size: "xs", margin: "xs", weight: "bold", wrap: true }
                                            ]
                                        }
                                    ]
                                }
                            }
                        };
                    }
                }
            }
                // ==================== [ ระบบแอดมินอนุมัติการถอนเงิน (y เลขสมาชิก แบบคนเดียว หรือ หลายคนพร้อมกัน) ] ====================
else if (command.toLowerCase() === "y") {
    if (!ADMIN_IDS.includes(userId)) {
    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
} else {
        // 🎯 ดึงเลขสมาชิกทั้งหมดจากตัวแปร args (เช่น พิมพ์ "y 1 2" -> args จะได้ ['1', '2'])
        // แต่ถ้าแอดมินพิมพ์แค่ "y" ลอยๆ args ตัวแรกสุด (args[0]) อาจจะเป็นคำว่า y ให้ข้ามไปเอาตัวถัดไป
        let targetMemberIds = args.map(id => parseInt(id)).filter(id => !isNaN(id));
        
        // ถ้าพิมพ์ y 1 แล้ว args ดึงมาได้เลขเลย ให้ใช้ได้เลย แต่ถ้าไม่มีเลข ลองแกะจากข้อความเต็ม (userMsg) เผื่อไว้
        if (targetMemberIds.length === 0) {
            targetMemberIds = userMsg.replace(/y|Y/, '').trim().split(/\s+/).map(id => parseInt(id)).filter(id => !isNaN(id));
        }

        if (targetMemberIds.length === 0) {
            replyText = "⚠️ รูปแบบคำสั่งไม่ถูกต้อง กรุณาพิมพ์: y ตามด้วยเลขสมาชิก\n(ตัวอย่างเช่น: Y 1 หรือโอนพร้อมกันหลายคนพิมพ์: Y 1 2 3)";
        } else {
            let successReports = [];
            let errorReports = [];

            // วนลูปประมวลผลเลขสมาชิกทุกคนที่ส่งมาพร้อมกัน
            for (let targetMemberId of targetMemberIds) {
                let foundUserKey = null;
                for (let key in usersWallets) {
                    if (usersWallets[key].memberNumber === targetMemberId) {
                        foundUserKey = key;
                        break;
                    }
                }

                if (!foundUserKey) {
                    errorReports.push(`❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับ`);
                } else {
                    const user = usersWallets[foundUserKey];
                    
                    if (!user.isWithdrawLocked) {
                        errorReports.push(`⚠️ สมาชิก ID: ${targetMemberId} คุณ ${user.name} ไม่ได้มียอดแจ้งถอนค้างไว้ครับ`);
                    } else {
                        const finalAmount = user.pendingWithdrawAmount;
                        
                        // ✅ 1. ทำการหักเงินเครดิตจริงออกจากกระเป๋า
                        user.balance -= finalAmount;

                        // 🟢 [เพิ่มบรรทัดนี้ลงไปครับ] สะสมยอดถอนสำเร็จของสมาชิกคนนี้
                        user.totalWithdraw = (user.totalWithdraw || 0) + finalAmount;

                        // 🌟 [วางตรงนี้] ถ้าถอนเงินจนเครดิตหมดกระเป๋า (balance เหลือ 0) ให้ล้างโปรโมชั่นและเทิร์นทันที
                        user.activePromotion = null;
                        user.turnoverTarget = 0;
                        
                        // 🔓 2. ทำการปลดล็อกบัญชีให้ส่งโพยใหม่ได้ตามปกติ
                        user.isWithdrawLocked = false;
                        user.pendingWithdrawAmount = 0;

                        // 🗑️ 3. ลบสมาชิกคนนี้ออกจากคิวรอถอน (withdrawQueue) ทันที ยอดใน "ชถ" จะหายไป
                        if (typeof withdrawQueue !== 'undefined') {
                            withdrawQueue = withdrawQueue.filter(item => item.memberNumber !== targetMemberId);
                        }

                        // เก็บข้อความสำเร็จของแต่ละคนไว้ประกอบร่างตอนท้าย
                        successReports.push(
                            `👤 คุณ: ${user.name} (ID: ${user.memberNumber})\n` +
                            `💸 หักเครดิตเรียบร้อย: -${finalAmount} บาท\n` +
                            `💰 ยอดเครดิตคงเหลือ: ${user.balance} บาท\n` +
                            `🔓 สถานะบัญชี: ปลดล็อกเรียบร้อย`
                        );
                    }
                }
            }
            // 💾 4. บันทึกลง Firebase (ปลอดภัยด้วย try...catch เพื่อไม่ให้บอทเงียบ)
            if (successReports.length > 0) {
                try {
                    // เซฟกระเป๋าเงินและข้อมูลหลัก
                    await saveDataToFirebase(); 

                    // จัดการเคลียร์ node withdrawQueue บน Firebase
                    if (typeof withdrawQueue !== 'undefined') {
                        if (withdrawQueue.length === 0) {
                            // ถ้ามี db ให้ลบ node ทิ้ง ถ้าไม่มีก็ข้ามไปไม่ให้ crash
                            if (typeof db !== 'undefined') {
                                await db.ref('withdrawQueue').remove().catch(e => console.log(e));
                            }
                        } else {
                            if (typeof db !== 'undefined') {
                                await db.ref('withdrawQueue').set(withdrawQueue).catch(e => console.log(e));
                            }
                        }
                    }
                } catch (err) {
                    console.error("Firebase Sync Error (แต่ระบบหักเงินทำงานแล้ว):", err);
                }
            }

            // --- จัดรูปแบบข้อความแสดงผลลัพธ์ให้สวยงาม ---
            let finalReply = "";
            if (successReports.length > 0) {
                finalReply += `✅ [อนุมัติถอนเงินสำเร็จ] 🎉\n──────────────────\n` + successReports.join('\n──────────────────\n');
            }
            if (errorReports.length > 0) {
                if (finalReply !== "") finalReply += `\n\n──────────────────\n🚨 รายงานข้อผิดพลาด:\n`;
                finalReply += errorReports.join('\n');
            }

            // แสดงยอดคงค้างในคิวปัจจุบันพ่วงท้าย
            const queueCount = typeof withdrawQueue !== 'undefined' ? withdrawQueue.length : 0;
            finalReply += `\n──────────────────\n📊 คงเหลือในคิวรอถอน: ${queueCount} รายการ (พิมพ์ "ชถ" เพื่อดูคิวปัจจุบัน)`;

            replyText = finalReply;
        }
    }
}
                // ==================== [ ระบบแอดมินเรียกดูรายงานผลและโพยย้อนหลัง (v เลขรอบ) ] ====================
            else if (command.toLowerCase() === "v") {
                if (!ADMIN_IDS.includes(userId)) {
    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
} else {
                    const targetRound = parseInt(args[1]);

                    if (!targetRound || isNaN(targetRound)) {
                        replyText = "⚠️ รูปแบบคำสั่งไม่ถูกต้อง กรุณาพิมพ์: v [เลขรอบ] หรือ V [เลขรอบ] (ตัวอย่างเช่น: V 5)";
                    } else {
                        // ค้นหาข้อความรายงานในคลังประวัติ
                        const savedReport = detailedRoundHistory[targetRound];

                        if (!savedReport) {
                            replyText = `❌ ไม่พบข้อมูลบันทึกสรุปผลของ "รอบที่ ${targetRound}" ในระบบครับ (ระบบจะจำข้อมูลตั้งแต่เปิดเซิร์ฟเวอร์ล่าสุดครับ)`;
                        } else {
                            // 📄 ดีดรายงานสรุปยอดโชว์ใหม่อีกครั้ง
                            replyText = `📋 **[ ค้นพบข้อมูลย้อนหลัง ]** 📋\n` +
                                        `🔍 แอดมินเรียกดูประวัติเก่าของ รอบที่: ${targetRound}\n` +
                                        `──────────────────\n\n` + 
                                        savedReport;
                        }
                    }
                }
            }
         // ==================== [ 7. ระบบลงทะเบียน / เช็กบัตรสมาชิก ] ====================
            else {
                const isRegistered = usersWallets[userId] ? true : false;

                if (!isRegistered) {
                    if (originalMsg.startsWith('C/') || originalMsg.startsWith('c/')) {
                        const registerCode = originalMsg.substring(2).trim(); // ดึงเฉพาะตัวเลขหลัง c/
                        const pendingCodeKey = `c_${registerCode}`; // แปลงเป็น c_748100

                        try {
                            // 🔍 ดึงข้อมูลจาก Firebase โดยใช้ axios (REST API)
                            const resData = await axios.get(`${FIREBASE_URL}pending_verify/${pendingCodeKey}.json`);
                            const webData = resData.data;

                            // ❌ กรณีที่ไม่พบรหัสโค้ดใน Firebase (webData เป็น null)
                            if (!webData) {
                                await axios.post('https://api.line.me/v2/bot/message/reply', {
                                    replyToken: replyToken,
                                    messages: [{
                                        "type": "text",
                                        "text": `❌ ไม่พบรหัสยืนยัน [ C/${registerCode} ] ในระบบ\nรหัสนี้อาจถูกใช้งานไปแล้ว หรือคุณกรอกรหัสไม่ถูกต้องครับ`
                                    }]
                                }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
                                return res.sendStatus(200);
                            }

                            // 🟢 ดึงข้อมูลจาก Firebase
                            const fullName = webData.name || webData.fullName || "";
                            const nickname = webData.nickname || webData.lineName || fullName || "สมาชิก";
                            const bankName = webData.bankName || "";
                            const bankAccount = webData.bankAccount || webData.accountNumber || "";
                            const pictureUrl = webData.pictureUrl || webData.linePictureUrl || ""; // 👈 เพิ่มจุดนี้
                            
                            // 💾 บันทึกข้อมูลลงกระเป๋าเงิน (usersWallets)
                            usersWallets[userId] = {
                                memberNumber: nextMemberId,
                                name: fullName,
                                nickname: nickname,
                                pictureUrl: pictureUrl,
                                balance: 0, 
                                turnoverTarget: 0,
                                turnoverCount: 0,
                                isWithdrawLocked: false,
                                pendingWithdrawAmount: 0,
                                bankName: bankName,
                                bankAccount: bankAccount,
                                totalDeposit: 0,       // ยอดฝากสำเร็จสะสม
                                totalWithdraw: 0,      // ยอดถอนสำเร็จสะสม
                                lastCashbackClaim: null // เวลาที่กดรับยอดเสียล่าสุด
                            };

                            // 🧹 ลบโค้ดนี้ออกจาก pending_verify ใน Firebase
                            await axios.delete(`${FIREBASE_URL}pending_verify/${pendingCodeKey}.json`);

                            // ==================== [ 🚀 ยิง Flex Message แจ้งสมัครสมาชิกสำเร็จ ] ====================
                            const userAvatar = pictureUrl || "https://cdn-icons-png.flaticon.com/512/847/847969.png";
                            
                            await axios.post('https://api.line.me/v2/bot/message/reply', {
                                replyToken: replyToken,
                                messages: [
                                    {
                                        "type": "flex",
                                        "altText": "🎉 ลงทะเบียนสมาชิกใหม่สำเร็จ! 🎉",
                                        "contents": {
                                            "type": "bubble",
                                            "styles": { "body": { "backgroundColor": "#0c1921" } },
                                            "body": {
                                                "type": "box",
                                                "layout": "vertical",
                                                "spacing": "md",
                                                "contents": [
                                                    // 🖼️ เพิ่มส่วนแสดงรูปโปรไฟล์วงกลมด้านบน Flex
                                                    {
                                                        "type": "box",
                                                        "layout": "vertical",
                                                        "alignItems": "center",
                                                        "margin": "sm",
                                                        "contents": [
                                                            {
                                                                "type": "image",
                                                                "url": userAvatar,
                                                                "size": "md",
                                                                "aspectRatio": "1:1",
                                                                "aspectMode": "cover"
                                                            }
                                                        ]
                                                    },
                                                    { "type": "text", "text": "🎉 ลงทะเบียนสมาชิกใหม่สำเร็จ! 🎉", "weight": "bold", "color": "#00ffcc", "size": "md", "align": "center" },
                                                    { "type": "separator", "color": "#183242" },
                                                    {
                                                        "type": "box",
                                                        "layout": "vertical",
                                                        "spacing": "xs",
                                                        "contents": [
                                                            {
                                                                "type": "box", "layout": "horizontal", "contents": [
                                                                    { "type": "text", "text": "🆔 รหัสสมาชิก:", "size": "xs", "color": "#8ab4cd" },
                                                                    { "type": "text", "text": `${nextMemberId}`, "size": "xs", "color": "#ffffff", "align": "end", "weight": "bold" }
                                                                ]
                                                            },
                                                            {
                                                                "type": "box", "layout": "horizontal", "contents": [
                                                                    { "type": "text", "text": "👤 ชื่อ-นามสกุล:", "size": "xs", "color": "#8ab4cd" },
                                                                    { "type": "text", "text": `${fullName}`, "size": "xs", "color": "#ffffff", "align": "end" }
                                                                ]
                                                            },
                                                            {
                                                                "type": "box", "layout": "horizontal", "contents": [
                                                                    { "type": "text", "text": "🏦 ธนาคาร:", "size": "xs", "color": "#8ab4cd" },
                                                                    { "type": "text", "text": `${bankName}`, "size": "xs", "color": "#ffffff", "align": "end" }
                                                                ]
                                                            },
                                                            {
                                                                "type": "box", "layout": "horizontal", "contents": [
                                                                    { "type": "text", "text": "💰 ยอดคงเหลือ:", "size": "xs", "color": "#8ab4cd" },
                                                                    { "type": "text", "text": "0 บาท", "size": "xs", "color": "#00ff66", "align": "end", "weight": "bold" }
                                                                ]
                                                            }
                                                        ]
                                                    },
                                                    { "type": "separator", "color": "#183242" },
                                                    { "type": "text", "text": "🔒 ข้อมูลบัญชีธนาคารบันทึกเข้าคลังหลังบ้านปลอดภัย ไม่แสดงหน้ากลุ่มค่ะ", "size": "10px", "color": "#a2c1d4", "wrap": true },
                                                    { "type": "separator", "color": "#183242" },
                                                    { "type": "text", "text": "💡 ตอนนี้คุณสามารถส่งโพย หรือ ฝากเครดิตพิมพ์ [ฝาก จำนวนเงิน] ได้เลย", "size": "xs", "color": "#00ffcc", "wrap": true, "style": "italic" }
                                                ]
                                            }
                                        }
                                    }
                                ]
                            }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });

                            nextMemberId++;
                            await saveDataToFirebase();
                            return res.sendStatus(200);

                        } catch (err) {
                            console.error("Error in c/ register process:", err);
                            return res.sendStatus(200);
                        }

                    } else {
                        // ==================== [ 📢 Flex Message แจ้งเตือนคนยังไม่สมัคร ] ====================
try {
    await axios.post('https://api.line.me/v2/bot/message/reply', {
        replyToken: replyToken,
        messages: [
            {
                "type": "flex",
                "altText": "📢 ยินดีต้อนรับครับสมาชิกใหม่ กรุณาลงทะเบียน",
                "contents": {
                    "type": "bubble",
                    "styles": { "body": { "backgroundColor": "#0d161b" }, "footer": { "backgroundColor": "#0d161b" } },
                    "body": {
                        "type": "box",
                        "layout": "vertical",
                        "spacing": "md",
                        "contents": [
                            { "type": "text", "text": "📢 ยินดีต้อนรับครับสมาชิกใหม่ 🤝", "weight": "bold", "color": "#00ffcc", "size": "md", "align": "center" },
                            { "type": "separator", "color": "#1d2d35" },
                            { "type": "text", "text": "⚠️ คุณยังไม่ได้ลงทะเบียนในระบบ", "size": "xs", "color": "#ffcc00", "align": "center", "weight": "bold" },
                            { "type": "separator", "color": "#1d2d35" },
                            { "type": "text", "text": "กรุณาลงทะเบียนผ่านเว็บสมัครสมาชิก จากนั้นคัดลอกรหัส (เช่น C/748100) มาวางในกลุ่มนี้เพื่อเปิดใช้งานครับ", "size": "xs", "color": "#cccccc", "wrap": true },
                            { "type": "separator", "color": "#1d2d35" },
                            { "type": "text", "text": "📌 ตัวอย่างการยืนยัน: C/748100", "size": "xs", "color": "#00ffcc", "align": "center", "weight": "bold" }
                        ]
                    },
                    "footer": {
                        "type": "box",
                        "layout": "vertical",
                        "contents": [
                            {
                                "type": "button",
                                "action": {
                                    "type": "uri",
                                    "label": "🌐 กดที่นี่เพื่อสมัครสมาชิก",
                                    "uri": "https://thegayyogay1-jpg.github.io/pokdeng-register/register.html" // 👈 เปลี่ยนตรงนี้เป็นลิงก์สมัครสมาชิกของคุณ
                                },
                                "style": "primary",
                                "color": "#00ffcc",
                                "height": "sm"
                            }
                        ]
                    }
                }
            }
        ]
    }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
} catch (err) { console.error("Error sending alert non-registered flex:", err); }
return res.sendStatus(200);
                    }
                } else {
                    // 🟢 กรณีที่เป็นสมาชิกเก่าที่ลงทะเบียนเรียบร้อยแล้ว
                    const user = usersWallets[userId];
                    
                   // ==================== [ คำสั่งเช็กยอด c เวอร์ชันการ์ดดำทอง + ไฮโล ] ====================
if (userMsg === 'c') {
    // 🛡️ 1. ระบบ Anti-Spam กันสมาชิกกด c ย้ำๆ (1.5 วินาทีต่อคน)
    if (!global.cCooldowns) global.cCooldowns = new Map();
    const now = Date.now();
    const lastUsed = global.cCooldowns.get(userId) || 0;
    const cooldownTime = 1500;

    if (now - lastUsed < cooldownTime) {
        replyText = null;
        return; 
    }
    global.cCooldowns.set(userId, now);

    // 🔄 1.1 ดึงข้อมูลล่าสุดจาก Firebase แบบตรงเป้า ก่อนประมวลผลการ์ด c (เพิ่มตรงนี้!)
    try {
        const freshRes = await axios.get(`${FIREBASE_URL}system_data/usersWallets/${userId}.json`);
        if (freshRes.data) {
            usersWallets[userId] = freshRes.data; // อัปเดต RAM หลัก
            Object.assign(user, freshRes.data);   // ⚡ อัปเดตข้อมูลเข้าไปในตัวแปร user โดยไม่ต้อง Re-assign                  // อัปเดตตัวแปร user ของคำสั่ง c ทันที
        }
    } catch (e) {
        console.error("❌ Sync error on c command:", e.message);
    }

    replyText = null;

   // 📝 2. ดึงรายการโพยป๊อกเด้ง และ โพยไฮโล มาจัดแถว (เวอร์ชันรวมยอด)
    let betContents = [];
    const myPokdengBets = roundBets[userId] || [];
    const myHiloBets = (typeof activeHiloBets !== 'undefined' && activeHiloBets[userId]) || 
                       (typeof hiloRoundBets !== 'undefined' && hiloRoundBets[userId]) || [];

    let itemNo = 1;

    // ♠️ 2.1 ดึงโพยป๊อกเด้ง (จัดกลุ่ม + รวมยอด)
    if (myPokdengBets && myPokdengBets.length > 0) {
        // ใช้ Object เพื่อ Group ตามชื่อขา/รายละเอียดการแทง
        const groupedPokdeng = {};

        myPokdengBets.forEach((bet) => {
            const key = bet.detail || bet.betType || "ป๊อกเด้ง";
            if (!groupedPokdeng[key]) {
                groupedPokdeng[key] = {
                    amounts: [],
                    drawLegs: new Set(),
                    totalAmount: 0
                };
            }

            // เก็บประวัติยอดแทง + ยอดรวม
            const betAmt = Number(bet.actualBet || bet.amount || 0);
            groupedPokdeng[key].amounts.push(betAmt);
            groupedPokdeng[key].totalAmount += betAmt;

            // รวบรวมข้อมูลการจั่ว (ถ้ามี)
            if (bet.drawStatus) {
                for (let leg in bet.drawStatus) {
                    if (bet.drawStatus[leg] === "จั่ว") {
                        groupedPokdeng[key].drawLegs.add(leg);
                    }
                }
            }
        });

        // นำข้อมูลที่ Group แล้วมาสร้าง Flex Text
        Object.entries(groupedPokdeng).forEach(([detail, data]) => {
            // สร้างรูปแบบ เช่น (100+20) = 120 บาท หรือ 100 บาท (กรณีแทงรอบเดียว)
            const historyText = data.amounts.length > 1 
                ? `(${data.amounts.join('+')}) = ${data.totalAmount.toLocaleString()} บาท` 
                : `${data.totalAmount.toLocaleString()} บาท`;

            let betText = `${itemNo++}. ♠️ ${detail} : ${historyText}`;

            // ใส่สถานะจั่ว
            if (data.drawLegs.size > 0) {
                const drawList = Array.from(data.drawLegs).sort().join(', ');
                betText += ` 🃏 (จั่ว: ${drawList})`;
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

        const totalPokdengHold = myPokdengBets.reduce((sum, bet) => sum + (bet.holdCost || 0), 0);
        betContents.push({
            type: "text",
            text: `🔒 ประกันเด้งที่ล็อก: ${totalPokdengHold.toLocaleString()} บาท`,
            color: "#ffaa00",
            size: "xs",
            weight: "bold",
            margin: "xs"
        });
    }

    // 🎲 2.2 ดึงโพยไฮโล (จัดกลุ่ม + รวมยอด)
    if (myHiloBets && myHiloBets.length > 0) {
        const groupedHilo = {};
        let totalHiloBet = 0;

        myHiloBets.forEach((hBet) => {
            if (!hBet) return;
            const targetName = hBet.target || hBet.category || "ไฮโล";
            const amount = Number(hBet.price || hBet.amount || 0);
            totalHiloBet += amount;

            if (!groupedHilo[targetName]) {
                groupedHilo[targetName] = {
                    amounts: [],
                    totalAmount: 0
                };
            }
            groupedHilo[targetName].amounts.push(amount);
            groupedHilo[targetName].totalAmount += amount;
        });

        Object.entries(groupedHilo).forEach(([targetName, data]) => {
            const historyText = data.amounts.length > 1 
                ? `(${data.amounts.join('+')}) = ${data.totalAmount.toLocaleString()} บาท` 
                : `${data.totalAmount.toLocaleString()} บาท`;

            betContents.push({
                type: "text",
                text: `${itemNo++}. 🎲 แทง ${targetName} : ${historyText}`,
                color: "#00e5ff",
                size: "xs",
                wrap: true,
                margin: "xs"
            });
        });

        betContents.push({
            type: "text",
            text: `🔒 ทุนไฮโลที่ค้ำ: ${totalHiloBet.toLocaleString()} บาท`,
            color: "#ffaa00",
            size: "xs",
            weight: "bold",
            margin: "xs"
        });
    }

    // ❌ กรณีไม่มีโพยเลยสักเกม
    if (betContents.length === 0) {
        betContents.push({
            type: "text",
            text: "ไม่มีโพยค้างในรอบนี้",
            color: "#888888",
            size: "xs",
            style: "italic"
        });
    }
    
    // 👑 3. เช็กสถานะเทิร์นโอเวอร์
    let turnStatusText = "🔓 ปกติ (ไม่ติดเทิร์น)";
    let turnStatusColor = "#55ff55";
    if (user.turnoverTarget && user.turnoverTarget > 0) {
        turnStatusText = `🔒ติดเทิร์น (เป้า:${user.turnoverTarget} บ.)`;
        turnStatusColor = "#ff5555";
    }

    // 🏆 4. คำนวณหลอด EXP และปุ่มรับโบนัส VIP
    const userTurn = user.totalTurnover || 0;
    const currentVip = user.vipLevel || 0;
    
    const vipConfig = [
        { level: 1, reqTurn: 500, reward: 10 },
        { level: 2, reqTurn: 1000, reward: 20 },
        { level: 3, reqTurn: 3000, reward: 30 },
        { level: 4, reqTurn: 5000, reward: 50 },
        { level: 5, reqTurn: 10000, reward: 120 },
        { level: 6, reqTurn: 30000, reward: 300 },
        { level: 7, reqTurn: 50000, reward: 600 },
        { level: 8, reqTurn: 100000, reward: 1200 },
        { level: 9, reqTurn: 150000, reward: 1800 },
        { level: 10, reqTurn: 250000, reward: 4000 }
    ];

    const nextVip = vipConfig.find(v => v.level > currentVip);
    let vipButtonBox = null;

    if (nextVip) {
        const canClaim = userTurn >= nextVip.reqTurn;

        if (canClaim) {
            // ✅ ผ่านเงื่อนไข: ซ่อนหลอด EXP แล้วโชว์ปุ่มทองให้กดรับรางวัล
            vipButtonBox = {
                type: "box",
                layout: "vertical",
                margin: "md",
                contents: [
                    {
                        type: "button",
                        action: {
                            type: "postback",
                            label: `🎁 กดรับโบนัส VIP ${nextVip.level} (+${nextVip.reward.toLocaleString()} บ.)`,
                            data: `action=claim_vip&ownerId=${userId}&targetLevel=${nextVip.level}`
                        },
                        style: "primary",
                        color: "#d4af37",
                        height: "sm"
                    }
                ]
            };
        } else {
            // ⏳ ยังไม่ผ่าน: คำนวณเปอร์เซ็นต์ + วาดหลอด EXP + กล่องแสดงปุ่มล็อก
            const percent = Math.min(Math.floor((userTurn / nextVip.reqTurn) * 100), 100);
            const barWidth = percent === 0 ? "5%" : `${percent}%`;

            vipButtonBox = {
                type: "box",
                layout: "vertical",
                margin: "md",
                contents: [
                    // 📊 1. ตัวเลขบอกความคืบหน้า (เช่น 0 / 500 บ.)
                    {
                        type: "box",
                        layout: "horizontal",
                        contents: [
                            { type: "text", text: `🎯 VIP ${nextVip.level} ความคืบหน้า`, color: "#aaaaaa", size: "xxs" },
                            { type: "text", text: `${userTurn.toLocaleString()} / ${nextVip.reqTurn.toLocaleString()} บ. (${percent}%)`, color: "#ffd700", size: "xxs", align: "end", weight: "bold" }
                        ]
                    },
                    // 🟢 2. หลอด EXP (Progress Bar)
                    {
                        type: "box",
                        layout: "vertical",
                        backgroundColor: "#333333",
                        height: "6px",
                        cornerRadius: "3px",
                        margin: "xs",
                        contents: [
                            {
                                type: "box",
                                layout: "vertical",
                                backgroundColor: "#d4af37",
                                height: "6px",
                                width: barWidth,
                                cornerRadius: "3px",
                                contents: [{ type: "spacer", size: "xs" }]
                            }
                        ]
                    },
                    // 🔒 3. ปรับเป็น Box สีเทา (ไม่ใช้ Button) เพื่อไม่ให้ติด Error ของ LINE
                    {
                        type: "box",
                        layout: "vertical",
                        backgroundColor: "#3a3a3c",
                        cornerRadius: "md",
                        paddingAll: "sm",
                        margin: "sm",
                        alignItems: "center",
                        contents: [
                            {
                                type: "text",
                                text: `🔒 VIP ${nextVip.level} `,
                                color: "#8e8e93",
                                weight: "bold",
                                size: "xs",
                                align: "center"
                            }
                        ]
                    }
                ]
            };
        }
    } else {
        // 👑 กรณี VIP ตันสูงสุดแล้ว (VIP 10)
        vipButtonBox = {
            type: "box",
            layout: "vertical",
            margin: "md",
            contents: [
                { type: "text", text: "👑 คุณบรรลุระดับ VIP สูงสุดเรียบร้อยแล้ว!", color: "#ffd700", size: "xs", align: "center", weight: "bold" }
            ]
        };
    }

  // 🌟 4. เตรียมข้อมูลองค์ประกอบการ์ด (bodyElements)
    const profileImg = user.pictureUrl || "https://cdn-icons-png.flaticon.com/512/847/847969.png";
    const displayName = user.nickname || user.name || "สมาชิก";

    const bodyElements = [
        // 4.1 แถบโปรไฟล์ (รูปวงกลมขนาดพอดี + ชื่อ + ID + VIP)
        {
            type: "box",
            layout: "horizontal",
            alignItems: "center",
            spacing: "md",
            contents: [
                {
                    type: "box",
                    layout: "vertical",
                    cornerRadius: "100px",
                    width: "40px",
                    height: "40px",
                    contents: [
                        {
                            type: "image",
                            url: profileImg,
                            size: "full",
                            aspectRatio: "1:1",
                            aspectMode: "cover"
                        }
                    ]
                },
                {
                    type: "box",
                    layout: "vertical",
                    flex: 1,
                    contents: [
                        { type: "text", text: displayName, weight: "bold", color: "#ffffff", size: "sm", wrap: true },
                        { type: "text", text: `ID: ${user.memberNumber || '---'}`, color: "#8e8e93", size: "xxs" }
                    ]
                },
                {
                    type: "box",
                    layout: "vertical",
                    backgroundColor: "#2b2200",
                    cornerRadius: "md",
                    paddingAll: "xs",
                    paddingStart: "sm",
                    paddingEnd: "sm",
                    contents: [
                        { type: "text", text: `🔥 VIP ${currentVip}`, color: "#ffd700", size: "xs", weight: "bold" }
                    ]
                }
            ]
        },
        // 4.2 กล่องคู่ 2 คอลัมน์ (ยอดเงินคงเหลือ + สถานะเทิร์น)
        {
            type: "box",
            layout: "horizontal",
            spacing: "md",
            margin: "md",
            contents: [
                {
                    type: "box",
                    layout: "vertical",
                    backgroundColor: "#141416",
                    cornerRadius: "md",
                    paddingAll: "md",
                    flex: 1,
                    contents: [
                        { type: "text", text: "🪙 เครดิตกระเป๋า", color: "#8e8e93", size: "xxs" },
                        { type: "text", text: `฿${(user.balance || 0).toLocaleString()}`, color: "#2ecc71", size: "sm", weight: "bold", margin: "xs" }
                    ]
                },
                {
                    type: "box",
                    layout: "vertical",
                    backgroundColor: "#141416",
                    cornerRadius: "md",
                    paddingAll: "md",
                    flex: 1,
                    contents: [
                        { type: "text", text: "⛔ สถานะเทิร์น", color: "#8e8e93", size: "xxs" },
                        { 
                            type: "text", 
                            text: (user.turnoverTarget && user.turnoverTarget > 0) ? `ติด ${user.turnoverTarget.toLocaleString()} บ.` : "ปลดล็อกแล้ว", 
                            color: (user.turnoverTarget && user.turnoverTarget > 0) ? "#ff5555" : "#00e5ff", 
                            size: "xs", 
                            weight: "bold", 
                            margin: "xs" 
                        }
                    ]
                }
            ]
        },
        // 4.3 รายการโพย
        { type: "separator", margin: "md", color: "#3a3a3c" },
        {
            type: "box",
            layout: "vertical",
            margin: "md",
            contents: [
                { type: "text", text: "📝 รายการโพยรอบนี้:", color: "#ffd700", size: "xs", weight: "bold" },
                {
                    type: "box",
                    layout: "vertical",
                    margin: "xs",
                    contents: betContents
                }
            ]
        },
        // 4.4 คู่มือช่วยเหลือ
        { type: "separator", margin: "md", color: "#3a3a3c" },
        {
            type: "box",
            layout: "vertical",
            margin: "md",
            contents: [
                { type: "text", text: "📖 คู่มือช่วยเหลือใช้งาน", color: "#8e8e93", size: "xxs", weight: "bold" },
                { type: "text", text: "• พิมพ์ คส เพื่อดูคำสั่งทั้งหมด\n• พิมพ์ ฝาก [จำนวน] หรือ ถอน [จำนวน]\n• พิมพ์ กต เพื่ออ่านกฎกติกาห้อง", color: "#aaaaaa", size: "xxs", margin: "xs", wrap: true }
            ]
        }
    ];

    // 4.5 ปุ่ม VIP ต่อท้าย
    if (vipButtonBox) {
        bodyElements.push({ type: "separator", margin: "md", color: "#3a3a3c" });
        bodyElements.push(vipButtonBox);
    }

    // 4.6 🟢 ปุ่มรับคืนยอดเสีย
    const userData = usersWallets[userId];
    if (global.isCashbackOpen && (!userData || !userData.hasClaimedCashback)) {
        bodyElements.push({
            type: "box",
            layout: "vertical",
            margin: "md",
            contents: [
                {
                    type: "button",
                    action: {
                        type: "postback",
                        label: "🎁 กดรับคืนยอดเสีย 5%",
                        data: `action=ยอดเสีย&ownerId=${userId}`
                    },
                    style: "primary",
                    color: "#e67e22",
                    height: "sm"
                }
            ]
        });
    }

    // 5. ประกอบ Flex Message ส่งออก (Header ปรับให้สั้นลง + ซ้อนตัวอักษร POKNAJA)
    global.currentReplyFlex = {
        type: "flex",
        altText: "📊 บัตรข้อมูลสมาชิก POKNAJA VIP",
        contents: {
            type: "bubble",
            size: "mega",
            styles: {
                header: { backgroundColor: "#0f0f0f" },
                body: { backgroundColor: "#1e1e22" }
            },
            header: {
                type: "box",
                layout: "vertical",
                paddingAll: "none",
                contents: [
                    {
                        type: "image",
                        url: "https://img.freepik.com/free-vector/black-luxury-background-with-golden-elements_52683-10068.jpg",
                        size: "full",
                        aspectRatio: "20:4",
                        aspectMode: "cover"
                    },
                    {
                        type: "box",
                        layout: "vertical",
                        position: "absolute",
                        offsetTop: "0px",
                        offsetBottom: "0px",
                        offsetStart: "0px",
                        offsetEnd: "0px",
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: "#00000055",
                        contents: [
                            {
                                type: "text",
                                text: "✨ POKNAJA ✨",
                                color: "#ffd700",
                                weight: "bold",
                                size: "md",
                                align: "center"
                            },
                            {
                                type: "text",
                                text: "CARD MEMBER VIP",
                                color: "#ffffff",
                                size: "xxs",
                                align: "center",
                                margin: "xs"
                            }
                        ]
                    }
                ]
            },
            body: {
                type: "box",
                layout: "vertical",
                contents: bodyElements
            }
        }
    };
} else if (originalMsg.startsWith('C/') || originalMsg.startsWith('c/')) {
    // 🔒 ป้องกันคนเก่าแอบพิมพ์ C/ มาเปลี่ยนชื่อหลังบ้าน
    replyText = `❌ ไม่สามารถเปลี่ยนข้อมูลเองได้ค่ะคุณ ${user.name}!\n──────────────────\n⚠️ เนื่องจากระบบได้ผูกบัญชีธนาคารของคุณไว้ในคลังความปลอดภัยแล้ว\n\n📌 หากต้องการเปลี่ยน ชื่อ-นามสกุล หรือ เลขบัญชีธนาคาร กรุณาทักแชทติดต่อแอดมินโดยตรงเพื่อขออัปเดตข้อมูลนะคะ 🙏`;
} else {
    // ปล่อยว่างไว้เพื่อให้ข้อความทั่วไปไหลไปเข้า Settlement / แทงโพย ปกติตามธรรมชาติ
    replyText = "";
}
                }
            } // ปิดระบบลงทะเบียน
                      
            // ==================== [ แก้ไขบั๊ก m 1 2: คำสั่ง m เช็กบัญชีแยกรายคนด้วยเว้นวรรคอย่างแม่นยำ ] ====================
            if (userMsg.startsWith('m') && !userMsg.includes('-') && !userMsg.endsWith('+') && userMsg !== 'รข' && userMsg !== 'รจ') {
                // 🚨 กรองขั้นสูงสุด: ถ้าไม่ใช่แอดมินในกล่องกลาง หรือ แอดมินไม่ได้สั่งในแชทส่วนตัว (1 ต่อ 1) ให้บอทเงียบกริบไม่ตอบ
                if (!ADMIN_IDS.includes(userId) || event.source.type !== 'user') {
                    return res.sendStatus(200);
                }

                const args = userMsg.split(/\s+/);

                // 🛠️ แก้ไขจุดนี้: ดึงข้อความดิบทั้งหมดที่ต่อจากตัว m (เก็บเว้นวรรคเอาไว้ตัดแบ่ง)
                const rawData = originalMsg.substring(1).trim(); 
                
                // ตัดแบ่งข้อความด้วยช่องว่าง (เว้นวรรคกี่ช่องก็ได้) เพื่อแยกเป็นอาร์เรย์ตัวเลขเด็ดขาด
                const memberIds = rawData.split(/\s+/).map(id => parseInt(id)).filter(id => !isNaN(id));

                if (memberIds.length === 0) {
                    replyText = "⚠️ รูปแบบคำสั่งไม่ถูกต้องครับน้า กรุณาระบุเลขสมาชิกด้วยครับ เช่น m1 หรือ m 1 2 3";
                } else {
                    let totalReport = ""; // ตัวแปรสำหรับรวบรวมรายงานของทุกคน

                    // วนลูปตรวจสอบข้อมูลตามรายชื่อเลขสมาชิกที่ส่งเข้ามา
                    memberIds.forEach((targetMemberId, index) => {
                        let foundUser = null;
                        for (let id in usersWallets) {
                            if (usersWallets[id].memberNumber === targetMemberId) {
                                foundUser = usersWallets[id];
                                break;
                            }
                        }

                        // ถ้าตรวจสอบแล้วเจอข้อมูลสมาชิกในระบบ
                        if (foundUser) {
                            let withdrawStatusText = "🟢 ไม่มีการแจ้งถอน";
                            if (foundUser.isWithdrawLocked && foundUser.pendingWithdrawAmount > 0) {
                                withdrawStatusText = `🚨 แจ้งถอน: ${foundUser.pendingWithdrawAmount.toLocaleString()} บาท`;
                            }

                            totalReport += `📋 ข้อมูลสมาชิกหมายเลข [ ${foundUser.memberNumber} ]\n` +
                                           `👤 ชื่อ: คุณ ${foundUser.name}\n` +
                                           `💰 เงินในระบบ: ${foundUser.balance.toLocaleString()} บาท\n` +
                                           ` ${withdrawStatusText}\n` +
                                           `🏦 ธนาคาร: ${foundUser.bankName || "ไม่ได้ระบุ"}\n` +
                                           `💳 เลข บช: ${foundUser.bankAccount || "ไม่ได้ระบุ"}`;
                        } else {
                            // ถ้าหาคนไหนไม่เจอ ให้รายงานแจ้งเตือนแยกคนไว้
                            totalReport += `❌ ไม่พบข้อมูลสมาชิกหมายเลข ${targetMemberId} ในระบบครับน้า`;
                        }

                        // ถ้ายังไม่ถึงคนสุดท้าย ให้ขีดเส้นคั่นแยกกล่องข้อมูลให้ชัดเจน
                        if (index < memberIds.length - 1) {
                            totalReport += `\n──────────────────\n`;
                        }
                    });

                    replyText = totalReport;
                }
            }
               // ==================== [ คำสั่งแอดมินส่องภาพรวมสมาชิกทุกคน (พิมพ์: oball) ] ====================
else if (userMsg.toLowerCase().startsWith('oball')) {
    // 🚨 กรองขั้นสูงสุด: ถ้าไม่ใช่แอดมิน หรือ แอดมินไม่ได้สั่งในแชทส่วนตัว (1 ต่อ 1) ให้บอทเงียบกริบไม่ตอบ
    if (!ADMIN_IDS.includes(userId) || event.source.type !== 'user') {
        return res.sendStatus(200);
    }

    const memberKeys = Object.keys(usersWallets);
    const totalMembers = memberKeys.length;

    if (totalMembers === 0) {
        global.currentReplyFlex = {
            "type": "text",
            "text": "📭 ปัจจุบันยังไม่มีสมาชิกสมัครเข้ามาในระบบเลยครับ"
        };
    } else {
        // 1. แยกหมายเลขหน้าที่แอดมินพิมพ์สั่งเข้ามา (เช่น 'oball 2' -> หน้า 2 / ถ้าพิมพ์แค่อีก 'oball' -> หน้า 1)
       const pageMatch = userMsg.match(/oball\s*(\d+)/i);
        let requestedPage = pageMatch ? parseInt(pageMatch[1], 10) : 1;
        if (isNaN(requestedPage) || requestedPage < 1) {
            requestedPage = 1;
        }
        
        const pageSize = 30; // แสดงผลชุดละ 30 คน (3 บับเบิล บับเบิลละ 10 คน เพื่อไม่ให้เกิน 50KB)
        const totalPages = Math.ceil(totalMembers / pageSize);

        // ตรวจสอบกรณีที่แอดมินพิมพ์เลขหน้าเกินจำนวนหน้าที่มีจริง
        if (requestedPage > totalPages) {
            requestedPage = totalPages;
        }

        // 2. ตัดดึงเฉพาะรายชื่อสมาชิกตามหน้าที่เลือก
        const startIndex = (requestedPage - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const pageMemberKeys = memberKeys.slice(startIndex, endIndex);

        // 3. แปลงข้อมูลสมาชิกในหน้านั้นๆ ให้เป็น Component ความจุเบา
        const pageMemberContents = pageMemberKeys.map(key => {
            const user = usersWallets[key];
            const isWithdrawing = global.withdrawQueue && global.withdrawQueue[key];
            const withdrawAmount = isWithdrawing ? global.withdrawQueue[key].amount : 0;

            return {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": isWithdrawing ? "#2d1212" : "#1e1e24",
                "cornerRadius": "sm",
                "paddingAll": "sm",
                "margin": "xs",
                "contents": [
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "contents": [
                            { "type": "text", "text": `[${user.memberNumber || "-"}] ${user.name}`, "weight": "bold", "color": "#ffffff", "size": "xs", "flex": 3, "wrap": false },
                            { "type": "text", "text": `${(user.balance || 0).toLocaleString()} ฿`, "color": "#00ff66", "size": "xs", "align": "end", "weight": "bold", "flex": 2 }
                        ]
                    },
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "contents": [
                            { "type": "text", "text": `🏦 ${user.bankName || "-"}: ${user.bankAccount || "-"}`, "color": "#aaaaaa", "size": "xxs", "flex": 3 },
                            { "type": "text", "text": isWithdrawing ? `❌ ถอน ${withdrawAmount.toLocaleString()}` : "ปกติ", "color": isWithdrawing ? "#ff4d4d" : "#888888", "size": "xxs", "align": "end", "flex": 2 }
                        ]
                    }
                ]
            };
        });

        // 4. หั่นแบ่งสมาชิกในหน้านี้เป็น บับเบิลละ 10 คน (สูงสุด 3 บับเบิล/ชุดคำสั่ง)
        const chunkSize = 10;
        const memberBubblesData = [];
        for (let i = 0; i < pageMemberContents.length; i += chunkSize) {
            memberBubblesData.push(pageMemberContents.slice(i, i + chunkSize));
        }

        // 5. ประกอบเป็น Flex Bubble
        const oballBubbles = memberBubblesData.map((chunkContents, index) => {
            const currentSubPage = index + 1;
            const isLastBubble = (index === memberBubblesData.length - 1);

            const bubbleObj = {
                "type": "bubble",
                "size": "mega",
                "styles": { "body": { "backgroundColor": "#121214" } },
                "body": {
                    "type": "box",
                    "layout": "vertical",
                    "spacing": "xs",
                    "paddingAll": "md",
                    "contents": [
                        { "type": "text", "text": "📊 รายงานข้อมูลสมาชิก", "weight": "bold", "color": "#ffaa00", "size": "sm", "align": "center" },
                        { "type": "text", "text": `👥 รวม ${totalMembers} คน | ชุดที่ ${requestedPage}/${totalPages}`, "size": "xxs", "color": "#aaaaaa", "align": "center" },
                        { "type": "separator", "color": "#2a2a35", "margin": "xs" },
                        {
                            "type": "box",
                            "layout": "vertical",
                            "spacing": "none",
                            "contents": chunkContents
                        }
                    ]
                }
            };

            // ถ้าเป็นการ์ดใบสุดท้ายของชุดคำสั่งนั้น ให้ใส่ข้อความแนะนำพิมพ์ดูชุดถัดไป
            if (isLastBubble) {
                bubbleObj.body.contents.push(
                    { "type": "separator", "color": "#2a2a35", "margin": "sm" },
                    { 
                        "type": "text", 
                        "text": requestedPage < totalPages 
                            ? `💡 ดูชุดถัดไป พิมพ์: oball ${requestedPage + 1}` 
                            : `✅ สิ้นสุดรายการสมาชิกทั้งหมดแล้ว`, 
                        "size": "xxs", 
                        "color": "#00bfff", 
                        "align": "center",
                        "margin": "xs"
                    }
                );
            }

            return bubbleObj;
        });

        // 6. บันทึกลงตัวแปรเตรียมส่งกลับ
        global.currentReplyFlex = {
            "type": "flex",
            "altText": `📊 รายงานสมาชิกทั้งหมด (ชุดที่ ${requestedPage}/${totalPages})`,
            "contents": {
                "type": "carousel",
                "contents": oballBubbles
            }
        };
    }
}
    // ==================== [ คำสั่งแอดมิน: เช็กยอดเครดิตรวมสมาชิกทั้งหมด (พิมพ์: สรุป) ] ====================
else if (userMsg === 'สรุป' || userMsg === 'สรุป' || userMsg === 'สรุป') {
    // 🚨 กรองขั้นสูงสุด: เฉพาะแอดมินสั่งในแชทส่วนตัว (1 ต่อ 1) เท่านั้น
    if (!ADMIN_IDS.includes(userId) || event.source.type !== 'user') {
        return res.sendStatus(200);
    }

    // 1. วนลูปคำนวณยอดเครดิตรวม และนับจำนวนสมาชิกทั้งหมด
    let totalSystemBalance = 0;
    let totalMembers = 0;
    for (let key in usersWallets) {
        totalSystemBalance += (usersWallets[key].balance || 0);
        totalMembers++;
    }

    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

    // 2. ส่ง Flex Message สรุปผล
    global.currentReplyFlex = {
        "type": "flex",
        "altText": `📊 สรุปยอดเครดิตรวมในระบบ (${totalSystemBalance.toLocaleString()} บาท)`,
        "contents": {
            "type": "bubble",
            "styles": { "body": { "backgroundColor": "#121214" } },
            "body": {
                "type": "box",
                "layout": "vertical",
                "spacing": "md",
                "contents": [
                    { "type": "text", "text": "📈 สรุปยอดเครดิตรวมระบบ", "weight": "bold", "color": "#ffaa00", "size": "md", "align": "center" },
                    { "type": "text", "text": `📅 ข้อมูล ณ วันที่: ${todayStr}`, "size": "xs", "color": "#aaaaaa", "align": "center" },
                    { "type": "separator", "color": "#2a2a35" },

                    // 💳 การ์ดแสดงยอดรวม
                    {
                        "type": "box",
                        "layout": "vertical",
                        "backgroundColor": "#1e1e24",
                        "cornerRadius": "md",
                        "paddingAll": "lg",
                        "spacing": "xs",
                        "contents": [
                            { "type": "text", "text": "💰 เครดิตรวมสมาชิกทั้งหมด", "color": "#ffffff", "size": "xs", "weight": "bold" },
                            { "type": "text", "text": `${totalSystemBalance.toLocaleString()} ฿`, "color": "#00ff66", "size": "xl", "weight": "bold", "align": "end" },
                            { "type": "separator", "color": "#33333d", "margin": "sm" },
                            {
                                "type": "box",
                                "layout": "horizontal",
                                "margin": "xs",
                                "contents": [
                                    { "type": "text", "text": "• จำนวนสมาชิกทั้งหมด:", "color": "#aaaaaa", "size": "xs" },
                                    { "type": "text", "text": `${totalMembers} คน`, "color": "#ffaa00", "size": "xs", "align": "end", "weight": "bold" }
                                ]
                            }
                        ]
                    },

                    { "type": "separator", "color": "#2a2a35" },
                    { "type": "text", "text": "⚙️ คำนวณแบบ Real-time", "size": "xs", "color": "#666666", "align": "center" }
                ]
            }
        }
    };
}
    // ==================== [ 1. พิมพ์ rvip เพื่อเรียกปุ่มยืนยัน ] ====================
else if (userMsg.toLowerCase() === 'rvip' || userMsg === 'รีVIP' || userMsg === 'รีvip') {
    if (!ADMIN_IDS.includes(userId)) {
        return res.sendStatus(200);
    }

    global.currentReplyFlex = {
        "type": "flex",
        "altText": "⚠️ ยืนยันการรีเซ็ต VIP",
        "contents": {
            "type": "bubble",
            "styles": { "body": { "backgroundColor": "#121214" } },
            "body": {
                "type": "box",
                "layout": "vertical",
                "spacing": "md",
                "contents": [
                    { "type": "text", "text": "⚠️ ยืนยันการรีเซ็ต VIP", "weight": "bold", "color": "#ff453a", "size": "md", "align": "center" },
                    { "type": "separator", "color": "#2a2a35" },
                    {
                        "type": "text",
                        "text": "คุณกำลังจะทำการล้างระดับ VIP และยอด Turnover ของสมาชิกทุกคนกลับเป็น 0 เพื่อเริ่มซีซั่นใหม่",
                        "color": "#cccccc",
                        "size": "xs",
                        "wrap": true,
                        "align": "center"
                    },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "spacing": "sm",
                        "margin": "md",
                        "contents": [
                            {
                                "type": "button",
                                "action": {
                                    "type": "message",
                                    "label": "🚨 ยืนยันรีเซ็ต VIP ทั้งหมด",
                                    "text": "confirm_reset_vip" // ปรับเป็นตัวพิมพ์เล็ก
                                },
                                "style": "primary",
                                "color": "#ff453a",
                                "height": "sm"
                            },
                            {
                                "type": "button",
                                "action": {
                                    "type": "message",
                                    "label": "❌ ยกเลิก",
                                    "text": "cancel_reset_vip"
                                },
                                "style": "secondary",
                                "color": "#3a3a3c",
                                "height": "sm"
                            }
                        ]
                    }
                ]
            }
        }
    };
}

// ==================== [ 2. เมื่อกดปุ่มยืนยัน ] ====================
else if (userMsg.toLowerCase() === 'confirm_reset_vip') {
    if (!ADMIN_IDS.includes(userId)) {
        return res.sendStatus(200);
    }

    let resetCount = 0;

    // 🔄 ลูปรีเซ็ตค่าใน Object กระเป๋าเงินสมาชิกทุกคน
    for (let key in usersWallets) {
        usersWallets[key].vipLevel = 0;
        usersWallets[key].totalTurnover = 0;
        resetCount++;
    }

    // 💾 เซฟข้อมูลลงไฟล์ (ถ้าน้ามีฟังก์ชันเซฟไฟล์ให้ปลดคอมเมนต์บรรทัดล่างนี้ออกนะครับ)
    // if (typeof saveUsersWallets === 'function') saveUsersWallets();

    global.currentReplyFlex = {
        "type": "flex",
        "altText": "🔄 รีเซ็ต VIP เรียบร้อยแล้ว",
        "contents": {
            "type": "bubble",
            "styles": { "body": { "backgroundColor": "#121214" } },
            "body": {
                "type": "box",
                "layout": "vertical",
                "spacing": "md",
                "contents": [
                    { "type": "text", "text": "✅ รีเซ็ต VIP สำเร็จแล้ว!", "weight": "bold", "color": "#34c759", "size": "md", "align": "center" },
                    { "type": "separator", "color": "#2a2a35" },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "backgroundColor": "#1e1e24",
                        "cornerRadius": "md",
                        "paddingAll": "md",
                        "spacing": "xs",
                        "contents": [
                            { "type": "text", "text": `• สมาชิกที่ถูกรีเซ็ต: ${resetCount} คน`, "color": "#ffffff", "size": "xs" },
                            { "type": "text", "text": "• ระดับ VIP: กลับเป็น VIP 0", "color": "#ffd700", "size": "xs" },
                            { "type": "text", "text": "• ยอดเล่นสะสม: เหลือ 0 บาท", "color": "#ffd700", "size": "xs" }
                        ]
                    },
                    { "type": "separator", "color": "#2a2a35" },
                    { "type": "text", "text": "🚀 เริ่มต้นซีซั่นใหม่เรียบร้อย", "size": "xxs", "color": "#8e8e93", "align": "center" }
                ]
            }
        }
    };
}

// ==================== [ 3. เมื่อกดปุ่มยกเลิก ] ====================
else if (userMsg.toLowerCase() === 'cancel_reset_vip') {
    if (!ADMIN_IDS.includes(userId)) {
        return res.sendStatus(200);
    }
    
    // ตั้งค่าข้อความตอบกลับธรรมดา (ปรับตามโครงสร้างส่งข้อความของน้าได้เลยครับ)
    global.currentReplyText = "❌ **ยกเลิกการรีเซ็ต VIP เรียบร้อยแล้ว** (ข้อมูลยังคงเหมือนเดิม)";
}
    // ==================== [ คำสั่งแอดมิน: เปิด/ปิด การรับคืนยอดเสีย ] ====================
if (command === "เปิดยอดเสีย") {
    if (!ADMIN_IDS.includes(userId)) return res.sendStatus(200);

    global.isCashbackOpen = true;
    
    // 🔄 [รีเซ็ตสิทธิ์รับยอดเสีย] เคลียร์สถานะการกดรับของสมาชิกทุกคนให้เป็น false เพื่อให้รับรอบใหม่ได้
    for (let key in usersWallets) {
        usersWallets[key].hasClaimedCashback = false;
    }

    // 💾 บันทึกการรีเซ็ตสิทธิ์ลง Firebase
    await saveDataToFirebase();
    
    replyText = "🔓 **เปิดระบบรับคืนยอดเสียเรียบร้อยแล้ว!**\nสมาชิกสามารถพิมพ์ \"รับยอดเสีย\" เพื่อกดรับเครดิตคืนได้เลยครับ";

} else if (command === "ปิดยอดเสีย") {
    if (!ADMIN_IDS.includes(userId)) return res.sendStatus(200);

    global.isCashbackOpen = false;

    // 🧹 [ล้างสิทธิ์หมดอายุ] ปรับยอดฝาก-ถอนสะสม ให้เท่ากับ balance ปัจจุบัน เพื่อเซ็ตยอดเสียเหลือ 0
    for (let key in usersWallets) {
        const currentBal = usersWallets[key].balance || 0;
        usersWallets[key].totalDeposit = currentBal;
        usersWallets[key].totalWithdraw = 0;
    }

    await saveDataToFirebase();
    replyText = "🔒 **ปิดระบบรับคืนยอดเสียแล้ว!**\nยอดเสียที่ไม่ถูกกดรับในช่วงเวลาที่กำหนด ถือว่าหมดอายุและถูกรีเซ็ตเป็น 0 เรียบร้อยครับ";
}
            // ==================== [ เพิ่มใหม่: คำสั่งแอดมินลบสมาชิกรายคนผ่านแชทส่วนตัว (del1, del2...) ] ====================
            else if (userMsg.startsWith('d') && !userMsg.includes('-') && !userMsg.endsWith('+')) {
                if (!ADMIN_IDS.includes(userId) || event.source.type !== 'user') {
                    return res.sendStatus(200);
                }

                // ตัดคำว่า del ออกเพื่อเอาตัวเลขสมาชิกที่น้าต้องการลบ
                const targetIdStr = userMsg.replace('d', '').trim();
                const targetMemberId = parseInt(targetIdStr);

                if (!isNaN(targetMemberId)) {
                    let targetUserIdInFirebase = null;
                    let targetName = "";

                    // วนลูปค้นหาเพื่อถอดไอดี LINE ดิบของสมาชิกคนนั้นออกมาจากคลัง
                    for (let id in usersWallets) {
                        if (usersWallets[id].memberNumber === targetMemberId) {
                            targetUserIdInFirebase = id;
                            targetName = usersWallets[id].name;
                            break;
                        }
                    }

                    if (!targetUserIdInFirebase) {
                        replyText = `❌ ไม่พบข้อมูลสมาชิกหมายเลข ${targetMemberId} ในระบบครับน้า`;
                    } else {
                        // ❌ ทำการลบข้อมูลของสมาชิกคนนั้นออกจากออบเจกต์ระบบทันที
                        delete usersWallets[targetUserIdInFirebase];
                        
                        // บันทึกการเปลี่ยนแปลงขึ้นไปบนคลัง Firebase หลังบ้าน
                        await saveDataToFirebase();

                        replyText = `🗑️ ลบข้อมูลสำเร็จเรียบร้อยครับน้า!\n──────────────────\n🆔 สมาชิกหมายเลข: [ ${targetMemberId} ]\n👤 ชื่อเดิม: คุณ ${targetName}\n──────────────────\n✨ ตอนนี้สถานะของเขาถูกเคลียร์เป็นศูนย์เรียบร้อย สามารถให้เขาพิมพ์สมัครสมาชิกผูกบัญชีใหม่ในกลุ่มหลักได้เลยครับ`;
                    }
                }
            }
                // ==================== [ เพิ่มใหม่: คำสั่งแอดมินเช็ก ID LINE ตัวจริงของสมาชิก (id1, id2...) ] ====================
            else if (userMsg.startsWith('id') && !userMsg.includes('-') && !userMsg.endsWith('+')) {
                
                // 🚨 กรองขั้นสูงสุด: ถ้าไม่ใช่แอดมินในกล่องกลาง หรือ แอดมินไม่ได้สั่งในแชทส่วนตัว (1 ต่อ 1) ให้บอทเงียบกริบไม่ตอบ
                if (!ADMIN_IDS.includes(userId) || event.source.type !== 'user') {
                    return res.sendStatus(200);
                }

                const args = userMsg.split(/\s+/);
                const targetMemberId = parseInt(args[0].replace('id', '')); // ดึงตัวเลขจากคำว่า id12 -> 12

                if (!targetMemberId || isNaN(targetMemberId)) {
                    replyText = "❌ รูปแบบผิดครับน้า! ต้องพิมพ์เช่น: id12 (เพื่อเช็ก ID LINE ของสมาชิกเลขที่ 12)";
                } else {
                    let foundUserKey = null;
                    // ค้นหาในฐานข้อมูลกระเป๋าตังค์
                    for (let key in usersWallets) {
                        if (usersWallets[key].memberNumber === targetMemberId) {
                            foundUserKey = key; // key ก็คือ ID LINE (U...) นั่นเองครับ
                            break;
                        }
                    }

                    if (foundUserKey) {
                        const user = usersWallets[foundUserKey];
                        // 👑 พ่น ID LINE ตัวจริงออกมาให้แอดมินก๊อปปี้ได้ง่ายๆ
                        replyText = `👑 [ข้อมูล ID LINE สมาชิก]\n` +
                                    `──────────────────\n` +
                                    `🆔 สมาชิกลำดับที่: ${user.memberNumber}\n` +
                                    `👤 ชื่อ: ${user.name}\n` +
                                    `🔑 ID LINE (ก๊อปปี้ช่องนี้): \n\`${foundUserKey}\``; 
                                    // การใส่ `ครอบไว้ จะทำให้บนหน้าจอไลน์ของน้ากดจิ้มทีเดียวแล้วก๊อปปี้ข้อความได้เลยครับ
                    } else {
                        replyText = `❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับน้า`;
                    }
                }
            }
            // ==================== [  คำสั่งแอดมินรีเซ็ตระบบล้างกระดานผ่านแชทส่วนตัว (resetall) ] ====================
            else if (userMsg === 'ล้างระบบ') {
                const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db"; // 👑 ไอดี LINE ของคุณน้า
                
                // 🚨 กรองขั้นสูงสุด: ถ้าไม่ใช่แอดมิน หรือ แอดมินไม่ได้สั่งในแชทส่วนตัว (1 ต่อ 1) ให้บอทเงียบกริบไม่ตอบ
                if (userId !== ADMIN_ID || event.source.type !== 'user') {
                    return res.sendStatus(200);
                }

                // 🔄 วนลูปเคลียร์ค่าสถานะการเงินและการเล่นของทุกคนในคลัง (แต่ยังคงเก็บข้อมูลบัญชีธนาคารและชื่อเอาไว้)
                for (let id in usersWallets) {
                    usersWallets[id].balance = 0;
                    usersWallets[id].turnoverTarget = 0;
                    usersWallets[id].turnoverCount = 0;
                    usersWallets[id].isWithdrawLocked = false;
                    usersWallets[id].pendingWithdrawAmount = 0;
                }

                // 🗑️ ล้างกระดานโพยเดิมที่ค้างอยู่ในรอบนั้นๆ ทั้งหมดให้โล่งสะอาด
                for (let id in roundBets) {
                    delete roundBets[id];
                }

                // บันทึกการล้างกระดานขึ้นไปบนคลัง Firebase หลังบ้านทันที
                await saveDataToFirebase();

                replyText = `♻️ รีเซ็ตระบบล้างกระดานสำเร็จเรียบร้อยครับน้า!\n──────────────────\n💰 เครดิตสมาชิกทุกคน: ปรับเป็น 0 บาท\n🔒 เคลียร์ค่าเทิร์นคงค้าง: ปกติทั้งหมด\n📝 ข้อมูลโพยเดิมในรอบ: ล้างกระดานโล่ง 100%\n──────────────────\n✨ พร้อมสำหรับเริ่มเปิดห้องรอบใหม่แล้วครับโผม!`;
            }
             // ==================== [ 🕒 ระบบดักจับการพิมพ์ตัวเลขนับถอยหลัง 3, 2, 1 ] ====================
if (userMsg === '3' || userMsg === '2' || userMsg === '1') {
    // เช็กสิทธิ์แอดมินก่อนทำงาน
    if (ADMIN_IDS.includes(userId)) {
        replyText = "COUNTDOWN_IMAGE_TRIGGER"; // 👈 ใส่ข้อความหลอกไว้ เพื่อให้บล็อกส่งไลน์ด้านล่างยอมทำงาน
    }
}

           // ==================== [ จุดตรวจสอบคัดกรอง: ป้องกันไม่ให้บุคคลทั่วไปใช้งานบอทในแชทส่วนตัว ] ====================
if (event.source.type === 'user') {
    // 👥 ถ้าไม่ใช่แอดมิน ให้เช็กก่อนว่าข้อความตรงกับคำสั่งที่อนุญาตให้สมาชิกทั่วไปใช้ได้ไหม
    if (!ADMIN_IDS.includes(userId)) {
        
        const cleanMsg = userMsg.trim();
        const origMsg = originalMsg ? originalMsg.trim() : cleanMsg;

        // 1. คำสั่งเช็กยอด/โพย: "c" หรือ "C"
        const isCheckBalance = cleanMsg.toLowerCase() === 'c' || cleanMsg === 'เช็คยอด' || cleanMsg === 'ยอด';

        // 2. คำสั่งลงทะเบียน: ขึ้นต้นด้วย "c/" หรือ "C/"
        const isRegisterCode = origMsg.toLowerCase().startsWith('c/');

        // 3. คำสั่งแจ้งฝากเงิน: ขึ้นต้นด้วย "ฝาก" (เช่น "ฝาก", "ฝาก500", "ฝาก 500")
        const isDeposit = cleanMsg.startsWith('ฝาก');

        // 4. คำสั่งแจ้งถอนเงิน: ขึ้นต้นด้วย "ถอน" (เช่น "ถอน", "ถอน500", "ถอน 500")
        const isWithdraw = cleanMsg.startsWith('ถอน');

        // ❌ หากข้อความที่พิมพ์เข้ามา **ไม่ใช่** 1 ใน 4 คำสั่งด้านบนนี้ ให้ตัดการทำงานทันที (บอทเงียบใส่)
        if (!isCheckBalance && !isRegisterCode && !isDeposit && !isWithdraw) {
            return res.sendStatus(200);
        }
    }
}

            //==========================================================
        
           // ==================== [ 🚀 บล็อกยิงข้อความตอบกลับ LINE แบบสมบูรณ์ ป้องกันข้อความว่าง ] ====================
            if (replyText || global.currentReplyFlex) {
                try {
                    let sendMessages = [];

                    // 🌟 1. ดักจับ Flex Message (การ์ดดำทอง) ถ้ามีค่าให้ยัดลงถังเป็นอย่างแรก
                    if (global.currentReplyFlex) {
                        sendMessages.push(global.currentReplyFlex);
                    }

                    else if (userMsg === 'กต') {
                        sendMessages.unshift({
                            type: 'image',
                            originalContentUrl: 'https://img2.pic.in.th/Modern-Game-Rules-Poster-for-Pokdeng.jpg', 
                            previewImageUrl: 'https://img2.pic.in.th/Modern-Game-Rules-Poster-for-Pokdeng.jpg'     
                        },
                        {
                            type: 'image',
                            originalContentUrl: 'https://img2.pic.in.th/Abstract-Playful-Classroom-Rules.jpg', 
                            previewImageUrl: 'https://img2.pic.in.th/Abstract-Playful-Classroom-Rules.jpg'     
                        });
                    }
                    else if (userMsg === 'คส') {
                        replyText = null;
                        sendMessages = [{
                            type: 'image',
                            originalContentUrl: 'https://img1.pic.in.th/images/546565.png', 
                            previewImageUrl: 'https://img1.pic.in.th/images/546565.png'     
                        }];
                    }
                    
                    // 🌟 3. ส่งข้อความตัวหนังสือปกติ (ดักจับ: ต้องไม่เป็นค่าว่าง ไม่เป็น null)
                    if (replyText && replyText.trim() !== "") {
                        sendMessages.push({ type: 'text', text: replyText });
                    }

                    // 🧼 เคลียร์ค่าแรมของ Flex ออกเพื่อป้องกันบั๊กค้างคาในระบบ
                    global.currentReplyFlex = null; 
                    
                    // 🚀 4. สั่งยิงข้อมูลหา LINE (ถ้าในถังมีข้อความหรือรูปภาพ ให้ทำการส่งทันที)
                    if (sendMessages.length > 0) {
                        await axios.post('https://api.line.me/v2/bot/message/reply', {
                            replyToken: replyToken,
                            messages: sendMessages 
                        }, {
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${TOKEN}`
                            }
                        });
                    }
                } catch (error) {
                    console.error("❌ ส่งข้อความกลับล้มเหลว:", error.response ? error.response.data : error.message);
                }
            }
        }
    }
    res.sendStatus(200);
});

app.get('/', (req, res) => { res.send('ระบบลงทะเบียนรันปกติ'); });
app.use(express.static('public'));

// Endpoint สำหรับรับโพยจากหน้าเว็บ LIFF
app.get('/', (req, res) => { res.send('ระบบลงทะเบียนรันปกติ'); });
app.use(express.static('public'));

// 🌐 Endpoint สำหรับรับโพยจากหน้าเว็บ LIFF
app.post('/api/web-bet-trigger', async (req, res) => {
    try {
        const { userId, betText } = req.body;

        // เช็กป้องกันกรณีไม่ได้ส่ง userId หรือ betText มา
        if (!userId || !betText) {
            return res.json({ success: false, message: "ข้อมูลที่ส่งมาไม่ครบถ้วน (ต้องการ userId และ betText)" });
        }

        const userMsg = betText.trim().toLowerCase();

        // =========================================================
        // 🟢 1. ตรวจสอบคำสั่งระบบ/การคืนโพยก่อนเป็นอันดับแรก (Top Priority)
        // =========================================================

        // [ 1.1 ระบบคืนโพยป๊อกเด้ง (r) ]
        if (userMsg === "r") {
            if (!isRoundOpen) {
                return res.json({ success: false, message: "🚫 ไม่สามารถคืนโพยได้ เนื่องจากปิดรอบแทงเรียบร้อยแล้ว" });
            }
            
            const user = usersWallets[userId];
            if (!user) {
                return res.json({ success: false, message: "📢 คุณยังไม่ได้ลงทะเบียนสมาชิกในระบบครับ" });
            }

            const myBets = roundBets[userId];
            if (!myBets || myBets.length === 0) {
                return res.json({ success: false, message: `❌ คุณ ${user.name || "สมาชิก"} ไม่มีรายการโพยค้างในรอบนี้ให้ยกเลิกครับ` });
            }

            // คำนวณคืนเงิน
            const totalRefund = myBets.reduce((sum, bet) => sum + (bet.holdCost || 0), 0);
            user.balance += totalRefund;
            usersRoundCrossCheck[userId] = {};
            roundBets[userId] = [];

            await saveDataToFirebase();

            return res.json({ 
                success: true, 
                message: "🗑️ ยกเลิกโพยป๊อกเด้งสำเร็จเรียบร้อยแล้ว",
                refundAmount: totalRefund,
                newBalance: user.balance
            });
        }

        // [ 1.2 ระบบคืนโพยไฮโล (rz) ]
        else if (userMsg === "rz") {
            if (!isHiloRoundOpen) {
                return res.json({ success: false, message: "🚫 ไม่สามารถคืนโพยไฮโลได้ เนื่องจากปิดรอบแทงเรียบร้อยแล้ว" });
            }

            const user = usersWallets[userId];
            if (!user) {
                return res.json({ success: false, message: "📢 คุณยังไม่ได้ลงทะเบียนสมาชิกในระบบครับ" });
            }

            const displayName = user.nickname || user.name || "สมาชิก";
            const myHiloBets = hiloRoundBets[userId];

            if (!myHiloBets || myHiloBets.length === 0) {
                return res.json({ success: false, message: `❌ คุณ ${displayName} ไม่มีรายการโพยไฮโลค้างในรอบนี้ให้ยกเลิกครับ` });
            }

            const totalHiloRefund = myHiloBets.reduce((sum, bet) => sum + (bet.price || 0), 0);
            user.balance += totalHiloRefund;

            hiloUserTrackers[userId] = { side: null, singles: new Set() };
            hiloRoundBets[userId] = [];

            await saveDataToFirebase();

            return res.json({ 
                success: true, 
                message: "🎲 ยกเลิกโพยไฮโลสำเร็จเรียบร้อยแล้ว",
                refundAmount: totalHiloRefund,
                newBalance: user.balance
            });
        }

        // =========================================================
        // 🔴 2. ประมวลผลการแทงโพยไฮโล (ถ้าขึ้นต้นด้วย z หรือมีโครงสร้างโพยไฮโล)
        // =========================================================
        else if (userMsg.startsWith('z')) {
            const result = await processHiloBetSubmission(userId, betText, 'web');
            return res.json(result);
        }

        // =========================================================
        // 🔵 3. ประมวลผลการแทงโพยป๊อกเด้ง (โพยที่มีเครื่องหมาย -)
        // =========================================================
        else if (betText.includes('-')) {
            const result = await processPokDengBet(userId, betText);
            return res.json(result);
        }

        return res.json({ success: false, message: 'รูปแบบการแทงไม่ถูกต้อง (ตัวอย่าง: 1-100 หรือ zสูง-100)' });

    } catch (error) {
        console.error("❌ Web Bet Trigger Error:", error);
        return res.json({ success: false, message: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์: ' + error.message });
    }
});

// 📥 3. API รับโพยแทงจากหน้าเว็บ LIFF (ปรับปรุงใหม่)
app.post('/api/place-bet', async (req, res) => {
    const { userId, amount, type } = req.body;
    
    // ดึงข้อมูลล่าสุด
    let user = await getLatestWallet(userId);
    if (!user && usersWallets[userId]) {
        user = usersWallets[userId];
    }

    if (!user) {
        return res.json({ success: false, message: `ไม่พบผู้ใช้งาน (ID: ${userId})` });
    }

    const currentBalance = user.balance || 0;
    if (currentBalance < amount) {
        return res.json({ success: false, message: 'ยอดเงินไม่พอ' });
    }

    // หักเงิน
    user.balance = currentBalance - amount;
    usersWallets[userId] = user; // อัปเดต RAM

    // บันทึกลง Firebase
    await updateSingleUserWallet(userId, user);

    res.json({ success: true, newBalance: user.balance });
});

// ==================== [ จุดรัน Server ] ====================
app.listen(process.env.PORT || 3000, () => { console.log('Server is running...'); });
// เปิดทางให้เข้าถึงไฟล์รูปภาพสลิปที่เซฟไว้ในเครื่องได้ตรงๆ
app.use(express.static(__dirname));
