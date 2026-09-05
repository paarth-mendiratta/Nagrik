/**
 * Vision verification harness for candidate classifyIssuePhoto models.
 * Usage: node test/vision-check.js <model-id>
 *
 * Four checks:
 *  1. Solid red 8x8 PNG -> must answer "red"
 *  2. Real pothole photo -> accurate category/severity/description
 *  3. Honey-dipper negative control -> must NOT force a civic classification
 *  4. Real pothole x3 -> category/severity must not drift
 */
require('dotenv').config();
const fs = require('fs');
const zlib = require('zlib');
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.argv[2];
if (!MODEL) { console.error('Usage: node test/vision-check.js <model-id>'); process.exit(1); }

const anthropic = new Anthropic({
  baseURL: 'https://agentrouter.org',
  apiKey: process.env.AGENTROUTER_API_KEY,
  defaultHeaders: {
    'Originator': 'codex_cli_rs',
    'Version': '0.101.0',
    'User-Agent': 'codex_cli_rs/0.101.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464',
  },
});

// ---- solid red 8x8 PNG (same generator as previous diagnostics) ----
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

async function ask(content, maxTokens = 5000) {
  const t0 = Date.now();
  const msg = await anthropic.messages.create({ model: MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content }] });
  const ms = Date.now() - t0;
  const p = typeof msg === 'string' ? JSON.parse(msg) : msg;
  const text = (p.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return { ms, id: p.id, model: p.model, text, raw: p };
}

function imgBlock(buf, mediaType) {
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data: buf.toString('base64') } };
}

(async () => {
  const redPng = solidRedPng();
  const pothole = fs.readFileSync('/tmp/real-pothole-final.jpg');
  const honey = fs.readFileSync('/tmp/img-312.jpg');

  console.log('##### MODEL: ' + MODEL + ' #####');

  // 1. solid red
  try {
    const r = await ask([imgBlock(redPng, 'image/png'), { type: 'text', text: 'What single color fills this image? Answer with just the color name.' }], 2000);
    console.log('\n[1] SOLID RED | ' + r.ms + 'ms | id: ' + r.id);
    console.log(r.text.slice(0, 200));
  } catch (e) { console.log('\n[1] SOLID RED FAILED:', e.status, JSON.stringify(e.error ?? e.message).slice(0, 200)); }

  // 2. real pothole (classifier prompt, exactly as production)
  const classifyPrompt = (extra) => [
    imgBlock(pothole, 'image/jpeg'),
    { type: 'text', text: 'Look at this photo of a civic/infrastructure issue. Respond with ONLY a JSON object, no markdown, no preamble:\n{\n  "category": one of ' + JSON.stringify(VALID_CATEGORIES) + ',\n  "severity_score": number 0-10 (10 = severe safety hazard, 0 = cosmetic),\n  "description": "one short factual sentence describing what\'s visible"\n}' + (extra || '') },
  ];
  try {
    const r = await ask(classifyPrompt());
    console.log('\n[2] REAL POTHOLE | ' + r.ms + 'ms');
    console.log(r.text.slice(0, 300));
  } catch (e) { console.log('\n[2] REAL POTHOLE FAILED:', e.status, JSON.stringify(e.error ?? e.message).slice(0, 200)); }

  // 3. negative control: honey dipper
  try {
    const r = await ask([
      imgBlock(honey, 'image/jpeg'),
      { type: 'text', text: 'Look at this photo of a civic/infrastructure issue. Respond with ONLY a JSON object, no markdown, no preamble:\n{\n  "category": one of ' + JSON.stringify(VALID_CATEGORIES) + ',\n  "severity_score": number 0-10,\n  "description": "one short factual sentence describing what\'s visible"\n}' },
    ]);
    console.log('\n[3] NEGATIVE CONTROL (honey dipper) | ' + r.ms + 'ms');
    console.log(r.text.slice(0, 300));
  } catch (e) { console.log('\n[3] NEGATIVE CONTROL FAILED:', e.status, JSON.stringify(e.error ?? e.message).slice(0, 200)); }

  // 4. pothole x3 consistency
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await ask(classifyPrompt(' (run ' + i + ')'));
      console.log('\n[4.' + i + '] POTHOLE RUN ' + i + ' | ' + r.ms + 'ms');
      console.log(r.text.slice(0, 300));
    } catch (e) { console.log('\n[4.' + i + '] FAILED:', e.status, JSON.stringify(e.error ?? e.message).slice(0, 200)); }
  }

  process.exit(0);
})().catch((e) => { console.error('HARNESS ERROR:', e.message); process.exit(1); });
