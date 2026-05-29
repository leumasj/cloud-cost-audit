// api/process-pending.js
// KloudAudit — Async Delivery Processor + Follow-up Email Runner
//
// Called by Vercel cron every minute (or external cron-job.org if on Hobby plan).
// Single cron run handles two queues:
//   1. delivery_queue  — pending blueprint jobs (Claude AI → SendGrid)
//   2. follow_up_queue — post-purchase follow-up emails (day 7 / 14 / 30)
//
// Merged from send-followups.js to stay within Vercel Hobby's 12-function limit.

const Anthropic = require('@anthropic-ai/sdk');
const sgMail    = require('@sendgrid/mail');
const crypto    = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const sentry = require('./lib/_sentry');


const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// anon client — for operations that don't need elevated access
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// service role client — bypasses RLS for admin operations (delivery, cache reads)
// NEVER expose this key to the browser or frontend
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY // fallback for backward compat
);

// ── CRON GUARD — prevent concurrent runs ─────────────────────────────────────
// Vercel cron can fire multiple times if a run takes longer than 60s.
// We mark jobs as 'processing' immediately to prevent double-delivery.

const MAX_ATTEMPTS = 3;
const PROCESS_BATCH = 5; // process up to 5 jobs per cron run

// ── CACHE HELPERS ─────────────────────────────────────────────────────────────
// Cache key: sha256 of provider + sorted flagged issue IDs
// Identical issue combinations across different customers = same fix commands
function buildCacheKey(productType, meta) {
  const provider  = (meta.provider || 'AWS').toLowerCase();
  const issueIds  = (meta.flaggedIssueIds || '')
    .split(',')
    .filter(Boolean)
    .sort() // sort so order doesn't matter
    .join(',');
  const raw = `${productType}:${provider}:${issueIds}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function getCachedReport(cacheKey) {
  try {
    const { data } = await supabaseAdmin
      .from('report_cache')
      .select('report_text, hit_count')
      .eq('cache_key', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (data) {
      // Increment hit count (fire and forget)
      supabase
        .from('report_cache')
        .update({ hit_count: (data.hit_count || 0) + 1 })
        .eq('cache_key', cacheKey)
        .then(() => {});
      return data.report_text;
    }
    return null;
  } catch (_) {
    return null; // cache miss or error — proceed with Claude
  }
}

async function setCachedReport(cacheKey, productType, reportText) {
  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7-day TTL
    await supabaseAdmin
      .from('report_cache')
      .upsert({
        cache_key:   cacheKey,
        report_text: reportText,
        product_type: productType,
        hit_count:   0,
        expires_at:  expiresAt.toISOString(),
      }, { onConflict: 'cache_key' });
  } catch (err) {
    console.warn('Cache write failed (non-critical):', err.message);
  }
}

// ── BLUEPRINT PROMPT ─────────────────────────────────────────────────────────
function buildBlueprintPrompt(meta) {
  const provider      = meta.provider || 'AWS';
  const companyName   = meta.companyName || 'Your Company';
  const monthlyBill   = meta.monthlyBill || '0';
  const savingsMin    = meta.savingsMin || '0';
  const savingsMax    = meta.savingsMax || '0';
  const issueLabels   = (meta.flaggedIssueLabels || '').split('||').filter(Boolean);
  const chargeDisplay = meta.amount_total
    ? `${(meta.amount_total / 100).toFixed(2)} ${(meta.currency || 'PLN').toUpperCase()}`
    : '299 PLN';

  return `You are a senior DevOps engineer writing a personalised cloud cost optimisation guide for ${companyName}.

Provider: ${provider}
Monthly cloud bill: $${monthlyBill}
Estimated savings: $${savingsMin}–$${savingsMax}/month
Flagged issues (${issueLabels.length}): ${issueLabels.join(', ')}
Payment: ${chargeDisplay}

Generate a professional Implementation Blueprint. For EACH flagged issue provide:

## [Issue Name]

**What's happening**: 1-2 sentences explaining the waste.

**Monthly cost**: Estimate based on typical ${provider} pricing.

**Fix it now (${provider} CLI)**:
\`\`\`bash
# Exact command with real flags — not pseudocode
[command]
\`\`\`

**Terraform/IaC** (if applicable):
\`\`\`hcl
[snippet]
\`\`\`

**Step-by-step**:
1. [Specific step]
2. [Specific step]
3. [Specific step]

**Verify savings**:
\`\`\`bash
[verification command]
\`\`\`

**Time to implement**: [X minutes/hours]

---

After all issues, add:

## Implementation Order
Rank all issues by ROI (savings / effort). Most impactful first.

## Expected Results
Total monthly savings, annual savings, time to full implementation.

Be precise and technical. Real ${provider} commands only. This customer paid for professional quality.`;
}

// ── SECURITY BLUEPRINT PROMPT ─────────────────────────────────────────────────
function buildSecurityPrompt(meta) {
  const provider    = meta.provider || 'AWS';
  const issueLabels = (meta.flaggedIssueLabels || '').split('||').filter(Boolean);

  return `You are a senior cloud security architect delivering a paid Security Blueprint for ${meta.companyName || 'a company'} on ${provider}.

Issues flagged (${issueLabels.length}): ${issueLabels.join(', ')}
Additional context:
- MFA enforced: ${meta.mfaEnabled}
- Public buckets: ${meta.publicBuckets}
- IAM wildcards: ${meta.iamWildcards}
- Encryption at rest: ${meta.encryptionAtRest}
- Encryption in transit: ${meta.encryptionInTransit}
- Audit logging: ${meta.loggingEnabled}
- VPC isolation: ${meta.vpcIsolation}
- Secrets manager: ${meta.secretsManager}
- Incident response plan: ${meta.incidentResponse}

Generate a professional Security Blueprint with:

## Executive Summary
2-3 sentences on overall security posture for CISO briefing.

## Risk Score Breakdown
Table: Control | Status | Severity | Fix Priority

## Critical Findings & Remediation
For each CRITICAL issue:
- Business impact (data breach risk, compliance violation, estimated cost)
- Exact ${provider} CLI remediation command
- Estimated fix time

## High Priority Findings  
For each HIGH issue: exact command and explanation.

## Compliance Gap Analysis
Map to: SOC 2 Type II · ISO 27001 · GDPR · CIS ${provider} Benchmark v1.5

## 30-Day Remediation Roadmap
Week 1: [critical fixes — specific actions]
Week 2: [high priority — specific actions]  
Week 3-4: [medium priority + verification]

## Verification Commands
Commands to confirm each fix was applied correctly.

Real ${provider} CLI only. This customer paid for professional quality.`;
}

// ── HTML EMAIL BUILDERS ───────────────────────────────────────────────────────
function buildBlueprintEmail(report, meta) {
  const provider = meta.provider || 'AWS';
  const savings  = `$${Number(meta.savingsMin || 0).toLocaleString()}–$${Number(meta.savingsMax || 0).toLocaleString()}`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#07070f;font-family:system-ui,sans-serif;">
<div style="max-width:680px;margin:0 auto;padding:40px 24px;">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:32px;">
    <div style="width:36px;height:36px;background:#00ffb4;border-radius:8px;font-size:18px;display:flex;align-items:center;justify-content:center;">⚡</div>
    <span style="font-size:20px;font-weight:800;color:#fff;">KloudAudit</span>
  </div>
  <div style="background:linear-gradient(135deg,rgba(0,255,180,0.12),rgba(99,102,241,0.08));border:1.5px solid #00ffb4;border-radius:16px;padding:28px;margin-bottom:28px;text-align:center;">
    <p style="font-size:11px;font-weight:700;color:#00ffb4;letter-spacing:2px;text-transform:uppercase;margin:0 0 10px;">Your ${provider} Cost Blueprint</p>
    <div style="font-size:42px;font-weight:800;color:#00ffb4;letter-spacing:-2px;line-height:1;margin-bottom:8px;">${savings}</div>
    <p style="font-size:14px;color:#94a3b8;margin:0;">estimated monthly savings identified</p>
  </div>
  <div style="background:#111827;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:28px;margin-bottom:24px;">
    <p style="font-size:13px;font-weight:700;color:#fff;margin:0 0 16px;text-transform:uppercase;letter-spacing:1px;">Your Implementation Blueprint</p>
    <div style="font-family:monospace;font-size:13px;line-height:1.8;color:#cbd5e1;white-space:pre-wrap;">${report.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
  </div>
  <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:20px;text-align:center;">
    <p style="font-size:12px;color:#475569;margin:0 0 8px;">🔒 This blueprint was generated from your self-reported audit answers. We never accessed your cloud account.</p>
    <p style="font-size:12px;color:#475569;margin:0;">Questions? Reply to this email · <a href="mailto:admin@kloudaudit.eu" style="color:#00ffb4;">admin@kloudaudit.eu</a></p>
  </div>
</div>
</body>
</html>`;
}

function buildSecurityEmail(report, meta, assessmentId) {
  const provider = meta.provider || 'AWS';

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#07070f;font-family:system-ui,sans-serif;">
<div style="max-width:680px;margin:0 auto;padding:40px 24px;">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:32px;">
    <div style="width:36px;height:36px;background:#f87171;border-radius:8px;font-size:18px;display:flex;align-items:center;justify-content:center;">🛡</div>
    <span style="font-size:20px;font-weight:800;color:#fff;">KloudAudit Security</span>
  </div>
  <div style="background:linear-gradient(135deg,rgba(248,113,113,0.12),rgba(251,146,60,0.08));border:1.5px solid #f87171;border-radius:16px;padding:28px;margin-bottom:28px;">
    <p style="font-size:11px;font-weight:700;color:#f87171;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Security Blueprint</p>
    <p style="font-size:18px;font-weight:800;color:#fff;margin:0 0 4px;">${provider} Security Assessment</p>
    <p style="font-size:13px;color:#94a3b8;margin:0;">Assessment ID: ${assessmentId}</p>
  </div>
  <div style="background:#111827;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:28px;margin-bottom:24px;">
    <div style="font-family:monospace;font-size:13px;line-height:1.8;color:#cbd5e1;white-space:pre-wrap;">${report.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
  </div>
  <div style="background:rgba(248,113,113,0.04);border:1px solid rgba(248,113,113,0.12);border-radius:12px;padding:18px;margin-bottom:20px;text-align:center;">
    <p style="font-size:12px;color:#f87171;font-weight:700;margin:0 0 4px;">🔒 Privacy Notice</p>
    <p style="font-size:12px;color:#94a3b8;margin:0;">This blueprint was generated from your self-reported answers. KloudAudit never accessed your cloud account, credentials, or infrastructure.</p>
  </div>
  <div style="text-align:center;">
    <p style="font-size:12px;color:#475569;margin:0;">Questions? Reply to this email · <a href="mailto:admin@kloudaudit.eu" style="color:#f87171;">admin@kloudaudit.eu</a></p>
  </div>
</div>
</body>
</html>`;
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // Allow GET (from cron) or POST (manual trigger)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Simple auth check — prevent public abuse
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let processed = 0;
  let failed    = 0;
  const results = [];

  try {
    // 1. Fetch pending jobs
    const { data: jobs, error: fetchError } = await supabaseAdmin
      .from('delivery_queue')
      .select('*')
      .eq('status', 'pending')
      .lt('attempts', MAX_ATTEMPTS)
      .order('created_at', { ascending: true })
      .limit(PROCESS_BATCH);

    if (fetchError) throw fetchError;
    if (!jobs || jobs.length === 0) {
      return res.status(200).json({ processed: 0, message: 'No pending jobs' });
    }

    // 2. Process each job — mark as processing immediately
    for (const job of jobs) {
      // Mark processing to reduce (not eliminate) duplicate risk
      await supabaseAdmin
        .from('delivery_queue')
        .update({ status: 'processing', last_attempt_at: new Date().toISOString(), attempts: job.attempts + 1 })
        .eq('id', job.id)
        .eq('status', 'pending'); // only claim if still pending

      try {
        const meta    = job.metadata;
        const email   = job.email;
        const isSession = job.product_type === 'consulting_session';
        const isSecur   = job.product_type === 'security_blueprint';
        const isBundle  = job.product_type === 'bundle';

        // ── CONSULTING SESSION — send confirmation to customer + alert to admin ─
        if (isSession) {
          const chargeDisplay = meta.amount_total
            ? `${(meta.amount_total / 100).toFixed(2)} ${(meta.currency || 'usd').toUpperCase()}`
            : 'session fee';
          await Promise.all([
            sgMail.send({
              to:      email,
              from:    { email: 'admin@kloudaudit.eu', name: 'Samuel @ KloudAudit' },
              replyTo: 'admin@kloudaudit.eu',
              subject: '✅ Session booked — we\'ll confirm your slot within 24hrs',
              html: `<!DOCTYPE html><html><body style="background:#07070f;font-family:system-ui;margin:0;padding:0;"><div style="max-width:600px;margin:0 auto;padding:40px 24px;"><div style="display:flex;align-items:center;gap:10px;margin-bottom:32px;"><div style="width:36px;height:36px;background:#00ffb4;border-radius:8px;font-size:18px;display:flex;align-items:center;justify-content:center;">⚡</div><span style="font-size:20px;font-weight:800;color:#fff;">KloudAudit</span></div><div style="background:linear-gradient(135deg,rgba(0,255,180,0.1),rgba(99,102,241,0.08));border:1.5px solid #00ffb4;border-radius:16px;padding:28px;margin-bottom:24px;"><p style="font-size:11px;font-weight:700;color:#00ffb4;letter-spacing:2px;text-transform:uppercase;margin:0 0 10px;">SESSION CONFIRMED</p><h1 style="font-size:26px;font-weight:800;color:#fff;margin:0 0 12px;">Payment received — session booked</h1><p style="font-size:15px;color:#94a3b8;line-height:1.7;margin:0;">Samuel will email you within 24 hours to agree on a time slot. Check <strong style="color:#fff;">admin@kloudaudit.eu</strong> — reply directly to that email to share your availability.</p></div><div style="background:#111827;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:20px 24px;margin-bottom:24px;"><p style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">What to prepare</p>${["Your cloud provider console (read-only access helpful)", "Your current monthly bill or Cost Explorer screenshot", "The specific issues you want to fix", "Any Terraform or IaC files relevant to the audit"].map(i => `<div style="display:flex;gap:10px;margin-bottom:8px;"><span style="color:#00ffb4;flex-shrink:0;">→</span><p style="font-size:13px;color:#94a3b8;margin:0;">${i}</p></div>`).join('')}</div><p style="font-size:12px;color:#374151;text-align:center;">Questions? Reply to this email · admin@kloudaudit.eu</p></div></body></html>`,
            }),
            sgMail.send({
              to:      'admin@kloudaudit.eu',
              from:    { email: 'admin@kloudaudit.eu', name: 'KloudAudit System' },
              subject: `💼 Session booked — ${email} · ${meta.provider || 'AWS'} · ${chargeDisplay}`,
              text:    `New consulting session booked.\n\nEmail: ${email}\nProvider: ${meta.provider || 'AWS'}\nCharge: ${chargeDisplay}\nJob ID: ${job.id}\n\nReply to ${email} within 24hrs to schedule the slot.`,
            }),
          ]);
          await supabaseAdmin.from('delivery_queue').update({ status: 'delivered', delivered_at: new Date().toISOString() }).eq('id', job.id);
          results.push({ id: job.id, status: 'delivered', email, type: 'consulting_session' });
          processed++;
          continue;
        }

        // 3. Check cache + call Claude AI
        let report   = null;
        let cacheHit = false;

        if (isBundle) {
          // Bundle: generate both reports in parallel — 2x value for the customer
          const [costKey, secKey] = [
            buildCacheKey('blueprint', meta),
            buildCacheKey('security_blueprint', meta),
          ];
          const [cachedCost, cachedSec] = await Promise.all([
            getCachedReport(costKey),
            getCachedReport(secKey),
          ]);

          const [costReport, secReport] = await Promise.all([
            cachedCost ? Promise.resolve(cachedCost) : anthropic.messages.create({
              model: 'claude-sonnet-4-6', max_tokens: 2000,
              messages: [{ role: 'user', content: buildBlueprintPrompt(meta) }],
            }).then(r => { const t = r.content[0].text; setCachedReport(costKey, 'blueprint', t); return t; }),
            cachedSec ? Promise.resolve(cachedSec) : anthropic.messages.create({
              model: 'claude-sonnet-4-6', max_tokens: 2000,
              messages: [{ role: 'user', content: buildSecurityPrompt(meta) }],
            }).then(r => { const t = r.content[0].text; setCachedReport(secKey, 'security_blueprint', t); return t; }),
          ]);

          report = `# COST BLUEPRINT\n\n${costReport}\n\n---\n\n# SECURITY BLUEPRINT\n\n${secReport}`;
          cacheHit = !!(cachedCost && cachedSec);

        } else {
          // Single product — check cache first
          const cacheKey = buildCacheKey(job.product_type, meta);
          report   = await getCachedReport(cacheKey);
          cacheHit = !!report;

          if (!report) {
            console.log(`Cache miss — calling Claude for job ${job.id}`);
            const prompt = isSecur ? buildSecurityPrompt(meta) : buildBlueprintPrompt(meta);
            const aiResp = await anthropic.messages.create({
              model:      'claude-sonnet-4-6',
              max_tokens: isSecur ? 2500 : 2000,
              messages:   [{ role: 'user', content: prompt }],
            });
            report = aiResp.content[0].text;
            setCachedReport(cacheKey, job.product_type, report);
          } else {
            console.log(`Cache hit — delivering cached report for job ${job.id}`);
          }
        }

        // 4. Build emails
        const provider     = meta.provider || 'AWS';
        const assessmentId = `KA-${isSecur ? 'SEC' : 'COST'}-${Date.now()}`;
        const chargeDisplay = meta.amount_total
          ? `${(meta.amount_total / 100).toFixed(2)} ${(meta.currency || 'pln').toUpperCase()}`
          : (isSecur ? '119 PLN' : '299 PLN');

        const customerHtml = isSecur
          ? buildSecurityEmail(report, meta, assessmentId)
          : buildBlueprintEmail(report, meta);

        // 5. Send emails in parallel
        await Promise.all([
          sgMail.send({
            to:       email,
            from:     { email: 'admin@kloudaudit.eu', name: 'Samuel @ KloudAudit' },
            replyTo:  'admin@kloudaudit.eu',
            subject:  isBundle
              ? `🎯 Your Cost + Security Bundle is ready — ${assessmentId}`
              : isSecur
                ? `🛡 Your Security Blueprint is ready — ${assessmentId}`
                : `⚡ Your ${provider} Cost Blueprint is ready`,
            html: customerHtml,
          }),
          sgMail.send({
            to:      'admin@kloudaudit.eu',
            from:    { email: 'admin@kloudaudit.eu', name: 'KloudAudit System' },
            subject: `${isBundle ? '🎯' : isSecur ? '🛡' : '⚡'} Blueprint delivered — ${email} · ${provider} · ${chargeDisplay}`,
            text:    `Email: ${email}\nProvider: ${provider}\nProduct: ${job.product_type}\nCharge: ${chargeDisplay}\nJob ID: ${job.id}\nIssues: ${(meta.flaggedIssueLabels || '').split('||').filter(Boolean).join(', ')}`,
          }),
        ]);

        // 6 + 7. Parallelise post-delivery writes — no data dependency between them
        const sessionId = meta.session_id || meta.sessionId;
        await Promise.all([
          supabaseAdmin
            .from('delivery_queue')
            .update({ status: 'delivered', delivered_at: new Date().toISOString() })
            .eq('id', job.id),
          sessionId && supabaseAdmin
            .from('audits')
            .update({ blueprint_paid: true, blueprint_type: job.product_type })
            .eq('session_id', sessionId),
        ].filter(Boolean));

        // 8. Queue post-purchase follow-up emails (day 7, 14, 30)
        // Non-blocking — a failure here must never prevent blueprint delivery.
        const now = new Date();
        const followUps = [
          { follow_up_type: 'day7',  days: 7  },
          { follow_up_type: 'day14', days: 14 },
          { follow_up_type: 'day30', days: 30 },
        ].map(({ follow_up_type, days }) => ({
          email:           job.email,
          product_type:    job.product_type,
          provider:        meta.provider || 'AWS',
          follow_up_type,
          send_at:         new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
          status:          'pending',
          metadata: {
            savingsMin:  meta.savingsMin,
            savingsMax:  meta.savingsMax,
            companyName: meta.companyName,
          },
        }));
        supabaseAdmin
          .from('follow_up_queue')
          .insert(followUps)
          .then(() => {})
          .catch(err => console.warn('Follow-up queue insert failed (non-critical):', err.message));

        console.log(`✅ Delivered: ${job.id} | ${email} | ${job.product_type} | cache:${cacheHit}`);
        results.push({ id: job.id, status: 'delivered', email, cacheHit });
        processed++;

      } catch (jobErr) {
        console.error(`❌ Failed job ${job.id}:`, jobErr.message);
        sentry.captureException(jobErr, { jobId: job.id, email: job.email, product: job.product_type });

        // Mark as failed (will retry on next cron run, up to MAX_ATTEMPTS)
        const isFinalAttempt = job.attempts + 1 >= MAX_ATTEMPTS;
        await supabase
          .from('delivery_queue')
          .update({
            status:        isFinalAttempt ? 'failed' : 'pending',
            error_message: jobErr.message,
          })
          .eq('id', job.id);

        // Alert admin on final failure
        if (isFinalAttempt) {
          try {
            await sgMail.send({
              to:      'admin@kloudaudit.eu',
              from:    { email: 'admin@kloudaudit.eu', name: 'KloudAudit Alert' },
              subject: `🚨 Blueprint delivery FAILED after ${MAX_ATTEMPTS} attempts — ${job.email}`,
              text:    `Job ID: ${job.id}\nEmail: ${job.email}\nProduct: ${job.product_type}\nError: ${jobErr.message}\n\nManually investigate via Supabase dashboard.`,
            });
          } catch (_) {}
        }

        results.push({ id: job.id, status: 'failed', error: jobErr.message });
        failed++;
      }
    }

    // ── FOLLOW-UP QUEUE ───────────────────────────────────────────────────────
    // Process due post-purchase follow-up emails (day 7 / 14 / 30).
    // Runs in the same cron tick after blueprint delivery to stay within the
    // Vercel Hobby 12-function limit (merged from send-followups.js).
    let followUpsSent = 0;
    try {
      const nowTs = new Date();
      const { data: followUps, error: fuError } = await supabaseAdmin
        .from('follow_up_queue')
        .select('*')
        .eq('status', 'pending')
        .lte('send_at', nowTs.toISOString())
        .order('send_at', { ascending: true })
        .limit(15);

      if (fuError && fuError.code !== '42P01') throw fuError; // 42P01 = table not yet created

      for (const fu of (followUps || [])) {
        try {
          const meta = { ...fu.metadata, email: fu.email, product_type: fu.product_type, provider: fu.provider };
          const isSec = fu.product_type === 'security_blueprint';
          const crossSellCost = `<div style="background:rgba(0,255,180,0.05);border:1px solid rgba(0,255,180,0.18);border-radius:14px;padding:20px 24px;margin-bottom:24px;"><p style="font-size:11px;font-weight:700;color:#00ffb4;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">WHILE YOU'RE HARDENING YOUR INFRA</p><p style="font-size:14px;font-weight:700;color:#fff;margin:0 0 6px;">Have you checked what your ${fu.provider || 'cloud'} bill is hiding?</p><p style="font-size:13px;color:#94a3b8;line-height:1.6;margin:0 0 14px;">Free 15-minute cost audit — no credentials, no account access.</p><a href="https://www.kloudaudit.eu" style="display:inline-block;background:#00ffb4;color:#000;font-weight:800;font-size:13px;text-decoration:none;padding:10px 22px;border-radius:8px;">Run Free Cost Audit →</a></div>`;
          const crossSellSec = `<div style="background:rgba(248,113,113,0.05);border:1px solid rgba(248,113,113,0.18);border-radius:14px;padding:20px 24px;margin-bottom:24px;"><p style="font-size:11px;font-weight:700;color:#f87171;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">WHILE YOU'RE CUTTING COSTS</p><p style="font-size:14px;font-weight:700;color:#fff;margin:0 0 6px;">Have you checked your security posture?</p><p style="font-size:13px;color:#94a3b8;line-height:1.6;margin:0 0 14px;">Free 10-minute security audit, no credentials needed.</p><a href="https://www.kloudaudit.eu" style="display:inline-block;background:#f87171;color:#000;font-weight:800;font-size:13px;text-decoration:none;padding:10px 22px;border-radius:8px;">Run Free Security Audit →</a></div>`;
          const unsubLink = `<p style="font-size:12px;color:#374151;text-align:center;margin:0;"><a href="https://www.kloudaudit.eu/api/unsubscribe?email=${encodeURIComponent(fu.email)}" style="color:#374151;">Unsubscribe</a></p>`;
          const header = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:32px;"><div style="width:36px;height:36px;background:#00ffb4;border-radius:8px;font-size:18px;display:flex;align-items:center;justify-content:center;">⚡</div><span style="font-size:20px;font-weight:800;color:#fff;">KloudAudit</span></div>`;

          let html, subject;

          if (fu.follow_up_type === 'day7') {
            subject = `How's your ${isSec ? 'security' : 'cost'} implementation going?`;
            html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#07070f;font-family:system-ui,sans-serif;"><div style="max-width:600px;margin:0 auto;padding:40px 24px;">${header}<p style="font-size:11px;font-weight:700;color:#00ffb4;letter-spacing:2px;text-transform:uppercase;margin:0 0 10px;">7-DAY CHECK-IN</p><h1 style="font-size:26px;font-weight:800;color:#fff;letter-spacing:-1px;margin:0 0 12px;">How's the implementation going?</h1><p style="font-size:15px;color:#94a3b8;line-height:1.7;margin:0 0 24px;">A week since you got your ${isSec ? 'Security' : 'Cost'} Blueprint. Most teams ship their first fix within 48 hours — the easiest one takes under 10 minutes.</p>${isSec ? crossSellCost : crossSellSec}<div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:20px;">${unsubLink}</div></div></body></html>`;

          } else if (fu.follow_up_type === 'day14') {
            subject = 'Want a hand implementing the fixes? Book a 1:1 session';
            const savMin = Number(meta.savingsMin || 0);
            const savMax = Number(meta.savingsMax || 0);
            html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#07070f;font-family:system-ui,sans-serif;"><div style="max-width:600px;margin:0 auto;padding:40px 24px;">${header}<p style="font-size:11px;font-weight:700;color:#818cf8;letter-spacing:2px;text-transform:uppercase;margin:0 0 10px;">14-DAY FOLLOW-UP</p><h1 style="font-size:26px;font-weight:800;color:#fff;letter-spacing:-1px;margin:0 0 12px;">Want a second set of eyes on the implementation?</h1><p style="font-size:15px;color:#94a3b8;line-height:1.7;margin:0 0 24px;">${savMin > 0 ? `Your blueprint identified $${savMin.toLocaleString()}–$${savMax.toLocaleString()}/month in potential savings. ` : ''}Some teams find it useful to have an expert walk through their setup to confirm everything is applied correctly.</p><div style="background:linear-gradient(135deg,rgba(129,140,248,0.08),rgba(0,255,180,0.05));border:1.5px solid rgba(129,140,248,0.3);border-radius:16px;padding:28px;margin-bottom:24px;text-align:center;"><p style="font-size:20px;font-weight:800;color:#fff;margin:0 0 16px;">Book a 60-min implementation session</p><a href="https://www.kloudaudit.eu" style="display:inline-block;background:linear-gradient(135deg,#818cf8,#6366f1);color:#fff;font-weight:800;font-size:14px;text-decoration:none;padding:13px 32px;border-radius:10px;">Book Implementation Session →</a></div><div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:20px;">${unsubLink}</div></div></body></html>`;

          } else if (fu.follow_up_type === 'day30') {
            subject = `30 days on — time to re-run your ${fu.provider || 'cloud'} audit`;
            html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#07070f;font-family:system-ui,sans-serif;"><div style="max-width:600px;margin:0 auto;padding:40px 24px;">${header}<p style="font-size:11px;font-weight:700;color:#00ffb4;letter-spacing:2px;text-transform:uppercase;margin:0 0 10px;">30-DAY MILESTONE</p><h1 style="font-size:26px;font-weight:800;color:#fff;letter-spacing:-1px;margin:0 0 12px;">30 days on — has your score improved?</h1><p style="font-size:15px;color:#94a3b8;line-height:1.7;margin:0 0 24px;">Re-run the free audit to measure improvement and find anything that's drifted in since your last audit.</p><div style="text-align:center;margin-bottom:24px;"><a href="https://www.kloudaudit.eu" style="display:inline-block;background:#00ffb4;color:#000;font-weight:800;font-size:15px;text-decoration:none;padding:14px 36px;border-radius:10px;">Re-run Free Audit →</a></div><div style="background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.2);border-radius:14px;padding:20px 24px;margin-bottom:24px;"><p style="font-size:14px;font-weight:700;color:#fff;margin:0 0 6px;">Track progress every month with our monthly plan.</p><p style="font-size:13px;color:#94a3b8;margin:0 0 14px;">Unlimited re-audits, score history, one discounted Blueprint/month.</p><a href="https://www.kloudaudit.eu" style="display:inline-block;color:#818cf8;font-weight:700;font-size:13px;text-decoration:none;padding:10px 22px;border-radius:8px;border:1px solid rgba(99,102,241,0.4);">See Monthly Plan →</a></div><div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:20px;">${unsubLink}</div></div></body></html>`;

          } else {
            await supabaseAdmin.from('follow_up_queue').update({ status: 'failed', error: `unknown type: ${fu.follow_up_type}` }).eq('id', fu.id);
            continue;
          }

          await sgMail.send({ to: fu.email, from: { email: 'admin@kloudaudit.eu', name: 'Samuel @ KloudAudit' }, replyTo: 'admin@kloudaudit.eu', subject, html });
          await supabaseAdmin.from('follow_up_queue').update({ status: 'sent', sent_at: nowTs.toISOString() }).eq('id', fu.id);
          console.log(`✅ Follow-up sent: ${fu.follow_up_type} → ${fu.email}`);
          followUpsSent++;

        } catch (fuErr) {
          console.error(`❌ Follow-up failed for ${fu.email}:`, fuErr.message);
          await supabaseAdmin.from('follow_up_queue').update({ status: 'failed', error: fuErr.message }).eq('id', fu.id).catch(() => {});
        }
      }
    } catch (fuQueueErr) {
      // Non-fatal — blueprint delivery already succeeded; log and continue
      console.warn('Follow-up queue processing error (non-critical):', fuQueueErr.message);
    }

    return res.status(200).json({
      processed,
      failed,
      total: jobs.length,
      followUpsSent,
      results,
    });

  } catch (err) {
    console.error('process-pending error:', err.message);
    sentry.captureException(err, { context: 'process-pending-outer' });
    return res.status(500).json({ error: err.message });
  }
};
