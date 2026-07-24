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
// Single source of truth — imported by webhook.js, not duplicated there.
const PRODUCT_TYPE_MAP = {
  'blueprint':            'blueprint',
  'security_certificate': 'security_blueprint',
  'bundle':               'bundle',
  'consulting_session':   'consulting_session',
  'cfo_report':           'cfo_report',
  'monthly_plan':         'subscription',
  'ai_blueprint':         'ai_blueprint',
};

// ── CANONICAL PRODUCT PRICES (cents, by Stripe currency code) ────────────────
// Server-side source of truth for checkout amounts — must mirror the CURRENCY_MAP
// price points shown in src/App.jsx. create-checkout.js looks amounts up here
// instead of trusting the client-supplied currencyAmount, which previously let a
// caller set any price (e.g. currencyAmount: 1) for a live Stripe charge.
const PRODUCT_PRICES = {
  blueprint:    { usd: 7900,  gbp: 6200,  eur: 7300,  cad: 10700, aud: 11900, pln: 29900 },
  security_blueprint: { usd: 2900, gbp: 2300, eur: 2700, cad: 3900, aud: 4500, pln: 11900 },
  bundle:       { usd: 8900,  gbp: 6900,  eur: 8300,  cad: 11900, aud: 13400, pln: 34900 },
  cfo_report:   { usd: 19900, gbp: 15900, eur: 18300, cad: 26900, aud: 29900, pln: 79900 },
  ai_blueprint: { usd: 7900,  gbp: 6200,  eur: 7300,  cad: 10700, aud: 11900, pln: 29900 },
};

// ── ALLOWED CORS ORIGINS ──────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://www.kloudaudit.eu',
  'https://kloudaudit.eu',
  'http://localhost:5173',
];

// ── REQUIRED ENVIRONMENT VARIABLES ───────────────────────────────────────────
// Checked by health.js — single source of truth for what "healthy" means.
const REQUIRED_ENV = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'ANTHROPIC_API_KEY',
  'RESEND_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'CRON_SECRET',
];

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
  PRODUCT_PRICES,
  ALLOWED_ORIGINS,
  REQUIRED_ENV,
};
