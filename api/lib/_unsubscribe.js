// api/lib/_unsubscribe.js
// Signs one-click unsubscribe links so knowing/guessing someone's email
// address alone isn't enough to unsubscribe them — the link must carry a
// token derived from a server-side secret. Falls back to allowing unsigned
// links when no secret is configured, so CAN-SPAM/GDPR-required unsubscribe
// links keep working rather than breaking on an unconfigured deploy.

const crypto = require('crypto');

function getSecret() {
  return process.env.UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

function generateUnsubscribeToken(email) {
  const secret = getSecret();
  if (!secret) return null;
  return crypto.createHmac('sha256', secret)
    .update(String(email).toLowerCase().trim())
    .digest('hex')
    .slice(0, 32);
}

// Returns true if this request is authorized to unsubscribe `email` outright.
function isUnsubscribeAuthorized(email, token) {
  const expected = generateUnsubscribeToken(email);
  if (expected === null) return true; // no secret configured — legacy behavior
  if (!token) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { generateUnsubscribeToken, isUnsubscribeAuthorized };
