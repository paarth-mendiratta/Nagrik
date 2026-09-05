/**
 * Lightweight in-memory rate limiter (pre-launch hygiene, not real security).
 *
 * Fine for a single-instance demo deploy: state is per-process, so a restart
 * clears it and multiple server instances would each keep their own count.
 * Swap for Redis-backed limiter when scaling out.
 */

const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_MAX = 10;

/**
 * Returns Express middleware limiting each authenticated user to `max`
 * requests per `windowMs` on whatever route it's mounted on.
 */
function perUserRateLimit({
  windowMs = DEFAULT_WINDOW_MS,
  max = DEFAULT_MAX,
} = {}) {
  const hits = new Map(); // userId -> array of timestamps

  // Periodically drop stale entries so the map doesn't grow forever.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [userId, stamps] of hits) {
      const fresh = stamps.filter((t) => t > cutoff);
      if (fresh.length === 0) hits.delete(userId);
      else hits.set(userId, fresh);
    }
  }, windowMs);
  if (sweep.unref) sweep.unref();

  return function rateLimited(req, res, next) {
    if (!req.user?.id) return next(); // only limits authenticated users

    const now = Date.now();
    const cutoff = now - windowMs;
    const stamps = (hits.get(req.user.id) ?? []).filter((t) => t > cutoff);

    if (stamps.length >= max) {
      const retryInMinutes = Math.ceil((stamps[0] + windowMs - now) / 60000);
      res.setHeader('Retry-After', String(Math.max(1, retryInMinutes * 60)));
      return res
        .status(429)
        .json({
          error: `Rate limit reached — max ${max} reports per hour. Try again in ~${retryInMinutes} minute(s).`,
        });
    }

    stamps.push(now);
    hits.set(req.user.id, stamps);
    next();
  };
}

module.exports = { perUserRateLimit };
