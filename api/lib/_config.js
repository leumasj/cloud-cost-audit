// api/lib/config.js
// KloudAudit — Centralised Configuration
//
// Single source of truth for all magic numbers, model names, and constants.
// When Claude releases a new model, change it here — nowhere else.
// When retry logic needs tuning, change it here — nowhere else.

'use strict';

// ── AI ────────────────────────────────────────────────────────────────────────
const AI_MODEL                  = 'claude-sonnet-4-6';
const AI_MAX_TOKENS_BLUEPRINT   = 2000;
const AI_MAX_TOKENS_SECURITY    = 2500;
const AI_MAX_TOKENS_PREVIEW     = 500;

// ── QUEUE ─────────────────────────────────────────────────────────────────────
const QUEUE_BATCH_SIZE    = 5;   // max jobs processed per cron run
const QUEUE_MAX_ATTEMPTS  = 3;   // max delivery attempts before admin alert

// ── RATE LIMITING ─────────────────────────────────────────────────────────────
const RATE_LIMIT_REQUESTS = 5;            // max requests per window
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// ── CACHE ─────────────────────────────────────────────────────────────────────
const CACHE_TTL_DAYS = 7;

// ── PRODUCT TYPE MAP ──────────────────────────────────────────────────────────
// Maps Stripe metadata 'type' to delivery_queue product_type.
// Explicit map — never a ternary — so new product types can be added safely.
const PRODUCT_TYPE_MAP = {
  'blueprint':            'blueprint',
  'security_certificate': 'security_blueprint',
  'bundle':               'bundle',
  'consulting_session':   'consulting_session',
  'cfo_report':           'cfo_report',
};

// ── ALLOWED CORS ORIGINS ──────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://www.kloudaudit.eu',
  'https://kloudaudit.eu',
  'http://localhost:5173',
];

// ── REQUIRED ENVIRONMENT VARIABLES ───────────────────────────────────────────
// Call validateEnv() at the top of any handler to fail fast if config is missing.
const REQUIRED_ENV = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'ANTHROPIC_API_KEY',
  'RESEND_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'CRON_SECRET',
];

function validateEnv() {
  const missing = REQUIRED_ENV.filter(k => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

module.exports = {
  AI_MODEL,
  AI_MAX_TOKENS_BLUEPRINT,
  AI_MAX_TOKENS_SECURITY,
  AI_MAX_TOKENS_PREVIEW,
  QUEUE_BATCH_SIZE,
  QUEUE_MAX_ATTEMPTS,
  RATE_LIMIT_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
  CACHE_TTL_DAYS,
  PRODUCT_TYPE_MAP,
  ALLOWED_ORIGINS,
  validateEnv,
};
