// api/webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const sgMail = require('@sendgrid/mail');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const PDFDocument = require('pdfkit');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);
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

async function generatePDF(data) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // Simple Professional Design
      doc.rect(0, 0, 612, 792).fill('#080810');
      doc.fillColor('#00ffb4').fontSize(24).text('KloudAudit Blueprint', 50, 50);
      doc.fillColor('#ffffff').fontSize(14).text(`Company: ${data.companyName}`, 50, 100);
      doc.text(`Provider: ${data.provider}`, 50, 125);
      doc.moveDown().fontSize(11).text(data.blueprint, { width: 500 });
      doc.end();
    } catch (e) { reject(e); }
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log('✅ Webhook Verified');
  } catch (err) {
    console.error('❌ Signature Verification Failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const meta = session.metadata;

    // Check if metadata exists
    if (!meta || !meta.email) {
      console.error('❌ Missing Metadata in Session');
      return res.status(400).json({ error: "Missing metadata" });
    }

    try {
      console.log(`🤖 Requesting Gemini for: ${meta.email}`);
      const prompt = `Generate a technical ${meta.provider} cloud cost optimization guide for ${meta.companyName}. Monthly bill: $${meta.monthlyBill}. Issues: ${meta.flaggedIssueLabels}. Provide Terraform snippets.`;
      
      const result = await model.generateContent(prompt);
      const blueprintText = result.response.text();
      console.log('✅ Gemini Response Received');

      const pdfBuffer = await generatePDF({
        companyName: meta.companyName,
        provider: meta.provider,
        blueprint: blueprintText
      });
      console.log('✅ PDF Created');

      await sgMail.send({
        to: meta.email,
        from: { email: 'admin@kloudaudit.eu', name: 'KloudAudit' },
        subject: `Your ${meta.provider} Blueprint is ready!`,
        text: 'Your custom cloud audit blueprint is attached.',
        attachments: [{
          content: pdfBuffer.toString('base64'),
          filename: 'KloudAudit-Blueprint.pdf',
          type: 'application/pdf',
          disposition: 'attachment',
        }],
      });

      console.log('🚀 Email Sent Successfully to', meta.email);
      return res.status(200).json({ success: true });

    } catch (err) {
      console.error('🔥 Fatal Webhook Error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(200).json({ received: true });
}