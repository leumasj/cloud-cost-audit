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
  /* Fonts loaded via <link rel=preload> in index.html for better LCP/FCP */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #080810; color: #e2e8f0; }
  :root {
    --bg: #080810; --bg2: #0d0d1a; --bg3: #12121f;
    --border: rgba(255,255,255,0.08); --border-hover: rgba(0,255,180,0.3);
    --green: #00ffb4; --green-dim: rgba(0,255,180,0.12); --green-border: rgba(0,255,180,0.25);
    --text: #e2e8f0; --text-muted: #64748b; --text-dim: #94a3b8;
    --display: 'Bricolage Grotesque', sans-serif; --body: 'DM Sans', sans-serif;
  }
  .app { font-family: var(--body); background: var(--bg); min-height: 100vh; color: var(--text); }
  .display { font-family: var(--display); }
  .fade-up { animation: fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) both; }
  @keyframes fadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
  .stagger-1 { animation-delay: 0.05s; } .stagger-2 { animation-delay: 0.12s; }
  .stagger-3 { animation-delay: 0.2s; } .stagger-4 { animation-delay: 0.28s; }
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
  input, select, textarea { font-family: var(--body); }
  input:focus, textarea:focus { outline: none; border-color: var(--green) !important; box-shadow: 0 0 0 3px rgba(0,255,180,0.1) !important; }
  .provider-chip { transition: all 0.15s; cursor: pointer; font-family: var(--body); }
  .provider-chip:hover { border-color: var(--green) !important; color: var(--green) !important; }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
  @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
  @keyframes scaleIn { from { opacity:0; transform:scale(0.92) translateY(10px); } to { opacity:1; transform:scale(1) translateY(0); } }
  @keyframes spin { to { transform: rotate(360deg); } }
  .trust-link { display:flex; align-items:center; gap:10px; text-decoration:none; padding:10px 14px; background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:10px; transition:all 0.2s; }
  .trust-link:hover { background:rgba(255,255,255,0.06) !important; transform:translateX(3px); }

  /* ── MOBILE RESPONSIVE ────────────────────────────────────────────── */
  @media (max-width: 768px) {
    /* Audit: collapse sidebar below checklist */
    .audit-grid { grid-template-columns: 1fr !important; }
    .audit-sidebar { position: static !important; top: auto !important; }

    /* Stats bar: 2x2 on mobile */
    .stats-grid { grid-template-columns: 1fr 1fr !important; gap: 1px !important; }

    /* Bento grid: single column */
    .bento-grid { grid-template-columns: 1fr !important; }
    .bento-grid-3 { grid-template-columns: 1fr !important; }

    /* Free vs Paid: stack vertically */
    .compare-grid { grid-template-columns: 1fr !important; }

    /* Consultant card: stack */
    .consultant-grid { grid-template-columns: 1fr !important; }

    /* Report KPI: 2 cols */
    .kpi-grid { grid-template-columns: 1fr 1fr !important; }

    /* How it works: single col */
    .how-grid { grid-template-columns: 1fr !important; }

    /* Audit categories: single col */
    .audit-cats-grid { grid-template-columns: 1fr !important; }

    /* Testimonials: single col */
    .testimonials-grid { grid-template-columns: 1fr !important; }

    /* Blog grid: single col */
    .blog-grid { grid-template-columns: 1fr !important; }

    /* Hero padding */
    .hero-pad { padding-top: 60px !important; padding-bottom: 48px !important; }

    /* Calculator: stack cards */
    .calc-cards { grid-template-columns: 1fr !important; }

    /* Bottom CTA padding */
    .bottom-cta-pad { padding: 40px 24px !important; }

    /* Section padding */
    .section-pad { padding: 32px 20px !important; }

    /* Free vs paid: hide the ✗ items on free card to save space */
    .hide-mobile { display: none !important; }

    /* Hero headline tighter on mobile */
    .hero-h1 { letter-spacing: -1.5px !important; }
  }

  @media (max-width: 480px) {
    /* Very small phones */
    .stats-grid { grid-template-columns: 1fr 1fr !important; }
    .kpi-grid { grid-template-columns: 1fr 1fr !important; }
  }

  /* ── Fix browser autofill overriding dark input backgrounds ── */
  input:-webkit-autofill,
  input:-webkit-autofill:hover,
  input:-webkit-autofill:focus,
  input:-webkit-autofill:active {
    -webkit-box-shadow: 0 0 0 1000px #0d0d1a inset !important;
    -webkit-text-fill-color: #ffffff !important;
    caret-color: #ffffff !important;
    transition: background-color 5000s ease-in-out 0s;
  }

  input, textarea {
    color: #ffffff !important;
    -webkit-text-fill-color: #ffffff;
  }
`;

// ── SHARE CARD MODAL ──────────────────────────────────────────────────────────
function ShareCardModal({ savMin, savMax, savPct, flaggedCount, totalChecks, provider, wasteScore, onClose }) {
  const canvasRef = useRef(null);
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = 1200, H = 630;
    canvas.width = W;
    canvas.height = H;

    // Helper — must be defined before use
    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    // Background
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#07070f");
    bg.addColorStop(1, "#0d0d1e");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Glow circle
    const glow = ctx.createRadialGradient(W * 0.3, H * 0.4, 0, W * 0.3, H * 0.4, 380);
    glow.addColorStop(0, "rgba(0,255,180,0.10)");
    glow.addColorStop(1, "rgba(0,255,180,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Border
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    // Inner accent line top
    ctx.strokeStyle = "rgba(0,255,180,0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(60, 58); ctx.lineTo(W - 60, 58); ctx.stroke();

    // Logo badge
    ctx.fillStyle = "#00ffb4";
    roundRect(ctx, 60, 72, 42, 42, 10);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.font = "bold 22px Arial";
    ctx.textAlign = "center";
    ctx.fillText("⚡", 81, 100);

    // KloudAudit wordmark
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px Arial";
    ctx.textAlign = "left";
    ctx.fillText("KloudAudit", 116, 100);

    // Provider badge
    const provColor = provider === "AWS" ? "#ff9900" : provider === "GCP" ? "#4285f4" : "#0078d4";
    ctx.fillStyle = provColor + "22";
    roundRect(ctx, W - 180, 72, 120, 34, 8);
    ctx.fill();
    ctx.strokeStyle = provColor + "66";
    ctx.lineWidth = 1;
    ctx.strokeRect(W - 180, 72, 120, 34);
    ctx.fillStyle = provColor;
    ctx.font = "bold 14px Arial";
    ctx.textAlign = "center";
    ctx.fillText(provider + " AUDIT", W - 120, 95);

    // Main headline
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 52px Arial";
    ctx.textAlign = "left";
    ctx.fillText("My cloud waste report", 60, 210);

    // Savings range — big green number
    ctx.fillStyle = "#00ffb4";
    ctx.font = "bold 96px Arial";
    ctx.fillText(`$${savMin.toLocaleString()}–$${savMax.toLocaleString()}`, 60, 330);

    // Waste score badge
    const wsColor = (wasteScore||50) >= 80 ? "#4ade80" : (wasteScore||50) >= 60 ? "#fbbf24" : (wasteScore||50) >= 40 ? "#fb923c" : "#f87171";
    ctx.fillStyle = wsColor + "22";
    roundRect(ctx, W - 200, 290, 150, 60, 10);
    ctx.fill();
    ctx.strokeStyle = wsColor + "66";
    ctx.lineWidth = 1;
    ctx.strokeRect(W - 200, 290, 150, 60);
    ctx.fillStyle = wsColor;
    ctx.font = "bold 28px Arial";
    ctx.textAlign = "center";
    ctx.fillText(`${wasteScore||0}/100`, W - 125, 328);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "12px Arial";
    ctx.fillText("Waste Score", W - 125, 345);

    // /month label
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = "28px Arial";
    ctx.fillText("estimated monthly savings", 60, 375);

    // Divider
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(60, 420); ctx.lineTo(W - 60, 420); ctx.stroke();

    // Stat pills
    const stats = [
      { label: "Waste Rate", value: `${savPct}%`, color: savPct >= 30 ? "#f87171" : savPct >= 15 ? "#fb923c" : "#fbbf24" },
      { label: "Issues Found", value: `${flaggedCount}`, color: "#fb923c" },
      { label: "Checks Done", value: `${totalChecks}`, color: "#a5b4fc" },
      { label: "Annual Opportunity", value: `$${(savMin * 12).toLocaleString()}+`, color: "#00ffb4" },
    ];
    const pillW = 240, pillH = 90, pillGap = 30;
    const totalW = stats.length * pillW + (stats.length - 1) * pillGap;
    const startX = (W - totalW) / 2;

    stats.forEach((s, i) => {
      const x = startX + i * (pillW + pillGap);
      const y = 445;
      ctx.fillStyle = s.color + "12";
      roundRect(ctx, x, y, pillW, pillH, 12);
      ctx.fill();
      ctx.strokeStyle = s.color + "30";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, pillW, pillH);
      ctx.fillStyle = s.color;
      ctx.font = "bold 28px Arial";
      ctx.textAlign = "center";
      ctx.fillText(s.value, x + pillW / 2, y + 38);
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.font = "13px Arial";
      ctx.fillText(s.label, x + pillW / 2, y + 62);
    });

    // CTA footer
    ctx.fillStyle = "rgba(0,255,180,0.08)";
    ctx.fillRect(0, H - 68, W, 68);
    ctx.strokeStyle = "rgba(0,255,180,0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H - 68); ctx.lineTo(W, H - 68); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "16px Arial";
    ctx.textAlign = "center";
    ctx.fillText("Run your free audit in 15 minutes at kloudaudit.eu — no account access required", W / 2, H - 36);

  }, [savMin, savMax, savPct, flaggedCount, totalChecks, provider]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    const link = document.createElement("a");
    link.download = "kloudaudit-results.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
    setDownloaded(true);
  };

  const handleCopyLink = () => {
    const text = `Just ran a free cloud cost audit on KloudAudit and found $${savMin.toLocaleString()}–$${savMax.toLocaleString()}/month in potential savings on ${provider}. Takes 15 minutes, no account access needed. kloudaudit.eu`;
    navigator.clipboard.writeText(text).then(() => alert("Caption copied! Paste it with your image on LinkedIn or Twitter."));
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", animation: "fadeIn 0.2s ease" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "linear-gradient(145deg, #0f0f1a, #13131f)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "20px", padding: "32px", maxWidth: "700px", width: "100%", position: "relative" }}>
        {/* Close */}
        <button onClick={onClose} style={{ position: "absolute", top: "16px", right: "16px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "rgba(255,255,255,0.5)", width: "30px", height: "30px", cursor: "pointer", fontSize: "16px", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>

        <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "8px" }}>Your shareable results card</p>
        <h2 style={{ fontSize: "22px", fontWeight: 800, color: "#fff", marginBottom: "4px", letterSpacing: "-0.5px" }}>Share your audit results</h2>
        <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "20px" }}>Download as PNG and share on LinkedIn or Twitter. Every share helps others find savings too.</p>

        {/* Canvas preview */}
        <div style={{ borderRadius: "12px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", marginBottom: "20px" }}>
          <canvas ref={canvasRef} style={{ width: "100%", display: "block" }} />
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button onClick={handleDownload} style={{ flex: 1, minWidth: "160px", padding: "13px 20px", borderRadius: "10px", border: "none", background: downloaded ? "rgba(0,255,180,0.15)" : "var(--green)", color: downloaded ? "var(--green)" : "#000", fontWeight: 700, fontSize: "14px", cursor: "pointer", transition: "all 0.2s" }}>
            {downloaded ? "✓ Downloaded!" : "⬇ Download PNG"}
          </button>
          <button onClick={handleCopyLink} style={{ flex: 1, minWidth: "160px", padding: "13px 20px", borderRadius: "10px", border: "1px solid rgba(99,102,241,0.4)", background: "rgba(99,102,241,0.1)", color: "#a5b4fc", fontWeight: 700, fontSize: "14px", cursor: "pointer", transition: "all 0.2s" }}>
            📋 Copy Caption
          </button>
          <a href={`https://www.linkedin.com/sharing/share-offsite/?url=https://kloudaudit.eu`} target="_blank" rel="noopener noreferrer" style={{ flex: 1, minWidth: "160px", padding: "13px 20px", borderRadius: "10px", border: "1px solid rgba(10,102,194,0.4)", background: "rgba(10,102,194,0.1)", color: "#60a5fa", fontWeight: 700, fontSize: "14px", cursor: "pointer", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
            🔗 Share on LinkedIn
          </a>
        </div>
        <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "14px", textAlign: "center" }}>Tip: Download the image first, then attach it to your LinkedIn post for best visibility.</p>
      </div>
    </div>
  );
}

// ── LIVE FEED TICKER COMPONENT ────────────────────────────────────────────────
function LiveFeedTicker() {
  const FEEDS = [
    { text: "Marek saved $2,400/mo", provider: "AWS",   time: "2h ago" },
    { text: "Tomasz saved $1,800/mo", provider: "GCP",  time: "5h ago" },
    { text: "Aleksandra saved $960/mo", provider: "Azure", time: "yesterday" },
    { text: "Piotr saved $3,100/mo",  provider: "AWS",  time: "3h ago" },
    { text: "Karolina saved $540/mo", provider: "GCP",  time: "today" },
    { text: "Dawid saved $1,250/mo",  provider: "Azure","time": "1h ago" },
  ];

  const PROVIDER_COLORS = { AWS: "#ff9900", GCP: "#4285f4", Azure: "#0078d4" };

  const [visibleIdx, setVisibleIdx] = useState([0, 1, 2]);
  const [fadingOut, setFadingOut] = useState([]);

  useEffect(() => {
    const interval = setInterval(() => {
      const outIdx = Math.floor(Math.random() * 3); // which pill to swap
      setFadingOut([outIdx]);
      setTimeout(() => {
        setVisibleIdx(prev => {
          const next = [...prev];
          let newItem;
          do { newItem = Math.floor(Math.random() * FEEDS.length); }
          while (prev.includes(newItem));
          next[outIdx] = newItem;
          return next;
        });
        setFadingOut([]);
      }, 400);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fade-up stagger-5" style={{ marginTop: "40px", display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); box-shadow: 0 0 0 0 rgba(74,222,128,0.6); }
          50% { opacity: 0.85; transform: scale(1.2); box-shadow: 0 0 0 5px rgba(74,222,128,0); }
        }
        @keyframes feed-in {
          from { opacity: 0; transform: translateY(6px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes feed-out {
          from { opacity: 1; transform: translateY(0) scale(1); }
          to   { opacity: 0; transform: translateY(-6px) scale(0.96); }
        }
        .feed-pill { animation: feed-in 0.4s cubic-bezier(0.4,0,0.2,1) forwards; }
        .feed-pill.fading { animation: feed-out 0.35s cubic-bezier(0.4,0,0.2,1) forwards; }
      `}</style>
      {visibleIdx.map((feedIdx, i) => {
        const item = FEEDS[feedIdx];
        const isFading = fadingOut.includes(i);
        const providerColor = PROVIDER_COLORS[item.provider] || "#4ade80";
        return (
          <div key={`${i}-${feedIdx}`}
            className={`feed-pill${isFading ? " fading" : ""}`}
            style={{
              display: "inline-flex", alignItems: "center", gap: "8px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "20px", padding: "6px 14px",
            }}>
            {/* Pulsing live dot */}
            <span style={{
              width: "6px", height: "6px", background: "#4ade80", borderRadius: "50%",
              display: "inline-block", flexShrink: 0,
              animation: "pulse-dot 2s ease-in-out infinite",
              animationDelay: `${i * 0.6}s`,
            }} />
            <span style={{ fontSize: "12px", color: "var(--text-dim)", whiteSpace: "nowrap" }}>{item.text}</span>
            <span style={{
              fontSize: "10px", fontWeight: 700, color: providerColor,
              background: `${providerColor}15`, border: `1px solid ${providerColor}30`,
              borderRadius: "4px", padding: "1px 6px",
            }}>{item.provider}</span>
            <span style={{ fontSize: "11px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{item.time}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── MODULE-LEVEL CONSTANTS — defined once, never recreated on render ─────────
const TESTIMONIALS = [
  { name: "Marek W.", role: "Lead DevOps · Warsaw fintech", text: "Found $2,400/mo in idle RDS instances on the first audit. The blueprint gave me the exact Terraform to fix it. Took 40 minutes.", savings: "$2,400/mo", provider: "AWS" },
  { name: "Tomasz K.", role: "CTO · SaaS startup, Kraków", text: "We were on full on-demand pricing for 18 months. One Reserved Instance switch later — $1,800/month saved. Blueprint paid for itself 6× over.", savings: "$1,800/mo", provider: "GCP" },
  { name: "Aleksandra R.", role: "Platform Eng · Berlin scale-up", text: "Spotted dev VMs running 24/7 at production size. Auto-shutdown config took 10 minutes to deploy. Immediately visible on the next invoice.", savings: "$960/mo", provider: "Azure" },
];

export default function App() {
  const [step, setStep] = useState("intro");
  const [provider, setProvider] = useState("");
  const [monthlyBill, setMonthlyBill] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [checked, setChecked] = useState({});
  const [activeSection, setActiveSection] = useState(0);
  const [showSample, setShowSample] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [showBooking, setShowBooking] = useState(false);
  const [showBlueprint, setShowBlueprint] = useState(false);
  // FIX #3: blueprintEmail lifted to app level — no re-renders causing flicker
  const [blueprintEmail, setBlueprintEmail] = useState("");
  const [blueprintStatus, setBlueprintStatus] = useState("idle");
  const [formStatus, setFormStatus] = useState("idle");
  const [bookingStatus, setBookingStatus] = useState("idle");
  const [pageKey, setPageKey] = useState(0);
  // ── INTRO-SCREEN STATE (must live at top level — Rules of Hooks) ──────────
  const [calcBill, setCalcBill] = useState(5000);
  const [openFaq, setOpenFaq] = useState(null);
  const [activeHowStep, setActiveHowStep] = useState(0);
  const [showExitIntent, setShowExitIntent] = useState(false);
  const [showShareCard, setShowShareCard] = useState(false);
  // ── SECURITY AUDIT STATE ──────────────────────────────────────────────────
  const [secChecked, setSecChecked] = useState({});
  const [secStep, setSecStep] = useState(0);
  const [secReport, setSecReport] = useState(null);
  const [secLoading, setSecLoading] = useState(false);
  const [secError, setSecError] = useState(null);
  const [gateEmail, setGateEmail] = useState("");
  const [aiPreview, setAiPreview] = useState(null);
  const [aiPreviewLoading, setAiPreviewLoading] = useState(false);
  const [gateSubmitted, setGateSubmitted] = useState(false);
  const [gateSending, setGateSending] = useState(false);
  // ── MULTI-CURRENCY ────────────────────────────────────────────────────────
  const [currency, setCurrency] = useState({
    code: "PLN", symbol: "zł", blueprintPrice: "299 PLN", blueprintAmount: 29900,
    sessionPrice: "999 PLN", sessionAmount: 99900, stripeCurrency: "pln"
  });

  const toggle = (id) => setChecked(p => ({ ...p, [id]: !p[id] }));
  const goTo = (s) => { setStep(s); setPageKey(k => k + 1); window.scrollTo(0, 0); };

  const bill = useMemo(() => parseFloat(monthlyBill) || 0, [monthlyBill]);
  const allChecks = useMemo(() => AUDIT_SECTIONS.flatMap(s => s.checks), []);
  const flagged = useMemo(() => allChecks.filter(c => checked[c.id]), [checked, allChecks]);
  const { savMin, savMax, savPct } = useMemo(() => {
    const min = Math.round(flagged.reduce((s, c) => s + bill * c.savingsRange[0] / 100, 0));
    const max = Math.round(flagged.reduce((s, c) => s + bill * c.savingsRange[1] / 100, 0));
    return {
      savMin: min,
      savMax: max,
      savPct: bill > 0 ? Math.round(((min + max) / 2 / bill) * 100) : 0,
    };
  }, [flagged, bill]);
  const progress = Math.round((Object.keys(checked).length / allChecks.length) * 100);

  const sampleFlagged = allChecks.filter(c => SAMPLE_REPORT.checked[c.id]);
  const sampleSavMin = Math.round(sampleFlagged.reduce((s, c) => s + SAMPLE_REPORT.monthlyBill * c.savingsRange[0] / 100, 0));
  const sampleSavMax = Math.round(sampleFlagged.reduce((s, c) => s + SAMPLE_REPORT.monthlyBill * c.savingsRange[1] / 100, 0));
  const samplePct = Math.round(((sampleSavMin + sampleSavMax) / 2 / SAMPLE_REPORT.monthlyBill) * 100);

  // FIX #2: Payment success detection on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") === "success") {
      setStep("payment_success");
      window.history.replaceState({}, "", "/");
    }
  }, []);

  // ── CURRENCY DETECTION ───────────────────────────────────────────
  useEffect(() => {
    const CURRENCY_MAP = {
      US: { code: "USD", symbol: "$",   blueprintPrice: "$79",    blueprintAmount: 7900,  sessionPrice: "$249",   sessionAmount: 24900, stripeCurrency: "usd" },
      GB: { code: "GBP", symbol: "\u00a3",   blueprintPrice: "\u00a362",    blueprintAmount: 6200,  sessionPrice: "\u00a3199",  sessionAmount: 19900, stripeCurrency: "gbp" },
      DE: { code: "EUR", symbol: "\u20ac",   blueprintPrice: "\u20ac73",    blueprintAmount: 7300,  sessionPrice: "\u20ac229",  sessionAmount: 22900, stripeCurrency: "eur" },
      FR: { code: "EUR", symbol: "\u20ac",   blueprintPrice: "\u20ac73",    blueprintAmount: 7300,  sessionPrice: "\u20ac229",  sessionAmount: 22900, stripeCurrency: "eur" },
      NL: { code: "EUR", symbol: "\u20ac",   blueprintPrice: "\u20ac73",    blueprintAmount: 7300,  sessionPrice: "\u20ac229",  sessionAmount: 22900, stripeCurrency: "eur" },
      AT: { code: "EUR", symbol: "\u20ac",   blueprintPrice: "\u20ac73",    blueprintAmount: 7300,  sessionPrice: "\u20ac229",  sessionAmount: 22900, stripeCurrency: "eur" },
      BE: { code: "EUR", symbol: "\u20ac",   blueprintPrice: "\u20ac73",    blueprintAmount: 7300,  sessionPrice: "\u20ac229",  sessionAmount: 22900, stripeCurrency: "eur" },
      ES: { code: "EUR", symbol: "\u20ac",   blueprintPrice: "\u20ac73",    blueprintAmount: 7300,  sessionPrice: "\u20ac229",  sessionAmount: 22900, stripeCurrency: "eur" },
      IT: { code: "EUR", symbol: "\u20ac",   blueprintPrice: "\u20ac73",    blueprintAmount: 7300,  sessionPrice: "\u20ac229",  sessionAmount: 22900, stripeCurrency: "eur" },
      CA: { code: "CAD", symbol: "CA$", blueprintPrice: "CA$107", blueprintAmount: 10700, sessionPrice: "CA$339", sessionAmount: 33900, stripeCurrency: "cad" },
      AU: { code: "AUD", symbol: "A$",  blueprintPrice: "A$119",  blueprintAmount: 11900, sessionPrice: "A$379",  sessionAmount: 37900, stripeCurrency: "aud" },
      PL: { code: "PLN", symbol: "z\u0142",  blueprintPrice: "299 PLN", blueprintAmount: 29900, sessionPrice: "999 PLN", sessionAmount: 99900, stripeCurrency: "pln" },
    };
    fetch("https://ipapi.co/json/")
      .then(r => r.json())
      .then(data => { const match = CURRENCY_MAP[data.country_code]; if (match) setCurrency(match); })
      .catch(() => {}); // silently keep PLN default on failure
  }, []);


  // ── AI PREVIEW GENERATOR ─────────────────────────────────────────────────
  useEffect(() => {
    if (step !== "report" || aiPreview || aiPreviewLoading) return;
    if (!flagged || flagged.length === 0) return;
    const firstIssue = flagged[0];
    setAiPreviewLoading(true);
    const prompt = `You are a senior DevOps engineer writing a concise fix for a cloud cost issue.

Provider: ${provider || "AWS"}
Issue: ${firstIssue.label}
Detail: ${firstIssue.detail}
Monthly bill: $${bill || 5000}

Write ONLY the fix for this ONE issue. Format exactly as:
## What's happening
1-2 sentences explaining the waste.

## Fix it now (${provider || "AWS"} CLI)
\`\`\`bash
# One practical command with a real comment
[command here]
\`\`\`

## Terraform (optional)
\`\`\`hcl
[snippet if applicable, else omit this section]
\`\`\`

## Verify savings
\`\`\`bash
[verification command]
\`\`\`

## Time to implement
[X minutes/hours]

Keep it concise, technical, and accurate. Real commands only.`;

    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      }),
    })
      .then(r => r.json())
      .then(data => {
        const text = data?.content?.[0]?.text || null;
        setAiPreview(text);
        setAiPreviewLoading(false);
      })
      .catch(() => setAiPreviewLoading(false));
  }, [step]);

  // ── EXIT INTENT DETECTOR ─────────────────────────────────────────────────
  useEffect(() => {
    if (sessionStorage.getItem('exitShown')) return; // only once per session
    const handleMouseLeave = (e) => {
      if (e.clientY <= 10) { // cursor leaving from top of viewport
        setShowExitIntent(true);
        sessionStorage.setItem('exitShown', '1');
        document.removeEventListener('mouseleave', handleMouseLeave);
      }
    };
    // Small delay so it doesn't fire immediately on page load
    const timer = setTimeout(() => {
      document.addEventListener('mouseleave', handleMouseLeave);
    }, 5000);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  // ── Formspree contact ──────────────────────────────────────────────────────
  const handleContactSubmit = async (e) => {
    e.preventDefault();
    setFormStatus("sending");
    const formData = new FormData(e.target);
    try {
      const res = await fetch("https://formspree.io/f/mlgarana", { method: "POST", body: formData, headers: { Accept: "application/json" } });
      if (res.ok) { setFormStatus("success"); e.target.reset(); setTimeout(() => { setShowContact(false); setFormStatus("idle"); }, 3000); }
      else setFormStatus("error");
    } catch { setFormStatus("error"); }
  };

  // ── Formspree booking ──────────────────────────────────────────────────────
  const handleBookingSubmit = async (e) => {
    e.preventDefault();
    setBookingStatus("sending");
    const formData = new FormData(e.target);
    try {
      const res = await fetch("https://formspree.io/f/mlgarana", { method: "POST", body: formData, headers: { Accept: "application/json" } });
      if (res.ok) { setBookingStatus("success"); e.target.reset(); setTimeout(() => { setShowBooking(false); setBookingStatus("idle"); }, 4000); }
      else setBookingStatus("error");
    } catch { setBookingStatus("error"); }
  };

  // FIX #2: Buy Blueprint → Vercel Function → Stripe Checkout
  const handleBuyBlueprint = async () => {
    if (!blueprintEmail) return;
    setBlueprintStatus("loading");
    try {
      const res = await fetch("/api/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: blueprintEmail,
          provider: provider || "AWS",
          monthlyBill: bill,
          companyName: companyName || "Your Company",
          savingsMin: savMin,
          savingsMax: savMax,
          flaggedIssues: flagged.map(c => ({ id: c.id, label: c.label })),
          currency: currency.stripeCurrency,
          currencyAmount: currency.blueprintAmount,
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || "Checkout failed");
      }
    } catch (err) {
      console.error(err);
      setBlueprintStatus("error");
      setTimeout(() => setBlueprintStatus("idle"), 4000);
    }
  };

  // ── NAV ────────────────────────────────────────────────────────────────────
  const Nav = ({ showBack, onBack }) => (
    <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(8,8,16,0.85)", backdropFilter: "blur(20px)", borderBottom: "1px solid var(--border)", padding: "0 24px", height: "58px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {showBack && <button className="ghost-btn" onClick={onBack} style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text-dim)", fontSize: "13px", padding: "6px 12px", marginRight: "4px" }}>← Back</button>}
        <div onClick={() => goTo("intro")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "30px", height: "30px", background: "var(--green)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 16px rgba(0,255,180,0.4)" }}>⚡</div>
          <span className="display" style={{ fontWeight: 800, fontSize: "16px", letterSpacing: "-0.5px", color: "#fff" }}>KloudAudit</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <a href="https://www.upwork.com/freelancers/~015c346a56b09a2a89" target="_blank" rel="noopener noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(20,163,74,0.12)", border: "1px solid rgba(20,163,74,0.3)", borderRadius: "8px", padding: "6px 12px", textDecoration: "none", fontSize: "12px", fontWeight: 700, color: "#14a34a", transition: "all 0.2s" }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(20,163,74,0.22)"; e.currentTarget.style.borderColor = "rgba(20,163,74,0.55)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(20,163,74,0.12)"; e.currentTarget.style.borderColor = "rgba(20,163,74,0.3)"; }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18.561 13.158c-1.102 0-2.135-.467-3.074-1.227l.228-1.076.008-.042c.207-1.143.849-3.06 2.839-3.06 1.492 0 2.703 1.212 2.703 2.703-.001 1.489-1.212 2.702-2.704 2.702zm0-8.14c-2.539 0-4.51 1.649-5.31 4.366-1.22-1.834-2.148-4.036-2.687-5.892H7.828v7.112c-.002 1.406-1.141 2.546-2.547 2.546-1.405 0-2.543-1.14-2.543-2.546V3.492H0v7.112c0 2.914 2.37 5.303 5.281 5.303 2.913 0 5.283-2.389 5.283-5.303v-1.19c.529 1.107 1.182 2.229 1.974 3.221l-1.673 7.873h2.797l1.213-5.71c1.063.679 2.285 1.109 3.686 1.109 3 0 5.439-2.452 5.439-5.45 0-3-2.439-5.439-5.439-5.439z"/></svg>
          Hire on Upwork
        </a>
        <button onClick={() => setShowContact(true)} className="ghost-btn" style={{ background: "transparent", border: "none", color: "var(--text-dim)", fontSize: "13px", fontWeight: 600 }}>Contact Us</button>
      </div>
    </nav>
  );

  // ── CONTACT MODAL ──────────────────────────────────────────────────────────
  const ContactModal = () => (
    <div onClick={() => { setShowContact(false); setFormStatus("idle"); }} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.88)", backdropFilter: "blur(14px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", animation: "fadeIn 0.2s ease" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--bg2)", border: "1px solid rgba(0,255,180,0.2)", borderRadius: "24px", maxWidth: "520px", width: "100%", boxShadow: "0 40px 80px rgba(0,0,0,0.8)", animation: "scaleIn 0.3s cubic-bezier(0.34,1.56,0.64,1)", overflow: "hidden" }}>
        {/* Header — same gradient banner as BookingModal */}
        <div style={{ background: "linear-gradient(135deg, rgba(0,255,180,0.1) 0%, rgba(99,102,241,0.1) 100%)", borderBottom: "1px solid rgba(0,255,180,0.12)", padding: "28px 32px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "7px", background: "rgba(0,255,180,0.12)", border: "1px solid rgba(0,255,180,0.25)", borderRadius: "20px", padding: "4px 12px", marginBottom: "10px" }}>
                <span style={{ width: "5px", height: "5px", background: "var(--green)", borderRadius: "50%", display: "inline-block", boxShadow: "0 0 6px var(--green)" }} />
                <span style={{ fontSize: "11px", color: "var(--green)", fontWeight: 700, letterSpacing: "1px" }}>GET IN TOUCH · WE REPLY WITHIN 24HRS</span>
              </div>
              <h2 className="display" style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-0.8px", color: "#fff", marginBottom: "5px" }}>Contact us</h2>
              <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>Questions, partnerships or custom audits — we're here</p>
            </div>
            <button onClick={() => { setShowContact(false); setFormStatus("idle"); }} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text-muted)", fontSize: "20px", width: "36px", height: "36px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "14px" }}>
            {["✓ Cloud cost questions", "✓ Custom audit requests", "✓ Partnership enquiries", "✓ Technical support"].map(item => (
              <span key={item} style={{ fontSize: "11px", color: "var(--text-dim)", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", borderRadius: "6px", padding: "3px 9px" }}>{item}</span>
            ))}
          </div>
        </div>
        {/* Body */}
        <div style={{ padding: "26px 32px 32px" }}>
          {formStatus === "success" ? (
            <div style={{ textAlign: "center", padding: "28px 0" }}>
              <div style={{ fontSize: "48px", marginBottom: "14px" }}>✅</div>
              <p className="display" style={{ color: "var(--green)", fontWeight: 800, fontSize: "22px", letterSpacing: "-0.5px", marginBottom: "8px" }}>Message Sent!</p>
              <p style={{ color: "var(--text-dim)", fontSize: "14px", lineHeight: 1.6 }}>We'll get back to you within 24hrs.<br />Check your inbox and spam folder.</p>
            </div>
          ) : (
            <form onSubmit={handleContactSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <input type="hidden" name="_subject" value="New Contact Enquiry — KloudAudit" />
              <input type="hidden" name="form_type" value="contact" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "1px" }}>First Name</label>
                  <input required type="text" name="first_name" placeholder="Jan" style={{ width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "14px", fontFamily: "var(--body)" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "1px" }}>Last Name</label>
                  <input required type="text" name="last_name" placeholder="Kowalski" style={{ width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "14px", fontFamily: "var(--body)" }} />
                </div>
              </div>
              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "1px" }}>Work Email</label>
                <input required type="email" name="email" placeholder="jan@company.com" style={{ width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "14px", fontFamily: "var(--body)" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "1px" }}>Company</label>
                <input type="text" name="company" placeholder="Acme Corp" style={{ width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "14px", fontFamily: "var(--body)" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "1px" }}>How can we help? <span style={{ color: "var(--text-muted)", fontWeight: 400, textTransform: "none" }}>(optional)</span></label>
                <textarea required name="message" rows="3" placeholder="e.g. I have questions about the blueprint, or I'd like a custom audit..." style={{ width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "14px", resize: "none", fontFamily: "var(--body)" }} />
              </div>
              <button type="submit" className="glow-btn" disabled={formStatus === "sending"}
                style={{ background: formStatus === "sending" ? "rgba(0,255,180,0.5)" : "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "15px", fontSize: "15px", width: "100%", cursor: formStatus === "sending" ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginTop: "4px" }}>
                {formStatus === "sending" ? <><span style={{ display: "inline-block", width: "15px", height: "15px", border: "2px solid #000", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} /> Sending...</> : "Send Message →"}
              </button>
              {formStatus === "error" && <p style={{ color: "#f87171", fontSize: "13px", textAlign: "center", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "8px", padding: "10px" }}>⚠ Something went wrong. Please try again.</p>}
              <p style={{ fontSize: "11px", color: "var(--text-muted)", textAlign: "center" }}>Or email us directly at <a href="mailto:admin@kloudaudit.eu" style={{ color: "var(--green)", textDecoration: "none" }}>admin@kloudaudit.eu</a></p>
            </form>
          )}
        </div>
      </div>
    </div>
  );

  // ── BOOKING MODAL ──────────────────────────────────────────────────────────
  const BookingModal = () => (
    <div onClick={() => { setShowBooking(false); setBookingStatus("idle"); }} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.88)", backdropFilter: "blur(14px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", animation: "fadeIn 0.2s ease" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--bg2)", border: "1px solid rgba(0,255,180,0.2)", borderRadius: "24px", maxWidth: "520px", width: "100%", boxShadow: "0 40px 80px rgba(0,0,0,0.8)", animation: "scaleIn 0.3s cubic-bezier(0.34,1.56,0.64,1)", overflow: "hidden" }}>
        <div style={{ background: "linear-gradient(135deg, rgba(0,255,180,0.1) 0%, rgba(99,102,241,0.1) 100%)", borderBottom: "1px solid rgba(0,255,180,0.12)", padding: "28px 32px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "7px", background: "rgba(0,255,180,0.12)", border: "1px solid rgba(0,255,180,0.25)", borderRadius: "20px", padding: "4px 12px", marginBottom: "10px" }}>
                <span style={{ width: "5px", height: "5px", background: "var(--green)", borderRadius: "50%", display: "inline-block", boxShadow: "0 0 6px var(--green)" }} />
                <span style={{ fontSize: "11px", color: "var(--green)", fontWeight: 700, letterSpacing: "1px" }}>{`IMPLEMENTATION SESSION · ${currency.sessionPrice}`}</span>
              </div>
              <h2 className="display" style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-0.8px", color: "#fff", marginBottom: "5px" }}>Book your session</h2>
              <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>Senior DevOps engineer · Remote · Delivered within 48hrs</p>
            </div>
            <button onClick={() => { setShowBooking(false); setBookingStatus("idle"); }} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text-muted)", fontSize: "20px", width: "36px", height: "36px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "14px" }}>
            {["✓ Full audit review", "✓ Implementation roadmap", "✓ 1hr live session", "✓ 30-day follow-up"].map(item => (
              <span key={item} style={{ fontSize: "11px", color: "var(--text-dim)", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", borderRadius: "6px", padding: "3px 9px" }}>{item}</span>
            ))}
          </div>
        </div>
        <div style={{ padding: "26px 32px 32px" }}>
          {bookingStatus === "success" ? (
            <div style={{ textAlign: "center", padding: "28px 0" }}>
              <div style={{ fontSize: "48px", marginBottom: "14px" }}>🎉</div>
              <p className="display" style={{ color: "var(--green)", fontWeight: 800, fontSize: "22px", letterSpacing: "-0.5px", marginBottom: "8px" }}>Booking Received!</p>
              <p style={{ color: "var(--text-dim)", fontSize: "14px", lineHeight: 1.6 }}>We'll email you within 24hrs to confirm your session.<br />Check your inbox and spam folder.</p>
            </div>
          ) : (
            <form onSubmit={handleBookingSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <input type="hidden" name="_subject" value={`New Booking – KloudAudit Implementation Session ${currency.sessionPrice}`} />
              <input type="hidden" name="form_type" value="booking_999pln" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "1px" }}>First Name</label>
                  <input required type="text" name="first_name" placeholder="Jan" style={{ width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "14px", fontFamily: "var(--body)" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "1px" }}>Last Name</label>
                  <input required type="text" name="last_name" placeholder="Kowalski" style={{ width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "14px", fontFamily: "var(--body)" }} />
                </div>
              </div>
              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "1px" }}>Work Email</label>
                <input required type="email" name="email" placeholder="jan@company.com" style={{ width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "14px", fontFamily: "var(--body)" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "1px" }}>Company</label>
                <input required type="text" name="company" placeholder="Acme Corp" style={{ width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "14px", fontFamily: "var(--body)" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "1px" }}>Cloud Provider & Monthly Bill</label>
                <input type="text" name="cloud_details" placeholder="e.g. AWS · ~$4,500/month" style={{ width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "14px", fontFamily: "var(--body)" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "1px" }}>Biggest challenge <span style={{ color: "var(--text-muted)", fontWeight: 400, textTransform: "none" }}>(optional)</span></label>
                <textarea name="message" rows="3" placeholder="e.g. Our AWS bill jumped 40% last month..." style={{ width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "14px", resize: "none", fontFamily: "var(--body)" }} />
              </div>
              <button type="submit" className="glow-btn" disabled={bookingStatus === "sending"}
                style={{ background: bookingStatus === "sending" ? "rgba(0,255,180,0.5)" : "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "15px", fontSize: "15px", width: "100%", cursor: bookingStatus === "sending" ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginTop: "4px" }}>
                {bookingStatus === "sending" ? <><span style={{ display: "inline-block", width: "15px", height: "15px", border: "2px solid #000", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} /> Sending...</> : `Book Session for ${currency.sessionPrice} →`}
              </button>
              {bookingStatus === "error" && <p style={{ color: "#f87171", fontSize: "13px", textAlign: "center", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "8px", padding: "10px" }}>⚠ Something went wrong. Please try again.</p>}
              <p style={{ fontSize: "11px", color: "var(--text-muted)", textAlign: "center" }}>We'll confirm by email within 24 hours. No payment required upfront.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  );

  // ── BLUEPRINT MODAL — FIX #3: stable input, no flicker ───────────────────
  const BlueprintModal = () => (
    <div onClick={() => { setShowBlueprint(false); setBlueprintStatus("idle"); }} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.88)", backdropFilter: "blur(14px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", animation: "fadeIn 0.2s ease" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--bg2)", border: "1px solid rgba(0,255,180,0.2)", borderRadius: "20px", maxWidth: "460px", width: "100%", padding: "36px", boxShadow: "0 40px 80px rgba(0,0,0,0.8)", animation: "scaleIn 0.3s cubic-bezier(0.34,1.56,0.64,1)" }}>
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <div style={{ fontSize: "40px", marginBottom: "12px" }}>📄</div>
          <h2 className="display" style={{ fontSize: "24px", fontWeight: 800, color: "#fff", letterSpacing: "-0.5px", marginBottom: "8px" }}>Get Your AI Blueprint</h2>
          <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.6 }}>
            Enter your email and you'll be redirected to secure payment. Your personalised {provider || "cloud"} implementation guide lands in your inbox within 2 minutes of payment.
          </p>
        </div>
        <div style={{ background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "10px", padding: "14px 18px", marginBottom: "20px" }}>
          <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "10px", letterSpacing: "1px", textTransform: "uppercase" }}>What you get:</p>
          {[`Exact ${provider || "cloud"} CLI commands`, "Terraform snippets per issue", "Step-by-step fix instructions", `${flagged.length} issues with savings estimates`, "PDF in your inbox in ~2 minutes"].map(f => (
            <div key={f} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <span style={{ color: "var(--green)", fontSize: "13px" }}>✓</span>
              <span style={{ fontSize: "13px", color: "var(--text-dim)" }}>{f}</span>
            </div>
          ))}
        </div>
        <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "1px" }}>Your Email</label>
        {/* FIX #3: uncontrolled input with defaultValue — prevents re-render flicker */}
        <input
          type="email"
          placeholder="you@company.com"
          defaultValue={blueprintEmail}
          onChange={e => setBlueprintEmail(e.target.value)}
          onKeyDown={e => e.key === "Enter" && blueprintEmail && handleBuyBlueprint()}
          style={{ width: "100%", padding: "13px 16px", background: "rgba(255,255,255,0.06)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "15px", fontFamily: "var(--body)", marginBottom: "14px" }}
          autoFocus
        />
        <button className="glow-btn" onClick={handleBuyBlueprint}
          disabled={blueprintStatus === "loading"}
          style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "14px", fontSize: "15px", width: "100%", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
          {blueprintStatus === "loading" ? (
            <><span style={{ display: "inline-block", width: "15px", height: "15px", border: "2px solid #000", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} /> Redirecting to payment...</>
          ) : `Pay ${currency.blueprintPrice} → Get Blueprint`}
        </button>
        {blueprintStatus === "error" && <p style={{ color: "#f87171", fontSize: "12px", textAlign: "center", marginTop: "10px" }}>Something went wrong. Please try again or email admin@kloudaudit.eu</p>}
        <p style={{ fontSize: "11px", color: "var(--text-muted)", textAlign: "center", marginTop: "12px" }}>🔒 Secure payment via Stripe · Instant delivery · admin@kloudaudit.eu</p>
        <button onClick={() => { setShowBlueprint(false); setBlueprintStatus("idle"); }} style={{ display: "block", margin: "12px auto 0", background: "none", border: "none", color: "var(--text-muted)", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
      </div>
    </div>
  );

  // ── SAMPLE MODAL ───────────────────────────────────────────────────────────
  const SampleModal = () => {
    const getSev = c => { const p = (c.savingsRange[0] + c.savingsRange[1]) / 2; return p >= 30 ? "high" : p >= 15 ? "med" : "low"; };
    const sHigh = sampleFlagged.filter(c => getSev(c) === "high");
    const sMed = sampleFlagged.filter(c => getSev(c) === "med");
    const sLow = sampleFlagged.filter(c => getSev(c) === "low");
    return (
      <div onClick={() => setShowSample(false)} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", animation: "fadeIn 0.2s ease" }}>
        <div onClick={e => e.stopPropagation()} style={{ background: "var(--bg2)", border: "1px solid rgba(0,255,180,0.2)", borderRadius: "20px", maxWidth: "780px", width: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 40px 80px rgba(0,0,0,0.7)" }}>
          <div style={{ padding: "28px 32px 20px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--bg2)", zIndex: 10, borderRadius: "20px 20px 0 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
                  {["Sample Report", SAMPLE_REPORT.provider, "Apr 2026"].map(t => <span key={t} style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-dim)", fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "20px", border: "1px solid var(--border)" }}>{t}</span>)}
                </div>
                <h2 className="display" style={{ fontSize: "26px", fontWeight: 800, letterSpacing: "-1px", color: "#fff" }}>{SAMPLE_REPORT.companyName} · Cost Report</h2>
                <p style={{ color: "var(--text-muted)", fontSize: "14px", marginTop: "4px" }}>Monthly bill: ${SAMPLE_REPORT.monthlyBill.toLocaleString()} · {sampleFlagged.length} issues found</p>
              </div>
              <button onClick={() => setShowSample(false)} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text-muted)", fontSize: "18px", width: "36px", height: "36px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>×</button>
            </div>
          </div>
          <div style={{ padding: "24px 32px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px", marginBottom: "28px" }}>
              {[{ label: "Monthly Savings", val: `$${sampleSavMin.toLocaleString()} – $${sampleSavMax.toLocaleString()}`, sub: "per month", color: "var(--green)", bg: "var(--green-dim)", border: "var(--green-border)" }, { label: "Annual Opportunity", val: `$${(sampleSavMin * 12).toLocaleString()}+`, sub: "per year", color: "#818cf8", bg: "rgba(99,102,241,0.1)", border: "rgba(99,102,241,0.25)" }, { label: "Waste Rate", val: `~${samplePct}%`, sub: "of total bill", color: "#fb923c", bg: "rgba(251,146,60,0.1)", border: "rgba(251,146,60,0.25)" }].map(s => (
                <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: "12px", padding: "18px" }}>
                  <p style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>{s.label}</p>
                  <p className="display" style={{ fontSize: "20px", fontWeight: 800, color: s.color, letterSpacing: "-0.5px" }}>{s.val}</p>
                  <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "3px" }}>{s.sub}</p>
                </div>
              ))}
            </div>
            {[{ label: "🔴 High Impact", items: sHigh, color: "#f87171" }, { label: "🟡 Medium Impact", items: sMed, color: "#fbbf24" }, { label: "🟢 Quick Wins", items: sLow, color: "#4ade80" }].filter(g => g.items.length > 0).map(group => (
              <div key={group.label} style={{ marginBottom: "20px" }}>
                <h4 className="display" style={{ fontSize: "13px", fontWeight: 700, color: group.color, marginBottom: "10px" }}>{group.label}</h4>
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
              <button className="glow-btn" onClick={() => { setShowSample(false); goTo("intake"); }} style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "10px", padding: "13px 32px", fontSize: "15px", fontWeight: 700, boxShadow: "0 0 20px rgba(0,255,180,0.3)" }}>Run Your Free Audit →</button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── PAYMENT SUCCESS ────────────────────────────────────────────────────────
  if (step === "payment_success") return (
    <div className="app">
      <style>{globalCss}</style>
      <ParticleBackground />
      <Nav />
      <div style={{ maxWidth: "560px", margin: "0 auto", padding: "120px 24px", textAlign: "center", position: "relative", zIndex: 1 }}>
        <div style={{ fontSize: "72px", marginBottom: "24px" }}>🎉</div>
        <h1 className="display" style={{ fontSize: "36px", fontWeight: 800, letterSpacing: "-1.5px", color: "#fff", marginBottom: "12px" }}>Blueprint on its way!</h1>
        <p style={{ fontSize: "17px", color: "var(--text-muted)", lineHeight: 1.7, marginBottom: "32px" }}>
          Payment confirmed. Your AI-generated guide is being prepared and will land in your inbox within <strong style={{ color: "var(--green)" }}>2 minutes</strong>.
        </p>
        <div style={{ background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "14px", padding: "24px", marginBottom: "32px" }}>
          <p style={{ fontSize: "14px", color: "var(--text-dim)", marginBottom: "4px" }}>Check your email for a message from</p>
          <p style={{ fontSize: "16px", fontWeight: 700, color: "var(--green)" }}>admin@kloudaudit.eu</p>
          <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "8px" }}>Subject: "Your Implementation Blueprint is ready ⚡"</p>
          <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>Check spam if you don't see it within 5 minutes.</p>
        </div>
        <button className="glow-btn" onClick={() => { setStep("intro"); setChecked({}); }} style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "14px 32px", fontSize: "15px", cursor: "pointer", boxShadow: "0 0 24px rgba(0,255,180,0.3)" }}>Run Another Audit →</button>
      </div>
    </div>
  );


  // ── SECURITY AUDIT INTRO ──────────────────────────────────────────────────
  if (step === "security_intro") {
    const SEC_SECTIONS = [
      { id: "iam", icon: "🔐", title: "Identity & Access", color: "#f87171",
        desc: "IAM policies, MFA enforcement, privilege escalation paths",
        checks: [
          { id: "mfa_all", label: "MFA not enforced for all users", detail: "Users can authenticate with password only — no second factor", risk: "Critical" },
          { id: "iam_wildcards", label: "IAM wildcard permissions (Action: *)", detail: "Overly permissive policies granting full service access", risk: "Critical" },
          { id: "root_usage", label: "Root account used for daily operations", detail: "Root credentials should never be used after initial setup", risk: "High" },
          { id: "unused_keys", label: "Access keys older than 90 days", detail: "Long-lived credentials increase breach exposure window", risk: "High" },
        ]
      },
      { id: "network", icon: "🌐", title: "Network & Exposure", color: "#fb923c",
        desc: "Public exposure, VPC isolation, security groups",
        checks: [
          { id: "public_buckets", label: "Public S3/storage buckets detected", detail: "Storage accessible without authentication from the internet", risk: "Critical" },
          { id: "open_security_groups", label: "Security groups open to 0.0.0.0/0", detail: "Ports open to entire internet — including management ports", risk: "High" },
          { id: "no_vpc", label: "Resources not isolated in VPC", detail: "Services running without network boundary controls", risk: "High" },
          { id: "no_waf", label: "No WAF on public endpoints", detail: "Web application firewall absent on internet-facing services", risk: "Medium" },
        ]
      },
      { id: "data", icon: "🗄", title: "Data Protection", color: "#fbbf24",
        desc: "Encryption at rest, in transit, secrets management",
        checks: [
          { id: "no_encryption_rest", label: "Data at rest not encrypted", detail: "Databases or storage volumes without encryption enabled", risk: "High" },
          { id: "no_encryption_transit", label: "Data in transit not encrypted (HTTP)", detail: "Internal or external traffic using unencrypted channels", risk: "High" },
          { id: "hardcoded_secrets", label: "Secrets hardcoded in code/config", detail: "API keys, passwords, or tokens in source code or env vars", risk: "Critical" },
          { id: "no_kms", label: "No key management system", detail: "Encryption keys not centrally managed or rotated", risk: "Medium" },
        ]
      },
      { id: "logging", icon: "📋", title: "Logging & Detection", color: "#818cf8",
        desc: "Audit trails, alerting, incident response",
        checks: [
          { id: "no_cloudtrail", label: "Audit logging not enabled", detail: "No CloudTrail/Audit Log — no record of who did what", risk: "High" },
          { id: "no_alerts", label: "No security alerts configured", detail: "No notifications for suspicious activity or policy violations", risk: "High" },
          { id: "no_ir_plan", label: "No incident response plan", detail: "No documented process for security incidents", risk: "Medium" },
          { id: "no_vuln_scanning", label: "No vulnerability scanning", detail: "Infrastructure not scanned for known CVEs or misconfigs", risk: "Medium" },
        ]
      },
    ];

    const allSecChecks = SEC_SECTIONS.flatMap(s => s.checks);
    const flaggedSec = allSecChecks.filter(c => secChecked[c.id]);
    const criticalCount = flaggedSec.filter(c => c.risk === "Critical").length;
    const highCount = flaggedSec.filter(c => c.risk === "High").length;
    const currentSection = SEC_SECTIONS[secStep];
    const RISK_COLOR = { Critical: "#f87171", High: "#fb923c", Medium: "#fbbf24", Low: "#4ade80" };

    const handleSecurityReport = async () => {
      if (flaggedSec.length === 0) return;
      setSecLoading(true);
      setSecError(null);
      try {
        const res = await fetch("/api/security-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: provider || "AWS",
            companyName: companyName || "Your Company",
            teamSize: "unknown",
            environment: "production",
            mfaEnabled: !secChecked["mfa_all"],
            publicBuckets: secChecked["public_buckets"],
            iamWildcards: secChecked["iam_wildcards"],
            encryptionAtRest: !secChecked["no_encryption_rest"],
            encryptionInTransit: !secChecked["no_encryption_transit"],
            loggingEnabled: !secChecked["no_cloudtrail"],
            vpcIsolation: !secChecked["no_vpc"],
            secretsManager: !secChecked["hardcoded_secrets"],
            incidentResponse: !secChecked["no_ir_plan"],
            patchingCadence: "unknown",
            complianceFramework: "General best practices",
            flaggedIssues: flaggedSec.map(c => c.label),
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setSecReport(data.report);
        goTo("security_report");
      } catch (err) {
        setSecError(err.message || "Failed to generate report. Please try again.");
      } finally {
        setSecLoading(false);
      }
    };

    return (
      <div className="app">
        <style>{globalCss}</style>
        <ParticleBackground />
        {showContact && <ContactModal />}
        {showBooking && <BookingModal />}
        <Nav showBack onBack={() => goTo("intro")} />

        <div style={{ maxWidth: "960px", margin: "0 auto", padding: "40px 24px 100px" }}>
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: "20px", padding: "6px 16px", marginBottom: "20px" }}>
              <span style={{ width: "6px", height: "6px", background: "#f87171", borderRadius: "50%", animation: "pulse-dot 2s infinite" }} />
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#f87171", letterSpacing: "1.5px" }}>CLOUD SECURITY AUDIT — ZERO ACCESS REQUIRED</span>
            </div>
            <h1 className="display" style={{ fontSize: "clamp(32px,5vw,56px)", fontWeight: 800, letterSpacing: "-2px", color: "#fff", marginBottom: "16px", lineHeight: 1.05 }}>
              Find security gaps before<br /><span style={{ color: "#f87171" }}>attackers do.</span>
            </h1>
            <p style={{ fontSize: "16px", color: "var(--text-muted)", maxWidth: "520px", margin: "0 auto", lineHeight: 1.7 }}>
              16 security checkpoints across IAM, network exposure, data protection, and logging. Self-reported — no credentials, no cloud access, no agents.
            </p>
          </div>

          {/* Progress + section tabs */}
          <div style={{ display: "flex", gap: "4px", marginBottom: "32px", background: "var(--bg2)", borderRadius: "12px", padding: "6px", border: "1px solid var(--border)" }}>
            {SEC_SECTIONS.map((s, i) => (
              <button key={s.id} onClick={() => setSecStep(i)}
                style={{ flex: 1, padding: "10px 8px", borderRadius: "8px", border: "none", cursor: "pointer", fontSize: "12px", fontWeight: 700, transition: "all 0.2s", background: secStep === i ? s.color + "20" : "transparent", color: secStep === i ? s.color : "var(--text-muted)", borderBottom: secStep === i ? `2px solid ${s.color}` : "2px solid transparent" }}>
                {s.icon} {s.title}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: "24px", alignItems: "start" }}>
            {/* Checks */}
            <div>
              <div style={{ marginBottom: "20px" }}>
                <h2 className="display" style={{ fontSize: "22px", fontWeight: 700, color: "#fff", marginBottom: "6px" }}>{currentSection.icon} {currentSection.title}</h2>
                <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>{currentSection.desc}</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {currentSection.checks.map(check => (
                  <div key={check.id} onClick={() => setSecChecked(p => ({ ...p, [check.id]: !p[check.id] }))}
                    style={{ background: secChecked[check.id] ? `${RISK_COLOR[check.risk]}10` : "var(--bg2)", border: `1.5px solid ${secChecked[check.id] ? RISK_COLOR[check.risk] + "60" : "var(--border)"}`, borderRadius: "14px", padding: "18px 20px", cursor: "pointer", transition: "all 0.2s" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                          <span style={{ fontSize: "11px", fontWeight: 700, color: RISK_COLOR[check.risk], background: RISK_COLOR[check.risk] + "15", border: `1px solid ${RISK_COLOR[check.risk]}30`, borderRadius: "4px", padding: "2px 7px" }}>{check.risk}</span>
                          <span style={{ fontSize: "14px", fontWeight: 700, color: secChecked[check.id] ? "#fff" : "var(--text-dim)" }}>{check.label}</span>
                        </div>
                        <p style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.5 }}>{check.detail}</p>
                      </div>
                      <div style={{ width: "22px", height: "22px", borderRadius: "6px", border: `2px solid ${secChecked[check.id] ? RISK_COLOR[check.risk] : "var(--border)"}`, background: secChecked[check.id] ? RISK_COLOR[check.risk] : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>
                        {secChecked[check.id] && <span style={{ color: "#000", fontSize: "12px", fontWeight: 800 }}>✓</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Navigation */}
              <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
                {secStep > 0 && <button onClick={() => setSecStep(s => s - 1)} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: "10px", padding: "12px 24px", color: "var(--text-muted)", fontSize: "14px", cursor: "pointer" }}>← Back</button>}
                {secStep < SEC_SECTIONS.length - 1
                  ? <button className="glow-btn" onClick={() => setSecStep(s => s + 1)} style={{ background: currentSection.color, color: "#000", border: "none", borderRadius: "10px", padding: "12px 28px", fontSize: "14px", fontWeight: 700, cursor: "pointer" }}>Next Section →</button>
                  : <button className="glow-btn" onClick={handleSecurityReport} disabled={secLoading || flaggedSec.length === 0}
                      style={{ background: flaggedSec.length > 0 ? "#f87171" : "rgba(255,255,255,0.06)", color: flaggedSec.length > 0 ? "#000" : "var(--text-muted)", border: "none", borderRadius: "10px", padding: "12px 32px", fontSize: "14px", fontWeight: 700, cursor: flaggedSec.length > 0 ? "pointer" : "not-allowed", opacity: secLoading ? 0.7 : 1 }}>
                      {secLoading ? (
                        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ display: "inline-block", width: "14px", height: "14px", border: "2px solid #000", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                          Generating Security Report…
                        </span>
                      ) : `Generate Security Report →`}
                    </button>
                }
              </div>
              {secError && <p style={{ color: "#f87171", fontSize: "13px", marginTop: "12px", background: "rgba(248,113,113,0.08)", padding: "10px 14px", borderRadius: "8px", border: "1px solid rgba(248,113,113,0.2)" }}>⚠ {secError}</p>}
            </div>

            {/* Sidebar — live risk summary */}
            <div style={{ position: "sticky", top: "80px" }}>
              <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "16px", padding: "24px" }}>
                <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "16px" }}>Risk Summary</p>
                {flaggedSec.length === 0 ? (
                  <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.6 }}>Check issues as you find them — your risk summary will appear here.</p>
                ) : (
                  <>
                    {criticalCount > 0 && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "8px", padding: "10px 14px", marginBottom: "8px" }}>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: "#f87171" }}>🔴 Critical</span>
                      <span style={{ fontSize: "18px", fontWeight: 800, color: "#f87171" }}>{criticalCount}</span>
                    </div>}
                    {highCount > 0 && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(251,146,60,0.08)", border: "1px solid rgba(251,146,60,0.2)", borderRadius: "8px", padding: "10px 14px", marginBottom: "8px" }}>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: "#fb923c" }}>🟠 High</span>
                      <span style={{ fontSize: "18px", fontWeight: 800, color: "#fb923c" }}>{highCount}</span>
                    </div>}
                    {flaggedSec.filter(c => c.risk === "Medium").length > 0 && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px" }}>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: "#fbbf24" }}>🟡 Medium</span>
                      <span style={{ fontSize: "18px", fontWeight: 800, color: "#fbbf24" }}>{flaggedSec.filter(c => c.risk === "Medium").length}</span>
                    </div>}
                    <div style={{ borderTop: "1px solid var(--border)", paddingTop: "14px" }}>
                      <p style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.6 }}>
                        {criticalCount > 0 ? "⚠️ Critical issues require immediate attention. Your infrastructure may be actively at risk." : "Complete all 4 sections for a full security assessment."}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── SECURITY REPORT ──────────────────────────────────────────────────────────
  if (step === "security_report") {
    return (
      <div className="app">
        <style>{globalCss}</style>
        <ParticleBackground />
        {showContact && <ContactModal />}
        {showBooking && <BookingModal />}
        <Nav showBack onBack={() => goTo("security_intro")} />

        <div style={{ maxWidth: "800px", margin: "0 auto", padding: "40px 24px 100px" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "32px", flexWrap: "wrap" }}>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "7px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: "20px", padding: "4px 14px", marginBottom: "10px" }}>
                <span style={{ width: "5px", height: "5px", background: "#f87171", borderRadius: "50%", animation: "pulse-dot 2s infinite" }} />
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#f87171", letterSpacing: "1px" }}>SECURITY ASSESSMENT COMPLETE</span>
              </div>
              <h1 className="display" style={{ fontSize: "clamp(24px,4vw,36px)", fontWeight: 800, letterSpacing: "-1px", color: "#fff" }}>
                Cloud Security Report
              </h1>
              <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>{provider} · Generated {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            </div>
          </div>

          {/* AI Report */}
          <div style={{ background: "var(--bg2)", border: "1px solid rgba(248,113,113,0.15)", borderRadius: "20px", padding: "32px", marginBottom: "24px" }}>
            {secReport ? (
              <div style={{ fontFamily: "var(--body)", lineHeight: 1.8 }}>
                {secReport.split('
').map((line, i) => {
                  if (line.startsWith('## ')) return (
                    <h2 key={i} style={{ fontSize: "16px", fontWeight: 800, color: "#f87171", letterSpacing: "0.5px", textTransform: "uppercase", marginTop: "28px", marginBottom: "12px", paddingBottom: "8px", borderBottom: "1px solid rgba(248,113,113,0.2)" }}>{line.replace('## ', '')}</h2>
                  );
                  if (line.startsWith('- **CRITICAL**') || line.includes('CRITICAL')) return (
                    <p key={i} style={{ fontSize: "13px", color: "#f87171", fontWeight: 600, background: "rgba(248,113,113,0.06)", padding: "4px 10px", borderRadius: "6px", marginBottom: "4px" }}>{line}</p>
                  );
                  if (line.startsWith('```')) return null;
                  if (line.match(/^(aws |gcloud |az |terraform|kubectl)/)) return (
                    <code key={i} style={{ display: "block", fontSize: "12px", color: "#93c5fd", background: "rgba(147,197,253,0.06)", padding: "6px 12px", borderRadius: "6px", marginBottom: "4px", fontFamily: "monospace" }}>{line}</code>
                  );
                  if (line.startsWith('**')) return (
                    <p key={i} style={{ fontSize: "14px", fontWeight: 700, color: "#fff", marginBottom: "4px" }}>{line.replace(/\*\*/g, '')}</p>
                  );
                  return line.trim() ? <p key={i} style={{ fontSize: "14px", color: "var(--text-dim)", marginBottom: "4px" }}>{line}</p> : <br key={i} />;
                })}
              </div>
            ) : (
              <p style={{ color: "var(--text-muted)" }}>No report data available.</p>
            )}
          </div>

          {/* Trust + CTA */}
          <div style={{ background: "rgba(248,113,113,0.04)", border: "1px solid rgba(248,113,113,0.12)", borderRadius: "16px", padding: "24px", marginBottom: "24px", textAlign: "center" }}>
            <p style={{ fontSize: "13px", fontWeight: 700, color: "#f87171", marginBottom: "6px" }}>🔒 What KloudAudit Security never sees</p>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.65 }}>
              No credentials. No cloud access. No account IDs. This report was generated entirely from your self-reported answers using Claude AI. We have zero visibility into your actual infrastructure.
            </p>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={() => window.print()} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: "12px", padding: "13px 28px", color: "var(--text-dim)", fontSize: "14px", cursor: "pointer", fontWeight: 600 }}>
              🖨 Print / Save PDF
            </button>
            <button onClick={() => { setSecChecked({}); setSecReport(null); setSecStep(0); goTo("security_intro"); }}
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: "12px", padding: "13px 28px", color: "var(--text-dim)", fontSize: "14px", cursor: "pointer", fontWeight: 600 }}>
              🔄 Re-run Audit
            </button>
            <button onClick={() => goTo("intro")}
              style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "13px 28px", fontSize: "14px", fontWeight: 800, cursor: "pointer" }}>
              → Run Cost Audit Too
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── INTRO ──────────────────────────────────────────────────────────────────
  if (step === "intro") {
    // calcBill and openFaq declared at top level (Rules of Hooks)
    const calcMin = Math.round(calcBill * 0.20);
    const calcMax = Math.round(calcBill * 0.45);
    const calcAnnual = Math.round(calcMin * 12);

    // TESTIMONIALS — defined at module level below for performance

    const FAQS = [
      { q: "Do you need access to my cloud account?", a: "No. The audit is entirely self-guided — you answer questions based on your own knowledge of your infrastructure. No credentials, no agents, no read-only IAM roles required." },
      { q: "How is the AI Blueprint different from the free report?", a: "The free report tells you *what* is wrong and estimates savings. The Blueprint tells you *exactly how to fix it* — with CLI commands, Terraform snippets, step-by-step instructions, and verification steps specific to your provider." },
      { q: "How fast do I receive the Blueprint?", a: "Instantly after payment confirmation. Claude AI generates your personalised guide in ~30 seconds, then SendGrid delivers it to your inbox. Most customers receive it within 2 minutes." },
      { q: "What if my cloud bill is lower than $1,000/month?", a: "The audit is still valuable for identifying waste patterns before they scale. The Blueprint is most cost-effective for bills over $1,500/mo — below that, the free report gives you plenty to work with." },
      { q: "Is this a subscription?", a: `No. One-time payment of ${currency.blueprintPrice}. You get a permanent PDF you can implement at your own pace.` },
    ];

    const HOW_IT_WORKS = [
      { n: "01", title: "Run the free audit", desc: "Answer 18 structured questions about your cloud setup. Takes 10–15 minutes. No account needed.", color: "var(--green)" },
      { n: "02", title: "See your savings report", desc: "Instantly see your estimated waste, prioritised findings, and projected monthly savings.", color: "#818cf8" },
      { n: "03", title: "Get the AI Blueprint", desc: `Pay ${currency.blueprintPrice}. Claude AI writes your personalised fix guide — exact CLI commands, Terraform snippets, step-by-step.`, color: "#00d4ff" },
      { n: "04", title: "Implement & save", desc: "Follow the blueprint. Most clients recoup the cost within 24 hours of the first fix.", color: "#fb923c" },
    ];

    return (
    <div className="app">
      <style>{globalCss}</style>
      <ParticleBackground />
      {showSample && <SampleModal />}

      {/* ── EXIT INTENT MODAL ── */}
      {showExitIntent && (
        <div onClick={() => setShowExitIntent(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)",
          zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px",
          animation: "fadeIn 0.25s ease"
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "linear-gradient(145deg, #0f0f1a, #13131f)",
            border: "1px solid rgba(255,255,255,0.12)", borderRadius: "20px",
            padding: "40px 36px", maxWidth: "420px", width: "100%", position: "relative",
            boxShadow: "0 25px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,255,180,0.08)",
            animation: "slideUp 0.35s cubic-bezier(0.4,0,0.2,1)"
          }}>
            <style>{`
              @keyframes slideUp {
                from { opacity: 0; transform: translateY(24px) scale(0.97); }
                to   { opacity: 1; transform: translateY(0) scale(1); }
              }
            `}</style>
            {/* Close */}
            <button onClick={() => setShowExitIntent(false)} style={{
              position: "absolute", top: "16px", right: "16px", background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "var(--text-muted)",
              width: "30px", height: "30px", cursor: "pointer", fontSize: "16px", lineHeight: 1,
              display: "flex", alignItems: "center", justifyContent: "center"
            }}>×</button>

            {/* Badge */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(0,255,180,0.1)", border: "1px solid rgba(0,255,180,0.25)", borderRadius: "20px", padding: "4px 12px", marginBottom: "20px" }}>
              <span style={{ width: "5px", height: "5px", background: "var(--green)", borderRadius: "50%", animation: "pulse-dot 2s infinite" }} />
              <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)", letterSpacing: "1px" }}>WAIT — FREE AUDIT TAKES 15 MIN</span>
            </div>

            <h2 className="display" style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-0.8px", color: "#fff", marginBottom: "10px", lineHeight: 1.2 }}>
              Your cloud bill is hiding savings right now.
            </h2>
            <p style={{ fontSize: "14px", color: "var(--text-muted)", lineHeight: 1.65, marginBottom: "24px" }}>
              Most teams find <strong style={{ color: "#fff" }}>$1,000–$3,000/month</strong> in waste on their first audit. It's free, takes 15 minutes, and requires zero account access.
            </p>

            {/* Social proof */}
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", padding: "14px 16px", marginBottom: "24px" }}>
              <p style={{ fontSize: "13px", color: "var(--text-dim)", fontStyle: "italic", marginBottom: "8px" }}>
                "Found $2,400/mo in idle RDS instances on the first audit. Took 40 minutes to fix."
              </p>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 600 }}>— Marek W., Lead DevOps · Warsaw fintech</p>
            </div>

            {/* CTA */}
            <button
              onClick={() => { setShowExitIntent(false); setStep("questions"); window.scrollTo(0,0); }}
              style={{
                width: "100%", padding: "14px", borderRadius: "12px", border: "none", cursor: "pointer",
                background: "linear-gradient(135deg, var(--green), #00c896)",
                color: "#000", fontWeight: 800, fontSize: "15px", letterSpacing: "-0.3px",
                boxShadow: "0 4px 20px rgba(0,255,180,0.3)", transition: "transform 0.2s, box-shadow 0.2s"
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 30px rgba(0,255,180,0.4)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,255,180,0.3)"; }}
            >
              Run My Free Audit →
            </button>
            <p onClick={() => setShowExitIntent(false)} style={{ textAlign: "center", fontSize: "12px", color: "var(--text-muted)", marginTop: "12px", cursor: "pointer" }}>
              No thanks, I'll keep overpaying
            </p>
          </div>
        </div>
      )}
      {showContact && <ContactModal />}
      {showBooking && <BookingModal />}
      {showBlueprint && <BlueprintModal />}
      <Nav />

      {/* ── STICKY BOTTOM CTA BAR ── */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 90, background: "rgba(8,8,16,0.97)", backdropFilter: "blur(20px)", borderTop: "1px solid rgba(0,255,180,0.2)", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "8px", height: "8px", background: "var(--green)", borderRadius: "50%", boxShadow: "0 0 8px var(--green)", flexShrink: 0 }} />
          <span style={{ fontSize: "13px", color: "var(--text-dim)" }}>Average team saves <strong style={{ color: "var(--green)" }}>$2,800+/month</strong> after their first audit</span>
        </div>
        <button className="glow-btn" onClick={() => goTo("intake")} style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "10px", padding: "11px 28px", fontSize: "14px", boxShadow: "0 0 20px rgba(0,255,180,0.3)", whiteSpace: "nowrap" }}>
          See What My Bill Is Hiding →
        </button>
      </div>

      <div style={{ position: "relative", zIndex: 1, maxWidth: "1140px", margin: "0 auto", padding: "0 24px", paddingBottom: "72px" }}>

        {/* ── HERO ── */}
        <div className="hero-pad" style={{ paddingTop: "90px", paddingBottom: "72px", textAlign: "center" }}>
          {/* ── CATEGORY BADGE ── */}
          <div className="fade-up" style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "20px", padding: "7px 18px", marginBottom: "32px" }}>
            <span style={{ width: "6px", height: "6px", background: "var(--green)", borderRadius: "50%", display: "inline-block", boxShadow: "0 0 8px var(--green)", animation: "pulse-dot 2s infinite" }} />
            <span style={{ fontSize: "12px", color: "var(--green)", fontWeight: 700, letterSpacing: "1.5px" }}>THE ONLY CLOUD COST AUDIT — ZERO ACCESS. ZERO SETUP. ZERO RISK.</span>
          </div>

          {/* ── HEADLINE ── */}
          <h1 className="display fade-up stagger-1" style={{ fontSize: "clamp(42px,6.5vw,82px)", fontWeight: 800, lineHeight: 1.0, letterSpacing: "-3px", color: "#fff", marginBottom: "24px" }}>
            The audit your<br />
            <span style={{ background: "linear-gradient(135deg, #00ffb4 0%, #00d4ff 60%, #818cf8 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>AWS console</span><br />
            won&apos;t give you.
          </h1>

          {/* ── SUBHEADING ── */}
          <p className="fade-up stagger-2" style={{ fontSize: "18px", color: "var(--text-dim)", lineHeight: 1.75, maxWidth: "560px", margin: "0 auto 20px" }}>
            No AWS keys. No IAM roles. No procurement process. Answer 18 questions about your setup — get a prioritised savings report with exact CLI commands in 15 minutes.
          </p>

          {/* ── COMPETITOR KILL LINE ── */}
          <p className="fade-up stagger-2" style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.6, maxWidth: "480px", margin: "0 auto 36px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", padding: "10px 16px" }}>
            💡 Unlike ChatGPT or Copilot — KloudAudit knows your provider, your bill size, your flagged issues, and your company. The Blueprint isn&apos;t generic advice. It&apos;s written about <em>your</em> infrastructure specifically.
          </p>

          <div className="fade-up stagger-3" style={{ display: "flex", gap: "14px", justifyContent: "center", flexWrap: "wrap" }}>
            <button className="glow-btn" onClick={() => goTo("intake")}
              style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "16px 36px", fontSize: "16px", boxShadow: "0 0 24px rgba(0,255,180,0.3)", display: "flex", alignItems: "center", gap: "10px" }}>
              Calculate My Savings <span style={{ fontSize: "18px" }}>→</span>
            </button>
            <button className="ghost-btn" onClick={() => setShowSample(true)}
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", color: "var(--text-dim)", borderRadius: "12px", padding: "16px 28px", fontSize: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>📄</span> See Sample Report
            </button>
          </div>
          <div className="fade-up stagger-4" style={{ marginTop: "22px", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", flexWrap: "wrap" }}>
            {[
              { text: "🔒 Zero account access — ever", highlight: true },
              { text: "✓ No sign-up required", highlight: false },
              { text: "⚡ Results in 15 min", highlight: false },
              { text: "👥 62+ teams audited", highlight: false },
              { text: "🚫 No procurement needed", highlight: false },
            ].map((item, i) => (
              <span key={i} style={{ fontSize: "12px", color: item.highlight ? "var(--green)" : "var(--text-muted)", background: item.highlight ? "rgba(0,255,180,0.06)" : "rgba(255,255,255,0.04)", border: `1px solid ${item.highlight ? "rgba(0,255,180,0.2)" : "rgba(255,255,255,0.08)"}`, borderRadius: "20px", padding: "4px 12px", whiteSpace: "nowrap", fontWeight: item.highlight ? 700 : 400 }}>
                {item.text}
              </span>
            ))}
          </div>

          {/* ── LIVE SOCIAL PROOF TICKER ── */}
          <LiveFeedTicker />
        </div>

        {/* ── STATS BAR ── */}
        <div className="fade-up stagger-3" className="stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "1px", background: "var(--border)", borderRadius: "16px", overflow: "hidden", border: "1px solid var(--border)", marginBottom: "80px" }}>
          {[
            { n: "20–45%", label: "Average savings found" },
            { n: "18", label: "Audit checkpoints" },
            { n: "< 15 min", label: "Average completion" },
            { n: "Free", label: "Cost to audit" },
          ].map((s, i) => (
            <div key={i} style={{ background: "var(--bg2)", padding: "28px 24px", textAlign: "center" }}>
              <div className="display" style={{ fontSize: "28px", fontWeight: 800, color: "var(--green)", letterSpacing: "-1px", marginBottom: "6px" }}>{s.n}</div>
              <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── HOW IT WORKS ── */}
        <div style={{ marginBottom: "90px" }}>
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <p style={{ fontSize: "11px", letterSpacing: "3px", color: "var(--green)", fontWeight: 700, textTransform: "uppercase", marginBottom: "12px" }}>Zero guesswork</p>
            <h2 className="display" style={{ fontSize: "clamp(28px,3.5vw,44px)", fontWeight: 800, letterSpacing: "-1.5px", color: "#fff" }}>How it works</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "16px", marginTop: "12px", maxWidth: "420px", margin: "12px auto 0" }}>From first visit to first saving — in under 20 minutes.</p>
          </div>
          <div className="how-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "2px", background: "var(--border)", borderRadius: "20px", overflow: "hidden", border: "1px solid var(--border)" }}>
            {HOW_IT_WORKS.map((step, i) => {
              const isActive = activeHowStep === i;
              return (
                <div key={i}
                  onClick={() => setActiveHowStep(isActive ? null : i)}
                  style={{
                    background: isActive ? `linear-gradient(145deg, ${step.color}12, var(--bg2))` : "var(--bg2)",
                    padding: "32px 28px",
                    position: "relative",
                    overflow: "hidden",
                    cursor: "pointer",
                    transition: "all 0.35s cubic-bezier(0.4,0,0.2,1)",
                    transform: isActive ? "scale(1.02)" : "scale(1)",
                    boxShadow: isActive ? `0 8px 40px ${step.color}20, inset 0 0 0 1.5px ${step.color}30` : "none",
                    zIndex: isActive ? 2 : 1,
                  }}>
                  {/* Step number — clipped inside card, dimmed */}
                  <div style={{
                    position: "absolute", bottom: "-12px", right: "12px",
                    fontFamily: "var(--display)", fontSize: "72px", fontWeight: 800,
                    color: isActive ? `${step.color}18` : `${step.color}08`,
                    lineHeight: 1, pointerEvents: "none", userSelect: "none",
                    transition: "color 0.35s",
                    overflow: "hidden", maxWidth: "100%",
                  }}>{step.n}</div>

                  {/* Number badge */}
                  <div style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: "38px", height: "38px", borderRadius: "10px",
                    background: isActive ? `${step.color}25` : `${step.color}15`,
                    border: `1px solid ${isActive ? step.color + "60" : step.color + "30"}`,
                    marginBottom: "16px",
                    transition: "all 0.3s",
                    boxShadow: isActive ? `0 0 14px ${step.color}40` : "none",
                  }}>
                    <span className="display" style={{ fontSize: "13px", fontWeight: 800, color: step.color }}>{step.n}</span>
                  </div>

                  <h3 className="display" style={{ fontSize: "16px", fontWeight: 700, color: isActive ? "#fff" : "#cbd5e1", marginBottom: "8px", letterSpacing: "-0.3px", transition: "color 0.3s" }}>{step.title}</h3>

                  {/* Description — expands on click */}
                  <div style={{
                    overflow: "hidden",
                    maxHeight: isActive ? "120px" : "0px",
                    opacity: isActive ? 1 : 0,
                    transition: "max-height 0.4s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease",
                    marginBottom: isActive ? "12px" : "0",
                  }}>
                    <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.65 }}>{step.desc}</p>
                    {i === 2 && (
                      <div style={{ marginTop: "12px", display: "inline-flex", alignItems: "center", gap: "6px", background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "6px", padding: "4px 10px" }}>
                        <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)" }}>{`${currency.blueprintPrice} · one-time`}</span>
                      </div>
                    )}
                  </div>

                  {/* Tap hint */}
                  <p style={{ fontSize: "11px", color: isActive ? "transparent" : `${step.color}80`, transition: "color 0.3s", fontWeight: 600, letterSpacing: "0.5px" }}>
                    {isActive ? "" : "Tap to learn more"}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── LIVE SAVINGS CALCULATOR ── */}
        <div style={{ marginBottom: "90px", background: "var(--bg2)", border: "1px solid rgba(0,255,180,0.15)", borderRadius: "24px", padding: "48px 40px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: "-60px", right: "-60px", width: "280px", height: "280px", background: "radial-gradient(circle, rgba(0,255,180,0.07) 0%, transparent 70%)", borderRadius: "50%", pointerEvents: "none" }} />
          <div style={{ textAlign: "center", marginBottom: "36px" }}>
            <p style={{ fontSize: "11px", letterSpacing: "3px", color: "var(--green)", fontWeight: 700, textTransform: "uppercase", marginBottom: "12px" }}>See your numbers</p>
            <h2 className="display" style={{ fontSize: "clamp(24px,3vw,38px)", fontWeight: 800, letterSpacing: "-1px", color: "#fff" }}>How much are you leaving on the table?</h2>
          </div>
          <div style={{ maxWidth: "600px", margin: "0 auto" }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--green)", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "1px" }}>
              Your monthly cloud bill: <span style={{ color: "#fff", fontFamily: "var(--display)", fontSize: "18px" }}>${calcBill.toLocaleString()}</span>
            </label>
            <input type="range" min="500" max="50000" step="500" value={calcBill} onChange={e => setCalcBill(Number(e.target.value))}
              style={{ width: "100%", accentColor: "var(--green)", height: "4px", cursor: "pointer", marginBottom: "32px" }} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px", marginBottom: "28px" }}>
              {[
                { label: "Min monthly saving", val: `$${calcMin.toLocaleString()}`, sub: "conservative (20%)", color: "var(--green)", bg: "var(--green-dim)", border: "var(--green-border)" },
                { label: "Max monthly saving", val: `$${calcMax.toLocaleString()}`, sub: "typical (45%)", color: "#818cf8", bg: "rgba(99,102,241,0.1)", border: "rgba(99,102,241,0.25)" },
                { label: "Annual opportunity", val: `$${calcAnnual.toLocaleString()}+`, sub: "per year", color: "#fb923c", bg: "rgba(251,146,60,0.08)", border: "rgba(251,146,60,0.2)" },
              ].map(s => (
                <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: "14px", padding: "20px 16px", textAlign: "center" }}>
                  <p style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>{s.label}</p>
                  <p className="display" style={{ fontSize: "22px", fontWeight: 800, color: s.color, letterSpacing: "-0.5px", marginBottom: "4px" }}>{s.val}</p>
                  <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>{s.sub}</p>
                </div>
              ))}
            </div>
            <div style={{ background: "rgba(0,255,180,0.04)", border: "1px solid rgba(0,255,180,0.12)", borderRadius: "12px", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
              <p style={{ fontSize: "14px", color: "var(--text-dim)" }}>
                The Blueprint costs <strong style={{ color: "var(--green)" }}>{currency.blueprintPrice}</strong>. At your bill size, it pays for itself in <strong style={{ color: "#fff" }}>{calcMin > (currency.blueprintAmount / 100) ? "the first day" : "the first week"}</strong>.
              </p>
              <button className="glow-btn" onClick={() => goTo("intake")} style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "10px", padding: "12px 24px", fontSize: "14px", boxShadow: "0 0 20px rgba(0,255,180,0.25)", whiteSpace: "nowrap" }}>
                Find my savings →
              </button>
            </div>
          </div>
        </div>

        {/* ── WHAT WE AUDIT ── */}
        <div style={{ marginBottom: "90px" }}>
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <p style={{ fontSize: "11px", letterSpacing: "3px", color: "var(--green)", fontWeight: 700, textTransform: "uppercase", marginBottom: "12px" }}>Comprehensive coverage</p>
            <h2 className="display" style={{ fontSize: "clamp(28px,3.5vw,44px)", fontWeight: 800, letterSpacing: "-1.5px", color: "#fff" }}>What we audit</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "16px", marginTop: "12px", maxWidth: "480px", margin: "12px auto 0" }}>Five critical areas where cloud spend leaks — and where the biggest savings hide.</p>
          </div>
          <div className="audit-cats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
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
                    {s.checks.slice(0, 3).map(c => <span key={c.id} style={{ fontSize: "11px", color: "var(--text-dim)", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: "6px", padding: "3px 8px" }}>{c.label}</span>)}
                    {s.checks.length > 3 && <span style={{ fontSize: "11px", color: "var(--text-muted)", padding: "3px 6px" }}>+{s.checks.length - 3} more</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── TESTIMONIALS ── */}
        <div style={{ marginBottom: "90px" }}>
          <div style={{ textAlign: "center", marginBottom: "40px" }}>
            <p style={{ fontSize: "11px", letterSpacing: "3px", color: "var(--green)", fontWeight: 700, textTransform: "uppercase", marginBottom: "12px" }}>Real results</p>
            <h2 className="display" style={{ fontSize: "clamp(24px,3vw,38px)", fontWeight: 800, letterSpacing: "-1px", color: "#fff" }}>What engineers say</h2>
          </div>
          <div className="testimonials-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "16px" }}>
            {TESTIMONIALS.map((t, i) => (
              <div key={i} style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "16px", padding: "28px", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: "20px", right: "20px", background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "8px", padding: "4px 10px", fontSize: "12px", fontWeight: 700, color: "var(--green)" }}>{t.savings}</div>
                <div style={{ display: "flex", gap: "6px", marginBottom: "16px" }}>
                  {[...Array(5)].map((_, j) => <span key={j} style={{ color: "#fbbf24", fontSize: "14px" }}>★</span>)}
                </div>
                <p style={{ fontSize: "14px", color: "var(--text-dim)", lineHeight: 1.7, marginBottom: "20px", fontStyle: "italic" }}>"{t.text}"</p>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", borderTop: "1px solid var(--border)", paddingTop: "16px" }}>
                  <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "linear-gradient(135deg, var(--green), #00d4ff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 800, color: "#000", flexShrink: 0, fontFamily: "var(--display)" }}>
                    {t.name.split(" ").map(n => n[0]).join("")}
                  </div>
                  <div>
                    <p style={{ fontSize: "14px", fontWeight: 700, color: "#fff", marginBottom: "2px" }}>{t.name}</p>
                    <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>{t.role}</p>
                  </div>
                  <span style={{ marginLeft: "auto", fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", borderRadius: "6px", padding: "3px 8px" }}>{t.provider}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── SECURITY AUDIT PRODUCT CARD ── */}
        <div style={{ marginBottom: "48px" }}>
          <div onClick={() => goTo("security_intro")}
            style={{ background: "linear-gradient(135deg, rgba(248,113,113,0.07), rgba(251,146,60,0.05))", border: "1.5px solid rgba(248,113,113,0.2)", borderRadius: "20px", padding: "28px 32px", cursor: "pointer", transition: "all 0.25s", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "24px", flexWrap: "wrap" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(248,113,113,0.45)"; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 16px 40px rgba(248,113,113,0.12)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(248,113,113,0.2)"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}>
            <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
              <div style={{ width: "52px", height: "52px", background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px", flexShrink: 0 }}>🛡</div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                  <span style={{ fontSize: "10px", fontWeight: 700, color: "#f87171", background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: "20px", padding: "2px 10px", letterSpacing: "1px" }}>NEW · FREE</span>
                  <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", letterSpacing: "1px" }}>CLOUD SECURITY AUDIT</span>
                </div>
                <h3 className="display" style={{ fontSize: "20px", fontWeight: 800, color: "#fff", letterSpacing: "-0.5px", marginBottom: "4px" }}>Find security vulnerabilities before attackers do</h3>
                <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.5 }}>16 checkpoints across IAM, network exposure, encryption & logging. Free. No account access. AI-generated remediation report.</p>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "10px", flexShrink: 0 }}>
              <div style={{ display: "flex", gap: "6px" }}>
                {["🔐 IAM", "🌐 Network", "🗄 Data", "📋 Logging"].map(tag => (
                  <span key={tag} style={{ fontSize: "11px", color: "#f87171", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.15)", borderRadius: "6px", padding: "3px 8px", whiteSpace: "nowrap" }}>{tag}</span>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#f87171", fontSize: "13px", fontWeight: 700 }}>
                Run Security Audit <span style={{ fontSize: "18px" }}>→</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── FREE vs PAID COMPARISON ── */}
        <div style={{ marginBottom: "90px" }}>
          <div style={{ textAlign: "center", marginBottom: "40px" }}>
            <p style={{ fontSize: "11px", letterSpacing: "3px", color: "var(--green)", fontWeight: 700, textTransform: "uppercase", marginBottom: "12px" }}>Free vs Blueprint</p>
            <h2 className="display" style={{ fontSize: "clamp(24px,3vw,38px)", fontWeight: 800, letterSpacing: "-1px", color: "#fff" }}>What do you actually get?</h2>
          </div>
          <div className="compare-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", maxWidth: "760px", margin: "0 auto" }}>

            {/* ── FREE card — fully clickable ── */}
            <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "20px", padding: "32px", display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "12px" }}>✅ Free Audit</div>
              <p className="display" style={{ fontSize: "28px", fontWeight: 800, color: "#fff", marginBottom: "4px" }}>$0</p>
              <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "24px" }}>Always free · No card needed</p>
              {[
                ["Issues checklist", true],
                ["Savings range estimate", true],
                ["Priority ranking", true],
                ["PDF export", true],
                ["CLI commands to fix", false],
                ["Terraform snippets", false],
                ["Step-by-step instructions", false],
                ["Verification commands", false],
              ].map(([f, included]) => (
                <div key={f} className={!included ? "hide-mobile" : ""} style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                  <span style={{ fontSize: "14px", width: "18px", textAlign: "center", flexShrink: 0, color: included ? "#4ade80" : "rgba(255,255,255,0.2)" }}>{included ? "✓" : "✗"}</span>
                  <span style={{ fontSize: "13px", color: included ? "var(--text-dim)" : "var(--text-muted)", opacity: included ? 1 : 0.4 }}>{f}</span>
                </div>
              ))}
              <div style={{ flex: 1 }} />
              <button
                className="glow-btn"
                onClick={() => goTo("intake")}
                style={{ background: "rgba(255,255,255,0.07)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "12px", padding: "14px", fontSize: "14px", fontWeight: 700, width: "100%", marginTop: "24px", cursor: "pointer", transition: "all 0.2s" }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
              >
                See What My Bill Is Hiding →
              </button>
            </div>

            {/* ── BLUEPRINT card — fully clickable ── */}
            <div style={{ background: "rgba(0,255,180,0.04)", border: "2px solid rgba(0,255,180,0.3)", borderRadius: "20px", padding: "32px", position: "relative", display: "flex", flexDirection: "column" }}>
              <div style={{ position: "absolute", top: "-1px", right: "24px", background: "var(--green)", color: "#000", fontSize: "10px", fontWeight: 800, padding: "4px 12px", borderRadius: "0 0 8px 8px", letterSpacing: "0.5px" }}>BEST VALUE</div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "12px" }}>⚡ AI Blueprint</div>
              <p className="display" style={{ fontSize: "28px", fontWeight: 800, color: "var(--green)", marginBottom: "4px" }}>{currency.blueprintPrice}</p>
              <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "24px" }}>One-time · Instant delivery</p>
              {[
                ["Issues checklist", true],
                ["Savings range estimate", true],
                ["Priority ranking", true],
                ["PDF export", true],
                ["CLI commands to fix", true],
                ["Terraform snippets", true],
                ["Step-by-step instructions", true],
                ["Verification commands", true],
              ].map(([f]) => (
                <div key={f} style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                  <span style={{ fontSize: "14px", color: "var(--green)", width: "18px", textAlign: "center", flexShrink: 0 }}>✓</span>
                  <span style={{ fontSize: "13px", color: "var(--text-dim)" }}>{f}</span>
                </div>
              ))}
              <div style={{ flex: 1 }} />
              <button
                className="glow-btn"
                onClick={() => goTo("intake")}
                style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "14px", fontSize: "14px", width: "100%", marginTop: "24px", boxShadow: "0 0 20px rgba(0,255,180,0.25)", cursor: "pointer" }}
              >
                Start Your AI Blueprint Audit →
              </button>
            </div>

          </div>
        </div>

        {/* ── FAQ ── */}
        <div style={{ marginBottom: "90px", maxWidth: "760px", margin: "0 auto 90px" }}>
          <div style={{ textAlign: "center", marginBottom: "40px" }}>
            <p style={{ fontSize: "11px", letterSpacing: "3px", color: "var(--green)", fontWeight: 700, textTransform: "uppercase", marginBottom: "12px" }}>Got questions?</p>
            <h2 className="display" style={{ fontSize: "clamp(24px,3vw,38px)", fontWeight: 800, letterSpacing: "-1px", color: "#fff" }}>Frequently asked</h2>
          </div>
          {FAQS.map((faq, i) => (
            <div key={i} style={{ background: "var(--bg2)", border: `1px solid ${openFaq === i ? "rgba(0,255,180,0.2)" : "var(--border)"}`, borderRadius: "14px", marginBottom: "10px", overflow: "hidden", transition: "border-color 0.2s" }}>
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                style={{ width: "100%", padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                <span style={{ fontSize: "15px", fontWeight: 600, color: openFaq === i ? "var(--green)" : "#fff", transition: "color 0.2s" }}>{faq.q}</span>
                <span style={{ fontSize: "18px", color: openFaq === i ? "var(--green)" : "var(--text-muted)", flexShrink: 0, transition: "all 0.2s", transform: openFaq === i ? "rotate(45deg)" : "none" }}>+</span>
              </button>
              {openFaq === i && (
                <div style={{ padding: "0 24px 20px", animation: "fadeUp 0.2s ease" }}>
                  <p style={{ fontSize: "14px", color: "var(--text-dim)", lineHeight: 1.75, borderTop: "1px solid var(--border)", paddingTop: "16px" }}>{faq.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ── BOTTOM CTA ── */}
        <div className="bottom-cta-pad" style={{ background: "linear-gradient(135deg, rgba(0,255,180,0.07) 0%, rgba(99,102,241,0.07) 100%)", border: "1px solid rgba(0,255,180,0.15)", borderRadius: "24px", padding: "64px 40px", textAlign: "center", marginBottom: "60px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: "-80px", left: "50%", transform: "translateX(-50%)", width: "400px", height: "400px", background: "radial-gradient(circle, rgba(0,255,180,0.06) 0%, transparent 70%)", borderRadius: "50%", pointerEvents: "none" }} />
          <p style={{ fontSize: "11px", letterSpacing: "3px", color: "var(--green)", fontWeight: 700, textTransform: "uppercase", marginBottom: "16px" }}>No credit card · No signup · Free forever</p>
          <h2 className="display" style={{ fontSize: "clamp(28px,3.5vw,48px)", fontWeight: 800, letterSpacing: "-1.5px", color: "#fff", marginBottom: "16px" }}>
            Your cloud bill has waste.<br />
            <span style={{ color: "var(--green)" }}>Find it in 15 minutes.</span>
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: "16px", marginBottom: "36px", maxWidth: "400px", margin: "0 auto 36px" }}>18 structured checks. Instant savings report. AI blueprint available the moment you see your results.</p>
          <button className="glow-btn" onClick={() => goTo("intake")}
            style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "14px", padding: "18px 48px", fontSize: "18px", boxShadow: "0 0 40px rgba(0,255,180,0.35)" }}>
            See What My Bill Is Hiding →
          </button>
          <p style={{ marginTop: "16px", fontSize: "12px", color: "var(--text-muted)" }}>Takes 15 minutes · 18 checkpoints · Average saving: 20–45% of monthly bill</p>
        </div>

        {/* ── ENGINEER TRUST SECTION ── */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "48px", marginBottom: "32px" }}>
          <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)", letterSpacing: "3px", textTransform: "uppercase", marginBottom: "24px", textAlign: "center" }}>Meet your engineer</p>
          <div className="consultant-grid" style={{ background: "var(--bg2)", border: "1px solid rgba(0,255,180,0.18)", borderRadius: "20px", overflow: "hidden", display: "grid", gridTemplateColumns: "1fr 1fr", boxShadow: "0 8px 40px rgba(0,0,0,0.4)" }}>
            <div style={{ background: "#0a0a14", padding: "36px 40px", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: "-40px", right: "-40px", width: "160px", height: "160px", background: "radial-gradient(circle, rgba(0,255,180,0.08) 0%, transparent 70%)", borderRadius: "50%", pointerEvents: "none" }} />
              <div style={{ width: "56px", height: "56px", borderRadius: "50%", background: "linear-gradient(135deg, var(--green), #00d4ff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", fontWeight: 800, color: "#000", marginBottom: "20px", boxShadow: "0 0 20px rgba(0,255,180,0.3)", fontFamily: "var(--display)" }}>SA</div>
              <h3 className="display" style={{ fontSize: "22px", fontWeight: 800, color: "#fff", letterSpacing: "-0.5px", marginBottom: "14px" }}>Samuel Ayodele Adomeh</h3>
              {["Certified Azure Architect Expert", "Certified Azure DevOps Expert", "Kubernetes · Terraform · Docker"].map(c => (
                <div key={c} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                  <span style={{ color: "var(--green)", fontSize: "13px" }}>✓</span>
                  <span style={{ fontSize: "13px", color: "var(--green)", fontWeight: 500 }}>{c}</span>
                </div>
              ))}
              <div style={{ marginTop: "16px", display: "flex", alignItems: "center", gap: "7px" }}>
                <span style={{ fontSize: "13px" }}>📍</span>
                <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>Wrocław, Poland · Remote Worldwide</span>
              </div>
            </div>
            <div style={{ padding: "36px 40px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {[
                  { icon: "🌐", label: "kloudaudit.eu", href: "https://kloudaudit.eu", color: "var(--green)" },
                  { icon: "✉️", label: "admin@kloudaudit.eu", href: "mailto:admin@kloudaudit.eu", color: "#00d4ff" },
                  { icon: "💼", label: "linkedin.com/in/samuel-ayodele-adomeh", href: "https://www.linkedin.com/in/samuel-ayodele-adomeh", color: "#0077b5" },
                  { icon: "💻", label: "github.com/leumasj", href: "https://github.com/leumasj", color: "var(--text-dim)" },
                  { icon: "🟢", label: "Hire me on Upwork · $8K+ earned · Top Rated", href: "https://www.upwork.com/freelancers/~015c346a56b09a2a89", color: "#14a34a" },
                ].map(link => (
                  <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" className="trust-link" style={{ "--hover-color": link.color }}>
                    <span style={{ fontSize: "16px" }}>{link.icon}</span>
                    <span style={{ fontSize: "13px", color: link.color, fontWeight: 500 }}>{link.label}</span>
                  </a>
                ))}
              </div>
              <div style={{ marginTop: "24px", background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "12px", padding: "20px" }}>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "6px" }}>Need hands-on implementation?</p>
                <p className="display" style={{ fontSize: "18px", fontWeight: 800, color: "var(--green)", letterSpacing: "-0.3px", marginBottom: "6px" }}>{`Sessions from ${currency.sessionPrice}`}</p>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "14px" }}>Remote · Delivered within 48hrs · Full docs included</p>
                <button className="glow-btn" onClick={() => setShowBooking(true)} style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "9px", padding: "11px 22px", fontSize: "13px", width: "100%", boxShadow: "0 0 16px rgba(0,255,180,0.25)" }}>Book a Session →</button>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px", marginTop: "32px", paddingTop: "24px", borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{ width: "24px", height: "24px", background: "var(--green)", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 10px rgba(0,255,180,0.3)", fontSize: "12px" }}>⚡</div>
              <span className="display" style={{ fontWeight: 800, fontSize: "14px", color: "#fff" }}>KloudAudit</span>
              <span style={{ color: "var(--text-muted)", fontSize: "13px" }}>© {new Date().getFullYear()}</span>
            </div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
              {[{ label: "LinkedIn", href: "https://www.linkedin.com/in/samuel-ayodele-adomeh" }, { label: "GitHub", href: "https://github.com/leumasj" }].map(s => (
                <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-muted)", textDecoration: "none", padding: "6px 14px", border: "1px solid var(--border)", borderRadius: "8px", background: "rgba(255,255,255,0.03)" }}>
                  {s.label}
                </a>
              ))}
              <a href="https://www.upwork.com/freelancers/~015c346a56b09a2a89" target="_blank" rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: 700, color: "#14a34a", textDecoration: "none", padding: "6px 14px", border: "1px solid rgba(20,163,74,0.3)", borderRadius: "8px", background: "rgba(20,163,74,0.08)" }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M18.561 13.158c-1.102 0-2.135-.467-3.074-1.227l.228-1.076.008-.042c.207-1.143.849-3.06 2.839-3.06 1.492 0 2.703 1.212 2.703 2.703-.001 1.489-1.212 2.702-2.704 2.702zm0-8.14c-2.539 0-4.51 1.649-5.31 4.366-1.22-1.834-2.148-4.036-2.687-5.892H7.828v7.112c-.002 1.406-1.141 2.546-2.547 2.546-1.405 0-2.543-1.14-2.543-2.546V3.492H0v7.112c0 2.914 2.37 5.303 5.281 5.303 2.913 0 5.283-2.389 5.283-5.303v-1.19c.529 1.107 1.182 2.229 1.974 3.221l-1.673 7.873h2.797l1.213-5.71c1.063.679 2.285 1.109 3.686 1.109 3 0 5.439-2.452 5.439-5.45 0-3-2.439-5.439-5.439-5.439z"/></svg>
                Upwork · $8K+ earned
              </a>
            </div>
          </div>
        </div>

      </div>
    </div>
    );
  }


  // ── INTAKE ─────────────────────────────────────────────────────────────────
  if (step === "intake") return (
    <div className="app">
      <style>{globalCss}</style>
      <ParticleBackground />
      {showContact && <ContactModal />}
      {showBooking && <BookingModal />}
      {showBlueprint && <BlueprintModal />}
      <Nav showBack onBack={() => goTo("intro")} />
      <div key={pageKey} style={{ maxWidth: "540px", margin: "0 auto", padding: "60px 24px", position: "relative", zIndex: 1 }}>
        <div className="fade-up">
          <h2 className="display" style={{ fontSize: "36px", fontWeight: 800, letterSpacing: "-1.5px", color: "#fff", marginBottom: "8px" }}>Set up your audit</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "15px", marginBottom: "40px" }}>30 seconds. We'll tailor savings estimates to your actual spend.</p>
        </div>
        <div className="fade-up stagger-1" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--green)", marginBottom: "10px", letterSpacing: "1px", textTransform: "uppercase" }}>Company or project</label>
            <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. Acme Corp" style={{ width: "100%", padding: "14px 18px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "12px", color: "#fff", fontSize: "15px", transition: "all 0.2s" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--green)", marginBottom: "10px", letterSpacing: "1px", textTransform: "uppercase" }}>Cloud provider</label>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {PROVIDERS.map(p => (
                <button key={p} className="provider-chip" onClick={() => setProvider(p)} style={{ padding: "10px 20px", borderRadius: "10px", fontSize: "14px", fontWeight: 600, border: `1.5px solid ${provider === p ? "var(--green)" : "var(--border)"}`, background: provider === p ? "var(--green-dim)" : "rgba(255,255,255,0.03)", color: provider === p ? "var(--green)" : "var(--text-muted)" }}>{p}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--green)", marginBottom: "10px", letterSpacing: "1px", textTransform: "uppercase" }}>Monthly cloud bill (USD)</label>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: "18px", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", fontSize: "16px", fontWeight: 700 }}>$</span>
              <input type="number" value={monthlyBill} onChange={e => setMonthlyBill(e.target.value)} placeholder="3,500" style={{ width: "100%", padding: "14px 18px 14px 34px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "12px", color: "#fff", fontSize: "15px", transition: "all 0.2s" }} />
            </div>
            {bill > 0 && (
              <div style={{ marginTop: "10px", padding: "12px 16px", background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "10px", fontSize: "13px", color: "var(--green)", fontWeight: 600 }}>
                💰 Typical savings: <strong>${Math.round(bill * 0.20).toLocaleString()} – ${Math.round(bill * 0.45).toLocaleString()}/mo</strong> based on 18 audit checks
              </div>
            )}
          </div>
          <button className="glow-btn" disabled={!provider || !monthlyBill} onClick={() => { setActiveSection(0); goTo("audit"); }}
            style={{ background: provider && monthlyBill ? "var(--green)" : "rgba(255,255,255,0.06)", color: provider && monthlyBill ? "#000" : "var(--text-muted)", border: "none", borderRadius: "12px", padding: "16px", fontSize: "15px", boxShadow: provider && monthlyBill ? "0 0 24px rgba(0,255,180,0.3)" : "none", cursor: provider && monthlyBill ? "pointer" : "not-allowed", marginTop: "8px" }}>
            Begin Audit →
          </button>
        </div>
      </div>
    </div>
  );

  // ── AUDIT ──────────────────────────────────────────────────────────────────
  if (step === "audit") {
    const section = AUDIT_SECTIONS[activeSection];
    return (
      <div className="app">
        <style>{globalCss}</style>
        <ParticleBackground />
        {showContact && <ContactModal />}
        {showBooking && <BookingModal />}
        {showBlueprint && <BlueprintModal />}
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
          <div className="audit-grid" style={{ display: "grid", gridTemplateColumns: "1fr 290px", gap: "24px", alignItems: "start" }}>
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
                        {on && <svg width="12" height="9" viewBox="0 0 12 9" fill="none"><path d="M1 4L4.5 7.5L11 1" stroke="#000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
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
                {activeSection > 0 && <button className="ghost-btn" onClick={() => setActiveSection(a => a - 1)} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: "10px", padding: "12px 22px", fontSize: "14px", fontWeight: 600, color: "var(--text-muted)" }}>← Previous</button>}
                {activeSection < AUDIT_SECTIONS.length - 1 ? (
                  <button className="glow-btn" onClick={() => setActiveSection(a => a + 1)} style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "10px", padding: "12px 28px", fontSize: "14px", boxShadow: "0 0 20px rgba(0,255,180,0.25)" }}>Next: {AUDIT_SECTIONS[activeSection + 1].label} →</button>
                ) : (
                  <button className="glow-btn" onClick={() => goTo("email_gate")} style={{ background: "linear-gradient(135deg, var(--green), #00d4ff)", color: "#000", border: "none", borderRadius: "10px", padding: "12px 32px", fontSize: "14px", boxShadow: "0 0 24px rgba(0,255,180,0.3)" }}>Generate Report →</button>
                )}
              </div>
            </div>
            {/* Sidebar */}
            <div className="audit-sidebar" style={{ position: "sticky", top: "76px", display: "flex", flexDirection: "column", gap: "14px" }}>
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
                      <div style={{ height: "100%", width: `${Math.min(savPct * 2, 100)}%`, background: "linear-gradient(90deg,var(--green),#00d4ff)", borderRadius: "3px", transition: "width 0.5s ease", boxShadow: "0 0 6px rgba(0,255,180,0.5)" }} />
                    </div>
                    <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>Annual: <span style={{ color: "var(--green)", fontWeight: 700 }}>${(savMin * 12).toLocaleString()} – ${(savMax * 12).toLocaleString()}</span></p>
                  </>
                ) : (
                  <div style={{ textAlign: "center", padding: "16px 0", color: "var(--text-muted)", fontSize: "13px" }}>Flag issues above to see your estimate</div>
                )}
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: "14px", marginTop: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  {[["Issues flagged", flagged.length, flagged.length > 0 ? "#f87171" : "var(--text-muted)"], ["Checks reviewed", `${Object.keys(checked).length}/${allChecks.length}`, "var(--text-dim)"], ["Progress", `${progress}%`, "var(--green)"]].map(([l, v, c]) => (
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
                  const pct = Math.round((done / s.checks.length) * 100);
                  return (
                    <div key={s.id} onClick={() => setActiveSection(i)} style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", cursor: "pointer", opacity: i === activeSection ? 1 : 0.6, transition: "opacity 0.15s" }}>
                      <span style={{ fontSize: "14px", width: "18px" }}>{s.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                          <span style={{ fontSize: "11px", fontWeight: 600, color: i === activeSection ? "var(--green)" : "var(--text-dim)" }}>{s.label}</span>
                          <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{done}/{s.checks.length}</span>
                        </div>
                        <div style={{ height: "3px", background: "rgba(255,255,255,0.06)", borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: i === activeSection ? "var(--green)" : "#4ade80", borderRadius: "2px", transition: "width 0.3s" }} />
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

  // ── REPORT ─────────────────────────────────────────────────────────────────

  // ── EMAIL GATE STEP ──────────────────────────────────────────────────────────
  if (step === "email_gate") {
    const handleGateSubmit = async (e) => {
      e.preventDefault();
      if (!gateEmail) { goTo("report"); return; }
      setGateSending(true);
      try {
        await fetch("https://formspree.io/f/mlgarana", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: gateEmail,
            provider: provider || "Unknown",
            monthlyBill: bill,
            savingsMin: savMin,
            savingsMax: savMax,
            flaggedCount: flagged.length,
            source: "audit_completion",
            _subject: `New audit lead — ${gateEmail} · ${provider} · $${savMin.toLocaleString()}–$${savMax.toLocaleString()}/mo`,
          }),
        });
      } catch (_) {}
      setGateSubmitted(true);
      setGateSending(false);
      setTimeout(() => goTo("report"), 800);
    };

    return (
      <div className="app" style={{ minHeight: "100vh", background: "#07070f", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
        <style>{globalCss}</style>
        <div style={{ maxWidth: "460px", width: "100%", animation: "scaleIn 0.4s cubic-bezier(0.34,1.56,0.64,1)" }}>

          {/* Savings teaser */}
          <div style={{ background: "linear-gradient(135deg, rgba(0,255,180,0.12), rgba(99,102,241,0.10))", border: "1.5px solid #00ffb4", borderRadius: "20px", padding: "28px", marginBottom: "20px", textAlign: "center" }}>
            <p style={{ fontSize: "11px", fontWeight: 700, color: "#00ffb4", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "12px" }}>✅ Your audit is ready</p>
            <div style={{ fontSize: "48px", fontWeight: 800, color: "#00ffb4", letterSpacing: "-2px", lineHeight: 1, marginBottom: "8px", fontFamily: "system-ui, sans-serif" }}>
              ${savMin.toLocaleString()}–${savMax.toLocaleString()}
            </div>
            <p style={{ fontSize: "15px", color: "#94a3b8", marginBottom: "16px" }}>
              estimated monthly savings · <strong style={{ color: "#f8fafc" }}>{flagged.length} issues found</strong>
            </p>
            <div style={{ display: "flex", gap: "6px", justifyContent: "center", flexWrap: "wrap" }}>
              {flagged.slice(0, 3).map((f, i) => (
                <span key={i} style={{ fontSize: "11px", color: "#cbd5e1", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", padding: "4px 10px" }}>{f.label}</span>
              ))}
              {flagged.length > 3 && <span style={{ fontSize: "11px", color: "#94a3b8", padding: "4px 10px" }}>+{flagged.length - 3} more</span>}
            </div>
          </div>

          {/* Email capture card */}
          <div style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "20px", padding: "32px", boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}>
            {gateSubmitted ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ fontSize: "48px", marginBottom: "14px" }}>✅</div>
                <p style={{ color: "#00ffb4", fontWeight: 800, fontSize: "20px", marginBottom: "6px" }}>Done — loading your report…</p>
              </div>
            ) : (
              <>
                <h3 style={{ fontSize: "22px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-0.5px", marginBottom: "8px", fontFamily: "system-ui, sans-serif" }}>
                  Where should we send your report?
                </h3>
                <p style={{ fontSize: "14px", color: "#94a3b8", lineHeight: 1.65, marginBottom: "24px" }}>
                  We'll email you a copy so you can share it with your team or revisit later. Takes 2 seconds.
                </p>
                <form onSubmit={handleGateSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <input
                    type="email"
                    value={gateEmail}
                    onChange={e => setGateEmail(e.target.value)}
                    placeholder="you@company.com"
                    autoFocus
                    style={{
                      width: "100%", padding: "14px 16px",
                      background: "#1e293b",
                      border: "1.5px solid rgba(255,255,255,0.2)",
                      borderRadius: "10px",
                      color: "#f8fafc",
                      fontSize: "16px",
                      fontFamily: "system-ui, sans-serif",
                      outline: "none",
                      boxSizing: "border-box",
                      WebkitTextFillColor: "#f8fafc",
                      caretColor: "#00ffb4",
                    }}
                    onFocus={e => e.target.style.borderColor = "#00ffb4"}
                    onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.2)"}
                  />
                  <button type="submit" disabled={gateSending} style={{
                    width: "100%", padding: "15px",
                    borderRadius: "10px", border: "none",
                    background: "#00ffb4", color: "#000",
                    fontWeight: 800, fontSize: "16px",
                    cursor: gateSending ? "not-allowed" : "pointer",
                    boxShadow: "0 4px 24px rgba(0,255,180,0.35)",
                    fontFamily: "system-ui, sans-serif",
                    opacity: gateSending ? 0.7 : 1,
                  }}>
                    {gateSending ? "Saving…" : "Send Me the Report →"}
                  </button>
                  <button type="button" onClick={() => goTo("report")} style={{
                    width: "100%", padding: "12px", borderRadius: "10px",
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "transparent", color: "#64748b",
                    fontSize: "14px", cursor: "pointer",
                    fontFamily: "system-ui, sans-serif",
                  }}
                    onMouseEnter={e => { e.target.style.color = "#f8fafc"; e.target.style.borderColor = "rgba(255,255,255,0.2)"; }}
                    onMouseLeave={e => { e.target.style.color = "#64748b"; e.target.style.borderColor = "rgba(255,255,255,0.08)"; }}>
                    Skip — just show me the report
                  </button>
                </form>
                <p style={{ fontSize: "12px", color: "#475569", textAlign: "center", marginTop: "16px" }}>
                  🔒 No spam. No marketing. We use this only to send your report.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (step === "report") {
    const getSev = c => { const p = (c.savingsRange[0] + c.savingsRange[1]) / 2; return p >= 30 ? "high" : p >= 15 ? "med" : "low"; };
    const high = flagged.filter(c => getSev(c) === "high");
    const med = flagged.filter(c => getSev(c) === "med");
    const low = flagged.filter(c => getSev(c) === "low");
    return (
      <div className="app">
        <style>{globalCss}</style>
        <ParticleBackground />
        {showContact && <ContactModal />}
        {showBooking && <BookingModal />}
        {showBlueprint && <BlueprintModal />}
        <Nav showBack onBack={() => goTo("audit")} />
        <div key={pageKey} style={{ maxWidth: "900px", margin: "0 auto", padding: "48px 24px 80px", position: "relative", zIndex: 1 }}>
          {/* Header */}
          <div className="fade-up" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "40px", flexWrap: "wrap", gap: "16px" }}>
            <div>
              <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
                {[companyName || "Cloud Audit", provider, new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })].map(t => (
                  <span key={t} style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-dim)", fontSize: "12px", fontWeight: 600, padding: "4px 12px", borderRadius: "20px", border: "1px solid var(--border)" }}>{t}</span>
                ))}
              </div>
              <h1 className="display" style={{ fontSize: "clamp(28px,4vw,46px)", fontWeight: 800, letterSpacing: "-1.5px", color: "#fff" }}>Cost Optimisation Report</h1>
              <p style={{ color: "var(--text-muted)", fontSize: "15px", marginTop: "8px" }}>
                {flagged.length > 0 ? `${flagged.length} issues found · Estimated ${savPct}% waste rate` : "No issues found — well optimised infrastructure."}
              </p>
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button className="ghost-btn" onClick={() => window.print()} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: "10px", padding: "10px 18px", fontSize: "13px", fontWeight: 600, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "6px" }}>🖨 Export</button>
              <button className="glow-btn" onClick={() => { setChecked({}); setActiveSection(0); goTo("audit"); }} style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "10px", padding: "10px 20px", fontSize: "13px", boxShadow: "0 0 16px rgba(0,255,180,0.25)" }}>Re-run</button>
            </div>
          </div>

          {/* KPI cards */}
          {bill > 0 && (
            <div className="fade-up stagger-1" className="kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "14px", marginBottom: "32px" }}>
              {[
                { l: "Monthly Savings", v: `$${savMin.toLocaleString()} – $${savMax.toLocaleString()}`, s: "/month", c: "var(--green)", bg: "var(--green-dim)", b: "var(--green-border)" },
                { l: "Annual Opportunity", v: `$${(savMin * 12).toLocaleString()}+`, s: "per year", c: "#818cf8", bg: "rgba(99,102,241,0.08)", b: "rgba(99,102,241,0.2)" },
                { l: "Waste Rate", v: `~${savPct}%`, s: savPct >= 30 ? "Critical" : savPct >= 15 ? "Significant" : "Moderate", c: savPct >= 30 ? "#f87171" : savPct >= 15 ? "#fb923c" : "#fbbf24", bg: "rgba(248,113,113,0.06)", b: "rgba(248,113,113,0.15)" },
                { l: "Issues Found", v: flagged.length, s: `of ${allChecks.length} checked`, c: "#fb923c", bg: "rgba(251,146,60,0.06)", b: "rgba(251,146,60,0.15)" },
              ].map(s => (
                <div key={s.l} style={{ background: s.bg, border: `1px solid ${s.b}`, borderRadius: "14px", padding: "22px" }}>
                  <p style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "1.2px", marginBottom: "10px" }}>{s.l}</p>
                  <p className="display" style={{ fontSize: "22px", fontWeight: 800, color: s.c, letterSpacing: "-0.5px", lineHeight: 1 }}>{s.v}</p>
                  <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "5px" }}>{s.s}</p>
                </div>
              ))}
            </div>
          )}


          {/* ── WASTE SCORE ── */}
          {bill > 0 && flagged.length > 0 && (() => {
            const score = Math.max(0, Math.min(100, Math.round(100 - savPct)));
            const grade = score >= 80 ? { label: "Well Optimised", color: "#4ade80", bg: "rgba(74,222,128,0.08)", border: "rgba(74,222,128,0.25)", desc: "Your infrastructure is in good shape. A few quick wins remain.", emoji: "🟢" }
              : score >= 60 ? { label: "Needs Attention", color: "#fbbf24", bg: "rgba(251,191,36,0.08)", border: "rgba(251,191,36,0.25)", desc: "Meaningful waste detected. Fixable without architecture changes.", emoji: "🟡" }
              : score >= 40 ? { label: "Significant Waste", color: "#fb923c", bg: "rgba(251,146,60,0.08)", border: "rgba(251,146,60,0.25)", desc: "Your bill is substantially higher than it needs to be. Act now.", emoji: "🟠" }
              : { label: "Critical Overspend", color: "#f87171", bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.25)", desc: "Serious waste across multiple categories. Every week costs you.", emoji: "🔴" };

            return (
              <div className="fade-up stagger-1" style={{ background: grade.bg, border: `1px solid ${grade.border}`, borderRadius: "20px", padding: "28px 32px", marginBottom: "28px", display: "flex", alignItems: "center", gap: "28px", flexWrap: "wrap" }}>
                {/* Score circle */}
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <svg width="110" height="110" viewBox="0 0 110 110">
                    <circle cx="55" cy="55" r="46" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
                    <circle cx="55" cy="55" r="46" fill="none" stroke={grade.color} strokeWidth="10"
                      strokeDasharray={`${2 * Math.PI * 46}`}
                      strokeDashoffset={`${2 * Math.PI * 46 * (1 - score / 100)}`}
                      strokeLinecap="round"
                      transform="rotate(-90 55 55)"
                      style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)" }}
                    />
                    <text x="55" y="50" textAnchor="middle" fill="#fff" fontSize="22" fontWeight="800" fontFamily="var(--display)">{score}</text>
                    <text x="55" y="66" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="10">/100</text>
                  </svg>
                </div>
                {/* Score details */}
                <div style={{ flex: 1, minWidth: "200px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "2px", textTransform: "uppercase" }}>KloudAudit Waste Score</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                    <span style={{ fontSize: "22px" }}>{grade.emoji}</span>
                    <span className="display" style={{ fontSize: "26px", fontWeight: 800, color: grade.color, letterSpacing: "-0.5px" }}>{grade.label}</span>
                  </div>
                  <p style={{ fontSize: "14px", color: "var(--text-muted)", lineHeight: 1.6, marginBottom: "14px" }}>{grade.desc}</p>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "12px", color: "var(--text-muted)", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "6px", padding: "3px 10px" }}>~{savPct}% waste rate</span>
                    <span style={{ fontSize: "12px", color: "var(--text-muted)", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "6px", padding: "3px 10px" }}>{flagged.length} of {allChecks.length} checks flagged</span>
                    <span style={{ fontSize: "12px", color: "var(--text-muted)", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "6px", padding: "3px 10px" }}>${savMin.toLocaleString()}–${savMax.toLocaleString()}/mo recoverable</span>
                  </div>
                </div>
                {/* Share nudge */}
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-end" }}>
                  <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", textAlign: "right", maxWidth: "140px", lineHeight: 1.4 }}>Share your score with your team or on LinkedIn</p>
                  <button onClick={() => setShowShareCard(true)}
                    style={{ display: "flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "8px 14px", color: "rgba(255,255,255,0.6)", fontSize: "12px", fontWeight: 700, cursor: "pointer", transition: "all 0.2s", whiteSpace: "nowrap" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "#fff"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}>
                    📤 Share Score
                  </button>
                </div>
              </div>
            );
          })()}


          {/* ── WASTE SCORE ────────────────────────────────────────────────────── */}
          {bill > 0 && flagged.length > 0 && (() => {
            // Score: 100 = perfectly clean, 0 = catastrophic waste
            // Derived from waste pct + issue count weighting
            const issueWeight = Math.min(flagged.length / allChecks.length, 1) * 30;
            const pctWeight   = Math.min(savPct / 50, 1) * 70;
            const rawScore    = Math.round(100 - issueWeight - pctWeight);
            const score       = Math.max(0, Math.min(100, rawScore));
            const grade       = score >= 80 ? { label: "Well Optimised",    color: "#4ade80", ring: "#4ade80" }
                              : score >= 60 ? { label: "Needs Attention",   color: "#fbbf24", ring: "#fbbf24" }
                              : score >= 40 ? { label: "Significant Waste", color: "#fb923c", ring: "#fb923c" }
                              :               { label: "Critical Waste",    color: "#f87171", ring: "#f87171" };
            const circumference = 2 * Math.PI * 54;
            const dashOffset    = circumference * (1 - score / 100);

            return (
              <div className="fade-up" style={{ background: "var(--bg2)", border: `1px solid ${grade.ring}30`, borderRadius: "20px", padding: "36px", marginBottom: "24px", display: "flex", alignItems: "center", gap: "40px", flexWrap: "wrap" }}>
                {/* Score ring */}
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <svg width="130" height="130" style={{ transform: "rotate(-90deg)" }}>
                    <circle cx="65" cy="65" r="54" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
                    <circle cx="65" cy="65" r="54" fill="none"
                      stroke={grade.ring} strokeWidth="10"
                      strokeDasharray={circumference}
                      strokeDashoffset={dashOffset}
                      strokeLinecap="round"
                      style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)", filter: `drop-shadow(0 0 8px ${grade.ring}60)` }}
                    />
                  </svg>
                  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                    <span className="display" style={{ fontSize: "32px", fontWeight: 800, color: grade.color, letterSpacing: "-1px", lineHeight: 1 }}>{score}</span>
                    <span style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 600, letterSpacing: "1px" }}>/ 100</span>
                  </div>
                </div>

                {/* Score details */}
                <div style={{ flex: 1, minWidth: "200px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                    <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", letterSpacing: "2px", textTransform: "uppercase" }}>KloudAudit Waste Score</p>
                  </div>
                  <h2 className="display" style={{ fontSize: "28px", fontWeight: 800, color: grade.color, letterSpacing: "-0.8px", marginBottom: "8px" }}>{grade.label}</h2>
                  <p style={{ fontSize: "14px", color: "var(--text-muted)", lineHeight: 1.65, marginBottom: "16px" }}>
                    {score >= 80
                      ? `Your infrastructure is well managed. The ${flagged.length} issue${flagged.length > 1 ? "s" : ""} found are optimisation opportunities rather than critical problems.`
                      : score >= 60
                      ? `Your bill has identifiable waste that should be addressed. The ${flagged.length} flagged issue${flagged.length > 1 ? "s" : ""} represent ~${savPct}% of your monthly spend.`
                      : score >= 40
                      ? `Significant waste detected. Your team is paying roughly $${savMin.toLocaleString()}–$${savMax.toLocaleString()}/month more than necessary. This is fixable.`
                      : `Critical waste level. At your current bill size, unaddressed issues are costing $${(savMin * 12).toLocaleString()}+ per year. Immediate action recommended.`
                    }
                  </p>
                  {/* Benchmark bar */}
                  <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: "8px", padding: "12px 16px", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <p style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "8px", fontWeight: 600 }}>Industry benchmark comparison</p>
                    <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                      {[
                        { range: "0–39", label: "Critical", color: "#f87171", active: score < 40 },
                        { range: "40–59", label: "Poor",     color: "#fb923c", active: score >= 40 && score < 60 },
                        { range: "60–79", label: "Fair",     color: "#fbbf24", active: score >= 60 && score < 80 },
                        { range: "80–100",label: "Good",     color: "#4ade80", active: score >= 80 },
                      ].map(b => (
                        <div key={b.range} style={{ flex: 1, height: "6px", borderRadius: "3px", background: b.active ? b.color : `${b.color}30`, boxShadow: b.active ? `0 0 8px ${b.color}60` : "none", transition: "all 0.3s" }} />
                      ))}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px" }}>
                      <span style={{ fontSize: "10px", color: "#f87171" }}>Critical</span>
                      <span style={{ fontSize: "10px", color: "#4ade80" }}>Good</span>
                    </div>
                  </div>
                </div>

                {/* Share score CTA */}
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", flexShrink: 0 }}>
                  <button onClick={() => setShowShareCard(true)}
                    style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: "10px", padding: "10px 18px", color: "#a5b4fc", fontSize: "13px", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                    📤 Share Score
                  </button>
                  <p style={{ fontSize: "10px", color: "var(--text-muted)", textAlign: "center" }}>Share on LinkedIn</p>
                </div>
              </div>
            );
          })()}

          {/* Findings */}
          <div className="fade-up stagger-2">
            {[{ label: "🔴 Critical & High Impact", items: high, color: "#f87171" }, { label: "🟡 Medium Impact", items: med, color: "#fbbf24" }, { label: "🟢 Quick Wins", items: low, color: "#4ade80" }].filter(g => g.items.length > 0).map(group => (
              <div key={group.label} style={{ marginBottom: "28px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                  <h3 className="display" style={{ fontSize: "15px", fontWeight: 700, color: group.color }}>{group.label}</h3>
                  <span style={{ background: `${group.color}15`, color: group.color, fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "10px" }}>{group.items.length}</span>
                </div>
                {group.items.map(check => {
                  const sMin2 = bill > 0 ? Math.round(bill * check.savingsRange[0] / 100) : null;
                  const sMax2 = bill > 0 ? Math.round(bill * check.savingsRange[1] / 100) : null;
                  return (
                    <div key={check.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", borderLeft: `3px solid ${group.color}`, borderRadius: "0 12px 12px 0", padding: "16px 20px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                      <div>
                        <p style={{ fontWeight: 600, fontSize: "15px", color: "#fff", marginBottom: "4px" }}>{check.label}</p>
                        <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>{check.detail}</p>
                      </div>
                      {bill > 0 && <div style={{ background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "8px", padding: "8px 14px", textAlign: "right", flexShrink: 0 }}>
                        <p style={{ fontSize: "14px", fontWeight: 700, color: "var(--green)" }}>${sMin2?.toLocaleString()} – ${sMax2?.toLocaleString()}</p>
                        <p style={{ fontSize: "10px", color: "var(--text-muted)" }}>/ month</p>
                      </div>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Action plan */}
          <div className="fade-up stagger-3" style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "16px", padding: "28px", marginBottom: "24px" }}>
            <h3 className="display" style={{ fontSize: "18px", fontWeight: 700, marginBottom: "20px", color: "#fff", letterSpacing: "-0.3px" }}>Recommended action plan</h3>
            {[
              high.length > 0 && { n: 1, t: "Tackle critical & high-impact findings first — fastest ROI with least risk.", c: "#f87171" },
              { n: 2, t: "Set billing alerts at 80% and 100% of your monthly target in your cloud console today.", c: "var(--green)" },
              { n: 3, t: "Implement auto-shutdown for dev/staging outside business hours.", c: "var(--green)" },
              { n: 4, t: "Run a rightsizing review using your provider's native tooling (Compute Optimizer / GCP Recommender).", c: "#818cf8" },
              { n: 5, t: "Revisit this audit in 30 days after changes are applied to measure real impact.", c: "var(--text-dim)" },
            ].filter(Boolean).map(item => (
              <div key={item.n} style={{ display: "flex", gap: "14px", alignItems: "flex-start", marginBottom: "14px" }}>
                <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: `${item.c}15`, border: `1.5px solid ${item.c}40`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span className="display" style={{ fontSize: "12px", fontWeight: 800, color: item.c }}>{item.n}</span>
                </div>
                <p style={{ fontSize: "14px", color: "var(--text-dim)", lineHeight: 1.65, paddingTop: "4px" }}>{item.t}</p>
              </div>
            ))}
          </div>


          {/* ── 1. LIVE AI PREVIEW ─────────────────────────────────────────────── */}
          {flagged.length > 0 && (
            <div className="fade-up stagger-3" style={{ marginBottom: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: "7px", background: "rgba(0,255,180,0.1)", border: "1px solid rgba(0,255,180,0.25)", borderRadius: "20px", padding: "4px 14px" }}>
                  <span style={{ width: "6px", height: "6px", background: "var(--green)", borderRadius: "50%", animation: "pulse-dot 2s infinite" }} />
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)", letterSpacing: "1px" }}>AI PREVIEW — FIX #{flagged[0]?.label}</span>
                </div>
              </div>

              <div style={{ background: "var(--bg2)", border: "1px solid rgba(0,255,180,0.15)", borderRadius: "16px", overflow: "hidden" }}>
                {/* First fix — fully unlocked */}
                <div style={{ padding: "24px 28px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ background: "rgba(0,255,180,0.12)", border: "1px solid rgba(0,255,180,0.3)", borderRadius: "6px", padding: "3px 10px", fontSize: "11px", fontWeight: 700, color: "var(--green)" }}>Fix 1 of {flagged.length} — FREE PREVIEW</span>
                      <span style={{ fontSize: "13px", fontWeight: 600, color: "#fff" }}>{flagged[0]?.label}</span>
                    </div>
                    <span style={{ fontSize: "11px", color: "#4ade80", fontWeight: 600 }}>✓ Unlocked</span>
                  </div>

                  {aiPreviewLoading && (
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "20px 0", color: "var(--text-muted)" }}>
                      <span style={{ display: "inline-block", width: "16px", height: "16px", border: "2px solid rgba(0,255,180,0.3)", borderTopColor: "var(--green)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                      <span style={{ fontSize: "13px" }}>Claude AI is generating your fix…</span>
                    </div>
                  )}

                  {aiPreview && !aiPreviewLoading && (
                    <div style={{ fontFamily: "monospace", fontSize: "13px", lineHeight: 1.7 }}>
                      {aiPreview.split("\n").map((line, i) => {
                        if (line.startsWith("## ")) return <p key={i} style={{ fontWeight: 700, color: "var(--green)", fontSize: "12px", letterSpacing: "1px", textTransform: "uppercase", marginTop: "16px", marginBottom: "6px" }}>{line.replace("## ", "")}</p>;
                        if (line.startsWith("```")) return null;
                        if (line.startsWith("#") && !line.startsWith("##")) return <p key={i} style={{ color: "#6ee7b7", fontSize: "12px" }}>{line}</p>;
                        return line.trim() ? <p key={i} style={{ color: line.startsWith(" ") || line.startsWith("aws") || line.startsWith("resource") || line.startsWith("terraform") ? "#93c5fd" : "var(--text-dim)", fontFamily: line.startsWith(" ") || line.startsWith("aws") ? "monospace" : "var(--body)", background: line.startsWith(" ") || line.startsWith("aws") || line.startsWith("resource") ? "rgba(147,197,253,0.06)" : "transparent", padding: line.startsWith(" ") || line.startsWith("aws") ? "2px 8px" : "0", borderRadius: "4px", marginBottom: "2px" }}>{line}</p> : <br key={i} />;
                      })}
                    </div>
                  )}

                  {!aiPreview && !aiPreviewLoading && (
                    <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>Fix preview unavailable — get the full Blueprint for all {flagged.length} fixes.</p>
                  )}
                </div>

                {/* Remaining fixes — locked */}
                {flagged.slice(1).map((f, i) => (
                  <div key={f.id} style={{ padding: "16px 28px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", justifyContent: "space-between", alignItems: "center", filter: "blur(0px)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", borderRadius: "6px", padding: "3px 10px", fontSize: "11px", fontWeight: 700, color: "var(--text-muted)" }}>Fix {i + 2} of {flagged.length}</span>
                      <span style={{ fontSize: "13px", color: "var(--text-muted)", filter: "blur(3px)", userSelect: "none" }}>{f.label}</span>
                    </div>
                    <span style={{ fontSize: "11px", color: "#f87171", fontWeight: 600 }}>🔒 Blueprint only</span>
                  </div>
                ))}

                {/* Unlock CTA inside preview */}
                {flagged.length > 1 && (
                  <div style={{ padding: "20px 28px", background: "rgba(0,255,180,0.04)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
                    <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                      <strong style={{ color: "#fff" }}>{flagged.length - 1} more fixes</strong> with exact CLI commands, Terraform snippets, and verification steps
                    </p>
                    <button onClick={() => setShowBlueprint(true)}
                      style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "10px", padding: "10px 22px", fontSize: "13px", fontWeight: 800, cursor: "pointer", boxShadow: "0 0 20px rgba(0,255,180,0.3)", whiteSpace: "nowrap" }}>
                      {`Unlock all fixes — ${currency.blueprintPrice} →`}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── 2. VERIFY IT YOURSELF ─────────────────────────────────────────── */}
          {flagged.length > 0 && (
            <div className="fade-up stagger-3" style={{ background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: "16px", padding: "24px 28px", marginBottom: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                <span style={{ fontSize: "16px" }}>🔍</span>
                <h3 className="display" style={{ fontSize: "15px", fontWeight: 700, color: "#a5b4fc" }}>Don't take our word for it — verify in 60 seconds</h3>
              </div>
              <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "16px", lineHeight: 1.6 }}>
                Run these commands in your terminal right now. See the waste with your own eyes before deciding anything.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {flagged.slice(0, 3).map((f, i) => {
                  const cmds = {
                    rightsizing: `aws cloudwatch get-metric-statistics --namespace AWS/EC2 --metric-name CPUUtilization --statistics Average --period 86400 --start-time $(date -d '30 days ago' +%Y-%m-%dT%H:%M:%S) --end-time $(date +%Y-%m-%dT%H:%M:%S) --dimensions Name=InstanceId,Value=YOUR_INSTANCE_ID`,
                    reserved: `aws ce get-savings-plans-purchase-recommendation --savings-plans-type COMPUTE_SP --term-in-years ONE_YEAR --payment-option NO_UPFRONT --lookback-period-in-days THIRTY_DAYS`,
                    spot: `aws ec2 describe-spot-price-history --instance-types m5.xlarge --product-descriptions "Linux/UNIX" --start-time $(date +%Y-%m-%dT%H:%M:%S) --max-results 5`,
                    s3_tier: `aws s3api list-buckets --query 'Buckets[*].Name' --output text | xargs -I{} aws s3 ls s3://{} --recursive --summarize 2>/dev/null | grep 'Total Size'`,
                    unattached_volumes: `aws ec2 describe-volumes --filters Name=status,Values=available --query 'Volumes[*].{ID:VolumeId,Size:Size,Created:CreateTime}' --output table`,
                    rds_idle: `aws rds describe-db-instances --query 'DBInstances[*].{ID:DBInstanceIdentifier,Class:DBInstanceClass,Status:DBInstanceStatus,MultiAZ:MultiAZ}' --output table`,
                    rds_size: `aws cloudwatch get-metric-statistics --namespace AWS/RDS --metric-name DatabaseConnections --statistics Average --period 86400 --start-time $(date -d '7 days ago' +%Y-%m-%dT%H:%M:%S) --end-time $(date +%Y-%m-%dT%H:%M:%S) --dimensions Name=DBInstanceIdentifier,Value=YOUR_DB_ID`,
                  };
                  const cmd = cmds[f.id] || `aws ce get-cost-and-usage --time-period Start=$(date -d '30 days ago' +%Y-%m-%d),End=$(date +%Y-%m-%d) --granularity MONTHLY --metrics BlendedCost --group-by Type=DIMENSION,Key=SERVICE`;
                  return (
                    <div key={f.id} style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", padding: "14px 16px" }}>
                      <p style={{ fontSize: "11px", fontWeight: 700, color: "#a5b4fc", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.8px" }}>Verify: {f.label}</p>
                      <code style={{ fontSize: "11px", color: "#93c5fd", lineHeight: 1.6, wordBreak: "break-all", display: "block" }}>{cmd}</code>
                    </div>
                  );
                })}
              </div>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "14px" }}>
                💡 Replace <code style={{ color: "#a5b4fc", background: "rgba(165,180,252,0.1)", padding: "1px 5px", borderRadius: "4px" }}>YOUR_INSTANCE_ID</code> with your actual resource ID from your AWS console.
              </p>
            </div>
          )}

          {/* ── 3. SECURITY & PRIVACY TRUST BLOCK ─────────────────────────────── */}
          <div className="fade-up stagger-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "16px", padding: "24px 28px", marginBottom: "24px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: "200px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                  <span style={{ fontSize: "18px" }}>🔒</span>
                  <h3 style={{ fontSize: "14px", fontWeight: 700, color: "#fff" }}>What KloudAudit never sees</h3>
                </div>
                {["Your AWS credentials or access keys", "Your actual resource IDs or account numbers", "Any live data from your cloud environment", "Your billing data or cost history"].map(item => (
                  <div key={item} style={{ display: "flex", gap: "8px", alignItems: "flex-start", marginBottom: "6px" }}>
                    <span style={{ color: "#f87171", fontSize: "12px", marginTop: "1px", flexShrink: 0 }}>✗</span>
                    <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{item}</span>
                  </div>
                ))}
              </div>
              <div style={{ flex: 1, minWidth: "200px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                  <span style={{ fontSize: "18px" }}>✅</span>
                  <h3 style={{ fontSize: "14px", fontWeight: 700, color: "#fff" }}>What the Blueprint contains</h3>
                </div>
                {["CLI commands based on your flagged issue types", "Terraform snippets matched to your provider", "Savings estimates from your self-reported bill", "Everything generated by Claude AI using only what you told us"].map(item => (
                  <div key={item} style={{ display: "flex", gap: "8px", alignItems: "flex-start", marginBottom: "6px" }}>
                    <span style={{ color: "#4ade80", fontSize: "12px", marginTop: "1px", flexShrink: 0 }}>✓</span>
                    <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.65, textAlign: "center" }}>
                🛡️ The Blueprint is generated by Claude AI using <strong style={{ color: "#fff" }}>only what you entered in this audit</strong>. We have zero access to your actual infrastructure. Your responses are never stored, sold, or shared.
              </p>
            </div>
          </div>

          {/* FIX #2: Tiered CTA with working Blueprint button */}
          <div className="fade-up stagger-4" style={{ background: "linear-gradient(135deg, rgba(0,255,180,0.05) 0%, rgba(99,102,241,0.05) 100%)", border: "1px solid rgba(0,255,180,0.15)", borderRadius: "20px", padding: "40px" }}>
            <p style={{ fontSize: "12px", fontWeight: 700, color: "var(--green)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "16px", textAlign: "center" }}>What happens next?</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "28px" }}>
              {/* Free tier */}
              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", borderRadius: "14px", padding: "24px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "10px" }}>✅ Free — You already have this</div>
                <p className="display" style={{ fontSize: "18px", fontWeight: 700, color: "#fff", marginBottom: "12px", letterSpacing: "-0.3px" }}>Checklist + Savings Report</p>
                {["Identified issues & savings range", "Priority order (Critical → Low)", "Action plan overview", "PDF export"].map(f => (
                  <div key={f} style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "6px" }}>
                    <span style={{ color: "#4ade80", fontSize: "12px" }}>✓</span>
                    <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{f}</span>
                  </div>
                ))}
              </div>
              {/* Paid tier */}
              <div style={{ background: "rgba(0,255,180,0.05)", border: "2px solid rgba(0,255,180,0.3)", borderRadius: "14px", padding: "24px", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: "12px", right: "12px", background: "var(--green)", color: "#000", fontSize: "10px", fontWeight: 800, padding: "3px 8px", borderRadius: "6px" }}>RECOMMENDED</div>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "10px" }}>{`⚡ ${currency.blueprintPrice} — AI Blueprint`}</div>
                <p className="display" style={{ fontSize: "18px", fontWeight: 700, color: "#fff", marginBottom: "12px", letterSpacing: "-0.3px" }}>AI Implementation Guide</p>
                {[`Exact ${provider || "cloud"} CLI commands`, "Terraform snippets per issue", "Step-by-step fix instructions", "Verification commands", "PDF in your inbox in ~2 min"].map(f => (
                  <div key={f} style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "6px" }}>
                    <span style={{ color: "var(--green)", fontSize: "12px" }}>✓</span>
                    <span style={{ fontSize: "12px", color: "var(--text-dim)" }}>{f}</span>
                  </div>
                ))}
              </div>
            </div>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", textAlign: "center", marginBottom: "20px" }}>
              {savMin > 0 ? `You're looking at $${savMin.toLocaleString()}–$${savMax.toLocaleString()}/mo in savings. The blueprint pays for itself in day one.` : "Average client saves $2,800+/month after implementing the blueprint."}
            </p>

            {/* Trust card */}
            <div style={{ display: "flex", alignItems: "center", gap: "16px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", padding: "16px 20px", marginBottom: "20px" }}>
              <div style={{ width: "44px", height: "44px", borderRadius: "50%", background: "linear-gradient(135deg, var(--green), #00d4ff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", fontWeight: 800, color: "#000", flexShrink: 0, fontFamily: "var(--display)" }}>SA</div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: "14px", fontWeight: 700, color: "#fff", marginBottom: "2px" }}>Samuel Ayodele Adomeh</p>
                <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>Certified Azure Architect Expert · DevOps Expert · Wrocław, Poland</p>
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <a href="mailto:admin@kloudaudit.eu" style={{ fontSize: "11px", fontWeight: 600, color: "#00d4ff", background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: "6px", padding: "3px 8px", textDecoration: "none" }}>✉️ Email</a>
                <a href="https://www.linkedin.com/in/adomeh" target="_blank" rel="noopener noreferrer" style={{ fontSize: "11px", fontWeight: 600, color: "#0077b5", background: "rgba(0,119,181,0.08)", border: "1px solid rgba(0,119,181,0.2)", borderRadius: "6px", padding: "3px 8px", textDecoration: "none" }}>💼 LinkedIn</a>
              </div>
            </div>

            <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
              <button className="glow-btn" onClick={() => flagged.length > 0 ? setShowBlueprint(true) : null}
                disabled={flagged.length === 0}
                style={{ background: flagged.length > 0 ? "var(--green)" : "rgba(255,255,255,0.06)", color: flagged.length > 0 ? "#000" : "var(--text-muted)", border: "none", borderRadius: "12px", padding: "14px 32px", fontSize: "15px", boxShadow: flagged.length > 0 ? "0 0 28px rgba(0,255,180,0.35)" : "none", cursor: flagged.length > 0 ? "pointer" : "not-allowed", display: "flex", alignItems: "center", gap: "8px" }}>
                {`⚡ Get AI Blueprint — ${currency.blueprintPrice} →`}
              </button>
              <button className="ghost-btn" onClick={() => setShowBooking(true)} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: "12px", padding: "14px 24px", fontSize: "15px" }}>
                {`Book 1:1 Session — ${currency.sessionPrice}`}
              </button>
              {flagged.length > 0 && bill > 0 && (
                <button onClick={() => setShowShareCard(true)} style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.35)", color: "#a5b4fc", borderRadius: "12px", padding: "14px 24px", fontSize: "15px", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", transition: "all 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(99,102,241,0.22)"; e.currentTarget.style.borderColor = "rgba(99,102,241,0.6)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(99,102,241,0.12)"; e.currentTarget.style.borderColor = "rgba(99,102,241,0.35)"; }}>
                  📤 Share My Results
                </button>
              )}
              <button className="ghost-btn" onClick={() => goTo("intro")} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: "12px", padding: "14px 24px", fontSize: "15px" }}>
                New Audit
              </button>
            </div>

            {/* ── SHARE CARD MODAL ── */}
            {showShareCard && (
              <ShareCardModal
                savMin={savMin}
                savMax={savMax}
                savPct={savPct}
                flaggedCount={flagged.length}
                totalChecks={allChecks.length}
                provider={provider}
                wasteScore={Math.max(0, Math.min(100, Math.round(100 - Math.min(flagged.length / allChecks.length, 1) * 30 - Math.min(savPct / 50, 1) * 70)))}
                onClose={() => setShowShareCard(false)}
              />
            )}
          </div>
        </div>
      </div>
    );
  }
}
