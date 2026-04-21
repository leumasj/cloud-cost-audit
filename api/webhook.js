const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const sgMail = require('@sendgrid/mail');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const PDFDocument = require('pdfkit');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// ── Configuration & Error Checking ────────────────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── Generate PDF (Preserving your exact design logic) ─────────────────────
async function generatePDF(data) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      doc.rect(0, 0, 612, 792).fill('#0A0A14');
      doc.fillColor('#00C896').fontSize(24).text('KloudAudit Blueprint', 50, 50);
      doc.fillColor('#ffffff').fontSize(14).text(`Company: ${data.companyName}`, 50, 100);
      doc.moveDown().fontSize(10).text(data.blueprint, { width: 500 });
      doc.end();
    } catch (e) { reject(e); }
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  
  // 1. Verify API Keys Exist
  if (!process.env.GEMINI_API_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("❌ CRITICAL: Missing Environment Variables");
    return res.status(500).json({ error: "Server configuration error" });
  }

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('❌ Stripe Signature Fail:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const meta = session.metadata || {};

    const email = meta.email || session.customer_email;
    const provider = meta.provider || 'Cloud';
    const companyName = meta.companyName || 'Valued Customer';

    try {
      console.log(`⏳ Step 1: Requesting Gemini for ${email}...`);
      
      const prompt = `Generate a cloud cost optimization guide for ${companyName} on ${provider}. Issues: ${meta.flaggedIssueLabels || 'General Optimization'}.`;
      
      const result = await model.generateContent(prompt);
      
      // FIX: New Gemini SDK response handling
      const response = await result.response;
      const blueprintText = response.text(); 
      
      if (!blueprintText) throw new Error("Gemini returned empty text");
      console.log('✅ Step 1: Gemini Success');

      console.log('⏳ Step 2: Generating PDF...');
      const pdfBuffer = await generatePDF({
        companyName,
        provider,
        blueprint: blueprintText
      });
      console.log('✅ Step 2: PDF Success');

      console.log('⏳ Step 3: Sending Email...');
      await sgMail.send({
        to: email,
        from: { email: 'admin@kloudaudit.eu', name: 'KloudAudit' },
        subject: `Your ${provider} Blueprint is ready ⚡`,
        text: 'Your custom cloud blueprint is attached.',
        attachments: [{
          content: pdfBuffer.toString('base64'),
          filename: 'KloudAudit-Blueprint.pdf',
          type: 'application/pdf',
          disposition: 'attachment',
        }],
      });

      console.log('🚀 Step 3: Email Delivered to', email);
      return res.status(200).json({ success: true });

    } catch (err) {
      console.error('🔥 Webhook Execution Failed:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(200).json({ received: true });
}