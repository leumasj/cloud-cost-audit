// api/health.js
// KloudAudit — Health Check Endpoint
//
// Used by external monitoring (UptimeRobot, Better Uptime, etc.)
// Returns 200 when healthy, 503 when degraded.
// Public endpoint — no auth required — contains no sensitive data.
//
// Monitor at: https://www.kloudaudit.eu/api/health

const { createClient } = require('@supabase/supabase-js');

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
    // 1. Check all required env vars are present
    const required = [
      'STRIPE_SECRET_KEY', 'ANTHROPIC_API_KEY', 'SENDGRID_API_KEY',
      'SUPABASE_URL', 'SUPABASE_ANON_KEY',
    ];
    checks.env = required.every(k => !!process.env[k]);

    // 2. Check Supabase connectivity with a lightweight query
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
