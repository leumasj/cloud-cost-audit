// api/process-pending.js
// KloudAudit — Async Delivery Processor
//
// Called by Vercel cron every minute (or external cron-job.org if on Hobby plan).
// Picks up pending jobs from delivery_queue, calls Claude AI, sends email via SendGrid.
//
// No timeout pressure — this function runs independently of the Stripe webhook.
// If Claude takes 45 seconds, that's fine. No customer is waiting on this response.

const Anthropic = require('@anthropic-ai/sdk');
const sgMail    = require('@sendgrid/mail');
const crypto    = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const sentry = require('./lib/sentry');


const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
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
    const { data } = await supabase
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
    await supabase
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
    // 1. Fetch pending jobs (up to PROCESS_BATCH)
    const { data: jobs, error: fetchError } = await supabase
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

    // 2. Process each job
    for (const job of jobs) {
      // Mark as processing to prevent concurrent runs
      await supabase
        .from('delivery_queue')
        .update({ status: 'processing', last_attempt_at: new Date().toISOString(), attempts: job.attempts + 1 })
        .eq('id', job.id);

      try {
        const meta    = job.metadata;
        const email   = job.email;
        const isSecur = job.product_type === 'security_blueprint';

        // 3. Check cache first — same issue combination = same fix commands
        const cacheKey    = buildCacheKey(job.product_type, meta);
        let report        = await getCachedReport(cacheKey);
        let cacheHit      = !!report;

        if (!report) {
          // Cache miss — call Claude AI
          console.log(`Cache miss — calling Claude for job ${job.id}`);
          const prompt = isSecur ? buildSecurityPrompt(meta) : buildBlueprintPrompt(meta);
          const aiResp = await anthropic.messages.create({
            model:      'claude-sonnet-4-6',
            max_tokens: isSecur ? 2500 : 2000,
            messages:   [{ role: 'user', content: prompt }],
          });
          report = aiResp.content[0].text;
          // Store in cache for future identical requests (fire and forget)
          setCachedReport(cacheKey, job.product_type, report);
        } else {
          console.log(`Cache hit — delivering cached report for job ${job.id}`);
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
            subject:  isSecur
              ? `🛡 Your Security Blueprint is ready — ${assessmentId}`
              : `⚡ Your ${provider} Cost Blueprint is ready`,
            html: customerHtml,
          }),
          sgMail.send({
            to:      'admin@kloudaudit.eu',
            from:    { email: 'admin@kloudaudit.eu', name: 'KloudAudit System' },
            subject: `${isSecur ? '🛡' : '⚡'} Blueprint delivered — ${email} · ${provider} · ${chargeDisplay}`,
            text:    `Email: ${email}\nProvider: ${provider}\nProduct: ${job.product_type}\nCharge: ${chargeDisplay}\nJob ID: ${job.id}\nIssues: ${(meta.flaggedIssueLabels || '').split('||').filter(Boolean).join(', ')}`,
          }),
        ]);

        // 6. Mark as delivered
        await supabase
          .from('delivery_queue')
          .update({ status: 'delivered', delivered_at: new Date().toISOString() })
          .eq('id', job.id);

        // 7. Mark blueprint_paid in audits table if session_id available
        const sessionId = meta.session_id || meta.sessionId;
        if (sessionId) {
          await supabase
            .from('audits')
            .update({
              blueprint_paid: true,
              blueprint_type: job.product_type,
            })
            .eq('session_id', sessionId);
        }

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

    return res.status(200).json({
      processed,
      failed,
      total: jobs.length,
      results,
    });

  } catch (err) {
    console.error('process-pending error:', err.message);
    sentry.captureException(err, { context: 'process-pending-outer' });
    return res.status(500).json({ error: err.message });
  }
};
