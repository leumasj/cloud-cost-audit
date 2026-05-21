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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { action } = req.body;

    // Route to appropriate handler based on action
    switch (action) {
      case 'save':
        return await handleSaveAudit(req, res);
      case 'calculate-score':
        return await handleCalculateScore(req, res);
      case 'share':
        return await handleShareAudit(req, res);
      case 'leaderboard-opt-in':
        return await handleLeaderboardOptIn(req, res);
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
async function handleSaveAudit(req, res) {
  // Rate limiting
  const rateLimit = checkRateLimit(req, 'save-audit', 10, 60 * 60 * 1000);
  res.setHeader('X-RateLimit-Limit', rateLimit.limit);
  res.setHeader('X-RateLimit-Remaining', rateLimit.remaining);
  res.setHeader('X-RateLimit-Reset', new Date(rateLimit.resetAt).toISOString());
  
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
  const validation = validate(req.body, SaveAuditSchema);
  if (!validation.success) {
    return res.status(400).json({ 
      error: 'Validation failed', 
      message: validation.error,
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
  const rateLimit = checkRateLimit(req, 'calculate-score', 30, 60 * 60 * 1000);
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
async function handleShareAudit(req, res) {
  const rateLimit = checkRateLimit(req, 'share-audit', 20, 60 * 60 * 1000);
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

  const { data: audit, error } = await supabase
    .from('audits')
    .update(updateData)
    .eq('session_id', sessionId)
    .select()
    .single();

  if (error) {
    console.error('Share audit error:', error);
    return res.status(500).json({ error: 'Failed to update audit' });
  }

  if (!audit) {
    return res.status(404).json({ error: 'Audit not found' });
  }

  const shareUrl = audit.is_public && audit.public_slug
    ? `https://kloudaudit.eu/audit/${audit.public_slug}`
    : null;

  return res.status(200).json({
    success: true,
    isPublic: audit.is_public,
    shareUrl,
    publicSlug: audit.public_slug,
  });
}

// ── LEADERBOARD OPT-IN ────────────────────────────────────────────────────────
async function handleLeaderboardOptIn(req, res) {
  const rateLimit = checkRateLimit(req, 'leaderboard-opt-in', 10, 60 * 60 * 1000);
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

  const { data: audit, error } = await supabase
    .from('audits')
    .update(updateData)
    .eq('session_id', sessionId)
    .select()
    .single();

  if (error) {
    console.error('Leaderboard opt-in error:', error);
    return res.status(500).json({ error: 'Failed to update audit' });
  }

  if (!audit) {
    return res.status(404).json({ error: 'Audit not found' });
  }

  let rank = null;
  if (audit.public_display) {
    const { count } = await supabase
      .from('audits')
      .select('*', { count: 'exact', head: true })
      .eq('public_display', true)
      .eq('audit_type', audit.audit_type)
      .gt('waste_score', audit.waste_score);
    
    rank = (count || 0) + 1;
  }

  return res.status(200).json({
    success: true,
    publicDisplay: audit.public_display,
    displayName: audit.display_name,
    rank,
    wasteScore: audit.waste_score,
    letterGrade: audit.letter_grade,
  });
}
