const { supabaseAdmin } = require("./supabase");

const DUPLICATE_RADIUS_METERS = 50;
const DUPLICATE_WINDOW_DAYS = 30;

/** Haversine distance in meters between two lat/lng points. */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Finds existing active reports (not resolved/rejected) of the same category within
 * DUPLICATE_RADIUS_METERS and DUPLICATE_WINDOW_DAYS of a new report. Returns
 * the closest match, if any.
 *
 * NOTE: for MVP this does a bounding-box prefilter in SQL then a precise
 * Haversine check in JS. For scale, swap the prefilter for PostGIS ST_DWithin.
 */
async function findNearbyDuplicate({ lat, lng, category, excludeId = null }) {
  const latDelta = DUPLICATE_RADIUS_METERS / 111_000; // ~111km per degree lat
  const lngDelta =
    DUPLICATE_RADIUS_METERS / (111_000 * Math.cos((lat * Math.PI) / 180));

  const since = new Date(
    Date.now() - DUPLICATE_WINDOW_DAYS * 86_400_000,
  ).toISOString();

  let query = supabaseAdmin
    .from("reports")
    .select("id, lat, lng, duplicate_count")
    .eq("category", category)
    .neq("status", "resolved")
    .neq("status", "rejected")
    .gte("lat", lat - latDelta)
    .lte("lat", lat + latDelta)
    .gte("lng", lng - lngDelta)
    .lte("lng", lng + lngDelta);

  if (excludeId) query = query.neq("id", excludeId);

  const { data, error } = await query;
  if (error) throw error;

  const matches = (data ?? [])
    .map((r) => ({ ...r, dist: distanceMeters(lat, lng, r.lat, r.lng) }))
    .filter((r) => r.dist <= DUPLICATE_RADIUS_METERS)
    .sort((a, b) => a.dist - b.dist);

  return matches[0] ?? null;
}

module.exports = { findNearbyDuplicate, distanceMeters };
