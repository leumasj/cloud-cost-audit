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
const crypto    = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const sentry = require('./lib/_sentry');


const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── SUPABASE FACTORY — initialised inside handler to pick up env vars safely ──
function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}
function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  );
}

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

async function getCachedReport(cacheKey, supabaseAdmin) {
  try {
    const { data } = await supabaseAdmin
      .from('report_cache')
      .select('report_text, hit_count')
      .eq('cache_key', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (data) {
      // Increment hit count (fire and forget)
      supabaseAdmin
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

async function setCachedReport(cacheKey, productType, reportText, supabaseAdmin) {
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

  return `Be concise. Target 600-700 words total. Focus on the most impactful fixes only.

You are a senior DevOps engineer writing a personalised cloud cost optimisation guide for ${companyName}.

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

// ── CFO REPORT PROMPT ─────────────────────────────────────────────────────────
function buildCfoPrompt(meta) {
  const provider    = meta.provider || 'AWS';
  const isAi        = provider === 'AI APIs';
  const companyName = meta.companyName || 'Your Company';
  const monthlyBill = Number(meta.monthlyBill || 0);
  const savingsMin  = Number(meta.savingsMin || 0);
  const savingsMax  = Number(meta.savingsMax || 0);
  const annualMin   = savingsMin * 12;
  const annualMax   = savingsMax * 12;
  const issueLabels = (meta.flaggedIssueLabels || '').split('||').filter(Boolean);
  const spendLabel  = isAi ? 'AI API spend' : 'cloud spend';
  const spendRowLabel = isAi ? 'Current Monthly AI API Spend' : 'Current Monthly Cloud Spend';

  return `You are ${isAi ? 'an AI cost consultant' : 'a cloud cost consultant'} writing an executive-level CFO & Board Report for ${companyName}.

Provider: ${provider}
Current monthly ${spendLabel}: $${monthlyBill.toLocaleString()}
Monthly savings opportunity: $${savingsMin.toLocaleString()}–$${savingsMax.toLocaleString()}
Annual savings opportunity: $${annualMin.toLocaleString()}–$${annualMax.toLocaleString()}
Issues identified (${issueLabels.length}): ${issueLabels.join(', ')}

Write a professional board-ready report with the following structure. Use plain language — no CLI commands or Terraform${isAi ? ' or infrastructure jargon — this is about model spend, not servers' : ''}. This is for CFOs, CTOs, and investors, not engineers.

## Executive Summary
3-4 sentences. State the current monthly spend, the identified savings opportunity, the annual impact, and the overall assessment. Quantify everything in dollars.

## Financial Impact Overview
A clear breakdown in table or structured format:
| Metric | Value |
|---|---|
| ${spendRowLabel} | $X,XXX |
| Identified Monthly Waste | $X,XXX – $X,XXX |
| Annual Savings Opportunity | $XX,XXX – $XX,XXX |
| Waste as % of Total Spend | XX% |
| Payback Period | Immediate |

## Prioritised Findings (Business Impact)
For each issue, write 2-3 sentences max. Focus on BUSINESS IMPACT (dollars, risk, compliance) not technical detail. Rank by annual dollar impact, highest first.

Format each as:
**[Issue Name]** · Annual impact: $XX,XXX–$XX,XXX
[2-3 sentence business-language explanation of what it's costing and why it matters to leadership]

## Recommended Action Plan
Three phases framed for leadership:

**Phase 1 — Quick Wins (Week 1–2)**
[2-3 actions with combined savings estimate]

**Phase 2 — Structural Savings (Month 1–3)**
[2-3 actions with combined savings estimate]

**Phase 3 — Governance & Prevention (Ongoing)**
[2-3 actions that prevent future waste]

## ROI Summary
One paragraph. State: if the team implements all recommendations, what is the 12-month financial outcome vs. current trajectory? What does this free up for reinvestment?

---

Keep the tone professional but direct. This document will be shared with the board and investors. Avoid jargon. Every number should be in dollars.`;
}

// ── AI SPEND AUDIT PROMPT ─────────────────────────────────────────────────────
function buildAiPrompt(meta) {
  const flagged = (meta.flaggedIssueLabels || '').split('||').filter(Boolean);
  const bill = meta.monthlyBill || 0;

  return `You are a senior AI infrastructure engineer writing
a cost remediation blueprint for a team spending $${bill}/month
on AI APIs (OpenAI, Anthropic, AWS Bedrock, or similar).

They have these specific issues: ${flagged.join(', ')}

Write a practical blueprint covering, for each flagged issue:
1. Model routing code (if ai_model_routing/ai_model_tier flagged)
2. Caching implementation with exact API parameters (if caching flagged)
3. Spending controls setup steps (if spend_cap/token_limits flagged)
4. Batch processing code (if ai_no_batch flagged)
5. Dev/prod separation pattern (if ai_dev_hits_prod_api flagged)

Be specific, include exact code, target 700 words minimum.
No generic advice — every recommendation must be implementable
in under 2 hours.`;
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

function buildCfoEmail(report, meta) {
  const provider   = meta.provider || 'AWS';
  const company    = meta.companyName || 'Your Company';
  const savingsMin = Number(meta.savingsMin || 0);
  const savingsMax = Number(meta.savingsMax || 0);
  const annualMin  = (savingsMin * 12).toLocaleString();
  const annualMax  = (savingsMax * 12).toLocaleString();
  const monthly    = `$${savingsMin.toLocaleString()}–$${savingsMax.toLocaleString()}`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#07070f;font-family:system-ui,sans-serif;">
<div style="max-width:680px;margin:0 auto;padding:40px 24px;">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:32px;">
    <div style="width:36px;height:36px;background:#818cf8;border-radius:8px;font-size:18px;display:flex;align-items:center;justify-content:center;">📊</div>
    <span style="font-size:20px;font-weight:800;color:#fff;">KloudAudit</span>
    <span style="font-size:11px;font-weight:700;color:#818cf8;background:rgba(129,140,248,0.1);border:1px solid rgba(129,140,248,0.3);border-radius:10px;padding:2px 8px;margin-left:4px;">CFO Report</span>
  </div>
  <div style="background:linear-gradient(135deg,rgba(129,140,248,0.12),rgba(99,102,241,0.08));border:1.5px solid rgba(129,140,248,0.4);border-radius:16px;padding:28px;margin-bottom:28px;">
    <p style="font-size:11px;font-weight:700;color:#818cf8;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">CFO & Board Report · ${company} · ${provider}</p>
    <div style="font-size:13px;color:#94a3b8;margin-bottom:16px;">Annual savings opportunity identified:</div>
    <div style="font-size:42px;font-weight:800;color:#818cf8;letter-spacing:-2px;line-height:1;margin-bottom:4px;">$${annualMin}–$${annualMax}</div>
    <p style="font-size:14px;color:#94a3b8;margin:0;">per year · ${monthly}/month · ready to share with your board</p>
  </div>
  <div style="background:#111827;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:28px;margin-bottom:24px;">
    <p style="font-size:13px;font-weight:700;color:#fff;margin:0 0 16px;text-transform:uppercase;letter-spacing:1px;">Your Executive Report</p>
    <div style="font-family:system-ui;font-size:14px;line-height:1.9;color:#cbd5e1;white-space:pre-wrap;">${report.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
  </div>
  <div style="background:rgba(129,140,248,0.04);border:1px solid rgba(129,140,248,0.12);border-radius:12px;padding:18px;margin-bottom:20px;text-align:center;">
    <p style="font-size:12px;color:#818cf8;font-weight:700;margin:0 0 4px;">🔒 Methodology Note</p>
    <p style="font-size:12px;color:#94a3b8;margin:0;">Savings figures are estimates based on self-reported audit answers and industry benchmarks. No cloud credentials were accessed. Actual savings depend on implementation.</p>
  </div>
  <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:20px;text-align:center;">
    <p style="font-size:12px;color:#475569;margin:0;">Questions? Reply to this email · <a href="mailto:admin@kloudaudit.eu" style="color:#818cf8;">admin@kloudaudit.eu</a></p>
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

// ── BLUEPRINT QUALITY VALIDATOR ──────────────────────────────────────────────
function validateBlueprintQuality(content, productType) {
  if (!content || typeof content !== 'string') {
    return { valid: false, reason: 'Empty or invalid response' };
  }

  const wordCount = content.split(/\s+/).length;

  // Minimum word counts by product type
  const minimums = {
    blueprint:  600,
    security:   600,
    cfo_report: 400,
    bundle:     1200,
    ai_blueprint: 600,
  };

  const minimum = minimums[productType] || 600;

  if (wordCount < minimum) {
    return {
      valid:  false,
      reason: `Too short: ${wordCount} words, expected at least ${minimum}`,
    };
  }

  // Check for truncation signals
  const truncationSignals = ['...', '[truncated]', 'I apologize', 'I cannot', 'As an AI'];
  for (const signal of truncationSignals) {
    if (content.includes(signal)) {
      return { valid: false, reason: `Truncation signal detected: "${signal}"` };
    }
  }

  // Blueprint / bundle must have CLI content
  if (productType === 'blueprint' || productType === 'bundle') {
    const hasRequiredContent = ['Step', 'CLI', 'aws '].some(s => content.includes(s));
    if (!hasRequiredContent) {
      return { valid: false, reason: 'Missing expected CLI/step content for blueprint' };
    }
  }

  // CFO report must have executive summary content
  if (productType === 'cfo_report') {
    const hasRequiredContent = ['Executive', 'savings', 'ROI'].some(s =>
      content.toLowerCase().includes(s.toLowerCase())
    );
    if (!hasRequiredContent) {
      return { valid: false, reason: 'Missing expected executive summary content for CFO report' };
    }
  }

  return { valid: true };
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // Initialise clients inside handler so env vars are available at call time
  const supabase      = getSupabase();
  const supabaseAdmin = getSupabaseAdmin();

  let resend;
  try {
    const { Resend } = require('resend');
    resend = new Resend(process.env.RESEND_API_KEY);
  } catch(e) {
    console.error('Resend load failed:', e.message);
    return res.status(500).json({ error: 'Module load failed', detail: e.message });
  }

  try {
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
        const meta          = job.metadata;
        const email         = job.email;
        const customerEmail = job.customer_email || job.email;
        const isSession     = job.product_type === 'consulting_session';
        const isSecur       = job.product_type === 'security_blueprint';
        const isBundle      = job.product_type === 'bundle';
        const isCfoReport   = job.product_type === 'cfo_report';
        const isAiAudit     = job.product_type === 'ai_blueprint';

        // ── 3-DAY FOLLOW-UP EMAIL ─────────────────────────────────────────────
        if (job.product_type === 'followup_email') {
          // Only process if scheduled_for time has passed
          // Guard: delivery_queue may not have scheduled_for column — treat missing as ready
          if (job.scheduled_for && new Date(job.scheduled_for) > new Date()) {
            // Not ready yet — skip this job
            continue;
          }

          const followUpHtml = `
    <p>Hi,</p>
    <p>It's been 3 days since you received your KloudAudit ${meta.original_product} Blueprint.</p>
    <p>Quick check-in — have you had a chance to implement any of the quick wins?</p>
    <p>The three fastest fixes for most teams:</p>
    <ul>
      <li>Dev/staging RDS auto-stop — 20 minutes, saves $200-600/mo</li>
      <li>Delete unattached EBS volumes — 10 minutes, saves $50-200/mo</li>
      <li>Release unused Elastic IPs — 5 minutes, saves $3-15/mo each</li>
    </ul>
    <p>If you hit any blockers with the CLI commands or Terraform snippets,
    just reply to this email — I read every response personally.</p>
    <p>Samuel<br/>Founder, KloudAudit<br/>kloudaudit.eu</p>
  `;

          await resend.emails.send({
            from:    'Samuel — KloudAudit <admin@kloudaudit.eu>',
            to:      [job.email],
            subject: 'How are the fixes going? (KloudAudit follow-up)',
            html:    followUpHtml,
          });

          await supabaseAdmin
            .from('delivery_queue')
            .update({ status: 'delivered', delivered_at: new Date().toISOString() })
            .eq('id', job.id);

          results.push({ id: job.id, status: 'delivered', email: job.email, type: 'followup_email' });
          processed++;
          continue;
        }

        if (job.product_type === 'abandoned_audit_email') {
          // Only process if 48 hours have passed
          // Guard: delivery_queue may not have scheduled_for column — treat missing as ready
          if (job.scheduled_for && new Date(job.scheduled_for) > new Date()) {
            continue;
          }

          const { data: purchased, error: purchaseError } = await supabase
            .from('audits')
            .select('blueprint_paid')
            .eq('email', customerEmail)
            .eq('blueprint_paid', true)
            .limit(1);

          if (purchaseError) {
            throw purchaseError;
          }

          if (purchased && purchased.length > 0) {
            await supabaseAdmin.from('delivery_queue')
              .update({ status: 'delivered', delivered_at: new Date().toISOString() })
              .eq('id', job.id);
            results.push({ id: job.id, status: 'delivered', email: customerEmail, type: 'abandoned_audit_email', reason: 'already_purchased' });
            processed++;
            continue;
          }

          const abandonedMeta = job.metadata || {};
          const savingsLine = abandonedMeta.savingsMin > 0
            ? `$${Number(abandonedMeta.savingsMin).toLocaleString()}–$${Number(abandonedMeta.savingsMax).toLocaleString()}/month`
            : '$500–$2,000/month';

          const html = `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#080810;color:#e2e8f0;border-radius:12px;overflow:hidden">
  <div style="background:#1a1a2e;padding:24px;border-bottom:3px solid #00ffb4">
    <p style="font-size:11px;font-weight:700;color:#00ffb4;letter-spacing:2px;margin:0">KLOUDAUDIT</p>
  </div>
  <div style="padding:32px 28px">
    <h2 style="font-size:20px;font-weight:700;color:#fff;margin:0 0 16px">
      Your ${abandonedMeta.provider || 'Cloud'} audit found ${abandonedMeta.flaggedCount || 0} issues
    </h2>
    <p style="color:#94a3b8;line-height:1.6;margin:0 0 20px">
      You ran a KloudAudit audit 24 hours ago and found
      ${savingsLine} in recoverable spend. 
      The free report shows what's wrong. 
      The Blueprint shows exactly how to fix it.
    </p>
    <div style="background:#0f0f1a;border:1px solid rgba(0,255,180,0.2);border-radius:10px;padding:20px;margin-bottom:24px">
      <p style="font-size:12px;font-weight:700;color:#00ffb4;margin:0 0 12px;letter-spacing:1px">WHAT THE BLUEPRINT INCLUDES</p>
      ${['Exact CLI commands for every flagged issue',
         'Terraform snippets ready to apply',
         'Step-by-step verification commands',
         'Priority order — quick wins first',
         'Delivered to your inbox in 2 minutes'].map(f => 
        `<p style="color:#94a3b8;font-size:13px;margin:0 0 8px">✓ ${f}</p>`
      ).join('')}
    </div>
    <a href="https://www.kloudaudit.eu" 
       style="display:block;text-align:center;background:#00ffb4;color:#000;font-weight:800;font-size:15px;padding:14px;border-radius:10px;text-decoration:none;margin-bottom:16px">
      Get the Blueprint — $79 →
    </a>
    <p style="font-size:12px;color:#475569;text-align:center;margin:0">
      💚 Money-back guarantee if no actionable findings. 
      No questions asked.
    </p>
  </div>
  <div style="padding:20px 28px;border-top:1px solid rgba(255,255,255,0.06)">
    <p style="font-size:12px;color:#334155;margin:0">
      Samuel Ayodele Adomeh · Founder, KloudAudit · kloudaudit.eu
    </p>
  </div>
</div>`;

          await resend.emails.send({
            from:    'Samuel — KloudAudit <admin@kloudaudit.eu>',
            to:      [customerEmail],
            subject: `Your ${abandonedMeta.provider || 'Cloud'} audit: ${abandonedMeta.flaggedCount || 0} issues, ${savingsLine} recoverable`,
            html,
          });

          await supabaseAdmin.from('delivery_queue')
            .update({ status: 'delivered', delivered_at: new Date().toISOString() })
            .eq('id', job.id);

          results.push({ id: job.id, status: 'delivered', email: customerEmail, type: 'abandoned_audit_email' });
          processed++;
          continue;
        }

        // ── CONSULTING SESSION — send confirmation to customer + alert to admin ─
        if (isSession) {
          const chargeDisplay = meta.amount_total
            ? `${(meta.amount_total / 100).toFixed(2)} ${(meta.currency || 'usd').toUpperCase()}`
            : 'session fee';
          await Promise.all([
            resend.emails.send({
              from:    'Samuel — KloudAudit <admin@kloudaudit.eu>',
              to:      [email],
              subject: '✅ Session booked — we\'ll confirm your slot within 24hrs',
              html: `<!DOCTYPE html><html><body style="background:#07070f;font-family:system-ui;margin:0;padding:0;"><div style="max-width:600px;margin:0 auto;padding:40px 24px;"><div style="display:flex;align-items:center;gap:10px;margin-bottom:32px;"><div style="width:36px;height:36px;background:#00ffb4;border-radius:8px;font-size:18px;display:flex;align-items:center;justify-content:center;">⚡</div><span style="font-size:20px;font-weight:800;color:#fff;">KloudAudit</span></div><div style="background:linear-gradient(135deg,rgba(0,255,180,0.1),rgba(99,102,241,0.08));border:1.5px solid #00ffb4;border-radius:16px;padding:28px;margin-bottom:24px;"><p style="font-size:11px;font-weight:700;color:#00ffb4;letter-spacing:2px;text-transform:uppercase;margin:0 0 10px;">SESSION CONFIRMED</p><h1 style="font-size:26px;font-weight:800;color:#fff;margin:0 0 12px;">Payment received — session booked</h1><p style="font-size:15px;color:#94a3b8;line-height:1.7;margin:0;">Samuel will email you within 24 hours to agree on a time slot. Check <strong style="color:#fff;">admin@kloudaudit.eu</strong> — reply directly to that email to share your availability.</p></div><div style="background:#111827;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:20px 24px;margin-bottom:24px;"><p style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">What to prepare</p>${["Your cloud provider console (read-only access helpful)", "Your current monthly bill or Cost Explorer screenshot", "The specific issues you want to fix", "Any Terraform or IaC files relevant to the audit"].map(i => `<div style="display:flex;gap:10px;margin-bottom:8px;"><span style="color:#00ffb4;flex-shrink:0;">→</span><p style="font-size:13px;color:#94a3b8;margin:0;">${i}</p></div>`).join('')}</div><p style="font-size:12px;color:#374151;text-align:center;">Questions? Reply to this email · admin@kloudaudit.eu</p></div></body></html>`,
            }),
            resend.emails.send({
              from:    'KloudAudit System <admin@kloudaudit.eu>',
              to:      ['admin@kloudaudit.eu'],
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

        // bundleCacheKeys tracks keys for fresh bundle reports so we can cache after quality passes
        let bundleCacheKeys = null;
        let freshBundleReports = null;
        let singleCacheKey = null;
        let singleCacheHit = false;

        if (isBundle) {
          // Bundle: generate both reports in parallel — 2x value for the customer
          const [costKey, secKey] = [
            buildCacheKey('blueprint', meta),
            buildCacheKey('security_blueprint', meta),
          ];
          bundleCacheKeys = { costKey, secKey };
          const [cachedCost, cachedSec] = await Promise.all([
            getCachedReport(costKey, supabaseAdmin),
            getCachedReport(secKey, supabaseAdmin),
          ]);

          const [costReport, secReport] = await Promise.all([
            cachedCost ? Promise.resolve(cachedCost) : anthropic.messages.create({
              model: 'claude-sonnet-4-6', max_tokens: 2000,
              messages: [{ role: 'user', content: buildBlueprintPrompt(meta) }],
            }).then(r => r.content[0].text),
            cachedSec ? Promise.resolve(cachedSec) : anthropic.messages.create({
              model: 'claude-sonnet-4-6', max_tokens: 2000,
              messages: [{ role: 'user', content: buildSecurityPrompt(meta) }],
            }).then(r => r.content[0].text),
          ]);

          // Track which reports were freshly generated (not cached) for post-quality caching
          freshBundleReports = {
            cost: cachedCost ? null : costReport,
            sec:  cachedSec  ? null : secReport,
          };

          report = `# COST BLUEPRINT\n\n${costReport}\n\n---\n\n# SECURITY BLUEPRINT\n\n${secReport}`;
          cacheHit = !!(cachedCost && cachedSec);

        } else {
          // Single product — check cache first
          singleCacheKey = buildCacheKey(job.product_type, meta);
          report   = await getCachedReport(singleCacheKey, supabaseAdmin);
          singleCacheHit = !!report;
          cacheHit = singleCacheHit;

          if (!report) {
            console.log(`Cache miss — calling Claude for job ${job.id}`);
            const prompt = isSecur ? buildSecurityPrompt(meta) : isCfoReport ? buildCfoPrompt(meta) : isAiAudit ? buildAiPrompt(meta) : buildBlueprintPrompt(meta);
            const aiResp = await Promise.race([
              anthropic.messages.create({
                model:      'claude-sonnet-4-6',
                max_tokens: isSecur ? 2500 : 1500,
                messages:   [{ role: 'user', content: prompt }],
              }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Claude API timeout after 45s')), 45000)
              ),
            ]);
            report = aiResp.content[0].text;
            // NOTE: setCachedReport is called AFTER quality validation passes (below)
          } else {
            console.log(`Cache hit — delivering cached report for job ${job.id}`);
          }
        }

        // 3b. Validate Claude response quality before delivery
        const validationType = isBundle ? 'bundle' : isSecur ? 'security' : isCfoReport ? 'cfo_report' : isAiAudit ? 'ai_blueprint' : 'blueprint';
        const quality = validateBlueprintQuality(report, validationType);

        if (!quality.valid) {
          console.warn(JSON.stringify({
            level: 'warn', event: 'blueprint.quality_fail',
            jobId: job.id, reason: quality.reason, attempt: job.attempts,
          }));

          if (job.attempts < 2) {
            // First or second attempt — reset to pending so cron retries with a fresh Claude call
            await supabaseAdmin
              .from('delivery_queue')
              .update({
                status:        'pending',
                attempts:      job.attempts + 1,
                error_message: `Quality validation failed: ${quality.reason}`,
              })
              .eq('id', job.id);
            results.push({ id: job.id, status: 'quality_retry', reason: quality.reason });
            continue;
          }

          // Exhausted retries — deliver anyway and alert admin
          console.error(JSON.stringify({
            level: 'error', event: 'blueprint.quality_fail_final',
            jobId: job.id, reason: quality.reason,
          }));
          await resend.emails.send({
            from:    'KloudAudit System <admin@kloudaudit.eu>',
            to:      ['admin@kloudaudit.eu'],
            subject: `⚠️ Blueprint quality warning — job ${job.id}`,
            text:    `Blueprint quality validation failed after 2 attempts.\n\nJob: ${job.id}\nCustomer: ${email}\nProduct: ${job.product_type}\nReason: ${quality.reason}\n\nDelivering anyway — manual review recommended.`,
          });
          // Fall through to normal delivery below
        }

        // 3c. Cache the validated report (only after quality passes or on final retry)
        // For single products: cache the freshly generated report now that it passed quality.
        if (!cacheHit && singleCacheKey && !singleCacheHit) {
          setCachedReport(singleCacheKey, job.product_type, report, supabaseAdmin);
        }
        // For bundles: cache each fresh sub-report individually (so future single orders can hit them too)
        if (isBundle && freshBundleReports && bundleCacheKeys) {
          if (freshBundleReports.cost) setCachedReport(bundleCacheKeys.costKey, 'blueprint', freshBundleReports.cost, supabaseAdmin);
          if (freshBundleReports.sec)  setCachedReport(bundleCacheKeys.secKey, 'security_blueprint', freshBundleReports.sec, supabaseAdmin);
        }

        // 4. Build emails
        const provider     = meta.provider || 'AWS';
        const assessmentId = `KA-${isSecur ? 'SEC' : 'COST'}-${Date.now()}`;
        const chargeDisplay = meta.amount_total
          ? `${(meta.amount_total / 100).toFixed(2)} ${(meta.currency || 'pln').toUpperCase()}`
          : (isSecur ? '119 PLN' : '299 PLN');

        const customerHtml = isSecur
          ? buildSecurityEmail(report, meta, assessmentId)
          : isCfoReport
            ? buildCfoEmail(report, meta)
            : buildBlueprintEmail(report, meta);

        // 5. Send emails in parallel
        try {
          await Promise.all([
            resend.emails.send({
              from:    'Samuel — KloudAudit <admin@kloudaudit.eu>',
              to:      [email],
              subject:  isBundle
                ? `🎯 Your Cost + Security Bundle is ready — ${assessmentId}`
                : isSecur
                  ? `🛡 Your Security Blueprint is ready — ${assessmentId}`
                  : isCfoReport
                    ? `📊 Your CFO & Board Report is ready — ${assessmentId}`
                    : isAiAudit
                      ? `⚡ Your AI Cost Blueprint is ready`
                      : `⚡ Your ${provider} Cost Blueprint is ready`,
              html: customerHtml,
            }),
            resend.emails.send({
              from:    'KloudAudit System <admin@kloudaudit.eu>',
              to:      ['admin@kloudaudit.eu'],
              subject: `${isBundle ? '🎯' : isSecur ? '🛡' : isCfoReport ? '📊' : '⚡'} ${isCfoReport ? 'CFO Report' : 'Blueprint'} delivered — ${email} · ${provider} · ${chargeDisplay}`,
              text:    `Email: ${email}\nProvider: ${provider}\nProduct: ${job.product_type}\nCharge: ${chargeDisplay}\nJob ID: ${job.id}\nIssues: ${(meta.flaggedIssueLabels || '').split('||').filter(Boolean).join(', ')}`,
            }),
          ]);
        } catch (emailError) {
          console.error(JSON.stringify({
            level: 'error', event: 'delivery.email_failed',
            jobId: job.id, error: emailError.message,
          }));
          // Report already generated and cached — just retry the send,
          // don't regenerate. Mark as pending but flag that Claude
          // output already exists.
          await supabaseAdmin
            .from('delivery_queue')
            .update({
              status:        'pending',
              attempts:      job.attempts + 1,
              error_message: `Email delivery failed: ${emailError.message} (report cached, will not regenerate)`,
            })
            .eq('id', job.id);
          results.push({ id: job.id, status: 'email_retry', error: emailError.message });
          failed++;
          continue;
        }

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

        // 9. Schedule 3-day follow-up email (non-blocking, idempotent via stripe_session_id suffix)
        const followUpDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        supabaseAdmin
          .from('delivery_queue')
          .insert({
            stripe_session_id: job.stripe_session_id + '_followup',
            product_type:      'followup_email',
            email:             job.email,
            metadata: {
              original_product: job.product_type,
              provider:         meta.provider,
              flagged_count:    (meta.flaggedIssueIds || '').split(',').filter(Boolean).length,
              savings_min:      meta.savingsMin,
            },
            scheduled_for: followUpDate.toISOString(),
            status:        'pending',
          })
          .then(() => {})
          .catch(() => {}); // ignore 23505 duplicate — follow-up already scheduled

        console.log(`✅ Delivered: ${job.id} | ${email} | ${job.product_type} | cache:${cacheHit}`);
        results.push({ id: job.id, status: 'delivered', email, cacheHit });
        processed++;

      } catch (jobErr) {
        console.error(`❌ Failed job ${job.id}:`, jobErr.message);
        sentry.captureException(jobErr, { jobId: job.id, email: job.email, product: job.product_type });

        // Mark as failed (will retry on next cron run, up to MAX_ATTEMPTS)
        const isFinalAttempt = job.attempts + 1 >= MAX_ATTEMPTS;
        await supabaseAdmin
          .from('delivery_queue')
          .update({
            status:        isFinalAttempt ? 'failed' : 'pending',
            error_message: jobErr.message,
          })
          .eq('id', job.id);

        // Alert admin on final failure
        if (isFinalAttempt) {
          try {
            await resend.emails.send({
              from:    'KloudAudit Alert <admin@kloudaudit.eu>',
              to:      ['admin@kloudaudit.eu'],
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
          const unsubLink = `<p style="font-size:12px;color:#374151;text-align:center;margin:0;"><a href="https://www.kloudaudit.eu/api/audits?action=unsubscribe&email=${encodeURIComponent(fu.email)}" style="color:#374151;">Unsubscribe</a></p>`;
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

          await resend.emails.send({ from: 'Samuel — KloudAudit <admin@kloudaudit.eu>', to: [fu.email], subject, html });
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
  } catch (fatalError) {
    console.error('Fatal handler error:', fatalError.message, fatalError.stack);
    return res.status(500).json({ error: fatalError.message });
  }
};
