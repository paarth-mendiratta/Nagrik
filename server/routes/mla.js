const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { distanceMeters } = require('../lib/duplicates');

const router = express.Router();

/** GET /api/mla?constituency=... - exact lookup by constituency name */
router.get('/', async (req, res) => {
  const { constituency } = req.query;
  let query = supabaseAdmin.from('mlas').select('*');
  if (constituency) query = query.ilike('constituency', `%${constituency}%`);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ mlas: data });
});

/**
 * GET /api/mla/nearest?lat=..&lng=..
 * MVP lookup: finds the MLA whose constituency center is closest to the
 * given point. Good enough for a hackathon demo; swap for real constituency
 * polygon boundaries (PostGIS ST_Contains) post-hackathon for accuracy.
 */
router.get('/nearest', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'lat and lng query params required' });
  }

  const { data, error } = await supabaseAdmin
    .from('mlas')
    .select('*')
    .not('center_lat', 'is', null)
    .not('center_lng', 'is', null);

  if (error) return res.status(500).json({ error: error.message });
  if (!data.length) return res.status(404).json({ error: 'no MLA data loaded yet' });

  const nearest = data
    .map((m) => ({ ...m, dist: distanceMeters(lat, lng, m.center_lat, m.center_lng) }))
    .sort((a, b) => a.dist - b.dist)[0];

  res.json({ mla: nearest });
});

module.exports = router;
