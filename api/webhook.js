// api/webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const sgMail = require('@sendgrid/mail');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
      doc.on('error', (err) => reject(new Error(`PDF Generation Error: ${err.message}`)));

      const GREEN = '#00c896';
      doc.fillColor('#080810').rect(0, 0, 612, 792).fill();
      doc.fillColor(GREEN).fontSize(24).text('KloudAudit Blueprint', 50, 50);
      doc.moveDown().fillColor('#ffffff').fontSize(12).text(`Prepared for: ${data.companyName}`);
      doc.text(`Provider: ${data.provider}`);
      doc.text(`Estimated Savings: $${data.savingsMin} - $${data.savingsMax}/mo`);
      doc.moveDown().text(data.blueprint);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];
  let event;

  // 1. STRIPE VERIFICATION BLOCK
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log('✅ Stripe Webhook Verified');
  } catch (err) {
    console.error(`❌ Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { email, provider, companyName, savingsMin, savingsMax, monthlyBill, flaggedIssueLabels } = session.metadata;

    try {
      console.log(`🤖 Starting AI Generation for ${email}...`);
      
      // 2. AI GENERATION BLOCK
      const msg = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20240620",
        max_tokens: 4000,
        messages: [{
          role: "user",
          content: `Generate a cloud cost optimization blueprint for ${companyName} on ${provider}. 
          Current monthly bill: $${monthlyBill}. 
          Issues to fix: ${flaggedIssueLabels}. 
          Provide Terraform snippets and CLI commands.`
        }]
      });

      const blueprintText = msg.content[0].text;
      console.log('✅ AI Content Generated');

      // 3. PDF GENERATION BLOCK
      const pdfBuffer = await generatePDF({
        companyName, provider, blueprint: blueprintText, 
        savingsMin, savingsMax, monthlyBill
      });
      const pdfBase64 = pdfBuffer.toString('base64');
      console.log('✅ PDF Buffer Created');

      // 4. SENDGRID EMAIL BLOCK
      await sgMail.send({
        to: email,
        from: { email: 'admin@kloudaudit.eu', name: 'KloudAudit' },
        subject: `Your ${provider} Implementation Blueprint — ${companyName}`,
        html: `<h1>Your Blueprint is ready.</h1><p>Find your custom guide attached.</p>`,
        attachments: [{
          content: pdfBase64,
          filename: `KloudAudit-Blueprint.pdf`,
          type: 'application/pdf',
          disposition: 'attachment',
        }],
      });

      console.log(`🚀 Success: Delivered to ${email}`);
      return res.status(200).json({ success: true });

    } catch (err) {
      console.error('🔥 Webhook Execution Failure:', err);
      
      // FALLBACK: Email YOU if it fails so you can manually fix it for the customer
      await sgMail.send({
        to: 'admin@kloudaudit.eu',
        from: 'admin@kloudaudit.eu',
        subject: `⚠️ CRITICAL: Webhook Failed for ${email}`,
        text: `The customer paid 299 PLN but the email failed. Error: ${err.message}. Data: ${JSON.stringify(session.metadata)}`
      });

      return res.status(500).json({ error: 'Internal processing failed but payment was logged.' });
    }
  }

  res.status(200).json({ received: true });
}