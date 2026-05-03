// api/save-audit.js
// KloudAudit — Persist completed audit to Supabase
// Called from frontend after audit completion (email gate) and optionally on skip.
// Anonymous by default — email is optional and only saved if user provides it.

const { createClient } = require('@supabase/supabase-js');

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
      sessionId,      // anonymous ID from localStorage — identifies returning users
      email,          // optional — only if provided at email gate
      provider,       // AWS | GCP | Azure | Multi-Cloud
      monthlyBill,
      companyName,
      flaggedIds,     // array of check IDs
      wasteScore,     // 0-100
      savingsMin,
      savingsMax,
      auditType,      // 'cost' | 'security'
    } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }

    // Calculate re-audit due date (90 days from now)
    const reAuditDue = new Date();
    reAuditDue.setDate(reAuditDue.getDate() + 90);

    // Upsert — if same session runs audit again, update the record
    const { data, error } = await supabase
      .from('audits')
      .upsert({
        session_id:    sessionId,
        email:         email || null,
        provider:      provider || 'AWS',
        monthly_bill:  monthlyBill || 0,
        company_name:  companyName || null,
        flagged_ids:   flaggedIds || [],
        waste_score:   wasteScore || 0,
        savings_min:   savingsMin || 0,
        savings_max:   savingsMax || 0,
        audit_type:    auditType || 'cost',
        re_audit_due:  reAuditDue.toISOString(),
      }, {
        onConflict: 'session_id',
        ignoreDuplicates: false, // update on conflict
      })
      .select('id')
      .single();

    if (error) throw error;

    // If email provided, upsert subscriber record for 90-day reminder
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
    // Non-critical — audit save failure should never block the user experience
    console.error('save-audit error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
