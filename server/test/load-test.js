/**
 * Load test for Nagrik — runs against a LOCAL server instance with the AI
 * layer stubbed (no external API calls, no quota burn).
 *
 * Scenario A: 100 concurrent GET /api/reports (feed reads)
 * Scenario B: 20 concurrent POST /api/reports (AI stubbed to ~100ms)
 *
 * Usage: node test/load-test.js
 * Requires a real Supabase (reads/writes are real; rows are cleaned up).
 */
require('dotenv').config();
const path = require('path');

// ---- stub the AI layer BEFORE requiring the app ----
const aiPath = path.resolve(__dirname, '..', 'lib', 'ai.js');
require.cache[aiPath] = {
  id: aiPath, filename: aiPath, loaded: true,
  exports: {
    // ~100ms fake latency to simulate the vision call
    classifyIssuePhoto: async () => {
      await new Promise((r) => setTimeout(r, 100));
      return { category: 'pothole', severity_score: 7, description: 'load-test stub classification' };
    },
    generateComplaintText: async () => 'load-test stub complaint letter',
  },
};

const { supabaseAdmin } = require('../lib/supabase');

const BASE = process.env.LOAD_TARGET || 'http://localhost:8080';
const stats = { ok: 0, err: 0, latencies: [] };

async function timedFetch(url, opts) {
  const t0 = process.hrtime.bigint();
  try {
    const res = await fetch(url, opts);
    await res.text(); // drain
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    stats.latencies.push(ms);
    if (res.ok) stats.ok++;
    else stats.err++;
    return res.status;
  } catch (e) {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    stats.latencies.push(ms);
    stats.err++;
    return 0;
  }
}

function pct(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function report(label, wallMs) {
  const n = stats.latencies.length;
  const rps = (n / (wallMs / 1000)).toFixed(1);
  console.log(`\n=== ${label} ===`);
  console.log(`requests: ${n} | ok: ${stats.ok} | errors: ${stats.err} (${((stats.err / n) * 100).toFixed(1)}%)`);
  console.log(`throughput: ${rps} req/s | wall: ${(wallMs / 1000).toFixed(1)}s`);
  console.log(`latency ms: p50=${pct(stats.latencies, 0.5).toFixed(0)} p95=${pct(stats.latencies, 0.95).toFixed(0)} p99=${pct(stats.latencies, 0.99).toFixed(0)} max=${Math.max(...stats.latencies).toFixed(0)}`);
}

(async () => {
  // login a load-test user
  let res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'nagrik.e2e.latency@gmail.com', password: 'TestPass123!' }),
  });
  if (res.status !== 200) { console.error('login failed:', res.status); process.exit(1); }
  const cookie = res.headers.get('set-cookie').split(';')[0];
  console.log('logged in. target:', BASE);

  // ---------- Scenario A: 100 concurrent feed GETs ----------
  Object.assign(stats, { ok: 0, err: 0, latencies: [] });
  let t0 = Date.now();
  await Promise.all(
    Array.from({ length: 100 }, () => timedFetch(`${BASE}/api/reports?sort=priority`))
  );
  report('A: 100 concurrent GET /api/reports', Date.now() - t0);

  // ---------- Scenario A2: sustained feed reads (500 requests, batches of 50) ----------
  Object.assign(stats, { ok: 0, err: 0, latencies: [] });
  t0 = Date.now();
  for (let batch = 0; batch < 10; batch++) {
    await Promise.all(
      Array.from({ length: 50 }, () => timedFetch(`${BASE}/api/reports?sort=priority`))
    );
  }
  report('A2: 500 feed reads (10 batches of 50)', Date.now() - t0);

  // ---------- Scenario B: 20 concurrent POSTs (AI stubbed ~100ms) ----------
  Object.assign(stats, { ok: 0, err: 0, latencies: [] });
  t0 = Date.now();
  const photoUrl = 'https://gmqhczibpjqfeltjelsa.supabase.co/storage/v1/object/public/report-photos/latency-test/final-pothole.jpg';
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      timedFetch(`${BASE}/api/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          photo_url: photoUrl,
          lat: 27.9 - i * 0.001, lng: 77.9 - i * 0.001, // scattered to avoid dup-count interplay
          description: 'load-test-delete-me',
        }),
      })
    )
  );
  report('B: 20 concurrent POST /api/reports (AI stubbed)', Date.now() - t0);

  // ---------- cleanup load-test rows ----------
  const { data } = await supabaseAdmin.from('reports').select('id').eq('description', 'load-test-delete-me');
  if (data?.length) {
    await supabaseAdmin.from('reports').delete().in('id', data.map((r) => r.id));
    console.log(`\ncleanup: removed ${data.length} load-test reports`);
  }
  process.exit(0);
})().catch((e) => { console.error('LOAD TEST ERROR:', e.message); process.exit(1); });
