// Kisan Dost — Free Meta WhatsApp Cloud API backend
// -------------------------------------------------------
// No 360dialog. No Twilio. No paid service.
// Direct Meta WhatsApp Cloud API only.
// 
// MOCK MODE: If WHATSAPP_TOKEN is not set, empty, or "MOCK",
// nothing is sent to Meta. Messages are logged to the console
// and saved in db.json under sent_log, so you can test safely.
// 
// NEVER log tokens, secrets, or full access tokens.
// Storage: a simple JSON file (db.json) in this folder.
// This is enough for the first 100-500 farmers. Later you can
// move the same farmer fields to a real database without
// changing the API shape.

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- Config from environment (no secrets in code) ----------
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'kisan-dost-verify-change-me';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || 'MOCK';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '';
const APP_SECRET = process.env.APP_SECRET || ''; // optional, for signature check
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me-admin-key';
const OWNER_WHATSAPP_NUMBER = process.env.OWNER_WHATSAPP_NUMBER || ''; // e.g. 0300xxxxxxx, owner only
const MOCK_MODE = !WHATSAPP_TOKEN || WHATSAPP_TOKEN === 'MOCK' || !PHONE_NUMBER_ID;
const GRAPH_VERSION = 'v21.0';

// ---------- Simple JSON database ----------
// On Vercel the code folder is read-only, so use /tmp there.
// On Render / Railway / a normal server, use the local db.json.
const DB_PATH = process.env.VERCEL
  ? path.join('/tmp', 'kisan-dost-db.json')
  : path.join(__dirname, 'db.json');

function defaultDb() {
  return { farmers: [], sessions: {}, sent_log: [] };
}

function loadDb() {
  try {
    if (!fs.existsSync(DB_PATH)) return defaultDb();
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.farmers)) data.farmers = [];
    if (!data.sessions) data.sessions = {};
    if (!Array.isArray(data.sent_log)) data.sent_log = [];
    return data;
  } catch (e) {
    console.error('Could not read db.json, starting empty:', e.message);
    return defaultDb();
  }
}

function saveDb(db) {
  // Write to a temp file then rename, so a crash does not corrupt db.json.
  // On a read-only host, keep the data in memory instead of crashing.
  try {
    const tmp = DB_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(tmp, DB_PATH);
  } catch (e) {
    console.error('Could not save db.json, keeping data in memory:', e.message);
  }
}

let db = loadDb();

// ---------- Helpers: dates, plans, phone numbers ----------
function todayISO() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function addDays(dateISO, days) {
  const d = new Date(dateISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysUntil(dateISO) {
  const today = new Date(todayISO() + 'T00:00:00Z');
  const end = new Date(dateISO + 'T00:00:00Z');
  return Math.round((end - today) / (1000 * 60 * 60 * 24));
}

// Plans — from the Kisan Dost launch page. Keep in sync with the tracker.
const PLANS = {
  Basic: { monthly: 499, yearly: 4990 },
  Pro: { monthly: 899, yearly: 8990 },
};

function planAmount(plan, billing) {
  if (!PLANS[plan]) return 0;
  if (billing === 'Yearly') return PLANS[plan].yearly;
  if (billing === 'Monthly') return PLANS[plan].monthly;
  return 0; // Trial
}

function expiryFor(billing, startDate) {
  if (billing === 'Yearly') return addDays(startDate, 365);
  if (billing === 'Monthly') return addDays(startDate, 30);
  return addDays(startDate, 7); // Trial
}

function computeStatus(farmer) {
  if (farmer.status === 'Pending Verification') return 'Pending Verification';
  if (!farmer.expiry_date) return farmer.status || 'Trial';
  const left = daysUntil(farmer.expiry_date);
  if (left < 0) return 'Expired';
  if (left <= 3) return 'Expiring Soon';
  // Keep Trial vs Active from the stored field
  return farmer.status === 'Trial' ? 'Trial' : 'Active';
}

function normalizePhone(raw) {
  if (!raw) return '';
  let p = String(raw).replace(/[\s\-()]/g, '').replace(/^\+/, '');
  // Canonical form for storage / lookup: Pakistan 0-form, e.g. 03001234567.
  // WhatsApp sends 923001234567, the form sends 03001234567 — both must match.
  if (p.startsWith('92') && p.length === 12) return '0' + p.slice(2);
  return p;
}

// Meta Cloud API needs the international form without '+', e.g. 923001234567.
function metaPhone(raw) {
  const c = normalizePhone(raw);
  if (c.startsWith('0') && c.length === 11) return '92' + c.slice(1);
  return c;
}

function displayPhone(stored) {
  // Stored form is already 0-form; keep this for old 92-form rows too.
  if (stored && stored.startsWith('92') && stored.length === 12) {
    return '0' + stored.slice(2);
  }
  return stored || '';
}

function findFarmer(whatsappNumber) {
  const n = normalizePhone(whatsappNumber);
  return db.farmers.find((f) => normalizePhone(f.whatsapp_number) === n) || null;
}

function publicFarmer(f) {
  // Recompute status on every read, so Expiring Soon / Expired is always correct.
  return { ...f, status: computeStatus(f) };
}

// ---------- Send a message via Meta Cloud API (or mock it) ----------
async function sendWhatsApp(to, options) {
  // options: { text } or { template, language, params }
  const toNorm = metaPhone(to); // Meta needs 92-form; storage uses 0-form
  const entry = {
    to: toNorm,
    at: new Date().toISOString(),
    mode: MOCK_MODE ? 'MOCK' : 'LIVE',
    ...options,
  };
  db.sent_log.push(entry);
  if (db.sent_log.length > 500) db.sent_log = db.sent_log.slice(-500);
  saveDb(db);

  if (MOCK_MODE) {
    console.log(`[MOCK SEND to ${toNorm}]`, JSON.stringify(options));
    return { mock: true, to: toNorm };
  }

  // Live: Meta Graph API
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const body = { messaging_product: 'whatsapp', to: toNorm, type: options.template ? 'template' : 'text' };
  if (options.template) {
    body.template = {
      name: options.template,
      language: { code: options.language || 'en' },
    };
    if (options.params && options.params.length) {
      body.template.components = [
        { type: 'body', parameters: options.params.map((p) => ({ type: 'text', text: String(p) })) },
      ];
    }
  } else {
    body.text = { body: options.text, preview_url: false };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Meta send failed:', res.status, JSON.stringify(data).slice(0, 500));
    throw new Error('Meta send failed: ' + (data.error?.message || res.status));
  }
  return data;
}

async function sendText(to, text) {
  return sendWhatsApp(to, { text });
}

async function sendTemplate(to, template, language, params) {
  return sendWhatsApp(to, { template, language, params: params || [] });
}

// ---------- Messages in 3 languages ----------
// Keep these short. Voice notes are recorded by the owner from these scripts
// for daily alerts; auto-replies below use the same wording.
function welcomeText(farmer) {
  const lang = farmer.language || 'Urdu';
  const name = farmer.name || 'Kisan Bhai';
  const start = farmer.start_date;
  const expiry = farmer.expiry_date;
  if (lang === 'Punjabi') {
    return `Assalam-o-Alaikum ${name}! Kisan Dost vich khush amdeed.\nTuhada plan: ${farmer.plan} (${farmer.billing})\nShuru: ${start}\nKhatam: ${expiry}\n7 din FREE trial hai. Rozana fasal di salah, mausam di khabar te keeron di dawai di maloomat milay gi.\nSaanu apna number save karo taan ke Broadcast mil sake.`;
  }
  if (lang === 'English') {
    return `Assalam-o-Alaikum ${name}! Welcome to Kisan Dost.\nYour plan: ${farmer.plan} (${farmer.billing})\nStart: ${start}\nExpiry: ${expiry}\nYou have a FREE 7-day trial. You will get daily crop advice, weather warnings, and pest/disease help.\nPlease save our number so you receive Broadcast messages.`;
  }
  return `Assalam-o-Alaikum ${name}! Kisan Dost mein khush amdeed.\nAap ka plan: ${farmer.plan} (${farmer.billing})\nShuru: ${start}\nKhatam: ${expiry}\n7 din FREE trial hai. Rozana fasal ki salah, mausam ki khabar aur keeron / bimari ki dawai ki maloomat milegi.\nBroadcast milne ke liye hamara number save kar lein.`;
}

function paymentInstructionsText(farmer) {
  const lang = farmer.language || 'Urdu';
  const amount = planAmount(farmer.plan, farmer.billing);
  // IMPORTANT: No real JazzCash number or UBL IBAN is in this code.
  // The owner sends those privately on WhatsApp. These are placeholders.
  if (lang === 'Punjabi') {
    return `Trial khatam hon to baad jaari rakhne layi ${amount} PKR ada karo.\nJazzCash ya UBL Bank Transfer naal ada karo. Details aap nu alag WhatsApp te bhejiyan jaan giyan.\nAda kar ke Transaction ID aithe bhej deo, jaise: PAID TXN12345678`;
  }
  if (lang === 'English') {
    return `To continue after your trial, please pay ${amount} PKR.\nPay by JazzCash or UBL Bank Transfer. Payment details will be sent to you privately on WhatsApp.\nAfter paying, send your Transaction ID here, like: PAID TXN12345678`;
  }
  return `Trial khatam hone ke baad jaari rakhne ke liye ${amount} PKR ada karein.\nJazzCash ya UBL Bank Transfer se ada karein. Payment details aap ko alag WhatsApp par bheji jayengi.\nAda karne ke baad apni Transaction ID yahan bhejein, jaise: PAID TXN12345678`;
}

// ---------- Farming knowledge — simple, safe auto-replies ----------
// These are general advice only. Always add: follow the product label,
// and ask a local agriculture officer if unsure. Dosage is given as a
// starting guide, not a prescription for every field.
function getAdvice(textLower, farmer) {
  const lang = (farmer && farmer.language) || 'Urdu';
  const prefix = lang === 'English'
    ? 'Kisan Dost advice: '
    : lang === 'Punjabi'
      ? 'Kisan Dost salah: '
      : 'Kisan Dost salah: ';
  const safety = lang === 'English'
    ? '\nNote: Always follow the label on the packet. If the problem is serious, ask your local agriculture officer.'
    : '\nNote: Hamesha packet par likhi hidayat par amal karein. Agar masla shadeed ho to apne ilaqe ke agriculture officer se rabta karein.';

  if (/(sowing|sow|bijai|beej|buwai|wheat.*sow|sow.*wheat)/.test(textLower)) {
    return prefix + (lang === 'English'
      ? 'Wheat sowing in Punjab: best time is 1 Nov to 30 Nov. Use 40-50 kg seed per acre. Sow in lines, 22.5 cm apart. First irrigation after 20-25 days.'
      : 'Gandum ki bijai Punjab mein behtareen waqt 1 November se 30 November hai. 40-50 kg beej per acre istemal karein. Line mein bijai karein, 22.5 cm fasla rakhein. Pehla pani 20-25 din baad dein.') + safety;
  }
  if (/(fertilizer|khaad|urea|dap|npk|fertiliser)/.test(textLower)) {
    return prefix + (lang === 'English'
      ? 'Wheat fertilizer per acre: 1 bag DAP at sowing + 2 bags Urea (1 at first irrigation, 1 at second). Do not put all Urea at once.'
      : 'Gandum ke liye khaad per acre: bijai par 1 bag DAP + 2 bag Urea (1 pehle pani par, 1 dusre pani par). Saari Urea aik saath na dein.') + safety;
  }
  if (/(irrigation|pani|water|sinchai|abpashi)/.test(textLower)) {
    return prefix + (lang === 'English'
      ? 'Wheat needs 4-5 irrigations: at crown root (20-25 days), tillering, jointing, flowering, and grain filling. Do not over-water in cold fog.'
      : 'Gandum ko 4-5 pani chahiye: crown root (20-25 din), tillering, jointing, flowering aur grain filling par. Sard dhund mein zyada pani na dein.') + safety;
  }
  if (/(pest|keera|keeday|insect|aphid|tila|disease|bimari|rust|kangi|sundi|spray)/.test(textLower)) {
    return prefix + (lang === 'English'
      ? 'Check leaves daily. For aphids / rust, send a clear photo of the leaf here. Do not spray without identifying the pest first. Spray in the evening, wear gloves and mask.'
      : 'Rozana patte check karein. Aphid / rust ke liye patte ki saaf photo yahan bhejein. Pehle keera pehchane baghair spray na karein. Shaam ko spray karein, gloves aur mask pehnein.') + safety;
  }
  if (/(weather|mausam|barish|rain|fog|dhund|sardi|cold)/.test(textLower)) {
    return prefix + (lang === 'English'
      ? 'Weather: This is a general alert. Check the daily Kisan Dost broadcast for your district. If rain is expected in 24 hours, delay spray and fertilizer. (TODO: connect a free weather API in server.js — see README.)'
      : 'Mausam: Yeh aam khabar hai. Apne zila ki rozana Kisan Dost broadcast check karein. Agar 24 ghante mein barish hai to spray aur khaad rok dein. (TODO: free weather API jorne ke liye README dekhein.)') + safety;
  }
  if (/(price|plan|package|basic|pro|fee|charges|kitne|qimat)/.test(textLower)) {
    return prefix + (lang === 'English'
      ? 'Plans: Basic PKR 499/month or 4,990/year. Pro PKR 899/month or 8,990/year. 7-day FREE trial for every new farmer. Pay by JazzCash or UBL Bank Transfer.'
      : 'Plans: Basic PKR 499/month ya 4,990/year. Pro PKR 899/month ya 8,990/year. Har naye kisan ke liye 7 din FREE trial. JazzCash ya UBL Bank Transfer se ada karein.');
  }
  if (/(pay|payment|jazzcash|ubl|transaction|txn|paid|paisa)/.test(textLower)) {
    return prefix + (lang === 'English'
      ? 'Pay by JazzCash or UBL Bank Transfer. Payment details will be sent privately. After paying, send your Transaction ID here like: PAID TXN12345678'
      : 'JazzCash ya UBL Bank Transfer se ada karein. Details alag WhatsApp par bheji jayengi. Ada karne ke baad Transaction ID yahan bhejein, jaise: PAID TXN12345678');
  }
  return null;
}

// ---------- Registration conversation (step by step on WhatsApp) ----------
const REG_STEPS = ['name', 'district', 'crop', 'language', 'plan', 'billing'];

function startRegistration(from) {
  db.sessions[from] = { step: 'name', data: {} };
  saveDb(db);
  return 'Assalam-o-Alaikum! Kisan Dost mein khush amdeed.\n\nRegistration ke liye pehle apna naam bhejein.\n\nTo register, please send your name first.';
}

function registrationPrompt(step, lang) {
  const prompts = {
    name: 'Apna naam bhejein. / Please send your name.',
    district: 'Apna zila (district) bhejein, jaise Multan, Faisalabad. / Please send your district.',
    crop: 'Apni fasal bhejein, jaise Wheat, Cotton, Rice. / Please send your crop.',
    language: 'Apni zuban chunein: 1 = Urdu, 2 = Punjabi, 3 = English\nChoose your language: 1 = Urdu, 2 = Punjabi, 3 = English',
    plan: 'Plan chunein: 1 = Basic (PKR 499/month), 2 = Pro (PKR 899/month)\nChoose plan: 1 = Basic, 2 = Pro',
    billing: 'Billing chunein: 1 = Monthly, 2 = Yearly\nChoose billing: 1 = Monthly, 2 = Yearly',
  };
  return prompts[step] || 'Please send your reply.';
}

function parseLanguage(raw) {
  const t = String(raw).trim().toLowerCase();
  if (t === '1' || t.includes('urdu')) return 'Urdu';
  if (t === '2' || t.includes('punjabi')) return 'Punjabi';
  if (t === '3' || t.includes('english')) return 'English';
  return null;
}

function parsePlan(raw) {
  const t = String(raw).trim().toLowerCase();
  if (t === '1' || t.includes('basic')) return 'Basic';
  if (t === '2' || t.includes('pro')) return 'Pro';
  return null;
}

function parseBilling(raw) {
  const t = String(raw).trim().toLowerCase();
  if (t === '1' || t.includes('month')) return 'Monthly';
  if (t === '2' || t.includes('year')) return 'Yearly';
  return null;
}

async function finishRegistration(from, session) {
  const d = session.data;
  const start = todayISO();
  const farmer = {
    name: d.name,
    whatsapp_number: displayPhone(from),
    district: d.district,
    crop: d.crop,
    language: d.language,
    plan: d.plan,
    billing: d.billing,
    start_date: start,
    expiry_date: addDays(start, 7), // 7-day FREE trial first
    payment_method: '',
    transaction_id: '',
    amount_pkr: 0,
    status: 'Trial',
    notes: 'Registered on WhatsApp. Trial started.',
    created_at: new Date().toISOString(),
  };
  // Replace if this number already exists, otherwise add
  const existing = db.farmers.findIndex((f) => normalizePhone(f.whatsapp_number) === normalizePhone(from));
  if (existing >= 0) db.farmers[existing] = { ...db.farmers[existing], ...farmer };
  else db.farmers.push(farmer);
  delete db.sessions[from];
  saveDb(db);

  await sendText(from, welcomeText(farmer));
  await sendText(from, paymentInstructionsText(farmer));
  return farmer;
}

async function handleRegistrationStep(from, text) {
  const session = db.sessions[from];
  if (!session) return null;
  const step = session.step;
  const raw = String(text).trim();

  if (step === 'language') {
    const lang = parseLanguage(raw);
    if (!lang) return 'Please reply 1 for Urdu, 2 for Punjabi, 3 for English.';
    session.data.language = lang;
  } else if (step === 'plan') {
    const plan = parsePlan(raw);
    if (!plan) return 'Please reply 1 for Basic, 2 for Pro.';
    session.data.plan = plan;
  } else if (step === 'billing') {
    const billing = parseBilling(raw);
    if (!billing) return 'Please reply 1 for Monthly, 2 for Yearly.';
    session.data.billing = billing;
    await finishRegistration(from, session);
    return null; // welcome already sent
  } else {
    // name, district, crop — free text
    if (raw.length < 2) return 'Please send a valid reply.';
    session.data[step] = raw;
  }

  const nextIndex = REG_STEPS.indexOf(step) + 1;
  session.step = REG_STEPS[nextIndex];
  saveDb(db);
  return registrationPrompt(session.step);
}

// ---------- Incoming WhatsApp message ----------
async function handleIncomingMessage(from, text) {
  const fromNorm = normalizePhone(from);
  const t = String(text || '').trim();
  const lower = t.toLowerCase();

  // Owner approval by WhatsApp: "APPROVE 03001234567"
  // Only the owner number can do this.
  if (OWNER_WHATSAPP_NUMBER && normalizePhone(OWNER_WHATSAPP_NUMBER) === fromNorm) {
    const m = t.match(/^approve\s+(\+?[\d\s\-()]+)/i);
    if (m) {
      const target = findFarmer(m[1]);
      if (!target) return `Farmer not found: ${m[1]}`;
      return await approveFarmer(target, 'Approved by owner on WhatsApp');
    }
  }

  // Already in registration? Continue the steps.
  if (db.sessions[fromNorm]) {
    const reply = await handleRegistrationStep(fromNorm, t);
    if (reply) await sendText(fromNorm, reply);
    return;
  }

  // Start registration
  if (/^(join|register|registration|subscribe|shuru|شروع|join karo|start|hi|hello|salam|assalam)/.test(lower) || lower === 'join') {
    // If they already exist and are active, do not restart registration
    const existing = findFarmer(fromNorm);
    if (existing && computeStatus(existing) === 'Active') {
      await sendText(fromNorm, `Assalam-o-Alaikum ${existing.name}! Aap pehle se registered hain. Plan: ${existing.plan}, Expiry: ${existing.expiry_date}. Sawal bhejein, jaise wheat, khaad, pani, ya keera.`);
      return;
    }
    const msg = startRegistration(fromNorm);
    await sendText(fromNorm, msg);
    return;
  }

  const farmer = findFarmer(fromNorm);

  // Payment: farmer sends Transaction ID
  // Examples: "PAID TXN12345678", "Transaction ID: 1234567890", "TXN 987654321"
  const txnMatch = t.match(/(?:paid|txn|tid|transaction|trxid|receipt|ref)[\s:#-]*([A-Za-z0-9\-]{6,30})/i);
  if (txnMatch && farmer) {
    farmer.transaction_id = txnMatch[1];
    farmer.payment_method = farmer.payment_method || 'JazzCash / UBL — to confirm';
    farmer.status = 'Pending Verification';
    farmer.notes = (farmer.notes || '') + ` | TXN ${txnMatch[1]} sent, waiting for owner check.`;
    saveDb(db);
    await sendText(fromNorm, farmer.language === 'English'
      ? `Thank you! Your Transaction ID ${txnMatch[1]} is received. We will check it in JazzCash / UBL and activate your plan soon.`
      : `Shukriya! Aap ki Transaction ID ${txnMatch[1]} mil gayi hai. Hum JazzCash / UBL mein check kar ke aap ka plan jald activate kar dein ge.`);
    // Tell the owner (in mock mode this is just logged)
    if (OWNER_WHATSAPP_NUMBER) {
      await sendText(OWNER_WHATSAPP_NUMBER, `Kisan Dost: Payment to verify.\nFarmer: ${farmer.name} (${displayPhone(farmer.whatsapp_number)})\nTXN: ${txnMatch[1]}\nPlan: ${farmer.plan} ${farmer.billing}\nReply: APPROVE ${displayPhone(farmer.whatsapp_number)}`);
    }
    return;
  }
  if (txnMatch && !farmer) {
    await sendText(fromNorm, 'Aap ki Transaction ID mil gayi, lekin aap pehle register nahi hain. Please type JOIN to register first.');
    return;
  }

  // My plan / expiry
  if (/(my plan|expiry|expire|renew|status|mera plan)/.test(lower) && farmer) {
    await sendText(fromNorm, `Aap ka plan: ${farmer.plan} (${farmer.billing})\nStatus: ${computeStatus(farmer)}\nStart: ${farmer.start_date}\nExpiry: ${farmer.expiry_date}`);
    return;
  }

  // Farming advice
  const advice = getAdvice(lower, farmer);
  if (advice) {
    await sendText(fromNorm, advice);
    return;
  }

  // Fallback — ask them to join or ask a farming question
  await sendText(fromNorm, 'Kisan Dost: Sawal bhejein — jaise wheat, khaad, pani, keera, ya mausam.\nOr type JOIN to register.\nSawal bhejein, ya JOIN likh kar register karein.');
}

// Approve a farmer after the owner checks JazzCash / UBL
async function approveFarmer(farmer, note) {
  const start = todayISO();
  farmer.start_date = start;
  farmer.expiry_date = expiryFor(farmer.billing, start);
  farmer.amount_pkr = planAmount(farmer.plan, farmer.billing);
  farmer.status = 'Active';
  farmer.notes = (farmer.notes || '') + ` | ${note || 'Approved'} on ${start}.`;
  saveDb(db);
  const to = normalizePhone(farmer.whatsapp_number);
  const msg = farmer.language === 'English'
    ? `Payment received! Your Kisan Dost ${farmer.plan} plan is now Active.\nStart: ${farmer.start_date}\nExpiry: ${farmer.expiry_date}\nThank you!`
    : `Payment mil gayi! Aap ka Kisan Dost ${farmer.plan} plan ab Active hai.\nShuru: ${farmer.start_date}\nKhatam: ${farmer.expiry_date}\nShukriya!`;
  await sendText(to, msg);
  return `Approved ${farmer.name} (${displayPhone(farmer.whatsapp_number)}). Active until ${farmer.expiry_date}.`;
}

// ---------- Express app ----------
const app = express();

// Capture raw body for Meta signature verification (X-Hub-Signature-256)
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: true }));

function verifySignature(req) {
  if (!APP_SECRET) return true; // no secret set — skip check, log a warning once
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(req.rawBody || '').digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

function checkAdmin(req) {
  const key = req.query.key || req.headers['x-admin-key'] || req.body?.admin_key || req.body?.key;
  return key && key === ADMIN_KEY;
}

// ---------- Public routes ----------
app.get('/', (_req, res) => {
  res.send(`
    <h1>Kisan Dost — WhatsApp Cloud API</h1>
    <p>Status: ${MOCK_MODE ? 'MOCK MODE — no live Meta calls' : 'LIVE MODE'}</p>
    <p>Farmers saved: ${db.farmers.length}</p>
    <p>Health: <a href="/health">/health</a></p>
    <p>Register (POST): /register</p>
    <p>This backend is ready to connect. It is NOT live on WhatsApp until you add your Meta token and set the webhook in Meta Business Manager. See SETUP_GUIDE.md</p>
  `);
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'kisan-dost-cloud-api', mode: MOCK_MODE ? 'mock' : 'live', farmers: db.farmers.length, time: new Date().toISOString() });
});

// Privacy Policy — Meta asks for a public Privacy Policy URL in
// App Settings → Basic before an app can be switched from
// Development to Live mode. This page is that URL once deployed:
// https://kisan-dost-cloud-api-production.up.railway.app/privacy
app.get('/privacy', (_req, res) => {
  res.send(`
    <h1>Kisan Dost — Privacy Policy</h1>
    <p>Last updated: 9 November 2026. Kisan Dost is an agriculture advice service for farmers in Pakistan, run by Roomi Educational Advisors / Kisan Dost.</p>
    <h2>What we collect</h2>
    <p>When you register on WhatsApp or on our page, we collect only what is needed to serve you: your name, WhatsApp number, district, crop, preferred language (Urdu, Punjabi or English), plan and billing choice, and your payment Transaction ID if you send one.</p>
    <h2>How we use it</h2>
    <p>To send you crop advice, sowing / fertilizer / irrigation guidance, pest and disease help, weather warnings, your welcome message, and plan / renewal reminders on WhatsApp. We do not sell your information and we do not share it with advertisers.</p>
    <h2>Payments</h2>
    <p>Payments are by JazzCash or UBL bank transfer. Payment details are sent privately on WhatsApp only, never published on this page. We check the Transaction ID you send us in JazzCash / UBL before activating a plan.</p>
    <h2>Your choices</h2>
    <p>You can ask us at any time on WhatsApp to correct or delete your details, or to stop messages. Deleting your details ends your plan reminders.</p>
    <h2>Contact</h2>
    <p>Contact Kisan Dost on WhatsApp via the number on our launch page. This service is for farmers in Pakistan.</p>
  `);
});

// Meta webhook verification — Meta calls this with hub.mode, hub.verify_token, hub.challenge
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified by Meta.');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Meta webhook — incoming WhatsApp messages
app.post('/webhook', async (req, res) => {
  // Always reply 200 fast, so Meta does not retry. Process after.
  res.sendStatus(200);
  try {
    if (!verifySignature(req)) {
      console.error('Webhook signature check failed — ignoring message.');
      return;
    }
    const body = req.body || {};
    if (body.object !== 'whatsapp_business_account') return;
    const entries = body.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const messages = value.messages || [];
        for (const msg of messages) {
          const from = msg.from;
          // Only handle text for now. Images/voice are logged, not processed.
          if (msg.type === 'text' && msg.text?.body) {
            console.log(`Incoming from ${from}: ${msg.text.body.slice(0, 120)}`);
            await handleIncomingMessage(from, msg.text.body);
          } else {
            console.log(`Incoming ${msg.type} from ${from} — not processed yet.`);
          }
        }
      }
    }
  } catch (e) {
    console.error('Webhook error:', e.message);
  }
});

// Launch page form — POST /register
// Body: { name, whatsapp_number, district, crop, language, plan, billing }
// Saves the farmer with a 7-day FREE trial. Returns success + expiry.
app.post('/register', async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const whatsappNumber = normalizePhone(b.whatsapp_number || b.phone || '');
    const district = String(b.district || '').trim();
    const crop = String(b.crop || 'Wheat').trim();
    const language = ['Urdu', 'Punjabi', 'English'].includes(b.language) ? b.language : 'Urdu';
    const plan = ['Basic', 'Pro'].includes(b.plan) ? b.plan : 'Basic';
    const billing = ['Monthly', 'Yearly'].includes(b.billing) ? b.billing : 'Monthly';

    if (!name || !whatsappNumber || whatsappNumber.length < 10) {
      return res.status(400).json({ ok: false, error: 'name and a valid whatsapp_number are required' });
    }
    if (!district) {
      return res.status(400).json({ ok: false, error: 'district is required' });
    }

    const start = todayISO();
    const farmer = {
      name,
      whatsapp_number: displayPhone(whatsappNumber),
      district,
      crop,
      language,
      plan,
      billing,
      start_date: start,
      expiry_date: addDays(start, 7),
      payment_method: '',
      transaction_id: '',
      amount_pkr: 0,
      status: 'Trial',
      notes: 'Registered from launch page. Trial started.',
      created_at: new Date().toISOString(),
    };
    const idx = db.farmers.findIndex((f) => normalizePhone(f.whatsapp_number) === normalizePhone(whatsappNumber));
    if (idx >= 0) db.farmers[idx] = { ...db.farmers[idx], ...farmer };
    else db.farmers.push(farmer);
    saveDb(db);

    // Send welcome on WhatsApp (mock logs it, live sends it)
    try {
      await sendText(whatsappNumber, welcomeText(farmer));
      await sendText(whatsappNumber, paymentInstructionsText(farmer));
    } catch (e) {
      console.error('Welcome send failed (farmer still saved):', e.message);
    }

    return res.json({ ok: true, farmer: publicFarmer(farmer), message: 'Registered. 7-day FREE trial started.' });
  } catch (e) {
    console.error('Register error:', e.message);
    return res.status(500).json({ ok: false, error: 'server error' });
  }
});

// ---------- Admin routes (need ADMIN_KEY) ----------
app.get('/admin/farmers', (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ ok: false, error: 'admin key required' });
  return res.json({ ok: true, count: db.farmers.length, farmers: db.farmers.map(publicFarmer) });
});

app.get('/admin/farmers.csv', (req, res) => {
  if (!checkAdmin(req)) return res.status(401).send('admin key required');
  // Columns match the existing farmer tracker (.xlsx) exactly.
  const header = ['Farmer Name', 'WhatsApp Number', 'District', 'Crop / Orchard', 'Language', 'Plan', 'Billing', 'Start Date', 'Expiry Date', 'Payment Method', 'Transaction ID', 'Amount PKR', 'Status', 'Notes'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = db.farmers.map((f) => {
    const p = publicFarmer(f);
    return [p.name, p.whatsapp_number, p.district, p.crop, p.language, p.plan, p.billing, p.start_date, p.expiry_date, p.payment_method, p.transaction_id, p.amount_pkr, p.status, p.notes].map(esc).join(',');
  });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="kisan-dost-farmers.csv"');
  return res.send([header.map(esc).join(','), ...rows].join('\n'));
});

app.post('/admin/approve', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ ok: false, error: 'admin key required' });
  const farmer = findFarmer(req.body?.whatsapp_number || '');
  if (!farmer) return res.status(404).json({ ok: false, error: 'farmer not found' });
  if (req.body?.payment_method) farmer.payment_method = String(req.body.payment_method);
  if (req.body?.transaction_id) farmer.transaction_id = String(req.body.transaction_id);
  const result = await approveFarmer(farmer, 'Approved by owner via admin');
  return res.json({ ok: true, message: result, farmer: publicFarmer(farmer) });
});

// Send an alert to matching active farmers.
// Body: { crop, district, language, message, template }
// NOTE on cost: a text message only works inside the 24-hour window
// after the farmer last messaged you (free service reply, first 1,000/month free).
// Outside that window Meta requires an approved Utility template
// (kisan_daily_alert) and charges ~$0.015 per delivered message in Pakistan.
app.post('/admin/send-alert', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ ok: false, error: 'admin key required' });
  const { crop, district, language, message, template } = req.body || {};
  if (!message) return res.status(400).json({ ok: false, error: 'message is required' });

  const targets = db.farmers.filter((f) => {
    const s = computeStatus(f);
    if (s !== 'Active' && s !== 'Trial' && s !== 'Expiring Soon') return false;
    if (crop && f.crop.toLowerCase() !== String(crop).toLowerCase()) return false;
    if (district && f.district.toLowerCase() !== String(district).toLowerCase()) return false;
    if (language && f.language.toLowerCase() !== String(language).toLowerCase()) return false;
    return true;
  });

  let sent = 0;
  const errors = [];
  for (const f of targets) {
    try {
      if (template) await sendTemplate(f.whatsapp_number, template, 'en', [message]);
      else await sendText(f.whatsapp_number, message);
      sent++;
    } catch (e) {
      errors.push(`${f.whatsapp_number}: ${e.message}`);
    }
  }
  return res.json({ ok: true, matched: targets.length, sent, errors, mode: MOCK_MODE ? 'mock' : 'live' });
});

// ---------- Start ----------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Kisan Dost Cloud API running on port ${PORT}`);
    console.log(`Mode: ${MOCK_MODE ? 'MOCK (no live Meta calls — set WHATSAPP_TOKEN + PHONE_NUMBER_ID to go live)' : 'LIVE'}`);
    console.log(`Farmers saved: ${db.farmers.length}`);
    if (!APP_SECRET) console.log('Note: APP_SECRET not set — webhook signature check is skipped. Set it before going live.');
  });
}

module.exports = app;
