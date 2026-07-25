// api/health.js
// KloudAudit — Health Check Endpoint
//
// Used by external monitoring (UptimeRobot, Better Uptime, etc.)
// Returns 200 when healthy, 503 when degraded.
// Public endpoint — no auth required — contains no sensitive data.
//
// Monitor at: https://www.kloudaudit.eu/api/health

const { createClient } = require('@supabase/supabase-js');
const { REQUIRED_ENV } = require('./lib/_config');

// Caches the Supabase connectivity result so repeated unauthenticated hits
// within the TTL reuse it instead of inserting into rate_limits on every
// request — bounds how much this public, unrated endpoint can write to the
// DB if hammered. Resets on cold start, which is fine: real monitoring
// tools poll far less often than this TTL.
let cachedSupabaseOk = null;
let cachedAt = 0;
const SUPABASE_CHECK_TTL_MS = 30 * 1000;

module.exports = async function handler(req, res) {
  // Allow both GET and HEAD — UptimeRobot uses HEAD for uptime checks
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Lightweight geo probe — used by frontend for currency detection
  // Reads Vercel's built-in header; no DB hit, no rate limits
  if (req.query.geo === '1') {
    const country = req.headers['x-vercel-ip-country'] || '';
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ country_code: country });
  }
  // HEAD requests only need the status code, not the body
  if (req.method === 'HEAD') {
    return res.status(200).end();
  }

  const checks = {
    env:       false,
    supabase:  false,
    timestamp: new Date().toISOString(),
    version:   process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'local',
  };

  try {
    // 1. Check all required env vars are present — single source of truth in _config.js
    checks.env = REQUIRED_ENV.every(k => !!process.env[k]);

    // 2. Check Supabase connectivity with a lightweight query — cached for
    // SUPABASE_CHECK_TTL_MS so this public endpoint can't be hammered into
    // writing unbounded rows.
    if (cachedSupabaseOk !== null && (Date.now() - cachedAt) < SUPABASE_CHECK_TTL_MS) {
      checks.supabase = cachedSupabaseOk;
    } else {
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY
      );
      // Insert a test record to verify connectivity — anon has INSERT on rate_limits
      // This works without SELECT permission
      const { error } = await supabase
        .from('rate_limits')
        .insert({ ip: 'health-check' });
      // Error code 42501 = permission denied (bad)
      // Any other error or no error = connectivity confirmed
      checks.supabase = !error || error.code !== '42501';
      cachedSupabaseOk = checks.supabase;
      cachedAt = Date.now();
    }

    // 3. Overall health
    const healthy = checks.env && checks.supabase;

    return res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      checks,
    });

  } catch (err) {
    return res.status(503).json({
      status: 'error',
      error:  err.message,
      checks,
    });
  }
};
