# Kisan Dost — Free Meta WhatsApp Cloud API Backend

Free, direct Meta WhatsApp Cloud API. **No 360dialog. No Twilio. No paid service.**

This backend makes the Kisan Dost launch page registration actually save, sends the welcome automatically, answers common farmer questions on WhatsApp, and handles payment + alerts semi-automatically.

**It is ready to connect. It is NOT live on WhatsApp yet.** Going live needs Bahram's Meta account, his Kisan Dost Business number, and a permanent token — see `SETUP_GUIDE.md`.

## What is fully automatic now

| Feature | Status |
|---|---|
| Farmer registers on the launch page (`POST /register`) | ✅ Saves to `db.json`, 7-day FREE trial, expiry = start + 7 days |
| Farmer messages `JOIN` on WhatsApp | ✅ Step-by-step registration: name → district → crop → language → plan → billing |
| Welcome message + payment instructions | ✅ Sent automatically after registration |
| Common questions (wheat sowing, fertilizer, irrigation, pest, weather, plans, payment) | ✅ Auto-reply in Urdu / Punjabi / English, inside the 24-hour window |
| Farmer sends Transaction ID (`PAID TXN12345678`) | ✅ Saved, status becomes `Pending Verification`, owner is notified |
| Daily / crop alerts (`POST /admin/send-alert`) | ✅ Sends to matching Active / Trial farmers by crop, district, language |
| Farmer list + CSV export (`GET /admin/farmers`, `GET /admin/farmers.csv`) | ✅ CSV columns match the existing farmer tracker `.xlsx` |
| Expiry / status | ✅ Auto-calculated: Trial +7d, Monthly +30d, Yearly +365d. `Expiring Soon` in the last 3 days, then `Expired` |

## What still needs 1 tap from the owner

**Payment verification.** JazzCash and UBL bank transfer cannot be checked automatically for free. The farmer sends a Transaction ID, the owner checks it in his own JazzCash / UBL app, then approves in one of two ways:

1. On WhatsApp (from the owner number only): `APPROVE 03001234567`
2. Admin API: `POST /admin/approve` with `ADMIN_KEY` and `whatsapp_number`

On approval the farmer becomes `Active`, expiry is reset from the approval date (Monthly +30d / Yearly +365d), and a payment-success message is sent.

No real JazzCash number or UBL IBAN is in this code. The owner sends payment details privately on WhatsApp. Placeholders only: `YOUR_JAZZCASH_NUMBER`, `YOUR_UBL_IBAN`.

## What Meta will charge (do not hide this)

Meta Cloud API access itself is free. Meta charges per **delivered template message** in Pakistan:

- Utility (alert / reminder / welcome template): **~$0.015 per message, about PKR 4**
- Marketing: **~$0.0473 per message, about PKR 13**
- Service reply inside the 24-hour window after a farmer messages you: **first 1,000 / month free**, then ~$0.015
- Incoming messages from farmers: **free**

So: replies to farmers who message you are mostly free at the start. Business-initiated daily alerts to everyone are **not** free. Example: 100 farmers × 30 days × $0.015 = **$45/month** if you send a Utility alert every day. Send alerts **2–3 times a week**, not daily, and use the free 24-hour reply window when you can.

Rates are Meta's, from October 2026, and can change. Check Meta's rate card before budgeting.

## Files

| File | What it is |
|---|---|
| `server.js` | Express server: webhook, registration, WhatsApp flow, auto-replies, payment, admin, alerts |
| `templates.json` | The 6 Meta message templates to create in Meta Business Manager |
| `.env.example` | Copy to `.env` and fill in your own values. Never commit `.env` |
| `package.json` | Node dependencies — only `express` |
| `render.yaml` | Deploy to Render free tier |
| `SETUP_GUIDE.md` | Step-by-step setup in simple English + Urdu summary |
| `db.json` | Created on first run. Farmers, registration sessions, and a log of sent messages. **Not in git.** Back it up. |

Storage is a JSON file (`db.json`). That is enough for the first 100–500 farmers. Later the same farmer fields can move to a real database without changing the API.

## Quick start (test in MOCK mode, no Meta token needed)

```bash
cd kisan-dost-cloud-api
npm install
npm start
# Server runs on http://localhost:3000 in MOCK mode.
# Messages are logged to the console and saved in db.json > sent_log.
# Nothing is sent to Meta.
```

Test:

```bash
curl http://localhost:3000/health

# Webhook verification (Meta does this when you set the webhook)
curl "http://localhost:3000/webhook?hub.mode=subscribe&hub.verify_token=kisan-dost-verify-change-me&hub.challenge=TEST123"

# Register a farmer (launch page form uses this)
curl -X POST http://localhost:3000/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Farmer","whatsapp_number":"03001234567","district":"Multan","crop":"Wheat","language":"Urdu","plan":"Pro","billing":"Monthly"}'

# List farmers (replace ADMIN_KEY with your .env value)
curl "http://localhost:3000/admin/farmers?key=change-me-admin-key"

# Export CSV (same columns as the tracker)
curl "http://localhost:3000/admin/farmers.csv?key=change-me-admin-key"

# Approve a farmer after you check payment in JazzCash / UBL
curl -X POST http://localhost:3000/admin/approve \
  -H "Content-Type: application/json" \
  -d '{"admin_key":"change-me-admin-key","whatsapp_number":"03001234567","payment_method":"JazzCash"}'

# Send an alert to Wheat farmers in Multan, Urdu
curl -X POST http://localhost:3000/admin/send-alert \
  -H "Content-Type: application/json" \
  -d '{"admin_key":"change-me-admin-key","crop":"Wheat","district":"Multan","language":"Urdu","message":"First irrigation after 20-25 days."}'
```

Simulate a WhatsApp `JOIN` message (POST /webhook):

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{"object":"whatsapp_business_account","entry":[{"changes":[{"value":{"messages":[{"from":"923001234567","type":"text","text":{"body":"JOIN"}}]}}]}]}'
```

Then reply step by step with the same shape: name, district, crop, `1` for Urdu, `2` for Pro, `1` for Monthly.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/` | — | Status page |
| `GET` | `/health` | — | `{"ok":true, "mode":"mock"/"live", "farmers":N}` |
| `GET` | `/webhook` | `VERIFY_TOKEN` | Meta webhook verification |
| `POST` | `/webhook` | Meta signature if `APP_SECRET` set | Incoming WhatsApp messages |
| `POST` | `/register` | — | Launch page form: name, whatsapp_number, district, crop, language, plan, billing |
| `GET` | `/admin/farmers` | `ADMIN_KEY` | List all farmers |
| `GET` | `/admin/farmers.csv` | `ADMIN_KEY` | CSV export, tracker columns |
| `POST` | `/admin/approve` | `ADMIN_KEY` | Approve a farmer after payment check |
| `POST` | `/admin/send-alert` | `ADMIN_KEY` | Alert matching farmers |

Admin key can be sent as `?key=...`, header `x-admin-key`, or body `admin_key`.

## TODOs (clearly marked in code)

- **Weather:** `getAdvice()` for weather is a stub with general advice. Plug in a free weather API (e.g. Open-Meteo — free, no key) for district-level rain / fog warnings before going live at scale.
- **Voice notes:** WhatsApp text is automatic. Voice-note alerts are still recorded by the owner from the daily alert text — Meta templates are text, not voice.
- **Images:** A farmer sending a photo of a diseased leaf is logged, not diagnosed yet. Add image handling later.
- **Database:** Move `db.json` to SQLite / Postgres when you pass ~500 farmers, or when you deploy to more than one server.

## Safety

- Never log tokens. `server.js` never logs `WHATSAPP_TOKEN` or `ADMIN_KEY`.
- Never put real JazzCash / UBL numbers, phone numbers, or Meta IDs in code or git.
- Set a strong `VERIFY_TOKEN` and `ADMIN_KEY` before going live. Change the defaults in `.env.example`.
- Set `APP_SECRET` before going live so webhook signatures are checked.
