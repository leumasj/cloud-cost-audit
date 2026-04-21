// api/webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const sgMail = require('@sendgrid/mail');
const { GoogleGenerativeAI } = require("@google/generative-ai"); // Changed from Anthropic
const PDFDocument = require('pdfkit');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Initialise Gemini with your API Key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

export const config = { api: { bodyParser: false } };

// --- Keep your existing getRawBody, generatePDF, and buildPrompt functions exactly as they are ---
async function getRawBody(req) { /* ... same as your current file ... */ }
async function generatePDF(data) { /* ... same as your current file ... */ }
function buildPrompt(flaggedIssues, provider, monthlyBill, companyName) { /* ... same as your current file ... */ }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;
  const meta = session.metadata;

  const email = meta.email || session.customer_email;
  const provider = meta.provider || 'AWS';
  const monthlyBill = meta.monthlyBill || '0';
  const companyName = meta.companyName || 'Your Company';
  const savingsMin = meta.savingsMin || '0';
  const savingsMax = meta.savingsMax || '0';
  const flaggedIssueLabels = (meta.flaggedIssueLabels || '').split('||').filter(Boolean);

  try {
    // ── STEP 1: Generate blueprint with Gemini AI ──────────────────────
    console.log('Calling Gemini API...');
    
    const prompt = buildPrompt(flaggedIssueLabels, provider, monthlyBill, companyName);
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const blueprint = response.text();
    
    console.log('Blueprint generated via Gemini, length:', blueprint.length);

    // ── STEP 2: Generate PDF (Remains Unchanged) ───────────────────────────
    const pdfBuffer = await generatePDF({
      companyName, provider, blueprint,
      flaggedIssues: flaggedIssueLabels,
      savingsMin, savingsMax, monthlyBill,
    });

    const pdfBase64 = pdfBuffer.toString('base64');

    // ── STEP 3: Send email via SendGrid (Remains Unchanged) ───────────────
    await sgMail.send({
      to: email,
      from: { email: 'admin@kloudaudit.eu', name: 'Samuel @ KloudAudit' },
      subject: `Your ${provider} Implementation Blueprint is ready ⚡`,
      html: ``,
      attachments: [{
        content: pdfBase64,
        filename: `KloudAudit-Blueprint-${provider}-${Date.now()}.pdf`,
        type: 'application/pdf',
        disposition: 'attachment',
      }],
    });

    return res.status(200).json({ success: true, message: 'Blueprint delivered' });

  } catch (err) {
    console.error('Gemini Blueprint error:', err);
    // Keep your existing error handling to notify admin
    return res.status(500).json({ error: 'Blueprint generation failed' });
  }
}