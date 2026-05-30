// api/lib/_ratelimit.js
// KloudAudit — Supabase-backed Rate Limiting (append-only log pattern)
//
// Each request is inserted as a row; counts are derived from a window query.
// Survives cold starts and is shared across all function instances.
// Fails open on DB error — an outage must never block legitimate traffic.
//
// Required table (run once in Supabase SQL editor):
//   CREATE TABLE IF NOT EXISTS rate_limits (
//     id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
//     key        TEXT        NOT NULL,
//     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
//   );
//   CREATE INDEX IF NOT EXISTS rate_limits_key_created_idx
//     ON rate_limits(key, created_at);

'use strict';

const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

async function checkRateLimit(req, action, maxRequests, windowMs) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || 'unknown';
  const key         = `${ip}:${action}`;
  const windowStart = new Date(Date.now() - windowMs).toISOString();

  try {
    const supabase = getSupabase();

    // Count requests in the current window
    const { count } = await supabase
      .from('rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('key', key)
      .gte('created_at', windowStart);

    if (count >= maxRequests) {
      // Find the oldest entry to calculate the reset time
      const { data: oldest } = await supabase
        .from('rate_limits')
        .select('created_at')
        .eq('key', key)
        .gte('created_at', windowStart)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      const resetAt = oldest
        ? new Date(new Date(oldest.created_at).getTime() + windowMs).getTime()
        : Date.now() + windowMs;

      return {
        limited:   true,
        remaining: 0,
        limit:     maxRequests,
        resetAt,
        current:   count,
      };
    }

    // Log this request
    await supabase
      .from('rate_limits')
      .insert({ key, created_at: new Date().toISOString() });

    // Clean up expired entries (best-effort, non-blocking)
    supabase
      .from('rate_limits')
      .delete()
      .lt('created_at', windowStart)
      .then(() => {})
      .catch(() => {});

    return {
      limited:   false,
      remaining: maxRequests - (count + 1),
      limit:     maxRequests,
      resetAt:   Date.now() + windowMs,
      current:   count + 1,
    };

  } catch (err) {
    // Fail open — a Supabase outage must not take down the API
    console.warn('Rate limit DB error — failing open:', err.message);
    return {
      limited:   false,
      remaining: maxRequests,
      limit:     maxRequests,
      resetAt:   Date.now() + windowMs,
      current:   0,
    };
  }
}

module.exports = { checkRateLimit };
