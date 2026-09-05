/**
 * Bulk-inserts MLA records from server/data/mlas.json into the mlas table.
 *
 * Usage:
 *   node scripts/seed-mlas.js
 *
 * Upserts on constituency, so re-running with updated data refreshes
 * existing rows instead of creating duplicates.
 *
 * NOTE: server/data/mlas.json currently contains PLACEHOLDER data for the
 * Nainital/Uttarakhand region — replace it with real constituency data
 * for your target area before the demo, then re-run this script.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

let supabaseAdmin;
try {
  ({ supabaseAdmin } = require('../lib/supabase'));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const DATA_FILE = path.join(__dirname, '..', 'data', 'mlas.json');

async function main() {
  let mlas;
  try {
    mlas = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    console.error(`Failed to read ${DATA_FILE}: ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(mlas) || mlas.length === 0) {
    console.error('mlas.json must be a non-empty JSON array.');
    process.exit(1);
  }

  for (const m of mlas) {
    if (!m.name || !m.constituency) {
      console.error(`Every entry needs at least name + constituency — got: ${JSON.stringify(m)}`);
      process.exit(1);
    }
  }

  // App-level upsert: select each constituency, update if present, insert
  // if not. Works even without a unique index on constituency (live DBs
  // created before that index was added), and preserves row ids so any
  // existing reports.mla_id references keep pointing at the same row.
  let inserted = 0;
  let updated = 0;

  for (const mla of mlas) {
    const { data: existing, error: selErr } = await supabaseAdmin
      .from('mlas')
      .select('id')
      .eq('constituency', mla.constituency)
      .maybeSingle();

    if (selErr) {
      console.error(`Failed to look up ${mla.constituency}: ${selErr.message}`);
      process.exit(1);
    }

    if (existing) {
      const { error: updErr } = await supabaseAdmin
        .from('mlas')
        .update(mla)
        .eq('id', existing.id);
      if (updErr) {
        console.error(`Failed to update ${mla.constituency}: ${updErr.message}`);
        process.exit(1);
      }
      updated++;
    } else {
      const { error: insErr } = await supabaseAdmin
        .from('mlas')
        .insert(mla);
      if (insErr) {
        console.error(`Failed to insert ${mla.constituency}: ${insErr.message}`);
        process.exit(1);
      }
      inserted++;
    }
  }

  console.log(`✔ Done: ${inserted} inserted, ${updated} updated (matched on constituency).`);
  console.log('  Placeholder data — replace server/data/mlas.json with real data before the demo.');
}

main().catch((err) => {
  console.error('Unexpected error:', err.message ?? err);
  process.exit(1);
});
