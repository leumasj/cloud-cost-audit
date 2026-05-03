// lib/sentry.js
// Shared Sentry initialisation for all KloudAudit API functions.
// Import at the top of any serverless function to get automatic error tracking.

let Sentry = null;

function init() {
  if (!process.env.SENTRY_DSN) return null;
  if (Sentry) return Sentry;

  try {
    const S = require('@sentry/node');
    S.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.VERCEL_ENV || 'production',
      tracesSampleRate: 0.1, // 10% of requests traced — free tier safe
    });
    Sentry = S;
    return S;
  } catch (_) {
    return null; // Sentry package not installed — degrade gracefully
  }
}

// Capture an exception — safe to call even if Sentry not configured
function captureException(err, context) {
  const s = init();
  if (!s) return;
  s.withScope(scope => {
    if (context) scope.setContext('details', context);
    s.captureException(err);
  });
}

// Capture a message — useful for warnings
function captureMessage(msg, level = 'warning', context) {
  const s = init();
  if (!s) return;
  s.withScope(scope => {
    if (context) scope.setContext('details', context);
    s.captureMessage(msg, level);
  });
}

module.exports = { init, captureException, captureMessage };
