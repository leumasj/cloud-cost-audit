// api/send-report.js
// Sends the free audit report summary to the user's email via SendGrid

const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      email, provider, monthlyBill,
      savingsMin, savingsMax, savPct,
      flaggedCount, flaggedIssues = [],
      companyName,
    } = req.body;

    if (!email) return res.status(400).json({ error: 'Email required' });

    const issuesList = flaggedIssues.length > 0
      ? flaggedIssues.map(label => `<li style="margin-bottom:8px;color:#cbd5e1;">${label}</li>`).join('')
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
      <p style="font-size:11px;font-weight:700;color:#00ffb4;letter-spacing:2px;text-transform:uppercase;margin:0 0 12px;">Your ${provider || 'Cloud'} Audit Results</p>
      <div style="font-size:48px;font-weight:800;color:#00ffb4;letter-spacing:-2px;line-height:1;margin-bottom:8px;">
        $${Number(savingsMin).toLocaleString()}–$${Number(savingsMax).toLocaleString()}
      </div>
      <p style="font-size:15px;color:#94a3b8;margin:0;">estimated monthly savings · <strong style="color:#f8fafc;">${flaggedCount} issues found</strong></p>
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
      <p style="font-size:13px;color:#94a3b8;margin:0 0 20px;">The AI Blueprint generates step-by-step fix instructions personalised to your ${provider || 'cloud'} setup — delivered to your inbox in minutes.</p>
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
      sgMail.send({
        to: email,
        from: { email: 'admin@kloudaudit.eu', name: 'Samuel @ KloudAudit' },
        replyTo: 'admin@kloudaudit.eu',
        subject: `Your ${provider || 'Cloud'} Audit Report — $${Number(savingsMin).toLocaleString()}–$${Number(savingsMax).toLocaleString()}/mo found`,
        html,
      }),
      // Notify admin
      sgMail.send({
        to: 'admin@kloudaudit.eu',
        from: { email: 'admin@kloudaudit.eu', name: 'KloudAudit System' },
        subject: `📬 Free report requested — ${email} · ${provider} · $${Number(savingsMin).toLocaleString()}–$${Number(savingsMax).toLocaleString()}/mo`,
        text: `Email: ${email}\nProvider: ${provider}\nBill: $${monthlyBill}/mo\nSavings: $${savingsMin}–$${savingsMax}/mo\nIssues: ${flaggedCount}\n${flaggedIssues.join(', ')}`,
      }),
    ]);

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Send report error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
