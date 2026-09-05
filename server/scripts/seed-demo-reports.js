/**
 * Demo mode: populates the feed with realistic sample reports so it doesn't
 * look empty during judging. Writes directly to the reports table (no AI
 * calls — instant, free, deterministic-ish).
 *
 * Usage (from server/):
 *   node scripts/seed-demo-reports.js          # add sample reports
 *   node scripts/seed-demo-reports.js --clear  # remove ONLY demo reports
 *
 * Demo reports are marked with description suffix "[demo]" and user_id null
 * so they're easy to identify and clean up. Photos use a generated
 * placeholder image in the report-photos bucket (shared by all demo
 * reports).
 */
require('dotenv').config();

let supabaseAdmin;
try {
  ({ supabaseAdmin } = require('../lib/supabase'));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const DEMO_TAG = '[demo]';
// Nainital-area coords, spread across the seeded constituency centers
const SAMPLES = [
  {
    category: 'pothole',
    description: `Large water-filled pothole on Mall Road near the boating club junction ${DEMO_TAG}`,
    photo: 'pothole',
    lat: 29.3803, lng: 79.4636, constituency: 'Nainital', ward: 'Nainital Sadar',
    severity_score: 8, days_ago: 6, status: 'pending',
    complaint: 'Respected Sir/Madam,\n\nI wish to draw your attention to a large water-filled pothole on Mall Road near the boating club junction, which has remained unrepaired for several days and poses a serious hazard to two-wheelers and pedestrians.\n\nI request urgent repair of this stretch.\n\nSincerely,\nA concerned citizen',
  },
  {
    category: 'garbage',
    description: `Garbage pile not collected for 5 days near Tallital bus stand ${DEMO_TAG}`,
    photo: 'garbage',
    lat: 29.3795, lng: 79.4560, constituency: 'Nainital', ward: 'Tallital',
    severity_score: 5, days_ago: 3, status: 'pending',
    complaint: 'Respected Sir/Madam,\n\nHousehold garbage has not been collected from the Tallital bus stand area for five days, creating an unhygienic situation and foul smell. Kindly arrange immediate collection and regularise the schedule.\n\nSincerely,\nA concerned citizen',
  },
  {
    category: 'streetlight',
    description: `Three streetlights dark on the lake promenade for two weeks ${DEMO_TAG}`,
    photo: 'streetlight',
    lat: 29.3511, lng: 79.5631, constituency: 'Bhimtal', ward: 'Bhimtal Block',
    severity_score: 4, days_ago: 14, status: 'pending',
    complaint: 'Respected Sir/Madam,\n\nThree consecutive streetlights on the Bhimtal lake promenade have been non-functional for two weeks, making the walkway unsafe after dark. Requesting prompt replacement of the fixtures.\n\nSincerely,\nA concerned citizen',
  },
  {
    category: 'water_supply',
    description: `Broken water pipeline flooding the road near Haldwani railway crossing ${DEMO_TAG}`,
    photo: 'water',
    lat: 29.2196, lng: 79.5125, constituency: 'Haldwani', ward: 'Haldwani Municipal Corporation',
    severity_score: 9, days_ago: 1, status: 'pending',
    complaint: 'Respected Sir/Madam,\n\nA broken water pipeline near the Haldwani railway crossing has been flooding the road for over a day, wasting water and damaging the road surface. Immediate repair is requested.\n\nSincerely,\nA concerned citizen',
  },
  {
    category: 'drainage',
    description: `Open drain overflowing onto the main market road in Kaladhungi ${DEMO_TAG}`,
    photo: 'drainage',
    lat: 29.2846, lng: 79.3462, constituency: 'Kaladhungi', ward: 'Kaladhungi Block',
    severity_score: 6, days_ago: 9, status: 'acknowledged',
    complaint: 'Respected Sir/Madam,\n\nThe open drain along the main market road in Kaladhungi is overflowing, spilling wastewater onto the road. The municipal office has acknowledged the complaint; permanent repair is awaited.\n\nSincerely,\nA concerned citizen',
  },
  {
    category: 'road_damage',
    description: `Cracked and sinking road surface after monsoon near Ramnagar ${DEMO_TAG}`,
    photo: 'road',
    lat: 29.3978, lng: 79.1241, constituency: 'Ramnagar', ward: 'Ramnagar Block',
    severity_score: 7, days_ago: 21, status: 'resolved',
    complaint: 'Respected Sir/Madam,\n\nThe road surface near Ramnagar has cracked and sunk after the monsoon. This stretch has since been repaired following this complaint.\n\nSincerely,\nA concerned citizen',
  },
];

// simple distinct solid-color PNG per category so feed photos aren't broken
function makePlaceholderPng(hex) {
  const zlib = require('zlib');
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const W = 8, H = 8;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    const rowOff = y * (1 + W * 3);
    raw[rowOff] = 0;
    for (let x = 0; x < W; x++) {
      const off = rowOff + 1 + x * 3;
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b;
    }
  }
  const crcTable = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  function crc32(buf) { let c = 0xFFFFFFFF; for (const bb of buf) c = crcTable[(c ^ bb) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PHOTO_COLORS = {
  pothole: '#3d2f23', garbage: '#5a6b3a', streetlight: '#c9a227',
  water: '#2d6a9f', drainage: '#4a5568', road: '#6b7280',
};

async function uploadDemoPhoto(category) {
  const png = makePlaceholderPng(PHOTO_COLORS[category] || '#6b7280');
  const path = `demo/${category}.png`;
  const { error } = await supabaseAdmin.storage
    .from('report-photos')
    .upload(path, png, { contentType: 'image/png', upsert: true });
  if (error) throw new Error(`photo upload failed: ${error.message}`);
  const { data } = supabaseAdmin.storage.from('report-photos').getPublicUrl(path);
  return data.publicUrl;
}

async function clear() {
  const { data, error } = await supabaseAdmin
    .from('reports')
    .delete()
    .like('description', `%${DEMO_TAG}%`)
    .select('id');
  if (error) { console.error('clear failed:', error.message); process.exit(1); }
  console.log(`Removed ${data?.length ?? 0} demo report(s).`);
}

async function seed() {
  const photoCache = {};
  let inserted = 0;

  for (const s of SAMPLES) {
    if (!photoCache[s.photo]) photoCache[s.photo] = await uploadDemoPhoto(s.photo);
    const createdAt = new Date(Date.now() - s.days_ago * 86400000).toISOString();

    // reuse the production priority formula so scores look realistic
    const { computePriority } = require('../lib/priority');
    const priority_score = computePriority({
      severity_score: s.severity_score,
      duplicate_count: 0,
      created_at: createdAt,
      category: s.category,
    });

    const row = {
      category: s.category,
      description: s.description,
      photo_url: photoCache[s.photo],
      lat: s.lat, lng: s.lng,
      ward: s.ward, constituency: s.constituency,
      severity_score: s.severity_score,
      duplicate_count: Math.max(0, Math.round(s.days_ago / 4)), // fake some corroboration
      priority_score: priority_score,
      status: s.status,
      complaint_text: s.complaint,
      created_at: createdAt,
      updated_at: createdAt,
      last_checked_at: createdAt,
      resolved_at: s.status === 'resolved' ? new Date().toISOString() : null,
    };
    if (s.status === 'resolved') {
      // resolved rows drop out of the active-priority sort; recompute for display
      row.priority_score = 0;
    }

    const { error } = await supabaseAdmin.from('reports').insert(row);
    if (error) { console.error(`insert failed for ${s.category}: ${error.message}`); process.exit(1); }
    inserted++;
    console.log(`  + ${s.category} | ${s.constituency} | ${s.days_ago}d old | severity ${s.severity_score} | priority ${row.priority_score} | ${s.status}`);
  }

  console.log(`\nDemo seed complete: ${inserted} report(s) added.`);
  console.log('Clean up any time with: node scripts/seed-demo-reports.js --clear');
}

(async () => {
  if (process.argv.includes('--clear')) await clear();
  else await seed();
  process.exit(0);
})().catch((e) => { console.error('Unexpected error:', e.message); process.exit(1); });
