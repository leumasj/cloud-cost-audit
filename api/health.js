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
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
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
    const { error } = await supabase
      .from('audits')
      .select('id')
      .limit(1);
    checks.supabase = !error;

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
