// api/lib/_ratelimit.js
// KloudAudit — Supabase-backed Rate Limiting
//
// Replaces the in-memory Map so limits survive across serverless instances
// and cold starts.  Fails open on DB error — an outage should never block
// legitimate traffic.
//
// Required table (run once in Supabase SQL editor):
//   CREATE TABLE rate_limits (
//     key      TEXT PRIMARY KEY,
//     count    INTEGER NOT NULL DEFAULT 0,
//     reset_at TIMESTAMPTZ NOT NULL
//   );

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW_MS } = require('./_config');

const WINDOW_MS    = RATE_LIMIT_WINDOW_MS;
const MAX_REQUESTS = RATE_LIMIT_REQUESTS;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ── GET CLIENT IP ─────────────────────────────────────────────────────────────

function getClientIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) return forwardedFor.split(',')[0].trim();
  return req.headers['x-real-ip']
    || req.connection?.remoteAddress
    || req.socket?.remoteAddress
    || 'unknown';
}

// ── RATE LIMIT CHECK ──────────────────────────────────────────────────────────

async function checkRateLimit(req, endpoint = 'default', maxRequests = MAX_REQUESTS, windowMs = WINDOW_MS) {
  const ip  = getClientIp(req);
  const key = `${ip}:${endpoint}`;
  const now = new Date();

  try {
    const { data: row, error: fetchError } = await supabase
      .from('rate_limits')
      .select('count, reset_at')
      .eq('key', key)
      .maybeSingle();

    if (fetchError) throw fetchError;

    const windowExpired = !row || new Date(row.reset_at) <= now;
    const newCount      = windowExpired ? 1 : row.count + 1;
    const newResetAt    = windowExpired
      ? new Date(Date.now() + windowMs).toISOString()
      : row.reset_at;

    await supabase
      .from('rate_limits')
      .upsert({ key, count: newCount, reset_at: newResetAt }, { onConflict: 'key' });

    return {
      limited:   newCount > maxRequests,
      remaining: Math.max(0, maxRequests - newCount),
      resetAt:   new Date(newResetAt).getTime(),
      current:   newCount,
      limit:     maxRequests,
    };
  } catch (err) {
    // Fail open — a Supabase outage must not take down the API
    console.error(JSON.stringify({ level: 'error', event: 'ratelimit.db_error', error: err.message }));
    return { limited: false, remaining: maxRequests, resetAt: Date.now() + windowMs, current: 0, limit: maxRequests };
  }
}

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────

function rateLimitMiddleware(endpoint = 'default', maxRequests = MAX_REQUESTS, windowMs = WINDOW_MS) {
  return async (req, res, next) => {
    const result = await checkRateLimit(req, endpoint, maxRequests, windowMs);

    res.setHeader('X-RateLimit-Limit',     result.limit);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset',     new Date(result.resetAt).toISOString());

    if (result.limited) {
      const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({
        error:       'Too many requests',
        message:     `Rate limit exceeded. Try again in ${Math.ceil(retryAfter / 60)} minutes.`,
        retryAfter,
        resetAt:     new Date(result.resetAt).toISOString(),
      });
    }

    next();
  };
}

// ── EXPORT ────────────────────────────────────────────────────────────────────

module.exports = { checkRateLimit, rateLimitMiddleware, getClientIp };
