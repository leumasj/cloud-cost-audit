// api/dashboard.js
// KloudAudit — Admin Analytics Dashboard
// Password protected. Returns HTML with real-time stats from Supabase.
// Access at: https://www.kloudaudit.eu/api/dashboard?key=YOUR_DASHBOARD_SECRET
//
// Set DASHBOARD_SECRET to a value distinct from CRON_SECRET — the cron
// secret also gates process-pending.js/email.js, and reusing it here means
// a leak of either one (e.g. via a cron scheduler's logs) grants the other.
// Falls back to CRON_SECRET if DASHBOARD_SECRET isn't set, so this keeps
// working until you configure a dedicated one.

const { createClient } = require('@supabase/supabase-js');

// first 3 chars of local part + *** + @domain  e.g. "sam***@example.com"
function maskEmail(email) {
  if (!email) return '—';
  const at = email.indexOf('@');
  if (at < 0) return '***';
  return `${email.slice(0, 3)}***@${email.slice(at + 1)}`;
}

module.exports = async function handler(req, res) {
  // Simple key auth — prefers a dedicated DASHBOARD_SECRET, falls back to
  // CRON_SECRET only if that isn't configured (see header comment).
  const key = req.query.key;
  const dashboardSecret = process.env.DASHBOARD_SECRET || process.env.CRON_SECRET;
  if (!key || !dashboardSecret || key !== dashboardSecret) {
    return res.status(401).send(`
      <html><body style="background:#07070f;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <div style="text-align:center;">
          <h2 style="color:#f87171;">Access denied</h2>
          <p style="color:#475569;">Add ?key=YOUR_DASHBOARD_SECRET to the URL</p>
        </div>
      </body></html>
    `);
  }

  // Create Supabase client INSIDE the handler function
  // This prevents early connection attempts blocked by Vercel
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  );

  try {
    const now      = new Date();
    const day7ago  = new Date(now - 7  * 86400000).toISOString();
    const day30ago = new Date(now - 30 * 86400000).toISOString();

    // Fetch all stats in parallel
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const [
      { count: totalAudits },
      { count: audits7d },
      { count: totalSubscribers },
      { count: blueprintsPaid },
      { data: providerBreakdown },
      { data: recentAudits },
      { data: deliveryStats },
      { data: cacheStats },
      { data: failedJobs },
      { data: stuckJobs },
    ] = await Promise.all([
      supabaseAdmin.from('audits').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('audits').select('*', { count: 'exact', head: true }).gte('created_at', day7ago),
      supabaseAdmin.from('subscribers').select('*', { count: 'exact', head: true }).eq('unsubscribed', false),
      supabaseAdmin.from('audits').select('*', { count: 'exact', head: true }).eq('blueprint_paid', true),
      supabaseAdmin.from('audits').select('provider').then(({ data }) => {
        const counts = {};
        (data || []).forEach(a => { const provider = a.provider === 'Multi-cloud' ? 'Multi-Cloud' : a.provider; counts[provider] = (counts[provider] || 0) + 1; });
        return { data: Object.entries(counts).sort((a,b) => b[1]-a[1]) };
      }),
      Promise.all([
        supabaseAdmin.from('audits')
          .select('id, created_at, email, provider, monthly_bill, waste_score, savings_min, savings_max, blueprint_paid, audit_type')
          .eq('blueprint_paid', true)
          .order('created_at', { ascending: false })
          .limit(5),
        supabaseAdmin.from('audits')
          .select('id, created_at, email, provider, monthly_bill, waste_score, savings_min, savings_max, blueprint_paid, audit_type')
          .order('created_at', { ascending: false })
          .limit(10),
      ]).then(([{ data: paid }, { data: recent }]) => {
        const seen = new Set();
        const merged = [];
        for (const a of [...(paid || []), ...(recent || [])]) {
          if (!seen.has(a.id)) { seen.add(a.id); merged.push(a); }
        }
        return { data: merged };
      }),
      supabaseAdmin.from('delivery_queue').select('status').then(({ data }) => {
        const counts = { pending: 0, processing: 0, delivered: 0, failed: 0 };
        (data || []).forEach(d => { counts[d.status] = (counts[d.status] || 0) + 1; });
        return { data: counts };
      }),
      supabaseAdmin.from('report_cache').select('hit_count, product_type').then(({ data }) => {
        const total = (data || []).reduce((s, r) => s + r.hit_count, 0);
        const entries = (data || []).length;
        return { data: { total, entries } };
      }),
      // Failed deliveries
      supabaseAdmin.from('delivery_queue')
        .select('id, email, product_type, attempts, created_at, error_message')
        .eq('status', 'failed')
        .order('created_at', { ascending: false })
        .limit(20),
      // Stuck jobs — pending for more than 1 hour
      supabaseAdmin.from('delivery_queue')
        .select('id, email, product_type, attempts, created_at')
        .eq('status', 'pending')
        .lt('created_at', oneHourAgo),
    ]);

    const convRate = totalAudits > 0 ? ((blueprintsPaid / totalAudits) * 100).toFixed(1) : '0.0';
    const avgWaste = recentAudits?.length > 0
      ? Math.round(recentAudits.filter(a => a.waste_score > 0).reduce((s, a) => s + a.waste_score, 0) / recentAudits.filter(a => a.waste_score > 0).length)
      : 0;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>KloudAudit Dashboard</title>
<meta name="robots" content="noindex,nofollow">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#07070f;color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;padding:32px 24px;min-height:100vh}
  .header{display:flex;align-items:center;gap:12px;margin-bottom:36px;padding-bottom:20px;border-bottom:1px solid rgba(255,255,255,0.08)}
  .logo{width:36px;height:36px;background:#00ffb4;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
  h1{font-size:20px;font-weight:800;letter-spacing:-0.5px}
  .ts{font-size:12px;color:#475569;margin-left:auto}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:28px}
  .card{background:#111827;border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:20px}
  .card-label{font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
  .card-value{font-size:32px;font-weight:800;letter-spacing:-1.5px;line-height:1;margin-bottom:4px}
  .card-sub{font-size:11px;color:#334155}
  .green{color:#00ffb4} .red{color:#f87171} .blue{color:#818cf8} .yellow{color:#fbbf24} .white{color:#fff}
  .section{background:#111827;border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:20px;margin-bottom:20px}
  .section h2{font-size:14px;font-weight:700;color:#fff;margin-bottom:16px;letter-spacing:-0.2px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{text-align:left;color:#334155;font-weight:600;padding:0 8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.8px}
  td{padding:8px;border-bottom:1px solid rgba(255,255,255,0.04);color:#94a3b8;vertical-align:middle}
  td:first-child{color:#fff;font-weight:600}
  tr:last-child td{border-bottom:none}
  .badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700}
  .badge-green{background:rgba(0,255,180,0.1);color:#00ffb4;border:1px solid rgba(0,255,180,0.2)}
  .badge-red{background:rgba(248,113,113,0.1);color:#f87171;border:1px solid rgba(248,113,113,0.2)}
  .badge-blue{background:rgba(129,140,248,0.1);color:#818cf8;border:1px solid rgba(129,140,248,0.2)}
  .badge-gray{background:rgba(255,255,255,0.04);color:#64748b;border:1px solid rgba(255,255,255,0.08)}
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  @media(max-width:640px){.two-col{grid-template-columns:1fr}}
  .refresh{color:#475569;font-size:12px;cursor:pointer;text-decoration:underline}
</style>
</head>
<body>
<div style="max-width:1100px;margin:0 auto">

  <div class="header">
    <div class="logo">⚡</div>
    <div>
      <h1>KloudAudit Analytics</h1>
      <div style="font-size:12px;color:#334155;margin-top:2px">Admin Dashboard · Live data from Supabase</div>
    </div>
    <div class="ts">${now.toLocaleString('en-GB', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} Warsaw · <span class="refresh" onclick="location.reload()">Refresh</span></div>
  </div>

  <!-- KPI Row -->
  <div class="grid">
    <div class="card">
      <div class="card-label">Total Audits</div>
      <div class="card-value white">${totalAudits || 0}</div>
      <div class="card-sub">+${audits7d || 0} last 7 days</div>
    </div>
    <div class="card">
      <div class="card-label">Blueprints Sold</div>
      <div class="card-value green">${blueprintsPaid || 0}</div>
      <div class="card-sub">${convRate}% conversion rate</div>
    </div>
    <div class="card">
      <div class="card-label">Email Subscribers</div>
      <div class="card-value blue">${totalSubscribers || 0}</div>
      <div class="card-sub">Active re-audit reminders</div>
    </div>
    <div class="card">
      <div class="card-label">Cache Hits</div>
      <div class="card-value yellow">${cacheStats?.entries || 0}</div>
      <div class="card-sub">${cacheStats?.total || 0} total cache hits</div>
    </div>
    <div class="card">
      <div class="card-label">Delivery Queue</div>
      <div class="card-value ${(deliveryStats?.pending || 0) > 0 ? 'yellow' : 'green'}">${deliveryStats?.pending || 0}</div>
      <div class="card-sub">Pending · ${deliveryStats?.delivered || 0} delivered · ${deliveryStats?.failed || 0} failed</div>
    </div>
  </div>

  <div class="two-col">
    <!-- Provider breakdown -->
    <div class="section">
      <h2>Audits by Provider</h2>
      <table>
        <thead><tr><th>Provider</th><th>Count</th><th>Share</th></tr></thead>
        <tbody>
          ${(providerBreakdown || []).map(([p, c]) => `
            <tr>
              <td>${p}</td>
              <td>${c}</td>
              <td><div style="height:6px;background:rgba(255,255,255,0.06);border-radius:3px;width:120px;overflow:hidden"><div style="height:100%;width:${Math.round((c/(totalAudits||1))*100)}%;background:#00ffb4;border-radius:3px"></div></div></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <!-- Delivery queue health -->
    <div class="section">
      <h2>Delivery Queue Health</h2>
      <table>
        <thead><tr><th>Status</th><th>Count</th></tr></thead>
        <tbody>
          <tr><td><span class="badge badge-green">Delivered</span></td><td>${deliveryStats?.delivered || 0}</td></tr>
          <tr><td><span class="badge badge-blue">Pending</span></td><td>${deliveryStats?.pending || 0}</td></tr>
          <tr><td><span class="badge badge-gray">Processing</span></td><td>${deliveryStats?.processing || 0}</td></tr>
          <tr><td><span class="badge badge-red">Failed</span></td><td>${deliveryStats?.failed || 0}</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Delivery Failures -->
  ${(failedJobs?.length || stuckJobs?.length) ? `
  <div class="section" style="border-color:rgba(248,113,113,0.25)">
    <h2 style="display:flex;align-items:center;gap:10px">
      ⚠️ Delivery Health
      ${failedJobs?.length ? `<span class="badge badge-red">${failedJobs.length} failed</span>` : ''}
      ${stuckJobs?.length ? `<span class="badge badge-gray">${stuckJobs.length} stuck</span>` : ''}
    </h2>

    ${failedJobs?.length ? `
    <p style="font-size:11px;font-weight:700;color:#f87171;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Failed Jobs</p>
    <table style="margin-bottom:20px">
      <thead><tr><th>Date</th><th>Email</th><th>Product</th><th>Attempts</th><th>Error</th></tr></thead>
      <tbody>
        ${failedJobs.map(j => `
          <tr>
            <td style="font-size:11px">${new Date(j.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
            <td style="font-family:monospace;font-size:11px">${maskEmail(j.email)}</td>
            <td><span class="badge badge-gray">${j.product_type}</span></td>
            <td style="color:${j.attempts >= 3 ? '#f87171' : '#fbbf24'}">${j.attempts}/${3}</td>
            <td style="font-size:11px;color:#f87171;max-width:300px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${j.error_message || '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ` : ''}

    ${stuckJobs?.length ? `
    <p style="font-size:11px;font-weight:700;color:#fbbf24;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Stuck Jobs (pending &gt; 1 hour)</p>
    <table>
      <thead><tr><th>Date</th><th>Email</th><th>Product</th><th>Attempts</th></tr></thead>
      <tbody>
        ${stuckJobs.map(j => `
          <tr>
            <td style="font-size:11px">${new Date(j.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
            <td style="font-family:monospace;font-size:11px">${maskEmail(j.email)}</td>
            <td><span class="badge badge-gray">${j.product_type}</span></td>
            <td style="color:#fbbf24">${j.attempts}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ` : ''}
  </div>
  ` : ''}

  <!-- Recent audits -->
  <div class="section">
    <h2>Recent Audits (last 10)</h2>
    <table>
      <thead><tr><th>Date</th><th>Email</th><th>Provider</th><th>Bill/mo</th><th>Waste Score</th><th>Savings Found</th><th>Type</th><th>Blueprint</th></tr></thead>
      <tbody>
        ${(recentAudits || []).map(a => `
          <tr>
            <td>${new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
            <td style="font-family:monospace;font-size:11px">${maskEmail(a.email)}</td>
            <td>${a.provider || '—'}</td>
            <td>$${Number(a.monthly_bill || 0).toLocaleString()}</td>
            <td>
              <span style="color:${a.waste_score >= 70 ? '#4ade80' : a.waste_score >= 50 ? '#fbbf24' : '#f87171'};font-weight:700">
                ${a.waste_score ? `${a.waste_score}/100` : '<span style="color:#475569;font-size:11px">incomplete</span>'}
              </span>
            </td>
            <td style="color:#00ffb4">$${Number(a.savings_min || 0).toLocaleString()}–$${Number(a.savings_max || 0).toLocaleString()}</td>
            <td><span class="badge ${a.audit_type === 'security' ? 'badge-red' : 'badge-blue'}">${a.audit_type || 'cost'}</span></td>
            <td>${a.blueprint_paid ? '<span class="badge badge-green">✓ Paid</span>' : '<span class="badge badge-gray">Free</span>'}</td>
          </tr>
        `).join('')}
        ${(!recentAudits || recentAudits.length === 0) ? '<tr><td colspan="7" style="text-align:center;padding:24px;color:#334155">No audits yet — they\'ll appear here as users complete the audit</td></tr>' : ''}
      </tbody>
    </table>
  </div>

</div>
</body>
</html>`);

  } catch (err) {
    console.error('Dashboard error:', err.message);
    return res.status(500).send(`<html><body style="background:#07070f;color:#f87171;font-family:system-ui;padding:40px;">${err.message}</body></html>`);
  }
};
