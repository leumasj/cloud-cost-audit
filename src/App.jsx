import { useState, useEffect, useRef } from "react";

const AUDIT_SECTIONS = [
  {
    id: "compute", label: "Compute", icon: "⚡",
    description: "Instance sizing, reservation strategy & generation currency",
    summary: "Identifies idle VMs, missing savings plans, spot opportunities, and legacy instance types burning money silently.",
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
    summary: "Uncovers untriered S3/GCS data, orphaned disks after instance deletion, stale snapshots, and expensive egress routing.",
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
    summary: "Catches NAT gateway overuse for internal traffic, idle load balancers billing hourly, and unattached static IPs.",
    checks: [
      { id: "nat_gateway", label: "Excessive NAT Gateway traffic", detail: "Internal traffic routed through NAT unnecessarily", savingsRange: [10, 30], effort: "Medium", impact: "High" },
      { id: "unused_ips", label: "Unused static / Elastic IPs", detail: "Unattached IPs billed hourly", savingsRange: [1, 5], effort: "Low", impact: "Low" },
      { id: "lb_unused", label: "Load balancers with no active targets", detail: "Idle ALBs and NLBs still billing", savingsRange: [3, 10], effort: "Low", impact: "Medium" },
    ],
  },
  {
    id: "database", label: "Database", icon: "🗃",
    description: "RDS sizing, dev environment waste & caching gaps",
    summary: "Finds dev/staging RDS running 24/7, over-provisioned databases, and missing Redis layers that cause DB overload.",
    checks: [
      { id: "rds_idle", label: "Dev/staging RDS running 24/7", detail: "Full-price uptime for non-production databases", savingsRange: [40, 70], effort: "Low", impact: "Critical" },
      { id: "rds_size", label: "RDS instances over-provisioned", detail: "High memory, <10% actual usage", savingsRange: [20, 40], effort: "Medium", impact: "High" },
      { id: "cache_missing", label: "No caching layer in front of database", detail: "Redis/Memcached could offload 60–80% of queries", savingsRange: [15, 30], effort: "High", impact: "High" },
    ],
  },
  {
    id: "governance", label: "Governance", icon: "📊",
    description: "Budgets, alerts, forgotten resources & environment parity",
    summary: "Exposes missing billing alerts, shadow IT resources accumulating cost, and dev environments mirroring production unnecessarily.",
    checks: [
      { id: "no_budgets", label: "No cost budgets or billing alerts", detail: "Spend drifting without visibility", savingsRange: [5, 20], effort: "Low", impact: "High" },
      { id: "unused_services", label: "Forgotten services & shadow IT", detail: "Old Lambdas, API GWs, queues accruing cost", savingsRange: [3, 15], effort: "Medium", impact: "Medium" },
      { id: "dev_prod_parity", label: "Dev environment mirrors production", detail: "Should be 10–20% of prod size", savingsRange: [30, 50], effort: "Medium", impact: "Critical" },
    ],
  },
];

const SAMPLE_REPORT = {
  companyName: "TechFlow GmbH",
  provider: "AWS",
  monthlyBill: 8500,
  checked: {
    rightsizing: true, reserved: true, spot: true, old_gen: true,
    s3_tier: true, unattached_volumes: true, snapshots: true,
    rds_idle: true, rds_size: true,
    no_budgets: true, dev_prod_parity: true,
  },
};

const IMPACT_COLOR = { Critical: "#f87171", High: "#fb923c", Medium: "#fbbf24", Low: "#4ade80" };
const EFFORT_COLOR = { Low: "#4ade80", Medium: "#fbbf24", High: "#f87171" };
const PROVIDERS = ["AWS", "GCP", "Azure", "Multi-cloud"];

function AnimatedNumber({ value, prefix = "", suffix = "", duration = 900 }) {
  const [display, setDisplay] = useState(0);
  const startRef = useRef(0);
  const rafRef = useRef(null);
  useEffect(() => {
    const from = startRef.current;
    const to = value;
    const startTime = performance.now();
    const animate = (now) => {
      const p = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 4);
      setDisplay(Math.round(from + (to - from) * ease));
      if (p < 1) rafRef.current = requestAnimationFrame(animate);
      else startRef.current = to;
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);
  return <span>{prefix}{display.toLocaleString()}{suffix}</span>;
}

function ProgressRing({ percent, size = 44, stroke = 3, color = "#00ffb4" }) {
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (percent / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.4,0,0.2,1)" }}
        strokeLinecap="round" />
    </svg>
  );
}

function ParticleBackground() {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none" }}>
      <div style={{ position: "absolute", top: "-200px", left: "-200px", width: "600px", height: "600px", background: "radial-gradient(circle, rgba(0,255,180,0.07) 0%, transparent 70%)", borderRadius: "50%" }} />
      <div style={{ position: "absolute", bottom: "-200px", right: "-100px", width: "500px", height: "500px", background: "radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)", borderRadius: "50%" }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)", backgroundSize: "48px 48px" }} />
      <div style={{ position: "absolute", inset: 0, opacity: 0.04, backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />
    </div>
  );
}

const globalCss = `
  @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #080810; color: #e2e8f0; }
  :root {
    --bg: #080810;
    --bg2: #0d0d1a;
    --bg3: #12121f;
    --border: rgba(255,255,255,0.08);
    --border-hover: rgba(0,255,180,0.3);
    --green: #00ffb4;
    --green-dim: rgba(0,255,180,0.12);
    --green-border: rgba(0,255,180,0.25);
    --text: #e2e8f0;
    --text-muted: #64748b;
    --text-dim: #94a3b8;
    --display: 'Bricolage Grotesque', sans-serif;
    --body: 'DM Sans', sans-serif;
  }
  .app { font-family: var(--body); background: var(--bg); min-height: 100vh; color: var(--text); }
  .display { font-family: var(--display); }
  .fade-up { animation: fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) both; }
  @keyframes fadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
  .stagger-1 { animation-delay: 0.05s; }
  .stagger-2 { animation-delay: 0.12s; }
  .stagger-3 { animation-delay: 0.2s; }
  .stagger-4 { animation-delay: 0.28s; }
  .stagger-5 { animation-delay: 0.36s; }
  .glow-btn { transition: all 0.2s; cursor: pointer; font-family: var(--display); font-weight: 700; }
  .glow-btn:hover { box-shadow: 0 0 30px rgba(0,255,180,0.35), 0 0 60px rgba(0,255,180,0.15) !important; transform: translateY(-2px); }
  .glow-btn:active { transform: translateY(0); }
  .ghost-btn { transition: all 0.2s; cursor: pointer; font-family: var(--body); }
  .ghost-btn:hover { border-color: rgba(255,255,255,0.25) !important; color: #fff !important; background: rgba(255,255,255,0.05) !important; }
  .check-card { transition: all 0.2s cubic-bezier(0.4,0,0.2,1); cursor: pointer; }
  .check-card:hover { transform: translateX(4px); border-color: rgba(0,255,180,0.2) !important; }
  .audit-cat-card { transition: all 0.25s cubic-bezier(0.4,0,0.2,1); cursor: default; }
  .audit-cat-card:hover { transform: translateY(-4px); border-color: var(--green-border) !important; box-shadow: 0 16px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,255,180,0.1) !important; }
  .section-tab { transition: all 0.15s; cursor: pointer; font-family: var(--body); }
  .section-tab:hover { color: var(--green) !important; }
  .stat-num { font-family: var(--display); }
  input, select, textarea { font-family: var(--body); }
  input:focus, textarea:focus { outline: none; border-color: var(--green) !important; box-shadow: 0 0 0 3px rgba(0,255,180,0.1) !important; }
  .provider-chip { transition: all 0.15s; cursor: pointer; font-family: var(--body); }
  .provider-chip:hover { border-color: var(--green) !important; color: var(--green) !important; }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
  .modal-overlay { animation: fadeIn 0.2s ease; }
  @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
  .modal-box { animation: scaleIn 0.3s cubic-bezier(0.34,1.56,0.64,1); }
  @keyframes scaleIn { from { opacity:0; transform:scale(0.92) translateY(10px); } to { opacity:1; transform:scale(1) translateY(0); } }
`;

export default function App() {
  const [step, setStep] = useState("intro");
  const [provider, setProvider] = useState("");
  const [monthlyBill, setMonthlyBill] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [checked, setChecked] = useState({});
  const [activeSection, setActiveSection] = useState(0);
  const [showSample, setShowSample] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [pageKey, setPageKey] = useState(0);
  
  // Formspree state
  const [formStatus, setFormStatus] = useState("idle"); // idle, sending, success, error

  const toggle = (id) => setChecked(p => ({ ...p, [id]: !p[id] }));

  const goTo = (s) => { setStep(s); setPageKey(k => k + 1); window.scrollTo(0,0); };

  const bill = parseFloat(monthlyBill) || 0;
  const allChecks = AUDIT_SECTIONS.flatMap(s => s.checks);
  const flagged = allChecks.filter(c => checked[c.id]);
  const savMin = Math.round(flagged.reduce((s, c) => s + bill * c.savingsRange[0] / 100, 0));
  const savMax = Math.round(flagged.reduce((s, c) => s + bill * c.savingsRange[1] / 100, 0));
  const savPct = bill > 0 ? Math.round(((savMin + savMax) / 2 / bill) * 100) : 0;
  const progress = Math.round((Object.keys(checked).length / allChecks.length) * 100);

  const sampleFlagged = allChecks.filter(c => SAMPLE_REPORT.checked[c.id]);
  const sampleSavMin = Math.round(sampleFlagged.reduce((s, c) => s + SAMPLE_REPORT.monthlyBill * c.savingsRange[0] / 100, 0));
  const sampleSavMax = Math.round(sampleFlagged.reduce((s, c) => s + SAMPLE_REPORT.monthlyBill * c.savingsRange[1] / 100, 0));
  const samplePct = Math.round(((sampleSavMin + sampleSavMax) / 2 / SAMPLE_REPORT.monthlyBill) * 100);

  const handleContactSubmit = async (e) => {
    e.preventDefault();
    setFormStatus("sending");
    const formData = new FormData(e.target);
    try {
      const response = await fetch("https://formspree.io/f/mlgarana", {
        method: "POST",
        body: formData,
        headers: { 'Accept': 'application/json' }
      });
      if (response.ok) {
        setFormStatus("success");
        e.target.reset();
        setTimeout(() => { setShowContact(false); setFormStatus("idle"); }, 3000);
      } else {
        setFormStatus("error");
      }
    } catch (error) {
      setFormStatus("error");
    }
  };

  // ─── NAV ────────────────────────────────────────────────────────────────────
  const Nav = ({ showBack, onBack }) => (
    <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(8,8,16,0.85)", backdropFilter: "blur(20px)", borderBottom: "1px solid var(--border)", padding: "0 24px", height: "58px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {showBack && (
          <button className="ghost-btn" onClick={onBack} style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text-dim)", fontSize: "13px", padding: "6px 12px", marginRight: "4px" }}>
            ← Back
          </button>
        )}
        <div 
          onClick={() => goTo("intro")}
          style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "12px" }}
        >
          <div style={{ width: "30px", height: "30px", background: "var(--green)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 16px rgba(0,255,180,0.4)" }}>
            <span style={{ fontSize: "16px" }}>⚡</span>
          </div>
          <span className="display" style={{ fontWeight: 800, fontSize: "16px", letterSpacing: "-0.5px", color: "#fff" }}>CloudAudit</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
        <button onClick={() => setShowContact(true)} className="ghost-btn" style={{ background: "transparent", border: "none", color: "var(--text-dim)", fontSize: "13px", fontWeight: 600 }}>
          Contact Us
        </button>
        <span style={{ fontSize: "13px", color: "var(--text-muted)", display: "none" }}>Free · No account needed</span>
      </div>
    </nav>
  );

  // ─── CONTACT MODAL ──────────────────────────────────────────────────────────
  const ContactModal = () => (
    <div className="modal-overlay" onClick={() => setShowContact(false)} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "24px", maxWidth: "480px", width: "100%", padding: "40px", boxShadow: "0 40px 80px rgba(0,0,0,0.8)" }}>
        <h2 className="display" style={{ fontSize: "32px", fontWeight: 800, letterSpacing: "-1px", color: "#fff", marginBottom: "8px" }}>Get in touch</h2>
        <p style={{ color: "var(--text-muted)", fontSize: "15px", marginBottom: "32px" }}>Have questions about your audit? Drop us a message.</p>
        
        {formStatus === "success" ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ fontSize: "40px", marginBottom: "16px" }}>✅</div>
            <p style={{ color: "var(--green)", fontWeight: 700, fontSize: "18px" }}>Message Sent!</p>
            <p style={{ color: "var(--text-dim)", marginTop: "8px" }}>We'll get back to you shortly.</p>
          </div>
        ) : (
          <form onSubmit={handleContactSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "1px" }}>Email Address</label>
              <input required type="email" name="email" placeholder="you@company.com" style={{ width: "100%", padding: "14px 18px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "12px", color: "#fff" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "1px" }}>Message</label>
              <textarea required name="message" rows="4" placeholder="How can we help?" style={{ width: "100%", padding: "14px 18px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "12px", color: "#fff", resize: "none" }} />
            </div>
            <button className="glow-btn" disabled={formStatus === "sending"} style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "16px", fontSize: "16px", width: "100%" }}>
              {formStatus === "sending" ? "Sending..." : "Send Message →"}
            </button>
            {formStatus === "error" && <p style={{ color: "#f87171", fontSize: "12px", textAlign: "center" }}>Something went wrong. Please try again.</p>}
          </form>
        )}
      </div>
    </div>
  );

  // ─── SAMPLE REPORT MODAL ────────────────────────────────────────────────────
  const SampleModal = () => {
    const getSev = c => { const p=(c.savingsRange[0]+c.savingsRange[1])/2; return p>=30?"high":p>=15?"med":"low"; };
    const sHigh = sampleFlagged.filter(c=>getSev(c)==="high");
    const sMed = sampleFlagged.filter(c=>getSev(c)==="med");
    const sLow = sampleFlagged.filter(c=>getSev(c)==="low");
    return (
      <div className="modal-overlay" onClick={() => setShowSample(false)} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
        <div className="modal-box" onClick={e => e.stopPropagation()} style={{ background: "var(--bg2)", border: "1px solid rgba(0,255,180,0.2)", borderRadius: "20px", maxWidth: "780px", width: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 40px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,255,180,0.1)" }}>
          <div style={{ padding: "28px 32px 0", borderBottom: "1px solid var(--border)", paddingBottom: "20px", position: "sticky", top: 0, background: "var(--bg2)", zIndex: 10, borderRadius: "20px 20px 0 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
                  {["Sample Report", SAMPLE_REPORT.provider, "Apr 2026"].map(t => (
                    <span key={t} style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-dim)", fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "20px", border: "1px solid var(--border)" }}>{t}</span>
                  ))}
                </div>
                <h2 className="display" style={{ fontSize: "26px", fontWeight: 800, letterSpacing: "-1px", color: "#fff" }}>{SAMPLE_REPORT.companyName} · Cost Report</h2>
                <p style={{ color: "var(--text-muted)", fontSize: "14px", marginTop: "4px" }}>Monthly bill: ${SAMPLE_REPORT.monthlyBill.toLocaleString()} · {sampleFlagged.length} issues found</p>
              </div>
              <button onClick={() => setShowSample(false)} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text-muted)", fontSize: "18px", width: "36px", height: "36px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>×</button>
            </div>
          </div>

          <div style={{ padding: "24px 32px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px", marginBottom: "28px" }}>
              {[
                { label: "Monthly Savings", val: `$${sampleSavMin.toLocaleString()} – $${sampleSavMax.toLocaleString()}`, sub: "per month", color: "var(--green)", bg: "var(--green-dim)", border: "var(--green-border)" },
                { label: "Annual Opportunity", val: `$${(sampleSavMin*12).toLocaleString()}+`, sub: "per year", color: "#818cf8", bg: "rgba(99,102,241,0.1)", border: "rgba(99,102,241,0.25)" },
                { label: "Waste Rate", val: `~${samplePct}%`, sub: "of total bill", color: "#fb923c", bg: "rgba(251,146,60,0.1)", border: "rgba(251,146,60,0.25)" },
              ].map(s => (
                <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: "12px", padding: "18px" }}>
                  <p style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>{s.label}</p>
                  <p className="display" style={{ fontSize: "20px", fontWeight: 800, color: s.color, letterSpacing: "-0.5px" }}>{s.val}</p>
                  <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "3px" }}>{s.sub}</p>
                </div>
              ))}
            </div>

            {[
              { label: "🔴 High Impact", items: sHigh, color: "#f87171", border: "rgba(248,113,113,0.2)" },
              { label: "🟡 Medium Impact", items: sMed, color: "#fbbf24", border: "rgba(251,191,36,0.2)" },
              { label: "🟢 Quick Wins", items: sLow, color: "#4ade80", border: "rgba(74,222,128,0.2)" },
            ].filter(g => g.items.length > 0).map(group => (
              <div key={group.label} style={{ marginBottom: "20px" }}>
                <h4 className="display" style={{ fontSize: "13px", fontWeight: 700, color: group.color, marginBottom: "10px", letterSpacing: "0.3px" }}>{group.label}</h4>
                {group.items.map(check => {
                  const sMin = Math.round(SAMPLE_REPORT.monthlyBill * check.savingsRange[0] / 100);
                  const sMax = Math.round(SAMPLE_REPORT.monthlyBill * check.savingsRange[1] / 100);
                  return (
                    <div key={check.id} style={{ background: "rgba(255,255,255,0.03)", border: `1px solid var(--border)`, borderLeft: `3px solid ${group.color}`, borderRadius: "0 10px 10px 0", padding: "14px 18px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px" }}>
                      <div>
                        <p style={{ fontWeight: 600, fontSize: "14px", color: "#fff", marginBottom: "3px" }}>{check.label}</p>
                        <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>{check.detail}</p>
                      </div>
                      <div style={{ background: "rgba(0,255,180,0.08)", border: "1px solid var(--green-border)", borderRadius: "8px", padding: "6px 12px", textAlign: "right", flexShrink: 0 }}>
                        <p style={{ fontSize: "13px", fontWeight: 700, color: "var(--green)" }}>${sMin.toLocaleString()} – ${sMax.toLocaleString()}</p>
                        <p style={{ fontSize: "10px", color: "var(--text-muted)" }}>/ month</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            <div style={{ background: "linear-gradient(135deg, rgba(0,255,180,0.08) 0%, rgba(99,102,241,0.08) 100%)", border: "1px solid rgba(0,255,180,0.15)", borderRadius: "14px", padding: "24px", textAlign: "center", marginTop: "8px" }}>
              <p style={{ color: "var(--text-dim)", fontSize: "13px", marginBottom: "10px" }}>Ready to find savings like this in your own infrastructure?</p>
              <button className="glow-btn" onClick={() => { setShowSample(false); goTo("intake"); }}
                style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "10px", padding: "13px 32px", fontSize: "15px", fontWeight: 700, boxShadow: "0 0 20px rgba(0,255,180,0.3)" }}>
                Run Your Free Audit →
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ─── INTRO ──────────────────────────────────────────────────────────────────
  if (step === "intro") return (
    <div className="app">
      <style>{globalCss}</style>
      <ParticleBackground />
      {showSample && <SampleModal />}
      {showContact && <ContactModal />}
      <Nav />

      <div style={{ position: "relative", zIndex: 1, maxWidth: "1140px", margin: "0 auto", padding: "0 24px" }}>
        <div style={{ paddingTop: "90px", paddingBottom: "80px", textAlign: "center" }}>
          <div className="fade-up" style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "20px", padding: "7px 18px", marginBottom: "32px" }}>
            <span style={{ width: "6px", height: "6px", background: "var(--green)", borderRadius: "50%", display: "inline-block", boxShadow: "0 0 8px var(--green)" }} />
            <span style={{ fontSize: "12px", color: "var(--green)", fontWeight: 600, letterSpacing: "1px" }}>TRUSTED BY DEVOPS TEAMS ACROSS EY AND UNIT4</span>
          </div>

          <h1 className="display fade-up stagger-1" style={{ fontSize: "clamp(42px,6.5vw,82px)", fontWeight: 800, lineHeight: 1.0, letterSpacing: "-3px", color: "#fff", marginBottom: "24px" }}>
            Find what your<br />
            <span style={{ background: "linear-gradient(135deg, #00ffb4 0%, #00d4ff 60%, #818cf8 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>cloud bill</span><br />
            is hiding.
          </h1>

          <p className="fade-up stagger-2" style={{ fontSize: "18px", color: "var(--text-dim)", lineHeight: 1.75, marginBottom: "44px", maxWidth: "520px", margin: "0 auto 44px" }}>
            A structured 15-minute audit that uncovers real savings in your AWS, GCP, or Azure spend. No agents. No access required. Just your invoice.
          </p>

          <div className="fade-up stagger-3" style={{ display: "flex", gap: "14px", justifyContent: "center", flexWrap: "wrap" }}>
            <button className="glow-btn" onClick={() => goTo("intake")}
              style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "16px 36px", fontSize: "16px", boxShadow: "0 0 24px rgba(0,255,180,0.3)", display: "flex", alignItems: "center", gap: "10px" }}>
              Start Free Audit
              <span style={{ fontSize: "18px" }}>→</span>
            </button>
            <button className="ghost-btn" onClick={() => setShowSample(true)}
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", color: "var(--text-dim)", borderRadius: "12px", padding: "16px 28px", fontSize: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>📄</span> See Sample Report
            </button>
          </div>
          <p className="fade-up stagger-4" style={{ marginTop: "20px", fontSize: "12px", color: "var(--text-muted)" }}>✓ 100% free &nbsp;·&nbsp; ✓ No signup &nbsp;·&nbsp; ✓ Results in 15 minutes</p>
        </div>

        <div className="fade-up stagger-3" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "1px", background: "var(--border)", borderRadius: "16px", overflow: "hidden", border: "1px solid var(--border)", marginBottom: "80px" }}>
          {[
            { n: "20–45%", label: "Average savings found" },
            { n: "18", label: "Audit checkpoints" },
            { n: "< 15 min", label: "Average completion" },
            { n: "0 PLN", label: "Cost to run" },
          ].map((s, i) => (
            <div key={i} style={{ background: "var(--bg2)", padding: "28px 24px", textAlign: "center" }}>
              <div className="display" style={{ fontSize: "28px", fontWeight: 800, color: "var(--green)", letterSpacing: "-1px", marginBottom: "6px" }}>{s.n}</div>
              <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: "100px" }}>
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <p style={{ fontSize: "11px", letterSpacing: "3px", color: "var(--green)", fontWeight: 700, textTransform: "uppercase", marginBottom: "12px" }}>Comprehensive Coverage</p>
            <h2 className="display" style={{ fontSize: "clamp(28px,3.5vw,44px)", fontWeight: 800, letterSpacing: "-1.5px", color: "#fff" }}>What we audit</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "16px", marginTop: "12px", maxWidth: "480px", margin: "12px auto 0" }}>Five critical areas where cloud spend leaks — and where the biggest savings hide.</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
            {AUDIT_SECTIONS.map((s, i) => (
              <div key={s.id} className="audit-cat-card fade-up" style={{ animationDelay: `${0.05 * i}s`, background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "16px", padding: "28px", boxShadow: "0 4px 20px rgba(0,0,0,0.3)", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: "-30px", right: "-30px", width: "100px", height: "100px", background: "radial-gradient(circle, rgba(0,255,180,0.06) 0%, transparent 70%)", borderRadius: "50%" }} />
                <div style={{ fontSize: "32px", marginBottom: "16px" }}>{s.icon}</div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                  <h3 className="display" style={{ fontSize: "18px", fontWeight: 700, color: "#fff", letterSpacing: "-0.3px" }}>{s.label}</h3>
                  <span style={{ background: "var(--green-dim)", color: "var(--green)", fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "10px", border: "1px solid var(--green-border)" }}>{s.checks.length} checks</span>
                </div>
                <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.65, marginBottom: "16px" }}>{s.summary}</p>
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: "14px" }}>
                  <p style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 600, marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.8px" }}>Covers</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {s.checks.slice(0, 3).map(c => (
                      <span key={c.id} style={{ fontSize: "11px", color: "var(--text-dim)", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: "6px", padding: "3px 8px" }}>{c.label}</span>
                    ))}
                    {s.checks.length > 3 && <span style={{ fontSize: "11px", color: "var(--text-muted)", padding: "3px 6px" }}>+{s.checks.length - 3} more</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: "linear-gradient(135deg, rgba(0,255,180,0.06) 0%, rgba(99,102,241,0.06) 100%)", border: "1px solid rgba(0,255,180,0.12)", borderRadius: "24px", padding: "60px 40px", textAlign: "center", marginBottom: "80px" }}>
          <h2 className="display" style={{ fontSize: "clamp(26px,3vw,40px)", fontWeight: 800, letterSpacing: "-1px", color: "#fff", marginBottom: "14px" }}>Ready to find your savings?</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "16px", marginBottom: "32px" }}>Takes 15 minutes. Free forever. No credit card.</p>
          <button className="glow-btn" onClick={() => goTo("intake")}
            style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "16px 40px", fontSize: "16px", boxShadow: "0 0 30px rgba(0,255,180,0.3)" }}>
            Start Free Audit →
          </button>
        </div>

        {/* ── FOOTER ── */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "40px", paddingBottom: "48px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "24px" }}>
          {/* Left — branding */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "26px", height: "26px", background: "var(--green)", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 10px rgba(0,255,180,0.3)", flexShrink: 0 }}>
              <span style={{ fontSize: "13px" }}>⚡</span>
            </div>
            <div>
              <span className="display" style={{ fontWeight: 800, fontSize: "14px", color: "#fff", letterSpacing: "-0.3px" }}>CloudAudit</span>
              <span style={{ color: "var(--text-muted)", fontSize: "13px", marginLeft: "8px" }}>© {new Date().getFullYear()}</span>
            </div>
          </div>

          {/* Centre — built by */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "linear-gradient(135deg, var(--green), #00d4ff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 800, color: "#000", flexShrink: 0 }}>SA</div>
            <div>
              <p style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-dim)", lineHeight: 1.3 }}>Built by <span style={{ color: "#fff" }}>Samuel Ayodele Adomeh</span></p>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.3 }}>Senior DevOps Engineer · Azure Architect Expert · Wrocław, Poland</p>
            </div>
          </div>

          {/* Right — social links */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <a href="www.linkedin.com/in/adomeh" target="_blank" rel="noopener noreferrer"
              style={{ display: "flex", alignItems: "center", gap: "7px", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: "8px", padding: "8px 14px", fontSize: "13px", fontWeight: 600, color: "var(--text-dim)", textDecoration: "none", transition: "all 0.2s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#0077b5"; e.currentTarget.style.color = "#0077b5"; e.currentTarget.style.background = "rgba(0,119,181,0.08)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
              LinkedIn
            </a>
            <a href="https://github.com/leumasj" target="_blank" rel="noopener noreferrer"
              style={{ display: "flex", alignItems: "center", gap: "7px", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: "8px", padding: "8px 14px", fontSize: "13px", fontWeight: 600, color: "var(--text-dim)", textDecoration: "none", transition: "all 0.2s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)"; e.currentTarget.style.color = "#fff"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg>
              GitHub
            </a>
          </div>
        </div>

      </div>
    </div>
  );

  // ─── INTAKE ─────────────────────────────────────────────────────────────────
  if (step === "intake") return (
    <div className="app">
      <style>{globalCss}</style>
      <ParticleBackground />
      {showContact && <ContactModal />}
      <Nav showBack onBack={() => goTo("intro")} />
      <div key={pageKey} style={{ maxWidth: "540px", margin: "0 auto", padding: "60px 24px", position: "relative", zIndex: 1 }}>
        <div className="fade-up">
          <h2 className="display" style={{ fontSize: "36px", fontWeight: 800, letterSpacing: "-1.5px", color: "#fff", marginBottom: "8px" }}>Set up your audit</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "15px", marginBottom: "40px" }}>30 seconds. We'll tailor savings estimates to your actual spend.</p>
        </div>

        <div className="fade-up stagger-1" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--green)", marginBottom: "10px", letterSpacing: "1px", textTransform: "uppercase" }}>Company or project</label>
            <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. Acme Corp"
              style={{ width: "100%", padding: "14px 18px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "12px", color: "#fff", fontSize: "15px", transition: "all 0.2s" }} />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--green)", marginBottom: "10px", letterSpacing: "1px", textTransform: "uppercase" }}>Cloud provider</label>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {PROVIDERS.map(p => (
                <button key={p} className="provider-chip" onClick={() => setProvider(p)}
                  style={{ padding: "10px 20px", borderRadius: "10px", fontSize: "14px", fontWeight: 600, border: `1.5px solid ${provider === p ? "var(--green)" : "var(--border)"}`, background: provider === p ? "var(--green-dim)" : "rgba(255,255,255,0.03)", color: provider === p ? "var(--green)" : "var(--text-muted)" }}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--green)", marginBottom: "10px", letterSpacing: "1px", textTransform: "uppercase" }}>Monthly cloud bill (USD)</label>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: "18px", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", fontSize: "16px", fontWeight: 700 }}>$</span>
              <input type="number" value={monthlyBill} onChange={e => setMonthlyBill(e.target.value)} placeholder="3,500"
                style={{ width: "100%", padding: "14px 18px 14px 34px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "12px", color: "#fff", fontSize: "15px", transition: "all 0.2s" }} />
            </div>
            {bill > 0 && (
              <div style={{ marginTop: "10px", padding: "12px 16px", background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "10px", fontSize: "13px", color: "var(--green)", fontWeight: 600 }}>
                💰 Typical savings: <strong>${Math.round(bill*0.20).toLocaleString()} – ${Math.round(bill*0.45).toLocaleString()}/mo</strong> based on 18 audit checks
              </div>
            )}
          </div>

          <button className="glow-btn" disabled={!provider || !monthlyBill}
            onClick={() => { setActiveSection(0); goTo("audit"); }}
            style={{ background: provider && monthlyBill ? "var(--green)" : "rgba(255,255,255,0.06)", color: provider && monthlyBill ? "#000" : "var(--text-muted)", border: "none", borderRadius: "12px", padding: "16px", fontSize: "15px", boxShadow: provider && monthlyBill ? "0 0 24px rgba(0,255,180,0.3)" : "none", cursor: provider && monthlyBill ? "pointer" : "not-allowed", marginTop: "8px" }}>
            Begin Audit →
          </button>
        </div>
      </div>
    </div>
  );

  // ─── AUDIT ──────────────────────────────────────────────────────────────────
  if (step === "audit") {
    const section = AUDIT_SECTIONS[activeSection];
    return (
      <div className="app">
        <style>{globalCss}</style>
        <ParticleBackground />
        {showContact && <ContactModal />}
        <Nav showBack onBack={() => goTo("intake")} />
        <div style={{ height: "2px", background: "var(--border)", position: "sticky", top: "58px", zIndex: 99 }}>
          <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, var(--green), #00d4ff, #818cf8)", transition: "width 0.5s ease", boxShadow: "0 0 8px rgba(0,255,180,0.6)" }} />
        </div>

        <div style={{ maxWidth: "960px", margin: "0 auto", padding: "32px 24px 120px", position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", gap: "4px", overflowX: "auto", marginBottom: "32px", paddingBottom: "4px" }}>
            {AUDIT_SECTIONS.map((s, i) => {
              const done = s.checks.filter(c => checked[c.id] !== undefined).length;
              const active = i === activeSection;
              return (
                <button key={s.id} className="section-tab" onClick={() => setActiveSection(i)}
                  style={{ padding: "8px 16px", borderRadius: "8px", border: `1px solid ${active ? "var(--green-border)" : "transparent"}`, background: active ? "var(--green-dim)" : "transparent", color: active ? "var(--green)" : "var(--text-muted)", fontSize: "13px", fontWeight: active ? 700 : 500, display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}>
                  <span>{s.icon}</span>{s.label}
                  {done > 0 && <span style={{ background: active ? "var(--green)" : "rgba(255,255,255,0.1)", color: active ? "#000" : "var(--text-muted)", borderRadius: "10px", fontSize: "10px", padding: "1px 6px", fontWeight: 700 }}>{done}</span>}
                </button>
              );
            })}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 290px", gap: "24px", alignItems: "start" }}>
            <div key={activeSection} className="fade-up">
              <div style={{ marginBottom: "24px" }}>
                <h2 className="display" style={{ fontSize: "26px", fontWeight: 800, letterSpacing: "-0.5px", color: "#fff" }}>{section.icon} {section.label}</h2>
                <p style={{ fontSize: "14px", color: "var(--text-muted)", marginTop: "4px" }}>{section.description}</p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {section.checks.map(check => {
                  const on = !!checked[check.id];
                  const sMin = bill > 0 ? Math.round(bill * check.savingsRange[0] / 100) : null;
                  const sMax = bill > 0 ? Math.round(bill * check.savingsRange[1] / 100) : null;
                  return (
                    <div key={check.id} className="check-card" onClick={() => toggle(check.id)}
                      style={{ background: on ? "rgba(0,255,180,0.05)" : "rgba(255,255,255,0.02)", border: `1.5px solid ${on ? "rgba(0,255,180,0.25)" : "var(--border)"}`, borderRadius: "14px", padding: "18px 20px", display: "flex", gap: "14px", alignItems: "flex-start", boxShadow: on ? "0 4px 20px rgba(0,255,180,0.08)" : "0 1px 4px rgba(0,0,0,0.2)" }}>
                      <div style={{ width: "24px", height: "24px", borderRadius: "7px", flexShrink: 0, marginTop: "1px", background: on ? "var(--green)" : "transparent", border: `2px solid ${on ? "var(--green)" : "rgba(255,255,255,0.15)"}`, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s", boxShadow: on ? "0 0 12px rgba(0,255,180,0.5)" : "none" }}>
                        {on && <svg width="12" height="9" viewBox="0 0 12 9" fill="none"><path d="M1 4L4.5 7.5L11 1" stroke="#000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "4px" }}>
                          <span style={{ fontSize: "15px", fontWeight: 600, color: on ? "#fff" : "var(--text-dim)" }}>{check.label}</span>
                          <span style={{ fontSize: "11px", fontWeight: 700, color: IMPACT_COLOR[check.impact], background: `${IMPACT_COLOR[check.impact]}15`, borderRadius: "4px", padding: "2px 7px" }}>{check.impact}</span>
                          <span style={{ fontSize: "11px", fontWeight: 600, color: EFFORT_COLOR[check.effort], background: `${EFFORT_COLOR[check.effort]}10`, borderRadius: "4px", padding: "2px 7px" }}>Effort: {check.effort}</span>
                        </div>
                        <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.5 }}>{check.detail}</p>
                        {on && bill > 0 && (
                          <div style={{ marginTop: "10px", display: "inline-flex", alignItems: "center", gap: "6px", background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "8px", padding: "5px 12px" }}>
                            <span style={{ fontSize: "13px" }}>💰</span>
                            <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--green)" }}>${sMin?.toLocaleString()} – ${sMax?.toLocaleString()}/mo savings</span>
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.2)", flexShrink: 0, fontWeight: 600 }}>{check.savingsRange[0]}–{check.savingsRange[1]}%</div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: "10px", marginTop: "28px" }}>
                {activeSection > 0 && (
                  <button className="ghost-btn" onClick={() => setActiveSection(a => a-1)}
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: "10px", padding: "12px 22px", fontSize: "14px", fontWeight: 600, color: "var(--text-muted)" }}>
                    ← Previous
                  </button>
                )}
                {activeSection < AUDIT_SECTIONS.length - 1 ? (
                  <button className="glow-btn" onClick={() => setActiveSection(a => a+1)}
                    style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "10px", padding: "12px 28px", fontSize: "14px", boxShadow: "0 0 20px rgba(0,255,180,0.25)" }}>
                    Next: {AUDIT_SECTIONS[activeSection+1].label} →
                  </button>
                ) : (
                  <button className="glow-btn" onClick={() => goTo("report")}
                    style={{ background: "linear-gradient(135deg, var(--green), #00d4ff)", color: "#000", border: "none", borderRadius: "10px", padding: "12px 32px", fontSize: "14px", boxShadow: "0 0 24px rgba(0,255,180,0.3)" }}>
                    Generate Report →
                  </button>
                )}
              </div>
            </div>

            <div style={{ position: "sticky", top: "76px", display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "16px", padding: "24px", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                  <p style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.5px", color: "var(--text-muted)", textTransform: "uppercase" }}>Live Estimate</p>
                  <ProgressRing percent={progress} />
                </div>
                {flagged.length > 0 && bill > 0 ? (
                  <>
                    <div className="display" style={{ fontSize: "28px", fontWeight: 800, color: "var(--green)", letterSpacing: "-1px", lineHeight: 1, marginBottom: "4px" }}>
                      <AnimatedNumber value={savMin} prefix="$" />–<AnimatedNumber value={savMax} prefix="$" />
                    </div>
                    <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "14px" }}>/ month · ~{savPct}% of bill</p>
                    <div style={{ height: "5px", background: "rgba(255,255,255,0.06)", borderRadius: "3px", overflow: "hidden", marginBottom: "14px" }}>
                      <div style={{ height: "100%", width: `${Math.min(savPct*2,100)}%`, background: "linear-gradient(90deg,var(--green),#00d4ff)", borderRadius: "3px", transition: "width 0.5s ease", boxShadow: "0 0 6px rgba(0,255,180,0.5)" }} />
                    </div>
                    <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>Annual: <span style={{ color: "var(--green)", fontWeight: 700 }}>${(savMin*12).toLocaleString()} – ${(savMax*12).toLocaleString()}</span></p>
                  </>
                ) : (
                  <div style={{ textAlign: "center", padding: "16px 0", color: "var(--text-muted)", fontSize: "13px" }}>Flag issues above to<br />see your estimate</div>
                )}
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: "14px", marginTop: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  {[["Issues flagged", flagged.length, flagged.length > 0 ? "#f87171" : "var(--text-muted)"], ["Checks reviewed", `${Object.keys(checked).length}/${allChecks.length}`, "var(--text-dim)"], ["Progress", `${progress}%`, "var(--green)"]].map(([l,v,c]) => (
                    <div key={l} style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{l}</span>
                      <span style={{ fontSize: "12px", fontWeight: 700, color: c }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "14px", padding: "18px" }}>
                <p style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1px", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "14px" }}>Sections</p>
                {AUDIT_SECTIONS.map((s, i) => {
                  const done = s.checks.filter(c => checked[c.id] !== undefined).length;
                  const pct = Math.round((done/s.checks.length)*100);
                  return (
                    <div key={s.id} onClick={() => setActiveSection(i)} style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", cursor: "pointer", opacity: i===activeSection?1:0.6, transition: "opacity 0.15s" }}>
                      <span style={{ fontSize: "14px", width: "18px" }}>{s.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                          <span style={{ fontSize: "11px", fontWeight: 600, color: i===activeSection ? "var(--green)" : "var(--text-dim)" }}>{s.label}</span>
                          <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{done}/{s.checks.length}</span>
                        </div>
                        <div style={{ height: "3px", background: "rgba(255,255,255,0.06)", borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: i===activeSection ? "var(--green)" : "#4ade80", borderRadius: "2px", transition: "width 0.3s" }} />
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

  // ─── REPORT ─────────────────────────────────────────────────────────────────
  if (step === "report") {
    const getSev = c => { const p=(c.savingsRange[0]+c.savingsRange[1])/2; return p>=30?"high":p>=15?"med":"low"; };
    const high = flagged.filter(c=>getSev(c)==="high");
    const med = flagged.filter(c=>getSev(c)==="med");
    const low = flagged.filter(c=>getSev(c)==="low");

    return (
      <div className="app">
        <style>{globalCss}</style>
        <ParticleBackground />
        {showContact && <ContactModal />}
        <Nav showBack onBack={() => goTo("audit")} />
        <div key={pageKey} style={{ maxWidth: "900px", margin: "0 auto", padding: "48px 24px 80px", position: "relative", zIndex: 1 }}>

          <div className="fade-up" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "40px", flexWrap: "wrap", gap: "16px" }}>
            <div>
              <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
                {[companyName||"Cloud Audit", provider, new Date().toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"})].map(t=>(
                  <span key={t} style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-dim)", fontSize: "12px", fontWeight: 600, padding: "4px 12px", borderRadius: "20px", border: "1px solid var(--border)" }}>{t}</span>
                ))}
              </div>
              <h1 className="display" style={{ fontSize: "clamp(28px,4vw,46px)", fontWeight: 800, letterSpacing: "-1.5px", color: "#fff" }}>Cost Optimisation Report</h1>
              <p style={{ color: "var(--text-muted)", fontSize: "15px", marginTop: "8px" }}>
                {flagged.length > 0 ? `${flagged.length} issues found · Estimated ${savPct}% waste rate` : "No issues found — well optimised infrastructure."}
              </p>
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button className="ghost-btn" onClick={() => window.print()}
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: "10px", padding: "10px 18px", fontSize: "13px", fontWeight: 600, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "6px" }}>
                🖨 Export
              </button>
              <button className="glow-btn" onClick={() => { setChecked({}); setActiveSection(0); goTo("audit"); }}
                style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "10px", padding: "10px 20px", fontSize: "13px", boxShadow: "0 0 16px rgba(0,255,180,0.25)" }}>
                Re-run
              </button>
            </div>
          </div>

          {bill > 0 && (
            <div className="fade-up stagger-1" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "14px", marginBottom: "32px" }}>
              {[
                { l: "Monthly Savings", v: `$${savMin.toLocaleString()} – $${savMax.toLocaleString()}`, s: "/month", c: "var(--green)", bg: "var(--green-dim)", b: "var(--green-border)" },
                { l: "Annual Opportunity", v: `$${(savMin*12).toLocaleString()}+`, s: "per year", c: "#818cf8", bg: "rgba(99,102,241,0.08)", b: "rgba(99,102,241,0.2)" },
                { l: "Waste Rate", v: `~${savPct}%`, s: savPct>=30?"Critical":savPct>=15?"Significant":"Moderate", c: savPct>=30?"#f87171":savPct>=15?"#fb923c":"#fbbf24", bg: "rgba(248,113,113,0.06)", b: "rgba(248,113,113,0.15)" },
                { l: "Issues Found", v: flagged.length, s: `of ${allChecks.length} checked`, c: "#fb923c", bg: "rgba(251,146,60,0.06)", b: "rgba(251,146,60,0.15)" },
              ].map(s=>(
                <div key={s.l} style={{ background: s.bg, border: `1px solid ${s.b}`, borderRadius: "14px", padding: "22px" }}>
                  <p style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "1.2px", marginBottom: "10px" }}>{s.l}</p>
                  <p className="display" style={{ fontSize: "22px", fontWeight: 800, color: s.c, letterSpacing: "-0.5px", lineHeight: 1 }}>{s.v}</p>
                  <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "5px" }}>{s.s}</p>
                </div>
              ))}
            </div>
          )}

          <div className="fade-up stagger-2">
            {[
              { label: "🔴 Critical & High Impact", items: high, color: "#f87171" },
              { label: "🟡 Medium Impact", items: med, color: "#fbbf24" },
              { label: "🟢 Quick Wins", items: low, color: "#4ade80" },
            ].filter(g=>g.items.length>0).map(group=>(
              <div key={group.label} style={{ marginBottom: "28px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                  <h3 className="display" style={{ fontSize: "15px", fontWeight: 700, color: group.color }}>{group.label}</h3>
                  <span style={{ background: `${group.color}15`, color: group.color, fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "10px" }}>{group.items.length}</span>
                </div>
                {group.items.map(check=>{
                  const sMin2 = bill>0 ? Math.round(bill*check.savingsRange[0]/100) : null;
                  const sMax2 = bill>0 ? Math.round(bill*check.savingsRange[1]/100) : null;
                  return (
                    <div key={check.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", borderLeft: `3px solid ${group.color}`, borderRadius: "0 12px 12px 0", padding: "16px 20px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                      <div>
                        <p style={{ fontWeight: 600, fontSize: "15px", color: "#fff", marginBottom: "4px" }}>{check.label}</p>
                        <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>{check.detail}</p>
                      </div>
                      {bill>0&&<div style={{ background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "8px", padding: "8px 14px", textAlign: "right", flexShrink: 0 }}>
                        <p style={{ fontSize: "14px", fontWeight: 700, color: "var(--green)" }}>${sMin2?.toLocaleString()} – ${sMax2?.toLocaleString()}</p>
                        <p style={{ fontSize: "10px", color: "var(--text-muted)" }}>/ month</p>
                      </div>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="fade-up stagger-3" style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "16px", padding: "28px", marginBottom: "24px" }}>
            <h3 className="display" style={{ fontSize: "18px", fontWeight: 700, marginBottom: "20px", color: "#fff", letterSpacing: "-0.3px" }}>Recommended action plan</h3>
            {[
              high.length>0 && { n:1, t:"Tackle critical & high-impact findings first — fastest ROI with least risk.", c:"#f87171" },
              { n:2, t:"Set billing alerts at 80% and 100% of your monthly target in your cloud console today.", c:"var(--green)" },
              { n:3, t:"Implement auto-shutdown for dev/staging outside business hours.", c:"var(--green)" },
              { n:4, t:"Run a rightsizing review using your provider's native tooling (Compute Optimizer / GCP Recommender).", c:"#818cf8" },
              { n:5, t:"Revisit this audit in 30 days after changes are applied to measure real impact.", c:"var(--text-dim)" },
            ].filter(Boolean).map(item=>(
              <div key={item.n} style={{ display: "flex", gap: "14px", alignItems: "flex-start", marginBottom: "14px" }}>
                <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: `${item.c}15`, border: `1.5px solid ${item.c}40`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span className="display" style={{ fontSize: "12px", fontWeight: 800, color: item.c }}>{item.n}</span>
                </div>
                <p style={{ fontSize: "14px", color: "var(--text-dim)", lineHeight: 1.65, paddingTop: "4px" }}>{item.t}</p>
              </div>
            ))}
          </div>

          <div className="fade-up stagger-4" style={{ background: "linear-gradient(135deg, rgba(0,255,180,0.07) 0%, rgba(99,102,241,0.07) 100%)", border: "1px solid rgba(0,255,180,0.15)", borderRadius: "20px", padding: "40px", textAlign: "center" }}>
            <p style={{ fontSize: "12px", fontWeight: 700, color: "var(--green)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "12px" }}>Need hands-on help?</p>
            <h3 className="display" style={{ fontSize: "28px", fontWeight: 800, letterSpacing: "-0.5px", color: "#fff", marginBottom: "10px" }}>Book an implementation session</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "15px", marginBottom: "28px" }}>Senior DevOps engineer · Remote · Full report + implementation in 48hrs</p>

            {/* Trust card */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: "16px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: "16px 24px", marginBottom: "28px", textAlign: "left" }}>
              <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "linear-gradient(135deg, var(--green), #00d4ff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", fontWeight: 800, color: "#000", flexShrink: 0 }}>SA</div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: "15px", fontWeight: 700, color: "#fff", marginBottom: "3px" }}>Samuel Ayodele Adomeh</p>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px" }}>Certified Azure Architect Expert · DevOps Expert · Wrocław, Poland</p>
                <div style={{ display: "flex", gap: "8px" }}>
                  <a href="https://www.linkedin.com/in/samuel-ayodele-adomeh" target="_blank" rel="noopener noreferrer"
                    style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", fontWeight: 600, color: "#0077b5", textDecoration: "none", background: "rgba(0,119,181,0.1)", border: "1px solid rgba(0,119,181,0.25)", borderRadius: "6px", padding: "3px 8px" }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                    LinkedIn
                  </a>
                  <a href="https://github.com/leumasj" target="_blank" rel="noopener noreferrer"
                    style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", fontWeight: 600, color: "var(--text-dim)", textDecoration: "none", background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: "6px", padding: "3px 8px" }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg>
                    GitHub
                  </a>
                </div>
              </div>
              <div style={{ display: "flex", gap: "6px", flexDirection: "column", flexShrink: 0 }}>
                {["Azure Architect", "DevOps Expert", "28 GitHub repos"].map(badge => (
                  <span key={badge} style={{ fontSize: "10px", fontWeight: 600, color: "var(--green)", background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "4px", padding: "2px 8px", whiteSpace: "nowrap" }}>{badge}</span>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
              <button className="glow-btn" onClick={() => setShowBooking(true)} style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "14px 32px", fontSize: "15px", boxShadow: "0 0 28px rgba(0,255,180,0.35)" }}>
                Book for 999 PLN →
              </button>
              <button className="ghost-btn" onClick={() => goTo("intro")}
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: "12px", padding: "14px 24px", fontSize: "15px" }}>
                New Audit
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}