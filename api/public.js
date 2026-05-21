// api/public.js
// KloudAudit — Unified Public Endpoint (consolidates public operations)
// Handles: public audit view, leaderboard
// Reduces API count for Vercel free tier

const { createClient } = require('@supabase/supabase-js');
const { checkRateLimit } = require('./lib/_ratelimit');

module.exports = async function handler(req, res) {
  // Create Supabase client inside handler to avoid early connection
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );
  // Allow public CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, s-maxage=300'); // Cache 5 minutes
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { type, id, provider, limit } = req.query;

    // Route based on type parameter
    switch (type) {
      case 'audit':
        return await handleViewAudit(req, res, supabase, id);
      case 'leaderboard':
        return await handleLeaderboard(req, res, supabase, provider, limit);
      default:
        return res.status(400).json({ error: 'Invalid type. Use ?type=audit&id=... or ?type=leaderboard' });
    }
  } catch (err) {
    console.error('Public endpoint error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── VIEW PUBLIC AUDIT ─────────────────────────────────────────────────────────
async function handleViewAudit(req, res, supabase, auditId) {
  const rateLimit = checkRateLimit(req, 'public-audit', 50, 60 * 60 * 1000);
  if (rateLimit.limited) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  if (!auditId) {
    return res.status(400).json({ error: 'Audit ID required. Use ?type=audit&id=YOUR_ID' });
  }

  // Try to fetch by session_id first, then by public_slug
  let { data: audit, error } = await supabase
    .from('audits')
    .select('*')
    .or(`session_id.eq.${auditId},public_slug.eq.${auditId}`)
    .eq('is_public', true)
    .single();

  if (error || !audit) {
    return res.status(404).json({ 
      error: 'Audit not found',
      message: 'This audit does not exist or has not been shared publicly.',
    });
  }

  // Increment view count
  const { error: updateError } = await supabase
    .from('audits')
    .update({ 
      view_count: (audit.view_count || 0) + 1,
      last_viewed_at: new Date().toISOString(),
    })
    .eq('session_id', audit.session_id);

  if (updateError) {
    console.error('View count update failed:', updateError);
  }

  // Prepare response (exclude sensitive data)
  const publicAudit = {
    id: audit.public_slug || audit.session_id,
    provider: audit.provider,
    monthlyBill: audit.monthly_bill,
    companyName: audit.display_name || audit.company_name || 'Anonymous',
    wasteScore: audit.waste_score,
    letterGrade: audit.letter_grade,
    wastePercentage: audit.waste_percentage,
    savingsMin: audit.savings_min,
    savingsMax: audit.savings_max,
    annualSavingsMin: audit.annual_savings_min || audit.savings_min * 12,
    annualSavingsMax: audit.annual_savings_max || audit.savings_max * 12,
    flaggedIds: audit.flagged_ids,
    flaggedCount: (audit.flagged_ids || []).length,
    auditType: audit.audit_type,
    viewCount: audit.view_count || 0,
    createdAt: audit.created_at,
  };

  return res.status(200).json({
    success: true,
    audit: publicAudit,
  });
}

// ── LEADERBOARD ───────────────────────────────────────────────────────────────
async function handleLeaderboard(req, res, supabase, provider, limitStr) {
  const rateLimit = checkRateLimit(req, 'leaderboard', 100, 60 * 60 * 1000);
  if (rateLimit.limited) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const limit = Math.min(parseInt(limitStr) || 100, 200);
  const auditType = req.query.auditType || 'cost';

  // Build query
  let query = supabase
    .from('audits')
    .select('display_name, provider, waste_score, letter_grade, savings_min, savings_max, monthly_bill, created_at, audit_type')
    .eq('public_display', true)
    .eq('audit_type', auditType)
    .order('waste_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  // Optional provider filter
  if (provider && ['AWS', 'GCP', 'Azure', 'Multi-cloud'].includes(provider)) {
    query = query.eq('provider', provider);
  }

  const { data: audits, error } = await query;

  if (error) {
    console.error('Leaderboard error:', error);
    return res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }

  // Format leaderboard entries
  const leaderboard = (audits || []).map((audit, index) => ({
    rank: index + 1,
    company: audit.display_name || 'Anonymous',
    provider: audit.provider,
    score: audit.waste_score,
    grade: audit.letter_grade,
    monthlySavings: `$${audit.savings_min.toLocaleString()}–$${audit.savings_max.toLocaleString()}`,
    monthlyBill: audit.monthly_bill,
    wastePercentage: audit.monthly_bill > 0 
      ? Math.round((audit.savings_min / audit.monthly_bill) * 100)
      : 0,
    auditedAt: audit.created_at,
  }));

  // Calculate stats
  const stats = {
    totalEntries: leaderboard.length,
    averageScore: leaderboard.length > 0
      ? Math.round(leaderboard.reduce((sum, e) => sum + e.score, 0) / leaderboard.length)
      : 0,
    providers: [...new Set(leaderboard.map(e => e.provider))],
    topScore: leaderboard[0]?.score || 0,
  };

  return res.status(200).json({
    success: true,
    leaderboard,
    stats,
    filters: {
      provider: provider || 'all',
      auditType,
      limit,
    },
  });
}
