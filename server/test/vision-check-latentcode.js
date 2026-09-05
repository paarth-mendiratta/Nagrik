/**
 * Vision verification for LatentCode (latentstack.dev) Gemini models.
 * Usage: node test/vision-check-latentcode.js [model-id]
 * Default model: gemini-3.1-pro
 *
 * Same 4-check rigor as test/vision-check.js (agentrouter), adapted to
 * LatentCode's OpenAI-compatible /v1/chat/completions format.
 */
require('dotenv').config();
const fs = require('fs');
const zlib = require('zlib');

const MODEL = process.argv[2] || 'gemini-3.1-pro';
const BASE = 'https://latentstack.dev/v1';
const KEY = process.env.LATENTCODE_API_KEY;
if (!KEY) { console.error('LATENTCODE_API_KEY not set'); process.exit(1); }

// ---- solid red 8x8 PNG (identical generator to the agentrouter suite) ----
function solidRedPng() {
  const W = 8, H = 8;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    const rowOff = y * (1 + W * 3);
    raw[rowOff] = 0;
    for (let x = 0; x < W; x++) {
      const off = rowOff + 1 + x * 3;
      raw[off] = 255; raw[off + 1] = 0; raw[off + 2] = 0;
    }
  }
  const crcTable = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  function crc32(buf) { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const VALID_CATEGORIES = ['pothole', 'garbage', 'streetlight', 'water_supply', 'drainage', 'road_damage', 'illegal_construction', 'other'];

async function ask(content) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content }],
      max_tokens: 5000,
    }),
  });
  const ms = Date.now() - t0;
  const body = await res.text();
  if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${body.slice(0, 250)}`);
  const parsed = JSON.parse(body);
  return { ms, model: parsed.model, text: parsed.choices?.[0]?.message?.content ?? '' };
}

/** OpenAI multimodal content: text + base64 data-URI image parts. */
function imgPart(buf, mime) {
  return { type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}` } };
}

(async () => {
  const redPng = solidRedPng();
  const pothole = fs.readFileSync('/tmp/real-pothole-final.jpg');
  const honey = fs.readFileSync('/tmp/img-312.jpg');

  console.log(`##### LatentCode MODEL: ${MODEL} #####`);

  // 1. solid red
  try {
    const r = await ask([
      { type: 'text', text: 'What single color fills this image? Answer with just the color name.' },
      imgPart(redPng, 'image/png'),
    ]);
    console.log(`\n[1] SOLID RED | ${r.ms}ms | model: ${r.model}`);
    console.log(r.text.slice(0, 200));
  } catch (e) { console.log(`\n[1] SOLID RED FAILED: ${e.message.slice(0, 250)}`); }

  const classifyPrompt = () => [
    { type: 'text', text: 'Look at this photo of a civic/infrastructure issue. Respond with ONLY a JSON object, no markdown, no preamble:\n{\n  "category": one of ' + JSON.stringify(VALID_CATEGORIES) + ',\n  "severity_score": number 0-10 (10 = severe safety hazard, 0 = cosmetic),\n  "description": "one short factual sentence describing what\'s visible"\n}' },
    imgPart(pothole, 'image/jpeg'),
  ];

  // 2. real pothole
  try {
    const r = await ask(classifyPrompt());
    console.log(`\n[2] REAL POTHOLE | ${r.ms}ms`);
    console.log(r.text.slice(0, 300));
  } catch (e) { console.log(`\n[2] REAL POTHOLE FAILED: ${e.message.slice(0, 250)}`); }

  // 3. negative control
  try {
    const r = await ask([
      { type: 'text', text: 'Look at this photo of a civic/infrastructure issue. Respond with ONLY a JSON object, no markdown, no preamble:\n{\n  "category": one of ' + JSON.stringify(VALID_CATEGORIES) + ',\n  "severity_score": number 0-10,\n  "description": "one short factual sentence describing what\'s visible"\n}' },
      imgPart(honey, 'image/jpeg'),
    ]);
    console.log(`\n[3] NEGATIVE CONTROL (honey dipper) | ${r.ms}ms`);
    console.log(r.text.slice(0, 300));
  } catch (e) { console.log(`\n[3] NEGATIVE CONTROL FAILED: ${e.message.slice(0, 250)}`); }

  // 4. pothole x3
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await ask(classifyPrompt());
      console.log(`\n[4.${i}] POTHOLE RUN ${i} | ${r.ms}ms`);
      console.log(r.text.slice(0, 300));
    } catch (e) { console.log(`\n[4.${i}] FAILED: ${e.message.slice(0, 250)}`); }
  }

  process.exit(0);
})().catch((e) => { console.error('HARNESS ERROR:', e.message); process.exit(1); });
