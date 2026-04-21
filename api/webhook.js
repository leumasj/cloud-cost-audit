// api/webhook.js
// Vercel Serverless Function — listens for Stripe payment confirmation
// then calls Claude AI to generate the blueprint, then emails via SendGrid

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const sgMail = require('@sendgrid/mail');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Disable body parsing so we can verify Stripe signature ─────────────────
export const config = { api: { bodyParser: false } };

// ── Read raw body for Stripe signature verification ────────────────────────
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── Generate PDF buffer from AI text ──────────────────────────────────────
async function generatePDF({ companyName, provider, blueprint, flaggedIssues, savingsMin, savingsMax, monthlyBill }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const buffers = [];
    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const GREEN = '#00C896';
    const DARK = '#0A0A14';
    const GRAY = '#64748B';
    const WHITE = '#FFFFFF';

    // ── COVER PAGE ───────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(DARK);
    doc.fill(GREEN).fontSize(10).font('Helvetica-Bold')
       .text('⚡ KLOUDAUDIT.EU', 50, 60, { characterSpacing: 3 });
    doc.fill(WHITE).fontSize(36).font('Helvetica-Bold')
       .text('AI Implementation', 50, 120)
       .text('Blueprint', 50, 165);
    doc.fill(GREEN).fontSize(18).font('Helvetica')
       .text(companyName, 50, 230);
    doc.fill(GRAY).fontSize(12)
       .text(`${provider} · Monthly Bill: $${Number(monthlyBill).toLocaleString()} · Generated: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, 50, 260);

    // Savings box
    doc.roundedRect(50, 310, doc.page.width - 100, 100, 8).fill('#00C89615').stroke(GREEN);
    doc.fill(GREEN).fontSize(11).font('Helvetica-Bold')
       .text('ESTIMATED MONTHLY SAVINGS', 70, 330, { characterSpacing: 2 });
    doc.fill(WHITE).fontSize(32).font('Helvetica-Bold')
       .text(`$${Number(savingsMin).toLocaleString()} – $${Number(savingsMax).toLocaleString()} / month`, 70, 355);
    doc.fill(GRAY).fontSize(11).font('Helvetica')
       .text(`Annual opportunity: $${(Number(savingsMin) * 12).toLocaleString()} – $${(Number(savingsMax) * 12).toLocaleString()}`, 70, 395);

    // Issues summary
    doc.fill(WHITE).fontSize(13).font('Helvetica-Bold').text(`${flaggedIssues.length} Issues Identified:`, 50, 440);
    flaggedIssues.forEach((issue, i) => {
      doc.fill(GRAY).fontSize(11).font('Helvetica')
         .text(`${i + 1}. ${issue}`, 65, 460 + (i * 18), { width: doc.page.width - 130 });
    });

    // Footer
    doc.fill(GRAY).fontSize(9)
       .text('Prepared by Samuel Ayodele Adomeh · KloudAudit.eu · admin@kloudaudit.eu', 50, doc.page.height - 60, { align: 'center', width: doc.page.width - 100 })
       .text('This document is confidential and prepared exclusively for the recipient.', 50, doc.page.height - 44, { align: 'center', width: doc.page.width - 100 });

    // ── CONTENT PAGES ────────────────────────────────────────────────────
    doc.addPage();

    // Reset background to white for content pages
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(WHITE);

    // Header bar
    doc.rect(0, 0, doc.page.width, 50).fill(DARK);
    doc.fill(GREEN).fontSize(9).font('Helvetica-Bold')
       .text('⚡ KLOUDAUDIT · AI IMPLEMENTATION BLUEPRINT', 50, 18, { characterSpacing: 2 });
    doc.fill(GRAY).fontSize(9).font('Helvetica')
       .text(companyName, 0, 18, { align: 'right', width: doc.page.width - 50 });

    // Content
    doc.fill(DARK).fontSize(11).font('Helvetica').moveDown(3);

    // Parse and render blueprint sections
    const lines = blueprint.split('\n');
    let y = 70;
    const pageBottom = doc.page.height - 70;
    const leftMargin = 50;
    const contentWidth = doc.page.width - 100;

    const addPage = () => {
      doc.addPage();
      doc.rect(0, 0, doc.page.width, doc.page.height).fill(WHITE);
      doc.rect(0, 0, doc.page.width, 50).fill(DARK);
      doc.fill(GREEN).fontSize(9).font('Helvetica-Bold')
         .text('⚡ KLOUDAUDIT · AI IMPLEMENTATION BLUEPRINT', 50, 18, { characterSpacing: 2 });
      y = 70;
    };

    lines.forEach(line => {
      if (y > pageBottom) addPage();
      const trimmed = line.trim();
      if (!trimmed) { y += 8; return; }

      // H1 - lines starting with #
      if (trimmed.startsWith('# ')) {
        if (y > pageBottom - 40) addPage();
        doc.rect(leftMargin, y, contentWidth, 32).fill('#F0FDF9');
        doc.fill(GREEN).fontSize(14).font('Helvetica-Bold')
           .text(trimmed.replace('# ', ''), leftMargin + 10, y + 8, { width: contentWidth - 20 });
        y += 44;
        return;
      }
      // H2 - lines starting with ##
      if (trimmed.startsWith('## ')) {
        if (y > pageBottom - 30) addPage();
        doc.fill(DARK).fontSize(12).font('Helvetica-Bold')
           .text(trimmed.replace('## ', ''), leftMargin, y, { width: contentWidth });
        doc.moveTo(leftMargin, y + 18).lineTo(leftMargin + contentWidth, y + 18).stroke(GREEN);
        y += 28;
        return;
      }
      // H3 - lines starting with ###
      if (trimmed.startsWith('### ')) {
        if (y > pageBottom - 25) addPage();
        doc.fill('#1E3A5F').fontSize(11).font('Helvetica-Bold')
           .text(trimmed.replace('### ', ''), leftMargin, y, { width: contentWidth });
        y += 20;
        return;
      }
      // Code blocks
      if (trimmed.startsWith('```')) { y += 4; return; }
      if (trimmed.startsWith('    ') || (trimmed.match(/^(aws |gcloud |az |terraform |kubectl )/))) {
        if (y > pageBottom - 20) addPage();
        doc.rect(leftMargin, y - 2, contentWidth, 18).fill('#F8FAFC');
        doc.fill('#1E40AF').fontSize(9).font('Courier')
           .text(trimmed, leftMargin + 8, y, { width: contentWidth - 16 });
        y += 20;
        return;
      }
      // Bullet points
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        if (y > pageBottom - 18) addPage();
        doc.fill(GREEN).fontSize(10).font('Helvetica-Bold').text('•', leftMargin, y);
        doc.fill(DARK).fontSize(10).font('Helvetica')
           .text(trimmed.replace(/^[-*] /, ''), leftMargin + 14, y, { width: contentWidth - 14 });
        const textHeight = doc.heightOfString(trimmed.replace(/^[-*] /, ''), { width: contentWidth - 14, fontSize: 10 });
        y += Math.max(textHeight + 4, 16);
        return;
      }
      // Numbered list
      if (trimmed.match(/^\d+\./)) {
        if (y > pageBottom - 18) addPage();
        doc.fill(GREEN).fontSize(10).font('Helvetica-Bold').text(trimmed.match(/^\d+\./)[0], leftMargin, y);
        doc.fill(DARK).fontSize(10).font('Helvetica')
           .text(trimmed.replace(/^\d+\.\s*/, ''), leftMargin + 20, y, { width: contentWidth - 20 });
        const textHeight = doc.heightOfString(trimmed.replace(/^\d+\.\s*/, ''), { width: contentWidth - 20, fontSize: 10 });
        y += Math.max(textHeight + 4, 16);
        return;
      }
      // Bold text **...**
      const boldText = trimmed.replace(/\*\*(.*?)\*\*/g, '$1');
      if (y > pageBottom - 18) addPage();
      const isBold = trimmed.includes('**');
      doc.fill(DARK).fontSize(10).font(isBold ? 'Helvetica-Bold' : 'Helvetica')
         .text(boldText, leftMargin, y, { width: contentWidth });
      const textHeight = doc.heightOfString(boldText, { width: contentWidth, fontSize: 10 });
      y += Math.max(textHeight + 4, 16);
    });

    // Final page footer
    doc.fill(GRAY).fontSize(9).font('Helvetica')
       .text('KloudAudit.eu · admin@kloudaudit.eu · Samuel Ayodele Adomeh', leftMargin, doc.page.height - 50, { align: 'center', width: contentWidth });

    doc.end();
  });
}

// ── Build the AI prompt ────────────────────────────────────────────────────
function buildPrompt(flaggedIssues, provider, monthlyBill, companyName) {
  return `You are a senior DevOps and FinOps engineer writing an implementation blueprint for ${companyName}.

Their ${provider} cloud bill is $${monthlyBill}/month and these specific issues were detected in their infrastructure audit:

${flaggedIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

Write a comprehensive, step-by-step technical implementation guide to fix ALL of these issues.

FORMAT REQUIREMENTS:
- Use markdown headers (# for main sections, ## for subsections, ### for steps)
- Include exact CLI commands for ${provider} (formatted as code on their own line)
- Include Terraform snippets where applicable
- Each fix should have: Problem → Solution → Commands → Verification → Expected savings
- Be specific, not generic. These are real production issues.
- Tone: expert DevOps engineer writing for another engineer

STRUCTURE:
# Executive Summary
## Quick Wins (Do Today)
# Issue-by-Issue Fix Guide
## [Issue Name]
### The Problem
### The Fix
### CLI Commands
### Terraform (if applicable)  
### Verify it worked
### Expected monthly saving

# 30-Day Monitoring Plan
# Cost Baseline & KPIs to Track

Write the complete guide now. Be thorough and technically precise.`;
}

// ── Main webhook handler ───────────────────────────────────────────────────
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

  // Only process successful payments
  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;
  const meta = session.metadata;

  // Extract data from Stripe metadata
  const email = meta.email || session.customer_email;
  const provider = meta.provider || 'AWS';
  const monthlyBill = meta.monthlyBill || '0';
  const companyName = meta.companyName || 'Your Company';
  const savingsMin = meta.savingsMin || '0';
  const savingsMax = meta.savingsMax || '0';
  const flaggedIssueLabels = (meta.flaggedIssueLabels || '').split('||').filter(Boolean);

  console.log(`Processing blueprint for ${email} | ${provider} | ${flaggedIssueLabels.length} issues`);

  try {
    // ── STEP 1: Generate blueprint with Claude AI ──────────────────────
    console.log('Calling Claude API...');
    const aiResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: buildPrompt(flaggedIssueLabels, provider, monthlyBill, companyName),
      }],
    });

    const blueprint = aiResponse.content[0].text;
    console.log('Blueprint generated, length:', blueprint.length);

    // ── STEP 2: Generate PDF ───────────────────────────────────────────
    console.log('Generating PDF...');
    const pdfBuffer = await generatePDF({
      companyName, provider, blueprint,
      flaggedIssues: flaggedIssueLabels,
      savingsMin, savingsMax, monthlyBill,
    });

    const pdfBase64 = pdfBuffer.toString('base64');
    console.log('PDF generated, size:', pdfBuffer.length, 'bytes');

    // ── STEP 3: Send email via SendGrid ───────────────────────────────
    console.log('Sending email via SendGrid...');
    await sgMail.send({
      to: email,
      from: {
        email: 'admin@kloudaudit.eu',
        name: 'Samuel @ KloudAudit',
      },
      replyTo: 'admin@kloudaudit.eu',
      subject: `Your ${provider} Implementation Blueprint is ready ⚡`,
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="margin:0;padding:0;background:#f8fafc;font-family:'DM Sans',Arial,sans-serif">
          <div style="max-width:600px;margin:0 auto;background:#fff">
            <!-- Header -->
            <div style="background:#0a0a14;padding:32px 40px;text-align:center">
              <div style="display:inline-block;background:#00ffb4;border-radius:8px;padding:6px 14px;margin-bottom:16px">
                <span style="color:#000;font-weight:800;font-size:14px;letter-spacing:2px">⚡ KLOUDAUDIT</span>
              </div>
              <h1 style="color:#fff;font-size:28px;font-weight:800;margin:0;letter-spacing:-1px">Your Blueprint is Ready</h1>
              <p style="color:#64748b;font-size:15px;margin:10px 0 0">AI-generated · ${provider} · ${flaggedIssueLabels.length} issues fixed</p>
            </div>

            <!-- Body -->
            <div style="padding:40px">
              <p style="color:#0f172a;font-size:16px;line-height:1.6;margin:0 0 20px">Hello,</p>
              <p style="color:#0f172a;font-size:16px;line-height:1.6;margin:0 0 20px">
                Your personalised <strong>${provider} Implementation Blueprint</strong> is attached to this email as a PDF. 
                It covers all <strong>${flaggedIssueLabels.length} issues</strong> detected in your audit with exact CLI commands, 
                Terraform snippets, and step-by-step instructions.
              </p>

              <!-- Savings box -->
              <div style="background:#f0fdf9;border:2px solid #00c896;border-radius:12px;padding:24px;margin:24px 0;text-align:center">
                <p style="color:#64748b;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px">Estimated Monthly Savings</p>
                <p style="color:#00c896;font-size:32px;font-weight:800;margin:0;letter-spacing:-1px">
                  $${Number(savingsMin).toLocaleString()} – $${Number(savingsMax).toLocaleString()} / month
                </p>
                <p style="color:#64748b;font-size:13px;margin:8px 0 0">
                  Annual opportunity: $${(Number(savingsMin) * 12).toLocaleString()}+
                </p>
              </div>

              <!-- Issues list -->
              <p style="color:#0f172a;font-size:15px;font-weight:700;margin:0 0 12px">Issues addressed in your blueprint:</p>
              <ul style="margin:0 0 24px;padding:0 0 0 20px">
                ${flaggedIssueLabels.map(issue => `<li style="color:#475569;font-size:14px;line-height:1.8">${issue}</li>`).join('')}
              </ul>

              <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 32px">
                If you have any questions or need help implementing any of the fixes, reply directly to this email. 
                I personally review all replies and typically respond within a few hours.
              </p>

              <!-- CTA -->
              <div style="text-align:center;margin:32px 0">
                <a href="https://kloudaudit.eu" style="background:#00ffb4;color:#000;font-weight:800;font-size:15px;padding:14px 32px;border-radius:10px;text-decoration:none;display:inline-block">
                  Run Another Audit →
                </a>
              </div>
            </div>

            <!-- Footer -->
            <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:24px 40px;text-align:center">
              <p style="color:#94a3b8;font-size:12px;margin:0 0 4px">
                Samuel Ayodele Adomeh · Senior DevOps Engineer
              </p>
              <p style="color:#94a3b8;font-size:12px;margin:0">
                <a href="https://kloudaudit.eu" style="color:#00c896;text-decoration:none">kloudaudit.eu</a> · 
                <a href="mailto:admin@kloudaudit.eu" style="color:#00c896;text-decoration:none">admin@kloudaudit.eu</a>
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
      attachments: [{
        content: pdfBase64,
        filename: `KloudAudit-Blueprint-${provider}-${Date.now()}.pdf`,
        type: 'application/pdf',
        disposition: 'attachment',
      }],
    });

    console.log(`✅ Blueprint delivered to ${email}`);
    return res.status(200).json({ success: true, message: 'Blueprint generated and delivered' });

  } catch (err) {
    console.error('Blueprint generation error:', err);
    // Send error notification email to admin
    try {
      await sgMail.send({
        to: 'admin@kloudaudit.eu',
        from: { email: 'admin@kloudaudit.eu', name: 'KloudAudit System' },
        subject: `⚠️ Blueprint generation failed for ${email}`,
        text: `Payment succeeded but blueprint failed for ${email}. Error: ${err.message}. Manual action required.`,
      });
    } catch (e) { console.error('Failed to send admin alert:', e); }

    return res.status(500).json({ error: 'Blueprint generation failed' });
  }
}
