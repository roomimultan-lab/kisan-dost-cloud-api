# Kisan Dost — Setup Guide (Free Meta Cloud API Version)

> **Urdu summary — mukhtasar:**
> Yeh guide Kisan Dost ko Meta WhatsApp Cloud API se muft mein live karne ke liye hai. 360dialog ki zaroorat nahi. Aap ko Meta Business Manager mein business verify karna hai, WhatsApp product add karna hai, apna Kisan Dost number jorna hai, 6 templates approve karwane hain, phir is backend ko Render (muft) par deploy karna hai aur webhook lagana hai. Payment abhi bhi aap khud JazzCash / UBL mein check karein ge — sirf 1 tap se approve karein ge. Rozana alert har roz bhejne se Meta charge karega (Pakistan mein lagbhag $0.015 per message), is liye hafte mein 2-3 dafa alert bhejein.

---

## What you need before you start

- A Facebook account (for Meta Business Manager)
- Your business name: **Kisan Dost**
- Your Kisan Dost WhatsApp Business number
- The Kisan Dost launch page link (to show Meta that this is a real business)
- A bank card for Meta (needed after the first 1,000 free messages — Meta stops sending if no payment method is on file)
- About 1–2 hours, plus waiting time for Meta approval (templates can take a few hours to 1 day)

**Do NOT pay anyone for 360dialog, Twilio, or a “WhatsApp API subscription” for this setup. Meta Cloud API direct has no monthly fee.**

---

## Step 1 — Create Meta Business Manager and verify your business

1. Go to Meta Business Manager (business.facebook.com) and create a business account named **Kisan Dost**.
2. Add your business details: name, website (your Kisan Dost launch page link), category **Agriculture / Farming**, phone number (your WhatsApp Business number).
3. Verify your business. Meta may ask for a business document (for example, your company registration for Roomi, or a utility bill / ID — follow what Meta asks for in your account). Verification can take 1–3 days.
4. Keep your Business Manager ID safe. You will need it later.

**If Meta asks for a website:** use the Kisan Dost launch page link. That proves Kisan Dost is real.

## Step 2 — Create a Meta Developer App, add WhatsApp

1. Go to Meta for Developers (developers.facebook.com) and create an App.
2. Choose type **Business**.
3. In the App dashboard, click **Add Product** → **WhatsApp** → Set up.
4. You are now in the WhatsApp API Setup page.

## Step 3 — Test first with Meta's test number

1. On the WhatsApp API Setup page, Meta gives you a **test phone number** and a **temporary token** (valid 24 hours).
2. Use the test number first. Do NOT move your real number yet.
3. You can test the backend in MOCK mode first (see Step 7), then test with this test number before going live.

## Step 4 — Add your real Kisan Dost Business number

**Important — read this first:**
Your number **cannot stay in the WhatsApp Business App and the Cloud API at the same time**. When you add it to the Cloud API, it migrates off the app. You will then manage messages through the API / this backend, not through the phone app.

- If you want to keep using the phone app for now, **use a second number** for the API, or stay on the manual system until you are ready to migrate.
- Do NOT migrate your main number until you have tested with the test number and your templates are approved.

To add it:
1. In WhatsApp API Setup, click **Add Phone Number**.
2. Enter your Kisan Dost Business number, verify it with the OTP Meta sends.
3. Copy the **Phone Number ID** — you need it for `.env`.
4. Copy the **WhatsApp Business Account ID (WABA ID)** — you need it for `.env`.

## Step 5 — Get a permanent access token (System User token)

**Never share this token in chat, WhatsApp, or email. Never paste it in a public place.**

1. In Business Manager → Business Settings → Users → System Users → Add a System User (name it `kisan-dost-api`), give it Admin access.
2. Assign it WhatsApp assets: your WhatsApp Business Account + your phone number, with **Full control / Manage**.
3. Click **Generate New Token** for that System User, choose the WhatsApp permissions, and copy the token.
4. This is your **permanent** `WHATSAPP_TOKEN`. The test token from Step 3 expires in 24 hours — do not use it for live.
5. Also copy your **App Secret** (App → Settings → Basic → App Secret, click Show). Put it in `.env` as `APP_SECRET` so webhook signatures are checked.

## Step 6 — Add a payment method to Meta

1. In Business Manager → Billing / Payment Settings, add a card.
2. Meta gives **1,000 free service replies per month**. After that, Meta charges per delivered message in Pakistan (Utility ~$0.015, Marketing ~$0.0473).
3. Without a payment method, Meta stops delivering after the free allowance. Add the card even if you expect to stay under 1,000 at first.

## Step 7 — Create and get approval for the 6 templates

Open `templates.json` in this folder. It has 6 templates:

| Template | Use |
|---|---|
| `kisan_welcome` | Welcome after registration |
| `kisan_payment_instructions` | How to pay (JazzCash / UBL) |
| `kisan_payment_success` | Payment confirmed, plan Active |
| `kisan_daily_alert` | Crop / weather alert (Utility) |
| `kisan_renewal_reminder` | Plan expiring in 3 days |
| `kisan_trial_ending` | FREE trial ending |

For each one, in Meta Business Manager → WhatsApp Manager → Message Templates → Create:

1. Name: exactly as in `templates.json` (lowercase, underscores).
2. Category: **Utility**.
3. Language: **English** first, then add **Urdu** as a second language on the same template.
4. Body: copy the `body_en` / `body_ur` text from `templates.json`. Keep `{{1}}`, `{{2}}` as they are — those are variables.
5. Submit and wait for approval. Do NOT use a template for business-initiated messages until Meta approves it. Rejected templates usually need simpler wording — remove any promotional language and resubmit.

## Step 8 — Deploy the backend to Render (free tier)

1. Push this folder to a GitHub repo (private is fine), or use Render's “Deploy from GitHub”.
   - Do NOT commit `.env` or `db.json`. The `.gitignore` in this folder already excludes them.
2. In Render (render.com), create a **New Web Service** from your repo.
3. Or use the `render.yaml` in this folder (Blueprint): Render → New → Blueprint, point it at your repo.
4. Set these Environment Variables in Render (copy from `.env.example`, fill your real values):
   - `WHATSAPP_TOKEN` — your permanent System User token from Step 5
   - `PHONE_NUMBER_ID` — from Step 4
   - `WHATSAPP_BUSINESS_ACCOUNT_ID` — from Step 4
   - `APP_SECRET` — from Step 5
   - `VERIFY_TOKEN` — choose a long random value, e.g. `kisan-dost-verify-2026-xxxx` (use the SAME value in Step 9)
   - `ADMIN_KEY` — choose a long random value
   - `OWNER_WHATSAPP_NUMBER` — your Kisan Dost number, digits only, e.g. `923001234567`
5. Deploy. Render gives you a URL like `https://kisan-dost-cloud-api.onrender.com`.
6. Open `https://<your-render-url>/health` in a browser. You should see `{"ok":true,"mode":"live","farmers":0}`.
   - **Note:** Render free tier sleeps after inactivity. The first request after sleep can take 30–60 seconds. That is normal on the free plan.

### Or test locally first (no Meta needed)

```bash
cd kisan-dost-cloud-api
npm install
npm start
# Runs on http://localhost:3000 in MOCK mode
curl http://localhost:3000/health
```

See `README.md` for the full test commands.

## Step 9 — Set the webhook in Meta

1. In Meta Developer App → WhatsApp → Configuration → Webhook, click **Edit**.
2. Callback URL: `https://<your-render-url>/webhook`
3. Verify Token: the SAME `VERIFY_TOKEN` you set in Render in Step 8.
4. Click **Verify and Save**. If it fails, check:
   - Your Render URL is correct and the app is running (`/health` works).
   - `VERIFY_TOKEN` matches exactly in Render and in Meta.
5. After verification, click **Manage** / **Subscribe** and subscribe to **`messages`** (incoming messages). That is the only webhook field this backend needs for now.

## Step 10 — Test with your own number

Test in this order, with your own phone (not a farmer's yet):

1. **JOIN:** Send `JOIN` to your Kisan Dost number on WhatsApp. Reply step by step: name, district, crop, `1` for Urdu, `2` for Pro, `1` for Monthly. You should get the welcome + payment instructions.
2. **Check the list:** Open `https://<your-render-url>/admin/farmers?key=YOUR_ADMIN_KEY` — your test farmer should be there, status `Trial`, expiry = today + 7 days.
3. **Payment:** Send `PAID TXN12345678` from your test number. Status should become `Pending Verification`.
4. **Approve:** From your owner number send `APPROVE 0300xxxxxxx` (your test number), or call `POST /admin/approve`. Status should become `Active`, expiry = today + 30 days (Monthly).
5. **Question:** Send `wheat sowing` — you should get an auto-reply.
6. **Alert:** Call `POST /admin/send-alert` with your crop/district/language and a short message. Check you receive it.
7. **CSV:** Open `https://<your-render-url>/admin/farmers.csv?key=YOUR_ADMIN_KEY` — it should download with the same columns as your tracker.

If all 7 pass, you are ready to share the number with real farmers.

## Step 11 — Connect the launch page form to POST /register

In the launch page code, change the registration form so on submit it calls:

```js
fetch('https://<your-render-url>/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: farmerName,
    whatsapp_number: farmerPhone,
    district: farmerDistrict,
    crop: farmerCrop,
    language: farmerLanguage,   // Urdu | Punjabi | English
    plan: farmerPlan,           // Basic | Pro
    billing: farmerBilling      // Monthly | Yearly
  })
})
```

On success (`{ ok: true }`) show: “Registered! Check WhatsApp for your welcome message. 7-day FREE trial started.”

Until this step is done, the launch page form still does not save — this backend is the part that fixes it.

---

## Troubleshooting

| Problem | What to check |
|---|---|
| Webhook will not verify | `VERIFY_TOKEN` must match exactly in Render and Meta. Render URL must be live — open `/health` first. Render free tier may be asleep — wait 60 seconds and retry. |
| Template not approved | Remove promotional words. Keep it Utility, factual, and short. Resubmit with English first. |
| Number already in WhatsApp Business App | That is expected. A number cannot be in the app and the API at the same time. Migrate it (Step 4) or use a second number for the API. |
| Token expired | You used the 24-hour test token. Use the permanent System User token from Step 5. |
| Messages not arriving | Check the template is approved (for business-initiated messages). Check the farmer saved your number (Broadcast / template delivery needs opt-in). Check Render logs for Meta errors. Check `/health` — if `mode` is `mock`, `WHATSAPP_TOKEN` / `PHONE_NUMBER_ID` are not set in Render. |
| “Farmer not found” on APPROVE | Use the exact number as stored, e.g. `03001234567`. Check `/admin/farmers` to see the stored number. |
| Render app sleeps | Normal on the free plan. First request after sleep is slow. Upgrade to a paid Render plan later if you need it always awake — that is optional, not required to start. |
| Payment not auto-verified | That is by design. JazzCash / UBL transfer has no free auto-check. You check in your own app, then send `APPROVE <number>`. One tap. |

## Daily routine (after going live)

1. Morning: check `/admin/farmers` for `Expiring Soon` farmers — send renewal reminders.
2. Ask Muse for today's alert text for your crops/districts, then call `/admin/send-alert` (2–3 times a week, not daily, to keep Meta cost low).
3. When a farmer sends a Transaction ID, check JazzCash / UBL, then `APPROVE <number>`.
4. Export `/admin/farmers.csv` once a week and paste it into your tracker `.xlsx` to keep both in sync.

## Costs — honest summary

- Meta Cloud API: **$0 monthly fee**
- Render free tier: **$0**
- This code: **$0**
- Meta per-message (Pakistan, Oct 2026 rates): Utility ~$0.015, Marketing ~$0.0473, first 1,000 service replies/month free.
- Example: 100 farmers, alert 3× a week as Utility = 100 × 12 × $0.015 = **~$18/month**. Daily alerts would be ~$45/month. Fewer alerts = lower cost.
