// api/create-checkout.js
// Vercel Serverless Function — creates a Stripe Checkout session
// Deploy: this file goes in /api/ at the root of your project



const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { PRODUCT_PRICES } = require('./lib/_config');
const { checkRateLimit } = require('./lib/_ratelimit');
const { CreateCheckoutSchema, validate } = require('./lib/_validation');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email);
}

// Resolve the canonical, server-side price for a product — never trusts the
// client-supplied currencyAmount, which would otherwise let a caller set an
// arbitrary charge (e.g. currencyAmount: 1) for a live Stripe payment.
function resolvePrice(productKey, stripeCurrency) {
  const table = PRODUCT_PRICES[productKey];
  const c = (stripeCurrency || 'usd').toLowerCase();
  return table[c] || table.usd;
}

// Maps Stripe currency code → recurring Price ID env var for subscription mode.
function resolveSubscriptionPriceId(stripeCurrency) {
  const c = (stripeCurrency || 'usd').toLowerCase();
  const map = {
    usd: process.env.STRIPE_SUBSCRIPTION_PRICE_ID_USD,
    eur: process.env.STRIPE_SUBSCRIPTION_PRICE_ID_EUR,
    gbp: process.env.STRIPE_SUBSCRIPTION_PRICE_ID_GBP,
    pln: process.env.STRIPE_SUBSCRIPTION_PRICE_ID_PLN,
    cad: process.env.STRIPE_SUBSCRIPTION_PRICE_ID_CAD,
    aud: process.env.STRIPE_SUBSCRIPTION_PRICE_ID_AUD,
  };
  return map[c] || process.env.STRIPE_SUBSCRIPTION_PRICE_ID || null;
}

module.exports = async function handler(req, res)  {
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

  // Reject requests from origins not in the allowlist
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const rateLimit = await checkRateLimit(req, 'create-checkout', 10, 60 * 60 * 1000);
  if (rateLimit.limited) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  try {
    const { email, provider, monthlyBill, flaggedIssues, companyName, savingsMin, savingsMax, currency, productType, sessionId, stripeCurrency } = req.body;

    // Validate product type up front — unknown types are rejected before reaching Stripe
    const VALID_PRODUCT_TYPES = ['blueprint', 'security_blueprint', 'bundle', 'cfo_report', 'subscription', 'session', 'ai_blueprint'];
    if (productType && !VALID_PRODUCT_TYPES.includes(productType)) {
      return res.status(400).json({ error: 'Invalid product type' });
    }

    // ── CONSULTING SESSION (one-time, no quantity) ────────────────────────────
    // SETUP: Create a one-time Price in Stripe Dashboard for the session fee.
    // Set env var STRIPE_SESSION_PRICE_ID (or per-currency variants).
    // If not configured the button gracefully shows "contact us" fallback.
    if (productType === 'session') {
      if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid email address is required' });

      const sessionCurrency = (stripeCurrency || currency || 'usd').toLowerCase();
      const currencyMap = {
        usd: process.env.STRIPE_SESSION_PRICE_ID_USD,
        eur: process.env.STRIPE_SESSION_PRICE_ID_EUR,
        gbp: process.env.STRIPE_SESSION_PRICE_ID_GBP,
        pln: process.env.STRIPE_SESSION_PRICE_ID_PLN,
        cad: process.env.STRIPE_SESSION_PRICE_ID_CAD,
        aud: process.env.STRIPE_SESSION_PRICE_ID_AUD,
      };
      const priceId = currencyMap[sessionCurrency] || process.env.STRIPE_SESSION_PRICE_ID;

      if (!priceId) {
        return res.status(503).json({
          error: 'Session checkout not yet configured — contact admin@kloudaudit.eu',
          code:  'session_not_configured',
        });
      }

      const baseUrl = process.env.NEXT_PUBLIC_URL || 'https://kloudaudit.eu';
      const session = await stripe.checkout.sessions.create({
        line_items:    [{ price: priceId, quantity: 1 }],
        mode:          'payment',
        customer_email: email,
        success_url:   `${baseUrl}?payment=session_success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:    `${baseUrl}?payment=cancelled`,
        metadata: {
          type:      'consulting_session',
          provider:  provider || 'AWS',
          sessionId: sessionId || '',
          email,
        },
      });
      return res.status(200).json({ url: session.url, sessionId: session.id });
    }

    // ── CFO REPORT (one-time, executive-grade PDF) ────────────────────────────
    if (productType === 'cfo_report') {
      if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid email address is required' });
      const chargeCurrency = (currency || 'usd').toLowerCase();
      const chargeAmount   = resolvePrice('cfo_report', chargeCurrency);
      const numIssues      = (flaggedIssues || []).length;

      const metadata = {
        email,
        type:            'cfo_report',
        provider:        provider || 'AWS',
        monthlyBill:     String(monthlyBill || 0),
        companyName:     companyName || 'Your Company',
        savingsMin:      String(savingsMin || 0),
        savingsMax:      String(savingsMax || 0),
        flaggedIssueIds:    (flaggedIssues || []).map(i => i.id).join(',').substring(0, 499),
        flaggedIssueLabels: (flaggedIssues || []).map(i => i.label).join('||').substring(0, 499),
        sessionId:       sessionId || '',
      };

      // Use the configured Stripe Price ID for USD (defined product + price in dashboard).
      // Fall back to dynamic price_data for non-USD currencies.
      const cfoPriceId = chargeCurrency === 'usd'
        ? process.env.STRIPE_CFO_REPORT_PRICE_ID
        : null;

      const lineItems = cfoPriceId
        ? [{ price: cfoPriceId, quantity: 1 }]
        : [{
            price_data: {
              currency: chargeCurrency,
              product_data: {
                name: 'KloudAudit — CFO & Board Report',
                description: `Executive cloud cost analysis for ${companyName || 'your company'} — ${numIssues} issues, board-ready PDF, delivered to ${email} instantly.`,
                images: ['https://kloudaudit.eu/og-image.png'],
              },
              unit_amount: chargeAmount,
            },
            quantity: 1,
          }];

      const baseUrl = process.env.NEXT_PUBLIC_URL || 'https://kloudaudit.eu';
      const session = await stripe.checkout.sessions.create({
        line_items:          lineItems,
        mode:                'payment',
        customer_email:      email,
        success_url:         `${baseUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:          `${baseUrl}?payment=cancelled`,
        metadata,
        payment_intent_data: { metadata },
      });
      return res.status(200).json({ url: session.url, sessionId: session.id });
    }

    // ── SUBSCRIPTION (recurring) ──────────────────────────────────────────────
    if (productType === 'subscription') {
      if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid email address is required' });
      const priceId = resolveSubscriptionPriceId(stripeCurrency || currency);
      if (!priceId) {
        return res.status(503).json({
          error: 'Monthly plan not yet configured — contact admin@kloudaudit.eu',
          code:  'subscription_not_configured',
        });
      }
      const baseUrl = process.env.NEXT_PUBLIC_URL || 'https://kloudaudit.eu';
      const session = await stripe.checkout.sessions.create({
        line_items:         [{ price: priceId, quantity: 1 }],
        mode:               'subscription',
        customer_email:     email,
        success_url:        `${baseUrl}?payment=sub_success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:         `${baseUrl}?payment=cancelled`,
        subscription_data:  { metadata: { type: 'monthly_plan', provider: provider || 'AWS', sessionId: sessionId || '' } },
        metadata:           { type: 'monthly_plan', provider: provider || 'AWS', sessionId: sessionId || '' },
      });
      return res.status(200).json({ url: session.url, sessionId: session.id });
    }

    // ── AI COST BLUEPRINT (one-time, additive — mirrors the default blueprint case) ──
    if (productType === 'ai_blueprint') {
      if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid email address is required' });
      const aiChargeCurrency = (currency || 'pln').toLowerCase();
      const aiChargeAmount   = resolvePrice('ai_blueprint', aiChargeCurrency);
      const aiIssues         = flaggedIssues || [];

      const aiMetadata = {
        email,
        type: 'ai_blueprint',
        provider: provider || 'AI APIs',
        monthlyBill: String(monthlyBill || 0),
        companyName: companyName || 'Your Company',
        savingsMin: String(savingsMin || 0),
        savingsMax: String(savingsMax || 0),
        flaggedIssueIds:    aiIssues.map(i => i.id).join(',').substring(0, 499),
        flaggedIssueLabels: aiIssues.map(i => i.label).join('||').substring(0, 499),
        sessionId: sessionId || '',
      };

      const aiSession = await stripe.checkout.sessions.create({
        line_items: [{
          price_data: {
            currency: aiChargeCurrency,
            product_data: {
              name: 'KloudAudit — AI Cost Blueprint',
              description: `Personalised AI API cost remediation guide for ${aiIssues.length} detected issues — model routing, caching, spend controls. Delivered to ${email} instantly.`,
              images: ['https://kloudaudit.eu/og-image.png'],
            },
            unit_amount: aiChargeAmount,
          },
          quantity: 1,
        }],
        mode: 'payment',
        customer_email: email,
        success_url: `${process.env.NEXT_PUBLIC_URL || 'https://kloudaudit.eu'}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.NEXT_PUBLIC_URL || 'https://kloudaudit.eu'}?payment=cancelled`,
        metadata: aiMetadata,
        payment_intent_data: { metadata: aiMetadata },
      });

      return res.status(200).json({ url: aiSession.url, sessionId: aiSession.id });
    }

    // Multi-currency: currency comes from the frontend, but the amount is always
    // resolved server-side against PRODUCT_PRICES — never trust client currencyAmount.
    const chargeCurrency = (currency || "pln").toLowerCase();

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }

    // This is the only branch CreateCheckoutSchema was written for — the
    // session/cfo_report/subscription/ai_blueprint branches above have their
    // own (looser) shapes and already returned before reaching here.
    const validation = validate(req.body, CreateCheckoutSchema);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error });
    }

    // Store audit data in Stripe metadata so we can use it in the webhook
    // Determine product type — routes webhook to correct delivery handler
    const type = productType === 'security_blueprint' ? 'security_certificate'
              : productType === 'bundle' ? 'bundle'
              : 'blueprint';

    const chargeAmount = resolvePrice(
      type === 'security_certificate' ? 'security_blueprint' : type,
      chargeCurrency
    );

    const issues = flaggedIssues || [];
    const metadata = {
      email,
      type,                                   // ← webhook routing key
      provider: provider || 'AWS',
      monthlyBill: String(monthlyBill || 0),
      companyName: companyName || 'Your Company',
      savingsMin: String(savingsMin || 0),
      savingsMax: String(savingsMax || 0),
      flaggedIssueIds:    issues.map(i => i.id).join(',').substring(0, 499),
      flaggedIssueLabels: issues.map(i => i.label).join('||').substring(0, 499),
      sessionId: sessionId || '',
    };

    const session = await stripe.checkout.sessions.create({
      line_items: [{
        price_data: {
          currency: chargeCurrency,
          product_data: {
            name: type === 'security_certificate'
              ? 'KloudAudit — Security Blueprint'
              : type === 'bundle'
                ? 'KloudAudit — Cost + Security Bundle'
                : productType === 'ai_blueprint'
                  ? 'KloudAudit — AI Cost Blueprint'
                  : 'KloudAudit — Cost Blueprint',
            description: type === 'security_certificate'
              ? `${provider} security remediation for ${issues.length} flagged issues. CLI commands, IAM policy fixes, compliance mapping. Delivered to ${email} instantly.`
              : type === 'bundle'
                ? `Complete ${provider} cloud health — Cost Blueprint (CLI fixes, Terraform) + Security Blueprint (IAM fixes, compliance mapping). Delivered to ${email} instantly.`
                : `Personalised ${provider} fix guide for ${issues.length} detected issues. CLI commands, Terraform snippets, step-by-step. Delivered to ${email} instantly.`,
            images: ['https://kloudaudit.eu/og-image.png'],
          },
          unit_amount: chargeAmount,
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: email,
      success_url: `${process.env.NEXT_PUBLIC_URL || 'https://kloudaudit.eu'}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_URL || 'https://kloudaudit.eu'}?payment=cancelled`,
      metadata,
      payment_intent_data: { metadata },
    });

    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('Stripe error:', err);
    return res.status(500).json({ error: err.message });
  }
}
