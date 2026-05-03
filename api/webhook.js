// api/webhook.js
// KloudAudit — Stripe Webhook Handler
// Architecture: Queue-based async delivery
//
// FLOW:
// 1. Stripe fires event → verify signature → save to queue → return 200 IMMEDIATELY
// 2. /api/process-pending (cron every 60s) → pick up pending → Claude → SendGrid
//
// WHY: Claude takes 25-45s. Vercel times out at 10-60s.
//      Returning 200 immediately prevents Stripe retrying (which causes duplicate deliveries).

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const sentry = require('./lib/sentry');


const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end',  ()    => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
    console.error('Webhook signature failed:', err.message);
    sentry.captureException(err, { context: 'stripe-signature' });
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  // 3. Only handle completed payments
  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true, skipped: event.type });
  }

  const session = event.data.object;
  const meta    = session.metadata || {};
  const email   = meta.email || session.customer_email;

  if (!email) {
    console.error('No email in session:', session.id);
    return res.status(200).json({ received: true, error: 'no_email' });
  }

  // 4. Save to delivery queue — FAST (~100ms)
  // KEY CHANGE: We do NOT call Claude here. We save the job and return 200 immediately.
  // Stripe is satisfied, no retry. /api/process-pending handles the actual delivery.
  try {
    const { error: dbError } = await supabase
      .from('delivery_queue')
      .insert({
        stripe_session_id: session.id,
        email,
        product_type: meta.type === 'security_certificate' ? 'security_blueprint' : 'blueprint',
        metadata: {
          ...meta,
          stripe_session_id: session.id,
          amount_total:      session.amount_total,
          currency:          session.currency,
        },
        status: 'pending',
      });

    if (dbError) {
      // Duplicate session ID = Stripe retried an already-queued job. Acknowledge safely.
      if (dbError.code === '23505') {
        console.log('Duplicate webhook for session:', session.id);
        return res.status(200).json({ received: true, duplicate: true });
      }
      throw dbError;
    }

    console.log(`Queued: ${session.id} | ${email} | ${meta.type || 'blueprint'}`);
    return res.status(200).json({ received: true, queued: true });

  } catch (err) {
    console.error('Queue insert failed:', err.message);
    // Return 200 even on error — prevents Stripe from retrying indefinitely.
    // Check Supabase dashboard and Vercel logs to investigate.
    return res.status(200).json({ received: true, error: 'queue_failed' });
  }
};
