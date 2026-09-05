const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');

const router = express.Router();

const COOKIE_NAME = 'nagrik_token';
const isProd = !!process.env.CLIENT_URL;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  };
}

router.post('/signup', async (req, res) => {
  const { email, password, full_name, phone } = req.body;
  const { data, error } = await supabaseAdmin.auth.signUp({ email, password });
  if (error) return res.status(400).json({ error: error.message });

  if (data.user) {
    await supabaseAdmin.from('profiles').insert({
      id: data.user.id,
      full_name,
      phone,
    });
  }

  if (data.session) {
    res.cookie(COOKIE_NAME, data.session.access_token, cookieOptions());
  }
  res.status(201).json({ user: data.user });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: error.message });

  res.cookie(COOKIE_NAME, data.session.access_token, cookieOptions());
  res.json({ user: data.user });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ user: null });

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ user: null });

  res.json({ user: data.user });
});

module.exports = { router, COOKIE_NAME, cookieOptions };
