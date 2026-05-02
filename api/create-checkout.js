// api/create-checkout.js
// Vercel Serverless Function — creates a Stripe Checkout session
// Deploy: this file goes in /api/ at the root of your project



const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async function handler(req, res)  {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, provider, monthlyBill, flaggedIssues, companyName, savingsMin, savingsMax, currency, currencyAmount, productType } = req.body;

    // Multi-currency: use values from frontend, fall back to PLN defaults
    const chargeCurrency = currency || "pln";
    const chargeAmount   = currencyAmount || 29900;

    if (!email || !flaggedIssues || flaggedIssues.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Store audit data in Stripe metadata so we can use it in the webhook
    // Determine product type — routes webhook to correct delivery handler
    const type = productType === 'security_blueprint' ? 'security_certificate' : 'blueprint';

    const metadata = {
      email,
      type,                                   // ← webhook routing key
      provider: provider || 'AWS',
      monthlyBill: String(monthlyBill || 0),
      companyName: companyName || 'Your Company',
      savingsMin: String(savingsMin || 0),
      savingsMax: String(savingsMax || 0),
      flaggedIssueIds:    flaggedIssues.map(i => i.id).join(',').substring(0, 499),
      flaggedIssueLabels: flaggedIssues.map(i => i.label).join('||').substring(0, 499),
    };

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: chargeCurrency,
          product_data: {
            name: type === 'security_certificate'
              ? 'KloudAudit — Security Blueprint'
              : 'KloudAudit — AI Implementation Blueprint',
            description: type === 'security_certificate'
              ? `${provider} security remediation for ${flaggedIssues.length} flagged issues. CLI commands, IAM policy fixes, compliance mapping. Delivered to ${email} instantly.`
              : `Personalised ${provider} fix guide for ${flaggedIssues.length} detected issues. CLI commands, Terraform snippets, step-by-step. Delivered to ${email} instantly.`,
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
