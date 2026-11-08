# Kisan Dost — LLM + leaf/disease vision upgrade (draft, NOT live)

Prepared: 2026-11-08. Status: **draft only — nothing is switched on, nothing is deployed, no cost incurred.**

Bahram asked on 2026-11-08 for Kisan Dost to answer farmers' questions in real time with AI, and whether Meta can answer leaf/disease identification from a photo. Answer to the second part: **No — Meta Cloud API is only the messenger.** It delivers the farmer's text/photo to our server and delivers our answer back. The AI must live in our server. This draft adds that AI.

## What is ready

- `ai.js` (new, in this folder) — `askAI(text, farmer)` for any text question and `diagnoseImage(base64, mimeType, farmer)` for a leaf photo. No new npm dependency; uses Node's built-in `fetch`.
- Verified 2026-11-08: `node --check ai.js` and `node --check server.js` pass. With no `AI_API_KEY` set, both functions return `null` — so the current fixed keyword answers keep working exactly as today, and no AI cost is incurred.
- `server.js` is **unchanged**. The two integration points are listed in the header of `ai.js` and below; they are a small edit, not a rebuild.

## How it will work when switched on

Farmer asks on WhatsApp → Meta Cloud API → our server → AI → answer back on WhatsApp in real time, in Urdu / Punjabi / English.

- **Text:** if the fixed keyword answer does not cover the question, the server asks the LLM instead of the generic "send your question" fallback.
- **Photo:** farmer sends a leaf photo → server downloads it from Meta (Graph API media URL, with the WhatsApp token) → vision AI replies with: likely disease/pest name, how sure it is (%), treatment product, dose per acre / per litre, how to mix and spray, when to spray, safety/PPE, waiting period, and "confirm with your local agriculture officer if unsure". If the photo is blurry, it asks for a clearer photo of the leaf, top and bottom.
- **Safety rules baked into the prompt:** dose + crop stage + application + PPE + waiting period on every answer; never invent a product or dose; say "not sure" when unsure.

## What stays the same

- Free Meta Cloud API connection, no 360dialog. Manual JazzCash/UBL payment activation with Bahram's 1-tap approval — unchanged.
- Registration, plans (Basic PKR 499/month, Pro PKR 899/month, 7-day free trial), welcome and payment messages — unchanged.
- If the AI key is missing or an AI call fails, the server falls back to the current keyword answers.

## Cost — the honest part

- The Cloud API connection itself stays free (Meta per-message charges as in SETUP_GUIDE still apply). **The LLM/vision part is NOT free:** it charges a small amount per question / per photo, depending on the provider and model. The draft defaults to `gpt-4o-mini` (a low-cost model) — no exact per-question price is quoted here because it depends on the provider's current price list; check the provider dashboard and set a monthly spending cap before going live.
- The key is an `AI_API_KEY` environment variable in Render. **Never send the key in chat or WhatsApp** — Bahram will add it in Render himself, or give it through a secure connection.

## What still blocks going live (do this first)

1. **Meta developer registration is still blocked** (reported 2026-11-08). This upgrade does not fix that — the server still needs the Meta token, webhook and templates to reach farmers at all.
2. **Workaround to try while that is blocked:** create the WhatsApp Business Account directly in Meta Business Suite → WhatsApp Manager / WhatsApp Accounts (add a WABA, add/verify the number, create templates there). That step does not need the developer site first, and it proves the Kisan Dost business — use the **Kisan Dost** Facebook Page, not GEN-Z Trading Academy. The developer app / System User token is still needed later for the webhook, so this unblocks progress, it does not replace the developer step. Do **not** use a paid BSP / embedded-signup platform for this — the direct route is free.
3. Send the exact error message + a screenshot of the developer-registration failure before trying another workaround.

## To switch on (needs Bahram's yes)

1. Bahram says "yes, add LLM + vision" and accepts the small per-use AI cost.
2. Developer registration / WABA step is unblocked.
3. Bahram adds `AI_API_KEY` (and optionally `AI_MODEL`, `AI_BASE_URL`) in Render — never in chat.
4. Wire `ai.js` into `server.js` at the two points in its header, deploy to Render, test with his own number: (a) a text question the keyword answers do not cover, (b) a leaf photo.
5. Only then share with real farmers.

## Files

- `ai.js` — draft module, tested in mock (no-key) mode only.
- `server.js` — unchanged.
- `SETUP_GUIDE.md` — still the go-live checklist (Steps 1–11).
