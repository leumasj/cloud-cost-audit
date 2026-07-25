// api/email.js
// KloudAudit — Unified Email Endpoint (consolidates send-report + send-reaudit)
// Reduces API count for Vercel free tier (12 function limit)

const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit } = require('./lib/_ratelimit');
const { ALLOWED_ORIGINS } = require('./lib/_config');

// Escapes user-controlled fields before interpolating into HTML emails.
// provider/flaggedIssues/flaggedCount come straight from the request body with
// no server-side allowlist — mirrors process-pending.js's escapeHtml.
function escapeHtml(str) {
  return String(str).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = async function handler(req, res) {
  const { action } = req.query;

  if (action === 'send-report') {
    return handleSendReport(req, res);
  }
  if (action === 'send-reaudit') {
    return handleSendReaudit(req, res);
  }
  return res.status(400).json({ error: 'Unknown action' });
};

// ── SEND REPORT ───────────────────────────────────────────────────────────────
// Sends the free audit report summary to the user's email via Resend
async function handleSendReport(req, res) {
  // Initialise clients inside handler so env vars are available at call time
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  );
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);

  // CORS — restrict to KloudAudit domains only
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Reject requests from origins not in the allowlist
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const rateLimit = await checkRateLimit(req, 'send-report', 10, 60 * 60 * 1000);
  if (rateLimit.limited) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  try {
    const {
      email, provider, monthlyBill,
      savingsMin, savingsMax, savPct,
      flaggedCount, flaggedIssues = [],
      companyName,
    } = req.body;

    if (!email) return res.status(400).json({ error: 'Email required' });

    const safeProvider     = escapeHtml(provider || 'Cloud');
    const safeFlaggedCount = escapeHtml(flaggedCount);

    const issuesList = flaggedIssues.length > 0
      ? flaggedIssues.map(label => `<li style="margin-bottom:8px;color:#cbd5e1;">${escapeHtml(label)}</li>`).join('')
      : '<li style="color:#94a3b8;">No issues flagged</li>';

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#07070f;font-family:'DM Sans',system-ui,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 24px;">

    <!-- Header -->
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:32px;">
      <div style="width:36px;height:36px;background:#00ffb4;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;">⚡</div>
      <span style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-0.5px;">KloudAudit</span>
    </div>

    <!-- Savings card -->
    <div style="background:linear-gradient(135deg,rgba(0,255,180,0.12),rgba(99,102,241,0.08));border:1.5px solid #00ffb4;border-radius:20px;padding:32px;margin-bottom:24px;text-align:center;">
      <p style="font-size:11px;font-weight:700;color:#00ffb4;letter-spacing:2px;text-transform:uppercase;margin:0 0 12px;">Your ${safeProvider} Audit Results</p>
      <div style="font-size:48px;font-weight:800;color:#00ffb4;letter-spacing:-2px;line-height:1;margin-bottom:8px;">
        $${Number(savingsMin).toLocaleString()}–$${Number(savingsMax).toLocaleString()}
      </div>
      <p style="font-size:15px;color:#94a3b8;margin:0;">estimated monthly savings · <strong style="color:#f8fafc;">${safeFlaggedCount} issues found</strong></p>
      ${savPct ? `<p style="font-size:13px;color:#94a3b8;margin:8px 0 0;">Waste rate: ~${savPct}% of your $${Number(monthlyBill).toLocaleString()}/mo bill</p>` : ''}
    </div>

    <!-- Issues list -->
    <div style="background:#111827;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:24px;margin-bottom:24px;">
      <p style="font-size:13px;font-weight:700;color:#fff;margin:0 0 16px;text-transform:uppercase;letter-spacing:1px;">Issues Found</p>
      <ul style="margin:0;padding:0 0 0 20px;">
        ${issuesList}
      </ul>
    </div>

    <!-- Blueprint CTA -->
    <div style="background:linear-gradient(135deg,rgba(0,255,180,0.08),rgba(99,102,241,0.06));border:1px solid rgba(0,255,180,0.2);border-radius:16px;padding:28px;margin-bottom:24px;text-align:center;">
      <p style="font-size:14px;font-weight:700;color:#fff;margin:0 0 8px;">Want the exact CLI commands and Terraform to fix all of this?</p>
      <p style="font-size:13px;color:#94a3b8;margin:0 0 20px;">The AI Blueprint generates step-by-step fix instructions personalised to your ${safeProvider} setup — delivered to your inbox in minutes.</p>
      <a href="https://www.kloudaudit.eu" style="display:inline-block;background:#00ffb4;color:#000;font-weight:800;font-size:15px;text-decoration:none;padding:14px 32px;border-radius:10px;">
        Get the AI Blueprint →
      </a>
    </div>

    <!-- Trust footer -->
    <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:20px;text-align:center;">
      <p style="font-size:12px;color:#475569;margin:0 0 8px;">🔒 KloudAudit never accessed your cloud account. This report was generated from your self-reported answers only.</p>
      <p style="font-size:12px;color:#475569;margin:0;">Questions? Reply to this email or contact us at <a href="mailto:admin@kloudaudit.eu" style="color:#00ffb4;text-decoration:none;">admin@kloudaudit.eu</a></p>
    </div>

  </div>
</body>
</html>`;

    await Promise.all([
      // Send report to user
      resend.emails.send({
        from:    'Samuel @ KloudAudit <admin@kloudaudit.eu>',
        to:      [email],
        subject: `Your ${safeProvider} Audit Report — $${Number(savingsMin).toLocaleString()}–$${Number(savingsMax).toLocaleString()}/mo found`,
        html,
      }),
      // Notify admin (plain text, not HTML — no escaping needed, but still cap length)
      resend.emails.send({
        from:    'KloudAudit System <admin@kloudaudit.eu>',
        to:      ['admin@kloudaudit.eu'],
        subject: `📬 Free report requested — ${email} · ${provider} · $${Number(savingsMin).toLocaleString()}–$${Number(savingsMax).toLocaleString()}/mo`,
        text: `Email: ${email}\nProvider: ${provider}\nBill: $${monthlyBill}/mo\nSavings: $${savingsMin}–$${savingsMax}/mo\nIssues: ${flaggedCount}\n${flaggedIssues.join(', ')}`,
      }),
    ]);

    const sessionId = req.body.sessionId || req.body.session_id || 'unknown';
    const followUpAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await supabaseAdmin
      .from('delivery_queue')
      .insert({
        stripe_session_id: `abandoned_${sessionId}_${Date.now()}`,
        product_type: 'abandoned_audit_email',
        customer_email: email,
        metadata: {
          provider: provider,
          wasteScore: savPct,
          savingsMin: savingsMin,
          savingsMax: savingsMax,
          flaggedCount: flaggedCount,
          monthlyBill: monthlyBill,
        },
        scheduled_for: followUpAt.toISOString(),
        status: 'pending',
      })
      .onConflict('stripe_session_id')
      .ignore();

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Send report error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ── SEND REAUDIT ──────────────────────────────────────────────────────────────
// KloudAudit — 90-Day Re-audit Reminder
//
// Called daily by cron-job.org at 9am Europe/Warsaw.
// Finds subscribers whose re_audit_due is within the next 24 hours
// and sends a personalised re-audit invitation email.
//
// Psychology: user already knows KloudAudit works (they used it before).
// The email re-activates that trust and creates urgency — cloud waste accumulates.

function buildReauditEmail(subscriber) {
  const provider    = subscriber.provider || 'AWS';
  const auditData   = subscriber.audits;
  const savingsMin  = auditData?.savings_min  || 0;
  const savingsMax  = auditData?.savings_max  || 0;
  const wasteScore  = auditData?.waste_score  || null;
  const hadBlueprint = auditData?.blueprint_paid || false;

  const gradeColor = wasteScore >= 80 ? '#4ade80'
    : wasteScore >= 60 ? '#fbbf24'
    : wasteScore >= 40 ? '#fb923c'
    : '#f87171';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#07070f;font-family:system-ui,-apple-system,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:40px 24px;">

  <!-- Header -->
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:36px;">
    <div style="width:36px;height:36px;background:#00ffb4;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;">⚡</div>
    <span style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-0.5px;">KloudAudit</span>
  </div>

  <!-- Main message -->
  <div style="margin-bottom:28px;">
    <p style="font-size:13px;font-weight:700;color:#00ffb4;letter-spacing:2px;text-transform:uppercase;margin:0 0 12px;">90-Day Check-in</p>
    <h1 style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-1px;line-height:1.2;margin:0 0 16px;">
      Your ${provider} bill has changed.<br/>
      <span style="color:#00ffb4;">New waste has probably crept in.</span>
    </h1>
    <p style="font-size:15px;color:#94a3b8;line-height:1.7;margin:0;">
      90 days ago you ran a KloudAudit${savingsMin > 0 ? ` and found <strong style="color:#fff;">$${savingsMin.toLocaleString()}–$${savingsMax.toLocaleString()}/month</strong> in potential savings` : ''}.
      Cloud costs drift quietly — new instances, forgotten volumes, dev databases left running.
      A 15-minute re-audit will show you what's changed.
    </p>
  </div>

  ${wasteScore !== null ? `
  <!-- Previous score -->
  <div style="background:linear-gradient(135deg,rgba(0,255,180,0.08),rgba(99,102,241,0.06));border:1px solid rgba(0,255,180,0.15);border-radius:14px;padding:20px 24px;margin-bottom:24px;display:flex;align-items:center;gap:20px;">
    <div style="text-align:center;flex-shrink:0;">
      <div style="font-size:36px;font-weight:800;color:${gradeColor};line-height:1;letter-spacing:-1px;">${wasteScore}</div>
      <div style="font-size:11px;color:#64748b;margin-top:2px;">/ 100</div>
    </div>
    <div>
      <p style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px;">Your last waste score</p>
      <p style="font-size:14px;color:#94a3b8;line-height:1.5;margin:0;">
        ${wasteScore < 50 ? 'Your infrastructure had significant waste. 90 days of drift has likely added more.' : wasteScore < 75 ? 'You had some waste flagged. New issues may have appeared since.' : 'You were in good shape. A quick re-audit confirms you\'ve stayed that way.'}
      </p>
    </div>
  </div>` : ''}

  <!-- What's likely changed -->
  <div style="background:#111827;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:20px 24px;margin-bottom:24px;">
    <p style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin:0 0 14px;">What commonly appears in 90 days</p>
    ${[
      ['New dev/staging databases', 'Teams spin up RDS instances for new features and forget to schedule shutdowns.'],
      ['Unattached volumes from terminated instances', 'Every deployment cycle leaves orphaned EBS volumes accumulating charges.'],
      ['On-demand pricing on stable workloads', 'New services launch on On-Demand and never get moved to Savings Plans.'],
    ].map(([title, desc]) => `
    <div style="display:flex;gap:12px;margin-bottom:12px;align-items:flex-start;">
      <span style="color:#f87171;font-size:12px;margin-top:2px;flex-shrink:0;">→</span>
      <div>
        <p style="font-size:13px;font-weight:700;color:#fff;margin:0 0 2px;">${title}</p>
        <p style="font-size:12px;color:#64748b;margin:0;line-height:1.5;">${desc}</p>
      </div>
    </div>`).join('')}
  </div>

  <!-- CTA -->
  <div style="text-align:center;margin-bottom:28px;">
    <a href="https://www.kloudaudit.eu" style="display:inline-block;background:#00ffb4;color:#000;font-weight:800;font-size:16px;text-decoration:none;padding:16px 40px;border-radius:12px;letter-spacing:-0.3px;">
      Run My Free Re-audit →
    </a>
    <p style="font-size:12px;color:#475569;margin:12px 0 0;">Free · 15 minutes · No account access required</p>
  </div>

  ${hadBlueprint ? `
  <!-- Blueprint upsell for existing buyers -->
  <div style="background:rgba(0,255,180,0.04);border:1px solid rgba(0,255,180,0.12);border-radius:12px;padding:16px 20px;margin-bottom:24px;text-align:center;">
    <p style="font-size:13px;color:#00ffb4;font-weight:700;margin:0 0 4px;">⚡ Previous Blueprint buyer</p>
    <p style="font-size:12px;color:#64748b;margin:0;">Run the free audit, then get an updated Blueprint for your new findings at the same price.</p>
  </div>` : ''}

  <!-- Footer -->
  <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:20px;">
    <p style="font-size:12px;color:#374151;text-align:center;margin:0 0 6px;">
      You're receiving this because you ran a KloudAudit 90 days ago.
    </p>
    <p style="font-size:12px;color:#374151;text-align:center;margin:0;">
      <a href="https://www.kloudaudit.eu/api/audits?action=unsubscribe&email=${encodeURIComponent(subscriber.email)}" style="color:#374151;">Unsubscribe</a>
      &nbsp;·&nbsp;
      <a href="mailto:admin@kloudaudit.eu" style="color:#374151;">Contact</a>
    </p>
  </div>

</div>
</body>
</html>`;
}

async function handleSendReaudit(req, res) {
  // Initialise clients inside handler so env vars are available at call time
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  // Admin client for read operations — anon key only has INSERT/UPDATE
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  );
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth check
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Find subscribers due for re-audit in the next 24 hours
    const now      = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const { data: subscribers, error } = await supabaseAdmin
      .from('subscribers')
      .select(`
        email,
        provider,
        re_audit_due,
        audits (
          savings_min,
          savings_max,
          waste_score,
          blueprint_paid
        )
      `)
      .eq('unsubscribed', false)
      .gte('re_audit_due', now.toISOString())
      .lte('re_audit_due', tomorrow.toISOString())
      .limit(50); // process max 50 per run to stay within SendGrid limits

    if (error) throw error;
    if (!subscribers || subscribers.length === 0) {
      return res.status(200).json({ sent: 0, message: 'No re-audits due today' });
    }

    let sent = 0;
    let failed = 0;

    for (const subscriber of subscribers) {
      try {
        const html = buildReauditEmail(subscriber);

        await resend.emails.send({
          from:    'Samuel @ KloudAudit <admin@kloudaudit.eu>',
          to:      [subscriber.email],
          subject: `Your ${subscriber.provider || 'cloud'} bill has drifted — free re-audit ready`,
          html,
        });

        // Update re_audit_due to 90 days from now (so they get reminded again)
        await supabase
          .from('subscribers')
          .update({ re_audit_due: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString() })
          .eq('email', subscriber.email);

        console.log(`✅ Re-audit reminder sent: ${subscriber.email}`);
        sent++;

      } catch (emailErr) {
        console.error(`❌ Failed to send to ${subscriber.email}:`, emailErr.message);
        failed++;
      }
    }

    // Notify admin of daily batch
    if (sent > 0) {
      await resend.emails.send({
        from:    'KloudAudit System <admin@kloudaudit.eu>',
        to:      ['admin@kloudaudit.eu'],
        subject: `📬 Re-audit reminders sent: ${sent} emails`,
        text:    `Sent: ${sent}\nFailed: ${failed}\nTotal due: ${subscribers.length}`,
      });
    }

    return res.status(200).json({ sent, failed, total: subscribers.length });

  } catch (err) {
    console.error('send-reaudit error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
