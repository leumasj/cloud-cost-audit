// api/ai-preview.js
// KloudAudit — AI Preview Endpoint (rate-limited)
//
// Proxies the AI preview request through the backend so:
// 1. The Anthropic API key is NEVER exposed to the browser
// 2. Rate limiting prevents credit drain from abuse
//
// Rate limit: 5 requests per IP per hour
// This is generous for legitimate users (they only need 1 per audit)
// but blocks scripts and automated abuse.

const Anthropic = require('@anthropic-ai/sdk');
const { AI_MODEL, AI_MAX_TOKENS_PREVIEW } = require('./lib/_config');
const { sanitizeForPrompt } = require('./lib/_sanitize');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const sentry = require('./lib/_sentry');


const { createClient } = require('@supabase/supabase-js');
const { RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW_MS } = require('./lib/_config');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

// ── PERSISTENT RATE LIMITER ───────────────────────────────────────────────────
// Stored in Supabase so it survives cold starts — in-memory Map resets on every
// Vercel cold start, making it trivially bypassable by waiting 5 minutes.
async function isRateLimited(ip) {
  try {
    const supabase = getSupabase();
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();

    // Count requests from this IP in the last hour
    const { count, error } = await supabase
      .from('rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('ip', ip)
      .gte('created_at', windowStart);

    if (error) {
      // Supabase unavailable — fail open to not block legitimate users
      console.warn('Rate limit check failed:', error.message);
      return false;
    }

    if (count >= RATE_LIMIT_REQUESTS) return true;

    // Record this request
    await supabase.from('rate_limits').insert({ ip });
    return false;

  } catch (err) {
    // Fail open on any unexpected error
    console.warn('Rate limit error:', err.message);
    return false;
  }
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // CORS — restrict to KloudAudit domains only
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

  // Rate limit by IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || req.socket?.remoteAddress
           || 'unknown';

  if (await isRateLimited(ip)) {
    return res.status(429).json({
      error: 'Too many requests. Please try again later.',
      retryAfter: 3600,
    });
  }

  try {
    const { issueLabel, issueDetail, provider, bill } = req.body;

    if (!issueLabel || !provider) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const safeProvider    = sanitizeForPrompt(provider, 40);
    const safeIssueLabel  = sanitizeForPrompt(issueLabel, 120);
    const safeIssueDetail = sanitizeForPrompt(issueDetail || '', 200);

    const prompt = `You are a senior DevOps engineer writing a concise fix for a cloud cost issue.

Provider: ${safeProvider}
Issue: ${safeIssueLabel}
Detail: ${safeIssueDetail}
Monthly bill: $${bill || 5000}

Write ONLY the fix for this ONE issue. Format exactly as:

## What's happening
1-2 sentences explaining the waste.

## Fix it now (${provider} CLI)
\`\`\`bash
# One practical command with a real comment
[command here]
\`\`\`

## Verify savings
\`\`\`bash
[verification command]
\`\`\`

## Time to implement
[X minutes]

Keep it concise, technical, and accurate. Real commands only.`;

    const response = await anthropic.messages.create({
      model:      AI_MODEL,
      max_tokens: AI_MAX_TOKENS_PREVIEW,
      messages:   [{ role: 'user', content: prompt }],
    });

    const text = response.content[0]?.text;
    if (!text) throw new Error('No response from AI');

    return res.status(200).json({ preview: text });

  } catch (err) {
    console.error('ai-preview error:', err.message);
    sentry.captureException(err, { context: 'ai-preview' });
    return res.status(500).json({ error: 'Preview unavailable' });
  }
};
