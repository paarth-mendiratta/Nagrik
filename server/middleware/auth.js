const { supabaseAdmin } = require('../lib/supabase');
const { COOKIE_NAME } = require('../routes/auth');

/** Reads token from httpOnly cookie first, falls back to Authorization header (for API/curl testing). */
async function requireAuth(req, res, next) {
  const bearer = req.headers.authorization?.replace('Bearer ', '');
  const token = req.cookies?.[COOKIE_NAME] || bearer;

  if (!token) return res.status(401).json({ error: 'not authenticated' });

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'invalid or expired session' });

  req.user = data.user;
  next();
}

module.exports = { requireAuth };
