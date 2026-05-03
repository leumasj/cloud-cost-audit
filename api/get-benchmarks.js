// api/get-benchmarks.js
// KloudAudit — Benchmark Data API
//
// Returns real aggregated statistics from the audits table.
// Used by SEO landing pages to show "Based on X assessments..." data.
// Cached at Vercel edge for 24 hours — data doesn't change minute to minute.
//
// This data is KloudAudit's unique moat — no competitor has it.

const { createClient } = require('@supabase/supabase-js');
const sentry = require('./lib/sentry');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Cache at edge for 24 hours — benchmarks update daily at most
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=3600');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { provider, issue } = req.query;

  try {
    // Build query — filter by provider if specified
    let query = supabase
      .from('audits')
      .select('provider, monthly_bill, flagged_ids, savings_min, savings_max, waste_score, created_at')
      .not('flagged_ids', 'is', null);

    if (provider && provider !== 'Multi-Cloud') {
      query = query.eq('provider', provider);
    }

    const { data: audits, error } = await query.limit(1000);
    if (error) throw error;

    const total = audits.length;

    // Not enough data yet — return placeholder that prompts action
    if (total < 5) {
      return res.status(200).json({
        total,
        hasData: false,
        message: 'Building benchmark data — check back soon',
      });
    }

    // ── Compute benchmarks ────────────────────────────────────────────────
    // 1. Issue frequency — how often each issue appears
    const issueCounts = {};
    audits.forEach(a => {
      (a.flagged_ids || []).forEach(id => {
        issueCounts[id] = (issueCounts[id] || 0) + 1;
      });
    });

    // 2. Frequency of the specific issue being queried
    const issueFrequency = issue
      ? Math.round(((issueCounts[issue] || 0) / total) * 100)
      : null;

    // 3. Average savings
    const withSavings  = audits.filter(a => a.savings_min > 0);
    const avgSavingsMin = withSavings.length > 0
      ? Math.round(withSavings.reduce((s, a) => s + a.savings_min, 0) / withSavings.length)
      : 0;
    const avgSavingsMax = withSavings.length > 0
      ? Math.round(withSavings.reduce((s, a) => s + a.savings_max, 0) / withSavings.length)
      : 0;

    // 4. Average waste score
    const withScore   = audits.filter(a => a.waste_score > 0);
    const avgScore    = withScore.length > 0
      ? Math.round(withScore.reduce((s, a) => s + a.waste_score, 0) / withScore.length)
      : 0;

    // 5. Top 3 most common issues
    const topIssues = Object.entries(issueCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, count]) => ({
        id,
        count,
        pct: Math.round((count / total) * 100),
      }));

    // 6. Bill size distribution
    const billRanges = {
      'Under $1K':   audits.filter(a => a.monthly_bill < 1000).length,
      '$1K–$5K':     audits.filter(a => a.monthly_bill >= 1000 && a.monthly_bill < 5000).length,
      '$5K–$20K':    audits.filter(a => a.monthly_bill >= 5000 && a.monthly_bill < 20000).length,
      '$20K+':       audits.filter(a => a.monthly_bill >= 20000).length,
    };

    return res.status(200).json({
      hasData:        true,
      total,
      provider:       provider || 'All',
      issueFrequency,
      avgSavingsMin,
      avgSavingsMax,
      avgScore,
      topIssues,
      billRanges,
      updatedAt:      new Date().toISOString(),
    });

  } catch (err) {
    console.error('get-benchmarks error:', err.message);
    sentry.captureException(err, { context: 'get-benchmarks', provider, issue });
    return res.status(500).json({ error: 'Benchmarks unavailable' });
  }
};
