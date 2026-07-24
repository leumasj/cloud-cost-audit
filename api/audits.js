// api/audits.js
// KloudAudit — Unified Audits Endpoint (consolidates multiple operations)
// Handles: save, share, score calculation, leaderboard opt-in
// Reduces API count for Vercel free tier (12 function limit)

const { createClient } = require('@supabase/supabase-js');
const sentry = require('./lib/_sentry');
const { SaveAuditSchema, validate } = require('./lib/_validation');
const { checkRateLimit } = require('./lib/_ratelimit');
const { calculateScores } = require('./lib/_scoring');

module.exports = async function handler(req, res) {
  // Create Supabase client inside handler to avoid early connection
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );
  // CORS
  const { ALLOWED_ORIGINS } = require('./lib/_config');
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET is used for session retrieval and unsubscribe links
  if (req.method === 'GET') {
    const { action: getAction } = req.query;
    if (getAction === 'get-session') return await handleGetSession(req, res, supabase);
    if (getAction === 'unsubscribe') return await handleUnsubscribe(req, res, supabase);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Unsubscribe self-serve form posts urlencoded data with no JSON action field,
  // so it's routed via the query string like the GET link above.
  if (req.query.action === 'unsubscribe') return await handleUnsubscribe(req, res, supabase);

  try {
    const { action } = req.body;

    // Route to appropriate handler based on action
    switch (action) {
      case 'save':
        return await handleSaveAudit(req, res, supabase);
      case 'calculate-score':
        return await handleCalculateScore(req, res);
      case 'share':
        return await handleShareAudit(req, res, supabase);
      case 'leaderboard-opt-in':
        return await handleLeaderboardOptIn(req, res, supabase);
      case 'lead_magnet':
        return await handleLeadMagnet(req, res, supabase);
      case 'newsletter':
        return await handleNewsletter(req, res, supabase);
      case 'save-session':
        return await handleSaveSession(req, res, supabase);
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (err) {
    console.error('Audits endpoint error:', err.message);
    sentry.captureException(err, { context: 'audits' });
    return res.status(500).json({ error: err.message });
  }
};

// ── SAVE AUDIT ────────────────────────────────────────────────────────────────
async function handleSaveAudit(req, res, supabase) {
  // Rate limiting
  const rateLimit = await checkRateLimit(req, 'save-audit', 10, 60 * 60 * 1000);
  if (rateLimit.limit !== undefined) res.setHeader('X-RateLimit-Limit', String(rateLimit.limit));
  if (rateLimit.remaining !== undefined) res.setHeader('X-RateLimit-Remaining', String(rateLimit.remaining));
  if (rateLimit.resetAt !== undefined) res.setHeader('X-RateLimit-Reset', new Date(rateLimit.resetAt).toISOString());
  
  if (rateLimit.limited) {
    const retryAfter = Math.ceil((rateLimit.resetAt - Date.now()) / 1000);
    res.setHeader('Retry-After', retryAfter);
    return res.status(429).json({
      error: 'Too many requests',
      message: `You've hit the audit limit. Try again in ${Math.ceil(retryAfter / 60)} minutes.`,
      retryAfter,
    });
  }

  // Input validation
  const { action, ...auditData } = req.body; // Remove action from validation

  const validation = validate(auditData, SaveAuditSchema);

  if (!validation.success) {
    return res.status(400).json({ 
      error: 'Validation failed', 
      message: validation.error,
      details: validation.details, // Include full error details
      receivedData: Object.keys(auditData), // Show what fields we received
    });
  }

  const {
    sessionId,
    email,
    provider,
    monthlyBill,
    companyName,
    flaggedIds,
    wasteScore,
    savingsMin,
    savingsMax,
    auditType,
  } = validation.data;

  // Calculate scores
  const scores = wasteScore 
    ? { 
        wasteScore, 
        letterGrade: require('./lib/_scoring').getLetterGrade(wasteScore),
        wastePercentage: monthlyBill > 0 ? Math.round((savingsMin / monthlyBill) * 100) : 0,
      }
    : calculateScores({
        flaggedIds,
        monthlyBill,
        savingsMin,
        savingsMax,
        allChecks: [],
      });

  const reAuditDue = new Date();
  reAuditDue.setDate(reAuditDue.getDate() + 90);

  const { error } = await supabase
    .from('audits')
    .upsert({
      session_id:       sessionId,
      email:            email || null,
      provider:         provider || 'AWS',
      monthly_bill:     monthlyBill || 0,
      company_name:     companyName || null,
      flagged_ids:      flaggedIds || [],
      waste_score:      scores.wasteScore || 0,
      letter_grade:     scores.letterGrade || 'F',
      waste_percentage: scores.wastePercentage || 0,
      savings_min:      savingsMin || 0,
      savings_max:      savingsMax || 0,
      audit_type:       auditType || 'cost',
      re_audit_due:     reAuditDue.toISOString(),
    }, {
      onConflict: 'session_id',
      ignoreDuplicates: false,
    });

  if (error) throw error;

  if (email) {
    const { error: subError } = await supabase
      .from('subscribers')
      .upsert({
        email,
        provider:     provider || 'AWS',
        re_audit_due: reAuditDue.toISOString(),
        unsubscribed: false,
      }, {
        onConflict: 'email',
        ignoreDuplicates: false,
      });
    if (subError) {
      console.error('subscribers upsert error:', subError.message);
    }
  }

  return res.status(200).json({ 
    success: true,
    scores: {
      wasteScore: scores.wasteScore,
      letterGrade: scores.letterGrade,
    }
  });
}

// ── CALCULATE SCORE ───────────────────────────────────────────────────────────
async function handleCalculateScore(req, res) {
  const rateLimit = await checkRateLimit(req, 'calculate-score', 30, 60 * 60 * 1000);
  if (rateLimit.limited) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const { flaggedIds, monthlyBill, savingsMin, savingsMax, allChecks } = req.body;

  if (!Array.isArray(flaggedIds)) {
    return res.status(400).json({ error: 'flaggedIds must be an array' });
  }

  const scores = calculateScores({
    flaggedIds,
    monthlyBill: Number(monthlyBill) || 0,
    savingsMin: Number(savingsMin) || 0,
    savingsMax: Number(savingsMax) || 0,
    allChecks: allChecks || [],
  });

  const { getPerformanceMessage } = require('./lib/_scoring');
  const message = getPerformanceMessage(scores.wasteScore, scores.letterGrade);

  return res.status(200).json({
    success: true,
    ...scores,
    message,
  });
}

// ── SHARE AUDIT ───────────────────────────────────────────────────────────────
async function handleShareAudit(req, res, supabase) {
  const rateLimit = await checkRateLimit(req, 'share-audit', 20, 60 * 60 * 1000);
  if (rateLimit.limited) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const { sessionId, isPublic, displayName } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId required' });
  }

  if (!/^ka_\d+_[a-z0-9]+$/.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid session ID format' });
  }

  const updateData = {
    is_public: isPublic === true,
    display_name: displayName || null,
  };

  if (isPublic === false) {
    updateData.public_slug = null;
  }

  const { error } = await supabase
    .from('audits')
    .update(updateData)
    .eq('session_id', sessionId);

  if (error) {
    console.error('Share audit error:', error);
    return res.status(500).json({ error: 'Failed to update audit' });
  }

  return res.status(200).json({
    success: true,
    isPublic: isPublic === true,
    shareUrl: null, // public_slug feature requires additional DB columns
  });
}

// ── LEADERBOARD OPT-IN ────────────────────────────────────────────────────────
async function handleLeaderboardOptIn(req, res, supabase) {
  const rateLimit = await checkRateLimit(req, 'leaderboard-opt-in', 10, 60 * 60 * 1000);
  if (rateLimit.limited) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const { sessionId, publicDisplay, displayName } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId required' });
  }

  if (!/^ka_\d+_[a-z0-9]+$/.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid session ID format' });
  }

  if (displayName && displayName.length > 100) {
    return res.status(400).json({ error: 'Display name too long (max 100 characters)' });
  }

  const updateData = {
    public_display: publicDisplay === true,
    display_name: displayName || null,
  };

  if (publicDisplay === true) {
    updateData.leaderboard_opt_in_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from('audits')
    .update(updateData)
    .eq('session_id', sessionId);

  if (error) {
    console.error('Leaderboard opt-in error:', error);
    return res.status(500).json({ error: 'Failed to update audit' });
  }

  return res.status(200).json({
    success: true,
    publicDisplay: publicDisplay === true,
    displayName: displayName || null,
    rank: null,
  });
}

// ── LEAD MAGNET ───────────────────────────────────────────────────────────────
// Captures email from the 30-second PDF checklist popup.
// Stores in subscribers table for re-audit reminders.
// The PDF itself is served as a public static file — no email needed to download.
async function handleLeadMagnet(req, res, supabase) {
  const rateLimit = await checkRateLimit(req, 'lead-magnet', 5, 60 * 60 * 1000);
  if (rateLimit.limited) return res.status(429).json({ error: 'Too many requests' });

  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const reAuditDue = new Date();
  reAuditDue.setDate(reAuditDue.getDate() + 90);

  // Upsert into subscribers — graceful if table doesn't exist yet
  try {
    await supabase.from('subscribers').upsert({
      email,
      provider:     'Multi-cloud',
      source:       'lead_magnet',
      re_audit_due: reAuditDue.toISOString(),
      unsubscribed: false,
    }, { onConflict: 'email', ignoreDuplicates: false });
  } catch (err) {
    console.warn('Lead magnet subscriber upsert failed (non-critical):', err.message);
  }

  return res.status(200).json({ success: true });
}

// ── NEWSLETTER ────────────────────────────────────────────────────────────────
async function handleNewsletter(req, res, supabase) {
  const rateLimit = await checkRateLimit(req, 'newsletter', 3, 60 * 60 * 1000);
  if (rateLimit.limited) return res.status(429).json({ error: 'Too many requests' });

  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const reAuditDue = new Date();
  reAuditDue.setDate(reAuditDue.getDate() + 90);

  try {
    await supabase.from('subscribers').upsert({
      email,
      provider:     'Multi-cloud',
      source:       'newsletter',
      re_audit_due: reAuditDue.toISOString(),
      unsubscribed: false,
    }, { onConflict: 'email', ignoreDuplicates: false });
  } catch (err) {
    console.warn('Newsletter subscriber upsert failed:', err.message);
  }

  return res.status(200).json({ success: true });
}

// ── SAVE SESSION ──────────────────────────────────────────────────────────────
async function handleSaveSession(req, res, supabase) {
  const rateLimit = await checkRateLimit(req, 'save-session', 20, 60 * 60 * 1000);
  if (rateLimit.limited) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const { sessionId, sessionData } = req.body;

  if (!sessionId || !sessionData) {
    return res.status(400).json({ error: 'Missing sessionId or sessionData' });
  }

  const { error } = await supabase
    .from('audits')
    .upsert({
      session_id:    sessionId,
      provider:      sessionData.provider || null,
      monthly_bill:  sessionData.monthlyBill || null,
      company_name:  sessionData.companyName || null,
      flagged_ids:   Object.keys(sessionData.checked || {}).filter(k => sessionData.checked[k]),
      audit_type:    'cost',
      session_state: sessionData,
      updated_at:    new Date().toISOString(),
    }, { onConflict: 'session_id', ignoreDuplicates: false });

  if (error) {
    return res.status(500).json({ error: 'Failed to save session' });
  }

  return res.status(200).json({ success: true });
}

// ── GET SESSION ───────────────────────────────────────────────────────────────
async function handleGetSession(req, res, supabase) {
  const rateLimit = await checkRateLimit(req, 'get-session', 50, 60 * 60 * 1000);
  if (rateLimit.limited) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const { sessionId } = req.query;

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing sessionId' });
  }

  // sessionId is an opaque, high-entropy bearer token (ka_<13-digit-ts>_<7+ char random>),
  // same trust model as handleShareAudit/handleLeaderboardOptIn — reject malformed IDs
  // outright rather than hitting the DB with an unvalidated lookup key.
  if (!/^ka_\d+_[a-z0-9]+$/.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid session ID format' });
  }

  const { data, error } = await supabase
    .from('audits')
    .select('session_state, provider, monthly_bill, company_name, flagged_ids')
    .eq('session_id', sessionId)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'Session not found' });
  }

  return res.status(200).json({
    session: data.session_state || {
      provider:    data.provider,
      monthlyBill: data.monthly_bill,
      companyName: data.company_name,
    },
  });
}

// ── UNSUBSCRIBE ───────────────────────────────────────────────────────────────
// One-click unsubscribe for re-audit reminder emails.
// Required for CAN-SPAM and GDPR compliance.
// Called via GET link in the re-audit email footer, or POST from the self-serve form below.
async function handleUnsubscribe(req, res, supabase) {
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
    <form method="POST" action="/api/audits?action=unsubscribe" style="display:flex;flex-direction:column;gap:14px;">
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
}

