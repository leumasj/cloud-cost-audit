// api/save-audit.js
// KloudAudit — Persist completed audit to Supabase
// Called from frontend after audit completion (email gate) and optionally on skip.
// Anonymous by default — email is optional and only saved if user provides it.

const { createClient } = require('@supabase/supabase-js');
const sentry = require('./lib/sentry');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      sessionId,
      email,
      provider,
      monthlyBill,
      companyName,
      flaggedIds,
      wasteScore,
      savingsMin,
      savingsMax,
      auditType,
    } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }

    const reAuditDue = new Date();
    reAuditDue.setDate(reAuditDue.getDate() + 90);

    const { data, error } = await supabase
      .from('audits')
      .upsert({
        session_id:   sessionId,
        email:        email || null,
        provider:     provider || 'AWS',
        monthly_bill: monthlyBill || 0,
        company_name: companyName || null,
        flagged_ids:  flaggedIds || [],
        waste_score:  wasteScore || 0,
        savings_min:  savingsMin || 0,
        savings_max:  savingsMax || 0,
        audit_type:   auditType || 'cost',
        re_audit_due: reAuditDue.toISOString(),
      }, {
        onConflict: 'session_id',
        ignoreDuplicates: false,
      })
      .select('id')
      .single();

    if (error) throw error;

    if (email) {
      await supabase
        .from('subscribers')
        .upsert({
          email,
          provider:      provider || 'AWS',
          last_audit_id: data.id,
          re_audit_due:  reAuditDue.toISOString(),
          unsubscribed:  false,
        }, {
          onConflict: 'email',
          ignoreDuplicates: false,
        });
    }

    return res.status(200).json({ success: true, auditId: data.id });

  } catch (err) {
    console.error('save-audit error:', err.message);
    sentry.captureException(err, { context: 'save-audit' });
    return res.status(500).json({ error: err.message });
  }
};