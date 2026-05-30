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

  // POST from the self-serve form below
  if (req.method === 'POST') {
    const body = await new Promise(resolve => {
      let d = '';
      req.on('data', c => d += c);
      req.on('end', () => resolve(d));
    });
    const params = new URLSearchParams(body);
    const formEmail = params.get('email');
    if (formEmail) {
      await supabase.from('subscribers').update({ unsubscribed: true, unsubscribed_at: new Date().toISOString() }).eq('email', formEmail).catch(() => null);
      return res.status(200).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Unsubscribed</title></head><body style="margin:0;background:#07070f;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;"><div style="text-align:center;max-width:400px;padding:40px 24px;"><div style="width:48px;height:48px;background:#00ffb4;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;margin:0 auto 24px;">⚡</div><h1 style="font-size:22px;font-weight:800;color:#fff;margin:0 0 10px;">You're unsubscribed</h1><p style="font-size:14px;color:#94a3b8;line-height:1.6;margin:0 0 24px;">We've removed <strong style="color:#fff;">${formEmail}</strong> from all KloudAudit emails.</p><a href="https://www.kloudaudit.eu" style="color:#00ffb4;text-decoration:none;font-size:13px;">← Back to KloudAudit</a></div></body></html>`);
    }
  }

  if (!email) {
    return res.status(200).send(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Unsubscribe — KloudAudit</title></head>
<body style="margin:0;padding:0;background:#07070f;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
  <div style="text-align:center;max-width:420px;width:100%;padding:40px 24px;">
    <div style="width:48px;height:48px;background:#00ffb4;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;margin:0 auto 24px;">⚡</div>
    <h1 style="font-size:22px;font-weight:800;color:#fff;margin:0 0 10px;">Unsubscribe from KloudAudit</h1>
    <p style="font-size:14px;color:#94a3b8;line-height:1.6;margin:0 0 28px;">Enter your email below to stop receiving re-audit reminders and updates.</p>
    <form method="POST" action="/api/unsubscribe" style="display:flex;flex-direction:column;gap:14px;">
      <input type="email" name="email" required placeholder="you@company.com"
        style="width:100%;padding:14px 16px;background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.15);border-radius:10px;color:#fff;font-size:15px;outline:none;box-sizing:border-box;" />
      <button type="submit"
        style="width:100%;padding:14px;border-radius:10px;border:none;background:#00ffb4;color:#000;font-weight:800;font-size:15px;cursor:pointer;">
        Unsubscribe
      </button>
    </form>
    <p style="font-size:12px;color:#475569;margin-top:20px;">Or email <a href="mailto:admin@kloudaudit.eu" style="color:#00ffb4;text-decoration:none;">admin@kloudaudit.eu</a> to unsubscribe manually.</p>
  </div>
</body>
</html>`);
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
