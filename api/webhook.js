// api/webhook.js — FIXED VERSION
// Fix 1: module.exports instead of export default
// Fix 2: Removed pdfkit (unsupported in Vercel serverless)
// Fix 3: Blueprint delivered as rich HTML email inline

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const sgMail = require('@sendgrid/mail');
const Anthropic = require('@anthropic-ai/sdk');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports.config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function buildPrompt(flaggedIssues, provider, monthlyBill, companyName) {
  return `You are a senior DevOps and FinOps engineer. Write a complete implementation guide for ${companyName}.

Their ${provider} cloud bill is $${monthlyBill}/month. These specific issues were detected:

${flaggedIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

Write a step-by-step technical guide to fix ALL of these issues. For each issue include:
- The exact problem explanation
- The fix with exact CLI commands for ${provider}
- A Terraform snippet if applicable
- How to verify it worked
- Estimated monthly saving

Be specific and practical. Use markdown headers. Max 1800 words.`;
}

function buildEmailHTML(companyName, provider, monthlyBill, savingsMin, savingsMax, flaggedIssues, blueprint) {
  const savMin = Number(savingsMin).toLocaleString();
  const savMax = Number(savingsMax).toLocaleString();
  const annualMin = (Number(savingsMin) * 12).toLocaleString();

  const formatted = blueprint
    .replace(/^# (.+)$/gm, '<h2 style="color:#00c896;font-size:18px;font-family:Arial;border-bottom:2px solid #00c896;padding-bottom:8px;margin:28px 0 12px">$1</h2>')
    .replace(/^## (.+)$/gm, '<h3 style="color:#0f172a;font-size:15px;font-family:Arial;margin:18px 0 8px;font-weight:700">$1</h3>')
    .replace(/^### (.+)$/gm, '<h4 style="color:#1e40af;font-size:13px;font-family:Arial;margin:12px 0 6px;font-weight:700">$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^(```[\w]*\n?)([\s\S]*?)```/gm, '<pre style="background:#1e293b;color:#4ade80;padding:14px;border-radius:8px;font-family:Courier New,monospace;font-size:12px;overflow-x:auto;margin:10px 0;white-space:pre-wrap">$2</pre>')
    .replace(/^(aws |gcloud |az |terraform |kubectl ).+$/gm, '<pre style="background:#1e293b;color:#4ade80;padding:10px 14px;border-radius:6px;font-family:Courier New,monospace;font-size:12px;margin:8px 0;white-space:pre-wrap">$&</pre>')
    .replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-family:Courier New,monospace;font-size:12px;color:#1e40af">$1</code>')
    .replace(/^[-*] (.+)$/gm, '<li style="color:#475569;font-size:14px;line-height:1.8;margin-bottom:5px">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li style="color:#475569;font-size:14px;line-height:1.8;margin-bottom:5px"><strong>$1.</strong> $2</li>')
    .replace(/\n\n/g, '</p><p style="color:#475569;font-size:14px;line-height:1.75;margin:10px 0">')
    .replace(/\n/g, '<br>');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif">
<div style="max-width:700px;margin:0 auto;background:#fff">
  <div style="background:#0a0a14;padding:36px 40px;text-align:center">
    <div style="display:inline-block;background:#00ffb4;border-radius:8px;padding:6px 16px;margin-bottom:14px"><span style="color:#000;font-weight:800;font-size:13px;letter-spacing:2px">⚡ KLOUDAUDIT</span></div>
    <h1 style="color:#fff;font-size:26px;font-weight:800;margin:0 0 8px">Your AI Blueprint is Ready</h1>
    <p style="color:#64748b;font-size:14px;margin:0">${provider} Implementation Guide · ${flaggedIssues.length} Issues Covered</p>
  </div>
  <div style="background:#f0fdf9;border-top:3px solid #00c896;border-bottom:3px solid #00c896;padding:24px 40px;text-align:center">
    <p style="color:#64748b;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px">ESTIMATED MONTHLY SAVINGS</p>
    <p style="color:#00c896;font-size:36px;font-weight:800;margin:0;letter-spacing:-1px">$${savMin} – $${savMax} / month</p>
    <p style="color:#64748b;font-size:13px;margin:6px 0 0">Annual: $${annualMin}+</p>
  </div>
  <div style="padding:28px 40px;border-bottom:1px solid #e2e8f0">
    <p style="font-size:15px;font-weight:700;color:#0f172a;margin:0 0 12px">Issues addressed:</p>
    <ul style="margin:0;padding:0 0 0 20px">${flaggedIssues.map(i => `<li style="color:#475569;font-size:14px;line-height:1.8">${i}</li>`).join('')}</ul>
  </div>
  <div style="padding:32px 40px">
    <p style="color:#00c896;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 20px">YOUR IMPLEMENTATION GUIDE</p>
    <div><p style="color:#475569;font-size:14px;line-height:1.75;margin:10px 0">${formatted}</p></div>
  </div>
  <div style="padding:28px 40px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center">
    <p style="color:#475569;font-size:14px;margin:0 0 18px">Questions? Reply to this email — I personally respond.</p>
    <a href="https://kloudaudit.eu" style="background:#00ffb4;color:#000;font-weight:800;font-size:15px;padding:13px 30px;border-radius:10px;text-decoration:none;display:inline-block">Run Another Audit →</a>
  </div>
  <div style="background:#0a0a14;padding:22px 40px;text-align:center">
    <p style="color:#94a3b8;font-size:12px;margin:0 0 4px">Samuel Ayodele Adomeh · Senior DevOps Engineer</p>
    <p style="margin:0"><a href="https://kloudaudit.eu" style="color:#00c896;text-decoration:none;font-size:12px">kloudaudit.eu</a> &nbsp;·&nbsp; <a href="mailto:admin@kloudaudit.eu" style="color:#00c896;text-decoration:none;font-size:12px">admin@kloudaudit.eu</a></p>
  </div>
</div></body></html>`;
}

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
  const email = meta.email || session.customer_email;
  const provider = meta.provider || 'AWS';
  const monthlyBill = meta.monthlyBill || '0';
  const companyName = meta.companyName || 'Your Company';
  const savingsMin = meta.savingsMin || '0';
  const savingsMax = meta.savingsMax || '0';
  const flaggedIssueLabels = (meta.flaggedIssueLabels || '').split('||').filter(Boolean);

  console.log(`Processing: ${email} | ${provider} | ${flaggedIssueLabels.length} issues`);

  if (!email) return res.status(400).json({ error: 'No email' });

  try {
    const aiResp = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: buildPrompt(flaggedIssueLabels, provider, monthlyBill, companyName) }],
    });
    const blueprint = aiResp.content[0].text;
    console.log('AI done:', blueprint.length, 'chars');

    await sgMail.send({
      to: email,
      from: { email: 'admin@kloudaudit.eu', name: 'Samuel @ KloudAudit' },
      replyTo: 'admin@kloudaudit.eu',
      subject: `Your ${provider} Implementation Blueprint is ready ⚡`,
      html: buildEmailHTML(companyName, provider, monthlyBill, savingsMin, savingsMax, flaggedIssueLabels, blueprint),
    });

    await sgMail.send({
      to: 'admin@kloudaudit.eu',
      from: { email: 'admin@kloudaudit.eu', name: 'KloudAudit System' },
      subject: `✅ Blueprint sold — ${companyName} · ${provider} · 299 PLN`,
      text: `Delivered to: ${email}\nCompany: ${companyName}\nProvider: ${provider}\nBill: $${monthlyBill}/mo\nSavings: $${savingsMin}–$${savingsMax}/mo\nIssues: ${flaggedIssueLabels.join(', ')}`,
    });

    console.log('✅ Done:', email);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error:', err.message);
    try { await sgMail.send({ to: 'admin@kloudaudit.eu', from: { email: 'admin@kloudaudit.eu', name: 'KloudAudit System' }, subject: `⚠️ Blueprint FAILED — ${email}`, text: `Error: ${err.message}\nEmail: ${email}\nProvider: ${provider}` }); } catch(e) {}
    return res.status(500).json({ error: err.message });
  }
};
