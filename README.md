# Nagrik

"Twitter for civic issues" — report potholes, broken roads, and infrastructure
problems, get automatic MLA lookup + priority scoring, and let unresolved
issues get publicly surfaced on Instagram to create real accountability
pressure.

## How it works

1. User photographs an issue and submits it with location.
2. **AI vision** classifies the category and severity, and drafts a
   one-line description if the user didn't write one.
3. The backend checks for **nearby duplicate reports** (same category,
   within ~50m, last 30 days) and bumps a shared duplicate counter.
4. A **priority score** (0-100) is computed from severity + duplicates + age
   + category weight — this drives the priority bar on the feed and the
   default sort order.
5. **AI drafts an official complaint letter**, ready to copy into the
   relevant government portal.
6. An hourly **scheduler** checks unresolved reports and posts (or reposts)
   them to an Instagram account with a "N days, 0 action taken" caption —
   the public pressure mechanism.
7. The public feed shows live "Reported / Resolved / Pending" counts.

## Stack

- **Backend**: Node + Express, Supabase (Postgres + Storage + Auth)
- **Frontend**: React + Vite + TypeScript
- **AI**: `gpt-5.6-sol` (photo classification, vision-verified) + `glm-5.3` (complaint letters), both via agentrouter.org's Anthropic-compatible endpoint using the `@anthropic-ai/sdk`
- **Instagram**: Meta Graph API (with a simulate mode for demo/dev)

Auth follows the same httpOnly-cookie pattern as the No Cap project — token
never touches `localStorage`/`sessionStorage`, session is checked via
`/api/auth/me` on load.

## Setup

### 1. Supabase

1. Create a project at supabase.com.
2. Open the SQL editor and run `supabase/schema.sql`.
3. Create a public Storage bucket named `report-photos`.
4. (Optional but needed for MLA lookup) seed the `mlas` table.
   **Before the demo:** edit `server/data/mlas.json` — it's a fill-in
   template. Add one entry per constituency in your demo area (typical
   demo: 3-5 entries). Required fields per entry: `name`, `constituency`
   (unique — the seed script matches on it), `center_lat`, `center_lng`
   (a rough center point of the constituency; nearest-center lookup is
   used). Optional but nice for the demo: `party`, `ward`,
   `contact_email`, `contact_phone`. Then run from `server/`:
   `node scripts/seed-mlas.js` (re-runnable — upserts, no duplicates).

### 2. Backend

```bash
cd server
cp .env.example .env   # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AGENTROUTER_API_KEY
npm install
npm run dev             # http://localhost:8080
node scripts/seed-moderator.js your@email.com  # promote a moderator who can resolve any report
```

### 3. Frontend

```bash
cd client
cp .env.example .env    # fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm install
npm run dev              # http://localhost:3000
```

Visit `http://localhost:3000`. In dev, Vite proxies `/api` to the backend so
everything is same-origin and cookies work with zero CORS config.

### 4. Instagram (do this Day 1 — approval can be slow)

See `server/lib/instagram.js` for the full setup steps. Until you've done
the Meta app review, leave `IG_SIMULATE=true` in `.env` — the scheduler will
log what it *would* post instead of actually posting, so the feature is
still demoable.

## Deploying

- **Backend**: Render/Railway/Fly — set every var in `.env.example`,
  especially `CLIENT_URL` (the server refuses to boot in `NODE_ENV=production`
  without it — this is intentional, see the CORS comment in `server/index.js`).
- **Frontend**: Vercel/Netlify — set `VITE_API_URL` to your deployed backend
  URL, plus the Supabase vars.
- **First cross-origin login after deploy is the moment to verify** the
  cookie actually gets set and sent (check Application → Cookies and the
  Network tab in devtools). `SameSite=None` cross-origin cookies are the
  most common thing to silently break here.

## Known limitations / next steps

- MLA lookup uses nearest-constituency-center, not real polygon boundaries —
  fine for a hackathon demo, swap for PostGIS `ST_Contains` with real
  boundary data for accuracy.
- No CSRF token yet — currently relying on the CORS origin allowlist +
  `SameSite` cookie policy. Fine pre-launch; add a real CSRF token before
  handling anything more sensitive than reports (e.g. payments).
- Duplicate detection is a simple bounding-box + Haversine check — swap for
  PostGIS `ST_DWithin` if the reports table gets large.
- Report status changes (`acknowledged`/`resolved`) currently require the
  reporting user's own auth — you'll likely want an admin/moderator role
  before opening this to the public, so officials or verified team members
  can mark things resolved.
