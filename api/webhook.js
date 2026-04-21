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

// PDF Generator preserving your original design
async function generatePDF(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const buffers = [];
    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    doc.rect(0, 0, 612, 792).fill('#0A0A14');
    doc.fillColor('#00C896').fontSize(25).text('KloudAudit Blueprint', 50, 50);
    doc.fillColor('#ffffff').fontSize(12).text(`Prepared for: ${data.companyName}`, 50, 100);
    doc.moveDown().text(data.blueprint);
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

    try {
      const prompt = `Generate a technical ${meta.provider} cost optimization guide for ${meta.companyName}. Issues: ${meta.flaggedIssueLabels}.`;
      const result = await model.generateContent(prompt);
      const blueprintText = result.response.text();

      const pdfBuffer = await generatePDF({
        companyName: meta.companyName,
        blueprint: blueprintText
      });

      await sgMail.send({
        to: meta.email || session.customer_email,
        from: { email: 'admin@kloudaudit.eu', name: 'KloudAudit' },
        subject: `Your ${meta.provider} Blueprint`,
        attachments: [{
          content: pdfBuffer.toString('base64'),
          filename: 'Blueprint.pdf',
          type: 'application/pdf',
          disposition: 'attachment',
        }],
      });

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Processing failed' });
    }
  }
  res.status(200).json({ received: true });
}