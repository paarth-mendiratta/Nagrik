/**
 * Smoke test for the 5 code-review fixes.
 *
 * Stubs server/lib/supabase, server/lib/ai and server/lib/instagram via
 * require-cache injection, then exercises the real route handlers,
 * duplicate detection, and scheduler lock. Run: node test/smoke.js
 */
const path = require('path');
const assert = require('assert');

// ---------- in-memory DB + Supabase stub ----------
const db = {
  reports: [],
  profiles: [],
  report_duplicates: [],
};

const TOKENS = {
  'tok-alice': { id: 'alice' },
  'tok-bob': { id: 'bob' },
  'tok-mod': { id: 'mod' },
};

function applyFilters(rows, filters) {
  return rows.filter((row) =>
    filters.every(([col, op, val]) => {
      const rv = row[col];
      switch (op) {
        case 'eq':
          return rv === val;
        case 'neq':
          return rv !== val;
        case 'gte':
          return rv >= val;
        case 'lte':
          return rv <= val;
        case 'ilike':
          return String(rv ?? '')
            .toLowerCase()
            .includes(String(val).replace(/%/g, '').toLowerCase());
        default:
          return true;
      }
    })
  );
}

function makeFrom() {
  return function from(table) {
    if (!db[table]) db[table] = [];
    const state = {
      cmd: 'select',
      filters: [],
      payload: null,
      cols: null,
      single: false,
      maybe: false,
      limitN: null,
      orderCol: null,
      orderAsc: true,
    };
    const q = {
      insert(p) { state.cmd = 'insert'; state.payload = p; return q; },
      select(cols) {
        if (cols && cols !== '*') state.cols = cols.split(',').map((s) => s.trim());
        return q;
      },
      update(p) { state.cmd = 'update'; state.payload = p; return q; },
      eq(c, v) { state.filters.push([c, 'eq', v]); return q; },
      neq(c, v) { state.filters.push([c, 'neq', v]); return q; },
      gte(c, v) { state.filters.push([c, 'gte', v]); return q; },
      lte(c, v) { state.filters.push([c, 'lte', v]); return q; },
      ilike(c, v) { state.filters.push([c, 'ilike', v]); return q; },
      not(c, op, v) { state.filters.push([c, op, v]); return q; },
      order(c, opts) { state.orderCol = c; state.orderAsc = !(opts && opts.ascending === false); return q; },
      limit(n) { state.limitN = n; return q; },
      single() { state.single = true; return exec(); },
      maybeSingle() { state.maybe = true; return exec(); },
      then(onRes, onRej) { return exec().then(onRes, onRej); },
    };

    function project(row) {
      if (!state.cols) return { ...row };
      const out = {};
      for (const c of state.cols) out[c] = row[c];
      return out;
    }

    function exec() {
      const rows = db[table];
      if (state.cmd === 'insert') {
        const row = { ...(table === 'reports' ? { status: 'pending' } : {}), id: `${table}-${rows.length + 1}`, ...state.payload };
        rows.push(row);
        return Promise.resolve({ data: project(row), error: null });
      }
      let matched = applyFilters(rows, state.filters);
      if (state.cmd === 'update') {
        for (const r of matched) Object.assign(r, state.payload);
      }
      if (state.orderCol) {
        matched = [...matched].sort((a, b) => {
          const d = a[state.orderCol] > b[state.orderCol] ? 1 : a[state.orderCol] < b[state.orderCol] ? -1 : 0;
          return state.orderAsc ? d : -d;
        });
      }
      if (state.limitN != null) matched = matched.slice(0, state.limitN);
      if (state.single) {
        return matched.length
          ? Promise.resolve({ data: project(matched[0]), error: null })
          : Promise.resolve({ data: null, error: { message: 'no rows' } });
      }
      if (state.maybe) {
        return Promise.resolve({ data: matched[0] ? project(matched[0]) : null, error: null });
      }
      return Promise.resolve({ data: matched.map(project), error: null });
    }

    return q;
  };
}

const supabaseAdmin = {
  from: makeFrom(),
  auth: {
    getUser: async (token) =>
      TOKENS[token]
        ? { data: { user: TOKENS[token] }, error: null }
        : { data: { user: null }, error: { message: 'invalid token' } },
  },
};

// ---------- controllable async stubs ----------
let letterDeferred = null;
let igPostCalls = 0;
let igDeferreds = [];

function registerStub(relPath, exportsObj) {
  const resolved = path.resolve(__dirname, '..', relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}

registerStub('lib/supabase.js', { supabaseAdmin });
registerStub('lib/ai.js', {
  classifyIssuePhoto: async () => ({ category: 'pothole', severity_score: 5, description: 'A pothole filled with water' }),
  generateComplaintText: () => new Promise((resolve) => { letterDeferred = resolve; }),
});
registerStub('lib/instagram.js', {
  postReportToInstagram: () =>
    new Promise((resolve) => { igPostCalls++; igDeferreds.push(resolve); }),
});

// ---------- real modules under test (loaded after stubs) ----------
const express = require('express');
const reportsRouter = require('../routes/reports');
const { findNearbyDuplicate } = require('../lib/duplicates');
const { runInstagramCheckCycle } = require('../lib/scheduler');

const app = express();
app.use(express.json());
app.use('/api/reports', reportsRouter);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, url, { token, body } = {}) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

let failures = 0;
function test(name, fn) {
  return fn()
    .then(() => console.log(`PASS  ${name}`))
    .catch((err) => { failures++; console.error(`FAIL  ${name}\n      ${err.message}`); });
}

const server = app.listen(0, async () => {
  const base = 'http://127.0.0.1:' + server.address().port;

  // ===== Fix 3: duplicate detection excludes rejected =====
  await test('findNearbyDuplicate ignores rejected reports, matches pending', async () => {
    db.reports = [
      { id: 'rej', category: 'pothole', status: 'rejected', lat: 28.6140, lng: 77.2090, duplicate_count: 0, created_at: new Date().toISOString() },
      { id: 'act', category: 'pothole', status: 'pending', lat: 28.6142, lng: 77.2090, duplicate_count: 0, created_at: new Date().toISOString() },
    ];
    const dup = await findNearbyDuplicate({ lat: 28.6139, lng: 77.2090, category: 'pothole' });
    assert.strictEqual(dup.id, 'act', 'should match the pending report, not the rejected one ~11m away');

    db.reports = [db.reports[0]]; // only the rejected one remains nearby
    const none = await findNearbyDuplicate({ lat: 28.6139, lng: 77.2090, category: 'pothole' });
    assert.strictEqual(none, null, 'a rejected report must not absorb duplicates');
    db.reports = [];
  });

  // ===== Fix 4: POST responds before the complaint letter is drafted =====
  let createdReportId;
  await test('POST /api/reports responds 201 immediately; complaint_text drafts async', async () => {
    const t0 = Date.now();
    const { status, body } = await call('POST', '/api/reports', {
      token: 'tok-alice',
      body: { photo_url: 'https://example.com/p.jpg', lat: 28.6139, lng: 77.2090 },
    });
    assert.strictEqual(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
    createdReportId = body.report.id;
    assert.ok(Date.now() - t0 < 500, 'response must not wait for the letter (2nd Claude call)');
    assert.ok(body.report.complaint_text == null, 'complaint_text must be null at response time');
    assert.strictEqual(body.report.category, 'pothole');

    // letter promise is pending; resolve it and confirm the row gets updated
    assert.ok(letterDeferred, 'generateComplaintText should have been called');
    letterDeferred('Dear Sir/Madam, ...正式 complaint...');
    await sleep(50);
    const row = db.reports.find((r) => r.id === createdReportId);
    assert.strictEqual(row.complaint_text, 'Dear Sir/Madam, ...正式 complaint...');
  });

  // ===== Rate limit: max 10 POSTs per user per hour =====
  await test('POST /api/reports: 11th request within the hour gets 429', async () => {
    // alice already made 1 POST above, so 9 more succeed, then 429
    let lastStatus = null;
    for (let i = 0; i < 9; i++) {
      const { status, body } = await call('POST', '/api/reports', {
        token: 'tok-alice',
        body: { photo_url: 'https://example.com/p' + i + '.jpg', lat: 28.6139, lng: 77.2090 },
      });
      lastStatus = status;
      if (status !== 201) { assert.fail(`request ${i + 2} should be 201, got ${status}: ${JSON.stringify(body)}`); }
    }
    assert.strictEqual(lastStatus, 201);

    const limited = await call('POST', '/api/reports', {
      token: 'tok-alice',
      body: { photo_url: 'https://example.com/over.jpg', lat: 28.6139, lng: 77.2090 },
    });
    assert.strictEqual(limited.status, 429, `11th POST should be 429, got ${limited.status}`);
    assert.ok(limited.body.error.includes('Rate limit'), `429 body should explain: ${JSON.stringify(limited.body)}`);
  });

  await test('rate limit is per-user: bob is unaffected by alice hitting the cap', async () => {
    const { status } = await call('POST', '/api/reports', {
      token: 'tok-bob',
      body: { photo_url: 'https://example.com/bob.jpg', lat: 28.6139, lng: 77.2090 },
    });
    assert.strictEqual(status, 201, `bob should not be rate-limited by alice's usage, got ${status}`);
  });

  // ===== Server-side photo_url validation =====
  await test('POST /api/reports: non-image photo_url rejected with 400', async () => {
    const { status, body } = await call('POST', '/api/reports', {
      token: 'tok-bob',
      body: { photo_url: 'https://example.com/payload.txt', lat: 28.6139, lng: 77.2090 },
    });
    assert.strictEqual(status, 400, `.txt should be rejected, got ${status}: ${JSON.stringify(body)}`);
  });

  await test('POST /api/reports: http (non-https) photo_url rejected with 400', async () => {
    const { status } = await call('POST', '/api/reports', {
      token: 'tok-bob',
      body: { photo_url: 'http://example.com/p.jpg', lat: 28.6139, lng: 77.2090 },
    });
    assert.strictEqual(status, 400, 'http:// should be rejected');
  });

  // ===== Fix 1: ownership / moderator check on PATCH status =====
  await test('PATCH status: 400 on invalid status', async () => {
    const { status } = await call('PATCH', `/api/reports/${createdReportId}/status`, {
      token: 'tok-alice', body: { status: 'banana' },
    });
    assert.strictEqual(status, 400);
  });

  await test('PATCH status: 404 for unknown report', async () => {
    const { status } = await call('PATCH', '/api/reports/nope/status', {
      token: 'tok-alice', body: { status: 'resolved' },
    });
    assert.strictEqual(status, 404);
  });

  await test('PATCH status: non-owner non-moderator gets 403', async () => {
    const { status, body } = await call('PATCH', `/api/reports/${createdReportId}/status`, {
      token: 'tok-bob', body: { status: 'resolved' },
    });
    assert.strictEqual(status, 403, `bob must not resolve alice's report: ${JSON.stringify(body)}`);
    assert.strictEqual(db.reports.find((r) => r.id === createdReportId).status, 'pending', 'status must be unchanged');
  });

  await test('PATCH status: owner gets 200', async () => {
    const { status, body } = await call('PATCH', `/api/reports/${createdReportId}/status`, {
      token: 'tok-alice', body: { status: 'acknowledged' },
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.report.status, 'acknowledged');
  });

  await test('PATCH status: moderator can update someone else\'s report', async () => {
    db.profiles.push({ id: 'mod', is_moderator: true });
    const { status, body } = await call('PATCH', `/api/reports/${createdReportId}/status`, {
      token: 'tok-mod', body: { status: 'resolved' },
    });
    assert.strictEqual(status, 200, `moderator should be allowed: ${JSON.stringify(body)}`);
    assert.strictEqual(body.report.status, 'resolved');
    assert.ok(body.report.resolved_at, 'resolved_at should be set');
  });

  await test('PATCH status: non-moderator profile row still 403', async () => {
    db.profiles = [{ id: 'bob', is_moderator: false }];
    const { status } = await call('PATCH', `/api/reports/${createdReportId}/status`, {
      token: 'tok-bob', body: { status: 'rejected' },
    });
    assert.strictEqual(status, 403);
    db.profiles = [];
  });

  // ===== Fix 5: scheduler overlap is skipped, not queued =====
  await test('scheduler: overlapping cycle is skipped while one runs', async () => {
    db.reports = []; // isolate: only sched-* reports below should be posted
    igPostCalls = 0;
    igDeferreds = [];
    db.reports.push({
      id: 'sched-1', category: 'garbage', status: 'pending', user_id: 'alice',
      photo_url: 'x', lat: 1, lng: 1, priority_score: 90, duplicate_count: 0,
      created_at: new Date().toISOString(), ig_post_id: null, ig_last_posted_at: null,
    });

    const logs = [];
    const origLog = console.log;
    console.log = (...a) => logs.push(a.join(' '));

    const first = runInstagramCheckCycle(); // will block inside postReportToInstagram
    await sleep(20); // let it reach the IG call
    assert.strictEqual(igPostCalls, 1, 'first cycle should have started posting');

    const second = runInstagramCheckCycle(); // overlaps — must skip
    await second;
    assert.strictEqual(igPostCalls, 1, 'overlapping cycle must NOT post again');
    assert.ok(logs.some((l) => l.includes('skipping')), 'skip should be logged');

    igDeferreds.forEach((r) => r({ id: 'ig-1', simulated: true }));
    await first;
    console.log = origLog;

    const row = db.reports.find((r) => r.id === 'sched-1');
    assert.strictEqual(row.ig_post_id, 'ig-1', 'first cycle should complete and record the post');

    // lock is released after completion: a fresh cycle runs again
    db.reports.push({
      id: 'sched-2', category: 'garbage', status: 'pending', user_id: 'alice',
      photo_url: 'x', lat: 1, lng: 1, priority_score: 80, duplicate_count: 0,
      created_at: new Date().toISOString(), ig_post_id: null, ig_last_posted_at: null,
    });
    const third = runInstagramCheckCycle();
    await sleep(20);
    assert.strictEqual(igPostCalls, 2, 'lock must be released so a new cycle can run');
    igDeferreds.forEach((r) => r({ id: 'ig-2', simulated: true }));
    await third;
  });

  server.close();
  console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
});
