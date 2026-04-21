// api/webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const sgMail = require('@sendgrid/mail');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const PDFDocument = require('pdfkit');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Initialise Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

export const config = { api: { bodyParser: false } };

// --- Helper: Read Raw Body ---
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// --- Helper: Generate PDF (Your exact design preserved) ---
async function generatePDF({ companyName, provider, blueprint, flaggedIssues, savingsMin, savingsMax, monthlyBill }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const buffers = [];
    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const GREEN = '#00C896';
    const DARK = '#0A0A14';
    const WHITE = '#FFFFFF';

    // Page 1: Cover
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(DARK);
    doc.fill(GREEN).fontSize(10).font('Helvetica-Bold').text('⚡ KLOUDAUDIT.EU', 50, 60, { characterSpacing: 3 });
    doc.fill(WHITE).fontSize(30).text('AI Implementation Blueprint', 50, 120);
    doc.fill(GREEN).fontSize(18).text(companyName, 50, 200);
    
    // Savings Box
    doc.roundedRect(50, 280, doc.page.width - 100, 80, 8).fill('#00C89615').stroke(GREEN);
    doc.fill(WHITE).fontSize(24).text(`$${Number(savingsMin).toLocaleString()} – $${Number(savingsMax).toLocaleString()} / mo`, 70, 310);

    // Page 2: Content
    doc.addPage();
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(WHITE);
    doc.fill(DARK).fontSize(10).font('Helvetica').text(blueprint, 50, 50, { width: doc.page.width - 100 });
    
    doc.end();
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const meta = session.metadata;

    const email = meta.email || session.customer_email;
    const provider = meta.provider || 'AWS';
    const flaggedIssueLabels = (meta.flaggedIssueLabels || '').split('||').filter(Boolean);

    try {
      // 1. Generate with Gemini
      const prompt = `Generate a technical ${provider} cost optimization blueprint for ${meta.companyName}. Issues: ${flaggedIssueLabels.join(', ')}. Include Terraform and CLI commands.`;
      const result = await model.generateContent(prompt);
      const blueprint = result.response.text();

      // 2. Create PDF
      const pdfBuffer = await generatePDF({
        companyName: meta.companyName, provider, blueprint,
        flaggedIssues: flaggedIssueLabels,
        savingsMin: meta.savingsMin, savingsMax: meta.savingsMax, monthlyBill: meta.monthlyBill
      });

      // 3. Send Email
      await sgMail.send({
        to: email,
        from: { email: 'admin@kloudaudit.eu', name: 'Samuel @ KloudAudit' },
        subject: `Your ${provider} Implementation Blueprint is ready ⚡`,
        text: "Your personalized cloud audit results are attached.",
        attachments: [{
          content: pdfBuffer.toString('base64'),
          filename: `KloudAudit-Blueprint.pdf`,
          type: 'application/pdf',
          disposition: 'attachment',
        }],
      });

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('Processing error:', err);
      return res.status(500).json({ error: 'Failed to generate blueprint' });
    }
  }

  res.status(200).json({ received: true });
}