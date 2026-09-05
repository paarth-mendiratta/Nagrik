/**
 * Promotes a user to moderator (profiles.is_moderator = true) by email.
 *
 * Usage:
 *   node scripts/seed-moderator.js my@email.com
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment
 * (loads server/.env via dotenv). One-time setup before demo day so an
 * official/team member can resolve/reject reports they didn't file.
 */
require('dotenv').config();

let supabaseAdmin;
try {
  ({ supabaseAdmin } = require('../lib/supabase'));
} catch (err) {
  console.error(`${err.message}`);
  process.exit(1);
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: node scripts/seed-moderator.js <email>');
    process.exit(1);
  }

  // 1. Look up the auth user by email (service role grants admin API access)
  const {
    data: { users },
    error: listErr,
  } = await supabaseAdmin.auth.admin.listUsers();

  if (listErr) {
    console.error(`Failed to list users: ${listErr.message}`);
    process.exit(1);
  }

  const user = users.find(
    (u) => u.email.toLowerCase() === email.toLowerCase()
  );
  if (!user) {
    console.error(`No user found with email "${email}" — sign up first, then re-run.`);
    process.exit(1);
  }

  // 2. Promote their profile row
  const { data: profile, error: updErr } = await supabaseAdmin
    .from('profiles')
    .update({ is_moderator: true })
    .eq('id', user.id)
    .select()
    .single();

  if (updErr || !profile) {
    console.error(`Failed to update profile: ${updErr?.message ?? 'profile row missing'}`);
    process.exit(1);
  }

  console.log(`✔ ${email} is now a moderator (profiles.is_moderator = true)`);
  console.log('  They can now resolve/reject any report via PATCH /api/reports/:id/status.');
}

main().catch((err) => {
  console.error('Unexpected error:', err.message ?? err);
  process.exit(1);
});
