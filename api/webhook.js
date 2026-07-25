// api/webhook.js
// KloudAudit — Stripe Webhook Handler
// Architecture: Queue-based async delivery
//
// FLOW:
// 1. Stripe fires event → verify signature → save to queue → return 200 IMMEDIATELY
// 2. /api/process-pending (cron every 60s) → pick up pending → Claude → Resend
//
// WHY: Claude takes 25-45s. Vercel times out at 10-60s.
//      Returning 200 immediately prevents Stripe retrying (which causes duplicate deliveries).
//
// FIXES (v2 — post code review):
// - Bundle type mapping: ternary replaced with explicit map so 'bundle' is no longer
//   silently coerced to 'blueprint', which would drop the security half of bundle orders.
// - Structured logging: JSON logs for Vercel log drain compatibility.

const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const sentry  = require('./lib/_sentry');

// ── PRODUCT TYPE MAP ──────────────────────────────────────────────────────────
// Maps Stripe metadata 'type' values to delivery_queue product_type values.
// CRITICAL: must be an explicit map — a ternary cannot handle 3 product types.
// Bug this fixed: meta.type === 'bundle' was previously coerced to 'blueprint',
// causing bundle customers to receive only the cost Blueprint, not both.
// Imported from lib/_config — single source of truth, not duplicated here.
const { PRODUCT_TYPE_MAP } = require('./lib/_config');
const logger = require('./lib/_logger');
const log = (level, event, data = {}) => logger[level](event, { service: 'webhook', ...data });

// ── RAW BODY READER ───────────────────────────────────────────────────────────
// Required for Stripe signature verification — must be raw bytes, not parsed JSON.
// Also handles pre-buffered bodies (node-mocks-http in tests, body-parser middleware).
async function getRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data',  chunk => chunks.push(chunk));
    req.on('end',   ()    => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // Initialise inside handler so env vars are available at call time.
  // Must use service-role key — delivery_queue RLS denies the anon role (writes fail silently as 42501,
  // which meant paid orders never got queued for delivery). Matches process-pending.js's admin client.
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  );

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Get raw body for Stripe signature verification
  const rawBody = await getRawBody(req);

  // 2. Verify Stripe signature — reject anything not from Stripe
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    log('error', 'webhook.signature_failed', { error: err.message });
    sentry.captureException(err, { context: 'stripe-signature' });
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  // 3. Only handle completed payments — acknowledge all others
  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true, skipped: event.type });
  }

  const session = event.data.object;
  const meta    = session.metadata || {};
  const email   = meta.email || session.customer_email;

  if (!email) {
    log('error', 'webhook.no_email', { sessionId: session.id });
    return res.status(200).json({ received: true, error: 'no_email' });
  }

  // 4. Resolve product type — explicit map prevents bundle → blueprint coercion
  const productType = PRODUCT_TYPE_MAP[meta.type] || 'blueprint';

  if (!PRODUCT_TYPE_MAP[meta.type]) {
    log('warn', 'webhook.unknown_product_type', {
      sessionId: session.id,
      rawType: meta.type,
      resolvedTo: 'blueprint',
    });
  }

  if (productType === 'subscription') {
    log('info', 'webhook.subscription_ignored', {
      sessionId: session.id,
      email,
      amount: session.amount_total,
      currency: session.currency,
      provider: meta.provider,
    });
    return res.status(200).json({ received: true, skipped: 'subscription' });
  }

  // 5. Save to delivery queue — FAST (~100ms)
  // We do NOT call Claude here. We save the job and return 200 immediately.
  // Stripe is satisfied, no retry. /api/process-pending handles actual delivery.
  const sessionId = session.id;
  try {
    // Idempotency pre-check — fast SELECT before INSERT to avoid duplicate deliveries
    const { data: existing } = await supabase
      .from('delivery_queue')
      .select('id')
      .eq('stripe_session_id', sessionId)
      .limit(1);

    if (existing && existing.length > 0) {
      log('info', 'webhook.duplicate', { sessionId });
      return res.status(200).json({ received: true, duplicate: true });
    }

    const { error: dbError } = await supabase
      .from('delivery_queue')
      .insert({
        stripe_session_id: session.id,
        email,
        product_type: productType,
        metadata: {
          ...meta,
          stripe_session_id: session.id,
          amount_total:      session.amount_total,
          currency:          session.currency,
        },
        status: 'pending',
      });

    if (dbError) {
      // Duplicate session ID = Stripe retried an already-queued job — safe to ignore
      if (dbError.code === '23505') {
        log('info', 'webhook.duplicate', { sessionId: session.id });
        return res.status(200).json({ received: true, duplicate: true });
      }
      throw dbError;
    }

    log('info', 'webhook.queued', {
      sessionId:   session.id,
      email,
      productType,
      amount:      session.amount_total,
      currency:    session.currency,
    });

    return res.status(200).json({ received: true, queued: true, productType });

  } catch (err) {
    log('error', 'webhook.queue_failed', { sessionId: session.id, error: err.message });
    sentry.captureException(err, { sessionId: session.id, email });
    // Return 200 even on DB error — prevents Stripe from retrying indefinitely.
    // The customer is protected: manual recovery via Supabase dashboard is possible.
    return res.status(200).json({ received: true, error: 'queue_failed' });
  }
};
