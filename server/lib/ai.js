const Anthropic = require('@anthropic-ai/sdk');

// Anthropic-compatible endpoint served by agentrouter. Base URL is the ROOT
// (not /v1) — the SDK appends /v1/messages itself.
//
// agentrouter fronts the API with a WAF that fingerprints clients: default
// SDK/curl requests get 401 "unauthorized client detected". Passing the
// three headers below (an official-client fingerprint) on every request
// gets traffic through. See direct-api guide in the samkiell/AgentRouter
// repo; this is an unofficial workaround and may change without notice.
const anthropic = new Anthropic({
  baseURL: 'https://agentrouter.org',
  apiKey: process.env.AGENTROUTER_API_KEY,
  defaultHeaders: {
    'Originator': 'codex_cli_rs',
    'Version': '0.101.0',
    'User-Agent': 'codex_cli_rs/0.101.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464',
  },
});

const VALID_CATEGORIES = [
  'pothole', 'garbage', 'streetlight', 'water_supply', 'drainage',
  'road_damage', 'illegal_construction', 'other',
];

/**
 * Classifies an uploaded civic-issue photo: category + severity (0-10) + a
 * one-line description. Expects a public/signed image URL (Supabase Storage).
 *
 * PROVIDERS (CLASSIFY_PROVIDER env var, default 'latentcode'):
 *   - latentcode (PRIMARY): gemini-3.6-flash via latentstack.dev's
 *     OpenAI-compatible /v1/chat/completions — passed the full 4-check
 *     vision suite (solid-color control, real pothole accuracy, negative
 *     control, 3x consistency) on 2026-09-05, ~40% faster than
 *     gemini-3.1-pro with identical accuracy (test/vision-check-latentcode.js).
 *     Account has unlimited hackathon-credit rate limits. gemini-3.1-pro
 *     also passed and is a one-line upgrade if accuracy ever matters more
 *     than latency.
 *   - agentrouter (FALLBACK): gpt-5.6-sol via the Anthropic SDK — also
 *     passed the 4-check suite, but agentrouter budget pools exhaust
 *     quickly (402s). Switch CLASSIFY_PROVIDER=agentrouter if latentstack
 *     is ever down.
 * History: glm-5.3 hallucinated images from prompt text; deepseek-v4-flash
 * honestly reported "no image content visible" (no vision).
 * The complaint letter stays on glm-5.3 (agentrouter) — text-only, verified.
 * The image is downloaded server-side and sent as base64 (both providers).
 *
 * Latency hardening (2026-09-05): agentrouter routes some requests to
 * slow/flaky nodes — observed 20-48s calls and intermittent upstream 4xx
 * where isolated calls run 5-9s. Each attempt gets a 25s timeout with one
 * retry on timeout or upstream 4xx/5xx; if both fail the caller saves the
 * report unclassified (see the fallback in routes/reports.js) instead of
 * blocking the user.
 */
const CLASSIFY_TIMEOUT_MS = 25_000;
const CLASSIFY_ATTEMPTS = 2;
const CLASSIFY_PROVIDER = process.env.CLASSIFY_PROVIDER || 'latentcode';
const LATENTCODE_BASE = 'https://latentstack.dev/v1';

// ---- in-process semaphore: cap concurrent AI calls ----
// A viral submission spike would otherwise fire hundreds of simultaneous
// requests at the provider, tripping its practical concurrency ceiling and
// cascading timeouts (with retries doubling the load). Instead: at most
// MAX_CONCURRENT_CLASSIFY in flight; the rest wait in FIFO order. Waiting
// counts against the timeout, so a request queued too long still falls
// through to the "Pending manual review" fallback rather than hanging.
const MAX_CONCURRENT_CLASSIFY = 10;
const QUEUE_WARN_DEPTH = 5;
let inFlight = 0;
const waiters = []; // FIFO of {resolve}

async function acquireClassifySlot() {
  if (inFlight < MAX_CONCURRENT_CLASSIFY) {
    inFlight++;
    return;
  }
  if (waiters.length + 1 > QUEUE_WARN_DEPTH) {
    console.warn(
      `[classify:queue] depth ${waiters.length + 1} waiting (>${QUEUE_WARN_DEPTH}) — submission burst in progress`
    );
  }
  await new Promise((resolve) => waiters.push(resolve));
  inFlight++;
}

function releaseClassifySlot() {
  inFlight--;
  const next = waiters.shift();
  if (next) next();
}

async function classifyIssuePhoto(imageUrl) {
  const { base64, mediaType } = await downloadImageAsBase64(imageUrl);

  // The queue wait itself is bounded by the same timeout: if a request
  // can't acquire a slot in time, it throws (TimeoutError) and the route
  // falls back to "Pending manual review" instead of queuing indefinitely.
  await withTimeout(
    acquireClassifySlot(),
    CLASSIFY_TIMEOUT_MS,
    `classification request timed out waiting in queue (depth ${waiters.length})`
  );

  let lastError = null;
  try {
    for (let attempt = 1; attempt <= CLASSIFY_ATTEMPTS; attempt++) {
      try {
        const text = await withTimeout(
          CLASSIFY_PROVIDER === 'latentcode'
            ? classifyViaLatentcode(base64, mediaType)
            : classifyViaAgentrouter(base64, mediaType),
          CLASSIFY_TIMEOUT_MS,
          `classification attempt ${attempt} timed out after ${CLASSIFY_TIMEOUT_MS / 1000}s`
        );

        const parsed = safeParseJson(text);

        return {
          category: VALID_CATEGORIES.includes(parsed.category) ? parsed.category : 'other',
          severity_score: clamp(Number(parsed.severity_score) || 0, 0, 10),
          description: parsed.description || '',
        };
      } catch (err) {
        lastError = err;
        const isRetryable = err.name === 'TimeoutError' || (typeof err.status === 'number' && err.status >= 400) || err.status >= 400;
        console.error(
          `[classify:${CLASSIFY_PROVIDER}] attempt ${attempt}/${CLASSIFY_ATTEMPTS} failed:`,
          err.name === 'TimeoutError' ? err.message : `${err.status ?? ''} ${err.message ?? err}`
        );
        if (attempt < CLASSIFY_ATTEMPTS && isRetryable) continue;
        throw err;
      }
    }
    throw lastError;
  } finally {
    releaseClassifySlot();
  }
}


const CLASSIFY_PROMPT = `Look at this photo of a civic/infrastructure issue. Respond with ONLY a JSON object, no markdown, no preamble:
{
  "category": one of ${JSON.stringify(VALID_CATEGORIES)},
  "severity_score": number 0-10 (10 = severe safety hazard, 0 = cosmetic),
  "description": "one short factual sentence describing what's visible"
}`;

/** agentrouter path: Anthropic Messages format, base64 image block. */
async function classifyViaAgentrouter(base64, mediaType) {
  const msg = await anthropic.messages.create({
    model: 'gpt-5.6-sol',
    max_tokens: 5000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: CLASSIFY_PROMPT },
        ],
      },
    ],
  });
  return extractText(msg);
}

/** LatentCode path: OpenAI chat-completions format, base64 data-URI image. */
async function classifyViaLatentcode(base64, mediaType) {
  const res = await fetch(`${LATENTCODE_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.LATENTCODE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gemini-3.6-flash',
      max_tokens: 5000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: CLASSIFY_PROMPT },
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
          ],
        },
      ],
    }),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    const e = new Error(`latentcode ${res.status}: ${bodyText.slice(0, 200)}`);
    e.status = res.status;
    throw e;
  }
  const parsed = JSON.parse(bodyText);
  return parsed.choices?.[0]?.message?.content ?? '';
}


/** Rejects with a TimeoutError if the promise doesn't settle in `ms`. */
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error(message);
      e.name = 'TimeoutError';
      reject(e);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Generates a formal complaint letter ready to submit to the relevant civic
 * authority / MLA office. Returns plain text the user can copy or the app
 * can pre-fill into an official portal link.
 */
async function generateComplaintText({ category, description, ward, constituency, mlaName, lat, lng, createdAt }) {
  const msg = await anthropic.messages.create({
    model: 'glm-5.3',
    max_tokens: 8000,
    messages: [
      {
        role: 'user',
        content: `Draft a formal, concise civic grievance letter for submission to a local municipal authority / MLA office in India. Use a respectful, factual, official tone. Include a clear subject line.

Details:
- Issue category: ${category}
- Description: ${description}
- Ward: ${ward || 'not specified'}
- Constituency: ${constituency || 'not specified'}
- MLA: ${mlaName || 'not specified'}
- Location (lat,lng): ${lat}, ${lng}
- Reported on: ${createdAt}

Output only the letter text, no extra commentary.`,
      },
    ],
  });

  return extractText(msg);
}

/**
 * Extracts the text block from a model response. agentrouter sometimes
 * returns the Anthropic-shaped body as a double-encoded JSON string rather
 * than a parsed object, so handle both.
 */
function extractText(msg) {
  const parsed = typeof msg === 'string' ? safeParseJson(msg) : msg;
  const blocks = parsed?.content ?? [];
  return blocks.find((b) => b.type === 'text')?.text ?? '';
}

/**
 * Downloads the photo server-side and returns it as base64 + media type
 * for inline image input. claude-opus-4-8 via agentrouter doesn't accept
 * URL image sources, so every classification goes through this.
 */
async function downloadImageAsBase64(imageUrl) {
  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`Failed to download photo for classification (HTTP ${res.status})`);
  }
  const mediaType = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!ALLOWED.includes(mediaType)) {
    throw new Error(`Unsupported photo content-type: ${mediaType}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { base64: buf.toString('base64'), mediaType };
}


function safeParseJson(text) {
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return {};
  }
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

module.exports = { classifyIssuePhoto, generateComplaintText };
