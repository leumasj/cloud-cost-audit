// api/create-checkout.js
// Vercel Serverless Function — creates a Stripe Checkout session
// Deploy: this file goes in /api/ at the root of your project

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, provider, monthlyBill, flaggedIssues, companyName, savingsMin, savingsMax } = req.body;

    if (!email || !flaggedIssues || flaggedIssues.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Store audit data in Stripe metadata so we can use it in the webhook
    const metadata = {
      email,
      provider: provider || 'AWS',
      monthlyBill: String(monthlyBill || 0),
      companyName: companyName || 'Your Company',
      savingsMin: String(savingsMin || 0),
      savingsMax: String(savingsMax || 0),
      // Store flagged issue IDs as comma-separated string (Stripe metadata limit: 500 chars per value)
      flaggedIssueIds: flaggedIssues.map(i => i.id).join(',').substring(0, 499),
      // Store issue labels separately
      flaggedIssueLabels: flaggedIssues.map(i => i.label).join('||').substring(0, 499),
    };

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'pln',
          product_data: {
            name: 'KloudAudit — AI Implementation Blueprint',
            description: `Personalised ${provider} fix guide for ${flaggedIssues.length} detected issues. CLI commands, Terraform snippets, step-by-step. Delivered to ${email} instantly.`,
            images: ['https://kloudaudit.eu/og-image.png'],
          },
          unit_amount: 29900, // 299 PLN in groszy
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
