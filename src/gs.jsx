import { useState, useEffect, useRef, useMemo } from "react";

// --- CONSTANTS & DATA ---
const STORAGE_KEY = "cloudaudit_progress";

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

const IMPACT_COLOR = { Critical: "#f87171", High: "#fb923c", Medium: "#fbbf24", Low: "#4ade80" };
const EFFORT_COLOR = { Low: "#4ade80", Medium: "#fbbf24", High: "#f87171" };
const PROVIDERS = ["AWS", "GCP", "Azure", "Multi-cloud"];

// --- UTILITY COMPONENTS ---

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
  }, [value, duration]);

  return <span>{prefix}{display.toLocaleString()}{suffix}</span>;
}

function ProgressRing({ percent, size = 44, stroke = 3, color = "#00ffb4" }) {
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (percent / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.4,0,0.2,1)" }}
        strokeLinecap="round" />
    </svg>
  );
}

const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;600;800&family=DM+Sans:wght@400;500;700&display=swap');
    
    :root {
      --bg: #080810;
      --bg2: #0d0d1a;
      --border: rgba(255,255,255,0.08);
      --green: #00ffb4;
      --green-dim: rgba(0,255,180,0.1);
      --text: #e2e8f0;
      --text-muted: #64748b;
      --display: 'Bricolage Grotesque', sans-serif;
      --body: 'DM Sans', sans-serif;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font-family: var(--body); -webkit-font-smoothing: antialiased; }
    
    .display { font-family: var(--display); }
    .fade-up { animation: fadeUp 0.6s cubic-bezier(0.22, 1, 0.36, 1) both; }
    @keyframes fadeUp { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
    
    .btn-primary { background: var(--green); color: #000; font-weight: 700; border: none; cursor: pointer; transition: all 0.2s; border-radius: 12px; }
    .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0,255,180,0.3); }
    .btn-primary:disabled { opacity: 0.3; cursor: not-allowed; transform: none; }

    .grid-audit {
      display: grid;
      grid-template-columns: 1fr 320px;
      gap: 32px;
    }

    @media (max-width: 900px) {
      .grid-audit { grid-template-columns: 1fr; }
      .sidebar { position: static !important; order: -1; }
    }

    @media print {
      .no-print { display: none !important; }
      body { background: white; color: black; }
      .app { background: white; }
    }
  `}</style>
);

// --- MAIN APP ---

export default function App() {
  // State Initialization with Persistence
  const [step, setStep] = useState(() => localStorage.getItem(`${STORAGE_KEY}_step`) || "intro");
  const [companyName, setCompanyName] = useState(() => localStorage.getItem(`${STORAGE_KEY}_company`) || "");
  const [provider, setProvider] = useState(() => localStorage.getItem(`${STORAGE_KEY}_provider`) || "");
  const [monthlyBill, setMonthlyBill] = useState(() => localStorage.getItem(`${STORAGE_KEY}_bill`) || "");
  const [checked, setChecked] = useState(() => JSON.parse(localStorage.getItem(`${STORAGE_KEY}_checked`)) || {});
  
  const [activeSection, setActiveSection] = useState(0);
  const [showSample, setShowSample] = useState(false);

  // Persistence Sync
  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_step`, step);
    localStorage.setItem(`${STORAGE_KEY}_company`, companyName);
    localStorage.setItem(`${STORAGE_KEY}_provider`, provider);
    localStorage.setItem(`${STORAGE_KEY}_bill`, monthlyBill);
    localStorage.setItem(`${STORAGE_KEY}_checked`, JSON.stringify(checked));
  }, [step, companyName, provider, monthlyBill, checked]);

  // Derived Values
  const billValue = parseFloat(monthlyBill) || 0;
  const allChecks = useMemo(() => AUDIT_SECTIONS.flatMap(s => s.checks), []);
  const flagged = allChecks.filter(c => checked[c.id]);
  
  const savings = useMemo(() => {
    const min = flagged.reduce((acc, c) => acc + (billValue * c.savingsRange[0]) / 100, 0);
    const max = flagged.reduce((acc, c) => acc + (billValue * c.savingsRange[1]) / 100, 0);
    return { min: Math.round(min), max: Math.round(max) };
  }, [flagged, billValue]);

  const progress = Math.round((Object.keys(checked).length / allChecks.length) * 100);

  // Actions
  const toggleCheck = (id) => setChecked(prev => {
    const next = { ...prev };
    if (next[id]) delete next[id];
    else next[id] = true;
    return next;
  });

  const resetAudit = () => {
    localStorage.clear();
    window.location.reload();
  };

  const navigate = (s) => {
    setStep(s);
    window.scrollTo(0, 0);
  };

  // --- SUB-VIEWS ---

  const Nav = () => (
    <nav className="no-print" style={{ height: "64px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", position: "sticky", top: 0, background: "rgba(8,8,16,0.8)", backdropFilter: "blur(12px)", zIndex: 100 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", cursor: "pointer" }} onClick={() => navigate("intro")}>
        <div style={{ width: "32px", height: "32px", background: "var(--green)", borderRadius: "8px", display: "grid", placeItems: "center", color: "#000", fontWeight: "bold" }}>⚡</div>
        <span className="display" style={{ fontWeight: 800, letterSpacing: "-0.5px" }}>CloudAudit</span>
      </div>
      {step !== "intro" && (
        <button onClick={resetAudit} style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: "12px", cursor: "pointer" }}>Reset Progress</button>
      )}
    </nav>
  );

  if (step === "intro") return (
    <div className="app">
      <GlobalStyles />
      <Nav />
      <main style={{ maxWidth: "1000px", margin: "0 auto", padding: "100px 24px", textAlign: "center" }}>
        <div className="fade-up" style={{ display: "inline-block", padding: "6px 12px", background: "var(--green-dim)", color: "var(--green)", borderRadius: "20px", fontSize: "12px", fontWeight: 700, marginBottom: "24px" }}>
          BETA V1.0 AVAILABLE
        </div>
        <h1 className="display" style={{ fontSize: "clamp(40px, 8vw, 72px)", fontWeight: 800, lineHeight: 1, marginBottom: "24px" }}>
          Stop guessing your <br />
          <span style={{ color: "var(--green)" }}>cloud waste.</span>
        </h1>
        <p style={{ color: "var(--text-muted)", fontSize: "18px", maxWidth: "600px", margin: "0 auto 40px", lineHeight: 1.6 }}>
          Run a private, 15-minute audit of your cloud infrastructure. Get a professional-grade savings report without sharing credentials.
        </p>
        <div style={{ display: "flex", gap: "16px", justifyContent: "center" }}>
          <button className="btn-primary" style={{ padding: "16px 40px", fontSize: "18px" }} onClick={() => navigate("intake")}>Start Free Audit</button>
        </div>
      </main>
    </div>
  );

  if (step === "intake") return (
    <div className="app">
      <GlobalStyles />
      <Nav />
      <main style={{ maxWidth: "500px", margin: "80px auto", padding: "0 24px" }}>
        <h2 className="display" style={{ fontSize: "32px", marginBottom: "32px" }}>Basic Info</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div>
            <label style={{ display: "block", fontSize: "14px", color: "var(--text-muted)", marginBottom: "8px" }}>Company Name</label>
            <input className="fade-up" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Acme Corp" 
              style={{ width: "100%", padding: "14px", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "8px", color: "#fff" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "14px", color: "var(--text-muted)", marginBottom: "8px" }}>Cloud Provider</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              {PROVIDERS.map(p => (
                <button key={p} onClick={() => setProvider(p)} 
                  style={{ padding: "12px", borderRadius: "8px", border: "1px solid", borderColor: provider === p ? "var(--green)" : "var(--border)", background: provider === p ? "var(--green-dim)" : "transparent", color: provider === p ? "var(--green)" : "var(--text-muted)", cursor: "pointer" }}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "14px", color: "var(--text-muted)", marginBottom: "8px" }}>Avg. Monthly Bill (USD)</label>
            <input type="number" value={monthlyBill} onChange={e => setMonthlyBill(e.target.value)} placeholder="5000" 
              style={{ width: "100%", padding: "14px", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "8px", color: "#fff" }} />
          </div>
          <button className="btn-primary" style={{ padding: "16px" }} disabled={!provider || !monthlyBill} onClick={() => navigate("audit")}>
            Begin Checklist →
          </button>
        </div>
      </main>
    </div>
  );

  if (step === "audit") {
    const section = AUDIT_SECTIONS[activeSection];
    return (
      <div className="app">
        <GlobalStyles />
        <Nav />
        <div style={{ height: "4px", background: "var(--border)" }}>
          <div style={{ height: "100%", width: `${progress}%`, background: "var(--green)", transition: "width 0.4s" }} />
        </div>
        <main style={{ maxWidth: "1100px", margin: "40px auto", padding: "0 24px" }} className="grid-audit">
          <section>
            <div style={{ marginBottom: "32px" }}>
              <span style={{ fontSize: "40px" }}>{section.icon}</span>
              <h2 className="display" style={{ fontSize: "28px" }}>{section.label}</h2>
              <p style={{ color: "var(--text-muted)" }}>{section.description}</p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {section.checks.map(c => (
                <div key={c.id} onClick={() => toggleCheck(c.id)}
                  style={{ padding: "20px", background: checked[c.id] ? "var(--green-dim)" : "var(--bg2)", border: "1px solid", borderColor: checked[c.id] ? "var(--green)" : "var(--border)", borderRadius: "12px", cursor: "pointer", transition: "all 0.2s" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <h4 style={{ fontWeight: 700 }}>{c.label}</h4>
                    <span style={{ color: IMPACT_COLOR[c.impact], fontSize: "11px", fontWeight: "bold", textTransform: "uppercase" }}>{c.impact}</span>
                  </div>
                  <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>{c.detail}</p>
                </div>
              ))}
            </div>

            <div style={{ marginTop: "32px", display: "flex", gap: "12px" }}>
              {activeSection > 0 && <button onClick={() => setActiveSection(s => s - 1)} style={{ padding: "12px 24px", borderRadius: "8px", border: "1px solid var(--border)", background: "transparent", color: "#fff", cursor: "pointer" }}>Back</button>}
              {activeSection < AUDIT_SECTIONS.length - 1 ? 
                <button className="btn-primary" style={{ padding: "12px 32px" }} onClick={() => setActiveSection(s => s + 1)}>Next Section</button> :
                <button className="btn-primary" style={{ padding: "12px 32px" }} onClick={() => navigate("report")}>View Final Report</button>
              }
            </div>
          </section>

          <aside className="sidebar" style={{ position: "sticky", top: "100px", height: "fit-content" }}>
            <div style={{ padding: "24px", background: "var(--bg2)", borderRadius: "16px", border: "1px solid var(--border)" }}>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase", fontWeight: "bold" }}>Estimated Savings</p>
              <div className="display" style={{ fontSize: "32px", color: "var(--green)", fontWeight: 800 }}>
                <AnimatedNumber value={savings.min} prefix="$" /> – <AnimatedNumber value={savings.max} prefix="$" />
              </div>
              <p style={{ fontSize: "14px", color: "var(--text-muted)", marginBottom: "20px" }}>per month</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", borderTop: "1px solid var(--border)", paddingTop: "16px" }}>
                {AUDIT_SECTIONS.map((s, i) => (
                  <div key={s.id} onClick={() => setActiveSection(i)} style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", cursor: "pointer", color: i === activeSection ? "var(--green)" : "var(--text-muted)" }}>
                    <span>{s.icon} {s.label}</span>
                    <span>{s.checks.filter(c => checked[c.id]).length} flagged</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </main>
      </div>
    );
  }

  if (step === "report") {
    return (
      <div className="app">
        <GlobalStyles />
        <Nav />
        <main style={{ maxWidth: "800px", margin: "60px auto", padding: "0 24px" }}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "40px" }}>
            <div>
              <h1 className="display" style={{ fontSize: "40px", marginBottom: "8px" }}>Audit Results</h1>
              <p style={{ color: "var(--text-muted)" }}>{companyName} • {provider} • {new Date().toLocaleDateString()}</p>
            </div>
            <button className="btn-primary no-print" style={{ padding: "10px 20px" }} onClick={() => window.print()}>Download PDF</button>
          </header>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "40px" }}>
            <div style={{ padding: "24px", background: "var(--green-dim)", border: "1px solid var(--green)", borderRadius: "16px" }}>
              <p style={{ fontSize: "12px", fontWeight: "bold", marginBottom: "8px" }}>TOTAL MONTHLY POTENTIAL</p>
              <h2 className="display" style={{ fontSize: "32px", color: "var(--green)" }}>${savings.min} - ${savings.max}</h2>
            </div>
            <div style={{ padding: "24px", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: "16px" }}>
              <p style={{ fontSize: "12px", fontWeight: "bold", marginBottom: "8px" }}>ESTIMATED ANNUAL ROI</p>
              <h2 className="display" style={{ fontSize: "32px", color: "#818cf8" }}>${savings.min * 12} - ${savings.max * 12}</h2>
            </div>
          </div>

          <h3 className="display" style={{ marginBottom: "20px" }}>Flagged Issues</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {flagged.map(c => (
              <div key={c.id} style={{ padding: "20px", border: "1px solid var(--border)", borderRadius: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <p style={{ fontWeight: "bold" }}>{c.label}</p>
                  <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>{c.detail}</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ color: "var(--green)", fontWeight: "bold" }}>~{Math.round((billValue * c.savingsRange[0]) / 100)}$+</p>
                  <p style={{ fontSize: "10px", color: "var(--text-muted)" }}>Effort: {c.effort}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="no-print" style={{ marginTop: "60px", padding: "40px", textAlign: "center", background: "var(--bg2)", borderRadius: "24px", border: "1px solid var(--green)" }}>
            <h3 className="display" style={{ fontSize: "24px", marginBottom: "12px" }}>Need help implementing these?</h3>
            <p style={{ color: "var(--text-muted)", marginBottom: "24px" }}>Book a 48-hour hands-on implementation session with a senior DevOps engineer.</p>
            <button className="btn-primary" style={{ padding: "14px 32px" }}>Book Implementation for 999 PLN</button>
          </div>
        </main>
      </div>
    );
  }

  return null;
}