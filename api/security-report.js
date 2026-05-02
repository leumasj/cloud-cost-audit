// api/security-report.js
// KloudAudit Security Audit — AI-powered cloud security analysis
// No account access required — self-reported security posture assessment

const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── RATE LIMITING — simple in-memory (resets on cold start) ──────────────────
const ipRequests = new Map();
const RATE_LIMIT = 10; // per hour per IP
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour

function isRateLimited(ip) {
  const now = Date.now();
  const record = ipRequests.get(ip) || { count: 0, window: now };
  if (now - record.window > RATE_WINDOW) {
    ipRequests.set(ip, { count: 1, window: now });
    return false;
  }
  if (record.count >= RATE_LIMIT) return true;
  ipRequests.set(ip, { count: record.count + 1, window: record.window });
  return false;
}

// ── SECURITY PROMPT BUILDER ───────────────────────────────────────────────────
function buildSecurityPrompt(data) {
  const {
    provider, companyName, teamSize, environment,
    mfaEnabled, publicBuckets, iamWildcards, encryptionAtRest,
    encryptionInTransit, loggingEnabled, vpcIsolation, secretsManager,
    incidentResponse, patchingCadence, complianceFramework,
    flaggedIssues,
  } = data;

  return `You are a senior cloud security architect conducting a security posture assessment for ${companyName || "a company"} running on ${provider}.

SECURITY POSTURE DATA (self-reported):
- Provider: ${provider}
- Team size: ${teamSize}
- Environment: ${environment}
- MFA enabled for all users: ${mfaEnabled}
- Public storage buckets: ${publicBuckets}
- IAM wildcard permissions (*): ${iamWildcards}
- Encryption at rest: ${encryptionAtRest}
- Encryption in transit: ${encryptionInTransit}
- CloudTrail/Audit logging: ${loggingEnabled}
- VPC network isolation: ${vpcIsolation}
- Secrets manager (no hardcoded secrets): ${secretsManager}
- Incident response plan: ${incidentResponse}
- Patching cadence: ${patchingCadence}
- Compliance framework: ${complianceFramework || "None"}
- Flagged security issues: ${flaggedIssues.join(', ')}

Generate a security assessment report with:

## Security Risk Score
Give a score from 0 (critical) to 100 (excellent) with a grade: Critical / High Risk / Medium Risk / Low Risk / Secure

## Critical Findings
List the top 3 most severe issues with:
- Severity: CRITICAL/HIGH/MEDIUM
- Issue description
- Business impact
- Exact remediation command for ${provider}

## Quick Wins (fix in < 1 hour)
3 specific fixes that can be implemented immediately with exact CLI commands

## Compliance Gap Analysis
Based on their stated framework (${complianceFramework || "general best practices"}), identify the top 3 gaps

## 30-Day Security Roadmap
Week 1, Week 2, Week 3-4 priorities

Keep it technical, specific to ${provider}, and actionable. Real commands only. No generic advice.`;
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limiting
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  try {
    const {
      provider, companyName, teamSize, environment,
      mfaEnabled, publicBuckets, iamWildcards, encryptionAtRest,
      encryptionInTransit, loggingEnabled, vpcIsolation, secretsManager,
      incidentResponse, patchingCadence, complianceFramework,
      flaggedIssues = [],
    } = req.body;

    if (!provider || !flaggedIssues.length) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const prompt = buildSecurityPrompt(req.body);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const report = response.content[0]?.text;
    if (!report) throw new Error('No response from AI');

    return res.status(200).json({ report, provider, companyName });

  } catch (err) {
    console.error('Security report error:', err.message);
    return res.status(500).json({ error: 'Failed to generate security report. Please try again.' });
  }
};
