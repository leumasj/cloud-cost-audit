// api/lib/_logger.js
// KloudAudit — Structured Logger
//
// Replaces console.log/error with JSON-structured logs compatible with
// Vercel log drain, Datadog, Logtail, and any log aggregation service.
//
// Usage:
//   const logger = require('./lib/_logger');
//   logger.info('webhook.queued', { sessionId, email, productType });
//   logger.error('queue.failed', { jobId, error: err.message });

'use strict';

function log(level, event, data = {}) {
  const entry = {
    level,
    event,
    timestamp: new Date().toISOString(),
    env:       process.env.VERCEL_ENV || 'development',
    ...data,
  };

  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

module.exports = {
  info:  (event, data) => log('info',  event, data),
  warn:  (event, data) => log('warn',  event, data),
  error: (event, data) => log('error', event, data),
  debug: (event, data) => {
    if (process.env.VERCEL_ENV !== 'production') {
      log('debug', event, data);
    }
  },
};
