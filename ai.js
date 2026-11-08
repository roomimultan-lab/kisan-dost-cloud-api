// Kisan Dost — LLM + vision AI draft (NOT switched on yet)
// -------------------------------------------------------
// DRAFT only, prepared 2026-11-08. server.js does NOT load this file yet.
// It stays off until Bahram says yes AND gives an AI key securely (never in chat).
// With no AI_API_KEY set, both functions return null and server.js keeps
// its current fixed keyword answers. No cost is incurred in that state.
//
// When activated, the integration points in server.js are:
//  1. Text: in handleIncomingMessage(), if getAdvice() returns null,
//     call askAI(text, farmer) before the generic fallback.
//  2. Photo: in the /webhook handler, where msg.type === 'image' is
//     currently only logged, download the media via the Meta Graph API
//     (GET /{media-id} then its url, with WHATSAPP_TOKEN), then call
//     diagnoseImage(buffer, mimeType, farmer).
// No new npm dependency is needed — this uses global fetch (Node >= 18).

// Config from environment (no secrets in code)
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_BASE_URL = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';
const AI_ENABLED = Boolean(AI_API_KEY);

function systemPrompt(farmer) {
  const lang = (farmer && farmer.language) || 'Urdu';
  const crop = (farmer && farmer.crop) || 'unknown crop';
  const district = (farmer && farmer.district) || 'unknown district';
  return [
    'You are Kisan Dost, a farming adviser for farmers in Pakistan and India.',
    `Answer in ${lang}. Farmer crop: ${crop}. District: ${district}.`,
    'Always give: dose per acre / per litre, crop stage, how to mix and apply,',
    'when to spray/apply, safety/PPE, and waiting period before harvest.',
    'End with: confirm with your local agriculture officer if unsure.',
    'If you are not sure, say so clearly and ask for a clearer photo or more detail.',
    'Never invent a product name or a dose. Keep the answer short and practical.',
  ].join(' ');
}

async function callChat(messages) {
  if (!AI_ENABLED) return null;
  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: AI_MODEL, messages, temperature: 0.2, max_tokens: 600 }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('AI call failed: ' + (data.error?.message || res.status));
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim() || null;
}

// Text question -> real-time LLM answer. Returns null when AI is off.
async function askAI(text, farmer) {
  if (!AI_ENABLED) return null;
  return callChat([
    { role: 'system', content: systemPrompt(farmer) },
    { role: 'user', content: String(text || '') },
  ]);
}

// Leaf photo -> vision diagnosis. imageBase64 is the photo, mimeType e.g. image/jpeg.
// Returns null when AI is off. The caller must download the image from Meta first.
async function diagnoseImage(imageBase64, mimeType, farmer) {
  if (!AI_ENABLED) return null;
  const lang = (farmer && farmer.language) || 'Urdu';
  return callChat([
    { role: 'system', content: systemPrompt(farmer) },
    {
      role: 'user',
      content: [
        { type: 'text', text: `Identify the leaf disease or pest in this photo, in ${lang}. Give: likely disease/pest name, how sure you are (%), treatment product, dose per acre/per litre, how to mix and spray, when to spray, safety/PPE and waiting period. If the photo is blurry or the leaf is not clear, ask for a clearer photo of the leaf, top and bottom.` },
        { type: 'image_url', image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${imageBase64}` } },
      ],
    },
  ]);
}

module.exports = { AI_ENABLED, AI_MODEL, askAI, diagnoseImage, systemPrompt };
