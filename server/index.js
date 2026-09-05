require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const { router: authRouter } = require('./routes/auth');
const reportsRouter = require('./routes/reports');
const mlaRouter = require('./routes/mla');
const { startScheduler } = require('./lib/scheduler');

// Fail fast in prod if CLIENT_URL isn't set - prevents the CORS/cookie
// config from silently falling back to the permissive dev mode (see
// SECURITY.md for why this matters).
if (process.env.NODE_ENV === 'production' && !process.env.CLIENT_URL) {
  throw new Error('CLIENT_URL must be set in production - refusing to boot with permissive CORS.');
}
if (process.env.NODE_ENV === 'production' && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY must be set in production.');
}

const app = express();
const PORT = process.env.PORT || 8080;
const CLIENT_URL = process.env.CLIENT_URL; // comma-separated list supported

// CORS — LOAD-BEARING FOR CSRF DEFENSE, not just functionality.
// Cookies are httpOnly + SameSite=None in prod (required for cross-site),
// so this origin allowlist is the only thing stopping a foreign site from
// riding an authenticated user's cookie into a mutating request.
// DO NOT loosen this for debugging (no '*', no reflect-any-origin in prod).
// If this allowlist is bypassed, CSRF protection silently disappears while
// cookies keep flowing — there is no separate CSRF token as backstop yet.
app.use(
  cors({
    origin: CLIENT_URL ? CLIENT_URL.split(',').map((s) => s.trim()) : true,
    credentials: true,
  })
);

app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/mla', mlaRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

app.listen(PORT, () => {
  console.log(`Nagrik API listening on :${PORT}`);
  if (process.env.IG_SIMULATE !== 'false') {
    console.log('[instagram] running in SIMULATE mode - set IG_SIMULATE=false + credentials to post for real');
  }
  startScheduler();
});
