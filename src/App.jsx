import { useState, useEffect, useRef } from "react";

// Added technical 'fix' details to the sections
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
  checked: { rightsizing: true, reserved: true, spot: true, s3_tier: true, rds_idle: true, no_budgets: true },
};

const IMPACT_COLOR = { Critical: "#f87171", High: "#fb923c", Medium: "#fbbf24", Low: "#4ade80" };
const EFFORT_COLOR = { Low: "#4ade80", Medium: "#fbbf24", High: "#f87171" };
const PROVIDERS = ["AWS", "GCP", "Azure", "Multi-cloud"];

// --- UTILITIES ---
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
    </div>
  );
}

const globalCss = `
  @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #080810; color: #e2e8f0; }
  :root {
    --bg: #080810;
    --border: rgba(255,255,255,0.08);
    --green: #00ffb4;
    --green-dim: rgba(0,255,180,0.12);
    --green-border: rgba(0,255,180,0.25);
    --text-dim: #94a3b8;
    --display: 'Bricolage Grotesque', sans-serif;
    --body: 'DM Sans', sans-serif;
  }
  .app { font-family: var(--body); background: var(--bg); min-height: 100vh; }
  .display { font-family: var(--display); }
  .glass { background: rgba(13, 13, 26, 0.7); backdrop-filter: blur(12px); border: 1px solid var(--border); }
  .glow-btn { transition: all 0.2s; cursor: pointer; font-family: var(--display); font-weight: 700; border: none; }
  .glow-btn:hover { box-shadow: 0 0 30px rgba(0,255,180,0.35); transform: translateY(-2px); }
  .check-card { transition: all 0.2s ease; cursor: pointer; }
  .check-card:hover { transform: translateX(4px); }
  input:focus { outline: none; border-color: var(--green) !important; box-shadow: 0 0 0 3px rgba(0,255,180,0.1) !important; }
  .modal-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(0,0,0,0.85); backdrop-filter: blur(10px); display: flex; align-items: center; justifyContent: center; padding: 20px; }
`;

export default function App() {
  const [step, setStep] = useState("intro");
  const [provider, setProvider] = useState("");
  const [monthlyBill, setMonthlyBill] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [checked, setChecked] = useState({});
  const [activeSection, setActiveSection] = useState(0);
  const [showSample, setShowSample] = useState(false);
  const [strategy, setStrategy] = useState(1); // 0: Cons, 1: Std, 2: Aggr

  const toggle = (id) => setChecked(p => ({ ...p, [id]: !p[id] }));
  const goTo = (s) => { setStep(s); window.scrollTo(0,0); };

  const bill = parseFloat(monthlyBill) || 0;
  const strategyMulti = strategy === 0 ? 0.75 : strategy === 2 ? 1.25 : 1;
  const allChecks = AUDIT_SECTIONS.flatMap(s => s.checks);
  const flagged = allChecks.filter(c => checked[c.id]);
  const savMin = Math.round(flagged.reduce((s, c) => s + bill * c.savingsRange[0] / 100, 0) * strategyMulti);
  const savMax = Math.round(flagged.reduce((s, c) => s + bill * c.savingsRange[1] / 100, 0) * strategyMulti);
  const savPct = bill > 0 ? Math.round(((savMin + savMax) / 2 / bill) * 100) : 0;
  const progress = Math.round((Object.keys(checked).length / allChecks.length) * 100);

  // --- NAV ---
  const Nav = ({ showBack, onBack }) => (
    <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(8,8,16,0.85)", backdropFilter: "blur(20px)", borderBottom: "1px solid var(--border)", padding: "0 24px", height: "58px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {showBack && <button onClick={onBack} style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text-dim)", padding: "6px 12px", cursor: "pointer" }}>← Back</button>}
        <div style={{ width: "32px", height: "32px", background: "var(--green)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 15px rgba(0,255,180,0.4)" }}>⚡</div>
        <span className="display" style={{ fontWeight: 800, fontSize: "18px", color: "#fff" }}>CloudAudit</span>
      </div>
      <span style={{ fontSize: "12px", color: "var(--text-dim)" }}>Professional Intelligence</span>
    </nav>
  );

  // --- VIEWS ---
  if (step === "intro") return (
    <div className="app">
      <style>{globalCss}</style>
      <ParticleBackground />
      {showSample && (
        <div className="modal-overlay" onClick={() => setShowSample(false)}>
          <div className="glass" style={{ maxWidth: "600px", padding: "40px", borderRadius: "20px" }} onClick={e=>e.stopPropagation()}>
            <h2 className="display" style={{ color: "#fff", fontSize: "28px" }}>Sample Report: TechFlow</h2>
            <p style={{ color: "var(--text-dim)", margin: "10px 0 30px" }}>Estimated savings based on $8,500 spend.</p>
            <div style={{ background: "var(--green-dim)", padding: "20px", borderRadius: "12px", border: "1px solid var(--green-border)", marginBottom: "30px" }}>
              <p style={{ fontSize: "12px", color: "var(--green)", fontWeight: 800 }}>ESTIMATED MONTHLY SAVINGS</p>
              <p className="display" style={{ fontSize: "32px", color: "#fff" }}>$2,100 – $3,800</p>
            </div>
            <button className="glow-btn" onClick={() => goTo("intake")} style={{ width: "100%", padding: "16px", background: "var(--green)", borderRadius: "12px", color: "#000" }}>Start Your Own Audit →</button>
          </div>
        </div>
      )}
      <Nav />
      <div style={{ position: "relative", zIndex: 1, maxWidth: "900px", margin: "120px auto 0", textAlign: "center" }}>
        <h1 className="display" style={{ fontSize: "72px", fontWeight: 800, color: "#fff", lineHeight: 1, marginBottom: "24px" }}>
          Stop the <span style={{ color: "var(--green)" }}>Cloud Leak.</span>
        </h1>
        <p style={{ fontSize: "20px", color: "var(--text-dim)", maxWidth: "600px", margin: "0 auto 40px" }}>A professional 15-minute diagnostic to find where your cloud bill is bleeding money.</p>
        <div style={{ display: "flex", gap: "16px", justifyContent: "center" }}>
          <button className="glow-btn" onClick={() => goTo("intake")} style={{ padding: "18px 40px", borderRadius: "14px", background: "var(--green)", color: "#000", fontSize: "18px" }}>Start Free Audit →</button>
          <button className="glass" onClick={() => setShowSample(true)} style={{ padding: "18px 30px", borderRadius: "14px", color: "#fff", cursor: "pointer" }}>View Sample Report</button>
        </div>
      </div>
    </div>
  );

  if (step === "intake") return (
    <div className="app">
      <style>{globalCss}</style>
      <Nav showBack onBack={() => goTo("intro")} />
      <div style={{ maxWidth: "500px", margin: "80px auto", padding: "0 24px" }}>
        <h2 className="display" style={{ fontSize: "36px", color: "#fff", marginBottom: "30px" }}>Audit Profile</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <input placeholder="Company Name" value={companyName} onChange={e=>setCompanyName(e.target.value)} className="glass" style={{ padding: "16px", borderRadius: "12px", color: "#fff" }} />
          <div style={{ display: "flex", gap: "10px" }}>
            {PROVIDERS.map(p => (
              <button key={p} onClick={() => setProvider(p)} style={{ flex: 1, padding: "12px", borderRadius: "10px", background: provider === p ? "var(--green-dim)" : "transparent", border: `1px solid ${provider === p ? "var(--green)" : "var(--border)"}`, color: provider === p ? "var(--green)" : "var(--text-dim)", cursor: "pointer" }}>{p}</button>
            ))}
          </div>
          <input placeholder="Monthly Bill (USD)" type="number" value={monthlyBill} onChange={e=>setMonthlyBill(e.target.value)} className="glass" style={{ padding: "16px", borderRadius: "12px", color: "#fff" }} />
          <button className="glow-btn" disabled={!provider || !monthlyBill} onClick={() => goTo("audit")} style={{ padding: "16px", background: "var(--green)", borderRadius: "12px", color: "#000", opacity: (!provider || !monthlyBill) ? 0.5 : 1 }}>Begin Diagnostic →</button>
        </div>
      </div>
    </div>
  );

  if (step === "audit") {
    const section = AUDIT_SECTIONS[activeSection];
    return (
      <div className="app">
        <style>{globalCss}</style>
        <Nav showBack onBack={() => goTo("intake")} />
        <div style={{ height: "3px", background: "var(--border)" }}>
          <div style={{ height: "100%", width: `${progress}%`, background: "var(--green)", transition: "width 0.4s" }} />
        </div>
        <div style={{ maxWidth: "1000px", margin: "40px auto", padding: "0 24px", display: "grid", gridTemplateColumns: "1fr 320px", gap: "40px" }}>
          <div>
            <h2 className="display" style={{ fontSize: "32px", color: "#fff", marginBottom: "30px" }}>{section.icon} {section.label}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {section.checks.map(c => (
                <div key={c.id} className="glass check-card" onClick={() => toggle(c.id)} style={{ padding: "20px", borderRadius: "16px", border: checked[c.id] ? "1px solid var(--green)" : "1px solid var(--border)", background: checked[c.id] ? "var(--green-dim)" : "" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                    <span style={{ fontWeight: 700, color: "#fff" }}>{c.label}</span>
                    <span style={{ fontSize: "11px", color: IMPACT_COLOR[c.impact] }}>{c.impact}</span>
                  </div>
                  <p style={{ fontSize: "14px", color: "var(--text-dim)" }}>{c.detail}</p>
                  {checked[c.id] && (
                    <div style={{ marginTop: "15px", padding: "12px", background: "rgba(0,0,0,0.3)", borderRadius: "8px" }}>
                      <p style={{ fontSize: "11px", color: "var(--green)", fontWeight: 800 }}>TECHNICAL FIX:</p>
                      <p style={{ fontSize: "13px", color: "#fff" }}>{c.fix}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div style={{ marginTop: "30px", display: "flex", gap: "10px" }}>
              {activeSection > 0 && <button className="glass" onClick={() => setActiveSection(a => a-1)} style={{ padding: "12px 24px", borderRadius: "10px", color: "#fff", cursor: "pointer" }}>Previous</button>}
              <button className="glow-btn" onClick={() => activeSection < AUDIT_SECTIONS.length - 1 ? setActiveSection(a => a+1) : goTo("report")} style={{ flex: 1, padding: "14px", background: "var(--green)", borderRadius: "12px", color: "#000" }}>{activeSection < AUDIT_SECTIONS.length - 1 ? "Next Section →" : "Generate Final Report →"}</button>
            </div>
          </div>
          {/* Strategy Sidebar */}
          <div className="glass" style={{ position: "sticky", top: "80px", padding: "24px", borderRadius: "20px", height: "fit-content" }}>
            <p style={{ fontSize: "11px", fontWeight: 800, color: "var(--text-dim)", marginBottom: "15px" }}>STRATEGY</p>
            <div style={{ display: "flex", background: "rgba(0,0,0,0.4)", padding: "4px", borderRadius: "10px", marginBottom: "25px" }}>
              {["Safe", "Std", "Aggr"].map((s, i) => (
                <button key={s} onClick={() => setStrategy(i)} style={{ flex: 1, padding: "8px", border: "none", borderRadius: "8px", background: strategy === i ? "var(--green)" : "transparent", color: strategy === i ? "#000" : "var(--text-dim)", fontWeight: 700, cursor: "pointer" }}>{s}</button>
              ))}
            </div>
            <p style={{ fontSize: "11px", color: "var(--text-dim)" }}>POTENTIAL SAVINGS</p>
            <div className="display" style={{ fontSize: "36px", color: "var(--green)", margin: "5px 0" }}>
              <AnimatedNumber value={savMin} prefix="$" />
            </div>
            <p style={{ fontSize: "12px", color: "var(--text-dim)" }}>~{savPct}% of bill</p>
          </div>
        </div>
      </div>
    );
  }

  if (step === "report") return (
    <div className="app">
      <style>{globalCss}</style>
      <Nav showBack onBack={() => goTo("audit")} />
      <div style={{ maxWidth: "800px", margin: "60px auto", padding: "0 24px" }}>
        <h1 className="display" style={{ fontSize: "48px", color: "#fff", marginBottom: "40px" }}>Savings Roadmap</h1>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "15px", marginBottom: "40px" }}>
          <div className="glass" style={{ padding: "24px", borderRadius: "16px" }}>
            <p style={{ fontSize: "11px", color: "var(--text-dim)" }}>MONTHLY SAVINGS</p>
            <p className="display" style={{ fontSize: "24px", color: "var(--green)" }}>${savMin.toLocaleString()}+</p>
          </div>
          <div className="glass" style={{ padding: "24px", borderRadius: "16px" }}>
            <p style={{ fontSize: "11px", color: "var(--text-dim)" }}>WASTE PERCENTAGE</p>
            <p className="display" style={{ fontSize: "24px", color: "#fb923c" }}>{savPct}%</p>
          </div>
          <div className="glass" style={{ padding: "24px", borderRadius: "16px" }}>
            <p style={{ fontSize: "11px", color: "var(--text-dim)" }}>REPORTS GENERATED</p>
            <p className="display" style={{ fontSize: "24px", color: "#818cf8" }}>{flagged.length}</p>
          </div>
        </div>

        {/* Email Lead Gen */}
        <div style={{ background: "linear-gradient(135deg, rgba(0,255,180,0.1) 0%, rgba(99,102,241,0.1) 100%)", padding: "40px", borderRadius: "24px", border: "1px solid var(--green-border)", textAlign: "center", marginBottom: "40px" }}>
          <h3 className="display" style={{ fontSize: "24px", color: "#fff", marginBottom: "10px" }}>Get the PDF Roadmap</h3>
          <p style={{ color: "var(--text-dim)", marginBottom: "25px" }}>We'll send the full technical breakdown for {companyName} to your inbox.</p>
          <div style={{ display: "flex", gap: "10px", maxWidth: "450px", margin: "0 auto" }}>
            <input placeholder="work@company.com" value={email} onChange={e=>setEmail(e.target.value)} className="glass" style={{ flex: 1, padding: "14px", borderRadius: "10px", color: "#fff" }} />
            <button className="glow-btn" style={{ padding: "14px 24px", background: "var(--green)", borderRadius: "10px", color: "#000" }}>Send Report</button>
          </div>
        </div>

        {/* Original Booking Block */}
        <div style={{ background: "linear-gradient(135deg, rgba(0,255,180,0.07) 0%, rgba(99,102,241,0.07) 100%)", border: "1px solid rgba(0,255,180,0.15)", borderRadius: "20px", padding: "40px", textAlign: "center" }}>
          <p style={{ fontSize: "12px", fontWeight: 700, color: "var(--green)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "12px" }}>Need hands-on help?</p>
          <h3 className="display" style={{ fontSize: "28px", fontWeight: 800, color: "#fff", marginBottom: "10px" }}>Book an implementation session</h3>
          <p style={{ color: "var(--text-dim)", fontSize: "15px", marginBottom: "28px" }}>Senior DevOps engineer · Full report + implementation in 48hrs</p>
          <button className="glow-btn" style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "14px 32px", fontSize: "15px" }}>Book for 999 PLN →</button>
        </div>
      </div>
    </div>
  );
}