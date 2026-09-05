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
  keyFn = (req) => req.user?.id, // scope key — override to include e.g. report id
  message = `Rate limit reached — max ${DEFAULT_MAX} requests per hour.`,
} = {}) {
  const hits = new Map(); // key -> array of timestamps

  // Periodically drop stale entries so the map doesn't grow forever.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, stamps] of hits) {
      const fresh = stamps.filter((t) => t > cutoff);
      if (fresh.length === 0) hits.delete(key);
      else hits.set(key, fresh);
    }
  }, windowMs);
  if (sweep.unref) sweep.unref();

  return function rateLimited(req, res, next) {
    const key = req.user?.id ? keyFn(req) : null;
    if (!key) return next(); // only limits authenticated users

    const now = Date.now();
    const cutoff = now - windowMs;
    const stamps = (hits.get(key) ?? []).filter((t) => t > cutoff);

    if (stamps.length >= max) {
      const retryInMinutes = Math.ceil((stamps[0] + windowMs - now) / 60000);
      res.setHeader('Retry-After', String(Math.max(1, retryInMinutes * 60)));
      return res
        .status(429)
        .json({
          error: `${message} Try again in ~${retryInMinutes} minute(s).`,
        });
    }

    stamps.push(now);
    hits.set(key, stamps);
    next();
  };
}

module.exports = { perUserRateLimit };
