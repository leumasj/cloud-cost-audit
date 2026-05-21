// api/lib/_ratelimit.js
// KloudAudit — In-Memory Rate Limiting
// Simple, serverless-friendly rate limiter without Redis dependency
// Uses in-memory Map with automatic cleanup

'use strict';

// ── CONFIG ────────────────────────────────────────────────────────────────────
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS = 10; // 10 audits per IP per hour
const CLEANUP_INTERVAL = 5 * 60 * 1000; // cleanup every 5 minutes

// ── IN-MEMORY STORE ───────────────────────────────────────────────────────────
// { "ip:endpoint": { count: 5, resetAt: 1234567890 } }
const rateLimitStore = new Map();

// ── CLEANUP OLD ENTRIES ───────────────────────────────────────────────────────
// Automatically delete expired entries to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (value.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

// ── GET CLIENT IP ─────────────────────────────────────────────────────────────
/**
 * Extract client IP from Vercel request headers
 * Handles proxies, CloudFlare, and direct connections
 */
function getClientIp(req) {
  // Vercel provides this header
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    // x-forwarded-for can be: "client, proxy1, proxy2"
    return forwardedFor.split(',')[0].trim();
  }
  
  // Fallback to other headers
  return req.headers['x-real-ip'] 
    || req.connection?.remoteAddress 
    || req.socket?.remoteAddress
    || 'unknown';
}

// ── RATE LIMIT CHECK ──────────────────────────────────────────────────────────
/**
 * Check if request should be rate limited
 * @param {object} req - Express request object
 * @param {string} endpoint - Endpoint name (e.g., 'save-audit')
 * @param {number} maxRequests - Max requests per window (optional)
 * @param {number} windowMs - Time window in ms (optional)
 * @returns {{ limited: boolean, remaining: number, resetAt: number }}
 */
function checkRateLimit(req, endpoint = 'default', maxRequests = MAX_REQUESTS, windowMs = WINDOW_MS) {
  const ip = getClientIp(req);
  const key = `${ip}:${endpoint}`;
  const now = Date.now();
  
  // Get or create rate limit entry
  let entry = rateLimitStore.get(key);
  
  if (!entry || entry.resetAt < now) {
    // New window or expired — reset
    entry = {
      count: 0,
      resetAt: now + windowMs,
    };
    rateLimitStore.set(key, entry);
  }
  
  // Increment request count
  entry.count++;
  
  // Check if limit exceeded
  const limited = entry.count > maxRequests;
  const remaining = Math.max(0, maxRequests - entry.count);
  
  return {
    limited,
    remaining,
    resetAt: entry.resetAt,
    current: entry.count,
    limit: maxRequests,
  };
}

// ── RATE LIMIT MIDDLEWARE ─────────────────────────────────────────────────────
/**
 * Express middleware for rate limiting
 * Usage: app.post('/api/save-audit', rateLimitMiddleware('save-audit'), handler)
 */
function rateLimitMiddleware(endpoint = 'default', maxRequests = MAX_REQUESTS, windowMs = WINDOW_MS) {
  return (req, res, next) => {
    const result = checkRateLimit(req, endpoint, maxRequests, windowMs);
    
    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', result.limit);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', new Date(result.resetAt).toISOString());
    
    if (result.limited) {
      const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
      res.setHeader('Retry-After', retryAfter);
      
      return res.status(429).json({
        error: 'Too many requests',
        message: `Rate limit exceeded. Try again in ${Math.ceil(retryAfter / 60)} minutes.`,
        retryAfter,
        resetAt: new Date(result.resetAt).toISOString(),
      });
    }
    
    next();
  };
}

// ── EXPORT ────────────────────────────────────────────────────────────────────
module.exports = {
  checkRateLimit,
  rateLimitMiddleware,
  getClientIp,
  
  // For testing/debugging
  _store: rateLimitStore,
  _clear: () => rateLimitStore.clear(),
};
