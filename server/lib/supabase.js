const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars. Copy .env.example to .env and fill them in.'
  );
}

// Service role client - used server-side only, bypasses RLS.
// Never expose this key to the frontend; the frontend uses the anon key instead.
//
// IMPORTANT: never sign in / sign up on this client. A successful
// signInWithPassword stores the end-user's JWT inside the client, and
// supabase-js then sends that JWT (instead of the service-role key) on
// every subsequent REST call — silently re-enabling RLS so privileged
// operations fail with "0 rows" (PGRST116) after any user login.
// routes/auth.js uses a separate client for auth calls.
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Separate client for server-side auth calls (signUp/signInWithPassword).
// Its session pollution stays isolated here.
const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

module.exports = { supabaseAdmin, supabaseAuth };

