// api/audits.js
// KloudAudit — Unified Audits Endpoint (consolidates multiple operations)
// Handles: save, share, score calculation, leaderboard opt-in
// Reduces API count for Vercel free tier (12 function limit)

const { createClient } = require('@supabase/supabase-js');
const sentry = require('./lib/_sentry');
const { SaveAuditSchema, validate } = require('./lib/_validation');
const { checkRateLimit } = require('./lib/_ratelimit');
const { calculateScores } = require('./lib/_scoring');
const { isUnsubscribeAuthorized } = require('./lib/_unsubscribe');

// Escapes user-controlled fields before interpolating into HTML responses.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const unsubscribePageStyles = `
  * { box-sizing: border-box; }
  body { min-height: 100vh; margin: 0; padding: 24px; display: grid; place-items: center; background: #f8fafc; color: #334155; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .unsubscribe-card { width: 100%; max-width: 440px; padding: 40px 32px; border: 1px solid #e2e8f0; border-radius: 20px; background: #fff; box-shadow: 0 20px 60px rgba(15, 23, 42, .08); text-align: center; }
  .brand-mark { width: 48px; height: 48px; display: grid; place-items: center; margin: 0 auto 24px; border-radius: 14px; background: #10b981; color: #fff; font-size: 22px; }
  h1, h2 { margin: 0 0 12px; color: #0f172a; font-size: 24px; line-height: 1.25; letter-spacing: -.04em; }
  p { margin: 0 0 24px; color: #475569; font-size: 15px; line-height: 1.65; overflow-wrap: anywhere; }
  strong { color: #0f172a; }
  a { color: #047857; font-size: 14px; font-weight: 600; text-decoration: none; }
  a:hover { text-decoration: underline; }
  form { display: flex; flex-direction: column; gap: 12px; margin-top: 24px; }
  input[type="email"] { width: 100%; padding: 14px 16px; border: 1px solid #cbd5e1; border-radius: 10px; background: #fff; color: #0f172a; font: inherit; font-size: 15px; }
  input[type="email"]:focus { outline: 3px solid #a7f3d0; border-color: #10b981; }
  button { width: 100%; padding: 14px; border: 0; border-radius: 10px; background: #4f46e5; color: #fff; font: inherit; font-size: 15px; font-weight: 700; cursor: pointer; }
  button:hover { background: #4338ca; }
  .unsubscribe-note { margin: 22px 0 0; color: #64748b; font-size: 13px; }
  .unsubscribe-note a { font-size: inherit; }
  @media (max-width: 480px) { body { padding: 16px; } .unsubscribe-card { padding: 32px 22px; } h1, h2 { font-size: 22px; } }
`;

async function markEmailUnsubscribed(supabase, email) {
  const { error } = await supabase
    .from('subscribers')
    .update({ unsubscribed: true, unsubscribed_at: new Date().toISOString() })
    .eq('email', email);
  if (error) throw error;
}

function sendUnsubscribeError(res, error) {
  console.error('unsubscribe error:', error?.message || error);
  return res.status(500).send(`
    <html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${unsubscribePageStyles}</style></head><body>
      <main class="unsubscribe-card">
        <h2>Something went wrong</h2>
        <p>Please email <a href="mailto:admin@kloudaudit.eu">admin@kloudaudit.eu</a> to unsubscribe manually.</p>
      </main>
    </body></html>
  `);
}

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
  const { ...auditData } = req.body;

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
  const message = getPerformanceMessage(scores.wasteScore);

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

  if (!/^ka_\d+_[a-z0-9-]+$/.test(sessionId)) {
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

  if (!/^ka_\d+_[a-z0-9-]+$/.test(sessionId)) {
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
  if (!/^ka_\d+_[a-z0-9-]+$/.test(sessionId)) {
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
      try {
        await markEmailUnsubscribed(supabase, formEmail);
      } catch (error) {
        return sendUnsubscribeError(res, error);
      }
      return res.status(200).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unsubscribed — KloudAudit</title><style>${unsubscribePageStyles}</style></head><body><main class="unsubscribe-card"><div class="brand-mark">⚡</div><h1>You're unsubscribed</h1><p>We've removed <strong>${escapeHtml(formEmail)}</strong> from all KloudAudit emails.</p><a href="https://www.kloudaudit.eu">← Back to KloudAudit</a></main></body></html>`);
    }
  }

  if (!email) {
    return res.status(200).send(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unsubscribe — KloudAudit</title><style>${unsubscribePageStyles}</style></head>
<body>
  <main class="unsubscribe-card">
    <div class="brand-mark">⚡</div>
    <h1>Unsubscribe from KloudAudit</h1>
    <p>Enter your email below to stop receiving re-audit reminders and updates.</p>
    <form method="POST" action="/api/audits?action=unsubscribe">
      <input type="email" name="email" required placeholder="you@company.com"
      />
      <button type="submit">
        Unsubscribe
      </button>
    </form>
    <p class="unsubscribe-note">Or email <a href="mailto:admin@kloudaudit.eu">admin@kloudaudit.eu</a> to unsubscribe manually.</p>
  </main>
</body>
</html>`);
  }

  // The one-click link is signed (see api/lib/_unsubscribe.js). A missing or
  // invalid token means this wasn't a link we sent — require the visitor to
  // confirm the email themselves via the form rather than unsubscribing on
  // the strength of the address alone.
  if (!isUnsubscribeAuthorized(email, req.query.token)) {
    return res.status(200).send(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Confirm Unsubscribe — KloudAudit</title><style>${unsubscribePageStyles}</style></head>
<body>
  <main class="unsubscribe-card">
    <div class="brand-mark">⚡</div>
    <h1>Confirm unsubscribe</h1>
    <p>This link couldn't be verified. Confirm below to unsubscribe <strong>${escapeHtml(email)}</strong> from KloudAudit emails.</p>
    <form method="POST" action="/api/audits?action=unsubscribe">
      <input type="hidden" name="email" value="${escapeHtml(email)}" />
      <button type="submit">
        Confirm Unsubscribe
      </button>
    </form>
    <p class="unsubscribe-note">Or email <a href="mailto:admin@kloudaudit.eu">admin@kloudaudit.eu</a> to unsubscribe manually.</p>
  </main>
</body>
</html>`);
  }

  try {
    await markEmailUnsubscribed(supabase, email);

    // Return a clean confirmation page — no redirect needed
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unsubscribed — KloudAudit</title><style>${unsubscribePageStyles}</style></head>
      <body>
        <main class="unsubscribe-card">
          <div class="brand-mark">⚡</div>
          <h1>You're unsubscribed</h1>
          <p>
            We've removed <strong>${escapeHtml(email)}</strong> from re-audit reminders.
            You won't receive any more emails from us.
          </p>
          <p class="unsubscribe-note">
            The free audit at <a href="https://www.kloudaudit.eu">kloudaudit.eu</a> is always available if you want to check your cloud costs.
          </p>
        </main>
      </body>
      </html>
    `);

  } catch (err) {
    return sendUnsubscribeError(res, err);
  }
}
