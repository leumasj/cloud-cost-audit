// api/resend-webhook.js
// KloudAudit — Resend Delivery-Status Webhook Handler
//
// WHY: delivery_queue.status only reflects whether resend.emails.send() was
// ACCEPTED by the Resend API, not whether the email actually reached the
// inbox. Resend pushes real delivery status (delivered, bounced, complained,
// delayed) via webhook — this endpoint records that on delivery_queue so
// bounces/complaints are visible immediately instead of requiring a manual
// cross-check in Resend's dashboard after a customer complains.
//
// FLOW: Resend fires event → verify Svix signature (via resend.webhooks.verify,
// bundled in the `resend` package — no separate svix dependency needed) →
// match delivery_queue row by resend_email_id (captured at send time in
// process-pending.js) → update actual_delivery_status → alert admin on
// bounce/complaint.

const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');
const sentry = require('./lib/_sentry');
const logger = require('./lib/_logger');
const log = (level, event, data = {}) => logger[level](event, { service: 'resend-webhook', ...data });

// Maps Resend event types to the actual_delivery_status value we store.
// email.sent and any other event type are acknowledged but not tracked.
const EVENT_STATUS_MAP = {
  'email.delivered':        'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced':          'bounced',
  'email.complained':       'complained',
};

// Raw body required for Svix signature verification — must be the exact
// bytes Resend sent, not re-serialised JSON. Mirrors webhook.js's getRawBody.
async function getRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data',  chunk => chunks.push(chunk));
    req.on('end',   ()    => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  );

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);

  // 1. Verify signature — Resend signs webhooks via Svix (svix-id/timestamp/signature
  // headers). resend.webhooks.verify() wraps the bundled `standardwebhooks` package.
  let event;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    event = resend.webhooks.verify({
      payload: rawBody,
      headers: {
        id:        req.headers['svix-id'],
        timestamp: req.headers['svix-timestamp'],
        signature: req.headers['svix-signature'],
      },
      webhookSecret: process.env.RESEND_WEBHOOK_SECRET,
    });
  } catch (err) {
    log('error', 'resend_webhook.signature_failed', { error: err.message });
    sentry.captureException(err, { context: 'resend-webhook-signature' });
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  const newStatus = EVENT_STATUS_MAP[event.type];
  if (!newStatus) {
    return res.status(200).json({ received: true, skipped: event.type });
  }

  const emailId = event.data?.email_id;
  if (!emailId) {
    log('warn', 'resend_webhook.no_email_id', { eventType: event.type });
    return res.status(200).json({ received: true, error: 'no_email_id' });
  }

  // 2 + 3. Match the delivery_queue row by Resend's email_id and record the
  // real delivery outcome. .select() after .update() confirms whether a row
  // actually matched (Supabase updates 0 rows silently otherwise).
  try {
    const { data: rows, error: updateError } = await supabaseAdmin
      .from('delivery_queue')
      .update({ actual_delivery_status: newStatus })
      .eq('resend_email_id', emailId)
      .select('id, email, product_type');

    if (updateError) throw updateError;

    if (!rows || rows.length === 0) {
      log('warn', 'resend_webhook.no_matching_row', { eventType: event.type, emailId });
      return res.status(200).json({ received: true, matched: false });
    }

    const job = rows[0];
    log('info', 'resend_webhook.status_updated', {
      eventType: event.type, emailId, status: newStatus, jobId: job.id,
    });

    // 4. Bounce/complaint = customer likely never got their paid product —
    // alert immediately rather than waiting for them to notice and complain.
    if (newStatus === 'bounced' || newStatus === 'complained') {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from:    'KloudAudit System <admin@kloudaudit.eu>',
          to:      ['admin@kloudaudit.eu'],
          subject: `🚨 Email ${newStatus} — ${job.email} · ${job.product_type}`,
          text:    `Resend reported "${event.type}" for a delivery already marked "delivered" in delivery_queue.\n\nJob: ${job.id}\nEmail: ${job.email}\nProduct: ${job.product_type}\nResend email_id: ${emailId}\n\nCustomer likely did not receive their purchase — manual follow-up recommended.`,
        });
      } catch (alertError) {
        log('error', 'resend_webhook.alert_failed', { error: alertError.message, jobId: job.id });
      }
    }

    return res.status(200).json({ received: true, matched: true, status: newStatus });
  } catch (err) {
    log('error', 'resend_webhook.update_failed', { error: err.message, eventType: event.type, emailId });
    sentry.captureException(err, { context: 'resend-webhook-update' });
    return res.status(200).json({ received: true, error: 'update_failed' });
  }
};
