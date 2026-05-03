// api/unsubscribe.js
// KloudAudit — One-click unsubscribe for re-audit reminder emails
// Required for CAN-SPAM and GDPR compliance.
// Called via GET link in the re-audit email footer.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async function handler(req, res) {
  const email = req.query.email;

  if (!email) {
    return res.status(400).send(`
      <html><body style="font-family:system-ui;text-align:center;padding:60px;background:#07070f;color:#fff;">
        <h2>Invalid unsubscribe link</h2>
        <p style="color:#94a3b8;">Please contact admin@kloudaudit.eu to unsubscribe manually.</p>
      </body></html>
    `);
  }

  try {
    await supabase
      .from('subscribers')
      .update({ unsubscribed: true, unsubscribed_at: new Date().toISOString() })
      .eq('email', email);

    // Return a clean confirmation page — no redirect needed
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><title>Unsubscribed — KloudAudit</title></head>
      <body style="margin:0;padding:0;background:#07070f;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
        <div style="text-align:center;max-width:400px;padding:40px 24px;">
          <div style="width:48px;height:48px;background:#00ffb4;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;margin:0 auto 24px;">⚡</div>
          <h1 style="font-size:22px;font-weight:800;color:#fff;margin:0 0 10px;">You're unsubscribed</h1>
          <p style="font-size:14px;color:#94a3b8;line-height:1.6;margin:0 0 24px;">
            We've removed <strong style="color:#fff;">${email}</strong> from re-audit reminders.
            You won't receive any more emails from us.
          </p>
          <p style="font-size:13px;color:#475569;">
            The free audit at <a href="https://www.kloudaudit.eu" style="color:#00ffb4;text-decoration:none;">kloudaudit.eu</a> is always available if you want to check your cloud costs.
          </p>
        </div>
      </body>
      </html>
    `);

  } catch (err) {
    console.error('unsubscribe error:', err.message);
    return res.status(500).send(`
      <html><body style="font-family:system-ui;text-align:center;padding:60px;background:#07070f;color:#fff;">
        <h2 style="color:#f87171;">Something went wrong</h2>
        <p style="color:#94a3b8;">Please email admin@kloudaudit.eu to unsubscribe manually.</p>
      </body></html>
    `);
  }
};
