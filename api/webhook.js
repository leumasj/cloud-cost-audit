// api/webhook.js
// Stripe webhook → Claude AI blueprint → Premium HTML report email via SendGrid

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const sgMail = require('@sendgrid/mail');
const Anthropic = require('@anthropic-ai/sdk');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports.config = { api: { bodyParser: false } };

// ── Raw body for Stripe signature verification ─────────────────────────────
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── Claude prompt ──────────────────────────────────────────────────────────
function buildPrompt(flaggedIssues, provider, monthlyBill, companyName) {
  return `You are a senior DevOps and FinOps engineer preparing a professional implementation blueprint for ${companyName}.

Their ${provider} cloud bill is $${monthlyBill}/month. These specific issues were detected in their audit:

${flaggedIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

For EACH issue, write a numbered section with:
1. A one-sentence problem summary
2. Exact ${provider} CLI command(s) to fix it (use code blocks)
3. Terraform snippet if applicable (use code blocks)
4. How to verify the fix worked
5. Estimated monthly saving

End with a "30-Day Action Plan" section that prioritises actions by ROI.

Be specific, use ${provider}-native terminology. Use markdown. Max 1800 words.`;
}

// ── Severity style helper ──────────────────────────────────────────────────
function getSeverityStyle(index, total) {
  const third = Math.ceil(total / 3);
  if (index < third)      return { label: 'Critical',    color: '#f87171', bg: 'rgba(248,113,113,0.12)', numBg: '#1a0a0a' };
  if (index < third * 2)  return { label: 'High Impact', color: '#fb923c', bg: 'rgba(251,146,60,0.12)',  numBg: '#1a0f0a' };
  return                         { label: 'Quick Win',   color: '#00ffb4', bg: 'rgba(0,255,180,0.10)',   numBg: '#0a1a14' };
}

// ── Markdown → styled HTML ─────────────────────────────────────────────────
function renderBlueprint(markdown) {
  return markdown
    .replace(/^# (.+)$/gm,    '<h2 style="font-family:\'Bricolage Grotesque\',Arial,sans-serif;color:#00ffb4;font-size:18px;font-weight:800;border-bottom:2px solid rgba(0,255,180,0.3);padding-bottom:10px;margin:32px 0 14px;letter-spacing:-0.3px">$1</h2>')
    .replace(/^## (.+)$/gm,   '<h3 style="font-family:\'Bricolage Grotesque\',Arial,sans-serif;color:#e2e8f0;font-size:15px;font-weight:700;margin:22px 0 8px">$1</h3>')
    .replace(/^### (.+)$/gm,  '<h4 style="font-family:\'Bricolage Grotesque\',Arial,sans-serif;color:#94a3b8;font-size:13px;font-weight:700;margin:14px 0 6px;text-transform:uppercase;letter-spacing:0.5px">$1</h4>')
    .replace(/\*\*(.+?)\*\*/g,'<strong style="color:#e2e8f0">$1</strong>')
    .replace(/```[\w]*\n?([\s\S]*?)```/gm, '<pre style="background:#0d0d1a;color:#4ade80;padding:16px 18px;border-radius:10px;font-family:\'DM Mono\',\'Courier New\',monospace;font-size:12px;line-height:1.7;margin:12px 0;white-space:pre-wrap;border:1px solid rgba(0,255,180,0.15);overflow-x:auto">$1</pre>')
    .replace(/^(aws |gcloud |az |terraform |kubectl |helm ).+$/gm, '<pre style="background:#0d0d1a;color:#4ade80;padding:10px 16px;border-radius:8px;font-family:\'DM Mono\',\'Courier New\',monospace;font-size:12px;margin:8px 0;white-space:pre-wrap;border:1px solid rgba(0,255,180,0.15)">$&</pre>')
    .replace(/`([^`]+)`/g,    '<code style="background:#12121f;color:#818cf8;padding:2px 7px;border-radius:5px;font-family:\'DM Mono\',\'Courier New\',monospace;font-size:12px;border:1px solid rgba(255,255,255,0.08)">$1</code>')
    .replace(/^[-*] (.+)$/gm, '<li style="color:#94a3b8;font-size:14px;line-height:1.8;margin-bottom:6px;padding-left:4px">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li style="color:#94a3b8;font-size:14px;line-height:1.8;margin-bottom:8px"><strong style="color:#e2e8f0;font-family:\'Bricolage Grotesque\',Arial">$1.</strong> $2</li>')
    .replace(/\n\n/g, '</p><p style="color:#94a3b8;font-size:14px;line-height:1.75;margin:10px 0">')
    .replace(/\n/g, '<br>');
}

// ── Main email / report builder ────────────────────────────────────────────
function buildEmailHTML(companyName, provider, monthlyBill, savingsMin, savingsMax, flaggedIssues, blueprint) {
  const bill      = Number(monthlyBill);
  const savMin    = Number(savingsMin);
  const savMax    = Number(savingsMax);
  const savPct    = bill > 0 ? Math.round(((savMin + savMax) / 2 / bill) * 100) : 0;
  const annualMin = (savMin * 12).toLocaleString();
  const today     = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const wasteColor = savPct >= 30 ? '#f87171' : savPct >= 15 ? '#fb923c' : '#fbbf24';

  // ── Finding cards ──────────────────────────────────────────────────────
  const findingCards = flaggedIssues.map((issue, i) => {
    const sev    = getSeverityStyle(i, flaggedIssues.length);
    const isMin  = bill > 0 ? Math.round((savMin / flaggedIssues.length)) : 0;
    const isMax  = bill > 0 ? Math.round((savMax / flaggedIssues.length)) : 0;
    return `
    <div style="background:#0d0d1a;border:1px solid rgba(255,255,255,0.08);border-radius:14px;margin-bottom:12px;overflow:hidden;">
      <div style="display:flex;align-items:stretch;">
        <div style="background:${sev.numBg};color:${sev.color};font-family:'Bricolage Grotesque',Arial,sans-serif;font-weight:800;font-size:16px;width:52px;min-width:52px;display:flex;align-items:center;justify-content:center;border-right:1px solid rgba(255,255,255,0.08);padding:18px 0;">
          ${i + 1}
        </div>
        <div style="padding:18px 20px;flex:1;">
          <div style="font-weight:700;font-size:15px;color:#fff;margin-bottom:5px;font-family:'Bricolage Grotesque',Arial,sans-serif;">${issue}</div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px;">
            <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:6px;background:${sev.bg};color:${sev.color}">${sev.label}</span>
            <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:6px;background:rgba(255,255,255,0.06);color:#94a3b8">See guide below for fix</span>
            ${bill > 0 ? `<span style="font-family:'DM Mono','Courier New',monospace;font-size:13px;font-weight:500;color:#00ffb4;background:rgba(0,255,180,0.1);border:1px solid rgba(0,255,180,0.25);border-radius:6px;padding:3px 10px;margin-left:auto;">$${isMin.toLocaleString()} – $${isMax.toLocaleString()} / mo</span>` : ''}
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  // ── Savings summary table (auto-grouped by category) ───────────────────
  const categoryMap = {};
  flaggedIssues.forEach(issue => {
    const l = issue.toLowerCase();
    const key =
      /instance|vm|spot|reserv|compute|sizing|ec2|generation/.test(l) ? 'Compute' :
      /storage|s3|snapshot|disk|blob|tier|volume|backup/.test(l)       ? 'Storage' :
      /database|rds|sql|cache|dynamo|redis/.test(l)                    ? 'Database' :
      /network|nat|egress|transfer|load.?balance|cdn|ip|bandwidth/.test(l) ? 'Networking' :
      'Governance';
    if (!categoryMap[key]) categoryMap[key] = 0;
    categoryMap[key]++;
  });

  const tableRows = Object.entries(categoryMap).map(([cat, count]) => {
    const rMin = bill > 0 ? Math.round((savMin / flaggedIssues.length) * count) : 0;
    const rMax = bill > 0 ? Math.round((savMax / flaggedIssues.length) * count) : 0;
    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
      <td style="padding:12px 16px;font-size:14px;color:#e2e8f0;">${cat}</td>
      <td style="padding:12px 16px;font-size:14px;color:#00ffb4;font-family:'DM Mono','Courier New',monospace;text-align:center;">$${rMin.toLocaleString()}</td>
      <td style="padding:12px 16px;font-size:14px;color:#00ffb4;font-family:'DM Mono','Courier New',monospace;text-align:center;">$${rMax.toLocaleString()}</td>
      <td style="padding:12px 16px;font-size:14px;color:#94a3b8;text-align:center;">${count} issue${count > 1 ? 's' : ''}</td>
    </tr>`;
  }).join('');

  const renderedBlueprint = renderBlueprint(blueprint);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Cloud Cost Optimisation Report — ${companyName}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'DM Sans',Arial,sans-serif; background:#080810; color:#e2e8f0; line-height:1.6; }
  body::before {
    content:''; position:fixed; inset:0; z-index:0; pointer-events:none;
    background:
      radial-gradient(ellipse 80% 50% at 10% -10%,rgba(0,255,180,0.06) 0%,transparent 60%),
      radial-gradient(ellipse 60% 50% at 90% 110%,rgba(99,102,241,0.07) 0%,transparent 60%),
      linear-gradient(rgba(255,255,255,0.02) 1px,transparent 1px),
      linear-gradient(90deg,rgba(255,255,255,0.02) 1px,transparent 1px);
    background-size:auto,auto,48px 48px,48px 48px;
  }
  .print-bar { position:fixed;top:0;left:0;right:0;z-index:100;background:rgba(8,8,16,0.92);backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,0.08);padding:10px 32px;display:flex;align-items:center;justify-content:space-between; }
  .logo { font-family:'Bricolage Grotesque',Arial,sans-serif;font-weight:800;font-size:15px;color:#fff;display:flex;align-items:center;gap:10px; }
  .logo-icon { width:28px;height:28px;background:#00ffb4;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 0 14px rgba(0,255,180,0.4); }
  .print-btn { background:#00ffb4;color:#000;border:none;border-radius:8px;padding:8px 20px;font-family:'Bricolage Grotesque',Arial,sans-serif;font-weight:700;font-size:13px;cursor:pointer;transition:all 0.2s; }
  .print-btn:hover { box-shadow:0 0 20px rgba(0,255,180,0.4);transform:translateY(-1px); }
  .wrap { position:relative;z-index:1;max-width:1000px;margin:0 auto;padding:88px 32px 80px; }
  .section { margin-bottom:36px; }
  .section-title { font-family:'Bricolage Grotesque',Arial,sans-serif;font-size:13px;font-weight:700;color:#00ffb4;letter-spacing:2px;text-transform:uppercase;margin-bottom:16px;display:flex;align-items:center;gap:10px; }
  .section-title::after { content:'';flex:1;height:1px;background:rgba(255,255,255,0.08); }
  .kpi-grid { display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:28px; }
  .sum-table { width:100%;border-collapse:collapse; }
  .sum-table th { background:#0f172a;color:#fff;font-family:'Bricolage Grotesque',Arial,sans-serif;font-size:12px;font-weight:700;padding:12px 16px;text-align:left;letter-spacing:0.5px; }
  .sum-table th:not(:first-child) { text-align:center; }
  .sum-table tr:last-child td { background:#0f172a;color:#00ffb4;font-family:'Bricolage Grotesque',Arial,sans-serif;font-weight:800;font-size:15px; }
  .consultant-card { display:grid;grid-template-columns:1fr 1fr;background:#0d0d1a;border:1px solid rgba(0,255,180,0.25);border-radius:16px;overflow:hidden; }
  .conf-footer { text-align:center;padding:28px 0 0;font-size:12px;color:#64748b;border-top:1px solid rgba(255,255,255,0.08);margin-top:48px; }
  @media print {
    body { background:#fff !important; color:#000 !important; }
    body::before { display:none; }
    .print-bar { display:none !important; }
    .wrap { padding:20px;max-width:100%; }
    * { -webkit-print-color-adjust:exact;print-color-adjust:exact; }
  }
  @media (max-width:700px) {
    .kpi-grid { grid-template-columns:1fr 1fr; }
    .consultant-card { grid-template-columns:1fr; }
    .wrap { padding:72px 18px 60px; }
  }
</style>
</head>
<body>

<div class="print-bar">
  <div class="logo"><div class="logo-icon">⚡</div>KloudAudit</div>
  <button class="print-btn" onclick="window.print()">🖨 Export PDF</button>
</div>

<div class="wrap">

  <!-- HEADER -->
  <div style="background:#0d0d1a;border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:48px;margin-bottom:28px;position:relative;overflow:hidden;">
    <div style="position:absolute;top:-60px;right:-60px;width:240px;height:240px;background:radial-gradient(circle,rgba(0,255,180,0.1) 0%,transparent 70%);border-radius:50%;pointer-events:none;"></div>
    <div style="display:inline-flex;align-items:center;gap:8px;background:rgba(0,255,180,0.1);border:1px solid rgba(0,255,180,0.25);border-radius:20px;padding:5px 14px;margin-bottom:20px;">
      <span style="width:6px;height:6px;background:#00ffb4;border-radius:50%;box-shadow:0 0 8px #00ffb4;display:inline-block;"></span>
      <span style="font-size:11px;color:#00ffb4;font-weight:700;letter-spacing:1.5px;">CLOUD COST OPTIMISATION REPORT · CONFIDENTIAL</span>
    </div>
    <div style="font-family:'Bricolage Grotesque',Arial,sans-serif;font-size:clamp(28px,4vw,46px);font-weight:800;letter-spacing:-1.5px;color:#fff;line-height:1.1;margin-bottom:12px;">
      ${companyName}<br><span style="color:#00ffb4;">Cost Audit Findings</span>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:20px;">
      <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:6px 14px;font-size:13px;color:#94a3b8;"><strong style="color:#fff">Provider:</strong> ${provider}</div>
      <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:6px 14px;font-size:13px;color:#94a3b8;"><strong style="color:#fff">Monthly Bill:</strong> $${Number(monthlyBill).toLocaleString()}</div>
      <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:6px 14px;font-size:13px;color:#94a3b8;"><strong style="color:#fff">Date:</strong> ${today}</div>
      <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:6px 14px;font-size:13px;color:#94a3b8;"><strong style="color:#fff">Issues Found:</strong> ${flaggedIssues.length}</div>
      <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:6px 14px;font-size:13px;color:#94a3b8;"><strong style="color:#fff">Prepared by:</strong> Samuel Ayodele Adomeh · KloudAudit.eu</div>
    </div>
  </div>

  <!-- KPI CARDS -->
  <div class="kpi-grid">
    <div style="background:rgba(0,255,180,0.06);border:1px solid rgba(0,255,180,0.2);border-radius:14px;padding:24px 20px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#64748b;margin-bottom:10px;">Monthly Savings</div>
      <div style="font-family:'Bricolage Grotesque',Arial,sans-serif;font-size:26px;font-weight:800;letter-spacing:-1px;color:#00ffb4;line-height:1;margin-bottom:5px;">$${savMin.toLocaleString()}–$${savMax.toLocaleString()}</div>
      <div style="font-size:12px;color:#64748b;">estimated per month</div>
    </div>
    <div style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:14px;padding:24px 20px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#64748b;margin-bottom:10px;">Annual Opportunity</div>
      <div style="font-family:'Bricolage Grotesque',Arial,sans-serif;font-size:26px;font-weight:800;letter-spacing:-1px;color:#818cf8;line-height:1;margin-bottom:5px;">$${annualMin}+</div>
      <div style="font-size:12px;color:#64748b;">projected per year</div>
    </div>
    <div style="background:rgba(248,113,113,0.06);border:1px solid rgba(248,113,113,0.2);border-radius:14px;padding:24px 20px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#64748b;margin-bottom:10px;">Waste Rate</div>
      <div style="font-family:'Bricolage Grotesque',Arial,sans-serif;font-size:26px;font-weight:800;letter-spacing:-1px;color:${wasteColor};line-height:1;margin-bottom:5px;">~${savPct}%</div>
      <div style="font-size:12px;color:#64748b;">of current monthly bill</div>
    </div>
    <div style="background:rgba(251,146,60,0.06);border:1px solid rgba(251,146,60,0.2);border-radius:14px;padding:24px 20px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#64748b;margin-bottom:10px;">Issues Found</div>
      <div style="font-family:'Bricolage Grotesque',Arial,sans-serif;font-size:26px;font-weight:800;letter-spacing:-1px;color:#fb923c;line-height:1;margin-bottom:5px;">${flaggedIssues.length}</div>
      <div style="font-size:12px;color:#64748b;">across all categories</div>
    </div>
  </div>

  <!-- FINDINGS -->
  <div class="section">
    <div class="section-title">Findings &amp; Savings Breakdown</div>
    ${findingCards}
  </div>

  <!-- SAVINGS TABLE -->
  <div class="section">
    <div class="section-title">Savings Summary by Category</div>
    <div style="background:#0d0d1a;border:1px solid rgba(255,255,255,0.08);border-radius:14px;overflow:hidden;">
      <table class="sum-table">
        <thead>
          <tr>
            <th>Category</th>
            <th style="text-align:center;">Min / Month</th>
            <th style="text-align:center;">Max / Month</th>
            <th style="text-align:center;">Issues</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
          <tr>
            <td style="padding:14px 16px;">Total Projected Savings</td>
            <td style="padding:14px 16px;text-align:center;font-family:'DM Mono','Courier New',monospace;">$${savMin.toLocaleString()} / mo</td>
            <td style="padding:14px 16px;text-align:center;font-family:'DM Mono','Courier New',monospace;">$${savMax.toLocaleString()} / mo</td>
            <td style="padding:14px 16px;text-align:center;font-family:'DM Mono','Courier New',monospace;">~$${annualMin} / yr</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- AI BLUEPRINT -->
  <div class="section">
    <div class="section-title">AI Implementation Blueprint</div>
    <div style="background:#0d0d1a;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:36px 40px;">
      <p style="color:#94a3b8;font-size:14px;line-height:1.75;margin:10px 0">${renderedBlueprint}</p>
    </div>
  </div>

  <!-- CONSULTANT -->
  <div class="section">
    <div class="section-title">Prepared By</div>
    <div class="consultant-card">
      <div style="background:#0f172a;padding:32px;">
        <div style="width:56px;height:56px;background:linear-gradient(135deg,#00ffb4,#00d4ff);border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Bricolage Grotesque',Arial,sans-serif;font-weight:800;font-size:20px;color:#000;margin-bottom:16px;">SA</div>
        <div style="font-family:'Bricolage Grotesque',Arial,sans-serif;font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px;margin-bottom:6px;">Samuel Ayodele Adomeh</div>
        <div style="font-size:13px;color:#00ffb4;margin-bottom:3px;">✓ Certified Azure Architect Expert</div>
        <div style="font-size:13px;color:#00ffb4;margin-bottom:3px;">✓ Certified Azure DevOps Expert</div>
        <div style="font-size:13px;color:#00ffb4;margin-bottom:3px;">✓ Kubernetes · Terraform · Docker</div>
        <div style="font-size:13px;color:#64748b;margin-top:8px;">📍 Wrocław, Poland · Remote Worldwide</div>
      </div>
      <div style="padding:32px;">
        <a href="https://kloudaudit.eu" style="display:flex;align-items:center;gap:8px;font-size:14px;color:#94a3b8;margin-bottom:10px;text-decoration:none;">🌐 kloudaudit.eu</a>
        <a href="https://www.linkedin.com/in/samuel-ayodele-adomeh" style="display:flex;align-items:center;gap:8px;font-size:14px;color:#94a3b8;margin-bottom:10px;text-decoration:none;">💼 linkedin.com/in/samuel-ayodele-adomeh</a>
        <a href="https://github.com/leumasj" style="display:flex;align-items:center;gap:8px;font-size:14px;color:#94a3b8;margin-bottom:10px;text-decoration:none;">💻 github.com/leumasj</a>
        <div style="margin-top:20px;background:rgba(0,255,180,0.1);border:1px solid rgba(0,255,180,0.25);border-radius:10px;padding:14px 18px;">
          <p style="font-size:13px;color:#64748b;margin-bottom:4px;">Need hands-on help implementing these savings?</p>
          <strong style="font-family:'Bricolage Grotesque',Arial,sans-serif;font-size:16px;color:#00ffb4;">Implementation sessions from 999 PLN</strong>
          <p style="margin-top:6px;font-size:12px;color:#64748b;">Remote · Delivered within 48hrs · Full documentation included</p>
        </div>
      </div>
    </div>
  </div>

  <div class="conf-footer">
    This report is confidential and prepared exclusively for ${companyName} · KloudAudit.eu © ${new Date().getFullYear()}<br>
    All savings estimates are conservative projections based on industry benchmarks. Actual results may vary.
  </div>

</div>
</body>
</html>`;
}

// ── Webhook handler ────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe sig error:', err.message);
    return res.status(400).json({ error: err.message });
  }

  if (event.type !== 'checkout.session.completed') return res.status(200).json({ received: true });

  const session = event.data.object;
  const meta = session.metadata || {};
  const email              = meta.email || session.customer_email;
  const provider           = meta.provider || 'AWS';
  const monthlyBill        = meta.monthlyBill || '0';
  const companyName        = meta.companyName || 'Your Company';
  const savingsMin         = meta.savingsMin || '0';
  const savingsMax         = meta.savingsMax || '0';
  const flaggedIssueLabels = (meta.flaggedIssueLabels || '').split('||').filter(Boolean);

  console.log(`Processing: ${email} | ${provider} | ${flaggedIssueLabels.length} issues`);
  if (!email) return res.status(400).json({ error: 'No email' });

  try {
    // Generate AI blueprint
    const aiResp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: buildPrompt(flaggedIssueLabels, provider, monthlyBill, companyName) }],
    });
    const blueprint = aiResp.content[0].text;
    console.log('Blueprint generated:', blueprint.length, 'chars');

    // Build premium HTML report
    const reportHTML = buildEmailHTML(
      companyName, provider, monthlyBill,
      savingsMin, savingsMax,
      flaggedIssueLabels, blueprint
    );

    // Deliver to customer
    await sgMail.send({
      to: email,
      from: { email: 'admin@kloudaudit.eu', name: 'Samuel @ KloudAudit' },
      replyTo: 'admin@kloudaudit.eu',
      subject: `Your ${provider} Implementation Blueprint is ready ⚡`,
      html: reportHTML,
    });

    // Notify yourself
    await sgMail.send({
      to: 'admin@kloudaudit.eu',
      from: { email: 'admin@kloudaudit.eu', name: 'KloudAudit System' },
      subject: `✅ Blueprint sold — ${companyName} · ${provider} · 299 PLN`,
      text: `Delivered to: ${email}\nCompany: ${companyName}\nProvider: ${provider}\nBill: $${monthlyBill}/mo\nSavings: $${savingsMin}–$${savingsMax}/mo\nIssues (${flaggedIssueLabels.length}): ${flaggedIssueLabels.join(', ')}`,
    });

    console.log('✅ Done:', email);
    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Error:', err.message);
    try {
      await sgMail.send({
        to: 'admin@kloudaudit.eu',
        from: { email: 'admin@kloudaudit.eu', name: 'KloudAudit System' },
        subject: `⚠️ Blueprint FAILED — ${email}`,
        text: `Error: ${err.message}\nEmail: ${email}\nProvider: ${provider}\nIssues: ${flaggedIssueLabels.join(', ')}`,
      });
    } catch(e) {}
    return res.status(500).json({ error: err.message });
  }
};
