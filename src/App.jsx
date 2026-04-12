import { useState, useEffect, useRef } from "react";

const AUDIT_SECTIONS = [
  {
    id: "compute", label: "Compute", icon: "⚡",
    description: "Instance sizing, reservation strategy & generation currency",
    checks: [
      { id: "rightsizing", label: "Idle or oversized instances", detail: "Over 80% unused capacity detected", savingsRange: [15, 40], effort: "Medium", impact: "High" },
      { id: "reserved", label: "No Reserved Instances / Savings Plans", detail: "Running fully on-demand pricing", savingsRange: [20, 45], effort: "Low", impact: "High" },
      { id: "spot", label: "Spot instances unused for batch/dev", detail: "CI runners, ML training, ETL jobs eligible", savingsRange: [60, 80], effort: "Medium", impact: "Critical" },
      { id: "old_gen", label: "Previous-generation instance types", detail: "m4, c4, r4 families still in use", savingsRange: [5, 15], effort: "Low", impact: "Medium" },
      { id: "stopped", label: "Stopped instances still billing", detail: "EBS volumes and Elastic IPs accruing charges", savingsRange: [2, 8], effort: "Low", impact: "Low" },
    ],
  },
  {
    id: "storage", label: "Storage", icon: "🗄",
    description: "Object storage tiering, orphaned volumes & data transfer",
    checks: [
      { id: "s3_tier", label: "Storage not tiered by access frequency", detail: "All data sitting in Standard class", savingsRange: [30, 60], effort: "Low", impact: "High" },
      { id: "unattached_volumes", label: "Unattached disks & orphaned volumes", detail: "Persisting after instance termination", savingsRange: [5, 20], effort: "Low", impact: "Medium" },
      { id: "snapshots", label: "Snapshot retention policy missing", detail: "Old backups never purged or archived", savingsRange: [5, 15], effort: "Low", impact: "Medium" },
      { id: "data_transfer", label: "Excessive cross-region egress costs", detail: "No CDN or VPC endpoint in place", savingsRange: [10, 35], effort: "Medium", impact: "High" },
    ],
  },
  {
    id: "network", label: "Network", icon: "🌐",
    description: "NAT gateways, static IPs & idle load balancers",
    checks: [
      { id: "nat_gateway", label: "Excessive NAT Gateway traffic", detail: "Internal traffic routed through NAT unnecessarily", savingsRange: [10, 30], effort: "Medium", impact: "High" },
      { id: "unused_ips", label: "Unused static / Elastic IPs", detail: "Unattached IPs billed hourly", savingsRange: [1, 5], effort: "Low", impact: "Low" },
      { id: "lb_unused", label: "Load balancers with no active targets", detail: "Idle ALBs and NLBs still billing", savingsRange: [3, 10], effort: "Low", impact: "Medium" },
    ],
  },
  {
    id: "database", label: "Database", icon: "🗃",
    description: "RDS sizing, dev environment waste & caching gaps",
    checks: [
      { id: "rds_idle", label: "Dev/staging RDS running 24/7", detail: "Full-price uptime for non-production databases", savingsRange: [40, 70], effort: "Low", impact: "Critical" },
      { id: "rds_size", label: "RDS instances over-provisioned", detail: "High memory, <10% actual usage", savingsRange: [20, 40], effort: "Medium", impact: "High" },
      { id: "cache_missing", label: "No caching layer in front of database", detail: "Redis/Memcached could offload 60–80% of queries", savingsRange: [15, 30], effort: "High", impact: "High" },
    ],
  },
  {
    id: "governance", label: "Governance", icon: "📊",
    description: "Budgets, alerts, forgotten resources & environment parity",
    checks: [
      { id: "no_budgets", label: "No cost budgets or billing alerts", detail: "Spend drifting without visibility", savingsRange: [5, 20], effort: "Low", impact: "High" },
      { id: "unused_services", label: "Forgotten services & shadow IT", detail: "Old Lambdas, API GWs, queues accruing cost", savingsRange: [3, 15], effort: "Medium", impact: "Medium" },
      { id: "dev_prod_parity", label: "Dev environment mirrors production", detail: "Should be 10–20% of prod size", savingsRange: [30, 50], effort: "Medium", impact: "Critical" },
    ],
  },
];

const IMPACT_COLOR = { Critical: "#ef4444", High: "#f97316", Medium: "#eab308", Low: "#22c55e" };
const EFFORT_COLOR = { Low: "#22c55e", Medium: "#eab308", High: "#ef4444" };
const PROVIDERS = ["AWS", "GCP", "Azure", "Multi-cloud"];

function AnimatedNumber({ value, prefix = "", suffix = "", duration = 800 }) {
  const [display, setDisplay] = useState(0);
  const start = useRef(0);
  const raf = useRef(null);
  useEffect(() => {
    const from = start.current;
    const to = value;
    const startTime = performance.now();
    const animate = (now) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(from + (to - from) * ease));
      if (progress < 1) raf.current = requestAnimationFrame(animate);
      else start.current = to;
    };
    raf.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);
  return <span>{prefix}{display.toLocaleString()}{suffix}</span>;
}

function ProgressRing({ percent, size = 48, stroke = 3, color = "#2563eb" }) {
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (percent / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.4,0,0.2,1)" }}
        strokeLinecap="round" />
    </svg>
  );
}

export default function App() {
  const [step, setStep] = useState("intro");
  const [provider, setProvider] = useState("");
  const [monthlyBill, setMonthlyBill] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [checked, setChecked] = useState({});
  const [activeSection, setActiveSection] = useState(0);
  const [hoveredCheck, setHoveredCheck] = useState(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setTimeout(() => setMounted(true), 50); }, []);
  useEffect(() => { setMounted(false); setTimeout(() => setMounted(true), 80); }, [step, activeSection]);

  const toggle = (id) => setChecked(p => ({ ...p, [id]: !p[id] }));

  const bill = parseFloat(monthlyBill) || 0;
  const allChecks = AUDIT_SECTIONS.flatMap(s => s.checks);
  const flagged = allChecks.filter(c => checked[c.id]);
  const savMin = flagged.reduce((s, c) => s + bill * c.savingsRange[0] / 100, 0);
  const savMax = flagged.reduce((s, c) => s + bill * c.savingsRange[1] / 100, 0);
  const savPct = bill > 0 ? Math.round(((savMin + savMax) / 2 / bill) * 100) : 0;
  const totalDone = allChecks.filter(c => checked[c.id] !== undefined).length;
  const progress = Math.round((Object.keys(checked).length / allChecks.length) * 100);

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Instrument+Sans:wght@400;500;600&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #f8f9fc; }
    .audit-app { font-family: 'Instrument Sans', sans-serif; color: #0f172a; min-height: 100vh; background: #f8f9fc; }
    .page { opacity: 0; transform: translateY(12px); transition: opacity 0.35s ease, transform 0.35s ease; }
    .page.in { opacity: 1; transform: translateY(0); }
    h1,h2,h3,.syne { font-family: 'Syne', sans-serif; }
    input:focus { outline: none; border-color: #2563eb !important; box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
    select:focus { outline: none; }
    .pill-btn { transition: all 0.15s; cursor: pointer; border: none; font-family: 'Instrument Sans', sans-serif; }
    .pill-btn:hover { transform: translateY(-1px); }
    .check-row { transition: all 0.18s cubic-bezier(0.4,0,0.2,1); cursor: pointer; }
    .check-row:hover { transform: translateX(3px); }
    .primary-btn { transition: all 0.2s; cursor: pointer; font-family: 'Syne', sans-serif; }
    .primary-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(37,99,235,0.3) !important; }
    .primary-btn:active { transform: translateY(0); }
    .ghost-btn { transition: all 0.15s; cursor: pointer; font-family: 'Instrument Sans', sans-serif; }
    .ghost-btn:hover { background: #f1f5f9 !important; }
    .section-tab { transition: all 0.15s; cursor: pointer; }
    .section-tab:hover { color: #2563eb !important; }
    .stat-card { transition: transform 0.2s, box-shadow 0.2s; }
    .stat-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.08) !important; }
    .provider-chip { transition: all 0.15s; cursor: pointer; }
    .provider-chip:hover { border-color: #2563eb !important; color: #2563eb !important; }
    ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
    .savings-dock { animation: slideUp 0.4s cubic-bezier(0.34,1.56,0.64,1); }
    @keyframes slideUp { from { opacity:0; transform: translateY(16px); } to { opacity:1; transform: translateY(0); } }
    .badge-pulse { animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.6; } }
    .noise { position:fixed; inset:0; pointer-events:none; opacity:0.025; z-index:0; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E"); }
  `;

  // ─── INTRO ───────────────────────────────────────────────────────────────────
  if (step === "intro") return (
    <div className="audit-app">
      <style>{css}</style>
      <div className="noise" />
      {/* Top nav */}
      <nav style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(248,249,252,0.85)", backdropFilter: "blur(12px)", borderBottom: "1px solid #e2e8f0", padding: "0 24px", height: "56px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "28px", height: "28px", background: "#2563eb", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: "#fff", fontSize: "14px" }}>⚡</span>
          </div>
          <span className="syne" style={{ fontWeight: 700, fontSize: "15px", letterSpacing: "-0.3px" }}>CloudAudit</span>
          <span style={{ background: "#dbeafe", color: "#1d4ed8", fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: "20px", letterSpacing: "0.5px" }}>BETA</span>
        </div>
        <span style={{ fontSize: "13px", color: "#64748b" }}>Free · No account needed</span>
      </nav>

      <div className={`page ${mounted ? "in" : ""}`} style={{ position: "relative", zIndex: 1 }}>
        {/* Hero */}
        <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "80px 24px 60px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "20px", padding: "6px 14px", marginBottom: "32px" }}>
            <span className="badge-pulse" style={{ width: "6px", height: "6px", background: "#2563eb", borderRadius: "50%", display: "inline-block" }} />
            <span style={{ fontSize: "12px", color: "#1d4ed8", fontWeight: 600, letterSpacing: "0.3px" }}>TRUSTED BY DEVOPS TEAMS IN POLAND</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "80px", alignItems: "center" }}>
            <div>
              <h1 className="syne" style={{ fontSize: "clamp(36px,4.5vw,58px)", fontWeight: 800, lineHeight: 1.05, letterSpacing: "-2px", color: "#0f172a", marginBottom: "20px" }}>
                Find what your<br />
                <span style={{ color: "#2563eb" }}>cloud bill</span><br />
                is hiding.
              </h1>
              <p style={{ fontSize: "17px", color: "#475569", lineHeight: 1.7, marginBottom: "36px", maxWidth: "440px" }}>
                A structured 15-minute audit that finds real savings in your AWS, GCP, or Azure spend. No tools, no agents — just your invoice and this checklist.
              </p>
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <button className="primary-btn" onClick={() => setStep("intake")}
                  style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: "10px", padding: "14px 28px", fontSize: "15px", fontWeight: 600, display: "flex", alignItems: "center", gap: "8px", boxShadow: "0 4px 14px rgba(37,99,235,0.25)" }}>
                  Start Free Audit
                  <span style={{ fontSize: "16px" }}>→</span>
                </button>
                <button className="ghost-btn" style={{ background: "transparent", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "14px 24px", fontSize: "15px", color: "#475569", fontWeight: 500 }}>
                  See sample report
                </button>
              </div>
              <p style={{ marginTop: "16px", fontSize: "12px", color: "#94a3b8" }}>✓ Free forever &nbsp;&nbsp;✓ No signup &nbsp;&nbsp;✓ Report in 15 minutes</p>
            </div>

            {/* Stats panel */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
              {[
                { n: "20–45%", label: "Average savings found", icon: "💰", color: "#eff6ff", border: "#bfdbfe", text: "#1d4ed8" },
                { n: "18", label: "Audit checkpoints", icon: "✅", color: "#f0fdf4", border: "#bbf7d0", text: "#15803d" },
                { n: "15 min", label: "Average completion", icon: "⏱", color: "#fff7ed", border: "#fed7aa", text: "#c2410c" },
                { n: "0 PLN", label: "Cost to run audit", icon: "🎯", color: "#faf5ff", border: "#e9d5ff", text: "#7c3aed" },
              ].map(s => (
                <div key={s.n} className="stat-card" style={{ background: s.color, border: `1px solid ${s.border}`, borderRadius: "12px", padding: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <div style={{ fontSize: "22px", marginBottom: "8px" }}>{s.icon}</div>
                  <div className="syne" style={{ fontSize: "24px", fontWeight: 800, color: s.text, letterSpacing: "-1px" }}>{s.n}</div>
                  <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px", lineHeight: 1.4 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Audit categories preview */}
          <div style={{ marginTop: "80px", borderTop: "1px solid #e2e8f0", paddingTop: "60px" }}>
            <p style={{ fontSize: "12px", letterSpacing: "2px", color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", marginBottom: "24px" }}>What we audit</p>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              {AUDIT_SECTIONS.map(s => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: "8px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "10px 16px", fontSize: "14px", fontWeight: 500, color: "#334155", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                  <span>{s.icon}</span> {s.label}
                  <span style={{ background: "#f1f5f9", color: "#64748b", fontSize: "11px", borderRadius: "10px", padding: "1px 7px", fontWeight: 600 }}>{s.checks.length}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // ─── INTAKE ───────────────────────────────────────────────────────────────────
  if (step === "intake") return (
    <div className="audit-app">
      <style>{css}</style>
      <div className="noise" />
      <nav style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(248,249,252,0.85)", backdropFilter: "blur(12px)", borderBottom: "1px solid #e2e8f0", padding: "0 24px", height: "56px", display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ width: "28px", height: "28px", background: "#2563eb", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "#fff", fontSize: "14px" }}>⚡</span>
        </div>
        <span className="syne" style={{ fontWeight: 700, fontSize: "15px" }}>CloudAudit</span>
      </nav>

      <div className={`page ${mounted ? "in" : ""}`} style={{ maxWidth: "560px", margin: "0 auto", padding: "60px 24px", position: "relative", zIndex: 1 }}>
        <button className="ghost-btn" onClick={() => setStep("intro")} style={{ background: "transparent", border: "none", color: "#64748b", fontSize: "14px", marginBottom: "32px", display: "flex", alignItems: "center", gap: "6px", padding: "0" }}>
          ← Back
        </button>

        <h2 className="syne" style={{ fontSize: "32px", fontWeight: 800, letterSpacing: "-1px", marginBottom: "8px" }}>Set up your audit</h2>
        <p style={{ color: "#64748b", fontSize: "15px", marginBottom: "40px" }}>Takes 30 seconds. We'll tailor savings estimates to your actual bill.</p>

        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Company */}
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "8px" }}>Company or project name</label>
            <input value={companyName} onChange={e => setCompanyName(e.target.value)}
              placeholder="e.g. Acme Corp" style={{ width: "100%", padding: "12px 16px", border: "1.5px solid #e2e8f0", borderRadius: "10px", fontSize: "15px", color: "#0f172a", background: "#fff", transition: "all 0.2s", fontFamily: "inherit" }} />
          </div>

          {/* Provider */}
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "8px" }}>Cloud provider</label>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {PROVIDERS.map(p => (
                <button key={p} className="provider-chip" onClick={() => setProvider(p)}
                  style={{ padding: "10px 20px", borderRadius: "8px", fontSize: "14px", fontWeight: 500, border: `1.5px solid ${provider === p ? "#2563eb" : "#e2e8f0"}`, background: provider === p ? "#eff6ff" : "#fff", color: provider === p ? "#2563eb" : "#374151", fontFamily: "inherit" }}>
                  {p}
                </button>
              ))}
            </div>
          </div>

            {/* Bill */}
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "8px" }}>Monthly cloud bill (USD)</label>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: "16px", top: "50%", transform: "translateY(-50%)", color: "#94a3b8", fontSize: "16px", fontWeight: 600 }}>$</span>
              <input type="number" value={monthlyBill} onChange={e => setMonthlyBill(e.target.value)}
                placeholder="3,500" style={{ width: "100%", padding: "12px 16px 12px 32px", border: "1.5px solid #e2e8f0", borderRadius: "10px", fontSize: "15px", color: "#0f172a", background: "#fff", fontFamily: "inherit", transition: "all 0.2s" }} />
            </div>
            {bill > 0 && (
              <div style={{ marginTop: "10px", padding: "12px 16px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", fontSize: "13px", color: "#15803d", fontWeight: 500 }}>
                💰 Typical savings range: <strong>${Math.round(bill*0.20).toLocaleString()} – ${Math.round(bill*0.45).toLocaleString()}/month</strong> based on industry averages
              </div>
            )}
          </div>

          <button className="primary-btn" disabled={!provider || !monthlyBill}
            onClick={() => { setActiveSection(0); setStep("audit"); }}
            style={{ background: provider && monthlyBill ? "#2563eb" : "#e2e8f0", color: provider && monthlyBill ? "#fff" : "#94a3b8", border: "none", borderRadius: "10px", padding: "15px", fontSize: "15px", fontWeight: 600, boxShadow: provider && monthlyBill ? "0 4px 14px rgba(37,99,235,0.25)" : "none", cursor: provider && monthlyBill ? "pointer" : "not-allowed" }}>
            Begin Audit →
          </button>
        </div>
      </div>
    </div>
  );

  // ─── AUDIT ────────────────────────────────────────────────────────────────────
  if (step === "audit") {
    const section = AUDIT_SECTIONS[activeSection];
    const sectionChecked = section.checks.filter(c => checked[c.id] !== undefined).length;

    return (
      <div className="audit-app">
        <style>{css}</style>
        <div className="noise" />

        {/* Sticky header */}
        <nav style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(248,249,252,0.9)", backdropFilter: "blur(16px)", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ maxWidth: "900px", margin: "0 auto", padding: "0 24px", height: "56px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{ width: "28px", height: "28px", background: "#2563eb", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: "#fff", fontSize: "14px" }}>⚡</span>
              </div>
              <span className="syne" style={{ fontWeight: 700, fontSize: "15px" }}>CloudAudit</span>
              <span style={{ color: "#cbd5e1" }}>·</span>
              <span style={{ fontSize: "13px", color: "#64748b" }}>{companyName || "Audit"} · {provider}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <ProgressRing percent={progress} size={36} stroke={3} color="#2563eb" />
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>{progress}%</span>
              </div>
            </div>
          </div>
          {/* Top progress bar */}
          <div style={{ height: "2px", background: "#e2e8f0" }}>
            <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, #2563eb, #7c3aed)", transition: "width 0.4s ease", borderRadius: "0 2px 2px 0" }} />
          </div>
        </nav>

        <div style={{ maxWidth: "900px", margin: "0 auto", padding: "32px 24px 120px", position: "relative", zIndex: 1 }}>

          {/* Section tabs */}
          <div style={{ display: "flex", gap: "4px", overflowX: "auto", marginBottom: "32px", paddingBottom: "4px" }}>
            {AUDIT_SECTIONS.map((s, i) => {
              const done = s.checks.filter(c => checked[c.id] !== undefined).length;
              const active = i === activeSection;
              return (
                <button key={s.id} className="section-tab" onClick={() => setActiveSection(i)}
                  style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: active ? "#eff6ff" : "transparent", color: active ? "#2563eb" : "#64748b", fontSize: "13px", fontWeight: active ? 600 : 500, fontFamily: "inherit", display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}>
                  <span>{s.icon}</span>
                  {s.label}
                  {done > 0 && (
                    <span style={{ background: active ? "#2563eb" : "#e2e8f0", color: active ? "#fff" : "#64748b", borderRadius: "10px", fontSize: "10px", padding: "1px 6px", fontWeight: 700 }}>{done}/{s.checks.length}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: "24px", alignItems: "start" }}>
            {/* Main checklist */}
            <div className={`page ${mounted ? "in" : ""}`}>
              <div style={{ marginBottom: "24px" }}>
                <h2 className="syne" style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-0.5px", color: "#0f172a" }}>
                  {section.icon} {section.label}
                </h2>
                <p style={{ fontSize: "14px", color: "#64748b", marginTop: "4px" }}>{section.description}</p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {section.checks.map((check) => {
                  const isChecked = !!checked[check.id];
                  const isHovered = hoveredCheck === check.id;
                  const savMin = bill > 0 ? Math.round(bill * check.savingsRange[0] / 100) : null;
                  const savMax = bill > 0 ? Math.round(bill * check.savingsRange[1] / 100) : null;
                  return (
                    <div key={check.id} className="check-row"
                      onClick={() => toggle(check.id)}
                      onMouseEnter={() => setHoveredCheck(check.id)}
                      onMouseLeave={() => setHoveredCheck(null)}
                      style={{ background: isChecked ? "#eff6ff" : "#fff", border: `1.5px solid ${isChecked ? "#bfdbfe" : isHovered ? "#cbd5e1" : "#e2e8f0"}`, borderRadius: "12px", padding: "16px 20px", display: "flex", alignItems: "flex-start", gap: "14px", boxShadow: isChecked ? "0 1px 8px rgba(37,99,235,0.08)" : "0 1px 2px rgba(0,0,0,0.04)" }}>

                      {/* Checkbox */}
                      <div style={{ width: "22px", height: "22px", borderRadius: "6px", flexShrink: 0, marginTop: "1px", background: isChecked ? "#2563eb" : "#fff", border: `2px solid ${isChecked ? "#2563eb" : "#d1d5db"}`, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s", boxShadow: isChecked ? "0 2px 8px rgba(37,99,235,0.3)" : "none" }}>
                        {isChecked && <svg width="12" height="9" viewBox="0 0 12 9" fill="none"><path d="M1 4L4.5 7.5L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "3px" }}>
                          <span style={{ fontSize: "15px", fontWeight: 600, color: isChecked ? "#1d4ed8" : "#1e293b" }}>{check.label}</span>
                          <span style={{ fontSize: "11px", fontWeight: 600, color: IMPACT_COLOR[check.impact], background: `${IMPACT_COLOR[check.impact]}15`, borderRadius: "4px", padding: "1px 7px" }}>{check.impact}</span>
                          <span style={{ fontSize: "11px", fontWeight: 600, color: EFFORT_COLOR[check.effort], background: `${EFFORT_COLOR[check.effort]}15`, borderRadius: "4px", padding: "1px 7px" }}>Effort: {check.effort}</span>
                        </div>
                        <p style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.5 }}>{check.detail}</p>
                        {isChecked && bill > 0 && (
                          <div style={{ marginTop: "10px", display: "inline-flex", alignItems: "center", gap: "6px", background: "#dcfce7", border: "1px solid #bbf7d0", borderRadius: "6px", padding: "5px 12px" }}>
                            <span style={{ fontSize: "14px" }}>💰</span>
                            <span style={{ fontSize: "13px", fontWeight: 600, color: "#15803d" }}>
                              ${savMin?.toLocaleString()} – ${savMax?.toLocaleString()}/mo potential savings
                            </span>
                          </div>
                        )}
                      </div>

                      <div style={{ fontSize: "12px", color: "#94a3b8", flexShrink: 0, fontWeight: 500 }}>
                        {check.savingsRange[0]}–{check.savingsRange[1]}%
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: "10px", marginTop: "28px" }}>
                {activeSection > 0 && (
                  <button className="ghost-btn" onClick={() => setActiveSection(a => a - 1)}
                    style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "10px", padding: "12px 22px", fontSize: "14px", fontWeight: 600, color: "#374151", fontFamily: "inherit" }}>
                    ← Previous
                  </button>
                )}
                {activeSection < AUDIT_SECTIONS.length - 1 ? (
                  <button className="primary-btn" onClick={() => setActiveSection(a => a + 1)}
                    style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: "10px", padding: "12px 28px", fontSize: "14px", fontWeight: 600, boxShadow: "0 4px 14px rgba(37,99,235,0.25)" }}>
                    Next: {AUDIT_SECTIONS[activeSection + 1].label} →
                  </button>
                ) : (
                  <button className="primary-btn" onClick={() => setStep("report")}
                    style={{ background: "#0f172a", color: "#fff", border: "none", borderRadius: "10px", padding: "12px 28px", fontSize: "14px", fontWeight: 600, boxShadow: "0 4px 14px rgba(0,0,0,0.2)" }}>
                    Generate Report →
                  </button>
                )}
              </div>
            </div>

            {/* Sticky savings panel */}
            <div style={{ position: "sticky", top: "72px" }}>
              <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "16px", padding: "24px", boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}>
                <p style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.5px", color: "#94a3b8", textTransform: "uppercase", marginBottom: "16px" }}>Live Savings Estimate</p>

                {flagged.length > 0 && bill > 0 ? (
                  <>
                    <div style={{ marginBottom: "16px" }}>
                      <div className="syne" style={{ fontSize: "30px", fontWeight: 800, color: "#15803d", letterSpacing: "-1.5px", lineHeight: 1 }}>
                        <AnimatedNumber value={Math.round(savMin)} prefix="$" />&thinsp;–&thinsp;<AnimatedNumber value={Math.round(savMax)} prefix="$" />
                      </div>
                      <p style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>per month · ~{savPct}% of bill</p>
                    </div>
                    <div style={{ height: "6px", background: "#f1f5f9", borderRadius: "3px", overflow: "hidden", marginBottom: "16px" }}>
                      <div style={{ height: "100%", width: `${Math.min(savPct * 2, 100)}%`, background: "linear-gradient(90deg, #22c55e, #16a34a)", borderRadius: "3px", transition: "width 0.5s ease" }} />
                    </div>
                    <div style={{ fontSize: "13px", color: "#475569", fontWeight: 600, marginBottom: "12px" }}>
                      Annual opportunity: <span style={{ color: "#15803d" }}>${Math.round(savMin * 12).toLocaleString()} – ${Math.round(savMax * 12).toLocaleString()}</span>
                    </div>
                  </>
                ) : (
                  <div style={{ textAlign: "center", padding: "20px 0", color: "#94a3b8", fontSize: "13px" }}>
                    Check issues above to see<br />your savings estimate
                  </div>
                )}

                <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: "16px", marginTop: "4px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                    <span style={{ fontSize: "12px", color: "#64748b" }}>Issues found</span>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: flagged.length > 0 ? "#ef4444" : "#94a3b8" }}>{flagged.length}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                    <span style={{ fontSize: "12px", color: "#64748b" }}>Checks reviewed</span>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "#374151" }}>{Object.keys(checked).length}/{allChecks.length}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: "12px", color: "#64748b" }}>Section</span>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "#374151" }}>{activeSection + 1}/{AUDIT_SECTIONS.length}</span>
                  </div>
                </div>
              </div>

              {/* Section progress mini */}
              <div style={{ marginTop: "12px", background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "12px", padding: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                <p style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1px", color: "#94a3b8", textTransform: "uppercase", marginBottom: "12px" }}>Sections</p>
                {AUDIT_SECTIONS.map((s, i) => {
                  const done = s.checks.filter(c => checked[c.id] !== undefined).length;
                  const pct = Math.round((done / s.checks.length) * 100);
                  return (
                    <div key={s.id} onClick={() => setActiveSection(i)} style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px", cursor: "pointer", opacity: i === activeSection ? 1 : 0.7 }}>
                      <span style={{ fontSize: "13px", width: "16px" }}>{s.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                          <span style={{ fontSize: "11px", fontWeight: 600, color: i === activeSection ? "#2563eb" : "#374151" }}>{s.label}</span>
                          <span style={{ fontSize: "10px", color: "#94a3b8" }}>{done}/{s.checks.length}</span>
                        </div>
                        <div style={{ height: "3px", background: "#f1f5f9", borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: i === activeSection ? "#2563eb" : "#22c55e", borderRadius: "2px", transition: "width 0.3s" }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── REPORT ───────────────────────────────────────────────────────────────────
  if (step === "report") {
    const annualMin = savMin * 12;
    const annualMax = savMax * 12;
    const getSeverity = c => { const p = (c.savingsRange[0]+c.savingsRange[1])/2; return p>=30?"high":p>=15?"med":"low"; };
    const high = flagged.filter(c=>getSeverity(c)==="high");
    const med = flagged.filter(c=>getSeverity(c)==="med");
    const low = flagged.filter(c=>getSeverity(c)==="low");

    const scoreColor = savPct >= 30 ? "#ef4444" : savPct >= 15 ? "#f97316" : savPct >= 5 ? "#eab308" : "#22c55e";
    const scoreLabel = savPct >= 30 ? "Critical waste detected" : savPct >= 15 ? "Significant savings available" : savPct >= 5 ? "Minor optimisations needed" : "Well optimised";

    return (
      <div className="audit-app">
        <style>{css}</style>
        <div className="noise" />
        <nav style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(248,249,252,0.9)", backdropFilter: "blur(16px)", borderBottom: "1px solid #e2e8f0", padding: "0 24px", height: "56px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "28px", height: "28px", background: "#2563eb", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#fff", fontSize: "14px" }}>⚡</span>
            </div>
            <span className="syne" style={{ fontWeight: 700, fontSize: "15px" }}>CloudAudit</span>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button className="ghost-btn" onClick={() => window.print()}
              style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "8px", padding: "8px 16px", fontSize: "13px", fontWeight: 600, color: "#374151", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "6px" }}>
              🖨 Export PDF
            </button>
            <button className="primary-btn" onClick={() => { setChecked({}); setActiveSection(0); setStep("audit"); }}
              style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: "8px", padding: "8px 16px", fontSize: "13px", fontWeight: 600, boxShadow: "0 2px 8px rgba(37,99,235,0.2)" }}>
              Re-run Audit
            </button>
          </div>
        </nav>

        <div className={`page ${mounted ? "in" : ""}`} style={{ maxWidth: "860px", margin: "0 auto", padding: "48px 24px 80px", position: "relative", zIndex: 1 }}>

          {/* Report header */}
          <div style={{ marginBottom: "40px" }}>
            <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
              {[companyName || "Cloud Audit", provider, new Date().toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"})].map(t => (
                <span key={t} style={{ background: "#f1f5f9", color: "#475569", fontSize: "12px", fontWeight: 600, padding: "4px 12px", borderRadius: "20px" }}>{t}</span>
              ))}
            </div>
            <h1 className="syne" style={{ fontSize: "clamp(28px,4vw,44px)", fontWeight: 800, letterSpacing: "-1.5px", marginBottom: "8px" }}>
              Cost Optimisation Report
            </h1>
            <p style={{ color: "#64748b", fontSize: "16px" }}>
              {flagged.length > 0 ? `${flagged.length} issues identified across ${AUDIT_SECTIONS.length} categories` : "No issues identified — your infrastructure looks well-optimised."}
            </p>
          </div>

          {/* Score banner */}
          {bill > 0 && (
            <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "16px", padding: "32px", marginBottom: "24px", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "24px" }}>
              {[
                { label: "Monthly savings", val: `$${Math.round(savMin).toLocaleString()} – $${Math.round(savMax).toLocaleString()}`, sub: "per month", color: "#15803d", bg: "#f0fdf4" },
                { label: "Annual opportunity", val: `$${Math.round(annualMin).toLocaleString()}+`, sub: "per year", color: "#1d4ed8", bg: "#eff6ff" },
                { label: "Waste rate", val: `~${savPct}%`, sub: scoreLabel, color: scoreColor, bg: `${scoreColor}10` },
                { label: "Issues found", val: flagged.length, sub: `of ${allChecks.length} checks`, color: flagged.length > 5 ? "#ef4444" : "#f97316", bg: "#fff7ed" },
              ].map(s => (
                <div key={s.label} style={{ background: s.bg, borderRadius: "10px", padding: "16px" }}>
                  <p style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>{s.label}</p>
                  <p className="syne" style={{ fontSize: "22px", fontWeight: 800, color: s.color, letterSpacing: "-0.5px", lineHeight: 1 }}>{s.val}</p>
                  <p style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>{s.sub}</p>
                </div>
              ))}
            </div>
          )}

          {/* Findings */}
          {[
            { label: "🔴 Critical & High Impact", items: high, color: "#ef4444", bg: "#fef2f2", border: "#fecaca" },
            { label: "🟡 Medium Impact", items: med, color: "#d97706", bg: "#fffbeb", border: "#fde68a" },
            { label: "🟢 Quick Wins", items: low, color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
          ].filter(g => g.items.length > 0).map(group => (
            <div key={group.label} style={{ marginBottom: "32px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                <h3 className="syne" style={{ fontSize: "15px", fontWeight: 700, color: "#1e293b" }}>{group.label}</h3>
                <span style={{ background: group.bg, color: group.color, fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "10px", border: `1px solid ${group.border}` }}>{group.items.length} issue{group.items.length > 1 ? "s" : ""}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {group.items.map(check => {
                  const savMin2 = bill > 0 ? Math.round(bill * check.savingsRange[0] / 100) : null;
                  const savMax2 = bill > 0 ? Math.round(bill * check.savingsRange[1] / 100) : null;
                  return (
                    <div key={check.id} style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "12px", padding: "18px 20px", borderLeft: `4px solid ${group.color}`, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
                        <div>
                          <p style={{ fontWeight: 600, fontSize: "15px", color: "#0f172a", marginBottom: "4px" }}>{check.label}</p>
                          <p style={{ fontSize: "13px", color: "#64748b" }}>{check.detail}</p>
                        </div>
                        {bill > 0 && (
                          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "8px 14px", textAlign: "right", flexShrink: 0 }}>
                            <p style={{ fontSize: "14px", fontWeight: 700, color: "#15803d" }}>${savMin2?.toLocaleString()} – ${savMax2?.toLocaleString()}</p>
                            <p style={{ fontSize: "11px", color: "#64748b" }}>/ month</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Next steps */}
          <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: "16px", padding: "28px", marginBottom: "24px", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
            <h3 className="syne" style={{ fontSize: "18px", fontWeight: 700, marginBottom: "20px", letterSpacing: "-0.3px" }}>Recommended action plan</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {[
                high.length > 0 && { n: 1, text: "Address critical & high-impact findings first — these give the fastest ROI with least risk.", color: "#ef4444" },
                { n: 2, text: "Set billing alerts at 80% and 100% of your monthly target in your cloud console today.", color: "#2563eb" },
                { n: 3, text: "Implement auto-shutdown for dev/staging outside business hours — immediate wins.", color: "#2563eb" },
                { n: 4, text: "Run a rightsizing review using your provider's native tooling (Compute Optimizer / GCP Recommender).", color: "#2563eb" },
                { n: 5, text: "Revisit this audit in 30 days after changes are applied to measure impact.", color: "#7c3aed" },
              ].filter(Boolean).map(item => (
                <div key={item.n} style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                  <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: `${item.color}15`, border: `1.5px solid ${item.color}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: "1px" }}>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: item.color }}>{item.n}</span>
                  </div>
                  <p style={{ fontSize: "14px", color: "#374151", lineHeight: 1.6 }}>{item.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div style={{ background: "linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 100%)", borderRadius: "16px", padding: "36px", textAlign: "center", color: "#fff" }}>
            <p style={{ fontSize: "12px", fontWeight: 600, letterSpacing: "2px", color: "#93c5fd", textTransform: "uppercase", marginBottom: "12px" }}>Need help implementing these savings?</p>
            <h3 className="syne" style={{ fontSize: "26px", fontWeight: 800, letterSpacing: "-0.5px", marginBottom: "8px" }}>Book a 1-hour implementation session</h3>
            <p style={{ color: "#bfdbfe", fontSize: "15px", marginBottom: "24px" }}>Senior DevOps engineer · Remote · Report + implementation in 48hrs</p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
              <button className="primary-btn" style={{ background: "#fff", color: "#1d4ed8", border: "none", borderRadius: "10px", padding: "13px 28px", fontSize: "15px", fontWeight: 700, boxShadow: "0 4px 14px rgba(0,0,0,0.2)" }}>
                Book for 999 PLN →
              </button>
              <button className="ghost-btn" style={{ background: "transparent", border: "1.5px solid rgba(255,255,255,0.3)", color: "#fff", borderRadius: "10px", padding: "13px 24px", fontSize: "15px", fontWeight: 600, fontFamily: "inherit" }}>
                Share this report
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}