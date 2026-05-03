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

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── IN-MEMORY RATE LIMITER ─────────────────────────────────────────────────
// Resets on cold start — sufficient for abuse protection without Redis
const ipRequests = new Map();
const RATE_LIMIT  = 5;   // max requests per window
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour in ms

function isRateLimited(ip) {
  const now    = Date.now();
  const record = ipRequests.get(ip);

  if (!record || now - record.window > RATE_WINDOW) {
    ipRequests.set(ip, { count: 1, window: now });
    return false;
  }

  if (record.count >= RATE_LIMIT) return true;

  record.count++;
  return false;
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit by IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || req.socket?.remoteAddress
           || 'unknown';

  if (isRateLimited(ip)) {
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

    const prompt = `You are a senior DevOps engineer writing a concise fix for a cloud cost issue.

Provider: ${provider}
Issue: ${issueLabel}
Detail: ${issueDetail || ''}
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
      model:      'claude-sonnet-4-6',
      max_tokens: 500,
      messages:   [{ role: 'user', content: prompt }],
    });

    const text = response.content[0]?.text;
    if (!text) throw new Error('No response from AI');

    return res.status(200).json({ preview: text });

  } catch (err) {
    console.error('ai-preview error:', err.message);
    return res.status(500).json({ error: 'Preview unavailable' });
  }
};
