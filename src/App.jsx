import { useState, useEffect, useRef } from "react";

const AUDIT_SECTIONS = [
  {
    id: "compute", label: "Compute", icon: "⚡",
    description: "Instance sizing, reservation strategy & generation currency",
    summary: "Identifies idle VMs, missing savings plans, spot opportunities, and legacy instance types burning money silently.",
    checks: [
      { id: "rightsizing", label: "Idle or oversized instances", detail: "Over 80% unused capacity detected", fix: "Use AWS Compute Optimizer to identify instances with <10% CPU utilization.", savingsRange: [15, 40], effort: "Medium", impact: "High" },
      { id: "reserved", label: "No Reserved Instances / Savings Plans", detail: "Running fully on-demand pricing", fix: "Purchase 1-year No Upfront Savings Plans for stable baseline workloads.", savingsRange: [20, 45], effort: "Low", impact: "High" },
      { id: "spot", label: "Spot unused for batch/dev", detail: "CI runners, ML training, ETL jobs eligible", fix: "Migrate stateless Jenkins agents or GitHub Runners to Spot instances.", savingsRange: [60, 80], effort: "Medium", impact: "Critical" },
      { id: "old_gen", label: "Previous-generation instances", detail: "m4, c4, r4 families still in use", fix: "Upgrade to m6g/m7g (Graviton) for 40% better price-performance.", savingsRange: [5, 15], effort: "Low", impact: "Medium" },
      { id: "stopped", label: "Stopped instances still billing", detail: "EBS volumes and Elastic IPs accruing charges", fix: "Terminate instances rather than stopping if data is backed up.", savingsRange: [2, 8], effort: "Low", impact: "Low" },
    ],
  },
  {
    id: "storage", label: "Storage", icon: "🗄",
    description: "Object storage tiering, orphaned volumes & data transfer",
    summary: "Uncovers untriered S3/GCS data, orphaned disks after instance deletion, stale snapshots, and expensive egress routing.",
    checks: [
      { id: "s3_tier", label: "Storage not tiered", detail: "All data sitting in Standard class", fix: "Enable S3 Intelligent-Tiering to automate lifecycle transitions.", savingsRange: [30, 60], effort: "Low", impact: "High" },
      { id: "unattached_volumes", label: "Unattached disks & orphaned volumes", detail: "Persisting after instance termination", fix: "Automate deletion of unattached EBS volumes via Lambda or AWS Config.", savingsRange: [5, 20], effort: "Low", impact: "Medium" },
      { id: "snapshots", label: "Snapshot retention policy missing", detail: "Old backups never purged or archived", fix: "Use AWS Lifecycle Manager (DLM) to set a 30-day retention limit.", savingsRange: [5, 15], effort: "Low", impact: "Medium" },
      { id: "data_transfer", label: "Excessive cross-region egress", detail: "No CDN or VPC endpoint in place", fix: "Deploy S3 VPC Endpoints to keep traffic within the AWS backbone.", savingsRange: [10, 35], effort: "Medium", impact: "High" },
    ],
  },
  {
    id: "network", label: "Network", icon: "🌐",
    description: "NAT gateways, static IPs & idle load balancers",
    summary: "Catches NAT gateway overuse for internal traffic, idle load balancers billing hourly, and unattached static IPs.",
    checks: [
      { id: "nat_gateway", label: "Excessive NAT Gateway traffic", detail: "Internal traffic routed through NAT unnecessarily", fix: "Use Interface VPC Endpoints for high-traffic services like Kinesis/S3.", savingsRange: [10, 30], effort: "Medium", impact: "High" },
      { id: "unused_ips", label: "Unused static / Elastic IPs", detail: "Unattached IPs billed hourly", fix: "Release Elastic IPs that are not associated with running instances.", savingsRange: [1, 5], effort: "Low", impact: "Low" },
      { id: "lb_unused", label: "Idle load balancers", detail: "ALBs and NLBs with no active targets", fix: "Review ELB CloudWatch metrics and delete balancers with zero RequestCount.", savingsRange: [3, 10], effort: "Low", impact: "Medium" },
    ],
  },
  {
    id: "database", label: "Database", icon: "🗃",
    description: "RDS sizing, dev environment waste & caching gaps",
    summary: "Finds dev/staging RDS running 24/7, over-provisioned databases, and missing Redis layers that cause DB overload.",
    checks: [
      { id: "rds_idle", label: "Dev/staging RDS running 24/7", detail: "Full-price uptime for non-prod databases", fix: "Use Instance Scheduler to stop RDS instances during weekends/nights.", savingsRange: [40, 70], effort: "Low", impact: "Critical" },
      { id: "rds_size", label: "RDS instances over-provisioned", detail: "High memory, <10% actual usage", fix: "Downsize DB instances; RDS IOPS optimization can often replace larger sizes.", savingsRange: [20, 40], effort: "Medium", impact: "High" },
      { id: "cache_missing", label: "No caching layer in front of DB", detail: "Redis/Memcached could offload 80% of queries", fix: "Implement ElastiCache to reduce expensive RDS read-replica costs.", savingsRange: [15, 30], effort: "High", impact: "High" },
    ],
  },
  {
    id: "governance", label: "Governance", icon: "📊",
    description: "Budgets, alerts, forgotten resources & environment parity",
    summary: "Exposes missing billing alerts, shadow IT resources accumulating cost, and dev environments mirroring production unnecessarily.",
    checks: [
      { id: "no_budgets", label: "No cost budgets or alerts", detail: "Spend drifting without visibility", fix: "Create AWS Budgets with SNS alerts at 50%, 80%, and 100% of forecast.", savingsRange: [5, 20], effort: "Low", impact: "High" },
      { id: "unused_services", label: "Forgotten services & shadow IT", detail: "Old Lambdas, API GWs accruing cost", fix: "Run AWS Trusted Advisor monthly to prune unused resources.", savingsRange: [3, 15], effort: "Medium", impact: "Medium" },
      { id: "dev_prod_parity", label: "Dev environment mirrors production", detail: "Should be 10–20% of prod size", fix: "Enforce T3/T4g instance types for all non-production environments.", savingsRange: [30, 50], effort: "Medium", impact: "Critical" },
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
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{prefix}{display.toLocaleString()}{suffix}</span>;
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
  .glow-btn { transition: all 0.2s; cursor: pointer; font-family: var(--display); font-weight: 700; }
  .glow-btn:hover { box-shadow: 0 0 30px rgba(0,255,180,0.35), 0 0 60px rgba(0,255,180,0.15) !important; transform: translateY(-2px); }
  .ghost-btn { transition: all 0.2s; cursor: pointer; font-family: var(--body); }
  .ghost-btn:hover { border-color: rgba(255,255,255,0.25) !important; color: #fff !important; background: rgba(255,255,255,0.05) !important; }
  .check-card { transition: all 0.2s cubic-bezier(0.4,0,0.2,1); cursor: pointer; }
  .check-card:hover { transform: translateX(4px); border-color: rgba(0,255,180,0.2) !important; background: rgba(255,255,255,0.04) !important; }
  .audit-cat-card { transition: all 0.25s cubic-bezier(0.4,0,0.2,1); cursor: default; backdrop-filter: blur(12px); }
  .audit-cat-card:hover { transform: translateY(-4px); border-color: var(--green-border) !important; box-shadow: 0 16px 40px rgba(0,0,0,0.4); }
  .glass { background: rgba(13, 13, 26, 0.7); backdrop-filter: blur(12px); border: 1px solid var(--border); }
  input:focus { outline: none; border-color: var(--green) !important; box-shadow: 0 0 0 3px rgba(0,255,180,0.1) !important; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
`;

export default function App() {
  const [step, setStep] = useState("intro");
  const [provider, setProvider] = useState("");
  const [monthlyBill, setMonthlyBill] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [checked, setChecked] = useState({});
  const [activeSection, setActiveSection] = useState(0);
  const [showSample, setShowSample] = useState(false);
  const [pageKey, setPageKey] = useState(0);
  const [strategy, setStrategy] = useState(1); // 0: Conservative, 1: Standard, 2: Aggressive

  const toggle = (id) => setChecked(p => ({ ...p, [id]: !p[id] }));
  const goTo = (s) => { setStep(s); setPageKey(k => k + 1); window.scrollTo(0,0); };

  const bill = parseFloat(monthlyBill) || 0;
  const strategyMulti = strategy === 0 ? 0.75 : strategy === 2 ? 1.25 : 1;
  
  const allChecks = AUDIT_SECTIONS.flatMap(s => s.checks);
  const flagged = allChecks.filter(c => checked[c.id]);
  const savMin = Math.round(flagged.reduce((s, c) => s + bill * c.savingsRange[0] / 100, 0) * strategyMulti);
  const savMax = Math.round(flagged.reduce((s, c) => s + bill * c.savingsRange[1] / 100, 0) * strategyMulti);
  const savPct = bill > 0 ? Math.round(((savMin + savMax) / 2 / bill) * 100) : 0;
  const progress = Math.round((Object.keys(checked).length / allChecks.length) * 100);

  // ─── NAV ────────────────────────────────────────────────────────────────────
  const Nav = ({ showBack, onBack }) => (
    <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(8,8,16,0.85)", backdropFilter: "blur(20px)", borderBottom: "1px solid var(--border)", padding: "0 24px", height: "58px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {showBack && (
          <button className="ghost-btn" onClick={onBack} style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text-dim)", fontSize: "13px", padding: "6px 12px", marginRight: "4px" }}>
            ← Back
          </button>
        )}
        <div style={{ width: "30px", height: "30px", background: "var(--green)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 16px rgba(0,255,180,0.4)" }}>
          <span style={{ fontSize: "16px" }}>⚡</span>
        </div>
        <span className="display" style={{ fontWeight: 800, fontSize: "16px", letterSpacing: "-0.5px", color: "#fff" }}>CloudAudit</span>
        <span style={{ background: "rgba(0,255,180,0.12)", color: "var(--green)", fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "20px", letterSpacing: "1px", border: "1px solid var(--green-border)" }}>BETA</span>
      </div>
      <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>Free · Professional Cloud Waste Audit</span>
    </nav>
  );

  // ─── INTRO ──────────────────────────────────────────────────────────────────
  if (step === "intro") return (
    <div className="app">
      <style>{globalCss}</style>
      <ParticleBackground />
      <Nav />
      <div style={{ position: "relative", zIndex: 1, maxWidth: "1140px", margin: "0 auto", padding: "0 24px" }}>
        <div style={{ paddingTop: "90px", paddingBottom: "80px", textAlign: "center" }}>
          <div className="fade-up" style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "20px", padding: "7px 18px", marginBottom: "32px" }}>
            <span style={{ width: "6px", height: "6px", background: "var(--green)", borderRadius: "50%", display: "inline-block", boxShadow: "0 0 8px var(--green)" }} />
            <span style={{ fontSize: "12px", color: "var(--green)", fontWeight: 600, letterSpacing: "1px" }}>TRUSTED BY DEVOPS TEAMS ACROSS EUROPE</span>
          </div>
          <h1 className="display fade-up" style={{ fontSize: "clamp(42px,6.5vw,82px)", fontWeight: 800, lineHeight: 1.0, letterSpacing: "-3px", color: "#fff", marginBottom: "24px" }}>
            Find what your<br />
            <span style={{ background: "linear-gradient(135deg, #00ffb4 0%, #00d4ff 60%, #818cf8 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>cloud bill</span><br />
            is hiding.
          </h1>
          <p className="fade-up" style={{ fontSize: "18px", color: "var(--text-dim)", lineHeight: 1.75, marginBottom: "44px", maxWidth: "520px", margin: "0 auto 44px" }}>
            A structured 15-minute audit that uncovers real savings in your AWS, GCP, or Azure spend. No agents. No access required. Just your invoice.
          </p>
          <div className="fade-up" style={{ display: "flex", gap: "14px", justifyContent: "center", flexWrap: "wrap" }}>
            <button className="glow-btn" onClick={() => goTo("intake")}
              style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "16px 36px", fontSize: "16px", boxShadow: "0 0 24px rgba(0,255,180,0.3)", display: "flex", alignItems: "center", gap: "10px" }}>
              Start Free Audit →
            </button>
            <button className="ghost-btn" onClick={() => setShowSample(true)}
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", color: "var(--text-dim)", borderRadius: "12px", padding: "16px 28px", fontSize: "16px" }}>
              📄 See Sample Report
            </button>
          </div>
        </div>

        <div className="fade-up" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "1px", background: "var(--border)", borderRadius: "16px", overflow: "hidden", border: "1px solid var(--border)", marginBottom: "80px" }}>
          {[
            { n: "20–45%", label: "Average savings found" },
            { n: "18", label: "Audit checkpoints" },
            { n: "< 15 min", label: "Average completion" },
            { n: "0 PLN", label: "Cost to run" },
          ].map((s, i) => (
            <div key={i} className="glass" style={{ padding: "28px 24px", textAlign: "center", border: "none" }}>
              <div className="display" style={{ fontSize: "28px", fontWeight: 800, color: "var(--green)", letterSpacing: "-1px", marginBottom: "6px" }}>{s.n}</div>
              <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: "100px" }}>
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <p style={{ fontSize: "11px", letterSpacing: "3px", color: "var(--green)", fontWeight: 700, textTransform: "uppercase", marginBottom: "12px" }}>Comprehensive Coverage</p>
            <h2 className="display" style={{ fontSize: "clamp(28px,3.5vw,44px)", fontWeight: 800, letterSpacing: "-1.5px", color: "#fff" }}>What we audit</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
            {AUDIT_SECTIONS.map((s, i) => (
              <div key={s.id} className="audit-cat-card glass" style={{ borderRadius: "16px", padding: "28px" }}>
                <div style={{ fontSize: "32px", marginBottom: "16px" }}>{s.icon}</div>
                <h3 className="display" style={{ fontSize: "18px", fontWeight: 700, color: "#fff", marginBottom: "10px" }}>{s.label}</h3>
                <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.65 }}>{s.summary}</p>
              </div>
            ))}
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
      <Nav showBack onBack={() => goTo("intro")} />
      <div key={pageKey} style={{ maxWidth: "540px", margin: "0 auto", padding: "60px 24px", position: "relative", zIndex: 1 }}>
        <h2 className="display fade-up" style={{ fontSize: "36px", fontWeight: 800, color: "#fff", marginBottom: "40px" }}>Set up your audit</h2>
        <div className="fade-up" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--green)", marginBottom: "10px", textTransform: "uppercase" }}>Company Name</label>
            <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. Acme Corp"
              style={{ width: "100%", padding: "14px 18px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "12px", color: "#fff" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--green)", marginBottom: "10px", textTransform: "uppercase" }}>Cloud Provider</label>
            <div style={{ display: "flex", gap: "10px" }}>
              {PROVIDERS.map(p => (
                <button key={p} onClick={() => setProvider(p)}
                  style={{ flex: 1, padding: "12px", borderRadius: "10px", fontSize: "14px", fontWeight: 600, border: `1.5px solid ${provider === p ? "var(--green)" : "var(--border)"}`, background: provider === p ? "var(--green-dim)" : "transparent", color: provider === p ? "var(--green)" : "var(--text-muted)" }}>{p}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--green)", marginBottom: "10px", textTransform: "uppercase" }}>Monthly Bill (USD)</label>
            <input type="number" value={monthlyBill} onChange={e => setMonthlyBill(e.target.value)} placeholder="8500"
              style={{ width: "100%", padding: "14px 18px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "12px", color: "#fff" }} />
          </div>
          <button className="glow-btn" disabled={!provider || !monthlyBill} onClick={() => goTo("audit")}
            style={{ background: provider && monthlyBill ? "var(--green)" : "rgba(255,255,255,0.06)", color: "#000", border: "none", borderRadius: "12px", padding: "16px", fontSize: "16px", marginTop: "12px" }}>Begin Audit →</button>
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
        <Nav showBack onBack={() => goTo("intake")} />
        <div style={{ height: "2px", background: "var(--border)", position: "sticky", top: "58px", zIndex: 99 }}>
          <div style={{ height: "100%", width: `${progress}%`, background: "var(--green)", transition: "width 0.5s ease" }} />
        </div>

        <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "32px 24px 120px", position: "relative", zIndex: 1 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "32px", alignItems: "start" }}>
            
            {/* Main Column */}
            <div key={activeSection} className="fade-up">
              <div style={{ marginBottom: "32px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                  <span style={{ fontSize: "32px" }}>{section.icon}</span>
                  <h2 className="display" style={{ fontSize: "28px", fontWeight: 800, color: "#fff" }}>{section.label}</h2>
                </div>
                <p style={{ color: "var(--text-muted)" }}>{section.description}</p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {section.checks.map(check => {
                  const on = !!checked[check.id];
                  return (
                    <div key={check.id} className="check-card glass" onClick={() => toggle(check.id)}
                      style={{ borderRadius: "16px", padding: "20px", display: "flex", gap: "18px", border: on ? "1px solid var(--green-border)" : "1px solid var(--border)", background: on ? "var(--green-dim)" : "rgba(13, 13, 26, 0.4)" }}>
                      <div style={{ width: "22px", height: "22px", borderRadius: "6px", flexShrink: 0, border: `2px solid ${on ? "var(--green)" : "rgba(255,255,255,0.2)"}`, background: on ? "var(--green)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {on && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="4"><path d="M20 6L9 17L4 12"/></svg>}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", gap: "10px", marginBottom: "4px", alignItems: "center" }}>
                          <span style={{ fontWeight: 600, color: on ? "#fff" : "var(--text-dim)" }}>{check.label}</span>
                          <span style={{ fontSize: "10px", fontWeight: 700, color: IMPACT_COLOR[check.impact], background: `${IMPACT_COLOR[check.impact]}20`, padding: "2px 6px", borderRadius: "4px" }}>{check.impact}</span>
                        </div>
                        <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: on ? "12px" : "0" }}>{check.detail}</p>
                        {on && (
                          <div className="fade-up" style={{ padding: "12px", background: "rgba(0,0,0,0.2)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
                            <p style={{ fontSize: "11px", color: "var(--green)", fontWeight: 700, textTransform: "uppercase", marginBottom: "4px" }}>Quick Fix Action:</p>
                            <p style={{ fontSize: "13px", color: "var(--text-dim)" }}>{check.fix}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: "12px", marginTop: "32px" }}>
                {activeSection > 0 && <button className="ghost-btn" onClick={() => setActiveSection(a => a-1)} style={{ padding: "12px 24px", borderRadius: "10px", border: "1px solid var(--border)" }}>← Previous</button>}
                <button className="glow-btn" onClick={() => activeSection < AUDIT_SECTIONS.length - 1 ? setActiveSection(a => a+1) : goTo("report")}
                  style={{ flex: 1, background: "var(--green)", color: "#000", border: "none", borderRadius: "10px", padding: "12px" }}>
                  {activeSection < AUDIT_SECTIONS.length - 1 ? `Next: ${AUDIT_SECTIONS[activeSection+1].label}` : "Generate Report →"}
                </button>
              </div>
            </div>

            {/* Sidebar with Maturity Strategy */}
            <div style={{ position: "sticky", top: "80px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="glass" style={{ borderRadius: "20px", padding: "24px" }}>
                <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "16px", letterSpacing: "1px" }}>Estimation Strategy</p>
                <div style={{ display: "flex", background: "rgba(0,0,0,0.3)", padding: "4px", borderRadius: "10px", marginBottom: "24px" }}>
                  {["Low Risk", "Standard", "Aggressive"].map((l, i) => (
                    <button key={l} onClick={() => setStrategy(i)} 
                      style={{ flex: 1, padding: "8px 4px", fontSize: "10px", borderRadius: "7px", border: "none", cursor: "pointer", background: strategy === i ? "var(--green)" : "transparent", color: strategy === i ? "#000" : "var(--text-muted)", fontWeight: 700, transition: "0.2s" }}>{l}</button>
                  ))}
                </div>
                
                <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "8px" }}>Estimated Monthly Savings</p>
                <div className="display" style={{ fontSize: "32px", fontWeight: 800, color: "var(--green)" }}>
                  <AnimatedNumber value={savMin} prefix="$" />–<AnimatedNumber value={savMax} prefix="$" />
                </div>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>~{savPct}% of total bill</p>
                
                <div style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "8px" }}>
                    <span style={{ color: "var(--text-muted)" }}>Issues Flagged:</span>
                    <span style={{ color: "#fff", fontWeight: 700 }}>{flagged.length}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                    <span style={{ color: "var(--text-muted)" }}>Audit Progress:</span>
                    <span style={{ color: "var(--green)", fontWeight: 700 }}>{progress}%</span>
                  </div>
                </div>
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
        <Nav showBack onBack={() => goTo("audit")} />
        <div key={pageKey} style={{ maxWidth: "900px", margin: "0 auto", padding: "48px 24px 80px", position: "relative", zIndex: 1 }}>
          <div className="fade-up" style={{ marginBottom: "40px" }}>
            <h1 className="display" style={{ fontSize: "42px", fontWeight: 800, color: "#fff", marginBottom: "8px" }}>Optimization Report</h1>
            <p style={{ color: "var(--text-muted)" }}>Prepared for {companyName || "Your Team"} • {provider} Infrastructure</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "40px" }}>
            <div className="glass" style={{ padding: "24px", borderRadius: "16px" }}>
              <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "8px" }}>Monthly Potential</p>
              <p className="display" style={{ fontSize: "24px", fontWeight: 800, color: "var(--green)" }}>${savMin.toLocaleString()}+</p>
            </div>
            <div className="glass" style={{ padding: "24px", borderRadius: "16px" }}>
              <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "8px" }}>Annual Opportunity</p>
              <p className="display" style={{ fontSize: "24px", fontWeight: 800, color: "#818cf8" }}>${(savMin*12).toLocaleString()}+</p>
            </div>
            <div className="glass" style={{ padding: "24px", borderRadius: "16px" }}>
              <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "8px" }}>Waste Rate</p>
              <p className="display" style={{ fontSize: "24px", fontWeight: 800, color: "#fb923c" }}>{savPct}%</p>
            </div>
          </div>

          {[
            { label: "🔴 High Priority Findings", items: high, color: "#f87171" },
            { label: "🟡 Medium Impact", items: med, color: "#fbbf24" },
            { label: "🟢 Quick Wins", items: low, color: "#4ade80" },
          ].filter(g=>g.items.length>0).map(group=>(
            <div key={group.label} style={{ marginBottom: "32px" }}>
              <h3 className="display" style={{ fontSize: "16px", fontWeight: 700, color: group.color, marginBottom: "16px" }}>{group.label}</h3>
              {group.items.map(check=>(
                <div key={check.id} className="glass" style={{ padding: "20px", borderRadius: "12px", borderLeft: `4px solid ${group.color}`, marginBottom: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <p style={{ fontWeight: 600, color: "#fff", marginBottom: "4px" }}>{check.label}</p>
                    <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>{check.detail}</p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontSize: "14px", fontWeight: 700, color: "var(--green)" }}>+${Math.round(bill * check.savingsRange[0] / 100 * strategyMulti).toLocaleString()}/mo</p>
                  </div>
                </div>
              ))}
            </div>
          ))}

          <div style={{ marginTop: "60px", padding: "40px", borderRadius: "24px", background: "linear-gradient(135deg, rgba(0,255,180,0.1) 0%, rgba(99,102,241,0.1) 100%)", border: "1px solid var(--green-border)", textAlign: "center" }}>
            <h3 className="display" style={{ fontSize: "24px", fontWeight: 800, color: "#fff", marginBottom: "12px" }}>Ready to execute these savings?</h3>
            <p style={{ color: "var(--text-muted)", marginBottom: "32px" }}>Book a senior DevOps implementation session to apply these changes safely.</p>
            <button className="glow-btn" style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "16px 40px", fontSize: "16px" }}>Book Implementation Session →</button>
          </div>
        </div>
      </div>
    );
  }
}