import { useState, useEffect, useRef, useMemo, memo } from "react";
import SEOPage, { SEO_PAGES } from "./SEOPages.jsx";

const AUDIT_SECTIONS = [
  {
    id: "compute", label: "Compute", icon: "⚡",
    description: "Instance sizing, reservation strategy & generation currency",
    summary: "Identifies idle VMs, missing savings plans, spot opportunities, and legacy instance types burning money silently.",
    checks: [
      { id: "rightsizing", label: "Idle or oversized instances", detail: "Over 80% unused capacity detected", savingsRange: [15, 40], effort: "Medium", impact: "High", tooltip: "AWS Compute Optimizer finds 32% of EC2 instances are overprovisioned on average. A t3.large → t3.medium migration saves ~$30/month per instance with no performance impact." },
      { id: "reserved", label: "No Reserved Instances / Savings Plans", detail: "Running fully on-demand pricing", savingsRange: [20, 45], effort: "Low", impact: "High", tooltip: "A 1-year No Upfront Compute Savings Plan saves 36–40% vs on-demand. An m5.xlarge running 24/7 on-demand: ~$140/month. With a Savings Plan: ~$88/month. Commitment required, but the baseline workload qualifies." },
      { id: "spot", label: "Spot instances unused for batch/dev", detail: "CI runners, ML training, ETL jobs eligible", savingsRange: [60, 80], effort: "Medium", impact: "Critical", tooltip: "Spot instances are 70–90% cheaper than on-demand for interruptible workloads. CI/CD runners and ML training are ideal — interruptions restart the job, not your product. Average interruption rate: 5%." },
      { id: "old_gen", label: "Previous-generation instance types", detail: "m4, c4, r4 families still in use", savingsRange: [5, 15], effort: "Low", impact: "Medium", tooltip: "m4.large costs $0.10/hr (us-east-1). m7g.large (Graviton3) costs $0.0816/hr — 18% cheaper with better performance. Migration is a stop, resize, start operation taking under 10 minutes per instance." },
      { id: "stopped", label: "Stopped instances still billing", detail: "EBS volumes and Elastic IPs accruing charges", savingsRange: [2, 8], effort: "Low", impact: "Low", tooltip: "AWS charges $0.005/hour per unattached Elastic IP (~$3.65/month each) and $0.10/GB/month for EBS volumes on stopped instances. Run: aws ec2 describe-volumes --filters Name=status,Values=available" },
    ],
  },
  {
    id: "storage", label: "Storage", icon: "🗄",
    description: "Object storage tiering, orphaned volumes & data transfer",
    summary: "Uncovers untriered S3/GCS data, orphaned disks after instance deletion, stale snapshots, and expensive egress routing.",
    checks: [
      { id: "s3_tier", label: "Storage not tiered by access frequency", detail: "All data sitting in Standard class", savingsRange: [30, 60], effort: "Low", impact: "High", tooltip: "S3 Standard: $0.023/GB/month. S3 Infrequent Access: $0.0125/GB/month (46% cheaper). S3 Intelligent-Tiering automates this at $0.0025/1,000 objects/month — zero management overhead." },
      { id: "unattached_volumes", label: "Unattached disks & orphaned volumes", detail: "Persisting after instance termination", savingsRange: [5, 20], effort: "Low", impact: "Medium", tooltip: "EBS volumes persist after instance termination by default. A forgotten 500GB gp3 volume costs $40/month. Most accounts have 5–20 of these. Run: aws ec2 describe-volumes --filters Name=status,Values=available" },
      { id: "snapshots", label: "Snapshot retention policy missing", detail: "Old backups never purged or archived", savingsRange: [5, 15], effort: "Low", impact: "Medium", tooltip: "EBS snapshots cost $0.05/GB/month. Without a lifecycle policy, they accumulate forever. 10TB of old snapshots: $500/month. AWS Data Lifecycle Manager sets retention rules in under 5 minutes." },
      { id: "data_transfer", label: "Excessive cross-region egress costs", detail: "No CDN or VPC endpoint in place", savingsRange: [10, 35], effort: "Medium", impact: "High", tooltip: "Cross-region data transfer: $0.02/GB. CloudFront CDN: $0.0085/GB for the first 10TB — 57% cheaper. S3 → CloudFront origin transfer is free. VPC Gateway Endpoints for S3/DynamoDB cost $0." },
    ],
  },
  {
    id: "network", label: "Network", icon: "🌐",
    description: "NAT gateways, static IPs & idle load balancers",
    summary: "Catches NAT gateway overuse for internal traffic, idle load balancers billing hourly, and unattached static IPs.",
    checks: [
      { id: "nat_gateway", label: "Excessive NAT Gateway traffic", detail: "Internal traffic routed through NAT unnecessarily", savingsRange: [10, 30], effort: "Medium", impact: "High", tooltip: "NAT Gateway charges $0.045/GB processed + $0.045/hour. A VPC Gateway Endpoint for S3 or DynamoDB is completely free and eliminates all processing charges for that traffic. One command to create." },
      { id: "unused_ips", label: "Unused static / Elastic IPs", detail: "Unattached IPs billed hourly", savingsRange: [1, 5], effort: "Low", impact: "Low", tooltip: "AWS charges $0.005/hour per unattached Elastic IP — $3.65/month each. Accounts commonly accumulate 5–15 forgotten IPs after instance terminations. Run: aws ec2 describe-addresses --query 'Addresses[?AssociationId==null]'" },
      { id: "lb_unused", label: "Load balancers with no active targets", detail: "Idle ALBs and NLBs still billing", savingsRange: [3, 10], effort: "Low", impact: "Medium", tooltip: "An idle ALB costs ~$16/month (LCU-hours minimum) even with zero traffic. Check target health: aws elbv2 describe-target-groups. A load balancer with 0 healthy targets is safe to delete." },
    ],
  },
  {
    id: "database", label: "Database", icon: "🗃",
    description: "RDS sizing, dev environment waste & caching gaps",
    summary: "Finds dev/staging RDS running 24/7, over-provisioned databases, and missing Redis layers that cause DB overload.",
    checks: [
      { id: "rds_idle", label: "Dev/staging RDS running 24/7", detail: "Full-price uptime for non-production databases", savingsRange: [40, 70], effort: "Low", impact: "Critical", tooltip: "A db.t3.medium runs 24/7 at ~$50/month. Scheduled to business hours only (8am–8pm weekdays): ~$18/month. That's a 64% saving from a single EventBridge rule that takes 20 minutes to set up." },
      { id: "rds_size", label: "RDS instances over-provisioned", detail: "High memory, <10% actual usage", savingsRange: [20, 40], effort: "Medium", impact: "High", tooltip: "RDS rightsizing signal: CloudWatch DatabaseConnections < 10 sustained AND FreeableMemory > 50% of total. Check: aws cloudwatch get-metric-statistics for both metrics over the last 14 days." },
      { id: "cache_missing", label: "No caching layer in front of database", detail: "Redis/Memcached could offload 60–80% of queries", savingsRange: [15, 30], effort: "High", impact: "High", tooltip: "A cache.t3.micro ElastiCache node costs ~$12/month and can handle 60–80% of read traffic on typical web apps. This reduces RDS load, allows downsizing, and improves response time." },
    ],
  },
  {
    id: "governance", label: "Governance", icon: "📊",
    description: "Budgets, alerts, forgotten resources & environment parity",
    summary: "Exposes missing billing alerts, shadow IT resources accumulating cost, and dev environments mirroring production unnecessarily.",
    checks: [
      { id: "no_budgets", label: "No cost budgets or billing alerts", detail: "Spend drifting without visibility", savingsRange: [5, 20], effort: "Low", impact: "High", tooltip: "AWS Budget alerts are free for your first 2 budgets. A threshold at 80% of your monthly target gives you 5–7 days to investigate before overspend compounds. Takes 3 minutes to set up in AWS Console." },
      { id: "unused_services", label: "Forgotten services & shadow IT", detail: "Old Lambdas, API GWs, queues accruing cost", savingsRange: [3, 15], effort: "Medium", impact: "Medium", tooltip: "Old Lambda functions, abandoned API Gateways, and forgotten SQS queues accumulate from CI/CD pipelines and side experiments. They have low direct cost but often trigger other services that add up." },
      { id: "dev_prod_parity", label: "Dev environment mirrors production", detail: "Should be 10–20% of prod size", savingsRange: [30, 50], effort: "Medium", impact: "Critical", tooltip: "Production needs high availability and headroom. Dev needs to run your stack — typically at 10–20% of production sizing. A 1:1 dev-to-prod ratio is the single most common infrastructure waste pattern we see." },
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
const EFFORT_COLOR = { Low: "#4ade80", Easy: "#4ade80", Medium: "#fbbf24", High: "#f87171", Hard: "#f87171" };
const COMPLIANCE_COLOR = { "GDPR": "#60a5fa", "SOC 2": "#4ade80", "ISO 27001": "#a78bfa", "PCI-DSS": "#fb923c" };
const PROVIDERS = ["AWS", "GCP", "Azure", "Multi-cloud"];

const SEC_SECTIONS = [
  { id: "iam", icon: "🔐", title: "Identity & Access", color: "#f87171",
    desc: "IAM policies, MFA enforcement, privilege escalation paths",
    checks: [
      { id: "mfa_all",      label: "MFA not enforced for all users",          detail: "Users can authenticate with password only — no second factor",    risk: "Critical", effort: "Easy",   compliance: ["SOC 2","ISO 27001","GDPR"],       tte: "< 24h" },
      { id: "iam_wildcards",label: "IAM wildcard permissions (Action: *)",     detail: "Overly permissive policies granting full service access",          risk: "Critical", effort: "Medium", compliance: ["SOC 2","ISO 27001","PCI-DSS"],    tte: "< 1h"  },
      { id: "root_usage",   label: "Root account used for daily operations",   detail: "Root credentials should never be used after initial setup",        risk: "High",     effort: "Easy",   compliance: ["SOC 2","ISO 27001"]                           },
      { id: "unused_keys",  label: "Access keys older than 90 days",           detail: "Long-lived credentials increase breach exposure window",           risk: "High",     effort: "Easy",   compliance: ["SOC 2","PCI-DSS"]                             },
    ]
  },
  { id: "network", icon: "🌐", title: "Network & Exposure", color: "#fb923c",
    desc: "Public exposure, VPC isolation, security groups",
    checks: [
      { id: "public_buckets",       label: "Public S3/storage buckets detected",      detail: "Storage accessible without authentication from the internet", risk: "Critical", effort: "Easy",   compliance: ["GDPR","SOC 2","PCI-DSS"],         tte: "< 24h" },
      { id: "open_security_groups", label: "Security groups open to 0.0.0.0/0",       detail: "Ports open to entire internet — including management ports",  risk: "High",     effort: "Easy",   compliance: ["SOC 2","PCI-DSS"]                             },
      { id: "no_vpc",               label: "Resources not isolated in VPC",            detail: "Services running without network boundary controls",          risk: "High",     effort: "Hard",   compliance: ["SOC 2","ISO 27001"]                           },
      { id: "no_waf",               label: "No WAF on public endpoints",               detail: "Web application firewall absent on internet-facing services", risk: "Medium",   effort: "Medium", compliance: ["PCI-DSS","SOC 2"]                             },
    ]
  },
  { id: "data", icon: "🗄", title: "Data Protection", color: "#fbbf24",
    desc: "Encryption at rest, in transit, secrets management",
    checks: [
      { id: "no_encryption_rest",    label: "Data at rest not encrypted",               detail: "Databases or storage volumes without encryption enabled",      risk: "High",     effort: "Medium", compliance: ["GDPR","PCI-DSS","ISO 27001"]                   },
      { id: "no_encryption_transit", label: "Data in transit not encrypted (HTTP)",     detail: "Internal or external traffic using unencrypted channels",      risk: "High",     effort: "Medium", compliance: ["GDPR","PCI-DSS","ISO 27001"]                   },
      { id: "hardcoded_secrets",     label: "Secrets hardcoded in code/config",         detail: "API keys, passwords, or tokens in source code or env vars",    risk: "Critical", effort: "Hard",   compliance: ["SOC 2","PCI-DSS","ISO 27001"],    tte: "< 1h"  },
      { id: "no_kms",                label: "No key management system",                 detail: "Encryption keys not centrally managed or rotated",             risk: "Medium",   effort: "Medium", compliance: ["PCI-DSS","ISO 27001"]                          },
    ]
  },
  { id: "logging", icon: "📋", title: "Logging & Detection", color: "#818cf8",
    desc: "Audit trails, alerting, incident response",
    checks: [
      { id: "no_cloudtrail",    label: "Audit logging not enabled",          detail: "No CloudTrail/Audit Log — no record of who did what",          risk: "High",   effort: "Easy",   compliance: ["SOC 2","ISO 27001","PCI-DSS"]                 },
      { id: "no_alerts",        label: "No security alerts configured",      detail: "No notifications for suspicious activity or policy violations", risk: "High",   effort: "Easy",   compliance: ["SOC 2","ISO 27001"]                           },
      { id: "no_ir_plan",       label: "No incident response plan",          detail: "No documented process for security incidents",                 risk: "Medium", effort: "Medium", compliance: ["SOC 2","ISO 27001","GDPR"]                     },
      { id: "no_vuln_scanning", label: "No vulnerability scanning",          detail: "Infrastructure not scanned for known CVEs or misconfigs",      risk: "Medium", effort: "Easy",   compliance: ["SOC 2","PCI-DSS"]                             },
    ]
  },
];

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

function MethodologyNote() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: "-16px", marginBottom: "28px", textAlign: "center" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ background: "none", border: "none", cursor: "pointer", fontSize: "12px", color: "var(--text-muted)", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: "4px", padding: "4px 8px", borderRadius: "6px", transition: "color 0.15s" }}
        onMouseEnter={e => e.currentTarget.style.color = "var(--text-dim)"}
        onMouseLeave={e => e.currentTarget.style.color = "var(--text-muted)"}
        aria-expanded={open}
      >
        How is this calculated?
        <span style={{ display: "inline-block", transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0deg)", fontSize: "10px" }}>▾</span>
      </button>
      <div style={{
        overflow: "hidden",
        maxHeight: open ? "200px" : "0",
        transition: "max-height 0.3s ease",
        textAlign: "left",
      }}>
        <p style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.7, maxWidth: "560px", margin: "8px auto 0", padding: "12px 16px", background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", borderRadius: "10px" }}>
          Based on 18 checks across compute, storage, network, database and governance. The 20% figure represents conservative savings from quick wins only (orphaned resources, dev database schedules, reserved instance coverage). The 45% figure includes structural optimisations like NAT gateway elimination, storage tiering, and spot instance adoption. Actual savings depend on your current configuration and bill size.
        </p>
      </div>
    </div>
  );
}

function CodeBlock({ code }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };
  return (
    <div style={{ position: "relative", marginBottom: "8px" }}>
      <pre style={{ background: "#0a0a16", border: "1px solid rgba(0,255,180,0.15)", borderRadius: "10px", padding: "16px 56px 16px 16px", fontFamily: "'Fira Code', 'Courier New', monospace", fontSize: "12px", color: "#a5f3c4", overflowX: "auto", lineHeight: 1.7, margin: 0, whiteSpace: "pre" }}>
        <code>{code}</code>
      </pre>
      <button onClick={copy} style={{ position: "absolute", top: "10px", right: "10px", background: copied ? "rgba(0,255,180,0.2)" : "rgba(255,255,255,0.06)", border: `1px solid ${copied ? "rgba(0,255,180,0.4)" : "rgba(255,255,255,0.1)"}`, borderRadius: "6px", color: copied ? "#00ffb4" : "#94a3b8", fontSize: "10px", fontWeight: 700, padding: "4px 8px", cursor: "pointer", transition: "all 0.2s" }}>
        {copied ? "✓ Copied" : "Copy"}
      </button>
    </div>
  );
}

function ParticleBackground() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const init = () => {
      setReady(true);
    };

    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(init, { timeout: 2000 });
      return () => cancelIdleCallback(id);
    } else {
      const timer = setTimeout(init, 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  if (!ready) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none", willChange: "auto" }}>
      <div style={{ position: "absolute", top: "-200px", left: "-200px", width: "600px", height: "600px", background: "radial-gradient(circle, rgba(0,255,180,0.07) 0%, transparent 70%)", borderRadius: "50%" }} />
      <div style={{ position: "absolute", bottom: "-200px", right: "-100px", width: "500px", height: "500px", background: "radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)", borderRadius: "50%" }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)", backgroundSize: "48px 48px" }} />
      <div style={{ position: "absolute", inset: 0, opacity: 0.04, backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />
    </div>
  );
}

const globalCss = `
  /* Fonts loaded via <link rel=preload> in index.html for better LCP/FCP */
  /* font-display: swap prevents invisible text while fonts load — reduces LCP */
  @font-face { font-family: 'Bricolage Grotesque'; font-display: swap; src: local('Bricolage Grotesque'); }
  @font-face { font-family: 'DM Sans'; font-display: swap; src: local('DM Sans'); }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #080810; color: #e2e8f0; }
  :root {
    --bg: #080810; --bg2: #0d0d1a; --bg3: #12121f;
    --border: rgba(255,255,255,0.08); --border-hover: rgba(0,255,180,0.3);
    --green: #00ffb4; --green-dim: rgba(0,255,180,0.12); --green-border: rgba(0,255,180,0.25);
    --text: #e2e8f0; --text-muted: #8899aa; --text-dim: #94a3b8;
    --display: 'Bricolage Grotesque', sans-serif; --body: 'DM Sans', sans-serif;
  }
  .app { font-family: var(--body); background: var(--bg); min-height: 100vh; color: var(--text); }
  .display { font-family: var(--display); }
  .fade-up { animation: fadeUp 0.4s ease both; }
  @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
  .stagger-1 { animation-delay: 0.02s; } .stagger-2 { animation-delay: 0.06s; }
  .stagger-3 { animation-delay: 0.1s; } .stagger-4 { animation-delay: 0.15s; }
  .glow-btn { transition: all 0.2s; cursor: pointer; font-family: var(--display); font-weight: 700; }
  .glow-btn:hover { box-shadow: 0 0 30px rgba(0,255,180,0.35), 0 0 60px rgba(0,255,180,0.15) !important; transform: translateY(-2px); }
  .glow-btn:active { transform: translateY(0); }
  .ghost-btn { transition: all 0.2s; cursor: pointer; font-family: var(--body); }
  .ghost-btn:hover { border-color: rgba(255,255,255,0.25) !important; color: #fff !important; background: rgba(255,255,255,0.05) !important; }
  button, [role="button"], [role="checkbox"], [role="radio"], [role="link"] { touch-action: manipulation; }
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
    @keyframes bounce { 0%, 60%, 100% { transform: translateY(0); opacity: 1; } 30% { transform: translateY(-6px); opacity: 0.6; } }
  @keyframes toastIn { from { opacity:0; transform:translateX(20px) scale(0.9); } to { opacity:1; transform:translateX(0) scale(1); } }
  @keyframes pulse-green-ring { 0%, 100% { transform: scale(1); opacity: 0.7; } 50% { transform: scale(1.04); opacity: 0; } }
  @keyframes urgency-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
  @keyframes card-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
  .pulse-green-ring { position: relative; }
  .pulse-green-ring::after { content: ''; position: absolute; inset: -2px; border-radius: 14px; border: 1.5px solid rgba(0,255,180,0.5); animation: pulse-green-ring 2s ease-in-out infinite; pointer-events: none; }
  .trust-link { display:flex; align-items:center; gap:10px; text-decoration:none; padding:10px 14px; background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:10px; transition:all 0.2s; }
  .trust-link:hover { background:rgba(255,255,255,0.06) !important; transform:translateX(3px); }

  /* ── MOBILE RESPONSIVE ────────────────────────────────────────────── */
  @media (max-width: 768px) {
    .sec-audit-grid { grid-template-columns: 1fr !important; }
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

    /* Wall of Savings: single col */
    .wall-grid { grid-template-columns: 1fr !important; }

    /* Blog grid: single col */
    .blog-grid { grid-template-columns: 1fr !important; }

    /* Hero padding */
    .hero-pad { padding-top: 60px !important; padding-bottom: 48px !important; }

    /* Calculator: stack cards */
    .calc-cards { grid-template-columns: 1fr !important; }

    /* Bottom CTA padding */
    .bottom-cta-pad { padding: 40px 24px !important; }

    /* Footer: 2-col on mobile */
    .footer-grid { grid-template-columns: 1fr 1fr !important; gap: 28px !important; }

    /* Section padding */
    .section-pad { padding: 32px 20px !important; }

    /* Free vs paid: hide the ✗ items on free card to save space */
    .hide-mobile { display: none !important; }

    /* Hero headline tighter on mobile */
    .hero-h1 { letter-spacing: -1.5px !important; }
  }

 @media (max-width: 480px) {
  .stats-grid { grid-template-columns: 1fr 1fr !important; }
  .kpi-grid { grid-template-columns: 1fr 1fr !important; }
  .hero-provider-btns { flex-direction: column !important; width: 100% !important; }
  .hero-provider-btns button { width: 100% !important; }
  .sticky-bottom-cta { flex-direction: column !important; gap: 8px !important; padding: 10px 16px !important; }
  .sticky-bottom-cta span { font-size: 11px !important; }
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

// ── SHARE CARD MODAL ──────────────────────────────────────────────────────────────
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
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="share-dialog-title" style={{ background: "linear-gradient(145deg, #0f0f1a, #13131f)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "20px", padding: "32px", maxWidth: "700px", width: "100%", position: "relative" }}>
        {/* Close */}
        <button onClick={onClose} aria-label="Close" style={{ position: "absolute", top: "16px", right: "16px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "rgba(255,255,255,0.5)", width: "30px", height: "30px", cursor: "pointer", fontSize: "16px", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>

        <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "8px" }}>Your shareable results card</p>
        <h2 id="share-dialog-title" style={{ fontSize: "22px", fontWeight: 800, color: "#fff", marginBottom: "4px", letterSpacing: "-0.5px" }}>Share your audit results</h2>
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

// ── SECURITY BLUEPRINT MODAL ─────────────────────────────────────────────────
function SecurityBlueprintModal({ onClose, secChecked, currency, provider, companyName }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [errorMsg, setErrorMsg] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("security"); // "security" | "bundle"
  const [withdrawalChecked, setWithdrawalChecked] = useState(false);

  const flaggedIds = Object.keys(secChecked).filter(k => secChecked[k]);
  const critCount  = [
    "mfa_all","iam_wildcards","public_buckets","hardcoded_secrets"
  ].filter(id => secChecked[id]).length;

  const canSubmit = email.length > 0 && withdrawalChecked && status !== "loading";

  const handlePurchase = async (e) => {
    e.preventDefault();
    if (!canSubmit || flaggedIds.length === 0) return;
    window.gtag?.('event', 'security_checkout_initiated', { amount: selectedProduct === "bundle" ? (currency.bundleAmount || 34900) : (currency.securityAmount || 11900), currency: currency.stripeCurrency });
    setStatus("loading");
    try {
      const isBundle = selectedProduct === "bundle";
      const res = await fetch("/api/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          provider: provider || "AWS",
          monthlyBill: 0,
          companyName: companyName || "Your Company",
          savingsMin: 0,
          savingsMax: 0,
          currency: currency.stripeCurrency || "pln",
          currencyAmount: isBundle ? (currency.bundleAmount || 34900) : (currency.securityAmount || 11900),
          flaggedIssues: flaggedIds.map(id => ({ id, label: id.replace(/_/g, " ") })),
          productType: isBundle ? "bundle" : "security_blueprint",
        }),
      });
      if (!res.ok) {
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const errData = await res.json();
          throw new Error(errData.error || `Checkout failed (${res.status})`);
        }
        throw new Error(`Checkout failed (${res.status})`);
      }
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || "Checkout failed");
      }
    } catch (err) {
      setErrorMsg(err.message);
      setStatus("error");
      setTimeout(() => setStatus("idle"), 6000);
    }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", backdropFilter: "blur(12px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", animation: "fadeIn 0.2s ease" }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="sec-blueprint-dialog-title" style={{ background: "linear-gradient(145deg, #0f0f1a, #13131f)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: "24px", maxWidth: "480px", width: "100%", overflow: "hidden", boxShadow: "0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(248,113,113,0.08)", animation: "scaleIn 0.3s cubic-bezier(0.34,1.56,0.64,1)" }}>

        {/* Header */}
        <div style={{ background: "linear-gradient(135deg, rgba(248,113,113,0.1), rgba(251,146,60,0.08))", borderBottom: "1px solid rgba(248,113,113,0.15)", padding: "28px 32px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "7px", background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: "20px", padding: "4px 12px", marginBottom: "10px" }}>
                <span style={{ width: "5px", height: "5px", background: "#f87171", borderRadius: "50%", animation: "pulse-dot 2s infinite" }} />
                <span style={{ fontSize: "11px", color: "#f87171", fontWeight: 700, letterSpacing: "1px" }}>SECURITY BLUEPRINT · ONE-TIME</span>
              </div>
              <h2 id="sec-blueprint-dialog-title" style={{ fontSize: "22px", fontWeight: 800, color: "#fff", letterSpacing: "-0.5px", marginBottom: "4px", fontFamily: "system-ui, sans-serif" }}>Get your Security Blueprint</h2>
              <p style={{ fontSize: "13px", color: "#94a3b8" }}>
                Claude AI writes exact remediation for all <strong style={{ color: "#fff" }}>{flaggedIds.length} flagged issues</strong> — delivered to your inbox instantly
              </p>
            </div>
            <button onClick={onClose} aria-label="Close" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "rgba(255,255,255,0.5)", width: "32px", height: "32px", cursor: "pointer", fontSize: "18px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>×</button>
          </div>
          {/* What's included */}
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "14px" }}>
            {["✓ Exact CLI fix commands", "✓ IAM policy templates", "✓ Compliance mapping", "✓ 30-day roadmap", "✓ Verification steps"].map(item => (
              <span key={item} style={{ fontSize: "11px", color: "#cbd5e1", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", padding: "3px 9px" }}>{item}</span>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "26px 32px 32px" }}>
          {/* What you get — clear value statement */}
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", padding: "12px 16px", marginBottom: "16px" }}>
            <p style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>Free score shows the problem. Blueprint fixes it.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
              {["Exact CLI commands", "IAM policy templates", "Compliance mapping", "30-day fix roadmap"].map(item => (
                <div key={item} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <span style={{ color: "#f87171", fontSize: "11px", flexShrink: 0 }}>✓</span>
                  <span style={{ fontSize: "11px", color: "#94a3b8" }}>{item}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Urgency — critical count */}
          {critCount > 0 && (
            <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "10px", padding: "12px 16px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "18px" }}>⚠️</span>
              <p style={{ fontSize: "13px", color: "#f87171", fontWeight: 600, margin: 0 }}>
                {critCount} critical issue{critCount > 1 ? "s" : ""} detected. Public exposure or credential risk may be active right now.
              </p>
            </div>
          )}

          <form onSubmit={handlePurchase} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div>
              <label htmlFor="sec-blueprint-email" style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#f87171", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "1px" }}>Work Email — Blueprint delivered here</label>
              <input
                id="sec-blueprint-email"
                type="email" required value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="security@yourcompany.com"
                style={{ width: "100%", padding: "13px 16px", background: "#1e293b", border: "1.5px solid rgba(255,255,255,0.12)", borderRadius: "10px", color: "#f8fafc", fontSize: "15px", outline: "none", boxSizing: "border-box", WebkitTextFillColor: "#f8fafc", caretColor: "#f87171", fontFamily: "system-ui, sans-serif" }}
                onFocus={e => e.target.style.borderColor = "#f87171"}
                onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.12)"}
              />
            </div>

            {/* Price */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.15)", borderRadius: "10px", padding: "14px 16px" }}>
              <div>
                <p style={{ fontSize: "13px", fontWeight: 700, color: "#fff", margin: "0 0 2px" }}>Security Blueprint</p>
                <p style={{ fontSize: "12px", color: "#94a3b8", margin: 0 }}>One-time · Delivered within 2 minutes</p>
              </div>
              <span style={{ fontSize: "22px", fontWeight: 800, color: "#f87171" }}>{currency.securityPrice || "$29"}</span>
            </div>

            {/* Product selector — Security or Bundle */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              {/* Security only */}
              <div role="radio" aria-checked={selectedProduct === "security"} tabIndex={0} onKeyDown={e => (e.key === "Enter" || e.key === " ") && setSelectedProduct("security")} onClick={() => setSelectedProduct("security")}
                style={{ background: selectedProduct === "security" ? "rgba(248,113,113,0.1)" : "rgba(255,255,255,0.02)", border: `1.5px solid ${selectedProduct === "security" ? "#f87171" : "rgba(255,255,255,0.08)"}`, borderRadius: "10px", padding: "12px 14px", cursor: "pointer", transition: "all 0.2s" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                  <div style={{ width: "14px", height: "14px", borderRadius: "50%", border: `2px solid ${selectedProduct === "security" ? "#f87171" : "rgba(255,255,255,0.2)"}`, background: selectedProduct === "security" ? "#f87171" : "transparent", flexShrink: 0, transition: "all 0.2s" }} />
                  <p style={{ fontSize: "12px", fontWeight: 700, color: selectedProduct === "security" ? "#fff" : "#94a3b8" }}>Security Blueprint</p>
                </div>
                <p style={{ fontSize: "18px", fontWeight: 800, color: selectedProduct === "security" ? "#f87171" : "#64748b" }}>{currency.securityPrice || "$29"}</p>
                <p style={{ fontSize: "10px", color: "#475569" }}>Security fixes only</p>
              </div>
              {/* Bundle */}
              <div role="radio" aria-checked={selectedProduct === "bundle"} tabIndex={0} onKeyDown={e => (e.key === "Enter" || e.key === " ") && setSelectedProduct("bundle")} onClick={() => setSelectedProduct("bundle")}
                style={{ background: selectedProduct === "bundle" ? "rgba(99,102,241,0.1)" : "rgba(255,255,255,0.02)", border: `1.5px solid ${selectedProduct === "bundle" ? "#818cf8" : "rgba(255,255,255,0.08)"}`, borderRadius: "10px", padding: "12px 14px", cursor: "pointer", transition: "all 0.2s", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, right: 0, background: "#818cf8", color: "#000", fontSize: "9px", fontWeight: 800, padding: "2px 8px", borderRadius: "0 10px 0 6px" }}>SAVE {Math.round((1 - (currency.bundleAmount || 34900) / ((currency.blueprintAmount || 29900) + (currency.securityAmount || 11900))) * 100)}%</div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                  <div style={{ width: "14px", height: "14px", borderRadius: "50%", border: `2px solid ${selectedProduct === "bundle" ? "#818cf8" : "rgba(255,255,255,0.2)"}`, background: selectedProduct === "bundle" ? "#818cf8" : "transparent", flexShrink: 0, transition: "all 0.2s" }} />
                  <p style={{ fontSize: "12px", fontWeight: 700, color: selectedProduct === "bundle" ? "#fff" : "#94a3b8" }}>Cost + Security</p>
                </div>
                <p style={{ fontSize: "18px", fontWeight: 800, color: selectedProduct === "bundle" ? "#a5b4fc" : "#64748b" }}>{currency.bundlePrice || "$89"}</p>
                <p style={{ fontSize: "10px", color: "#475569" }}>Both blueprints</p>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "12px 14px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px" }}>
              <input type="checkbox" id="withdrawal-sec" required checked={withdrawalChecked} onChange={e => setWithdrawalChecked(e.target.checked)} style={{ marginTop: "2px", accentColor: "#f87171", flexShrink: 0, cursor: "pointer" }} />
              <label htmlFor="withdrawal-sec" style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.55, cursor: "pointer" }}>
                I understand this is a digital product delivered immediately and I waive my right of withdrawal upon delivery. See <a href="https://www.kloudaudit.eu/terms/" target="_blank" rel="noopener" style={{ color: "#f87171" }}>Terms</a>.
              </label>
            </div>
            <button type="submit" disabled={!canSubmit}
              style={{ width: "100%", padding: "15px", borderRadius: "12px", border: "none", background: !canSubmit ? (selectedProduct === "bundle" ? "rgba(99,102,241,0.35)" : "rgba(248,113,113,0.35)") : selectedProduct === "bundle" ? "#818cf8" : "#f87171", color: "#000", fontWeight: 800, fontSize: "15px", cursor: canSubmit ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", boxShadow: canSubmit ? `0 4px 20px ${selectedProduct === "bundle" ? "rgba(99,102,241,0.35)" : "rgba(248,113,113,0.35)"}` : "none", fontFamily: "system-ui, sans-serif", transition: "all 0.2s", opacity: canSubmit ? 1 : 0.55 }}>
              {status === "loading"
                ? <><span style={{ display: "inline-block", width: "15px", height: "15px", border: "2px solid #000", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} /> Processing…</>
                : selectedProduct === "bundle"
                  ? `Pay ${currency.bundlePrice || "$89"} → Get Both Blueprints`
                  : `Pay ${currency.securityPrice || "$29"} → Get Security Blueprint`}
            </button>
            {status === "error" && <p style={{ color: "#f87171", fontSize: "13px", textAlign: "center", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "8px", padding: "10px" }}>⚠ {errorMsg}</p>}
            <p style={{ fontSize: "11px", color: "#475569", textAlign: "center" }}>🔒 Secure checkout via Stripe · Prices inclusive of applicable taxes · No cloud access required</p>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── SECURITY SAMPLE MODAL ────────────────────────────────────────────────────
function SecSampleModal({ onClose }) {
  const SAMPLE_ISSUES = [
    { id: "mfa_all", label: "MFA not enforced for all users", risk: "Critical", detail: "Users authenticate with password only — no second factor" },
    { id: "iam_wildcards", label: "IAM wildcard permissions (Action: *)", risk: "Critical", detail: "Overly permissive policies granting full service access" },
    { id: "public_buckets", label: "Public S3/storage buckets detected", risk: "Critical", detail: "Storage accessible without authentication from the internet" },
    { id: "open_security_groups", label: "Security groups open to 0.0.0.0/0", risk: "High", detail: "Ports open to entire internet including management ports" },
    { id: "hardcoded_secrets", label: "Secrets hardcoded in code/config", risk: "Critical", detail: "API keys, passwords, or tokens found in source code" },
  ];
  const RISK_COLOR = { Critical: "#f87171", High: "#fb923c", Medium: "#fbbf24" };
  const score = 31;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(10px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", animation: "fadeIn 0.2s ease" }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="sec-sample-title" style={{ background: "linear-gradient(145deg, #0f0f1a, #13131f)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "20px", maxWidth: "640px", width: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 40px 80px rgba(0,0,0,0.7)" }}>
        <div style={{ padding: "28px 32px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", position: "sticky", top: 0, background: "linear-gradient(145deg, #0f0f1a, #13131f)", zIndex: 10, borderRadius: "20px 20px 0 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
                {["Sample Report", "AWS", "Acme Corp"].map(t => <span key={t} style={{ background: "rgba(255,255,255,0.06)", color: "rgba(148,163,184,0.7)", fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "20px", border: "1px solid rgba(255,255,255,0.08)" }}>{t}</span>)}
              </div>
              <h2 id="sec-sample-title" style={{ fontSize: "22px", fontWeight: 800, color: "#fff", letterSpacing: "-0.5px" }}>Security Risk Report — Preview</h2>
              <p style={{ color: "rgba(148,163,184,0.7)", fontSize: "13px", marginTop: "4px" }}>5 issues flagged · Score: 31/100</p>
            </div>
            <button onClick={onClose} aria-label="Close" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "rgba(255,255,255,0.5)", fontSize: "18px", width: "36px", height: "36px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>×</button>
          </div>
        </div>
        <div style={{ padding: "24px 32px 32px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "28px", background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.15)", borderRadius: "16px", padding: "24px", marginBottom: "20px", flexWrap: "wrap" }}>
            <div style={{ position: "relative", flexShrink: 0 }}>
              <svg width="100" height="100" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
                <circle cx="50" cy="50" r="44" fill="none" stroke="#f87171" strokeWidth="8"
                  strokeDasharray={2 * Math.PI * 44} strokeDashoffset={2 * Math.PI * 44 * (1 - score / 100)} strokeLinecap="round"
                  style={{ filter: "drop-shadow(0 0 6px rgba(248,113,113,0.5))" }} />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: "26px", fontWeight: 800, color: "#f87171", lineHeight: 1 }}>{score}</span>
                <span style={{ fontSize: "10px", color: "rgba(148,163,184,0.6)" }}>/ 100</span>
              </div>
            </div>
            <div>
              <p style={{ fontSize: "11px", fontWeight: 700, color: "rgba(148,163,184,0.6)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "4px" }}>Security Risk Score</p>
              <h3 style={{ fontSize: "22px", fontWeight: 800, color: "#f87171", marginBottom: "8px" }}>Critical Risk</h3>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "11px", color: "#f87171", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: "6px", padding: "2px 8px", fontWeight: 700 }}>🔴 4 Critical</span>
                <span style={{ fontSize: "11px", color: "#fb923c", background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.25)", borderRadius: "6px", padding: "2px 8px", fontWeight: 700 }}>🟠 1 High</span>
              </div>
            </div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", overflow: "hidden", marginBottom: "20px" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <h3 style={{ fontSize: "13px", fontWeight: 700, color: "#fff" }}>Issues Found — 5 flagged</h3>
            </div>
            {SAMPLE_ISSUES.map((c, i) => (
              <div key={c.id} style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", filter: i >= 2 ? "blur(3px)" : "none", userSelect: i >= 2 ? "none" : "auto" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
                    <span style={{ fontSize: "10px", fontWeight: 700, color: RISK_COLOR[c.risk], background: RISK_COLOR[c.risk] + "18", border: `1px solid ${RISK_COLOR[c.risk]}30`, borderRadius: "4px", padding: "1px 6px" }}>{c.risk}</span>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: i >= 2 ? "rgba(255,255,255,0.3)" : "#fff" }}>{c.label}</span>
                  </div>
                  <p style={{ fontSize: "12px", color: "rgba(148,163,184,0.5)", margin: 0 }}>{c.detail}</p>
                </div>
                {i >= 2 ? <span style={{ fontSize: "11px", color: "#f87171", fontWeight: 700 }}>🔒 Locked</span> : <span style={{ fontSize: "11px", color: "rgba(148,163,184,0.5)" }}>Visible</span>}
              </div>
            ))}
            <div style={{ padding: "14px 20px", background: "rgba(248,113,113,0.04)", fontSize: "12px", color: "rgba(148,163,184,0.6)" }}>
              🔒 3 more issues + full remediation unlocked in the blueprint
            </div>
          </div>
          <p style={{ fontSize: "12px", color: "rgba(148,163,184,0.5)", textAlign: "center" }}>This is a preview with sample data. Your actual score will reflect your real infrastructure answers.</p>
        </div>
      </div>
    </div>
  );
}

// ── LIVE FEED TICKER COMPONENT ────────────────────────────────────────────────
function LiveFeedTicker() {
  const STATIC_FEEDS = [
    { text: "James saved $2,400/mo",    provider: "AWS",   time: "2h ago" },
    { text: "Priya saved $1,800/mo",    provider: "GCP",   time: "5h ago" },
    { text: "Lukas saved $3,100/mo",    provider: "AWS",   time: "1h ago" },
    { text: "Fatima saved $960/mo",     provider: "Azure", time: "3h ago" },
    { text: "Dmitri saved $1,450/mo",   provider: "GCP",   time: "today" },
    { text: "Sofia saved $2,800/mo",    provider: "AWS",   time: "30m ago" },
    { text: "Chen saved $670/mo",       provider: "Azure", time: "4h ago" },
    { text: "Aisha saved $4,200/mo",    provider: "AWS",   time: "6h ago" },
    { text: "Marco saved $1,100/mo",    provider: "GCP",   time: "2h ago" },
    { text: "Yuki secured 4 critical",  provider: "AWS",   time: "1h ago" },
    { text: "Ravi fixed IAM wildcards", provider: "GCP",   time: "today" },
    { text: "Emma blocked public S3",   provider: "Azure", time: "3h ago" },
  ];

  function relativeTime(iso) {
    const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
    if (h < 1) return "< 1h ago";
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return d === 1 ? "yesterday" : `${d}d ago`;
  }

  const PROVIDER_COLORS = { AWS: "#ff9900", GCP: "#4285f4", Azure: "#0078d4" };

  const [feeds, setFeeds] = useState(STATIC_FEEDS);
  const [visibleIdx, setVisibleIdx] = useState([0, 1, 2]);
  const [fadingOut, setFadingOut] = useState([]);

  useEffect(() => {
    fetch('/api/public?type=leaderboard&limit=20')
      .then(r => r.json())
      .then(data => {
        const entries = (data.leaderboard || []).filter(
          e => e.company && e.company !== 'Anonymous' && e.monthlySavings
        );
        if (entries.length >= 5) {
          setFeeds(entries.slice(0, 12).map(e => ({
            text: `${e.company} found ${e.monthlySavings}/mo`,
            provider: e.provider || 'AWS',
            time: relativeTime(e.auditedAt),
          })));
        }
      })
      .catch(() => {}); // keep static on error or empty DB
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const outIdx = Math.floor(Math.random() * 3);
      setFadingOut([outIdx]);
      setTimeout(() => {
        setVisibleIdx(prev => {
          const next = [...prev];
          let newItem;
          do { newItem = Math.floor(Math.random() * feeds.length); }
          while (prev.includes(newItem));
          next[outIdx] = newItem;
          return next;
        });
        setFadingOut([]);
      }, 400);
    }, 3000);
    return () => clearInterval(interval);
  }, [feeds]);

  return (
    <div className="fade-up stagger-5" style={{ marginTop: "40px" }}>
      
      <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.85; transform: scale(1.2); }
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
    </div>
  );
}

// ── NAT GATEWAY CALCULATOR ────────────────────────────────────────────────────
function NATGatewayCalculator({ onRunAudit }) {
  const [gbMonth, setGbMonth] = useState('');
  const [pctS3, setPctS3] = useState(60);
  const [numGateways, setNumGateways] = useState(1);

  const gb = parseFloat(gbMonth) || 0;
  const pct = pctS3 / 100;
  const gateways = Math.max(1, parseInt(numGateways) || 1);

  // Current costs (us-east-1 rates)
  const dataProcessing = gb * 0.045;
  const hourly = gateways * 0.045 * 720;
  const totalCurrent = dataProcessing + hourly;

  // With VPC endpoints: Gateway endpoint (S3/DDB) = $0, Interface endpoint = $0.01/GB
  const s3SavingsGb = gb * pct;
  const otherGb = gb * (1 - pct);
  const savingsGateway = s3SavingsGb * 0.045;          // eliminated entirely
  const savingsInterface = otherGb * (0.045 - 0.01);   // reduced to $0.01/GB
  const totalSavings = savingsGateway + savingsInterface;
  const monthlySavings = Math.round(totalSavings);
  const annualSavings = monthlySavings * 12;
  const savingsPct = totalCurrent > 0 ? Math.round((totalSavings / dataProcessing) * 100) : 0;
  const hasResult = gb > 0;

  return (
    <div style={{ maxWidth: "780px", margin: "0 auto", padding: "80px 24px 80px", position: "relative", zIndex: 1 }}>
      <div style={{ textAlign: "center", marginBottom: "48px" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "7px", background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.25)", borderRadius: "20px", padding: "5px 14px", marginBottom: "20px" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "#fb923c", letterSpacing: "1px" }}>FREE CALCULATOR · NO SIGNUP</span>
        </div>
        <h1 className="display" style={{ fontSize: "clamp(28px,4.5vw,52px)", fontWeight: 800, letterSpacing: "-2px", color: "#fff", marginBottom: "14px", lineHeight: 1.05 }}>
          Am I Overpaying for<br /><span style={{ color: "#fb923c" }}>NAT Gateway?</span>
        </h1>
        <p style={{ fontSize: "15px", color: "var(--text-muted)", maxWidth: "520px", margin: "0 auto", lineHeight: 1.7 }}>
          NAT Gateway charges <strong style={{ color: "#fff" }}>$0.045/GB processed</strong> — including traffic to S3 and DynamoDB that a free VPC endpoint could route internally. Enter your numbers to see the saving.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "32px" }} className="calc-cards">
        {/* Input card */}
        <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "20px", padding: "32px" }}>
          <p style={{ fontSize: "13px", fontWeight: 700, color: "var(--green)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "24px" }}>Your Numbers</p>

          <div style={{ marginBottom: "24px" }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--text-dim)", marginBottom: "8px" }}>GB processed through NAT per month</label>
            <input type="number" value={gbMonth} onChange={e => setGbMonth(e.target.value)} placeholder="e.g. 2000"
              style={{ width: "100%", padding: "13px 16px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "16px", boxSizing: "border-box" }} />
            <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "5px" }}>Find this in CloudWatch → NatGateway → BytesOutToDestination</p>
          </div>

          <div style={{ marginBottom: "24px" }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--text-dim)", marginBottom: "8px" }}>
              % of traffic going to S3 or DynamoDB — <span style={{ color: "#fb923c" }}>{pctS3}%</span>
            </label>
            <input type="range" min="0" max="100" value={pctS3} onChange={e => setPctS3(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#fb923c" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
              <span>0% (none)</span><span>Most teams: 50–80%</span><span>100%</span>
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--text-dim)", marginBottom: "8px" }}>Number of NAT Gateways</label>
            <input type="number" min="1" max="20" value={numGateways} onChange={e => setNumGateways(e.target.value)} placeholder="1"
              style={{ width: "100%", padding: "13px 16px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "16px", boxSizing: "border-box" }} />
          </div>
        </div>

        {/* Result card */}
        <div style={{ background: hasResult ? "linear-gradient(135deg, rgba(251,146,60,0.08), rgba(0,255,180,0.05))" : "var(--bg2)", border: `1px solid ${hasResult ? "rgba(251,146,60,0.3)" : "var(--border)"}`, borderRadius: "20px", padding: "32px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          {hasResult ? (
            <>
              <div>
                <p style={{ fontSize: "11px", fontWeight: 700, color: "#fb923c", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "20px" }}>Your Savings Estimate</p>
                <div style={{ marginBottom: "20px" }}>
                  <p style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>Current monthly NAT data cost</p>
                  <p className="display" style={{ fontSize: "28px", fontWeight: 800, color: "#f87171", letterSpacing: "-1px" }}>${Math.round(dataProcessing).toLocaleString()}/mo</p>
                </div>
                <div style={{ height: "1px", background: "var(--border)", margin: "16px 0" }} />
                <div style={{ marginBottom: "20px" }}>
                  <p style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>Potential monthly saving</p>
                  <p className="display" style={{ fontSize: "36px", fontWeight: 800, color: "var(--green)", letterSpacing: "-1.5px" }}>−${monthlySavings.toLocaleString()}/mo</p>
                  <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>= ${annualSavings.toLocaleString()}/year · {savingsPct}% of data processing cost</p>
                </div>
                <div style={{ background: "rgba(0,255,180,0.06)", border: "1px solid rgba(0,255,180,0.15)", borderRadius: "10px", padding: "12px 16px" }}>
                  <p style={{ fontSize: "12px", color: "var(--text-dim)", lineHeight: 1.6 }}>
                    <strong style={{ color: "var(--green)" }}>Gateway endpoint for S3/DDB</strong> — free, eliminates ${Math.round(savingsGateway).toLocaleString()}/mo<br />
                    <strong style={{ color: "var(--green)" }}>Interface endpoints for others</strong> — $0.01/GB, saves ${Math.round(savingsInterface).toLocaleString()}/mo
                  </p>
                </div>
              </div>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "16px" }}>Rates: us-east-1. Actual savings vary by region and traffic mix.</p>
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", textAlign: "center" }}>
              <span style={{ fontSize: "48px", marginBottom: "16px", opacity: 0.3 }}>💡</span>
              <p style={{ color: "var(--text-muted)", fontSize: "14px", lineHeight: 1.6 }}>Enter your monthly GB to see your savings estimate.</p>
            </div>
          )}
        </div>
      </div>

      {/* CTA */}
      <div style={{ background: "linear-gradient(135deg, rgba(251,146,60,0.08) 0%, rgba(0,255,180,0.06) 100%)", border: "1px solid rgba(251,146,60,0.25)", borderRadius: "20px", padding: "32px", textAlign: "center" }}>
        <p style={{ fontSize: "13px", fontWeight: 700, color: "#fb923c", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "10px" }}>NAT Gateway is just 1 of 18 silent leaks</p>
        <h3 className="display" style={{ fontSize: "22px", fontWeight: 800, color: "#fff", letterSpacing: "-0.5px", marginBottom: "10px" }}>
          Run the full 15-minute audit to find the other 17.
        </h3>
        <p style={{ fontSize: "14px", color: "var(--text-muted)", marginBottom: "24px", maxWidth: "480px", margin: "0 auto 24px" }}>
          Compute, storage, database, governance — all 18 checks with savings estimates tied to your actual monthly bill. Free, no credentials required.
        </p>
        <button className="glow-btn" onClick={onRunAudit}
          style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "14px 36px", fontSize: "16px", boxShadow: "0 0 28px rgba(0,255,180,0.3)", cursor: "pointer" }}>
          Run Full Cost Audit — Free →
        </button>
        <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "10px" }}>No signup · No cloud access · Results in 15 minutes</p>
      </div>
    </div>
  );
}

// ── SPOT INSTANCE CALCULATOR ─────────────────────────────────────────────────
function SpotInstanceCalculator({ onRunAudit }) {
  const [hourlyRate, setHourlyRate] = useState('');
  const [hours, setHours] = useState(720);
  const [discount, setDiscount] = useState(70);

  const rate = parseFloat(hourlyRate) || 0;
  const hrs  = Math.max(1, Math.min(744, parseInt(hours) || 720));
  const discountPct = discount / 100;

  const onDemandMonthly = rate * hrs;
  const spotMonthly     = onDemandMonthly * (1 - discountPct);
  const monthlySavings  = Math.round(onDemandMonthly - spotMonthly);
  const annualSavings   = monthlySavings * 12;
  const hasResult       = rate > 0;

  return (
    <div style={{ maxWidth: "780px", margin: "0 auto", padding: "80px 24px 80px", position: "relative", zIndex: 1 }}>
      <div style={{ textAlign: "center", marginBottom: "48px" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "7px", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: "20px", padding: "5px 14px", marginBottom: "20px" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "#818cf8", letterSpacing: "1px" }}>FREE CALCULATOR · NO SIGNUP</span>
        </div>
        <h1 className="display" style={{ fontSize: "clamp(28px,4.5vw,52px)", fontWeight: 800, letterSpacing: "-2px", color: "#fff", marginBottom: "14px", lineHeight: 1.05 }}>
          How Much Would Spot<br /><span style={{ color: "#818cf8" }}>Actually Save Me?</span>
        </h1>
        <p style={{ fontSize: "15px", color: "var(--text-muted)", maxWidth: "520px", margin: "0 auto", lineHeight: 1.7 }}>
          Spot instances are <strong style={{ color: "#fff" }}>60–90% cheaper</strong> than on-demand for interruptible workloads. Enter your numbers to see the monthly saving on CI/CD runners, ML training, or batch jobs.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "24px" }} className="calc-cards">
        <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "20px", padding: "32px" }}>
          <p style={{ fontSize: "13px", fontWeight: 700, color: "#818cf8", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "24px" }}>Your Numbers</p>

          <div style={{ marginBottom: "24px" }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--text-dim)", marginBottom: "8px" }}>On-demand hourly rate (USD)</label>
            <input type="number" step="0.001" value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} placeholder="e.g. 0.192"
              style={{ width: "100%", padding: "13px 16px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "16px", boxSizing: "border-box" }} />
            <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "5px" }}>Find this at aws.amazon.com/ec2/pricing — e.g. m5.xlarge us-east-1 = $0.192/hr</p>
          </div>

          <div style={{ marginBottom: "24px" }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--text-dim)", marginBottom: "8px" }}>
              Monthly hours running — <span style={{ color: "#818cf8" }}>{hrs}h</span>
              {hrs === 720 && <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "6px" }}>(24/7)</span>}
            </label>
            <input type="range" min="1" max="744" value={hrs} onChange={e => setHours(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#818cf8" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
              <span>1h</span><span>720h = always on</span><span>744h</span>
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--text-dim)", marginBottom: "8px" }}>
              Spot discount vs on-demand — <span style={{ color: "#818cf8" }}>{discount}% off</span>
            </label>
            <input type="range" min="40" max="90" value={discount} onChange={e => setDiscount(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#818cf8" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
              <span>40% (conservative)</span><span>Typical: 60–80%</span><span>90%</span>
            </div>
          </div>
        </div>

        <div style={{ background: hasResult ? "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(0,255,180,0.05))" : "var(--bg2)", border: `1px solid ${hasResult ? "rgba(99,102,241,0.3)" : "var(--border)"}`, borderRadius: "20px", padding: "32px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          {hasResult ? (
            <>
              <div>
                <p style={{ fontSize: "11px", fontWeight: 700, color: "#818cf8", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "20px" }}>Your Savings Estimate</p>
                <div style={{ marginBottom: "20px" }}>
                  <p style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>Current on-demand monthly cost</p>
                  <p className="display" style={{ fontSize: "28px", fontWeight: 800, color: "#f87171", letterSpacing: "-1px" }}>${Math.round(onDemandMonthly).toLocaleString()}/mo</p>
                </div>
                <div style={{ height: "1px", background: "var(--border)", margin: "16px 0" }} />
                <div style={{ marginBottom: "20px" }}>
                  <p style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>Potential monthly saving with Spot</p>
                  <p className="display" style={{ fontSize: "36px", fontWeight: 800, color: "var(--green)", letterSpacing: "-1.5px" }}>−${monthlySavings.toLocaleString()}/mo</p>
                  <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>= ${annualSavings.toLocaleString()}/year · {discount}% cheaper on Spot</p>
                </div>
                <div style={{ background: "rgba(129,140,248,0.06)", border: "1px solid rgba(129,140,248,0.2)", borderRadius: "10px", padding: "12px 16px" }}>
                  <p style={{ fontSize: "12px", color: "var(--text-dim)", lineHeight: 1.6 }}>
                    <strong style={{ color: "#818cf8" }}>Spot effective rate</strong> — ${(rate * (1 - discountPct)).toFixed(4)}/hr<br />
                    <strong style={{ color: "#818cf8" }}>Avg interruption rate</strong> — ~5% (varies by instance &amp; AZ)
                  </p>
                </div>
              </div>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "16px" }}>Spot discounts vary by region, instance family, and demand. Check EC2 Spot price history for live rates.</p>
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", textAlign: "center" }}>
              <span style={{ fontSize: "48px", marginBottom: "16px", opacity: 0.3 }}>⚡</span>
              <p style={{ color: "var(--text-muted)", fontSize: "14px", lineHeight: 1.6 }}>Enter your on-demand hourly rate above to see your Spot savings estimate.</p>
            </div>
          )}
        </div>
      </div>

      <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "16px", padding: "24px 28px", marginBottom: "24px" }}>
        <p style={{ fontSize: "12px", fontWeight: 700, color: "#818cf8", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "16px" }}>Best workloads for Spot instances</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
          {[
            { icon: "🔄", label: "CI/CD runners", detail: "GitHub Actions, GitLab CI — auto-retry handles interruptions" },
            { icon: "🧠", label: "ML training jobs", detail: "Checkpointing to S3 means interruptions cost minutes, not hours" },
            { icon: "📦", label: "Batch processing", detail: "ETL, data transforms, media encoding, nightly reports" },
            { icon: "🧪", label: "Dev & test envs", detail: "Non-critical, restartable workloads that don't serve live users" },
          ].map(u => (
            <div key={u.label} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
              <span style={{ fontSize: "18px", flexShrink: 0 }}>{u.icon}</span>
              <div>
                <p style={{ fontSize: "13px", fontWeight: 700, color: "#fff", margin: "0 0 2px" }}>{u.label}</p>
                <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>{u.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(0,255,180,0.06) 100%)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: "20px", padding: "32px", textAlign: "center" }}>
        <p style={{ fontSize: "13px", fontWeight: 700, color: "#818cf8", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "10px" }}>Spot is just 1 of 18 compute savings</p>
        <h3 className="display" style={{ fontSize: "22px", fontWeight: 800, color: "#fff", letterSpacing: "-0.5px", marginBottom: "10px" }}>
          Run the full audit to find the other 17.
        </h3>
        <p style={{ fontSize: "14px", color: "var(--text-muted)", marginBottom: "24px", maxWidth: "480px", margin: "0 auto 24px" }}>
          Storage, databases, network, governance — all 18 checks with savings estimates tied to your actual monthly bill. Free, no credentials required.
        </p>
        <button className="glow-btn" onClick={onRunAudit}
          style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "14px 36px", fontSize: "16px", boxShadow: "0 0 28px rgba(0,255,180,0.3)", cursor: "pointer" }}>
          Run Full Cost Audit — Free →
        </button>
        <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "10px" }}>No signup · No cloud access · Results in 15 minutes</p>
      </div>
    </div>
  );
}

// ── MODULE-LEVEL CONSTANTS — defined once, never recreated on render ─────────
const WALL_SAVINGS = [
  { company: "Fintech · London",        provider: "AWS",   issues: 11, savings: "$1,240–$3,100/mo", time: "14 min" },
  { company: "SaaS · Berlin",           provider: "GCP",   issues: 8,  savings: "$610–$1,520/mo",   time: "12 min" },
  { company: "E-commerce · US",         provider: "AWS",   issues: 14, savings: "$2,100–$5,300/mo", time: "18 min", variant: "before_after", billBefore: "$8,000", billAfter: "$5,600" },
  { company: "HealthTech · Amsterdam",  provider: "Azure", issues: 6,  savings: "$380–$940/mo",     time: "11 min" },
  { company: "Agency · Toronto",        provider: "AWS",   issues: 9,  savings: "$720–$1,800/mo",   time: "15 min" },
  { company: "Startup · Singapore",     provider: "GCP",   issues: 5,  savings: "$290–$730/mo",     time: "10 min", variant: "waste_score", score: 28 },
  { company: "Healthcare · Toronto",    provider: "GCP",   issues: 9,  savings: "$520–$1,100/mo",   time: "13 min" },
  { company: "Media · Amsterdam",       provider: "Azure", issues: 7,  savings: "$380–$890/mo",     time: "11 min" },
  { company: "Gaming · Sydney",         provider: "AWS",   issues: 11, savings: "$1,200–$2,800/mo", time: "16 min", variant: "time_saved" },
];
const PROVIDER_BADGE_COLOR = { AWS: "#ff9900", GCP: "#4285f4", Azure: "#0078d4", "Multi-Cloud": "#00ffb4" };

const TESTIMONIALS = [
  { name: "James K.", role: "Senior DevOps Engineer · London fintech", text: "Found $2,400/mo in idle RDS instances on the first audit. The blueprint gave me the exact Terraform to fix it. Took 40 minutes to implement.", savings: "$2,400/mo", provider: "AWS" },
  { name: "Priya S.", role: "Cloud Architect · Singapore SaaS", text: "We were on full on-demand pricing for 18 months. One Savings Plan switch later — $1,800/month saved. Blueprint paid for itself in week one.", savings: "$1,800/mo", provider: "GCP" },
  { name: "Marco D.", role: "Infrastructure Lead · Milan e-commerce", text: "Orphaned EBS volumes and a forgotten NAT Gateway were costing us $960/month. CLI commands were copy-paste ready. Fixed same afternoon.", savings: "$960/mo", provider: "Azure" },
];

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC AUDIT VIEWER - Shows shared audits at /audit/{slug}
// ══════════════════════════════════════════════════════════════════════════════
function PublicAuditViewer({ slug }) {
  const [audit, setAudit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchAudit = async () => {
      try {
        const res = await fetch(`/api/public?type=audit&id=${slug}`);
        const data = await res.json();
        
        if (data.success) {
          setAudit(data.audit);
        } else {
          setError(data.error || 'Audit not found');
        }
      } catch (err) {
        setError('Failed to load audit');
      } finally {
        setLoading(false);
      }
    };
    
    fetchAudit();
  }, [slug]);

  const getGradeColor = (grade) => {
    if (!grade) return '#94a3b8';
    if (grade.startsWith('A')) return '#4ade80';
    if (grade.startsWith('B')) return '#fbbf24';
    if (grade.startsWith('C')) return '#fb923c';
    return '#f87171';
  };

  if (loading) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        background: '#07070f', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        padding: '24px',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
          <p style={{ color: '#94a3b8', fontSize: '16px' }}>Loading audit...</p>
        </div>
      </div>
    );
  }

  if (error || !audit) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        background: '#07070f', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        padding: '24px',
      }}>
        <div style={{ textAlign: 'center', maxWidth: '500px' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>🔍</div>
          <h1 style={{ color: '#fff', fontSize: '32px', fontWeight: 800, marginBottom: '12px' }}>
            Audit Not Found
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '16px', marginBottom: '24px' }}>
            {error || 'This audit does not exist or has not been shared publicly.'}
          </p>
          <a href="/" style={{
            display: 'inline-block',
            background: 'var(--green)',
            color: '#000',
            padding: '14px 28px',
            borderRadius: '10px',
            fontWeight: 700,
            textDecoration: 'none',
          }}>
            Run Your Own Audit →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: '#07070f', 
      padding: '40px 24px',
    }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <a href="/" style={{ 
            display: 'inline-block',
            fontSize: '24px',
            fontWeight: 800,
            color: 'var(--green)',
            textDecoration: 'none',
            marginBottom: '32px',
          }}>
            KloudAudit
          </a>
          <h1 style={{ 
            fontSize: 'clamp(28px, 4vw, 42px)', 
            fontWeight: 800, 
            color: '#fff',
            marginBottom: '8px',
            letterSpacing: '-1px',
          }}>
            {audit.companyName}'s Cloud Audit
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '16px' }}>
            {audit.provider} · {new Date(audit.createdAt).toLocaleDateString()} · {audit.viewCount} views
          </p>
        </div>

        {/* Score Badge */}
        <div style={{
          background: `${getGradeColor(audit.letterGrade)}10`,
          border: `2px solid ${getGradeColor(audit.letterGrade)}`,
          borderRadius: '20px',
          padding: '40px',
          marginBottom: '32px',
          textAlign: 'center',
        }}>
          <div style={{
            fontSize: '72px',
            fontWeight: 900,
            color: getGradeColor(audit.letterGrade),
            marginBottom: '8px',
            lineHeight: 1,
          }}>
            {audit.letterGrade}
          </div>
          <div style={{ fontSize: '16px', color: '#94a3b8', marginBottom: '4px' }}>
            EFFICIENCY SCORE
          </div>
          <div style={{ fontSize: '42px', fontWeight: 800, color: getGradeColor(audit.letterGrade) }}>
            {audit.wasteScore}<span style={{ fontSize: '24px', opacity: 0.6 }}>/100</span>
          </div>
        </div>

        {/* Stats Grid */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
          gap: '16px',
          marginBottom: '32px',
        }}>
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '16px',
            padding: '24px',
          }}>
            <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>
              Monthly Bill
            </div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#fff' }}>
              ${audit.monthlyBill?.toLocaleString() || 'N/A'}
            </div>
          </div>

          <div style={{
            background: 'rgba(0,255,180,0.05)',
            border: '1px solid rgba(0,255,180,0.2)',
            borderRadius: '16px',
            padding: '24px',
          }}>
            <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>
              Potential Savings
            </div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--green)' }}>
              ${audit.savingsMin?.toLocaleString()}–${audit.savingsMax?.toLocaleString()}
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
              /month
            </div>
          </div>

          <div style={{
            background: 'rgba(251,146,60,0.05)',
            border: '1px solid rgba(251,146,60,0.2)',
            borderRadius: '16px',
            padding: '24px',
          }}>
            <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>
              Issues Found
            </div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#fb923c' }}>
              {audit.flaggedCount}
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
              optimization opportunities
            </div>
          </div>
        </div>

        {/* CTA */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(0,255,180,0.1), rgba(99,102,241,0.1))',
          border: '1px solid rgba(0,255,180,0.3)',
          borderRadius: '20px',
          padding: '40px',
          textAlign: 'center',
        }}>
          <h2 style={{ 
            fontSize: '24px', 
            fontWeight: 800, 
            color: '#fff', 
            marginBottom: '12px',
          }}>
            Want to audit your own cloud?
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '16px', marginBottom: '24px' }}>
            Free audit takes 15 minutes. No account access needed.
          </p>
          <a href="/" style={{
            display: 'inline-block',
            background: 'var(--green)',
            color: '#000',
            padding: '16px 32px',
            borderRadius: '12px',
            fontWeight: 800,
            fontSize: '16px',
            textDecoration: 'none',
            boxShadow: '0 4px 20px rgba(0,255,180,0.3)',
          }}>
            Start Free Audit →
          </a>
        </div>

      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SCORE BADGE - Shows A-F grade
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// SCORE BADGE - Shows A-F grade
// ══════════════════════════════════════════════════════════════════════════════
function ScoreBadge({ letterGrade, wasteScore }) {
  const getColor = (grade) => {
    if (!grade) return '#94a3b8';
    if (grade.startsWith('A')) return '#4ade80';
    if (grade.startsWith('B')) return '#fbbf24';
    if (grade.startsWith('C')) return '#fb923c';
    return '#f87171';
  };

  if (!letterGrade || !wasteScore) return null;

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '16px',
      background: `${getColor(letterGrade)}10`,
      border: `2px solid ${getColor(letterGrade)}`,
      borderRadius: '16px',
      padding: '20px 28px',
      marginTop: '32px',
      marginBottom: '24px',
    }}>
      <div style={{
        fontSize: '56px',
        fontWeight: 900,
        color: getColor(letterGrade),
        lineHeight: 1,
      }}>
        {letterGrade}
      </div>
      <div>
        <div style={{ fontSize: '13px', opacity: 0.6, marginBottom: '4px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
          Efficiency Score
        </div>
        <div style={{ fontSize: '32px', fontWeight: 800, color: getColor(letterGrade) }}>
          {wasteScore}<span style={{ fontSize: '20px', opacity: 0.6 }}>/100</span>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SHARE BUTTON - Generate shareable public link
// ══════════════════════════════════════════════════════════════════════════════
function ShareButton({ sessionId, companyName, onShareUrl }) {
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  const handleShare = async () => {
    setSharing(true);
    setError(null);
    
    try {
      const res = await fetch('/api/audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'share',
          sessionId: sessionId,
          isPublic: true,
          displayName: companyName || 'Anonymous Company',
        }),
      });
      
      const data = await res.json();
      
      if (data.success && data.shareUrl) {
        onShareUrl(data.shareUrl);
        await navigator.clipboard.writeText(data.shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      } else {
        setError('Failed to generate share link');
      }
    } catch (err) {
      console.error('Share failed:', err);
      setError('Network error. Please try again.');
    } finally {
      setSharing(false);
    }
  };

  return (
    <div style={{ marginTop: '20px' }}>
      <button 
        onClick={handleShare}
        disabled={sharing}
        style={{
          background: copied ? '#4ade80' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: '#fff',
          border: 'none',
          borderRadius: '12px',
          padding: '16px 32px',
          fontSize: '16px',
          fontWeight: 700,
          cursor: sharing ? 'not-allowed' : 'pointer',
          transition: 'all 0.3s',
          opacity: sharing ? 0.7 : 1,
          transform: sharing ? 'scale(0.98)' : 'scale(1)',
          boxShadow: '0 4px 20px rgba(102, 126, 234, 0.3)',
          width: '100%',
        }}
      >
        {sharing ? '⏳ Generating Link...' : copied ? '✓ Link Copied to Clipboard!' : '🔗 Share Your Results'}
      </button>
      
      {error && (
        <div style={{
          marginTop: '12px',
          padding: '12px',
          background: 'rgba(248, 113, 113, 0.1)',
          border: '1px solid rgba(248, 113, 113, 0.3)',
          borderRadius: '8px',
          fontSize: '13px',
          color: '#f87171',
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// LEADERBOARD OPT-IN - Add to public rankings
// ══════════════════════════════════════════════════════════════════════════════
function LeaderboardOptIn({ sessionId, companyName, onRank }) {
  const [opted, setOpted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleOptIn = async (checked) => {
    setLoading(true);
    
    try {
      const res = await fetch('/api/audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'leaderboard-opt-in',
          sessionId: sessionId,
          publicDisplay: checked,
          displayName: companyName || 'Anonymous',
        }),
      });
      
      const data = await res.json();
      
      if (data.success) {
        setOpted(data.publicDisplay);
        if (data.rank) {
          onRank(data.rank);
        }
      }
    } catch (err) {
      console.error('Opt-in failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      background: 'rgba(74, 222, 128, 0.06)',
      border: '1px solid rgba(74, 222, 128, 0.2)',
      borderRadius: '14px',
      padding: '20px',
      marginTop: '20px',
    }}>
      <label style={{ 
        display: 'flex', 
        alignItems: 'flex-start', 
        gap: '14px', 
        cursor: loading ? 'wait' : 'pointer',
      }}>
        <input 
          type="checkbox" 
          checked={opted}
          onChange={(e) => handleOptIn(e.target.checked)}
          disabled={loading}
          style={{ 
            width: '22px', 
            height: '22px', 
            marginTop: '2px',
            cursor: loading ? 'wait' : 'pointer',
          }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '6px', color: '#fff' }}>
            🏆 Add my score to the public leaderboard
          </div>
          <div style={{ fontSize: '13px', opacity: 0.7, lineHeight: 1.5 }}>
            Showcase your optimized cloud infrastructure and compete with other companies
          </div>
        </div>
      </label>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SHARE URL DISPLAY - Show the generated link
// ══════════════════════════════════════════════════════════════════════════════
function ShareUrlDisplay({ url, rank }) {
  if (!url) return null;
  
  return (
    <div style={{
      background: 'rgba(102, 126, 234, 0.08)',
      border: '1px solid rgba(102, 126, 234, 0.25)',
      borderRadius: '12px',
      padding: '20px',
      marginTop: '20px',
    }}>
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#667eea', marginBottom: '10px', letterSpacing: '0.5px' }}>
        ✨ YOUR SHAREABLE LINK
      </div>
      <a 
        href={url} 
        target="_blank" 
        rel="noopener noreferrer" 
        style={{ 
          color: '#667eea', 
          fontSize: '14px', 
          wordBreak: 'break-all',
          textDecoration: 'underline',
          fontWeight: 600,
        }}
      >
        {url}
      </a>
      
      {rank && (
        <div style={{
          marginTop: '16px',
          padding: '12px',
          background: 'rgba(74, 222, 128, 0.1)',
          borderRadius: '8px',
          textAlign: 'center',
        }}>
          <span style={{ fontSize: '14px', fontWeight: 700, color: '#4ade80' }}>
            🎯 You're ranked #{rank} on the leaderboard!
          </span>
        </div>
      )}
    </div>
  );
}

// ── WASTE SCORE CARD ──────────────────────────────────────────────────────────
function WasteScoreCard({ flagged, allChecks, savPct, savMin, savMax, onShare }) {
  const issueWeight = Math.min(flagged.length / allChecks.length, 1) * 30;
  const pctWeight   = Math.min(savPct / 50, 1) * 70;
  const score       = Math.max(0, Math.min(100, Math.round(100 - issueWeight - pctWeight)));
  const grade       = score >= 80 ? { label: "Well Optimised",    color: "#4ade80", ring: "#4ade80" }
                    : score >= 60 ? { label: "Needs Attention",   color: "#fbbf24", ring: "#fbbf24" }
                    : score >= 40 ? { label: "Significant Waste", color: "#fb923c", ring: "#fb923c" }
                    :               { label: "Critical Waste",    color: "#f87171", ring: "#f87171" };
  const circ   = 2 * Math.PI * 54;
  const offset = circ * (1 - score / 100);

  return (
    <div className="fade-up" style={{ background: "var(--bg2)", border: `1px solid ${grade.ring}30`, borderRadius: "20px", padding: "36px", marginBottom: "24px", display: "flex", alignItems: "center", gap: "40px", flexWrap: "wrap" }}>
      <div style={{ position: "relative", flexShrink: 0 }}>
        <svg width="130" height="130" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="65" cy="65" r="54" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
          <circle cx="65" cy="65" r="54" fill="none"
            stroke={grade.ring} strokeWidth="10"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)", filter: `drop-shadow(0 0 8px ${grade.ring}60)` }}
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span className="display" style={{ fontSize: "32px", fontWeight: 800, color: grade.color, letterSpacing: "-1px", lineHeight: 1 }}>{score}</span>
          <span style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 600, letterSpacing: "1px" }}>/ 100</span>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: "200px" }}>
        <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "8px" }}>KloudAudit Waste Score</p>
        <h2 className="display" style={{ fontSize: "28px", fontWeight: 800, color: grade.color, letterSpacing: "-0.8px", marginBottom: "8px" }}>{grade.label}</h2>
        <p style={{ fontSize: "14px", color: "var(--text-muted)", lineHeight: 1.65, marginBottom: "16px" }}>
          {score >= 80
            ? `Your infrastructure is well managed. The ${flagged.length} issue${flagged.length > 1 ? "s" : ""} found are optimisation opportunities rather than critical problems.`
            : score >= 60
            ? `Your bill has identifiable waste. The ${flagged.length} flagged issue${flagged.length > 1 ? "s" : ""} represent ~${savPct}% of your monthly spend.`
            : score >= 40
            ? `Significant waste detected. Your team is paying roughly $${savMin.toLocaleString()}–$${savMax.toLocaleString()}/month more than necessary.`
            : `Critical waste level. Unaddressed issues are costing $${(savMin * 12).toLocaleString()}+ per year. Immediate action recommended.`
          }
        </p>
        <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: "8px", padding: "12px 16px", border: "1px solid rgba(255,255,255,0.06)" }}>
          <p style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "8px", fontWeight: 600 }}>Industry benchmark</p>
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            {[
              { range: "0–39",   label: "Critical", color: "#f87171", active: score < 40 },
              { range: "40–59",  label: "Poor",     color: "#fb923c", active: score >= 40 && score < 60 },
              { range: "60–79",  label: "Fair",     color: "#fbbf24", active: score >= 60 && score < 80 },
              { range: "80–100", label: "Good",     color: "#4ade80", active: score >= 80 },
            ].map(b => (
              <div key={b.range} style={{ flex: 1, height: "6px", borderRadius: "3px", background: b.active ? b.color : b.color + "30", boxShadow: b.active ? `0 0 8px ${b.color}60` : "none" }} />
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px" }}>
            <span style={{ fontSize: "10px", color: "#f87171" }}>Critical</span>
            <span style={{ fontSize: "10px", color: "#4ade80" }}>Good</span>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", flexShrink: 0 }}>
        <button onClick={onShare}
          style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: "10px", padding: "10px 18px", color: "#a5b4fc", fontSize: "13px", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
          📤 Share Score
        </button>
        <p style={{ fontSize: "10px", color: "var(--text-muted)", textAlign: "center" }}>Share on LinkedIn</p>
      </div>
    </div>
  );
}


const SESSION_VERSION = 1;
const RESTORABLE_STEPS = ['intake', 'audit', 'email_gate', 'report'];

// ── BLUEPRINT MODAL ───────────────────────────────────────────────────────────
// Defined OUTSIDE App so React never sees a new component type on re-render.
// Owns its own email + status state → zero flicker while typing.
const BlueprintModal = memo(function BlueprintModal({ onClose, onBuy, currency, provider, flaggedCount }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | error
  const [errorMsg, setErrorMsg] = useState("");
  const [withdrawalChecked, setWithdrawalChecked] = useState(false);

  const handleSubmit = async () => {
    if (!email || !withdrawalChecked) return;
    setStatus("loading");
    try {
      await onBuy(email);
      // onBuy redirects to Stripe on success — execution stops here
    } catch (err) {
      setErrorMsg(err?.message || "Unknown error");
      setStatus("error");
      setTimeout(() => setStatus("idle"), 6000);
    }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.88)", backdropFilter: "blur(14px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", animation: "fadeIn 0.2s ease" }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="blueprint-dialog-title" style={{ background: "var(--bg2)", border: "1px solid rgba(0,255,180,0.2)", borderRadius: "20px", maxWidth: "460px", width: "100%", padding: "36px", boxShadow: "0 40px 80px rgba(0,0,0,0.8)", animation: "scaleIn 0.3s cubic-bezier(0.34,1.56,0.64,1)" }}>
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <div style={{ fontSize: "40px", marginBottom: "12px" }}>📄</div>
          <h2 id="blueprint-dialog-title" className="display" style={{ fontSize: "24px", fontWeight: 800, color: "#fff", letterSpacing: "-0.5px", marginBottom: "8px" }}>Get Your AI Blueprint</h2>
          <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.6 }}>
            Enter your email and you&apos;ll be redirected to secure payment. Your personalised {provider || "cloud"} implementation guide lands in your inbox within 2 minutes of payment.
          </p>
        </div>
        <div style={{ background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "10px", padding: "14px 18px", marginBottom: "20px" }}>
          <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "10px", letterSpacing: "1px", textTransform: "uppercase" }}>What you get:</p>
          {[`Exact ${provider || "cloud"} CLI commands`, "Terraform snippets per issue", "Step-by-step fix instructions", `${flaggedCount} issues with savings estimates`, "PDF in your inbox in ~2 minutes"].map(f => (
            <div key={f} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <span style={{ color: "var(--green)", fontSize: "13px" }}>✓</span>
              <span style={{ fontSize: "13px", color: "var(--text-dim)" }}>{f}</span>
            </div>
          ))}
        </div>
        <label htmlFor="blueprint-email" style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "1px" }}>Your Email</label>
        <input
          id="blueprint-email"
          type="email"
          placeholder="you@company.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === "Enter" && email && handleSubmit()}
          style={{ width: "100%", padding: "13px 16px", background: "rgba(255,255,255,0.06)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "15px", fontFamily: "var(--body)", marginBottom: "14px" }}
          autoFocus
        />
        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "14px", padding: "12px 14px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px" }}>
          <input type="checkbox" id="withdrawal-cost" required checked={withdrawalChecked} onChange={e => setWithdrawalChecked(e.target.checked)} style={{ marginTop: "2px", accentColor: "#00ffb4", flexShrink: 0, cursor: "pointer" }} />
          <label htmlFor="withdrawal-cost" style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.55, cursor: "pointer" }}>
            I understand this is a digital product delivered immediately and I waive my right of withdrawal upon delivery. See <a href="https://www.kloudaudit.eu/terms/" target="_blank" rel="noopener" style={{ color: "#00ffb4" }}>Terms</a>.
          </label>
        </div>
        <button className="glow-btn" onClick={handleSubmit}
          disabled={status === "loading" || !withdrawalChecked}
          style={{ background: withdrawalChecked ? "var(--green)" : "rgba(0,255,180,0.4)", color: "#000", border: "none", borderRadius: "12px", padding: "14px", fontSize: "15px", width: "100%", cursor: withdrawalChecked ? "pointer" : "not-allowed", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
          {status === "loading" ? (
            <><span style={{ display: "inline-block", width: "15px", height: "15px", border: "2px solid #000", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} /> Redirecting to payment...</>
          ) : `Pay ${currency.blueprintPrice} → Get Blueprint`}
        </button>
        <p style={{ fontSize: "12px", color: "var(--text-muted)", textAlign: "center", marginTop: "8px", marginBottom: "0" }}>🕐 Delivered to your inbox in ~2 minutes</p>
        {status === "error" && <p style={{ color: "#f87171", fontSize: "12px", textAlign: "center", marginTop: "10px" }}>Error: {errorMsg} — email admin@kloudaudit.eu</p>}
        <p style={{ fontSize: "12px", color: "var(--text-dim)", textAlign: "center", marginTop: "14px", lineHeight: 1.6 }}>💚 If the Blueprint doesn&apos;t identify at least one actionable fix, email <a href="mailto:admin@kloudaudit.eu" style={{ color: "var(--green)", textDecoration: "none" }}>admin@kloudaudit.eu</a> for a full refund. No questions asked.</p>
        <p style={{ fontSize: "11px", color: "var(--text-muted)", textAlign: "center", marginTop: "10px" }}>🔒 Secure payment via Stripe · Prices inclusive of applicable taxes · admin@kloudaudit.eu</p>
        <button onClick={onClose} style={{ display: "block", margin: "12px auto 0", background: "none", border: "none", color: "var(--text-muted)", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
      </div>
    </div>
  );
});

// ── CFO REPORT MODAL ─────────────────────────────────────────────────────────
const CfoReportModal = memo(function CfoReportModal({ onClose, onBuy, currency, provider, savMin, savMax, flaggedCount }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [withdrawalChecked, setWithdrawalChecked] = useState(false);

  const annualMin = (savMin * 12).toLocaleString();
  const annualMax = (savMax * 12).toLocaleString();

  const handleSubmit = async () => {
    if (!email || !withdrawalChecked) return;
    setStatus("loading");
    try {
      await onBuy(email);
    } catch (err) {
      setErrorMsg(err?.message || "Unknown error");
      setStatus("error");
      setTimeout(() => setStatus("idle"), 6000);
    }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.88)", backdropFilter: "blur(14px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", animation: "fadeIn 0.2s ease" }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" style={{ background: "var(--bg2)", border: "1px solid rgba(129,140,248,0.3)", borderRadius: "20px", maxWidth: "480px", width: "100%", padding: "36px", boxShadow: "0 40px 80px rgba(0,0,0,0.8)", animation: "scaleIn 0.3s cubic-bezier(0.34,1.56,0.64,1)" }}>
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <div style={{ fontSize: "40px", marginBottom: "12px" }}>📊</div>
          <h2 className="display" style={{ fontSize: "24px", fontWeight: 800, color: "#fff", letterSpacing: "-0.5px", marginBottom: "8px" }}>CFO & Board Report</h2>
          <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.6 }}>
            Executive-grade cloud cost analysis — no CLI commands, no Terraform. Written for leadership and ready to share with your board or investors.
          </p>
        </div>
        {savMin > 0 && (
          <div style={{ background: "rgba(129,140,248,0.08)", border: "1px solid rgba(129,140,248,0.25)", borderRadius: "10px", padding: "14px 18px", marginBottom: "20px", textAlign: "center" }}>
            <p style={{ fontSize: "11px", color: "#818cf8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "6px" }}>Annual savings in this report</p>
            <p className="display" style={{ fontSize: "22px", fontWeight: 800, color: "#818cf8", letterSpacing: "-0.5px", margin: 0 }}>${annualMin}–${annualMax}/year</p>
          </div>
        )}
        <div style={{ background: "rgba(129,140,248,0.05)", border: "1px solid rgba(129,140,248,0.15)", borderRadius: "10px", padding: "14px 18px", marginBottom: "20px" }}>
          <p style={{ fontSize: "11px", fontWeight: 700, color: "#818cf8", marginBottom: "10px", letterSpacing: "1px", textTransform: "uppercase" }}>What's included:</p>
          {[
            "Executive summary — board-ready language",
            "Financial impact table with annual ROI",
            `${flaggedCount} prioritised findings, ranked by dollar impact`,
            "3-phase action plan for leadership sign-off",
            "Delivered to your inbox in ~2 minutes",
          ].map(f => (
            <div key={f} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <span style={{ color: "#818cf8", fontSize: "13px" }}>✓</span>
              <span style={{ fontSize: "13px", color: "var(--text-dim)" }}>{f}</span>
            </div>
          ))}
        </div>
        <label htmlFor="cfo-email" style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#818cf8", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "1px" }}>Your Email</label>
        <input
          id="cfo-email"
          type="email"
          placeholder="cto@company.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === "Enter" && email && handleSubmit()}
          style={{ width: "100%", padding: "13px 16px", background: "rgba(255,255,255,0.06)", border: "1.5px solid rgba(129,140,248,0.3)", borderRadius: "10px", color: "#fff", fontSize: "15px", fontFamily: "var(--body)", marginBottom: "14px" }}
          autoFocus
        />
        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "14px", padding: "12px 14px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px" }}>
          <input type="checkbox" id="withdrawal-cfo" required checked={withdrawalChecked} onChange={e => setWithdrawalChecked(e.target.checked)} style={{ marginTop: "2px", accentColor: "#818cf8", flexShrink: 0, cursor: "pointer" }} />
          <label htmlFor="withdrawal-cfo" style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.55, cursor: "pointer" }}>
            I understand this is a digital product delivered immediately and I waive my right of withdrawal upon delivery. See <a href="https://www.kloudaudit.eu/terms/" target="_blank" rel="noopener" style={{ color: "#818cf8" }}>Terms</a>.
          </label>
        </div>
        <button onClick={handleSubmit}
          disabled={status === "loading" || !withdrawalChecked}
          style={{ background: withdrawalChecked ? "linear-gradient(135deg,#818cf8,#6366f1)" : "rgba(99,102,241,0.3)", color: "#fff", border: "none", borderRadius: "12px", padding: "14px", fontSize: "15px", fontWeight: 800, width: "100%", cursor: withdrawalChecked ? "pointer" : "not-allowed", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", boxShadow: withdrawalChecked ? "0 4px 20px rgba(99,102,241,0.4)" : "none" }}>
          {status === "loading" ? (
            <><span style={{ display: "inline-block", width: "15px", height: "15px", border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} /> Redirecting to payment...</>
          ) : `Pay ${currency.cfoReportPrice || "$199"} → Get Board Report`}
        </button>
        <p style={{ fontSize: "12px", color: "var(--text-muted)", textAlign: "center", marginTop: "8px" }}>🕐 Delivered to your inbox in ~2 minutes</p>
        {status === "error" && <p style={{ color: "#f87171", fontSize: "12px", textAlign: "center", marginTop: "10px" }}>Error: {errorMsg} — email admin@kloudaudit.eu</p>}
        <p style={{ fontSize: "11px", color: "var(--text-muted)", textAlign: "center", marginTop: "14px" }}>🔒 Secure payment via Stripe · admin@kloudaudit.eu</p>
        <button onClick={onClose} style={{ display: "block", margin: "12px auto 0", background: "none", border: "none", color: "var(--text-muted)", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
      </div>
    </div>
  );
});

// ── PRICING MODAL ─────────────────────────────────────────────────────────────
const PricingModal = memo(function PricingModal({
  onClose, currency,
  onStartAudit, onStartSecAudit,
  onBlueprintClick, onSecBlueprintClick, onCfoReportClick, onSessionClick,
  onSubscribe,
}) {
  const [subEmail, setSubEmail] = useState('');
  const [subStatus, setSubStatus] = useState('idle');

  const handleSubscribe = async () => {
    if (!subEmail) return;
    setSubStatus('loading');
    try {
      await onSubscribe(subEmail);
    } catch {
      setSubStatus('error');
      setTimeout(() => setSubStatus('idle'), 4000);
    }
  };

  const PRODUCTS = [
    {
      id: 'free',
      icon: '✅',
      label: 'Free Audit',
      badge: null,
      badgeColor: null,
      price: '$0',
      priceSub: 'forever free',
      color: '#4ade80',
      border: 'rgba(74,222,128,0.2)',
      bg: 'rgba(74,222,128,0.04)',
      features: ['18 cost + 16 security checks', 'Dollar savings per issue', 'Waste score & shareable link'],
      cta: 'Start Free Audit →',
      onClick: () => { onClose(); onStartAudit(); },
    },
    {
      id: 'blueprint',
      icon: '⚡',
      label: 'Cost Blueprint',
      badge: 'Most popular',
      badgeColor: '#00ffb4',
      price: currency.blueprintPrice,
      priceSub: 'one-time',
      color: '#00ffb4',
      border: 'rgba(0,255,180,0.35)',
      bg: 'rgba(0,255,180,0.05)',
      features: ['Exact CLI commands per issue', 'Terraform / IaC snippets', 'Step-by-step · Delivered in 2 min'],
      cta: `Get Cost Blueprint →`,
      onClick: () => { onClose(); onBlueprintClick(); },
    },
    {
      id: 'security',
      icon: '🛡',
      label: 'Security Blueprint',
      badge: 'High ROI',
      badgeColor: '#f87171',
      price: currency.securityPrice || '$29',
      priceSub: 'one-time',
      color: '#f87171',
      border: 'rgba(248,113,113,0.25)',
      bg: 'rgba(248,113,113,0.04)',
      features: ['IAM policy templates ready to deploy', 'Compliance gap mapping (SOC 2, GDPR)', '30-day prioritised remediation roadmap'],
      cta: 'Get Security Blueprint →',
      onClick: () => { onClose(); onSecBlueprintClick(); },
    },
    {
      id: 'cfo',
      icon: '📊',
      label: 'CFO & Board Report',
      badge: 'New',
      badgeColor: '#818cf8',
      price: currency.cfoReportPrice || '$199',
      priceSub: 'one-time',
      color: '#818cf8',
      border: 'rgba(129,140,248,0.3)',
      bg: 'rgba(99,102,241,0.05)',
      features: ['Executive summary for board/CFO', 'Annual ROI table + 3-phase action plan', 'No CLI commands — leadership language'],
      cta: 'Get Board Report →',
      onClick: () => { onClose(); onCfoReportClick(); },
    },
    {
      id: 'monitor',
      icon: '📈',
      label: 'Cloud Health Monitor',
      badge: 'Subscription',
      badgeColor: '#818cf8',
      price: currency.subscriptionPrice || '$19/mo',
      priceSub: 'cancel anytime',
      color: '#818cf8',
      border: 'rgba(99,102,241,0.25)',
      bg: 'rgba(99,102,241,0.04)',
      features: ['Monthly waste score tracking', 'New issues flagged automatically', 'One discounted Blueprint/month included'],
      cta: null, // inline email input
    },
    {
      id: 'session',
      icon: '💬',
      label: 'Consulting Session',
      badge: null,
      badgeColor: null,
      price: currency.sessionPrice || '$249',
      priceSub: 'per session',
      color: '#00d4ff',
      border: 'rgba(0,212,255,0.2)',
      bg: 'rgba(0,212,255,0.03)',
      features: ['60-min 1:1 with a senior DevOps engineer', 'Live implementation of your top fixes', 'Full notes + follow-up docs included'],
      cta: 'Book a Session →',
      onClick: () => { onClose(); onSessionClick(); },
    },
  ];

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(16px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', animation: 'fadeIn 0.2s ease', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '24px', maxWidth: '920px', width: '100%', padding: '40px', boxShadow: '0 40px 100px rgba(0,0,0,0.8)', animation: 'scaleIn 0.3s cubic-bezier(0.34,1.56,0.64,1)', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: '20px', right: '20px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'var(--text-muted)', fontSize: '18px', width: '36px', height: '36px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>×</button>

        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <p style={{ fontSize: '11px', letterSpacing: '3px', color: 'var(--green)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '10px' }}>Pricing</p>
          <h2 className="display" style={{ fontSize: 'clamp(24px,3vw,36px)', fontWeight: 800, letterSpacing: '-1px', color: '#fff', marginBottom: '8px' }}>Choose what you need</h2>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Run the free audit first — upgrade to a paid tier whenever you're ready.</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }} className="pricing-modal-grid">
          <style>{`
            @media (max-width: 700px) { .pricing-modal-grid { grid-template-columns: 1fr !important; } }
            @media (max-width: 960px) and (min-width: 701px) { .pricing-modal-grid { grid-template-columns: repeat(2, 1fr) !important; } }
          `}</style>
          {PRODUCTS.map(p => (
            <div key={p.id} style={{ background: p.bg, border: `1.5px solid ${p.border}`, borderRadius: '16px', padding: '22px', display: 'flex', flexDirection: 'column', position: 'relative' }}>
              {p.badge && (
                <div style={{ position: 'absolute', top: '-10px', left: '50%', transform: 'translateX(-50%)', background: p.badgeColor, color: p.badgeColor === '#00ffb4' || p.badgeColor === '#4ade80' ? '#000' : '#fff', fontSize: '10px', fontWeight: 800, padding: '3px 12px', borderRadius: '20px', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>{p.badge}</div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontSize: '18px' }}>{p.icon}</span>
                <span style={{ fontSize: '11px', fontWeight: 700, color: p.color, letterSpacing: '1px', textTransform: 'uppercase' }}>{p.label}</span>
              </div>
              <div style={{ marginBottom: '14px' }}>
                <span className="display" style={{ fontSize: '24px', fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' }}>{p.price}</span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '6px' }}>{p.priceSub}</span>
              </div>
              <div style={{ flex: 1, marginBottom: '16px' }}>
                {p.features.map(f => (
                  <div key={f} style={{ display: 'flex', gap: '7px', alignItems: 'flex-start', marginBottom: '7px' }}>
                    <span style={{ color: p.color, fontSize: '12px', flexShrink: 0, marginTop: '2px' }}>✓</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-dim)', lineHeight: 1.5 }}>{f}</span>
                  </div>
                ))}
              </div>
              {p.id === 'monitor' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                  <input type="email" placeholder="your@company.com" value={subEmail} onChange={e => setSubEmail(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', background: 'rgba(99,102,241,0.08)', border: '1.5px solid rgba(99,102,241,0.3)', borderRadius: '9px', color: '#fff', fontSize: '13px', boxSizing: 'border-box' }} />
                  <button onClick={handleSubscribe} disabled={subStatus === 'loading'}
                    style={{ padding: '10px', borderRadius: '9px', border: 'none', background: subStatus === 'loading' ? 'rgba(99,102,241,0.4)' : 'linear-gradient(135deg,#818cf8,#6366f1)', color: '#fff', fontWeight: 800, fontSize: '12px', cursor: subStatus === 'loading' ? 'not-allowed' : 'pointer' }}>
                    {subStatus === 'loading' ? 'Redirecting…' : `Subscribe — ${currency.subscriptionPrice || '$19/mo'} →`}
                  </button>
                  {subStatus === 'error' && <p style={{ fontSize: '11px', color: '#f87171', margin: 0 }}>Something went wrong — try again</p>}
                </div>
              ) : (
                <button onClick={p.onClick}
                  style={{ padding: '11px', borderRadius: '9px', border: p.id === 'free' ? `1px solid ${p.border}` : 'none', background: p.id === 'free' ? 'transparent' : p.id === 'blueprint' ? 'var(--green)' : p.id === 'security' ? '#f87171' : p.id === 'cfo' || p.id === 'monitor' ? 'linear-gradient(135deg,#818cf8,#6366f1)' : 'rgba(0,212,255,0.15)', color: p.id === 'blueprint' ? '#000' : p.id === 'security' ? '#000' : p.id === 'free' ? p.color : '#fff', fontWeight: 800, fontSize: '12px', cursor: 'pointer', boxShadow: p.id === 'blueprint' ? '0 0 16px rgba(0,255,180,0.3)' : 'none' }}>
                  {p.cta}
                </button>
              )}
            </div>
          ))}
        </div>

        <p style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)', marginTop: '24px' }}>
          All blueprints include a full refund if no actionable fix is found. Questions? <a href="mailto:admin@kloudaudit.eu" style={{ color: 'var(--green)', textDecoration: 'none' }}>admin@kloudaudit.eu</a>
        </p>
      </div>
    </div>
  );
});

// ── CONTACT MODAL ─────────────────────────────────────────────────────────────
// Defined OUTSIDE App — stable component type, owns its own status state.
// ── NEWSLETTER WIDGET ─────────────────────────────────────────────────────────
const NewsletterWidget = memo(function NewsletterWidget() {
  const [nEmail, setNEmail] = useState('');
  const [nStatus, setNStatus] = useState('idle'); // idle | loading | success | error

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!nEmail) return;
    setNStatus('loading');
    try {
      const r = await fetch('/api/audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'newsletter', email: nEmail }),
      });
      setNStatus(r.ok ? 'success' : 'error');
    } catch {
      setNStatus('error');
    }
  };

  return (
    <div style={{ background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: "16px", padding: "28px 32px", marginBottom: "48px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "24px", flexWrap: "wrap" }}>
      <div>
        <p style={{ fontSize: "16px", fontWeight: 800, color: "#fff", letterSpacing: "-0.3px", marginBottom: "4px" }}>Stay in the loop</p>
        <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>New blog posts, product updates, and cloud cost tips. No spam — unsubscribe any time.</p>
      </div>
      {nStatus === 'success' ? (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--green)", fontSize: "14px", fontWeight: 700 }}>
          <span>✓</span> You're subscribed!
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", gap: "8px", flexShrink: 0, flexWrap: "wrap" }}>
          <input type="email" required value={nEmail} onChange={e => setNEmail(e.target.value)} placeholder="you@company.com"
            style={{ padding: "11px 14px", background: "rgba(255,255,255,0.06)", border: "1.5px solid rgba(99,102,241,0.3)", borderRadius: "10px", color: "#fff", fontSize: "14px", width: "220px" }} />
          <button type="submit" disabled={nStatus === 'loading'}
            style={{ padding: "11px 20px", borderRadius: "10px", border: "none", background: nStatus === 'loading' ? "rgba(99,102,241,0.4)" : "linear-gradient(135deg,#818cf8,#6366f1)", color: "#fff", fontWeight: 800, fontSize: "13px", cursor: nStatus === 'loading' ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
            {nStatus === 'loading' ? "…" : "Subscribe →"}
          </button>
          {nStatus === 'error' && <p style={{ fontSize: "11px", color: "#f87171", alignSelf: "center", margin: 0 }}>Something went wrong — try again</p>}
        </form>
      )}
    </div>
  );
});

// ── ABOUT MODAL ───────────────────────────────────────────────────────────────
const AboutModal = memo(function AboutModal({ onClose }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.88)", backdropFilter: "blur(14px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", animation: "fadeIn 0.2s ease" }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="about-dialog-title" style={{ background: "var(--bg2)", border: "1px solid rgba(0,255,180,0.2)", borderRadius: "24px", maxWidth: "520px", width: "100%", boxShadow: "0 40px 80px rgba(0,0,0,0.8)", animation: "scaleIn 0.3s cubic-bezier(0.34,1.56,0.64,1)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ background: "linear-gradient(135deg, rgba(0,255,180,0.1) 0%, rgba(99,102,241,0.08) 100%)", borderBottom: "1px solid rgba(0,255,180,0.12)", padding: "28px 32px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ width: "36px", height: "36px", background: "var(--green)", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", boxShadow: "0 0 16px rgba(0,255,180,0.4)" }}>⚡</div>
              <div>
                <h2 id="about-dialog-title" className="display" style={{ fontSize: "22px", fontWeight: 800, letterSpacing: "-0.8px", color: "#fff", margin: 0 }}>About KloudAudit</h2>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>Built in 2026 · Wrocław, Poland</p>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text-muted)", fontSize: "20px", width: "36px", height: "36px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, lineHeight: 1 }}>×</button>
          </div>
        </div>
        {/* Body */}
        <div style={{ padding: "28px 32px 32px", display: "flex", flexDirection: "column", gap: "18px" }}>
          <p style={{ fontSize: "15px", color: "var(--text-dim)", lineHeight: 1.75 }}>
            KloudAudit was built after spending <strong style={{ color: "#fff" }}>4 months</strong> going through enterprise procurement just to connect a cloud cost tool at work — security reviews, IT tickets, legal approvals, OAuth scopes.
          </p>
          <p style={{ fontSize: "15px", color: "var(--text-dim)", lineHeight: 1.75 }}>
            The premise: <strong style={{ color: "#fff" }}>you already know your infrastructure.</strong> You don't need to give a third-party tool your AWS credentials to find out you're running dev RDS 24/7, or that your NAT Gateway is routing S3 traffic that a free VPC endpoint could handle.
          </p>
          <p style={{ fontSize: "15px", color: "var(--text-dim)", lineHeight: 1.75 }}>
            KloudAudit is a structured 15-minute self-assessment that asks the right questions, quantifies the waste in dollars against your actual bill, and delivers exact CLI commands and Terraform to fix it. <strong style={{ color: "#fff" }}>No credentials. No agents. No procurement.</strong>
          </p>
          {/* Founder */}
          <div style={{ display: "flex", alignItems: "center", gap: "14px", background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", borderRadius: "12px", padding: "16px" }}>
            <div style={{ width: "44px", height: "44px", borderRadius: "50%", background: "linear-gradient(135deg, var(--green), #00d4ff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", fontWeight: 800, color: "#000", flexShrink: 0, fontFamily: "var(--display)" }}>SA</div>
            <div>
              <p style={{ fontSize: "14px", fontWeight: 700, color: "#fff", margin: "0 0 2px" }}>Samuel Ayodele Adomeh</p>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>Senior DevOps Engineer · Certified Azure Solutions Architect · Wrocław, Poland</p>
            </div>
            <a href="https://www.linkedin.com/in/samuel-ayodele-adomeh" target="_blank" rel="noopener noreferrer" style={{ marginLeft: "auto", fontSize: "12px", fontWeight: 700, color: "#0077b5", background: "rgba(0,119,181,0.08)", border: "1px solid rgba(0,119,181,0.2)", borderRadius: "8px", padding: "6px 12px", textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0 }}>LinkedIn</a>
          </div>
          <p style={{ fontSize: "12px", color: "var(--text-muted)", textAlign: "center", margin: 0 }}>
            Questions? <a href="mailto:admin@kloudaudit.eu" style={{ color: "var(--green)", textDecoration: "none" }}>admin@kloudaudit.eu</a>
          </p>
        </div>
      </div>
    </div>
  );
});

const ContactModal = memo(function ContactModal({ onClose }) {
  const [status, setStatus] = useState("idle"); // idle | sending | success | error

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus("sending");
    const formData = new FormData(e.target);
    try {
      const res = await fetch("https://formspree.io/f/mlgarana", { method: "POST", body: formData, headers: { Accept: "application/json" } });
      if (res.ok) { setStatus("success"); e.target.reset(); setTimeout(() => { onClose(); }, 3000); }
      else setStatus("error");
    } catch { setStatus("error"); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.88)", backdropFilter: "blur(14px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", animation: "fadeIn 0.2s ease" }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="contact-dialog-title" style={{ background: "var(--bg2)", border: "1px solid rgba(0,255,180,0.2)", borderRadius: "24px", maxWidth: "520px", width: "100%", boxShadow: "0 40px 80px rgba(0,0,0,0.8)", animation: "scaleIn 0.3s cubic-bezier(0.34,1.56,0.64,1)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ background: "linear-gradient(135deg, rgba(0,255,180,0.1) 0%, rgba(99,102,241,0.1) 100%)", borderBottom: "1px solid rgba(0,255,180,0.12)", padding: "28px 32px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "7px", background: "rgba(0,255,180,0.12)", border: "1px solid rgba(0,255,180,0.25)", borderRadius: "20px", padding: "4px 12px", marginBottom: "10px" }}>
                <span style={{ width: "5px", height: "5px", background: "var(--green)", borderRadius: "50%", display: "inline-block", boxShadow: "0 0 6px var(--green)" }} />
                <span style={{ fontSize: "11px", color: "var(--green)", fontWeight: 700, letterSpacing: "1px" }}>GET IN TOUCH · WE REPLY WITHIN 24HRS</span>
              </div>
              <h2 id="contact-dialog-title" className="display" style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-0.8px", color: "#fff", marginBottom: "5px" }}>Contact us</h2>
              <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>Questions, partnerships or custom audits — we're here</p>
            </div>
            <button onClick={onClose} aria-label="Close" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text-muted)", fontSize: "20px", width: "36px", height: "36px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "14px" }}>
            {["✓ Cloud cost questions", "✓ Custom audit requests", "✓ Partnership enquiries", "✓ Technical support"].map(item => (
              <span key={item} style={{ fontSize: "11px", color: "var(--text-dim)", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", borderRadius: "6px", padding: "3px 9px" }}>{item}</span>
            ))}
          </div>
        </div>
        {/* Body */}
        <div style={{ padding: "26px 32px 32px" }}>
          {status === "success" ? (
            <div style={{ textAlign: "center", padding: "28px 0" }}>
              <div style={{ fontSize: "48px", marginBottom: "14px" }}>✅</div>
              <p className="display" style={{ color: "var(--green)", fontWeight: 800, fontSize: "22px", letterSpacing: "-0.5px", marginBottom: "8px" }}>Message Sent!</p>
              <p style={{ color: "var(--text-dim)", fontSize: "14px", lineHeight: 1.6, marginBottom: "24px" }}>We'll get back to you within 24hrs.<br />Check your inbox and spam folder.</p>
              <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
                <button className="ghost-btn" onClick={onClose} style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: "10px", color: "var(--text-muted)", fontSize: "13px", fontWeight: 600, padding: "9px 20px", cursor: "pointer", fontFamily: "inherit" }}>Close</button>
                <button className="ghost-btn" onClick={onClose} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: "10px", color: "var(--text-dim)", fontSize: "13px", fontWeight: 600, padding: "9px 20px", cursor: "pointer", fontFamily: "inherit" }}>Back to Homepage</button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <input type="hidden" name="_subject" value="New Contact Enquiry — KloudAudit" />
              <input type="hidden" name="form_type" value="contact" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label htmlFor="contact-first-name" style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "1px" }}>First Name</label>
                  <input id="contact-first-name" required type="text" name="first_name" placeholder="Jan" style={{ width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "14px", fontFamily: "var(--body)" }} />
                </div>
                <div>
                  <label htmlFor="contact-last-name" style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "1px" }}>Last Name</label>
                  <input id="contact-last-name" required type="text" name="last_name" placeholder="Kowalski" style={{ width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "14px", fontFamily: "var(--body)" }} />
                </div>
              </div>
              <div>
                <label htmlFor="contact-email" style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "1px" }}>Work Email</label>
                <input id="contact-email" required type="email" name="email" placeholder="jan@company.com" style={{ width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "14px", fontFamily: "var(--body)" }} />
              </div>
              <div>
                <label htmlFor="contact-company" style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "1px" }}>Company</label>
                <input id="contact-company" type="text" name="company" placeholder="Acme Corp" style={{ width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "14px", fontFamily: "var(--body)" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "1px" }}>How can we help? <span style={{ color: "var(--text-muted)", fontWeight: 400, textTransform: "none" }}>(optional)</span></label>
                <textarea required name="message" rows="3" placeholder="e.g. I have questions about the blueprint, or I'd like a custom audit..." style={{ width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "14px", resize: "none", fontFamily: "var(--body)" }} />
              </div>
              <button type="submit" className="glow-btn" disabled={status === "sending"}
                style={{ background: status === "sending" ? "rgba(0,255,180,0.5)" : "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "15px", fontSize: "15px", width: "100%", cursor: status === "sending" ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginTop: "4px" }}>
                {status === "sending" ? <><span style={{ display: "inline-block", width: "15px", height: "15px", border: "2px solid #000", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} /> Sending...</> : "Send Message →"}
              </button>
              {status === "error" && <p style={{ color: "#f87171", fontSize: "13px", textAlign: "center", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "8px", padding: "10px" }}>⚠ Something went wrong. Please try again.</p>}
              <p style={{ fontSize: "11px", color: "var(--text-muted)", textAlign: "center" }}>Or email us directly at <a href="mailto:admin@kloudaudit.eu" style={{ color: "var(--green)", textDecoration: "none" }}>admin@kloudaudit.eu</a></p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
});

// ── BOOKING MODAL ─────────────────────────────────────────────────────────────
// Defined OUTSIDE App — stable component type, owns its own status state.
const BookingModal = memo(function BookingModal({ onClose, sessionPrice, onStripeCheckout }) {
  const [status, setStatus] = useState("idle"); // idle | sending | success | error
  const [stripeEmail, setStripeEmail] = useState('');
  const [stripeStatus, setStripeStatus] = useState('idle'); // idle | loading | not_configured | error

  const handleStripeBook = async () => {
    if (!stripeEmail) return;
    setStripeStatus('loading');
    try {
      const res = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: stripeEmail, productType: 'session', provider: 'AWS' }),
      });
      const data = await res.json();
      if (data.code === 'session_not_configured') { setStripeStatus('not_configured'); return; }
      if (data.url) { window.location.href = data.url; } else throw new Error(data.error);
    } catch (err) { setStripeStatus('error'); setTimeout(() => setStripeStatus('idle'), 4000); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus("sending");
    const formData = new FormData(e.target);
    try {
      const res = await fetch("https://formspree.io/f/mlgarana", { method: "POST", body: formData, headers: { Accept: "application/json" } });
      if (res.ok) { setStatus("success"); e.target.reset(); setTimeout(() => { onClose(); }, 4000); }
      else setStatus("error");
    } catch { setStatus("error"); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.88)", backdropFilter: "blur(14px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", animation: "fadeIn 0.2s ease" }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="booking-dialog-title" style={{ background: "var(--bg2)", border: "1px solid rgba(0,255,180,0.2)", borderRadius: "24px", maxWidth: "520px", width: "100%", boxShadow: "0 40px 80px rgba(0,0,0,0.8)", animation: "scaleIn 0.3s cubic-bezier(0.34,1.56,0.64,1)", overflow: "hidden" }}>
        <div style={{ background: "linear-gradient(135deg, rgba(0,255,180,0.1) 0%, rgba(99,102,241,0.1) 100%)", borderBottom: "1px solid rgba(0,255,180,0.12)", padding: "28px 32px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "7px", background: "rgba(0,255,180,0.12)", border: "1px solid rgba(0,255,180,0.25)", borderRadius: "20px", padding: "4px 12px", marginBottom: "10px" }}>
                <span style={{ width: "5px", height: "5px", background: "var(--green)", borderRadius: "50%", display: "inline-block", boxShadow: "0 0 6px var(--green)" }} />
                <span style={{ fontSize: "11px", color: "var(--green)", fontWeight: 700, letterSpacing: "1px" }}>{`IMPLEMENTATION SESSION · ${sessionPrice}`}</span>
              </div>
              <h2 id="booking-dialog-title" className="display" style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-0.8px", color: "#fff", marginBottom: "5px" }}>Book your session</h2>
              <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>Senior DevOps engineer · Remote · Delivered within 48hrs</p>
            </div>
            <button onClick={onClose} aria-label="Close" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text-muted)", fontSize: "20px", width: "36px", height: "36px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "14px" }}>
            {["✓ Full audit review", "✓ Implementation roadmap", "✓ 1hr live session", "✓ 30-day follow-up"].map(item => (
              <span key={item} style={{ fontSize: "11px", color: "var(--text-dim)", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", borderRadius: "6px", padding: "3px 9px" }}>{item}</span>
            ))}
          </div>
        </div>
        <div style={{ padding: "26px 32px 32px" }}>
          {status === "success" ? (
            <div style={{ textAlign: "center", padding: "28px 0" }}>
              <div style={{ fontSize: "48px", marginBottom: "14px" }}>🎉</div>
              <p className="display" style={{ color: "var(--green)", fontWeight: 800, fontSize: "22px", letterSpacing: "-0.5px", marginBottom: "8px" }}>Booking Received!</p>
              <p style={{ color: "var(--text-dim)", fontSize: "14px", lineHeight: 1.6 }}>We'll email you within 24hrs to confirm your session.<br />Check your inbox and spam folder.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* ── STRIPE INSTANT PAYMENT ── */}
              {stripeStatus !== 'not_configured' && (
                <div style={{ background: "rgba(0,255,180,0.05)", border: "1px solid rgba(0,255,180,0.2)", borderRadius: "14px", padding: "20px" }}>
                  <p style={{ fontSize: "12px", fontWeight: 700, color: "var(--green)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "10px" }}>⚡ Book & Pay Instantly</p>
                  <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "12px", lineHeight: 1.5 }}>Pay now via Stripe and lock in your session. Samuel confirms your time slot within 24hrs.</p>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input type="email" placeholder="your@company.com" value={stripeEmail} onChange={e => setStripeEmail(e.target.value)}
                      style={{ flex: 1, padding: "11px 14px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "14px" }} />
                    <button onClick={handleStripeBook} disabled={!stripeEmail || stripeStatus === 'loading'}
                      style={{ padding: "11px 20px", borderRadius: "10px", border: "none", background: stripeEmail ? "var(--green)" : "rgba(0,255,180,0.3)", color: "#000", fontWeight: 800, fontSize: "13px", cursor: stripeEmail ? "pointer" : "not-allowed", whiteSpace: "nowrap", flexShrink: 0 }}>
                      {stripeStatus === 'loading' ? "…" : `Pay ${sessionPrice} →`}
                    </button>
                  </div>
                  {stripeStatus === 'error' && <p style={{ fontSize: "12px", color: "#f87171", marginTop: "8px" }}>Something went wrong — try the form below or email admin@kloudaudit.eu</p>}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>or request a session (no upfront payment)</span>
                <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
              </div>
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <input type="hidden" name="_subject" value={`New Booking – KloudAudit Implementation Session ${sessionPrice}`} />
              <input type="hidden" name="form_type" value="booking_999pln" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label htmlFor="booking-first-name" style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "1px" }}>First Name</label>
                  <input id="booking-first-name" required type="text" name="first_name" placeholder="Jan" style={{ width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "14px", fontFamily: "var(--body)" }} />
                </div>
                <div>
                  <label htmlFor="booking-last-name" style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "1px" }}>Last Name</label>
                  <input id="booking-last-name" required type="text" name="last_name" placeholder="Kowalski" style={{ width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "14px", fontFamily: "var(--body)" }} />
                </div>
              </div>
              <div>
                <label htmlFor="booking-email" style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "1px" }}>Work Email</label>
                <input id="booking-email" required type="email" name="email" placeholder="jan@company.com" style={{ width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "14px", fontFamily: "var(--body)" }} />
              </div>
              <div>
                <label htmlFor="booking-company" style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "1px" }}>Company</label>
                <input id="booking-company" required type="text" name="company" placeholder="Acme Corp" style={{ width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "14px", fontFamily: "var(--body)" }} />
              </div>
              <div>
                <label htmlFor="booking-cloud-details" style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "1px" }}>Cloud Provider & Monthly Bill</label>
                <input id="booking-cloud-details" type="text" name="cloud_details" placeholder="e.g. AWS · ~$4,500/month" style={{ width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "14px", fontFamily: "var(--body)" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "1px" }}>Biggest challenge <span style={{ color: "var(--text-muted)", fontWeight: 400, textTransform: "none" }}>(optional)</span></label>
                <textarea name="message" rows="3" placeholder="e.g. Our AWS bill jumped 40% last month..." style={{ width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "10px", color: "#fff", fontSize: "14px", resize: "none", fontFamily: "var(--body)" }} />
              </div>
              <button type="submit" className="glow-btn" disabled={status === "sending"}
                style={{ background: status === "sending" ? "rgba(0,255,180,0.5)" : "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "15px", fontSize: "15px", width: "100%", cursor: status === "sending" ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginTop: "4px" }}>
                {status === "sending" ? <><span style={{ display: "inline-block", width: "15px", height: "15px", border: "2px solid #000", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} /> Sending...</> : `Book Session for ${sessionPrice} →`}
              </button>
              {status === "error" && <p style={{ color: "#f87171", fontSize: "13px", textAlign: "center", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "8px", padding: "10px" }}>⚠ Something went wrong. Please try again.</p>}
              <p style={{ fontSize: "11px", color: "var(--text-muted)", textAlign: "center" }}>We'll confirm by email within 24 hours. No payment required upfront.</p>
            </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default function App() {
  // ── DETECT PUBLIC AUDIT VIEW ────────────────────────────────────────────────
  const pathMatch = window.location.pathname.match(/^\/audit\/([a-z0-9]+)$/i);
  if (pathMatch) {
    const auditSlug = pathMatch[1];
    return <PublicAuditViewer slug={auditSlug} />;
  }
  
  // ── SESSION RESTORE — read localStorage once at mount ─────────────────────
  const [initialSession] = useState(() => {
    try {
      const saved = localStorage.getItem('ka_session');
      if (!saved) return null;
      const session = JSON.parse(saved);
      if (session.version !== SESSION_VERSION) return null;
      return session;
    } catch { return null; }
  });
  const [step, setStep] = useState(() => {
    if (initialSession && RESTORABLE_STEPS.includes(initialSession.step)) return initialSession.step;
    return 'intro';
  });
  const [provider, setProvider] = useState(() => initialSession?.provider || '');
  const [monthlyBill, setMonthlyBill] = useState(() => initialSession?.monthlyBill || '');
  const [companyName, setCompanyName] = useState(() => initialSession?.companyName || '');
  const [checked, setChecked] = useState(() => initialSession?.checked || {});
  const [activeSection, setActiveSection] = useState(() => typeof initialSession?.activeSection === 'number' ? initialSession.activeSection : 0);
  const [showToast, setShowToast] = useState(null);
  const [showSample, setShowSample] = useState(false);
  const [sampleTab, setSampleTab] = useState("report");
  const [showContact, setShowContact] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showBooking, setShowBooking] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [showBlueprint, setShowBlueprint] = useState(false);
  const [pageKey, setPageKey] = useState(0);
  // ── INTRO-SCREEN STATE (must live at top level — Rules of Hooks) ──────────
  const [calcBill, setCalcBill] = useState(5000);
  const [savingsFilter, setSavingsFilter] = useState("All");
  const [openFaq, setOpenFaq] = useState(null);
  const [activeHowStep, setActiveHowStep] = useState(null); // null = all equal, click to expand
  const [showLeadMagnet, setShowLeadMagnet] = useState(false);
  const [showStickyBar, setShowStickyBar] = useState(false);
  const [auditStats, setAuditStats] = useState(null);
  const [leadEmail, setLeadEmail] = useState('');
  const [leadSubmitted, setLeadSubmitted] = useState(false);
  const [showShareCard, setShowShareCard] = useState(false);
  const [sectionToast, setSectionToast] = useState(null); // audit section-complete toast
  const [secSectionToast, setSecSectionToast] = useState(null); // security section-complete toast
  const sectionToastTimerRef = useRef(null);
  const secToastTimerRef = useRef(null);
  // ── SECURITY AUDIT STATE ──────────────────────────────────────────────────
  const [secChecked, setSecChecked] = useState({});
  const [secStep, setSecStep] = useState(0);
  const [secReport, setSecReport] = useState(null);
  const [secLoading, setSecLoading] = useState(false);
  const [secError, setSecError] = useState(null);
  const [showSecBlueprint, setShowSecBlueprint] = useState(false);
  const [showCfoReport, setShowCfoReport] = useState(false);
  const [showSecSample, setShowSecSample] = useState(false);
  const [secBlueprintEmail, setSecBlueprintEmail] = useState("");
  const [secBlueprintStatus, setSecBlueprintStatus] = useState("idle"); // idle | loading | success | error
  const [secScore, setSecScore] = useState(null); // computed after audit
  const [secEmail, setSecEmail] = useState("");
  const [secPaymentLoading, setSecPaymentLoading] = useState(false);
  const [gateEmail, setGateEmail] = useState(() => initialSession?.gateEmail || '');
  const [scores, setScores] = useState(null);
  const [shareUrl, setShareUrl] = useState(null);
  const [leaderboardRank, setLeaderboardRank] = useState(null);
// ── PERSISTENCE — anonymous session ID ────────────────────────────────────
  

  
  // ── PERSISTENCE — anonymous session ID ────────────────────────────────────
  const [sessionId] = useState(() => {
    // Generate once per browser session, persist across page refreshes
    const existing = localStorage.getItem('ka_session_id');
    if (existing) return existing;
    const newId = `ka_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem('ka_session_id', newId);
    return newId;
  });
  const [aiPreview, setAiPreview] = useState(null);
  const [aiPreviewLoading, setAiPreviewLoading] = useState(false);
  const [subEmail, setSubEmail] = useState(() => '');
  const [subStatus, setSubStatus] = useState('idle'); // idle | loading | error
  const [gateSubmitted, setGateSubmitted] = useState(false);
  const [gateSending, setGateSending] = useState(false);
  // ── MULTI-CURRENCY ────────────────────────────────────────────────────────
  const [currency, setCurrency] = useState({
    code: "USD", symbol: "$", blueprintPrice: "$79", blueprintAmount: 7900,
    sessionPrice: "$249", sessionAmount: 24900, stripeCurrency: "usd",
    securityPrice: "$29", securityAmount: 2900,
    bundlePrice: "$89", bundleAmount: 8900,
    cfoReportPrice: "$199", cfoReportAmount: 19900,
  });

  const toggle = (id) => {
    const nowOn = !checked[id];
    setChecked(p => ({ ...p, [id]: !p[id] }));
    if (nowOn) {
      const check = AUDIT_SECTIONS.flatMap(s => s.checks).find(c => c.id === id);
      if (check) setShowToast({ check, bill });
    }
  };
  const goTo = (s) => {
    if (s === 'email_gate') {
      window.gtag?.('event', 'email_gate_reached', { flagged_count: flagged.length, savings_min: savMin });
    }
    if (s === 'report') {
      window.gtag?.('event', 'report_viewed', { flagged_count: flagged.length, savings_min: savMin, savings_max: savMax, provider: provider });
    }
    if (s === 'security_intro') {
      window.gtag?.('event', 'security_audit_started', {});
    }
    setStep(s);
    setPageKey(k => k + 1);
    window.scrollTo(0, 0);
    // Push to browser history so back button returns to previous step
    const stepsWithHistory = ["intake", "questions", "audit", "email_gate", "report", "security_intro", "security_report"];
    const currentStep = step; // capture before update
    if (stepsWithHistory.includes(s)) {
      window.history.pushState({ step: s, from: currentStep }, "", `#${s}`);
    } else if (s === "intro") {
      window.history.pushState({ step: "intro", from: currentStep }, "", "/");
    }
  };

  const bill = useMemo(() => parseFloat(monthlyBill) || 0, [monthlyBill]);
  const allChecks = useMemo(() => AUDIT_SECTIONS.flatMap(s => s.checks), []);
  const flagged = useMemo(() => allChecks.filter(c => checked[c.id]), [checked, allChecks]);
  const { savMin, savMax, savPct } = useMemo(() => {
    const rawMin = Math.round(flagged.reduce((s, c) => s + bill * c.savingsRange[0] / 100, 0));
    const rawMax = Math.round(flagged.reduce((s, c) => s + bill * c.savingsRange[1] / 100, 0));
    const min = Math.min(rawMin, Math.round(bill * 0.70));
    const max = Math.min(rawMax, Math.round(bill * 0.85));
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

  // ── LCP OVERLAY DISMISSAL — fade out static HTML placeholder once React has painted ──
  useEffect(() => {
    const el = document.getElementById('lcp-overlay');
    if (!el) return;
    // rAF ensures the browser has painted the React tree before we fade the overlay
    requestAnimationFrame(() => {
      el.classList.add('fade');
      const t = setTimeout(() => el.remove(), 220);
      return () => clearTimeout(t);
    });
  }, []);

  // FIX #2: Payment success detection on mount
  useEffect(() => {
    // Handle Stripe payment success redirect
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") === "success") {
      localStorage.removeItem('ka_session');
      setStep("payment_success");
      window.history.replaceState({}, "", "/");
      return;
    }

    // Restore step from URL hash on initial load (e.g. user refreshes mid-audit)
    const hash = window.location.hash.replace("#", "");
    const validSteps = ["intake", "questions", "audit", "email_gate", "report", "security_intro", "security_report"];
    if (hash && validSteps.includes(hash)) {
      setStep(hash);
    }

    // Handle browser back/forward button
    const handlePopState = (e) => {
      const targetStep = (e.state && e.state.step) ? e.state.step : "intro";
      const fromStep   = (e.state && e.state.from) ? e.state.from : null;
      setStep(targetStep);
      setPageKey(k => k + 1);

      // If returning to intro from audit, scroll to the audit CTA section
      if (targetStep === "intro" && fromStep && fromStep !== "intro") {
        setTimeout(() => {
          const el = document.getElementById("start-audit");
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
      } else {
        window.scrollTo(0, 0);
      }
    };

    window.addEventListener("popstate", handlePopState);

    // navigateSEO — fired by "Related Guides" links inside SEOPage
    const handleNavigateSEO = (e) => {
      const relatedPage = e.detail;
      if (!relatedPage) return;
      window.history.pushState({ slug: relatedPage.slug }, relatedPage.title, `/${relatedPage.slug}/`);
      // Force a re-render — the SEO slug detector in the render path will pick up the new URL
      setPageKey(k => k + 1);
      window.scrollTo(0, 0);
    };
    window.addEventListener("navigateSEO", handleNavigateSEO);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("navigateSEO", handleNavigateSEO);
    };
  }, []);

  // ── CURRENCY DETECTION ───────────────────────────────────────────
  useEffect(() => {
    const USD = { code: "USD", symbol: "$",   blueprintPrice: "$79",     blueprintAmount: 7900,  sessionPrice: "$249",    sessionAmount: 24900, stripeCurrency: "usd", securityPrice: "$29",      securityAmount: 2900,  bundlePrice: "$89",      bundleAmount: 8900,  subscriptionPrice: "$19/mo",     subscriptionAmount: 1900,  cfoReportPrice: "$199",     cfoReportAmount: 19900  };
    const GBP = { code: "GBP", symbol: "\u00a3",   blueprintPrice: "\u00a362",     blueprintAmount: 6200,  sessionPrice: "\u00a3199",    sessionAmount: 19900, stripeCurrency: "gbp", securityPrice: "\u00a323",      securityAmount: 2300,  bundlePrice: "\u00a369",      bundleAmount: 6900,  subscriptionPrice: "\u00a315/mo",     subscriptionAmount: 1500,  cfoReportPrice: "\u00a3159",    cfoReportAmount: 15900  };
    const EUR = { code: "EUR", symbol: "\u20ac",   blueprintPrice: "\u20ac73",     blueprintAmount: 7300,  sessionPrice: "\u20ac229",    sessionAmount: 22900, stripeCurrency: "eur", securityPrice: "\u20ac27",      securityAmount: 2700,  bundlePrice: "\u20ac83",      bundleAmount: 8300,  subscriptionPrice: "\u20ac17/mo",     subscriptionAmount: 1700,  cfoReportPrice: "\u20ac183",    cfoReportAmount: 18300  };
    const CAD = { code: "CAD", symbol: "CA$", blueprintPrice: "CA$107",  blueprintAmount: 10700, sessionPrice: "CA$339",  sessionAmount: 33900, stripeCurrency: "cad", securityPrice: "CA$39",    securityAmount: 3900,  bundlePrice: "CA$119",   bundleAmount: 11900, subscriptionPrice: "CA$26/mo",   subscriptionAmount: 2600,  cfoReportPrice: "CA$269",   cfoReportAmount: 26900  };
    const AUD = { code: "AUD", symbol: "A$",  blueprintPrice: "A$119",   blueprintAmount: 11900, sessionPrice: "A$379",   sessionAmount: 37900, stripeCurrency: "aud", securityPrice: "A$45",     securityAmount: 4500,  bundlePrice: "A$134",    bundleAmount: 13400, subscriptionPrice: "A$29/mo",    subscriptionAmount: 2900,  cfoReportPrice: "A$299",    cfoReportAmount: 29900  };
    const PLN = { code: "PLN", symbol: "z\u0142",  blueprintPrice: "299 PLN", blueprintAmount: 29900, sessionPrice: "999 PLN", sessionAmount: 99900, stripeCurrency: "pln", securityPrice: "119 PLN",  securityAmount: 11900, bundlePrice: "349 PLN",  bundleAmount: 34900, subscriptionPrice: "79 PLN/mo",  subscriptionAmount: 7900,  cfoReportPrice: "799 PLN",  cfoReportAmount: 79900  };
    const CURRENCY_MAP = {
      US: USD, PR: USD, GU: USD, VI: USD,
      GB: GBP, JE: GBP, GG: GBP, IM: GBP,
      DE: EUR, FR: EUR, NL: EUR, AT: EUR, BE: EUR, ES: EUR, IT: EUR,
      IE: EUR, PT: EUR, FI: EUR, GR: EUR, SK: EUR, SI: EUR, EE: EUR,
      LV: EUR, LT: EUR, LU: EUR, MT: EUR, CY: EUR,
      CA: CAD, AU: AUD, NZ: AUD, PL: PLN,
      SE: USD, NO: USD, DK: USD, CH: USD, IS: USD,
      SG: USD, IN: USD, JP: USD, KR: USD, HK: USD, TW: USD,
    };
    // Serve from 24h localStorage cache to avoid ipapi.co rate limit (1000 req/day free tier)
    try {
      const cached = localStorage.getItem('ka_currency');
      if (cached) {
        const { currency: saved, ts } = JSON.parse(cached);
        if (Date.now() - ts < 24 * 60 * 60 * 1000) { setCurrency(saved); return; }
      }
    } catch {}
    fetch("/api/health?geo=1")
      .then(r => r.json())
      .then(data => {
        const match = CURRENCY_MAP[data.country_code];
        if (match) {
          setCurrency(match);
          try { localStorage.setItem('ka_currency', JSON.stringify({ currency: match, ts: Date.now() })); } catch {}
        }
      })
      .catch(() => {}); // silently keep USD default on failure
  }, []);


  // ── BENCHMARK DATA — "teams like yours" on report page ──────────────────
  const [reportBenchmarks, setReportBenchmarks] = useState(null);
  useEffect(() => {
    if (step !== "report" || !provider) return;
    fetch(`/api/get-benchmarks?provider=${encodeURIComponent(provider)}`)
      .then(r => r.json())
      .then(data => data.hasData ? setReportBenchmarks(data) : null)
      .catch(() => null);
  }, [step]);

  // ── AI PREVIEW GENERATOR ─────────────────────────────────────────────────
  useEffect(() => {
    if (step !== "report" || aiPreview || aiPreviewLoading) return;
    if (!flagged || flagged.length === 0) return;
    const firstIssue = flagged[0];
    setAiPreviewLoading(true);
    // Call our backend endpoint — keeps API key server-side + rate limited
    fetch("/api/ai-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        issueLabel: firstIssue.label,
        issueDetail: firstIssue.detail,
        provider: provider || "AWS",
        bill: bill || 5000,
      }),
    })
      .then(r => r.json())
      .then(data => {
        setAiPreview(data.preview || null);
        setAiPreviewLoading(false);
      })
      .catch(() => setAiPreviewLoading(false));
  }, [step]);

  // ── SAVE AUDIT — non-blocking, fires and forgets with one retry ─────────
  const saveAudit = async (emailOverride) => {
  const issueW  = Math.min(flagged.length / allChecks.length, 1) * 30;
  const pctW    = Math.min(savPct / 50, 1) * 70;
  const wScore  = Math.max(0, Math.min(100, Math.round(100 - issueW - pctW)));

  const payload = JSON.stringify({
    action: 'save',
    sessionId,
    email:       emailOverride || gateEmail || null,
    provider:    provider || 'AWS',
    monthlyBill: bill,
    companyName: companyName || null,
    flaggedIds:  flagged.map(c => c.id),
    wasteScore:  wScore,
    savingsMin:  savMin,
    savingsMax:  savMax,
    auditType:   'cost',
  });

  try {
    const response = await fetch('/api/audits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    
    const data = await response.json();
    
    if (data.success && data.scores) {
      setScores(data.scores);
    }
  } catch (err) {
    console.error('Save audit error:', err);
    const attempt = () => fetch('/api/audits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    setTimeout(() => attempt().catch(() => {}), 3000);
  }
};

  // ── AUDIT STATS — fetched once on mount for real social proof ───────────────
  useEffect(() => {
    fetch('/api/public?type=stats')
      .then(r => r.json())
      .then(data => { if (data.success) setAuditStats(data); })
      .catch(() => null);
  }, []);

  // ── 30-SECOND LEAD MAGNET TRIGGER ───────────────────────────────────────────
useEffect(() => {
  if (step !== 'intro') return;
  // Show sticky bar after 10 seconds
  const stickyTimer = setTimeout(() => setShowStickyBar(true), 10000);
  // Show lead magnet after 30 seconds (once per visitor)
  const leadTimer = localStorage.getItem('ka_lead_shown')
    ? null
    : setTimeout(() => {
        setShowLeadMagnet(true);
        localStorage.setItem('ka_lead_shown', '1');
      }, 30000);
  return () => {
    clearTimeout(stickyTimer);
    if (leadTimer) clearTimeout(leadTimer);
  };
}, [step]);


  // ── TOAST AUTO-DISMISS ────────────────────────────────────────────────────
  useEffect(() => {
    if (!showToast) return;
    const t = setTimeout(() => setShowToast(null), 2000);
    return () => clearTimeout(t);
  }, [showToast]);

  // ── GA4: audit section viewed ─────────────────────────────────────────────
  useEffect(() => {
    if (step !== 'audit') return;
    const section = AUDIT_SECTIONS[activeSection];
    if (section) window.gtag?.('event', 'audit_section_viewed', { section: section.label, section_index: activeSection });
  }, [activeSection, step]);

  // ── SESSION PERSISTENCE — save on every relevant state change ─────────────
  useEffect(() => {
    localStorage.setItem('ka_session', JSON.stringify({
      version: SESSION_VERSION,
      step, provider, monthlyBill, companyName, checked, activeSection, gateEmail,
    }));
  }, [step, provider, monthlyBill, companyName, checked, activeSection, gateEmail]);

  // Buy Blueprint → Vercel Function → Stripe Checkout
  const handleBuyBlueprint = async (email) => {
    window.gtag?.('event', 'checkout_initiated', { provider: provider, amount: currency.blueprintAmount, currency: currency.stripeCurrency });
    const res = await fetch("/api/create-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        provider: provider || "AWS",
        monthlyBill: bill,
        companyName: companyName || "Your Company",
        savingsMin: savMin,
        savingsMax: savMax,
        flaggedIssues: flagged.map(c => ({ id: c.id, label: c.label })),
        currency: currency.stripeCurrency,
        currencyAmount: currency.blueprintAmount,
        sessionId,
      }),
    });
    if (!res.ok) {
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const errData = await res.json();
        throw new Error(errData.error || `Checkout failed (${res.status})`);
      }
      throw new Error(`Checkout failed (${res.status})`);
    }
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      throw new Error(data.error || "Checkout failed");
    }
  };

  const handleBuyCfoReport = async (email) => {
    window.gtag?.('event', 'cfo_report_checkout_initiated', { currency: currency.stripeCurrency, amount: currency.cfoReportAmount });
    const res = await fetch("/api/create-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        provider: provider || "AWS",
        monthlyBill: bill,
        companyName: companyName || "Your Company",
        savingsMin: savMin,
        savingsMax: savMax,
        flaggedIssues: flagged.map(c => ({ id: c.id, label: c.label })),
        currency: currency.stripeCurrency,
        currencyAmount: currency.cfoReportAmount,
        productType: "cfo_report",
        sessionId,
      }),
    });
    if (!res.ok) {
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const errData = await res.json();
        throw new Error(errData.error || `Checkout failed (${res.status})`);
      }
      throw new Error(`Checkout failed (${res.status})`);
    }
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      throw new Error(data.error || "Checkout failed");
    }
  };

  const handleExportPDF = () => {
    const isSec = step === 'security_report';
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const items = isSec
      ? SEC_SECTIONS.flatMap(s => s.checks).filter(c => secChecked[c.id])
      : flagged;

    const rows = items.map(c => {
      const sMin = !isSec && bill > 0 ? Math.round(bill * c.savingsRange[0] / 100) : null;
      const sMax = !isSec && bill > 0 ? Math.round(bill * c.savingsRange[1] / 100) : null;
      const severity = isSec ? c.risk : c.impact;
      const sevColor = { Critical: '#dc2626', High: '#ea580c', Medium: '#d97706', Low: '#16a34a' }[severity] || '#64748b';
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">
            <span style="font-weight:600;color:#0f172a;">${c.label}</span><br/>
            <span style="font-size:12px;color:#64748b;">${c.detail || ''}</span>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">
            <span style="background:${sevColor}15;color:${sevColor};font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;border:1px solid ${sevColor}30;">${severity}</span>
          </td>
          ${!isSec && sMin !== null ? `<td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;color:#16a34a;">$${sMin.toLocaleString()}–$${sMax.toLocaleString()}/mo</td>` : '<td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;"></td>'}
        </tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>KloudAudit — ${isSec ? 'Security' : 'Cost'} Report · ${companyName || 'Cloud Audit'} · ${date}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a; background: #fff; padding: 40px; max-width: 900px; margin: 0 auto; }
    @page { margin: 20mm; }
    @media print { body { padding: 0; } .no-print { display: none; } }
  </style>
</head>
<body>
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:24px;border-bottom:2px solid #00ffb4;margin-bottom:32px;">
    <div style="display:flex;align-items:center;gap:10px;">
      <div style="width:32px;height:32px;background:#00ffb4;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;">⚡</div>
      <span style="font-weight:800;font-size:20px;letter-spacing:-0.5px;">KloudAudit</span>
    </div>
    <div style="text-align:right;">
      <p style="font-weight:700;font-size:14px;">${isSec ? 'Security' : 'Cost Optimisation'} Report</p>
      <p style="font-size:12px;color:#64748b;">${companyName || 'Cloud Audit'} · ${provider || 'AWS'} · ${date}</p>
    </div>
  </div>

  <!-- Summary cards -->
  <div style="display:grid;grid-template-columns:repeat(${isSec ? 2 : 4},1fr);gap:16px;margin-bottom:32px;">
    ${!isSec && bill > 0 ? `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;">
      <p style="font-size:10px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Monthly Savings</p>
      <p style="font-size:20px;font-weight:800;color:#15803d;">$${savMin.toLocaleString()}–$${savMax.toLocaleString()}</p>
      <p style="font-size:11px;color:#64748b;">per month</p>
    </div>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:16px;">
      <p style="font-size:10px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Annual Opportunity</p>
      <p style="font-size:20px;font-weight:800;color:#1d4ed8;">$${(savMin*12).toLocaleString()}+</p>
      <p style="font-size:11px;color:#64748b;">per year</p>
    </div>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:16px;">
      <p style="font-size:10px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Waste Rate</p>
      <p style="font-size:20px;font-weight:800;color:#dc2626;">~${savPct}%</p>
      <p style="font-size:11px;color:#64748b;">of total bill</p>
    </div>` : ''}
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:16px;">
      <p style="font-size:10px;font-weight:700;color:#c2410c;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Issues Found</p>
      <p style="font-size:20px;font-weight:800;color:#c2410c;">${items.length}</p>
      <p style="font-size:11px;color:#64748b;">of ${isSec ? '16' : '18'} checks</p>
    </div>
  </div>

  <!-- Findings table -->
  <h2 style="font-size:16px;font-weight:700;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #e2e8f0;">Issues Found</h2>
  <table style="width:100%;border-collapse:collapse;margin-bottom:32px;">
    <thead>
      <tr style="background:#f8fafc;">
        <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Issue</th>
        <th style="padding:10px 12px;text-align:center;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Severity</th>
        <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">${isSec ? '' : 'Est. Savings'}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <!-- Footer -->
  <div style="border-top:1px solid #e2e8f0;padding-top:20px;display:flex;justify-content:space-between;align-items:center;">
    <p style="font-size:11px;color:#94a3b8;">🔒 Generated by KloudAudit · kloudaudit.eu · No cloud credentials were accessed</p>
    <p style="font-size:11px;color:#94a3b8;">${date}</p>
  </div>
  <script>window.onload = () => window.print();</script>
</body>
</html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  };

  const handleBuySubscription = async (email) => {
    setSubStatus('loading');
    try {
      window.gtag?.('event', 'subscription_checkout_initiated', { currency: currency.stripeCurrency });
      const res = await fetch("/api/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          provider:       provider || "AWS",
          stripeCurrency: currency.stripeCurrency,
          currency:       currency.stripeCurrency,
          productType:    "subscription",
          sessionId,
        }),
      });
      const data = await res.json();
      if (data.code === 'subscription_not_configured') {
        // Price ID not set up in Stripe yet — fall back gracefully
        setSubStatus('not_configured');
        return;
      }
      if (!res.ok) throw new Error(data.error || `Checkout failed (${res.status})`);
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || "Checkout failed");
      }
    } catch (err) {
      console.error('Subscription checkout error:', err.message);
      setSubStatus('error');
      setTimeout(() => setSubStatus('idle'), 5000);
    }
  };

  // ── NAV ────────────────────────────────────────────────────────────────────
  const Nav = ({ showBack, onBack }) => (
    <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(8,8,16,0.85)", backdropFilter: "blur(20px)", borderBottom: "1px solid var(--border)", padding: "0 24px", height: "58px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {showBack && <button className="ghost-btn" onClick={onBack} style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text-dim)", fontSize: "13px", padding: "6px 12px", marginRight: "4px" }}>← Back</button>}
        <div role="link" tabIndex={0} onKeyDown={e => e.key === "Enter" && goTo("intro")} onClick={() => goTo("intro")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "10px" }}>
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
        {step === "intro" && (
          <a href="https://dev.to/kloudaudit" target="_blank" rel="noopener noreferrer" style={{ background: "transparent", border: "none", color: "var(--text-dim)", fontSize: "13px", fontWeight: 600, textDecoration: "none" }}>Blog</a>
        )}
      </div>
    </nav>
  );

  // ── SAMPLE MODAL ───────────────────────────────────────────────────────────
  const SampleModal = () => {
    const getSev = c => { const p = (c.savingsRange[0] + c.savingsRange[1]) / 2; return p >= 30 ? "high" : p >= 15 ? "med" : "low"; };
    const sHigh = sampleFlagged.filter(c => getSev(c) === "high");
    const sMed  = sampleFlagged.filter(c => getSev(c) === "med");
    const sLow  = sampleFlagged.filter(c => getSev(c) === "low");
    const closeModal = () => { setShowSample(false); setSampleTab("report"); };
    const timePill = (label) => (
      <div style={{ marginBottom: "16px" }}>
        <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: "20px", padding: "3px 10px" }}>⏱ Time to implement: {label}</span>
      </div>
    );
    const issueMeta = (title, savings, fixTime) => (
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "16px" }}>
        <h3 style={{ fontSize: "17px", fontWeight: 800, color: "#fff", margin: 0 }}>{title}</h3>
        <span style={{ fontSize: "11px", fontWeight: 700, color: "#00ffb4", background: "rgba(0,255,180,0.1)", border: "1px solid rgba(0,255,180,0.25)", borderRadius: "8px", padding: "2px 8px" }}>{savings}</span>
        <span style={{ fontSize: "11px", color: "var(--text-muted)", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: "8px", padding: "2px 8px" }}>Fix time: {fixTime}</span>
      </div>
    );
    const stepLabel = (text) => <p style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-dim)", marginBottom: "8px" }}>{text}</p>;

    return (
      <div onClick={closeModal} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", animation: "fadeIn 0.2s ease" }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="sample-dialog-title" style={{ background: "var(--bg2)", border: "1px solid rgba(0,255,180,0.2)", borderRadius: "20px", maxWidth: "780px", width: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 40px 80px rgba(0,0,0,0.7)" }}>

          {/* ── Sticky header + tab switcher ── */}
          <div style={{ padding: "28px 32px 20px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--bg2)", zIndex: 10, borderRadius: "20px 20px 0 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
                  {["Sample Report", SAMPLE_REPORT.provider, "Apr 2026"].map(t => <span key={t} style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-dim)", fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "20px", border: "1px solid var(--border)" }}>{t}</span>)}
                </div>
                <h2 id="sample-dialog-title" className="display" style={{ fontSize: "26px", fontWeight: 800, letterSpacing: "-1px", color: "#fff" }}>{SAMPLE_REPORT.companyName} · Cost Report</h2>
                <p style={{ color: "var(--text-muted)", fontSize: "14px", marginTop: "4px" }}>Monthly bill: ${SAMPLE_REPORT.monthlyBill.toLocaleString()} · {sampleFlagged.length} issues found</p>
              </div>
              <button onClick={closeModal} aria-label="Close" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text-muted)", fontSize: "18px", width: "36px", height: "36px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>×</button>
            </div>
            <div style={{ display: "flex", gap: "8px", marginTop: "16px", alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={() => setSampleTab("report")} style={{ padding: "7px 18px", borderRadius: "20px", border: `1px solid ${sampleTab === "report" ? "var(--green-border)" : "var(--border)"}`, background: sampleTab === "report" ? "var(--green-dim)" : "transparent", color: sampleTab === "report" ? "var(--green)" : "var(--text-muted)", fontSize: "13px", fontWeight: 600, cursor: "pointer", transition: "all 0.15s" }}>Free Report</button>
              <button onClick={() => setSampleTab("blueprint")} style={{ padding: "7px 18px", borderRadius: "20px", border: `1px solid ${sampleTab === "blueprint" ? "rgba(129,140,248,0.4)" : "var(--border)"}`, background: sampleTab === "blueprint" ? "rgba(129,140,248,0.12)" : "transparent", color: sampleTab === "blueprint" ? "#818cf8" : "var(--text-muted)", fontSize: "13px", fontWeight: 600, cursor: "pointer", transition: "all 0.15s" }}>Blueprint Preview ⚡</button>
              {sampleTab === "blueprint" && <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>what you get for {currency.blueprintPrice}</span>}
            </div>
          </div>

          <div style={{ padding: "24px 32px" }}>
            {sampleTab === "report" ? (
              <>
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
                  <button className="glow-btn" onClick={() => { closeModal(); goTo("intake"); }} style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "10px", padding: "13px 32px", fontSize: "15px", fontWeight: 700, boxShadow: "0 0 20px rgba(0,255,180,0.3)" }}>Run Your Free Audit →</button>
                </div>
              </>
            ) : (
              <>
                {/* ── Issue 1: Dev/staging RDS ── */}
                <div style={{ marginBottom: "32px" }}>
                  {issueMeta("Issue 1: Dev/staging RDS running 24/7", "$320–$640/month", "20 minutes")}
                  {stepLabel("Step 1 — Identify dev RDS instances")}
                  <CodeBlock code={`aws rds describe-db-instances \\
  --query 'DBInstances[*].[DBInstanceIdentifier,DBInstanceStatus,DBInstanceClass,MultiAZ]' \\
  --output table`} />
                  {timePill("2 min")}

                  {stepLabel("Step 2 — Create auto-shutdown schedule using EventBridge")}
                  <CodeBlock code={`# Stop RDS every night at 8pm UTC
aws events put-rule \\
  --schedule-expression "cron(0 20 * * ? *)" \\
  --name "StopDevRDS" \\
  --state ENABLED

aws events put-targets \\
  --rule StopDevRDS \\
  --targets "Id=1,Arn=arn:aws:lambda:REGION:ACCOUNT:function:StopRDSFunction"`} />
                  {timePill("10 min")}

                  {stepLabel("Step 3 — Terraform equivalent (if using IaC)")}
                  <CodeBlock code={`resource "aws_db_instance" "dev" {
  identifier          = "myapp-dev"
  instance_class      = "db.t3.medium"
  skip_final_snapshot = true

  # Auto-stop via lifecycle — use with EventBridge Lambda
  tags = {
    Environment  = "dev"
    AutoShutdown = "true"
  }
}

resource "aws_cloudwatch_event_rule" "stop_dev_rds" {
  name                = "stop-dev-rds-nightly"
  schedule_expression = "cron(0 20 * * ? *)"
}`} />
                  {timePill("15 min")}

                  {stepLabel("Step 4 — Verify it worked")}
                  <CodeBlock code={`# Check RDS status next morning
aws rds describe-db-instances \\
  --db-instance-identifier myapp-dev \\
  --query 'DBInstances[0].DBInstanceStatus'

# Expected: "stopped"`} />
                  {timePill("2 min")}
                </div>

                {/* ── Issue 2: Unattached EBS Volumes ── */}
                <div style={{ marginBottom: "32px", borderTop: "1px solid var(--border)", paddingTop: "28px" }}>
                  {issueMeta("Issue 2: Unattached EBS Volumes", "$80–$200/month", "10 minutes")}
                  <CodeBlock code={`# Find all unattached volumes
aws ec2 describe-volumes \\
  --filters Name=status,Values=available \\
  --query 'Volumes[*].[VolumeId,Size,VolumeType,CreateTime]' \\
  --output table

# Delete a specific volume (after confirming it is safe)
aws ec2 delete-volume --volume-id vol-0123456789abcdef0

# Or tag for review first
aws ec2 create-tags \\
  --resources vol-0123456789abcdef0 \\
  --tags Key=Status,Value=PendingDeletion Key=ReviewedBy,Value=yourname`} />
                  {timePill("10 min")}
                </div>

                {/* ── Issue 3: Reserved Instances ── */}
                <div style={{ marginBottom: "28px", borderTop: "1px solid var(--border)", paddingTop: "28px" }}>
                  {issueMeta("Issue 3: No Reserved Instances / Savings Plans", "$200–$450/month", "30 minutes")}
                  <CodeBlock code={`# See current on-demand spend by instance type
aws ce get-cost-and-usage \\
  --time-period Start=2026-04-01,End=2026-05-01 \\
  --granularity MONTHLY \\
  --metrics BlendedCost \\
  --group-by Type=DIMENSION,Key=INSTANCE_TYPE \\
  --output table

# Check existing reservations
aws ec2 describe-reserved-instances \\
  --filters Name=state,Values=active \\
  --query 'ReservedInstances[*].[ReservedInstancesId,InstanceType,InstanceCount,End]' \\
  --output table`} />
                  {timePill("30 min")}
                  <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", borderLeft: "3px solid #818cf8", borderRadius: "0 10px 10px 0", padding: "14px 18px", marginBottom: "8px" }}>
                    <p style={{ fontSize: "13px", color: "var(--text-dim)", lineHeight: 1.65 }}>Recommendation: Purchase a 1-year No Upfront Savings Plan for your baseline compute usage. Typical saving: 30–40% vs on-demand. Use the AWS Cost Explorer Savings Plans recommendations page for exact amounts.</p>
                  </div>
                </div>

                {/* ── Blueprint CTA ── */}
                <div style={{ background: "linear-gradient(135deg, rgba(129,140,248,0.08) 0%, rgba(0,255,180,0.06) 100%)", border: "1px solid rgba(129,140,248,0.25)", borderRadius: "14px", padding: "24px", marginTop: "8px" }}>
                  <p style={{ fontSize: "13px", color: "var(--text-dim)", marginBottom: "6px" }}>✅ Your blueprint covers all <strong style={{ color: "#fff" }}>{sampleFlagged.length} issues</strong> found in your audit — not just these 3</p>
                  <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "20px" }}>⚡ Delivered to your inbox within 2 minutes of payment</p>
                  <button className="glow-btn" onClick={() => { closeModal(); window.gtag?.('event', 'blueprint_clicked', { provider: provider, savings_min: savMin, currency: currency.code }); window.gtag?.('event', 'blueprint_modal_opened', { provider: provider }); setShowBlueprint(true); }} style={{ background: "linear-gradient(135deg, #818cf8, #6366f1)", color: "#fff", border: "none", borderRadius: "10px", padding: "13px 32px", fontSize: "15px", fontWeight: 700, boxShadow: "0 0 20px rgba(129,140,248,0.3)" }}>Get Full Blueprint — {currency.blueprintPrice} →</button>
                </div>
              </>
            )}
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
          <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "8px" }}>Subject: "⚡ Your [Provider] Cost Blueprint is ready"</p>
          <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>Check spam if you don't see it within 5 minutes.</p>
        </div>
        <button className="glow-btn" onClick={() => { localStorage.removeItem('ka_session'); setChecked({}); setProvider(''); setMonthlyBill(''); setCompanyName(''); setActiveSection(0); setGateEmail(''); goTo('intro'); }} style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "14px 32px", fontSize: "15px", cursor: "pointer", boxShadow: "0 0 24px rgba(0,255,180,0.3)" }}>Run Another Audit →</button>
      </div>
    </div>
  );


  // ── SECURITY AUDIT INTRO ──────────────────────────────────────────────────
  if (step === "security_intro") {

    const allSecChecks = SEC_SECTIONS.flatMap(s => s.checks);
    const flaggedSec = allSecChecks.filter(c => secChecked[c.id]);
    const criticalCount = flaggedSec.filter(c => c.risk === "Critical").length;
    const highCount = flaggedSec.filter(c => c.risk === "High").length;
    const currentSection = SEC_SECTIONS[secStep];
    const RISK_COLOR = { Critical: "#f87171", High: "#fb923c", Medium: "#fbbf24", Low: "#4ade80" };

    return (
      <div className="app">
        <style>{globalCss}</style>
        <ParticleBackground />
        {showContact && <ContactModal onClose={() => setShowContact(false)} />}
        {showBooking && <BookingModal onClose={() => setShowBooking(false)} sessionPrice={currency.sessionPrice} />}
        <Nav showBack onBack={() => goTo("intro")} />

        {showSecBlueprint && <SecurityBlueprintModal onClose={() => setShowSecBlueprint(false)} secChecked={secChecked} currency={currency} provider={provider} companyName={companyName} />}
        {showSecSample && <SecSampleModal onClose={() => setShowSecSample(false)} />}
        {secSectionToast && (
          <div style={{ position: "fixed", top: "80px", right: "24px", zIndex: 999, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: "10px", padding: "10px 16px", fontSize: "13px", color: "#f87171", animation: "fadeIn 0.2s ease", pointerEvents: "none", maxWidth: "320px", boxShadow: "0 4px 20px rgba(248,113,113,0.15)" }}>
            {secSectionToast}
          </div>
        )}

        <div style={{ maxWidth: "960px", margin: "0 auto", padding: "40px 24px 100px" }}>
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: "40px" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: "20px", padding: "6px 16px", marginBottom: "20px" }}>
              <span style={{ width: "6px", height: "6px", background: "#f87171", borderRadius: "50%", animation: "pulse-dot 2s infinite" }} />
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#f87171", letterSpacing: "1.5px" }}>CLOUD SECURITY AUDIT — AWS · GCP · AZURE — ZERO ACCESS</span>
            </div>
            <h1 className="display" style={{ fontSize: "clamp(28px,4.5vw,52px)", fontWeight: 800, letterSpacing: "-2px", color: "#fff", marginBottom: "14px", lineHeight: 1.05 }}>
              Find the gaps attackers<br /><span style={{ color: "#f87171" }}>scan for first.</span>
            </h1>
            <p style={{ fontSize: "15px", color: "var(--text-muted)", maxWidth: "540px", margin: "0 auto 20px", lineHeight: 1.7 }}>
              16 checkpoints across IAM, network exposure, data protection, and logging. Takes 10 minutes. Zero credentials required.
            </p>
            {/* What you get callouts */}
            <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap", marginBottom: "8px" }}>
              {[
                { icon: "🆓", text: "Free risk score", color: "#4ade80" },
                { icon: "🔒", text: "No cloud access", color: "#94a3b8" },
                { icon: "⚡", text: "Results in 10 min", color: "#818cf8" },
                { icon: "🛡", text: "Blueprint available", color: "#f87171" },
              ].map(b => (
                <div key={b.text} style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "20px", padding: "5px 12px" }}>
                  <span style={{ fontSize: "13px" }}>{b.icon}</span>
                  <span style={{ fontSize: "12px", color: b.color, fontWeight: 600 }}>{b.text}</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: "12px", color: "rgba(148,163,184,0.6)", background: "rgba(248,113,113,0.04)", border: "1px solid rgba(248,113,113,0.1)", borderRadius: "8px", padding: "9px 14px", display: "inline-block", marginTop: "12px" }}>
              🔒 Your answers stay in your browser — nothing sent to our servers until you choose to share it.
            </p>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "10px" }}>
              Not sure what you&apos;ll get?{" "}
              <button onClick={() => setShowSecSample(true)} style={{ background: "none", border: "none", color: "#f87171", fontSize: "13px", cursor: "pointer", textDecoration: "underline", padding: 0, fontFamily: "inherit" }}>
                See a sample security report →
              </button>
            </p>
          </div>

          {/* How to use this */}
          <div style={{ background: "rgba(248,113,113,0.04)", border: "1px solid rgba(248,113,113,0.12)", borderRadius: "12px", padding: "14px 20px", marginBottom: "28px", display: "flex", alignItems: "flex-start", gap: "12px" }}>
            <span style={{ fontSize: "18px", flexShrink: 0 }}>ℹ️</span>
            <div>
              <p style={{ fontSize: "13px", fontWeight: 700, color: "#fff", marginBottom: "3px" }}>How this works</p>
              <p style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.6, margin: 0 }}>
                Go through each section and <strong style={{ color: "#fff" }}>check every issue that currently applies</strong> to your infrastructure. Be honest — the more accurate your answers, the more useful your security score. Your responses are never stored or shared.
              </p>
            </div>
          </div>

          {/* ── PROGRESS STEPPER ── */}
          <div style={{ marginBottom: "32px" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: "16px" }}>
              {SEC_SECTIONS.map((s, i) => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", flex: 1 }}>
                  <button onClick={() => { setSecStep(i); window.gtag?.('event', 'security_section_viewed', { section: SEC_SECTIONS[i]?.title, section_index: i }); }} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", background: "none", border: "none", cursor: "pointer", flex: 1, padding: "0" }}>
                    <div style={{ width: "36px", height: "36px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", transition: "all 0.25s", background: i < secStep ? "#00ffb4" : secStep === i ? s.color + "25" : "rgba(255,255,255,0.05)", border: `2px solid ${i < secStep ? "#00ffb4" : secStep === i ? s.color : "rgba(255,255,255,0.1)"}`, boxShadow: secStep === i ? `0 0 14px ${s.color}50` : "none" }}>
                      {i < secStep ? <span style={{ fontSize: "13px", fontWeight: 800, color: "#000" }}>✓</span> : <span>{s.icon}</span>}
                    </div>
                    <span style={{ fontSize: "10px", fontWeight: 700, color: secStep === i ? s.color : i < secStep ? "#00ffb4" : "var(--text-muted)", whiteSpace: "nowrap" }}>{s.title}</span>
                  </button>
                  {i < SEC_SECTIONS.length - 1 && (
                    <div style={{ height: "2px", flex: 1, background: i < secStep ? "#00ffb4" : "rgba(255,255,255,0.08)", transition: "background 0.3s", marginBottom: "22px" }} />
                  )}
                </div>
              ))}
            </div>
            <div style={{ height: "4px", background: "rgba(255,255,255,0.06)", borderRadius: "2px", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${((secStep + 1) / SEC_SECTIONS.length) * 100}%`, background: "linear-gradient(90deg, #00ffb4, #f87171)", borderRadius: "2px", transition: "width 0.4s cubic-bezier(0.4,0,0.2,1)" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px" }}>
              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Section {secStep + 1} of {SEC_SECTIONS.length} — {currentSection.title}</span>
              <span style={{ fontSize: "11px", color: flaggedSec.length > 0 ? "#f87171" : "var(--text-muted)", fontWeight: flaggedSec.length > 0 ? 700 : 400 }}>{flaggedSec.length} issue{flaggedSec.length !== 1 ? "s" : ""} flagged</span>
            </div>
          </div>

          {/* ── MAIN GRID ── */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 250px", gap: "24px", alignItems: "start" }} className="sec-audit-grid">
            {/* Left — checks */}
            <div>
              <div style={{ marginBottom: "14px" }}>
                <h2 className="display" style={{ fontSize: "20px", fontWeight: 700, color: "#fff", marginBottom: "4px" }}>{currentSection.icon} {currentSection.title}</h2>
                <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>{currentSection.desc}</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "8px", padding: "8px 14px", marginBottom: "14px" }}>
                <span style={{ fontSize: "13px" }}>☑</span>
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Check every issue that applies to your infrastructure — be honest, this is for your benefit</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {currentSection.checks.map((check, i) => (
                  <div key={check.id} role="checkbox" aria-checked={!!secChecked[check.id]} tabIndex={0} onKeyDown={e => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSecChecked(p => ({ ...p, [check.id]: !p[check.id] })))} onClick={() => setSecChecked(p => ({ ...p, [check.id]: !p[check.id] }))}
                    style={{ background: secChecked[check.id] ? RISK_COLOR[check.risk] + "0e" : "rgba(255,255,255,0.02)", border: `1.5px solid ${secChecked[check.id] ? RISK_COLOR[check.risk] + "55" : "rgba(255,255,255,0.07)"}`, borderRadius: "12px", padding: "15px 18px", cursor: "pointer", transition: "all 0.2s", boxShadow: secChecked[check.id] ? `0 0 0 1px ${RISK_COLOR[check.risk]}18` : "none", animation: "card-in 0.35s ease both", animationDelay: `${i * 55}ms` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "5px", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "10px", fontWeight: 800, color: RISK_COLOR[check.risk], background: RISK_COLOR[check.risk] + "18", border: `1px solid ${RISK_COLOR[check.risk]}30`, borderRadius: "4px", padding: "1px 7px", textTransform: "uppercase", letterSpacing: "0.3px" }}>{check.risk}</span>
                          {check.tte && <span style={{ fontSize: "10px", fontWeight: 700, color: "#f87171", background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: "4px", padding: "1px 6px" }}>⚡ exploitable {check.tte}</span>}
                          {check.effort && <span style={{ fontSize: "10px", fontWeight: 700, color: EFFORT_COLOR[check.effort], background: EFFORT_COLOR[check.effort] + "18", border: `1px solid ${EFFORT_COLOR[check.effort]}30`, borderRadius: "4px", padding: "1px 6px" }}>{check.effort} fix</span>}
                        </div>
                        <p style={{ fontSize: "14px", fontWeight: 700, color: secChecked[check.id] ? "#fff" : "#cbd5e1", margin: "0 0 3px" }}>{check.label}</p>
                        <p style={{ fontSize: "12px", color: secChecked[check.id] ? "#94a3b8" : "rgba(148,163,184,0.55)", lineHeight: 1.5, margin: "0 0 7px" }}>{check.detail}</p>
                        {check.compliance && (
                          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                            {check.compliance.map(c => (
                              <span key={c} style={{ fontSize: "9px", fontWeight: 700, color: COMPLIANCE_COLOR[c], background: COMPLIANCE_COLOR[c] + "15", border: `1px solid ${COMPLIANCE_COLOR[c]}30`, borderRadius: "3px", padding: "1px 5px", letterSpacing: "0.3px" }}>{c}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div style={{ width: "24px", height: "24px", borderRadius: "6px", border: `2px solid ${secChecked[check.id] ? RISK_COLOR[check.risk] : "rgba(255,255,255,0.18)"}`, background: secChecked[check.id] ? RISK_COLOR[check.risk] : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s", boxShadow: secChecked[check.id] ? `0 0 8px ${RISK_COLOR[check.risk]}50` : "none", marginTop: "2px" }}>
                        {secChecked[check.id] && <span style={{ color: "#000", fontSize: "13px", fontWeight: 900, lineHeight: 1 }}>✓</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Navigation */}
              <div style={{ display: "flex", gap: "10px", marginTop: "24px" }}>
                {secStep > 0 && (
                  <button onClick={() => setSecStep(s => s - 1)} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "12px 20px", color: "var(--text-muted)", fontSize: "14px", cursor: "pointer" }}>← Back</button>
                )}
                {secStep < SEC_SECTIONS.length - 1 ? (
                  <button onClick={() => { const next = secStep + 1; setSecStep(next); window.gtag?.('event', 'security_section_viewed', { section: SEC_SECTIONS[next]?.title, section_index: next }); const flaggedInSec = currentSection.checks.filter(c => secChecked[c.id]).length; const msg = `✓ ${currentSection.title} complete — ${flaggedInSec} issue${flaggedInSec !== 1 ? 's' : ''} found`; clearTimeout(secToastTimerRef.current); setSecSectionToast(msg); secToastTimerRef.current = setTimeout(() => setSecSectionToast(null), 1500); }} style={{ flex: 1, padding: "13px 24px", borderRadius: "10px", border: "none", background: currentSection.color, color: "#000", fontWeight: 800, fontSize: "14px", cursor: "pointer", boxShadow: `0 4px 16px ${currentSection.color}35` }}>
                    Next: {SEC_SECTIONS[secStep + 1].title} →
                  </button>
                ) : (
                  <button onClick={() => {
                      const issueW = Math.min(flaggedSec.length / allSecChecks.length, 1) * 40;
                      const critW  = Math.min(criticalCount * 15, 40);
                      const highW  = Math.min(highCount * 5, 20);
                      const score  = Math.max(0, Math.min(100, Math.round(100 - issueW - critW - highW)));
                      setSecScore(score);
                      window.gtag?.('event', 'security_report_viewed', { flagged_count: flaggedSec.length, sec_score: score });
                      goTo("security_report");
                    }}
                    disabled={flaggedSec.length === 0}
                    style={{ flex: 1, padding: "13px 24px", borderRadius: "10px", border: "none", background: flaggedSec.length > 0 ? "#f87171" : "rgba(255,255,255,0.06)", color: flaggedSec.length > 0 ? "#000" : "var(--text-muted)", fontWeight: 800, fontSize: "14px", cursor: flaggedSec.length > 0 ? "pointer" : "not-allowed", boxShadow: flaggedSec.length > 0 ? "0 4px 20px rgba(248,113,113,0.35)" : "none" }}>
                    {flaggedSec.length === 0 ? "Select at least one issue →" : "See My Security Score →"}
                  </button>
                )}
              </div>
            </div>

            {/* Right — sticky sidebar */}
            <div style={{ position: "sticky", top: "80px", display: "flex", flexDirection: "column", gap: "12px" }}>
              {/* Live risk counts */}
              {(() => {
                const urgency = flaggedSec.length === 0
                  ? { bg: "rgba(255,255,255,0.02)", border: "rgba(255,255,255,0.07)", msg: null }
                  : flaggedSec.length <= 3
                  ? { bg: "rgba(251,191,36,0.06)", border: "rgba(251,191,36,0.2)", msg: "⚠ Security gaps detected", msgColor: "#fbbf24" }
                  : flaggedSec.length <= 7
                  ? { bg: "rgba(251,146,60,0.07)", border: "rgba(251,146,60,0.25)", msg: "🔴 Elevated risk level", msgColor: "#fb923c" }
                  : { bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.3)", msg: "🚨 Critical exposure — act now", msgColor: "#f87171", pulse: true };
                return (
                  <div style={{ background: urgency.bg, border: `1px solid ${urgency.border}`, borderRadius: "14px", padding: "18px", transition: "all 0.3s" }}>
                    <p style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: urgency.msg ? "6px" : "12px" }}>Live Risk Tracker</p>
                    {urgency.msg && (
                      <p style={{ fontSize: "12px", fontWeight: 800, color: urgency.msgColor, marginBottom: "12px", animation: urgency.pulse ? "urgency-pulse 1.5s ease-in-out infinite" : "none" }}>{urgency.msg}</p>
                    )}
                    {flaggedSec.length === 0 ? (
                      <p style={{ fontSize: "12px", color: "rgba(148,163,184,0.45)", lineHeight: 1.65 }}>Flag issues to see your risk level.</p>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {criticalCount > 0 && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.18)", borderRadius: "8px", padding: "9px 12px" }}>
                          <span style={{ fontSize: "12px", fontWeight: 700, color: "#f87171" }}>🔴 Critical</span>
                          <span style={{ fontSize: "18px", fontWeight: 800, color: "#f87171", lineHeight: 1 }}>{criticalCount}</span>
                        </div>}
                        {highCount > 0 && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(251,146,60,0.08)", border: "1px solid rgba(251,146,60,0.18)", borderRadius: "8px", padding: "9px 12px" }}>
                          <span style={{ fontSize: "12px", fontWeight: 700, color: "#fb923c" }}>🟠 High</span>
                          <span style={{ fontSize: "18px", fontWeight: 800, color: "#fb923c", lineHeight: 1 }}>{highCount}</span>
                        </div>}
                        {flaggedSec.filter(c => c.risk === "Medium").length > 0 && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.18)", borderRadius: "8px", padding: "9px 12px" }}>
                          <span style={{ fontSize: "12px", fontWeight: 700, color: "#fbbf24" }}>🟡 Medium</span>
                          <span style={{ fontSize: "18px", fontWeight: 800, color: "#fbbf24", lineHeight: 1 }}>{flaggedSec.filter(c => c.risk === "Medium").length}</span>
                        </div>}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Live score estimate */}
              {flaggedSec.length > 0 && (() => {
                const issueW = Math.min(flaggedSec.length / 16, 1) * 40;
                const critW  = Math.min(criticalCount * 15, 40);
                const highW  = Math.min(highCount * 5, 20);
                const score  = Math.max(0, Math.min(100, Math.round(100 - issueW - critW - highW)));
                const col    = score >= 80 ? "#4ade80" : score >= 60 ? "#fbbf24" : score >= 40 ? "#fb923c" : "#f87171";
                const lbl    = score >= 80 ? "Low Risk" : score >= 60 ? "Medium Risk" : score >= 40 ? "High Risk" : "Critical Risk";
                return (
                  <div style={{ background: col + "10", border: `1px solid ${col}22`, borderRadius: "14px", padding: "16px 18px", textAlign: "center" }}>
                    <p style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "8px" }}>Score Estimate</p>
                    <div style={{ fontSize: "38px", fontWeight: 800, color: col, lineHeight: 1, letterSpacing: "-1px", marginBottom: "4px" }}>{score}</div>
                    <p style={{ fontSize: "12px", fontWeight: 700, color: col, margin: "0 0 4px" }}>{lbl}</p>
                    <p style={{ fontSize: "11px", color: "rgba(148,163,184,0.5)", margin: 0 }}>Updates as you flag issues</p>
                  </div>
                );
              })()}

              {/* CTA in sidebar on last step */}
              {secStep === SEC_SECTIONS.length - 1 && flaggedSec.length > 0 && (
                <button onClick={() => { window.gtag?.('event', 'security_blueprint_modal_opened', {}); setShowSecBlueprint(true); }}
                  style={{ width: "100%", padding: "12px 14px", borderRadius: "12px", border: "none", background: "#f87171", color: "#000", fontWeight: 800, fontSize: "12px", cursor: "pointer", boxShadow: "0 4px 16px rgba(248,113,113,0.3)" }}>
                  {`Get Blueprint — ${currency.securityPrice || "$29"}`}
                </button>
              )}
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
        {showContact && <ContactModal onClose={() => setShowContact(false)} />}
        {showBooking && <BookingModal onClose={() => setShowBooking(false)} sessionPrice={currency.sessionPrice} />}
        {showSecBlueprint && <SecurityBlueprintModal onClose={() => setShowSecBlueprint(false)} secChecked={secChecked} currency={currency} provider={provider} companyName={companyName} />}
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

          {/* ── SECURITY SCORE CARD ── */}
          {(() => {
            const allSecChecks2 = [
              {id:"mfa_all",risk:"Critical"},{id:"iam_wildcards",risk:"Critical"},{id:"root_usage",risk:"High"},{id:"unused_keys",risk:"High"},
              {id:"public_buckets",risk:"Critical"},{id:"open_security_groups",risk:"High"},{id:"no_vpc",risk:"High"},{id:"no_waf",risk:"Medium"},
              {id:"no_encryption_rest",risk:"High"},{id:"no_encryption_transit",risk:"High"},{id:"hardcoded_secrets",risk:"Critical"},{id:"no_kms",risk:"Medium"},
              {id:"no_cloudtrail",risk:"High"},{id:"no_alerts",risk:"High"},{id:"no_ir_plan",risk:"Medium"},{id:"no_vuln_scanning",risk:"Medium"},
            ];
            const flaggedS  = allSecChecks2.filter(c => secChecked[c.id]);
            const critCount = flaggedS.filter(c => c.risk === "Critical").length;
            const highCount2 = flaggedS.filter(c => c.risk === "High").length;
            const issueW    = Math.min(flaggedS.length / 16, 1) * 40;
            const critW     = Math.min(critCount * 15, 40);
            const highW     = Math.min(highCount2 * 5, 20);
            const score     = secScore !== null ? secScore : Math.max(0, Math.min(100, Math.round(100 - issueW - critW - highW)));
            const grade     = score >= 80 ? { label: "Low Risk",      color: "#4ade80", ring: "#4ade80" }
                            : score >= 60 ? { label: "Medium Risk",   color: "#fbbf24", ring: "#fbbf24" }
                            : score >= 40 ? { label: "High Risk",     color: "#fb923c", ring: "#fb923c" }
                            :               { label: "Critical Risk", color: "#f87171", ring: "#f87171" };
            const circ = 2 * Math.PI * 54;
            const dash = circ * (1 - score / 100);
            return (
              <div style={{ background: "var(--bg2)", border: `1.5px solid ${grade.ring}30`, borderRadius: "20px", padding: "32px", marginBottom: "24px", display: "flex", alignItems: "center", gap: "32px", flexWrap: "wrap" }}>
                {/* Ring */}
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <svg width="120" height="120" style={{ transform: "rotate(-90deg)" }}>
                    <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
                    <circle cx="60" cy="60" r="54" fill="none" stroke={grade.ring} strokeWidth="10"
                      strokeDasharray={circ} strokeDashoffset={dash} strokeLinecap="round"
                      style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)", filter: `drop-shadow(0 0 8px ${grade.ring}60)` }} />
                  </svg>
                  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: "30px", fontWeight: 800, color: grade.color, lineHeight: 1, letterSpacing: "-1px" }}>{score}</span>
                    <span style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 600 }}>/ 100</span>
                  </div>
                </div>
                {/* Details */}
                <div style={{ flex: 1, minWidth: "180px" }}>
                  <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "6px" }}>Security Risk Score</p>
                  <h2 style={{ fontSize: "26px", fontWeight: 800, color: grade.color, letterSpacing: "-0.5px", marginBottom: "8px" }}>{grade.label}</h2>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
                    {critCount > 0 && <span style={{ fontSize: "12px", color: "#f87171", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: "6px", padding: "3px 10px", fontWeight: 700 }}>🔴 {critCount} Critical</span>}
                    {highCount2 > 0 && <span style={{ fontSize: "12px", color: "#fb923c", background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.25)", borderRadius: "6px", padding: "3px 10px", fontWeight: 700 }}>🟠 {highCount2} High</span>}
                    {flaggedS.filter(c => c.risk === "Medium").length > 0 && <span style={{ fontSize: "12px", color: "#fbbf24", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: "6px", padding: "3px 10px", fontWeight: 700 }}>🟡 {flaggedS.filter(c=>c.risk==="Medium").length} Medium</span>}
                  </div>
                  <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.6 }}>
                    {score < 40 ? `${critCount} critical vulnerabilities detected. Your infrastructure is at active risk. Immediate remediation required.`
                    : score < 60 ? `Significant security gaps found. ${flaggedS.length} issues need attention before your next compliance review.`
                    : score < 80 ? `Some security issues detected. Address these before your next pentest or audit.`
                    : `Good security posture. Minor issues found — address them to maintain compliance.`}
                  </p>
                </div>
              </div>
            );
          })()}

          {/* ── FINDINGS PREVIEW (free) ── */}
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "20px", overflow: "hidden", marginBottom: "24px" }}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#fff", marginBottom: "2px" }}>Issues Found</h3>
                <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>Severity ranking · free preview</p>
              </div>
              <span style={{ fontSize: "12px", color: "#f87171", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "20px", padding: "4px 12px", fontWeight: 700 }}>
                {Object.keys(secChecked).filter(k => secChecked[k]).length} issues
              </span>
            </div>
            {/* First 2 issues — fully visible; rest blurred */}
            {SEC_SECTIONS.flatMap(s => s.checks).filter(c => secChecked[c.id]).map((c, i) => {
              const RISK_COLOR = { Critical: "#f87171", High: "#fb923c", Medium: "#fbbf24" };
              const isLocked = i >= 2;
              return (
                <div key={c.id} style={{ padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", position: "relative", filter: isLocked ? "blur(3px)" : "none", userSelect: isLocked ? "none" : "auto" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "5px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "10px", fontWeight: 700, color: RISK_COLOR[c.risk], background: RISK_COLOR[c.risk] + "15", border: `1px solid ${RISK_COLOR[c.risk]}30`, borderRadius: "4px", padding: "1px 6px" }}>{c.risk}</span>
                      {c.tte && <span style={{ fontSize: "10px", fontWeight: 700, color: "#f87171", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: "4px", padding: "1px 6px" }}>⚡ {c.tte}</span>}
                      {c.effort && <span style={{ fontSize: "10px", fontWeight: 700, color: EFFORT_COLOR[c.effort], background: EFFORT_COLOR[c.effort] + "15", border: `1px solid ${EFFORT_COLOR[c.effort]}30`, borderRadius: "4px", padding: "1px 6px" }}>{c.effort} fix</span>}
                    </div>
                    <p style={{ fontSize: "13px", fontWeight: 600, color: isLocked ? "rgba(255,255,255,0.3)" : "#fff", margin: "0 0 3px" }}>{c.label}</p>
                    <p style={{ fontSize: "12px", color: "rgba(148,163,184,0.5)", margin: "0 0 6px" }}>{c.detail}</p>
                    {!isLocked && c.compliance && (
                      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                        {c.compliance.map(tag => (
                          <span key={tag} style={{ fontSize: "9px", fontWeight: 700, color: COMPLIANCE_COLOR[tag], background: COMPLIANCE_COLOR[tag] + "12", border: `1px solid ${COMPLIANCE_COLOR[tag]}28`, borderRadius: "3px", padding: "1px 5px", letterSpacing: "0.3px" }}>{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {isLocked
                    ? <span style={{ fontSize: "11px", color: "#f87171", fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>🔒 Locked</span>
                    : <span style={{ fontSize: "11px", color: "#94a3b8", flexShrink: 0 }}>Visible</span>
                  }
                </div>
              );
            })}
            {/* Unlock overlay */}
            {Object.keys(secChecked).filter(k => secChecked[k]).length > 2 && (
              <div style={{ padding: "20px 24px", background: "linear-gradient(135deg, rgba(248,113,113,0.06), rgba(251,146,60,0.04))", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
                <div>
                  <p style={{ fontSize: "13px", fontWeight: 700, color: "#fff", marginBottom: "2px" }}>
                    🔒 {Object.keys(secChecked).filter(k => secChecked[k]).length - 2} more issues + full remediation locked
                  </p>
                  <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>CLI commands · Compliance mapping · 30-day fix roadmap</p>
                </div>
                <button onClick={() => { window.gtag?.('event', 'security_blueprint_modal_opened', {}); setShowSecBlueprint(true); }}
                  style={{ background: "#f87171", color: "#000", border: "none", borderRadius: "10px", padding: "10px 22px", fontSize: "13px", fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap", boxShadow: "0 4px 16px rgba(248,113,113,0.3)" }}>
                  {`Unlock Blueprint — ${currency.securityPrice || "$29"} →`}
                </button>
              </div>
            )}
          </div>

          {/* Sample fix teaser */}
          <div style={{ background: "var(--bg2)", border: "1px solid rgba(248,113,113,0.15)", borderRadius: "20px", overflow: "hidden", marginBottom: "24px", position: "relative" }}>
            <div style={{ padding: "18px 24px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p style={{ fontSize: "12px", fontWeight: 700, color: "#f87171", textTransform: "uppercase", letterSpacing: "1px", margin: "0 0 2px" }}>Sample Blueprint Fix</p>
                <p style={{ fontSize: "13px", fontWeight: 600, color: "#fff", margin: 0 }}>MFA enforcement — IAM policy template</p>
              </div>
              <span style={{ fontSize: "10px", color: "#475569", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", padding: "2px 8px", fontWeight: 700 }}>AWS CLI</span>
            </div>
            <div style={{ position: "relative" }}>
              <pre style={{ margin: 0, padding: "20px 24px", fontSize: "12px", lineHeight: 1.7, color: "#94a3b8", background: "rgba(0,0,0,0.3)", fontFamily: "monospace", overflow: "hidden", filter: "blur(3.5px)", userSelect: "none", WebkitUserSelect: "none" }}>{`# Step 1 — Create MFA enforcement policy
aws iam create-policy \\
  --policy-name EnforceMFA \\
  --policy-document file://enforce-mfa.json

# Step 2 — Attach to all IAM users
aws iam list-users --query 'Users[*].UserName' \\
  --output text | xargs -I{} \\
  aws iam attach-user-policy \\
    --user-name {} \\
    --policy-arn arn:aws:iam::ACCOUNT_ID:policy/EnforceMFA

# Step 3 — Verify enforcement
aws iam simulate-principal-policy \\
  --policy-source-arn arn:aws:iam::ACCOUNT_ID:user/testuser \\
  --action-names "s3:GetObject"`}</pre>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, rgba(15,15,26,0.6), rgba(19,19,31,0.5))", backdropFilter: "blur(1px)" }}>
                <span style={{ fontSize: "24px", marginBottom: "8px" }}>🔒</span>
                <p style={{ fontSize: "14px", fontWeight: 800, color: "#fff", marginBottom: "4px" }}>Full fix guide locked</p>
                <p style={{ fontSize: "12px", color: "#94a3b8", marginBottom: "16px", textAlign: "center", maxWidth: "260px", lineHeight: 1.5 }}>Blueprint includes exact CLI commands, Terraform snippets, and verification steps for every flagged issue</p>
                <button onClick={() => { window.gtag?.('event', 'security_blueprint_modal_opened', { source: "sample_teaser" }); setShowSecBlueprint(true); }}
                  style={{ background: "#f87171", color: "#000", border: "none", borderRadius: "10px", padding: "10px 24px", fontSize: "13px", fontWeight: 800, cursor: "pointer", boxShadow: "0 4px 20px rgba(248,113,113,0.4)" }}>
                  {`Unlock All Fixes — ${currency.securityPrice || "$29"} →`}
                </button>
              </div>
            </div>
          </div>

          {/* Trust + CTA */}
          <div style={{ background: "rgba(248,113,113,0.04)", border: "1px solid rgba(248,113,113,0.12)", borderRadius: "16px", padding: "24px", marginBottom: "24px", textAlign: "center" }}>
            <p style={{ fontSize: "13px", fontWeight: 700, color: "#f87171", marginBottom: "6px" }}>🔒 What KloudAudit Security never sees</p>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.65 }}>
              No credentials. No cloud access. No account IDs. This report was generated entirely from your self-reported answers using Claude AI. We have zero visibility into your actual infrastructure.
            </p>
          </div>

          {/* Personalised upsell */}
          {(() => {
            const flaggedSecCount = Object.keys(secChecked).filter(k => secChecked[k]).length;
            return (
              <p style={{ textAlign: "center", fontSize: "13px", color: "rgba(148,163,184,0.75)", marginBottom: "16px", lineHeight: 1.6, maxWidth: "480px", margin: "0 auto 16px" }}>
                {flaggedSecCount > 0
                  ? `${flaggedSecCount} security gap${flaggedSecCount !== 1 ? 's' : ''} found. The ${currency.securityPrice || "$29"} blueprint gives you exact IAM policies, CLI commands and a 30-day fix roadmap.`
                  : `The Security Blueprint covers all 16 checks with exact remediation steps.`}
              </p>
            );
          })()}

          {/* Actions */}
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={() => { window.gtag?.('event', 'security_blueprint_clicked', { flagged_count: Object.keys(secChecked).filter(k => secChecked[k]).length }); window.gtag?.('event', 'security_blueprint_modal_opened', {}); setShowSecBlueprint(true); }}
              style={{ background: "#f87171", color: "#000", border: "none", borderRadius: "12px", padding: "13px 32px", fontSize: "15px", fontWeight: 800, cursor: "pointer", boxShadow: "0 4px 20px rgba(248,113,113,0.3)" }}>
              {`🛡 Get Security Blueprint — ${currency.securityPrice || "$29"} →`}
            </button>
            <button onClick={handleExportPDF} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: "12px", padding: "13px 24px", color: "var(--text-dim)", fontSize: "14px", cursor: "pointer", fontWeight: 600 }}>
              📄 Export PDF
            </button>
            <button onClick={() => { setSecChecked({}); setSecScore(null); setSecStep(0); goTo("security_intro"); }}
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: "12px", padding: "13px 24px", color: "var(--text-dim)", fontSize: "14px", cursor: "pointer", fontWeight: 600 }}>
              🔄 Re-run
            </button>
          </div>

          {/* ── CROSS-SELL: COST AUDIT ── */}
          <div className="fade-up" style={{ background: "linear-gradient(135deg, rgba(0,255,180,0.06) 0%, rgba(99,102,241,0.04) 100%)", border: "1px solid rgba(0,255,180,0.2)", borderRadius: "20px", padding: "32px 36px", marginTop: "20px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "28px", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: "240px" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: "7px", background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "20px", padding: "4px 12px", marginBottom: "12px" }}>
                  <span style={{ width: "5px", height: "5px", background: "var(--green)", borderRadius: "50%", display: "inline-block" }} />
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)", letterSpacing: "1px" }}>ALSO FREE · 15 MIN · NO CREDENTIALS</span>
                </div>
                <h3 className="display" style={{ fontSize: "22px", fontWeight: 800, color: "#fff", letterSpacing: "-0.5px", marginBottom: "8px" }}>
                  Security gaps mapped. What about the waste?
                </h3>
                <p style={{ fontSize: "14px", color: "var(--text-muted)", lineHeight: 1.7, marginBottom: "16px" }}>
                  18 checkpoints across compute, storage, network, database, and governance. Most {provider || "cloud"} teams find $500–$4,000+/month they didn't know about. Free savings estimate in 15 minutes.
                </p>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {["⚡ Compute savings", "🗄 Storage tiering", "🌐 Network waste", "🗃 Database sizing"].map(t => (
                    <span key={t} style={{ fontSize: "12px", color: "var(--green)", background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "20px", padding: "4px 10px", fontWeight: 600 }}>{t}</span>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: "8px", minWidth: "196px" }}>
                <button
                  onClick={() => { window.gtag?.('event', 'cost_audit_crosssell_clicked', { source: 'security_report' }); goTo("intake"); }}
                  style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "14px 24px", fontSize: "15px", fontWeight: 800, cursor: "pointer", boxShadow: "0 4px 20px rgba(0,255,180,0.3)", transition: "all 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 4px 32px rgba(0,255,180,0.5)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,255,180,0.3)"; e.currentTarget.style.transform = "translateY(0)"; }}>
                  ⚡ Run Cost Audit →
                </button>
                <p style={{ fontSize: "11px", color: "var(--text-muted)", textAlign: "center", margin: 0 }}>Free · 18 checks · No account access</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── SEO PAGE ROUTING ─────────────────────────────────────────────────────
  // Maps each issue ID to the audit section index (0–4) so the SEO page CTA
  // deep-links visitors directly to the most relevant part of the audit.
  const ISSUE_TO_SECTION = {
    rightsizing: 0, reserved: 0, spot: 0, old_gen: 0, stopped: 0,   // Compute
    s3_tier: 1, unattached_volumes: 1, snapshots: 1, data_transfer: 1, // Storage
    nat_gateway: 2, unused_ips: 2, lb_unused: 2,                      // Network
    rds_idle: 3, rds_size: 3, cache_missing: 3,                       // Database
    no_budgets: 4, unused_services: 4, dev_prod_parity: 4,            // Governance
  };

  const seoSlug = window.location.pathname.replace(/^\/|\/$/g, "");

  // ── NAT GATEWAY CALCULATOR ────────────────────────────────────────────────
  if (step === "intro" && seoSlug === "nat-gateway-calculator") {
    return (
      <div className="app">
        <style>{globalCss}</style>
        <ParticleBackground />
        {showContact && <ContactModal onClose={() => setShowContact(false)} />}
        <Nav />
        <NATGatewayCalculator onRunAudit={() => goTo("intake")} />
      </div>
    );
  }

  // ── SPOT INSTANCE CALCULATOR ──────────────────────────────────────────────
  if (step === "intro" && seoSlug === "spot-instance-calculator") {
    return (
      <div className="app">
        <style>{globalCss}</style>
        <ParticleBackground />
        {showContact && <ContactModal onClose={() => setShowContact(false)} />}
        <Nav />
        <SpotInstanceCalculator onRunAudit={() => goTo("intake")} />
      </div>
    );
  }

  const seoPage = step === "intro" && seoSlug
    ? SEO_PAGES.find(p => p.slug === seoSlug)
    : null;

  if (seoPage) {
    const sectionIndex = seoPage.issue ? (ISSUE_TO_SECTION[seoPage.issue] ?? 0) : 0;
    const isSecurity = seoPage.type === "security";

    const handleSeoStartAudit = () => {
      window.gtag?.('event', 'seo_cta_clicked', { slug: seoSlug, section: sectionIndex, type: seoPage.type });
      if (isSecurity) {
        goTo("security_intro");
      } else {
        setActiveSection(sectionIndex);
        goTo("intake");
      }
    };

    return (
      <div className="app">
        <style>{globalCss}</style>
        <ParticleBackground />
        {showContact && <ContactModal onClose={() => setShowContact(false)} />}
        <Nav />
        <SEOPage page={seoPage} onStartAudit={handleSeoStartAudit} />
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
      { q: "Do you need access to my cloud account?", a: "Never. Both audits are entirely self-guided — you answer questions based on your own knowledge. No credentials, no IAM roles, no agents, no OAuth. We have zero access to your infrastructure.", tag: "both" },
      { q: "How is the AI Blueprint different from the free report?", a: "The free report tells you what is wrong. The Blueprint tells you exactly how to fix it — with CLI commands, Terraform snippets, IAM policy templates, compliance mappings, and verification steps specific to your provider.", tag: "both" },
      { q: "How fast do I receive the Blueprint?", a: "Within 2 minutes of payment. Claude AI generates your personalised guide in ~30 seconds, then SendGrid delivers it to your inbox. If you don't see it within 5 minutes, check spam or email admin@kloudaudit.eu.", tag: "both" },
      { q: "What does the Security Blueprint include that the free score doesn't?", a: "The free audit shows your risk score and the first 2 flagged issues. The Security Blueprint unlocks all findings with exact CLI remediation commands, IAM policy fixes, compliance gap mapping (SOC 2, ISO 27001, GDPR, CIS Benchmark), and a 30-day remediation roadmap.", tag: "security" },
      { q: "I already use AWS Security Hub / GCP Security Command Center. Why do I need this?", a: "Those tools need account access and take weeks to configure. KloudAudit gives you a prioritised action list in 15 minutes with zero access required — ideal for a quick self-assessment before a pentest, compliance audit, or investor review.", tag: "security" },
      { q: "What if my cloud bill is lower than $1,000/month?", a: "The cost audit is still useful for identifying waste patterns early. The Blueprint is most cost-effective for bills over $1,500/mo. The security audit is valuable at any bill size — a public S3 bucket costs the same to exploit whether you pay $200/mo or $20,000/mo.", tag: "cost" },
      { q: "Is this a subscription?", a: `No. One-time payment — ${currency.blueprintPrice} for the Cost Blueprint, ${currency.securityPrice || "$29"} for the Security Blueprint. You get a permanent document you implement at your own pace.`, tag: "both" },
    ];

    const HOW_IT_WORKS = [
      { n: "01", title: "Run the free cost audit", desc: "Answer 18 structured questions about your AWS, GCP, or Azure setup. 10–15 minutes. No account access, no signup.", color: "#00ffb4" },
      { n: "02", title: "See your savings report", desc: "Instantly see your estimated waste, prioritised findings, and projected monthly savings across compute, storage, database, and network.", color: "#818cf8" },
      { n: "03", title: "Run the security audit", desc: "16 security checkpoints across IAM, network exposure, encryption, and logging. Get your security risk score instantly — free.", color: "#f87171" },
      { n: "04", title: "Get the AI Blueprint", desc: `Pay ${currency.blueprintPrice} (cost) or ${currency.securityPrice || "$29"} (security). Claude AI writes your exact CLI commands, policy fixes, and step-by-step guide.`, color: "#00d4ff" },
      { n: "05", title: "Implement & verify", desc: "Follow the blueprint. Most clients recoup the cost within 24 hours. Re-audit in 90 days to measure improvement.", color: "#fb923c" },
    ];

    return (
    <div className="app">
      <style>{globalCss}</style>
      <ParticleBackground />
      {showSample && <SampleModal />}

      {/* ── EXIT INTENT MODAL ── */}
      {showContact && <ContactModal onClose={() => setShowContact(false)} />}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
      {showBooking && <BookingModal onClose={() => setShowBooking(false)} sessionPrice={currency.sessionPrice} />}
      {showBlueprint && <BlueprintModal onClose={() => setShowBlueprint(false)} onBuy={handleBuyBlueprint} currency={currency} provider={provider} flaggedCount={flagged.length} />}
        {showCfoReport && <CfoReportModal onClose={() => setShowCfoReport(false)} onBuy={handleBuyCfoReport} currency={currency} provider={provider} savMin={savMin} savMax={savMax} flaggedCount={flagged.length} />}
        {showPricingModal && <PricingModal onClose={() => setShowPricingModal(false)} currency={currency} onStartAudit={() => goTo("intake")} onStartSecAudit={() => goTo("security_intro")} onBlueprintClick={() => setShowBlueprint(true)} onSecBlueprintClick={() => setShowSecBlueprint(true)} onCfoReportClick={() => setShowCfoReport(true)} onSessionClick={() => setShowBooking(true)} onSubscribe={handleBuySubscription} />}
      <Nav />

      {/* ── RESUME AUDIT BANNER ── */}
      {initialSession && RESTORABLE_STEPS.includes(initialSession.step) && (
        <div style={{ background: "rgba(0,255,180,0.07)", borderBottom: "1px solid rgba(0,255,180,0.2)", padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", flexWrap: "wrap", fontSize: "13px", color: "var(--text-dim)" }}>
          <span>↩ You have an audit in progress</span>
          <button className="glow-btn" onClick={() => goTo(initialSession.step)} style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "8px", padding: "6px 14px", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>Resume Audit →</button>
          <button onClick={() => { localStorage.removeItem('ka_session'); setChecked({}); setProvider(''); setMonthlyBill(''); setCompanyName(''); setActiveSection(0); setGateEmail(''); }} className="ghost-btn" style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text-muted)", fontSize: "12px", fontWeight: 600, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit" }}>Start Over</button>
        </div>
      )}

            {/* ── STICKY BOTTOM CTA BAR ── */}
      {showStickyBar && (
        <div className="sticky-bottom-cta" style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 90, background: "rgba(8,8,16,0.97)", backdropFilter: "blur(20px)", borderTop: "1px solid rgba(0,255,180,0.2)", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ width: "8px", height: "8px", background: "var(--green)", borderRadius: "50%", boxShadow: "0 0 8px var(--green)", flexShrink: 0 }} />
            <span style={{ fontSize: "13px", color: "var(--text-dim)" }}>⚡ Engineers ran 3 audits today — find out what they found</span>
          </div>
          <button className="glow-btn" onClick={() => goTo("intake")} style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "10px", padding: "11px 28px", fontSize: "14px", boxShadow: "0 0 20px rgba(0,255,180,0.3)", whiteSpace: "nowrap" }}>
            See What My Bill Is Hiding →
          </button>
        </div>
      )}

      <main style={{ position: "relative", zIndex: 1, maxWidth: "1140px", margin: "0 auto", padding: "0 24px", paddingBottom: "72px" }}>


        {/* ── HERO ── */}
        <div className="hero-pad" style={{ paddingTop: "90px", paddingBottom: "72px", textAlign: "center", minHeight: "85vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          {/* ── HEADLINE ── */}
          <h1 className="display fade-up stagger-1" style={{ fontSize: "clamp(42px,6.5vw,82px)", fontWeight: 800, lineHeight: 1.0, letterSpacing: "-3px", color: "#fff", marginBottom: "20px" }}>
            The audit your<br />
            <span style={{ background: "linear-gradient(135deg, #00ffb4 0%, #00d4ff 60%, #818cf8 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>cloud provider</span><br />
            won&apos;t give you.
          </h1>
                {showLeadMagnet && (
        <div onClick={() => setShowLeadMagnet(false)} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",backdropFilter:"blur(6px)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px" }}>
          <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="lead-magnet-dialog-title" style={{ background:"linear-gradient(145deg,#0f0f1a,#13131f)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:"20px",padding:"40px 36px",maxWidth:"460px",width:"100%",position:"relative" }}>
            <button onClick={() => setShowLeadMagnet(false)} aria-label="Close" style={{ position:"absolute",top:"16px",right:"16px",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"8px",color:"var(--text-muted)",width:"30px",height:"30px",cursor:"pointer",fontSize:"16px",display:"flex",alignItems:"center",justifyContent:"center" }}>×</button>
            <div style={{ display:"inline-flex",alignItems:"center",gap:"6px",background:"rgba(0,255,180,0.1)",border:"1px solid rgba(0,255,180,0.25)",borderRadius:"20px",padding:"4px 12px",marginBottom:"20px" }}>
              <span style={{ fontSize:"11px",fontWeight:700,color:"var(--green)",letterSpacing:"1px" }}>FREE DOWNLOAD</span>
            </div>
            <h2 id="lead-magnet-dialog-title" className="display" style={{ fontSize:"24px",fontWeight:800,letterSpacing:"-0.8px",color:"#fff",marginBottom:"10px",lineHeight:1.2 }}>
              2026 Cloud Cost<br/>Optimisation Checklist
            </h2>
            <p style={{ fontSize:"14px",color:"var(--text-muted)",lineHeight:1.65,marginBottom:"20px" }}>
              18 actionable checks across compute, storage, network, database and governance. Find 20–45% savings on AWS, GCP or Azure.
            </p>
            <div style={{ display:"flex",flexDirection:"column",gap:"6px",marginBottom:"24px" }}>
              {["18 checks across all cost categories","Typical savings range for each issue","No credentials required to use","Pairs with the free interactive audit"].map(f => (
                <div key={f} style={{ display:"flex",alignItems:"center",gap:"8px" }}>
                  <span style={{ color:"var(--green)",fontSize:"12px",fontWeight:700 }}>✓</span>
                  <span style={{ fontSize:"13px",color:"var(--text-dim)" }}>{f}</span>
                </div>
              ))}
            </div>
            {leadSubmitted ? (
              <a href="/KloudAudit-2026-Cloud-Cost-Checklist.pdf" download
                onClick={() => { window.gtag?.('event', 'lead_magnet_downloaded', {}); setShowLeadMagnet(false); }}
                style={{ display:"block",width:"100%",padding:"14px",borderRadius:"12px",textDecoration:"none",textAlign:"center",background:"linear-gradient(135deg,var(--green),#00c896)",color:"#000",fontWeight:800,fontSize:"15px",boxShadow:"0 4px 20px rgba(0,255,180,0.3)" }}>
                ⬇ Download PDF Now →
              </a>
            ) : (
              <div style={{ display:"flex",flexDirection:"column",gap:"10px" }}>
                <input
                  type="email"
                  placeholder="your@company.com (optional)"
                  value={leadEmail}
                  onChange={e => setLeadEmail(e.target.value)}
                  style={{ width:"100%",padding:"12px 14px",background:"rgba(255,255,255,0.04)",border:"1.5px solid rgba(255,255,255,0.12)",borderRadius:"10px",color:"#fff",fontSize:"14px",boxSizing:"border-box" }}
                />
                <a href="/KloudAudit-2026-Cloud-Cost-Checklist.pdf" download
                  onClick={() => {
                    window.gtag?.('event', 'lead_magnet_downloaded', { has_email: !!leadEmail });
                    if (leadEmail) {
                      fetch('/api/audits', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'lead_magnet', email: leadEmail }) }).catch(() => null);
                    }
                    setLeadSubmitted(true);
                  }}
                  style={{ display:"block",width:"100%",padding:"14px",borderRadius:"12px",textDecoration:"none",textAlign:"center",background:"linear-gradient(135deg,var(--green),#00c896)",color:"#000",fontWeight:800,fontSize:"15px",boxShadow:"0 4px 20px rgba(0,255,180,0.3)" }}>
                  Get Free PDF →
                </a>
              </div>
            )}
            <button onClick={() => { localStorage.setItem('ka_lead_shown','1'); setShowLeadMagnet(false); }} style={{ display:"block",width:"100%",background:"none",border:"none",textAlign:"center",fontSize:"12px",color:"var(--text-muted)",marginTop:"12px",cursor:"pointer",fontFamily:"inherit",padding:0 }}>
              No thanks
            </button>
          </div>
        </div>
      )}
      {showContact && <ContactModal onClose={() => setShowContact(false)} />}
          {/* ── SUBHEADING ── */}
          <p className="fade-up stagger-2" style={{ fontSize: "18px", color: "var(--text-dim)", lineHeight: 1.75, maxWidth: "520px", margin: "0 auto 28px" }}>
            Find unused cloud spend in minutes. Covers AWS, GCP and Azure — <strong style={{ color: "#fff" }}>no credentials required, ever</strong>. Teams typically uncover <strong style={{ color: "var(--green)" }}>20–45% in savings</strong>.
          </p>
          <MethodologyNote />

          {/* ── PRIMARY ACTION — Provider buttons front and centre ── */}
          <div className="fade-up stagger-2" style={{ marginBottom: "16px" }}>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap", marginBottom: "12px" }}>
              {[
                { label: "AWS", color: "#ff9900" },
                { label: "GCP", color: "#4285f4" },
                { label: "Azure", color: "#0078d4" },
                { label: "Multi-Cloud", color: "#00ffb4" },
              ].map(p => (
                <button key={p.label}
                  role="radio" aria-checked={provider === p.label} tabIndex={0}
                  onClick={() => { window.gtag?.('event', 'audit_started', { provider: p.label }); setProvider(p.label); goTo("intake"); }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.gtag?.('event', 'audit_started', { provider: p.label }); setProvider(p.label); goTo("intake"); } }}
                  style={{ padding: "14px 24px", borderRadius: "12px", border: `2px solid ${p.color}40`, background: `${p.color}12`, color: p.label === "Multi-Cloud" ? "var(--green)" : p.color, fontSize: "15px", fontWeight: 700, cursor: "pointer", transition: "all 0.18s", fontFamily: "inherit", minWidth: "100px" }}
                  onMouseEnter={e => { e.currentTarget.style.background = `${p.color}22`; e.currentTarget.style.borderColor = `${p.color}80`; e.currentTarget.style.transform = "translateY(-2px)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = `${p.color}12`; e.currentTarget.style.borderColor = `${p.color}40`; e.currentTarget.style.transform = "translateY(0)"; }}>
                  {p.label}
                </button>
              ))}
            </div>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "0 0 8px" }}>No signup · No credit card · No cloud access required</p>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>
              Not sure what you&apos;ll get?{" "}
              <button onClick={() => setShowSample(true)} style={{ background: "none", border: "none", color: "var(--green)", fontSize: "13px", cursor: "pointer", textDecoration: "underline", padding: 0, fontFamily: "inherit" }}>
                See a sample report first →
              </button>
            </p>
          </div>

          {/* ── SECONDARY CTA ── */}
          <div id="start-audit" className="fade-up stagger-3" style={{ display: "flex", gap: "14px", justifyContent: "center", flexWrap: "wrap", marginBottom: "40px" }}>
            <button className="glow-btn" onClick={() => goTo("intake")}
              style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "14px 32px", fontSize: "15px", boxShadow: "0 0 24px rgba(0,255,180,0.3)", display: "flex", alignItems: "center", gap: "10px" }}>
              Start Free Audit <span style={{ fontSize: "18px" }}>→</span>
            </button>
            <button className="ghost-btn" onClick={() => setShowSample(true)}
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", color: "var(--text-dim)", borderRadius: "12px", padding: "14px 24px", fontSize: "15px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>📄</span> See a Real Report First
            </button>
          </div>

          <p style={{ textAlign: "center", fontSize: "12px", color: "var(--text-muted)", marginTop: "-28px", marginBottom: "32px" }}>⚡ Free · No signup · Results in 15 minutes</p>

          {/* ── SOCIAL PROOF ── */}
          <div className="fade-up stagger-4" style={{ display: "flex", gap: "24px", justifyContent: "center", flexWrap: "wrap", marginBottom: "40px" }}>
            {[
              { icon: "⚡", text: "15 minutes" },
              { icon: "🔒", text: "Zero cloud access" },
              { icon: "💰", text: "20–45% savings found" },
              { icon: "🌍", text: "AWS · GCP · Azure" },
            ].map(item => (
              <div key={item.text} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "14px" }}>{item.icon}</span>
                <span style={{ fontSize: "13px", color: "var(--text-muted)", fontWeight: 500 }}>{item.text}</span>
              </div>
            ))}
          </div>


          {/* ── LEAD MAGNET CTA ── */}
          <div className="fade-up stagger-4" style={{ marginBottom: "16px" }}>
            <button onClick={() => setShowLeadMagnet(true)}
              style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"10px",padding:"10px 20px",color:"var(--text-dim)",fontSize:"13px",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:"8px" }}>
              <span>📥</span> Free PDF: 2026 Cloud Cost Checklist
            </button>
          </div>

          {/* ── COMPETITOR KILL LINE ── */}
          <p className="fade-up stagger-4" style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.6, maxWidth: "440px", margin: "0 auto", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", padding: "10px 16px" }}>
            💡 The average team needs <strong style={{ color: "#fff" }}>4 months of procurement</strong> to connect a cloud cost tool. KloudAudit takes 15 minutes — no IT ticket, no security review, no approval needed.
          </p>
          <div className="fade-up stagger-4" style={{ marginTop: "22px", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", flexWrap: "wrap" }}>
            {[
              { text: "🔒 Zero cloud access — ever", highlight: true },
              { text: "✓ No signup · No card", highlight: false },
              { text: "⚡ Cost + Security audits", highlight: false },
              { text: "🛡 AWS · GCP · Azure", highlight: false },
              { text: auditStats ? `👥 ${auditStats.totalAudits.toLocaleString()} audits completed` : "👥 Teams audited globally", highlight: false },
            ].map((item, i) => (
              <span key={i} style={{ fontSize: "12px", color: item.highlight ? "var(--green)" : "var(--text-muted)", background: item.highlight ? "rgba(0,255,180,0.06)" : "rgba(255,255,255,0.04)", border: `1px solid ${item.highlight ? "rgba(0,255,180,0.2)" : "rgba(255,255,255,0.08)"}`, borderRadius: "20px", padding: "4px 12px", whiteSpace: "nowrap", fontWeight: item.highlight ? 700 : 400 }}>
                {item.text}
              </span>
            ))}
          </div>

        </div>

        {/* ── HOW IT WORKS ── */}
        {/* ── ZERO CREDENTIALS TRUST CALLOUT ── */}
        <div style={{ marginBottom: "48px", background: "var(--bg2)", border: "1px solid var(--border)", borderLeft: "4px solid var(--green)", borderRadius: "14px", padding: "28px 32px" }}>
          <p style={{ fontSize: "13px", fontWeight: 800, color: "var(--green)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "10px" }}>🔒 Zero cloud credentials — here&apos;s why this works</p>
          <p style={{ fontSize: "15px", color: "var(--text-dim)", lineHeight: 1.75, maxWidth: "760px", margin: 0 }}>
            Most cloud cost tools require IAM roles, OAuth connections, or agent installation. KloudAudit uses a structured self-assessment instead — you answer 18 questions based on your own knowledge of your infrastructure. <strong style={{ color: "#fff" }}>No credentials leave your browser. No AWS account connection. No security review required.</strong> This means you can complete the audit in 15 minutes without an IT ticket, a procurement process, or a security approval.
          </p>
        </div>

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
                  role="button" tabIndex={0} aria-expanded={isActive} onKeyDown={e => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setActiveHowStep(isActive ? null : i))}
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
                    background: isActive ? `${step.color}22` : `${step.color}10`,
                    border: `1px solid ${isActive ? step.color + "55" : step.color + "20"}`,
                    marginBottom: "16px",
                    transition: "all 0.3s",
                    boxShadow: isActive ? `0 0 14px ${step.color}40` : "none",
                  }}>
                    <span className="display" style={{ fontSize: "13px", fontWeight: 800, color: step.color }}>{step.n}</span>
                  </div>

                  <h3 className="display" style={{ fontSize: "16px", fontWeight: 700, color: isActive ? "#fff" : "var(--text-dim)", marginBottom: "8px", letterSpacing: "-0.3px", transition: "color 0.3s" }}>{step.title}</h3>

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
                  {!isActive && (
                    <p style={{ fontSize: "11px", color: `${step.color}70`, fontWeight: 600, letterSpacing: "0.5px", marginTop: "4px" }}>
                      Tap to expand
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── COMPARISON TABLE ── */}
        <div style={{ marginBottom: "90px" }}>
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <p style={{ fontSize: "11px", letterSpacing: "3px", color: "var(--green)", fontWeight: 700, textTransform: "uppercase", marginBottom: "12px" }}>No sales calls required</p>
            <h2 className="display" style={{ fontSize: "clamp(28px,3.5vw,44px)", fontWeight: 800, letterSpacing: "-1.5px", color: "#fff" }}>Why engineers choose KloudAudit</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "16px", marginTop: "12px" }}>vs. traditional cloud cost tools</p>
          </div>
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <div style={{ minWidth: "640px", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "16px", overflow: "hidden" }}>
              {/* Header row */}
              <div style={{ display: "grid", gridTemplateColumns: "1.8fr 1fr 1fr 1.1fr 1.1fr", borderBottom: "1px solid var(--border)" }}>
                <div style={{ padding: "18px 20px" }} />
                {[
                  { label: "KloudAudit",         kloud: true  },
                  { label: "CloudHealth",         kloud: false },
                  { label: "AWS Cost Explorer",   kloud: false },
                  { label: "Consultant",          kloud: false },
                ].map(({ label, kloud }) => (
                  <div key={label} style={{ padding: "16px 12px", textAlign: "center", background: kloud ? "rgba(0,255,180,0.08)" : "transparent", borderLeft: `1px solid ${kloud ? "rgba(0,255,180,0.3)" : "rgba(255,255,255,0.06)"}` }}>
                    <p style={{ fontSize: "13px", fontWeight: 800, color: kloud ? "var(--green)" : "var(--text-dim)", marginBottom: kloud ? "5px" : "0" }}>{label}</p>
                    {kloud && <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--green)", background: "rgba(0,255,180,0.12)", border: "1px solid rgba(0,255,180,0.3)", borderRadius: "10px", padding: "1px 7px" }}>← this</span>}
                  </div>
                ))}
              </div>
              {/* Data rows */}
              {[
                { label: "Setup time",           vals: ["15 minutes",  "4–6 months",        "Immediate",             "2–4 weeks"] },
                { label: "Credentials required", vals: ["None",        "Full IAM access",   "AWS login",             "Full access"] },
                { label: "First finding",        vals: ["Immediate",   "30+ days",          "Hours of exploration",  "1–2 weeks"] },
                { label: "Cost",                 vals: ["Free / $79",  "$$$$ enterprise",   "Free",                  "$$$"] },
                { label: "Prioritised fix list",  vals: ["✓",           "Partial",           "✗",                     "✓"] },
                { label: "AI fix commands",       vals: ["✓",           "✗",                 "✗",                     "✗"] },
              ].map((row, ri, arr) => (
                <div key={row.label} style={{ display: "grid", gridTemplateColumns: "1.8fr 1fr 1fr 1.1fr 1.1fr", borderBottom: ri < arr.length - 1 ? "1px solid var(--border)" : "none", background: ri % 2 === 1 ? "rgba(255,255,255,0.015)" : "transparent" }}>
                  <div style={{ padding: "14px 20px", display: "flex", alignItems: "center" }}>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-muted)" }}>{row.label}</span>
                  </div>
                  {row.vals.map((val, ci) => {
                    const isKloud = ci === 0;
                    const color = val === "✓" ? "#4ade80" : val === "✗" ? "#f87171" : val === "Partial" ? "#fbbf24" : isKloud ? "#fff" : "var(--text-muted)";
                    return (
                      <div key={ci} style={{ padding: "14px 10px", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", background: isKloud ? "rgba(0,255,180,0.05)" : "transparent", borderLeft: `1px solid ${isKloud ? "rgba(0,255,180,0.3)" : "rgba(255,255,255,0.06)"}` }}>
                        <span style={{ fontSize: val === "✓" || val === "✗" ? "16px" : "12px", fontWeight: isKloud ? 700 : 400, color }}>{val}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── REPORT PREVIEW ── */}
          <div className="fade-up" style={{ marginBottom: "80px" }}>
            <div style={{ textAlign: "center", marginBottom: "40px" }}>
              <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "12px" }}>What you get</p>
              <h2 className="display" style={{ fontSize: "clamp(24px,3vw,36px)", fontWeight: 800, letterSpacing: "-1px", color: "#fff", marginBottom: "12px" }}>Your report looks like this</h2>
              <p style={{ fontSize: "15px", color: "var(--text-muted)", maxWidth: "480px", margin: "0 auto" }}>Free, instant, no credentials. Sorted by ease of implementation — quick wins first.</p>
            </div>

            {/* Browser frame */}
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "16px", overflow: "hidden", maxWidth: "780px", margin: "0 auto" }}>
              {/* Browser chrome */}
              <div style={{ background: "rgba(255,255,255,0.05)", padding: "10px 16px", display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ display: "flex", gap: "5px" }}>
                  {["#f87171","#fbbf24","#4ade80"].map(c => <div key={c} style={{ width: "10px", height: "10px", borderRadius: "50%", background: c, opacity: 0.6 }} />)}
                </div>
                <div style={{ flex: 1, background: "rgba(255,255,255,0.06)", borderRadius: "6px", padding: "4px 12px", fontSize: "11px", color: "#475569", textAlign: "center" }}>
                  www.kloudaudit.eu
                </div>
              </div>

              {/* Report content */}
              <div style={{ padding: "24px", background: "#080810" }}>
                {/* Score + summary */}
                <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: "20px", alignItems: "center", marginBottom: "20px" }}>
                  <div style={{ position: "relative", width: "110px", height: "110px" }}>
                    <svg width="110" height="110" viewBox="0 0 110 110" style={{ transform: "rotate(-90deg)" }}>
                      <circle cx="55" cy="55" r="44" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="9"/>
                      <circle cx="55" cy="55" r="44" fill="none" stroke="#f87171" strokeWidth="9"
                        strokeDasharray="69 276" strokeLinecap="round"/>
                    </svg>
                    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontSize: "26px", fontWeight: 800, color: "#f87171", lineHeight: 1 }}>34</span>
                      <span style={{ fontSize: "9px", color: "#64748b", letterSpacing: "1px" }}>WASTE</span>
                    </div>
                  </div>
                  <div>
                    <p style={{ fontSize: "11px", color: "#475569", margin: "0 0 6px", letterSpacing: "1px", textTransform: "uppercase" }}>AWS · $8,000/month</p>
                    <p style={{ fontSize: "18px", fontWeight: 800, color: "#fff", margin: "0 0 8px", lineHeight: 1.2 }}>13 issues · <span style={{ color: "#00ffb4" }}>$794–$2,003/mo</span> to recover</p>
                    <div style={{ display: "flex", gap: "8px" }}>
                      {[["8", "Quick wins", "#22c55e"], ["$794+", "Monthly saving", "#00ffb4"], ["$9,528", "Annual", "#818cf8"]].map(([v, l, c]) => (
                        <div key={l} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "8px", padding: "8px 12px", flex: 1 }}>
                          <p style={{ fontSize: "16px", fontWeight: 800, color: c, margin: 0 }}>{v}</p>
                          <p style={{ fontSize: "10px", color: "#475569", margin: 0 }}>{l}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Sort pills */}
                <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
                  {["Quick wins first", "Highest impact", "Largest savings"].map((label, i) => (
                    <span key={label} style={{ fontSize: "11px", padding: "4px 12px", borderRadius: "20px", border: `1px solid ${i === 0 ? "rgba(0,255,180,0.3)" : "rgba(255,255,255,0.1)"}`, background: i === 0 ? "rgba(0,255,180,0.08)" : "rgba(255,255,255,0.03)", color: i === 0 ? "#00ffb4" : "#64748b" }}>
                      {label}
                    </span>
                  ))}
                </div>

                {/* Findings */}
                {[
                  { n: "01", effort: "Quick win", ec: "#22c55e", label: "Dev/staging RDS running 24/7", sub: "Database · 20 min to fix", sav: "$320–$640/mo" },
                  { n: "02", effort: "Quick win", ec: "#22c55e", label: "Unattached EBS volumes", sub: "Storage · 10 min to fix", sav: "$80–$200/mo" },
                  { n: "03", effort: "Quick win", ec: "#22c55e", label: "No Reserved Instances", sub: "Compute · 30 min to fix", sav: "$200–$450/mo" },
                  { n: "04", effort: "Some effort", ec: "#f59e0b", label: "Idle or oversized instances", sub: "Compute · 2–4 hrs to fix", sav: "$150–$400/mo", dim: true },
                ].map(f => (
                  <div key={f.n} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", background: "rgba(255,255,255,0.02)", marginBottom: "5px", opacity: f.dim ? 0.45 : 1 }}>
                    <span style={{ fontSize: "10px", color: "#334155", fontWeight: 600, minWidth: "16px" }}>{f.n}</span>
                    <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "12px", fontWeight: 600, background: `${f.ec}18`, border: `1px solid ${f.ec}40`, color: f.ec, whiteSpace: "nowrap" }}>{f.effort}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: "12px", color: "#e2e8f0", margin: 0, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.label}</p>
                      <p style={{ fontSize: "10px", color: "#475569", margin: 0 }}>{f.sub}</p>
                    </div>
                    <span style={{ fontSize: "11px", color: "#00ffb4", fontWeight: 700, whiteSpace: "nowrap" }}>{f.sav}</span>
                  </div>
                ))}

                <p style={{ textAlign: "center", fontSize: "11px", color: "#334155", padding: "8px", marginBottom: "12px" }}>+ 9 more findings unlocked in the Blueprint</p>

                {/* CTA */}
                <div style={{ background: "rgba(0,255,180,0.05)", border: "1px solid rgba(0,255,180,0.18)", borderRadius: "12px", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                  <div>
                    <p style={{ fontSize: "14px", fontWeight: 700, color: "#fff", margin: "0 0 2px" }}>Get the full fix guide</p>
                    <p style={{ fontSize: "11px", color: "#64748b", margin: 0 }}>CLI commands · Terraform · 30-day roadmap</p>
                  </div>
                  <div style={{ background: "#00ffb4", color: "#000", borderRadius: "8px", padding: "8px 18px", fontSize: "13px", fontWeight: 800 }}>Get Blueprint → $79</div>
                </div>
              </div>
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
            <label htmlFor="calc-range" style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--green)", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "1px" }}>
              Your monthly cloud bill: <span style={{ color: "#fff", fontFamily: "var(--display)", fontSize: "18px" }}>${calcBill.toLocaleString()}</span>
            </label>
            <input id="calc-range" type="range" aria-label="Monthly cloud bill amount" min="500" max="50000" step="500" value={calcBill} onChange={e => setCalcBill(Number(e.target.value))}
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

        {/* ── DIY WITH CLAUDE OBJECTION ── */}
        <div style={{ marginBottom: "90px" }}>
          <div style={{ textAlign: "center", marginBottom: "36px" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "20px", padding: "6px 16px", marginBottom: "20px" }}>
              <span style={{ fontSize: "13px" }}>🤔</span>
              <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 600 }}>"Can't I just ask Claude to do this?"</span>
            </div>
            <h2 className="display" style={{ fontSize: "clamp(24px,3vw,38px)", fontWeight: 800, letterSpacing: "-1px", color: "#fff", marginBottom: "12px" }}>
              You can. Here's what happens.
            </h2>
            <p style={{ fontSize: "15px", color: "var(--text-muted)", maxWidth: "520px", margin: "0 auto" }}>
              Claude is a general-purpose AI. KloudAudit is a structured audit framework trained on one problem — finding cloud waste and security gaps. The difference shows immediately.
            </p>
          </div>
          <div className="compare-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px", background: "var(--border)", borderRadius: "20px", overflow: "hidden", border: "1px solid var(--border)", marginBottom: "24px" }}>
            {/* DIY column */}
            <div style={{ background: "rgba(248,113,113,0.04)", padding: "32px 28px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "24px" }}>
                <span style={{ fontSize: "20px" }}>🤖</span>
                <div>
                  <p style={{ fontSize: "14px", fontWeight: 800, color: "#f87171", margin: 0 }}>DIY with Claude</p>
                  <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0 }}>free · general purpose</p>
                </div>
              </div>
              {[
                "Write 18+ prompts to cover all cost areas",
                "Need to know the right questions to ask",
                "No savings estimate — just generic advice",
                "No bill context — numbers are hypothetical",
                "2+ hours of back-and-forth iteration",
                "Stateless — no history between sessions",
                "No shareable output or branded report",
                "Won't flag issues you forgot to ask about",
              ].map(item => (
                <div key={item} style={{ display: "flex", gap: "10px", alignItems: "flex-start", marginBottom: "12px" }}>
                  <span style={{ color: "#f87171", fontSize: "13px", marginTop: "1px", flexShrink: 0 }}>✗</span>
                  <span style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.5 }}>{item}</span>
                </div>
              ))}
            </div>
            {/* KloudAudit column */}
            <div style={{ background: "rgba(0,255,180,0.04)", padding: "32px 28px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "24px" }}>
                <div style={{ width: "28px", height: "28px", background: "var(--green)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px" }}>⚡</div>
                <div>
                  <p style={{ fontSize: "14px", fontWeight: 800, color: "var(--green)", margin: 0 }}>KloudAudit</p>
                  <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0 }}>free · purpose-built</p>
                </div>
              </div>
              {[
                "34 checks across cost + security — already built",
                "Framework encodes what to ask, automatically",
                "Dollar savings tied to your actual monthly bill",
                "Every estimate calculated against your spend",
                "15 minutes, structured, guided",
                "Score history tracked — re-audit in 30 days",
                "PDF report, share card, public link",
                "Catches what you didn't know to look for",
              ].map(item => (
                <div key={item} style={{ display: "flex", gap: "10px", alignItems: "flex-start", marginBottom: "12px" }}>
                  <span style={{ color: "var(--green)", fontSize: "13px", marginTop: "1px", flexShrink: 0 }}>✓</span>
                  <span style={{ fontSize: "13px", color: "var(--text-dim)", lineHeight: 1.5 }}>{item}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "16px" }}>
              The audit framework is the product. The AI is just how we deliver the fix guide.
            </p>
            <button className="glow-btn" onClick={() => goTo("intake")} style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "13px 32px", fontSize: "15px", boxShadow: "0 0 24px rgba(0,255,180,0.25)" }}>
              Try the 15-minute version →
            </button>
          </div>
        </div>

        {/* ── WHAT WE AUDIT ── */}
        <div style={{ marginBottom: "90px" }}>
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <p style={{ fontSize: "11px", letterSpacing: "3px", color: "var(--green)", fontWeight: 700, textTransform: "uppercase", marginBottom: "12px" }}>Comprehensive coverage</p>
            <h2 className="display" style={{ fontSize: "clamp(28px,3.5vw,44px)", fontWeight: 800, letterSpacing: "-1.5px", color: "#fff" }}>What we audit</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "16px", marginTop: "12px", maxWidth: "560px", margin: "12px auto 0" }}>Five areas where cloud spend leaks — plus two where security gaps hide. Cost and security, one platform, zero access required.</p>
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

            {/* ── SECURITY CARD — Identity, Access, Exposure & Data ── */}
            <div className="audit-cat-card fade-up" role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && goTo("security_intro")} onClick={() => goTo("security_intro")}
              style={{ animationDelay: "0.25s", background: "linear-gradient(135deg, rgba(248,113,113,0.07), rgba(251,146,60,0.04))", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "16px", padding: "28px", boxShadow: "0 4px 20px rgba(0,0,0,0.3)", position: "relative", overflow: "hidden", cursor: "pointer", transition: "all 0.25s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(248,113,113,0.45)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(248,113,113,0.2)"; e.currentTarget.style.transform = "translateY(0)"; }}>
              <div style={{ position: "absolute", top: "-30px", right: "-30px", width: "100px", height: "100px", background: "radial-gradient(circle, rgba(248,113,113,0.08) 0%, transparent 70%)", borderRadius: "50%" }} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                <div style={{ display: "flex", gap: "8px" }}>
                  <span style={{ fontSize: "28px" }}>🔐</span>
                  <span style={{ fontSize: "28px" }}>🛡</span>
                </div>
                <span style={{ fontSize: "10px", fontWeight: 700, color: "#f87171", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: "20px", padding: "2px 10px", letterSpacing: "0.8px" }}>SECURITY</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                <h3 className="display" style={{ fontSize: "18px", fontWeight: 700, color: "#fff", letterSpacing: "-0.3px" }}>Security Audit</h3>
                <span style={{ background: "rgba(248,113,113,0.1)", color: "#f87171", fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "10px", border: "1px solid rgba(248,113,113,0.2)" }}>16 checks</span>
              </div>
              <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.65, marginBottom: "16px" }}>IAM wildcards, MFA gaps, root account usage, public S3 buckets, open security groups, hardcoded secrets — 16 checks across identity, access, exposure and data.</p>
              <div style={{ borderTop: "1px solid rgba(248,113,113,0.12)", paddingTop: "14px" }}>
                <p style={{ fontSize: "11px", color: "rgba(148,163,184,0.5)", fontWeight: 600, marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.8px" }}>Covers</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {["MFA enforcement", "IAM wildcards", "Public S3 buckets", "Open security groups", "Hardcoded secrets"].map(label => (
                    <span key={label} style={{ fontSize: "11px", color: "rgba(248,113,113,0.7)", background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.15)", borderRadius: "6px", padding: "3px 8px" }}>{label}</span>
                  ))}
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", padding: "3px 6px" }}>+11 more</span>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* ── REAL USER PROOF ── */}
        <div style={{ marginBottom: "48px", background: "rgba(0,255,180,0.03)", border: "1px solid rgba(0,255,180,0.1)", borderRadius: "16px", padding: "24px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "24px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", align: "center", gap: "16px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)", letterSpacing: "2px", textTransform: "uppercase" }}>Real user · KUBRA</p>
              <p style={{ fontSize: "15px", fontWeight: 700, color: "#fff" }}>13 issues · $794–$2,003/mo savings found</p>
              <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>Multi-cloud · $640/mo bill · Completed May 2026</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
            {[["$372M", "Company value"], ["13", "Issues found"], ["$2,003", "Max monthly saving"]].map(([v, l]) => (
              <div key={l} style={{ textAlign: "center" }}>
                <p style={{ fontSize: "20px", fontWeight: 800, color: "var(--green)", fontFamily: "var(--display)" }}>{v}</p>
                <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>{l}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── USED BY BADGES ── */}
        <div style={{ marginBottom: "64px", textAlign: "center" }}>
          <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "14px" }}>Used by engineering teams at</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", justifyContent: "center" }}>
            {["Fintech · London", "SaaS · Berlin", "E-commerce · New York", "DevOps team · Singapore", "Startup · Warsaw"].map(badge => (
              <span key={badge} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "20px", padding: "4px 14px", fontSize: "12px", color: "var(--text-dim)" }}>{badge}</span>
            ))}
          </div>
        </div>

        {/* ── TESTIMONIALS ── */}
        <div style={{ marginBottom: "90px" }}>
          <div style={{ textAlign: "center", marginBottom: "40px" }}>
            <p style={{ fontSize: "11px", letterSpacing: "3px", color: "var(--green)", fontWeight: 700, textTransform: "uppercase", marginBottom: "12px" }}>Typical results</p>
            <h2 className="display" style={{ fontSize: "clamp(24px,3vw,38px)", fontWeight: 800, letterSpacing: "-1px", color: "#fff" }}>What engineers find</h2>
            <p style={{ fontSize: "12px", color: "rgba(148,163,184,0.45)", marginTop: "8px" }}>Based on real audit patterns across 500+ cloud environments</p>
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

        {/* ── WALL OF SAVINGS ── */}
        <div style={{ marginBottom: "90px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "28px" }}>
            <span style={{ width: "8px", height: "8px", background: "var(--green)", borderRadius: "50%", display: "inline-block", boxShadow: "0 0 8px var(--green)", animation: "pulse-dot 2s infinite", flexShrink: 0 }} />
            <h2 className="display" style={{ fontSize: "20px", fontWeight: 700, color: "#fff", letterSpacing: "-0.3px", margin: 0 }}>Recent audits</h2>
            <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 500 }}>· results updated in real time</span>
          </div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "16px" }}>
            {["All", "AWS", "GCP", "Azure", "Multi-Cloud"].map(f => {
              const active = savingsFilter === f;
              return (
                <button key={f} onClick={() => setSavingsFilter(f)} style={{ fontSize: "11px", padding: "4px 12px", borderRadius: "20px", border: `1px solid ${active ? "rgba(0,255,180,0.3)" : "rgba(255,255,255,0.1)"}`, background: active ? "rgba(0,255,180,0.08)" : "rgba(255,255,255,0.03)", color: active ? "#00ffb4" : "#64748b", cursor: "pointer", fontFamily: "inherit", fontWeight: active ? 600 : 400, transition: "all 0.15s" }}>
                  {f}
                </button>
              );
            })}
          </div>
          <div className="wall-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px" }}>
            {WALL_SAVINGS.filter(a => savingsFilter === "All" || a.provider === savingsFilter).map((a, i) => {
              const providerColor = PROVIDER_BADGE_COLOR[a.provider] || "#00ffb4";

              /* ── BEFORE/AFTER variant (card 3) ── */
              if (a.variant === "before_after") return (
                <div key={i} style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "14px", padding: "20px 22px", display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                    <div>
                      <p style={{ fontSize: "13px", fontWeight: 700, color: "#fff", marginBottom: "6px" }}>{a.company}</p>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: providerColor, background: `${providerColor}15`, border: `1px solid ${providerColor}35`, borderRadius: "6px", padding: "2px 8px" }}>{a.provider}</span>
                    </div>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: "6px", padding: "3px 8px", flexShrink: 0, whiteSpace: "nowrap" }}>⏱ {a.time}</span>
                  </div>
                  <div>
                    <p style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>Before / After</p>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "16px", fontWeight: 800, color: "#f87171", fontFamily: "var(--display)" }}>{a.billBefore}</span>
                      <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>→</span>
                      <span style={{ fontSize: "16px", fontWeight: 800, color: "var(--green)", fontFamily: "var(--display)" }}>{a.billAfter}</span>
                    </div>
                    <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>monthly bill potential</p>
                  </div>
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "15px", fontWeight: 800, color: "#f87171", fontFamily: "var(--display)" }}>{a.issues}</span>
                    <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>issues flagged</span>
                  </div>
                </div>
              );

              /* ── WASTE SCORE variant (card 6) ── */
              if (a.variant === "waste_score") {
                const circ = 2 * Math.PI * 22;
                const offset = circ * (1 - a.score / 100);
                return (
                  <div key={i} style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "14px", padding: "20px 22px", display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                      <div>
                        <p style={{ fontSize: "13px", fontWeight: 700, color: "#fff", marginBottom: "6px" }}>{a.company}</p>
                        <span style={{ fontSize: "11px", fontWeight: 700, color: providerColor, background: `${providerColor}15`, border: `1px solid ${providerColor}35`, borderRadius: "6px", padding: "2px 8px" }}>{a.provider}</span>
                      </div>
                      <span style={{ fontSize: "11px", color: "var(--text-muted)", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: "6px", padding: "3px 8px", flexShrink: 0, whiteSpace: "nowrap" }}>⏱ {a.time}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                      <div style={{ position: "relative", flexShrink: 0 }}>
                        <svg width="52" height="52" style={{ transform: "rotate(-90deg)" }}>
                          <circle cx="26" cy="26" r="22" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
                          <circle cx="26" cy="26" r="22" fill="none" stroke="#f87171" strokeWidth="4"
                            strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
                        </svg>
                        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <span style={{ fontSize: "11px", fontWeight: 800, color: "#f87171" }}>{a.score}</span>
                        </div>
                      </div>
                      <div>
                        <p className="display" style={{ fontSize: "20px", fontWeight: 800, color: "#f87171", letterSpacing: "-0.5px", lineHeight: 1, marginBottom: "2px" }}>Score: {a.score}/100</p>
                        <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>critical waste level</p>
                      </div>
                    </div>
                    <div style={{ borderTop: "1px solid var(--border)", paddingTop: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "15px", fontWeight: 800, color: "#f87171", fontFamily: "var(--display)" }}>{a.issues}</span>
                      <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>issues flagged</span>
                    </div>
                  </div>
                );
              }

              /* ── TIME SAVED variant (card 9) ── */
              if (a.variant === "time_saved") return (
                <div key={i} style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "14px", padding: "20px 22px", display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                    <div>
                      <p style={{ fontSize: "13px", fontWeight: 700, color: "#fff", marginBottom: "6px" }}>{a.company}</p>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: providerColor, background: `${providerColor}15`, border: `1px solid ${providerColor}35`, borderRadius: "6px", padding: "2px 8px" }}>{a.provider}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: "4px", padding: "8px 0" }}>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "1px" }}>Found in</span>
                    <p className="display" style={{ fontSize: "36px", fontWeight: 800, color: "var(--green)", letterSpacing: "-1.5px", lineHeight: 1 }}>{a.time}</p>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>start to full savings report</span>
                  </div>
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "15px", fontWeight: 800, color: "#f87171", fontFamily: "var(--display)" }}>{a.issues}</span>
                    <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>issues flagged · {a.savings}</span>
                  </div>
                </div>
              );

              /* ── DEFAULT card ── */
              return (
                <div key={i} style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "14px", padding: "20px 22px", display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                    <div>
                      <p style={{ fontSize: "13px", fontWeight: 700, color: "#fff", marginBottom: "6px" }}>{a.company}</p>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: providerColor, background: `${providerColor}15`, border: `1px solid ${providerColor}35`, borderRadius: "6px", padding: "2px 8px" }}>{a.provider}</span>
                    </div>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: "6px", padding: "3px 8px", flexShrink: 0, whiteSpace: "nowrap" }}>⏱ {a.time}</span>
                  </div>
                  <div>
                    <p className="display" style={{ fontSize: "22px", fontWeight: 800, color: "var(--green)", letterSpacing: "-0.8px", lineHeight: 1, marginBottom: "4px" }}>{a.savings}</p>
                    <p style={{ fontSize: "11px", color: "var(--text-muted)" }}>estimated monthly savings</p>
                  </div>
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "15px", fontWeight: 800, color: "#f87171", fontFamily: "var(--display)" }}>{a.issues}</span>
                    <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>issues flagged</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── SECURITY AUDIT PRODUCT CARD ── */}
        <div id="security-audit" style={{ marginBottom: "48px" }}>
          <div role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && goTo("security_intro")} onClick={() => goTo("security_intro")}
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
                <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.5 }}>Find the gaps attackers scan for first — before your next pentest, compliance audit, or investor review. 16 checks. Free. Zero access required.</p>
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

        {/* ── FAQ ── */}
        <div style={{ marginBottom: "90px", maxWidth: "760px", margin: "0 auto 90px" }}>
          <div style={{ textAlign: "center", marginBottom: "40px" }}>
            <p style={{ fontSize: "11px", letterSpacing: "3px", color: "var(--green)", fontWeight: 700, textTransform: "uppercase", marginBottom: "12px" }}>Got questions?</p>
            <h2 className="display" style={{ fontSize: "clamp(24px,3vw,38px)", fontWeight: 800, letterSpacing: "-1px", color: "#fff" }}>Frequently asked</h2>
            <p style={{ fontSize: "14px", color: "var(--text-muted)", marginTop: "10px" }}>Cost audits · Security audits · Pricing · Privacy</p>
          </div>
          {FAQS.map((faq, i) => (
            <div key={i} style={{ background: "var(--bg2)", border: `1px solid ${openFaq === i ? (faq.tag === "security" ? "rgba(248,113,113,0.25)" : "rgba(0,255,180,0.2)") : "var(--border)"}`, borderRadius: "14px", marginBottom: "10px", overflow: "hidden", transition: "border-color 0.2s" }}>
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                style={{ width: "100%", padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1 }}>
                  {faq.tag === "security" && <span style={{ fontSize: "10px", fontWeight: 700, color: "#f87171", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: "4px", padding: "2px 7px", whiteSpace: "nowrap", flexShrink: 0 }}>Security</span>}
                  {faq.tag === "cost" && <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--green)", background: "rgba(0,255,180,0.08)", border: "1px solid rgba(0,255,180,0.2)", borderRadius: "4px", padding: "2px 7px", whiteSpace: "nowrap", flexShrink: 0 }}>Cost</span>}
                  <span style={{ fontSize: "15px", fontWeight: 600, color: openFaq === i ? (faq.tag === "security" ? "#f87171" : "var(--green)") : "#fff", transition: "color 0.2s" }}>{faq.q}</span>
                </div>
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

        {/* ── PRICING — Two buying journeys ── */}
        <div id="pricing-section" style={{ marginBottom: "90px" }}>
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <p style={{ fontSize: "11px", letterSpacing: "3px", color: "var(--green)", fontWeight: 700, textTransform: "uppercase", marginBottom: "12px" }}>Pricing</p>
            <h2 className="display" style={{ fontSize: "clamp(26px,3vw,40px)", fontWeight: 800, letterSpacing: "-1px", color: "#fff", marginBottom: "12px" }}>
              Two different problems. Two different solutions.
            </h2>
            <p style={{ fontSize: "15px", color: "var(--text-muted)", maxWidth: "520px", margin: "0 auto" }}>
              Engineers buy the Blueprint to fix what's broken. CTOs buy the Monitor to make sure it stays fixed — and prove it to the board.
            </p>
          </div>

          {/* ── JOURNEY 1: ENGINEER ── */}
          <div style={{ marginBottom: "16px", display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "rgba(0,255,180,0.08)", border: "1px solid rgba(0,255,180,0.2)", borderRadius: "20px", padding: "5px 14px" }}>
              <span style={{ fontSize: "13px" }}>⚙️</span>
              <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--green)" }}>For DevOps Engineers</span>
            </div>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Find the issue. Get the fix guide. Implement same day.</span>
          </div>
          <div className="bento-grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "32px" }}>
            {/* Free */}
            <div style={{ background: "rgba(74,222,128,0.05)", border: "1px solid rgba(74,222,128,0.18)", borderRadius: "18px", padding: "28px 24px" }}>
              <p style={{ fontSize: "12px", fontWeight: 700, color: "#4ade80", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "6px" }}>Free Audit</p>
              <div style={{ marginBottom: "6px" }}>
                <span className="display" style={{ fontSize: "28px", fontWeight: 800, color: "#fff", letterSpacing: "-1px" }}>$0</span>
                <span style={{ fontSize: "12px", color: "var(--text-muted)", marginLeft: "6px" }}>forever</span>
              </div>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "20px", lineHeight: 1.5 }}>Run the audit. See every issue. Know exactly what it's costing you.</p>
              {["18 cost + 16 security checks", "Dollar savings per issue", "Waste score 0–100", "Shareable report link"].map(f => (
                <div key={f} style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                  <span style={{ color: "#4ade80", fontSize: "12px", flexShrink: 0 }}>✓</span>
                  <span style={{ fontSize: "12px", color: "var(--text-dim)", lineHeight: 1.5 }}>{f}</span>
                </div>
              ))}
              <button onClick={() => goTo("intake")} style={{ width: "100%", marginTop: "20px", padding: "11px", borderRadius: "10px", border: "1px solid rgba(74,222,128,0.3)", background: "transparent", color: "#4ade80", fontWeight: 800, fontSize: "13px", cursor: "pointer" }}>
                Start Free →
              </button>
            </div>
            {/* Cost Blueprint */}
            <div style={{ background: "rgba(0,255,180,0.06)", border: "1.5px solid rgba(0,255,180,0.3)", borderRadius: "18px", padding: "28px 24px", position: "relative" }}>
              <div style={{ position: "absolute", top: "-12px", left: "50%", transform: "translateX(-50%)", background: "var(--green)", color: "#000", fontSize: "11px", fontWeight: 800, padding: "3px 14px", borderRadius: "20px", whiteSpace: "nowrap" }}>Most popular</div>
              <p style={{ fontSize: "12px", fontWeight: 700, color: "var(--green)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "6px" }}>Cost Blueprint</p>
              <div style={{ marginBottom: "6px" }}>
                <span className="display" style={{ fontSize: "28px", fontWeight: 800, color: "#fff", letterSpacing: "-1px" }}>{currency.blueprintPrice}</span>
                <span style={{ fontSize: "12px", color: "var(--text-muted)", marginLeft: "6px" }}>one-time</span>
              </div>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "20px", lineHeight: 1.5 }}>Forward to your DevOps team. They can implement every fix the same afternoon.</p>
              {[
                "Exact CLI commands for every issue",
                "Terraform/IaC snippets included",
                "Step-by-step — no Googling required",
                "Delivered to inbox in 2 minutes",
                "Pays for itself in day 1 of savings",
                "Full refund if nothing is actionable",
              ].map(f => (
                <div key={f} style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                  <span style={{ color: "var(--green)", fontSize: "12px", flexShrink: 0 }}>✓</span>
                  <span style={{ fontSize: "12px", color: "var(--text-dim)", lineHeight: 1.5 }}>{f}</span>
                </div>
              ))}
              <button onClick={() => setShowBlueprint(true)} className="glow-btn" style={{ width: "100%", marginTop: "20px", padding: "12px", borderRadius: "10px", border: "none", background: "var(--green)", color: "#000", fontWeight: 800, fontSize: "13px", cursor: "pointer", boxShadow: "0 4px 20px rgba(0,255,180,0.3)" }}>
                Get Cost Blueprint →
              </button>
            </div>
            {/* Security Blueprint */}
            <div style={{ background: "rgba(248,113,113,0.05)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "18px", padding: "28px 24px" }}>
              <p style={{ fontSize: "12px", fontWeight: 700, color: "#f87171", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "6px" }}>Security Blueprint</p>
              <div style={{ marginBottom: "6px" }}>
                <span className="display" style={{ fontSize: "28px", fontWeight: 800, color: "#fff", letterSpacing: "-1px" }}>{currency.securityPrice || "$29"}</span>
                <span style={{ fontSize: "12px", color: "var(--text-muted)", marginLeft: "6px" }}>one-time</span>
              </div>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "20px", lineHeight: 1.5 }}>A security consultant charges $2,000+ for this. Same output, 10 minutes, no credentials shared.</p>
              {[
                "IAM policy templates, ready to deploy",
                "Compliance gap mapping (SOC 2, GDPR, ISO 27001)",
                "30-day prioritised remediation roadmap",
                "Share with your legal or compliance team",
                "Delivered to inbox in 2 minutes",
              ].map(f => (
                <div key={f} style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                  <span style={{ color: "#f87171", fontSize: "12px", flexShrink: 0 }}>✓</span>
                  <span style={{ fontSize: "12px", color: "var(--text-dim)", lineHeight: 1.5 }}>{f}</span>
                </div>
              ))}
              <button onClick={() => setShowSecBlueprint(true)} style={{ width: "100%", marginTop: "20px", padding: "11px", borderRadius: "10px", border: "1px solid rgba(248,113,113,0.3)", background: "transparent", color: "#f87171", fontWeight: 800, fontSize: "13px", cursor: "pointer" }}>
                Get Security Blueprint →
              </button>
            </div>
          </div>

          {/* ── JOURNEY 2: CTO / MANAGER ── */}
          <div style={{ marginBottom: "16px", display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: "20px", padding: "5px 14px" }}>
              <span style={{ fontSize: "13px" }}>👔</span>
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#818cf8" }}>For CTOs & Engineering Managers</span>
            </div>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Track improvement. Prevent surprises. Show the board.</span>
          </div>

          {/* CFO Report — one-time executive summary */}
          <div style={{ background: "rgba(99,102,241,0.06)", border: "1.5px solid rgba(99,102,241,0.3)", borderRadius: "18px", padding: "28px 32px", marginBottom: "12px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "32px", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "280px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                <span style={{ fontSize: "20px" }}>📊</span>
                <p style={{ fontSize: "12px", fontWeight: 700, color: "#818cf8", letterSpacing: "1px", textTransform: "uppercase", margin: 0 }}>CFO & Board Report</p>
                <span style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: "20px", fontSize: "11px", color: "#818cf8", fontWeight: 700, padding: "2px 10px" }}>One-time</span>
              </div>
              <div style={{ marginBottom: "10px" }}>
                <span className="display" style={{ fontSize: "28px", fontWeight: 800, color: "#fff", letterSpacing: "-1px" }}>{currency.cfoReportPrice || "$199"}</span>
                <span style={{ fontSize: "12px", color: "var(--text-muted)", marginLeft: "6px" }}>one-time · no subscription</span>
              </div>
              <p style={{ fontSize: "14px", color: "var(--text-muted)", lineHeight: 1.65, margin: 0, maxWidth: "500px" }}>
                The same audit findings, rewritten for your board. Executive summary, annual ROI table, 3-phase action plan — no CLI commands, no Terraform. Share it with your CFO or investors this afternoon.
              </p>
            </div>
            <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: "8px", minWidth: "220px" }}>
              {[
                "Annual savings projection in dollars",
                "Board-ready executive summary",
                "3-phase action plan for leadership sign-off",
                "Compliance framing (SOC 2, GDPR, ISO 27001)",
                "In your inbox in ~2 minutes",
              ].map(f => (
                <div key={f} style={{ display: "flex", gap: "7px", alignItems: "flex-start" }}>
                  <span style={{ color: "#818cf8", fontSize: "12px", flexShrink: 0, marginTop: "2px" }}>✓</span>
                  <span style={{ fontSize: "12px", color: "var(--text-dim)", lineHeight: 1.5 }}>{f}</span>
                </div>
              ))}
              <button onClick={() => setShowCfoReport(true)} style={{ marginTop: "8px", width: "100%", padding: "12px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg,#818cf8,#6366f1)", color: "#fff", fontWeight: 800, fontSize: "13px", cursor: "pointer", boxShadow: "0 4px 20px rgba(99,102,241,0.3)" }}>
                Get Board Report — {currency.cfoReportPrice || "$199"} →
              </button>
            </div>
          </div>

          <div style={{ background: "rgba(99,102,241,0.06)", border: "1.5px solid rgba(99,102,241,0.25)", borderRadius: "18px", padding: "32px", display: "flex", alignItems: "flex-start", gap: "32px", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "260px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                <p style={{ fontSize: "12px", fontWeight: 700, color: "#818cf8", letterSpacing: "1px", textTransform: "uppercase", margin: 0 }}>Cloud Health Monitor</p>
                <span style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: "20px", fontSize: "11px", color: "#818cf8", fontWeight: 700, padding: "2px 10px" }}>New</span>
              </div>
              <div style={{ marginBottom: "8px" }}>
                <span className="display" style={{ fontSize: "28px", fontWeight: 800, color: "#fff", letterSpacing: "-1px" }}>{currency.subscriptionPrice || "$19/mo"}</span>
                <span style={{ fontSize: "12px", color: "var(--text-muted)", marginLeft: "6px" }}>cancel anytime</span>
              </div>
              <p style={{ fontSize: "14px", color: "var(--text-muted)", lineHeight: 1.65, marginBottom: "0", maxWidth: "480px" }}>
                Your engineers fix issues once. New ones appear every month — new services, new deployments, new waste. The Monitor catches them before the next board meeting, not after.
              </p>
            </div>
            <div style={{ flex: 1, minWidth: "260px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "20px" }}>
                {[
                  { icon: "📊", text: "Monthly waste score — track your team's improvement" },
                  { icon: "🚨", text: "New issues flagged the moment they appear" },
                  { icon: "📄", text: "Board-ready infrastructure health report each month" },
                  { icon: "💡", text: "One discounted Blueprint per month included" },
                  { icon: "🔒", text: "Zero cloud access — nothing to approve with IT" },
                  { icon: "📈", text: "Show investors your infrastructure is improving" },
                ].map(f => (
                  <div key={f.text} style={{ display: "flex", gap: "8px", alignItems: "flex-start", background: "rgba(99,102,241,0.06)", borderRadius: "8px", padding: "10px 12px" }}>
                    <span style={{ fontSize: "14px", flexShrink: 0 }}>{f.icon}</span>
                    <span style={{ fontSize: "11px", color: "var(--text-dim)", lineHeight: 1.5 }}>{f.text}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <input type="email" placeholder="your@company.com" value={subEmail || gateEmail}
                  onChange={e => setSubEmail(e.target.value)}
                  style={{ width: "100%", padding: "11px 14px", background: "rgba(99,102,241,0.08)", border: "1.5px solid rgba(99,102,241,0.3)", borderRadius: "10px", color: "#fff", fontSize: "14px", boxSizing: "border-box" }} />
                <button onClick={() => { const email = subEmail || gateEmail; if (email) handleBuySubscription(email); else goTo("intake"); }}
                  disabled={subStatus === 'loading'}
                  style={{ width: "100%", padding: "12px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg,#818cf8,#6366f1)", color: "#fff", fontWeight: 800, fontSize: "14px", cursor: "pointer", boxShadow: "0 4px 20px rgba(99,102,241,0.3)" }}>
                  {subStatus === 'loading' ? "Redirecting…" : `Start Cloud Health Monitor — ${currency.subscriptionPrice || "$19/mo"} →`}
                </button>
                {subStatus === 'not_configured' && <p style={{ fontSize: "12px", color: "#818cf8", textAlign: "center" }}>Coming soon — <a href="mailto:admin@kloudaudit.eu" style={{ color: "#818cf8" }}>join the waitlist</a></p>}
                <p style={{ fontSize: "11px", color: "var(--text-muted)", textAlign: "center" }}>Cancel anytime · Secure via Stripe · No cloud access required</p>
              </div>
            </div>
          </div>

          <p style={{ textAlign: "center", fontSize: "12px", color: "var(--text-muted)", marginTop: "20px" }}>
            All blueprints include a full refund if no actionable fix is identified. Questions? <a href="mailto:admin@kloudaudit.eu" style={{ color: "var(--green)", textDecoration: "none" }}>admin@kloudaudit.eu</a>
          </p>
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
                  { icon: "✓", label: "Verified Cloud Engineer · $8K+ delivered", href: "https://www.upwork.com/freelancers/~015c346a56b09a2a89", color: "#14a34a" },
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
          {/* ── FOOTER ── */}
          <footer style={{ marginTop: "48px", paddingTop: "48px", borderTop: "1px solid var(--border)" }}>

            {/* Newsletter banner */}
            <NewsletterWidget />

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: "40px", marginBottom: "48px" }} className="footer-grid">

              {/* Brand column */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                  <div style={{ width: "28px", height: "28px", background: "var(--green)", borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 12px rgba(0,255,180,0.3)", fontSize: "14px" }}>⚡</div>
                  <span className="display" style={{ fontWeight: 800, fontSize: "16px", color: "#fff", letterSpacing: "-0.5px" }}>KloudAudit</span>
                </div>
                <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.7, marginBottom: "20px", maxWidth: "240px" }}>
                  Find what your cloud bill is hiding. Free audit in 15 minutes — no credentials, no signup, no agent.
                </p>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {[
                    { label: "LinkedIn", href: "https://www.linkedin.com/in/samuel-ayodele-adomeh", color: "#0077b5" },
                    { label: "𝕏", href: "https://twitter.com/kloudaudit", color: "var(--text-dim)" },
                    { label: "GitHub", href: "https://github.com/leumasj", color: "var(--text-dim)" },
                    { label: "Upwork", href: "https://www.upwork.com/freelancers/~015c346a56b09a2a89", color: "#14a34a" },
                  ].map(s => (
                    <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: "12px", fontWeight: 600, color: s.color, textDecoration: "none", padding: "5px 12px", border: `1px solid ${s.color}30`, borderRadius: "7px", background: `${s.color}10`, transition: "all 0.15s" }}>
                      {s.label}
                    </a>
                  ))}
                </div>
              </div>

              {/* Product column */}
              <div>
                <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "16px" }}>Product</p>
                {[
                  { label: "Cost Audit", action: () => goTo("intake") },
                  { label: "Security Audit", action: () => goTo("security_intro") },
                  { label: "Pricing", action: () => setShowPricingModal(true) },
                  { label: "Sample Report", action: () => setShowSample(true) },
                  { label: "Blog", href: "https://dev.to/kloudaudit" },
                ].map(l => (
                  l.href
                    ? <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" style={{ display: "block", fontSize: "13px", color: "var(--text-muted)", textDecoration: "none", marginBottom: "10px", transition: "color 0.15s" }} onMouseEnter={e => e.currentTarget.style.color = "var(--green)"} onMouseLeave={e => e.currentTarget.style.color = "var(--text-muted)"}>{l.label}</a>
                    : <button key={l.label} onClick={l.action} style={{ display: "block", fontSize: "13px", color: "var(--text-muted)", background: "none", border: "none", padding: 0, marginBottom: "10px", cursor: "pointer", fontFamily: "inherit", transition: "color 0.15s", textAlign: "left" }} onMouseEnter={e => e.currentTarget.style.color = "var(--green)"} onMouseLeave={e => e.currentTarget.style.color = "var(--text-muted)"}>{l.label}</button>
                ))}
              </div>

              {/* Company column */}
              <div>
                <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "16px" }}>Company</p>
                {[
                  { label: "About", action: () => setShowAbout(true) },
                  { label: "Contact", action: () => setShowContact(true) },
                  { label: "Book a Session", action: () => setShowBooking(true) },
                  { label: "Hire on Upwork", href: "https://www.upwork.com/freelancers/~015c346a56b09a2a89" },
                ].map(l => (
                  l.href
                    ? <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" style={{ display: "block", fontSize: "13px", color: "var(--text-muted)", textDecoration: "none", marginBottom: "10px", transition: "color 0.15s" }} onMouseEnter={e => e.currentTarget.style.color = "#fff"} onMouseLeave={e => e.currentTarget.style.color = "var(--text-muted)"}>{l.label}</a>
                    : <button key={l.label} onClick={l.action} style={{ display: "block", fontSize: "13px", color: "var(--text-muted)", background: "none", border: "none", padding: 0, marginBottom: "10px", cursor: "pointer", fontFamily: "inherit", transition: "color 0.15s", textAlign: "left" }} onMouseEnter={e => e.currentTarget.style.color = "#fff"} onMouseLeave={e => e.currentTarget.style.color = "var(--text-muted)"}>{l.label}</button>
                ))}
              </div>

              {/* Legal column */}
              <div>
                <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "16px" }}>Legal</p>
                {[
                  { label: "Privacy Policy", href: "https://www.kloudaudit.eu/privacy/" },
                  { label: "Terms of Service", href: "https://www.kloudaudit.eu/terms/" },
                  { label: "Unsubscribe", href: "https://www.kloudaudit.eu/api/unsubscribe" },
                ].map(l => (
                  <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" style={{ display: "block", fontSize: "13px", color: "var(--text-muted)", textDecoration: "none", marginBottom: "10px", transition: "color 0.15s" }} onMouseEnter={e => e.currentTarget.style.color = "#fff"} onMouseLeave={e => e.currentTarget.style.color = "var(--text-muted)"}>{l.label}</a>
                ))}
              </div>
            </div>

            {/* Bottom bar */}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
              <p style={{ fontSize: "12px", color: "rgba(148,163,184,0.45)", margin: 0 }}>
                © {new Date().getFullYear()} KloudAudit · Samuel Ayodele Adomeh · Wrocław, Poland · <a href="mailto:admin@kloudaudit.eu" style={{ color: "rgba(148,163,184,0.45)", textDecoration: "none" }}>admin@kloudaudit.eu</a>
              </p>
              <p style={{ fontSize: "11px", color: "rgba(148,163,184,0.3)", margin: 0, maxWidth: "480px", textAlign: "right" }}>
                Savings estimates are projections based on self-reported data and industry benchmarks. Not financial advice.
              </p>
            </div>
          </footer>
        </div>

      </main>
    </div>
    );
  }


  // ── INTAKE ─────────────────────────────────────────────────────────────────
  if (step === "intake") return (
    <div className="app">
      <style>{globalCss}</style>
      <ParticleBackground />
      {showContact && <ContactModal onClose={() => setShowContact(false)} />}
      {showBooking && <BookingModal onClose={() => setShowBooking(false)} sessionPrice={currency.sessionPrice} />}
      {showBlueprint && <BlueprintModal onClose={() => setShowBlueprint(false)} onBuy={handleBuyBlueprint} currency={currency} provider={provider} flaggedCount={flagged.length} />}
        {showCfoReport && <CfoReportModal onClose={() => setShowCfoReport(false)} onBuy={handleBuyCfoReport} currency={currency} provider={provider} savMin={savMin} savMax={savMax} flaggedCount={flagged.length} />}
        {showPricingModal && <PricingModal onClose={() => setShowPricingModal(false)} currency={currency} onStartAudit={() => goTo("intake")} onStartSecAudit={() => goTo("security_intro")} onBlueprintClick={() => setShowBlueprint(true)} onSecBlueprintClick={() => setShowSecBlueprint(true)} onCfoReportClick={() => setShowCfoReport(true)} onSessionClick={() => setShowBooking(true)} onSubscribe={handleBuySubscription} />}
      <Nav showBack onBack={() => goTo("intro")} />
      <div key={pageKey} style={{ maxWidth: "540px", margin: "0 auto", padding: "60px 24px", position: "relative", zIndex: 1 }}>
        <div className="fade-up">
          <h2 className="display" style={{ fontSize: "36px", fontWeight: 800, letterSpacing: "-1.5px", color: "#fff", marginBottom: "8px" }}>Set up your audit</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "15px", marginBottom: "40px" }}>30 seconds. We'll tailor savings estimates to your actual spend.</p>
        </div>
        <div className="fade-up stagger-1" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <p style={{ fontSize: "12px", color: "var(--text-muted)", background: "rgba(0,255,180,0.04)", border: "1px solid rgba(0,255,180,0.1)", borderRadius: "8px", padding: "10px 14px", marginBottom: "0" }}>
            🔒 This stays in your browser. We use it to calculate your savings estimate — nothing is sent to our servers until you choose to share it.
          </p>
          <div>
            <label htmlFor="intake-company" style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--green)", marginBottom: "10px", letterSpacing: "1px", textTransform: "uppercase" }}>Company (optional — used for your report header only)</label>
            <input id="intake-company" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. Acme Corp" style={{ width: "100%", padding: "14px 18px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "12px", color: "#fff", fontSize: "15px", transition: "all 0.2s" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--green)", marginBottom: "10px", letterSpacing: "1px", textTransform: "uppercase" }}>Cloud provider</label>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {PROVIDERS.map(p => (
                <button key={p} className="provider-chip"
                  role="radio" aria-checked={provider === p} tabIndex={0}
                  onClick={() => { window.gtag?.('event', 'audit_started', { provider: p }); setProvider(p); }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.gtag?.('event', 'audit_started', { provider: p }); setProvider(p); } }}
                  style={{ padding: "10px 20px", borderRadius: "10px", fontSize: "14px", fontWeight: 600, border: `1.5px solid ${provider === p ? "var(--green)" : "var(--border)"}`, background: provider === p ? "var(--green-dim)" : "rgba(255,255,255,0.03)", color: provider === p ? "var(--green)" : "var(--text-muted)" }}>{p}</button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="intake-monthly-bill" style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--green)", marginBottom: "10px", letterSpacing: "1px", textTransform: "uppercase" }}>Monthly cloud bill (USD)</label>
            <div style={{ position: "relative" }}>
              <span aria-hidden="true" style={{ position: "absolute", left: "18px", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", fontSize: "16px", fontWeight: 700 }}>$</span>
              <input id="intake-monthly-bill" type="number" value={monthlyBill} onChange={e => setMonthlyBill(e.target.value)} placeholder="3,500" style={{ width: "100%", padding: "14px 18px 14px 34px", background: "rgba(255,255,255,0.04)", border: "1.5px solid var(--border)", borderRadius: "12px", color: "#fff", fontSize: "15px", transition: "all 0.2s" }} />
            </div>
            {bill > 0 && (
              <div style={{ marginTop: "10px", padding: "12px 16px", background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "10px", fontSize: "13px", color: "var(--green)", fontWeight: 600 }}>
                💰 Typical savings: <strong>${Math.round(bill * 0.20).toLocaleString()} – ${Math.round(bill * 0.45).toLocaleString()}/mo</strong> based on 18 audit checks
              </div>
            )}
          </div>
          {bill > 0 && bill < 500 && (
            <div style={{ padding: "12px 16px", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: "10px", fontSize: "13px", color: "#fbbf24" }}>
              💡 For bills under $500/month, the free audit checklist gives you the most value. The paid Blueprint ROI is strongest at $1,500+/month.
            </div>
          )}
          <button className="glow-btn" disabled={!provider || !monthlyBill || parseFloat(monthlyBill) <= 0} onClick={() => goTo("audit")}
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
        {showContact && <ContactModal onClose={() => setShowContact(false)} />}
        {showBooking && <BookingModal onClose={() => setShowBooking(false)} sessionPrice={currency.sessionPrice} />}
        {showBlueprint && <BlueprintModal onClose={() => setShowBlueprint(false)} onBuy={handleBuyBlueprint} currency={currency} provider={provider} flaggedCount={flagged.length} />}
        {showCfoReport && <CfoReportModal onClose={() => setShowCfoReport(false)} onBuy={handleBuyCfoReport} currency={currency} provider={provider} savMin={savMin} savMax={savMax} flaggedCount={flagged.length} />}
        {showPricingModal && <PricingModal onClose={() => setShowPricingModal(false)} currency={currency} onStartAudit={() => goTo("intake")} onStartSecAudit={() => goTo("security_intro")} onBlueprintClick={() => setShowBlueprint(true)} onSecBlueprintClick={() => setShowSecBlueprint(true)} onCfoReportClick={() => setShowCfoReport(true)} onSessionClick={() => setShowBooking(true)} onSubscribe={handleBuySubscription} />}
        <Nav showBack onBack={() => goTo("intake")} />
        {/* ── SECTION COMPLETE TOAST ── */}
        {sectionToast && (
          <div style={{ position: "fixed", top: "80px", right: "24px", zIndex: 999, background: "rgba(0,255,180,0.1)", border: "1px solid rgba(0,255,180,0.3)", borderRadius: "10px", padding: "10px 16px", fontSize: "13px", color: "#00ffb4", animation: "fadeIn 0.2s ease", pointerEvents: "none", maxWidth: "320px", boxShadow: "0 4px 20px rgba(0,255,180,0.15)" }}>
            {sectionToast}
          </div>
        )}
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
              {activeSection === AUDIT_SECTIONS.length - 1 && (
                <div className="pulse-green-ring" style={{ background: "rgba(0,255,180,0.08)", border: "1.5px solid rgba(0,255,180,0.35)", borderRadius: "12px", padding: "13px 20px", marginBottom: "20px", textAlign: "center" }}>
                  <span style={{ color: "var(--green)", fontWeight: 700, fontSize: "14px" }}>✅ Almost done — see your full report →</span>
                </div>
              )}
              <div style={{ marginBottom: "24px" }}>
                <h2 className="display" style={{ fontSize: "26px", fontWeight: 800, letterSpacing: "-0.5px", color: "#fff" }}>{section.icon} {section.label}</h2>
                <p style={{ fontSize: "14px", color: "var(--text-muted)", marginTop: "4px" }}>{section.description}</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {section.checks.map((check, i) => {
                  const on = !!checked[check.id];
                  const sMin = bill > 0 ? Math.round(bill * check.savingsRange[0] / 100) : null;
                  const sMax = bill > 0 ? Math.round(bill * check.savingsRange[1] / 100) : null;
                  return (
                    <div key={check.id} className="check-card" role="checkbox" aria-checked={on} tabIndex={0} onKeyDown={e => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle(check.id))} onClick={() => toggle(check.id)}
                      style={{ background: on ? "rgba(0,255,180,0.05)" : "rgba(255,255,255,0.02)", border: `1.5px solid ${on ? "rgba(0,255,180,0.25)" : "var(--border)"}`, borderRadius: "14px", padding: "18px 20px", display: "flex", gap: "14px", alignItems: "flex-start", boxShadow: on ? "0 4px 20px rgba(0,255,180,0.08)" : "0 1px 4px rgba(0,0,0,0.2)", animation: "card-in 0.35s ease both", animationDelay: `${i * 55}ms` }}>
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
                        {on && check.tooltip && (
                          <div style={{ marginTop: "8px", padding: "10px 14px", background: "rgba(99,102,241,0.07)", border: "1px solid rgba(99,102,241,0.18)", borderRadius: "8px", borderLeft: "3px solid #818cf8" }}>
                            <p style={{ fontSize: "12px", color: "#a5b4fc", lineHeight: 1.65, margin: 0 }}>💡 {check.tooltip}</p>
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
                  <button className="glow-btn" onClick={() => {
                    const prevSec = AUDIT_SECTIONS[activeSection];
                    const flaggedInSec = prevSec.checks.filter(c => checked[c.id]).length;
                    const msg = `✓ ${prevSec.label} complete — ${flaggedInSec} issue${flaggedInSec !== 1 ? 's' : ''} found`;
                    clearTimeout(sectionToastTimerRef.current);
                    setSectionToast(msg);
                    sectionToastTimerRef.current = setTimeout(() => setSectionToast(null), 1500);
                    setActiveSection(a => a + 1);
                  }} style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "10px", padding: "12px 28px", fontSize: "14px", boxShadow: "0 0 20px rgba(0,255,180,0.25)" }}>Next: {AUDIT_SECTIONS[activeSection + 1].label} →</button>
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
                {flagged.length > 0 && bill > 0 && (
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
                )}
                {(() => {
                  const n = flagged.length;
                  const [text, color, pulse] = n === 0
                    ? ["Start flagging issues to see your estimate", "var(--text-muted)", false]
                    : n <= 3
                    ? ["⚠ Waste detected — keep going", "#fbbf24", false]
                    : n <= 7
                    ? ["🔴 Significant waste found", "#f97316", false]
                    : ["🚨 Critical — this bill has major leaks", "#f87171", true];
                  return (
                    <p style={{ fontSize: "12px", color, marginTop: n > 0 && bill > 0 ? "12px" : "16px", textAlign: n === 0 ? "center" : "left", animation: pulse ? "pulse-dot 1.5s ease-in-out infinite" : "none" }}>{text}</p>
                  );
                })()}
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
                    <div key={s.id} role="button" tabIndex={0} onKeyDown={e => e.key === "Enter" && setActiveSection(i)} onClick={() => setActiveSection(i)} style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", cursor: "pointer", opacity: i === activeSection ? 1 : 0.6, transition: "opacity 0.15s" }}>
                      <span style={{ fontSize: "14px", width: "18px" }}>{s.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                            <span style={{ fontSize: "11px", fontWeight: 600, color: i === activeSection ? "var(--green)" : "var(--text-dim)" }}>{s.label}</span>
                            {(s.id === "compute" || s.id === "database") && (
                              <span style={{ fontSize: "9px", fontWeight: 700, color: "#00ffb4", background: "rgba(0,255,180,0.12)", border: "1px solid rgba(0,255,180,0.25)", borderRadius: "8px", padding: "1px 6px", width: "fit-content" }}>Most teams find issues here</span>
                            )}
                          </div>
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
        {showToast && (
          <div style={{ position: "fixed", bottom: "90px", right: "24px", zIndex: 1000, background: "rgba(0,255,180,0.12)", border: "1.5px solid rgba(0,255,180,0.4)", borderRadius: "12px", padding: "12px 18px", display: "flex", alignItems: "center", gap: "8px", animation: "toastIn 0.3s cubic-bezier(0.34,1.56,0.64,1) both", boxShadow: "0 8px 30px rgba(0,255,180,0.2)" }}>
            <span style={{ fontSize: "16px" }}>💰</span>
            <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--green)" }}>
              {showToast.bill > 0
                ? `+$${Math.round(showToast.bill * showToast.check.savingsRange[0] / 100).toLocaleString()}–$${Math.round(showToast.bill * showToast.check.savingsRange[1] / 100).toLocaleString()}/mo`
                : `+${showToast.check.savingsRange[0]}–${showToast.check.savingsRange[1]}%`
              }
            </span>
          </div>
        )}
      </div>
    );
  }

  // ── REPORT ─────────────────────────────────────────────────────────────────

  // ── EMAIL GATE STEP ──────────────────────────────────────────────────────────
  if (step === "email_gate") {
    // ── severity helper (mirrors report step) ─────────────────────────────
    const getSev = c => { const p = (c.savingsRange[0] + c.savingsRange[1]) / 2; return p >= 30 ? "high" : p >= 15 ? "med" : "low"; };
    const SEV_COLOR = { high: "#f87171", med: "#fbbf24", low: "#4ade80" };

    const handleGateSubmit = async (e) => {
      e.preventDefault();
      if (!gateEmail) { goTo("report"); return; }
      setGateSending(true);
      try {
        await fetch("/api/send-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: gateEmail,
            provider: provider || "AWS",
            monthlyBill: bill,
            savingsMin: savMin,
            savingsMax: savMax,
            savPct,
            flaggedCount: flagged.length,
            flaggedIssues: flagged.map(c => c.label),
            companyName: companyName || "",
          }),
        });
      } catch (_) {}
      saveAudit(gateEmail);
      window.gtag?.('event', 'email_submitted', { provider: provider });
      setGateSubmitted(true);
      setGateSending(false);
      setTimeout(() => goTo("report"), 800);
    };

    const previewFindings = flagged.slice(0, 3);
    const lockedFindings  = flagged.slice(3);

    // ── inline email form (reused in two places below) ────────────────────
    const EmailForm = () => gateSubmitted ? (
      <div style={{ textAlign: "center", padding: "24px 0" }}>
        <div style={{ fontSize: "40px", marginBottom: "10px" }}>✅</div>
        <p style={{ color: "#00ffb4", fontWeight: 800, fontSize: "18px", marginBottom: "4px" }}>Report sent — loading now…</p>
        <p style={{ color: "#94a3b8", fontSize: "13px" }}>Check your inbox in ~30 seconds.</p>
      </div>
    ) : (
      <form onSubmit={handleGateSubmit} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <input
          type="email" aria-label="Your work email address"
          value={gateEmail} onChange={e => setGateEmail(e.target.value)}
          placeholder="you@company.com" autoFocus
          style={{ width: "100%", padding: "13px 15px", background: "rgba(255,255,255,0.06)", border: "1.5px solid rgba(255,255,255,0.2)", borderRadius: "10px", color: "#f8fafc", fontSize: "15px", outline: "none", boxSizing: "border-box", caretColor: "#00ffb4", fontFamily: "inherit" }}
          onFocus={e => e.target.style.borderColor = "#00ffb4"}
          onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.2)"}
        />
        <button type="submit" disabled={gateSending} style={{ width: "100%", padding: "14px", borderRadius: "10px", border: "none", background: "#00ffb4", color: "#000", fontWeight: 800, fontSize: "15px", cursor: gateSending ? "not-allowed" : "pointer", boxShadow: "0 4px 24px rgba(0,255,180,0.35)", fontFamily: "inherit", opacity: gateSending ? 0.7 : 1 }}>
          {gateSending ? "Sending…" : `Unlock all ${flagged.length} findings →`}
        </button>
        <button type="button" onClick={() => { window.gtag?.('event', 'email_gate_skipped', {}); try { saveAudit(null); } catch(_) {} goTo("report"); }}
          style={{ width: "100%", padding: "11px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#64748b", fontSize: "13px", cursor: "pointer", fontFamily: "inherit" }}
          onMouseEnter={e => { e.target.style.color = "#f8fafc"; e.target.style.borderColor = "rgba(255,255,255,0.22)"; }}
          onMouseLeave={e => { e.target.style.color = "#64748b"; e.target.style.borderColor = "rgba(255,255,255,0.1)"; }}>
          Skip — just show me the full report
        </button>
        <p style={{ fontSize: "11px", color: "#475569", textAlign: "center", margin: 0 }}>🔒 One email — your report only. No marketing, no spam.</p>
      </form>
    );

    return (
      <div className="app">
        <style>{globalCss}</style>
        <ParticleBackground />
        {showContact && <ContactModal onClose={() => setShowContact(false)} />}
        <Nav showBack onBack={() => goTo("audit")} />

        <div key={pageKey} style={{ maxWidth: "900px", margin: "0 auto", padding: "48px 24px 120px", position: "relative", zIndex: 1 }}>

          {/* ── REPORT HEADER ── */}
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
            {/* Export/re-run locked in preview */}
            <div style={{ display: "flex", gap: "10px", opacity: 0.35, pointerEvents: "none" }}>
              <button style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: "10px", padding: "10px 18px", fontSize: "13px", fontWeight: 600, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "6px" }}>🖨 Export</button>
              <button style={{ background: "rgba(0,255,180,0.08)", color: "var(--green)", border: "none", borderRadius: "10px", padding: "10px 20px", fontSize: "13px" }}>Re-run</button>
            </div>
          </div>

          {/* ── KPI CARDS ── */}
          {bill > 0 && (
            <div className="fade-up stagger-1 kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "14px", marginBottom: "32px" }}>
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

          {/* ── WASTE SCORE RING ── */}
          {bill > 0 && flagged.length > 0 && (
            <WasteScoreCard
              flagged={flagged}
              allChecks={allChecks}
              savPct={savPct}
              savMin={savMin}
              savMax={savMax}
              onShare={() => {}}
            />
          )}

          {/* ── FINDINGS ── */}
          <div className="fade-up stagger-2" style={{ marginTop: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "18px" }}>
              <h2 className="display" style={{ fontSize: "20px", fontWeight: 700, color: "#fff", letterSpacing: "-0.3px" }}>Your findings</h2>
              <span style={{ fontSize: "12px", color: "var(--text-muted)", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", borderRadius: "20px", padding: "3px 10px" }}>{flagged.length} total</span>
              {lockedFindings.length > 0 && (
                <span style={{ fontSize: "11px", color: "#f87171", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "20px", padding: "3px 10px" }}>
                  🔒 {lockedFindings.length} locked
                </span>
              )}
            </div>

            {/* First 3 findings — fully visible */}
            {previewFindings.map(check => {
              const sMin2 = bill > 0 ? Math.round(bill * check.savingsRange[0] / 100) : null;
              const sMax2 = bill > 0 ? Math.round(bill * check.savingsRange[1] / 100) : null;
              const sev = getSev(check);
              return (
                <div key={check.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", borderLeft: `3px solid ${SEV_COLOR[sev]}`, borderRadius: "0 12px 12px 0", padding: "16px 20px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                  <div>
                    <p style={{ fontWeight: 600, fontSize: "15px", color: "#fff", marginBottom: "4px" }}>{check.label}</p>
                    <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>{check.detail}</p>
                  </div>
                  {bill > 0 && (
                    <div style={{ background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "8px", padding: "8px 14px", textAlign: "right", flexShrink: 0 }}>
                      <p style={{ fontSize: "14px", fontWeight: 700, color: "var(--green)" }}>${sMin2?.toLocaleString()} – ${sMax2?.toLocaleString()}</p>
                      <p style={{ fontSize: "10px", color: "var(--text-muted)" }}>/ month</p>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Findings 4+ — blurred + email gate overlay */}
            {lockedFindings.length > 0 && (
              <div style={{ position: "relative", borderRadius: "12px", overflow: "hidden" }}>
                {/* Blurred rows */}
                <div style={{ filter: "blur(5px)", pointerEvents: "none", userSelect: "none" }}>
                  {lockedFindings.map(check => (
                    <div key={check.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", borderLeft: `3px solid ${SEV_COLOR[getSev(check)]}`, borderRadius: "0 12px 12px 0", padding: "16px 20px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                      <div>
                        <p style={{ fontWeight: 600, fontSize: "15px", color: "#fff", marginBottom: "4px" }}>{check.label}</p>
                        <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>{check.detail}</p>
                      </div>
                      {bill > 0 && (
                        <div style={{ background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: "8px", padding: "8px 14px", textAlign: "right", flexShrink: 0 }}>
                          <p style={{ fontSize: "14px", fontWeight: 700, color: "var(--green)" }}>$•••• – $••••</p>
                          <p style={{ fontSize: "10px", color: "var(--text-muted)" }}>/ month</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Gate overlay */}
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(to bottom, transparent 0%, rgba(7,7,15,0.82) 28%, rgba(7,7,15,0.97) 56%)" }}>
                  <div style={{ background: "var(--bg2)", border: "1.5px solid rgba(0,255,180,0.25)", borderRadius: "20px", padding: "32px", maxWidth: "440px", width: "100%", boxShadow: "0 24px 64px rgba(0,0,0,0.7)", margin: "0 16px" }}>
                    <div style={{ textAlign: "center", marginBottom: "20px" }}>
                      <span style={{ fontSize: "28px" }}>🔒</span>
                      <h3 className="display" style={{ fontSize: "20px", fontWeight: 800, color: "#fff", letterSpacing: "-0.5px", margin: "10px 0 6px" }}>
                        {lockedFindings.length} more {lockedFindings.length === 1 ? "finding" : "findings"} hidden
                      </h3>
                      <p style={{ fontSize: "14px", color: "var(--text-muted)", lineHeight: 1.65 }}>
                        Enter your email to unlock all <strong style={{ color: "#fff" }}>{flagged.length} findings</strong> — we'll send a copy to your inbox too, useful for your team or CFO.
                      </p>
                    </div>
                    <EmailForm />
                  </div>
                </div>
              </div>
            )}

            {/* Edge case: ≤3 findings — show email gate below instead of overlay */}
            {lockedFindings.length === 0 && flagged.length > 0 && (
              <div style={{ background: "var(--bg2)", border: "1px solid rgba(0,255,180,0.2)", borderRadius: "16px", padding: "28px", marginTop: "24px" }}>
                <div style={{ marginBottom: "18px" }}>
                  <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "8px" }}>✅ Your audit is complete</p>
                  <h3 className="display" style={{ fontSize: "18px", fontWeight: 800, color: "#fff", letterSpacing: "-0.3px", marginBottom: "6px" }}>Get a copy in your inbox</h3>
                  <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.65 }}>We'll email your full report — handy for sharing with your team or revisiting later.</p>
                </div>
                <EmailForm />
              </div>
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
        {showContact && <ContactModal onClose={() => setShowContact(false)} />}
        {showBooking && <BookingModal onClose={() => setShowBooking(false)} sessionPrice={currency.sessionPrice} />}
        {showBlueprint && <BlueprintModal onClose={() => setShowBlueprint(false)} onBuy={handleBuyBlueprint} currency={currency} provider={provider} flaggedCount={flagged.length} />}
        {showCfoReport && <CfoReportModal onClose={() => setShowCfoReport(false)} onBuy={handleBuyCfoReport} currency={currency} provider={provider} savMin={savMin} savMax={savMax} flaggedCount={flagged.length} />}
        {showPricingModal && <PricingModal onClose={() => setShowPricingModal(false)} currency={currency} onStartAudit={() => goTo("intake")} onStartSecAudit={() => goTo("security_intro")} onBlueprintClick={() => setShowBlueprint(true)} onSecBlueprintClick={() => setShowSecBlueprint(true)} onCfoReportClick={() => setShowCfoReport(true)} onSessionClick={() => setShowBooking(true)} onSubscribe={handleBuySubscription} />}
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
              <button className="ghost-btn" onClick={handleExportPDF} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: "10px", padding: "10px 18px", fontSize: "13px", fontWeight: 600, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "6px" }}>📄 Export PDF</button>
              <button className="glow-btn" onClick={() => { setChecked({}); setActiveSection(0); goTo("audit"); }} style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "10px", padding: "10px 20px", fontSize: "13px", boxShadow: "0 0 16px rgba(0,255,180,0.25)" }}>Re-run</button>
            </div>
          </div>

          {/* KPI cards */}
          {bill > 0 && (
            <div className="fade-up stagger-1 kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "14px", marginBottom: "32px" }}>
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


                        {/* ── SCORE BADGE ── */}
              {scores && scores.letterGrade && (
                <div className="fade-up">
                  <ScoreBadge 
                    letterGrade={scores.letterGrade} 
                    wasteScore={scores.wasteScore} 
                  />
                </div>
              )}

          {/* ── WASTE SCORE ── */}
          {bill > 0 && flagged.length > 0 && <WasteScoreCard
            flagged={flagged}
            allChecks={allChecks}
            savPct={savPct}
            savMin={savMin}
            savMax={savMax}
            onShare={() => setShowShareCard(true)}
          />}

          {/* ── SHARE & LEADERBOARD ── */}
          {scores && scores.letterGrade && (
            <div className="fade-up stagger-1" style={{ marginTop: '32px' }}>
              <ShareButton 
                sessionId={sessionId}
                companyName={companyName}
                onShareUrl={setShareUrl}
              />
              
              <LeaderboardOptIn 
                sessionId={sessionId}
                companyName={companyName}
                onRank={setLeaderboardRank}
              />
              
              <ShareUrlDisplay url={shareUrl} rank={leaderboardRank} />
            </div>
          )}

          {/* ── FINDINGS — Sorted by implementation ease ── */}
                    {/* ── FINDINGS ── */}
          <div className="fade-up stagger-2">
            {[
              { label: "🔴 Critical & High Impact", items: high, color: "#f87171" },
              { label: "🟡 Medium Impact",          items: med,  color: "#fbbf24" },
              { label: "🟢 Quick Wins",             items: low,  color: "#4ade80" },
            ].filter(g => g.items.length > 0).map(group => (
              <div key={group.label} style={{ marginBottom: "28px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                  <h3 className="display" style={{ fontSize: "15px", fontWeight: 700, color: group.color }}>{group.label}</h3>
                  <span style={{ background: group.color + "15", color: group.color, fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "10px" }}>{group.items.length}</span>
                </div>
                {group.items.map(check => {
                  const sMin2 = bill > 0 ? Math.round(bill * check.savingsRange[0] / 100) : null;
                  const sMax2 = bill > 0 ? Math.round(bill * check.savingsRange[1] / 100) : null;
                  return (
                    <div key={check.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", borderLeft: "3px solid " + group.color, borderRadius: "0 12px 12px 0", padding: "16px 20px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
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


          {/* ── TEAMS LIKE YOURS ───────────────────────────────────────────────── */}
          {reportBenchmarks && reportBenchmarks.hasData && (
            <div className="fade-up" style={{ background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.15)", borderRadius: "16px", padding: "20px 24px", marginBottom: "24px" }}>
              <p style={{ fontSize: "11px", fontWeight: 700, color: "#818cf8", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "12px" }}>
                📊 Teams like yours on {provider}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px", marginBottom: "12px" }}>
                {reportBenchmarks.issueFrequency !== null && (
                  <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: "10px", padding: "12px 14px", textAlign: "center" }}>
                    <p style={{ fontSize: "26px", fontWeight: 800, color: "#a5b4fc", letterSpacing: "-1px", lineHeight: 1, marginBottom: "4px" }}>{reportBenchmarks.issueFrequency}%</p>
                    <p style={{ fontSize: "11px", color: "#475569", lineHeight: 1.4 }}>of {provider} teams audited found the same issues</p>
                  </div>
                )}
                {reportBenchmarks.avgSavingsMin > 0 && (
                  <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: "10px", padding: "12px 14px", textAlign: "center" }}>
                    <p style={{ fontSize: "26px", fontWeight: 800, color: "#00ffb4", letterSpacing: "-1px", lineHeight: 1, marginBottom: "4px" }}>${reportBenchmarks.avgSavingsMin.toLocaleString()}+</p>
                    <p style={{ fontSize: "11px", color: "#475569", lineHeight: 1.4 }}>average monthly savings found per {provider} audit</p>
                  </div>
                )}
                <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: "10px", padding: "12px 14px", textAlign: "center" }}>
                  <p style={{ fontSize: "26px", fontWeight: 800, color: "#94a3b8", letterSpacing: "-1px", lineHeight: 1, marginBottom: "4px" }}>{reportBenchmarks.total}</p>
                  <p style={{ fontSize: "11px", color: "#475569", lineHeight: 1.4 }}>total assessments in benchmark dataset</p>
                </div>
              </div>
              {reportBenchmarks.topIssues && reportBenchmarks.topIssues.length > 0 && (
                <div>
                  <p style={{ fontSize: "11px", color: "#334155", fontWeight: 600, marginBottom: "6px" }}>Most common {provider} issues across all audits:</p>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {reportBenchmarks.topIssues.map(issue => (
                      <span key={issue.id} style={{ fontSize: "11px", color: "#64748b", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "6px", padding: "3px 9px" }}>
                        {issue.id.replace(/_/g, " ")} · {issue.pct}%
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

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
                  <div key={f.id} style={{ padding: "16px 28px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", borderRadius: "6px", padding: "3px 10px", fontSize: "11px", fontWeight: 700, color: "var(--text-muted)" }}>Fix {i + 2} of {flagged.length}</span>
                    <span style={{ fontSize: "13px", color: "var(--text-muted)", filter: "blur(3px)", userSelect: "none" }}>{f.label}</span>
                  </div>
                ))}
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

          {/* ── ACTION PLAN CTA ── */}
          <div className="fade-up stagger-4" style={{ background: "linear-gradient(135deg, rgba(0,255,180,0.05) 0%, rgba(99,102,241,0.05) 100%)", border: "1px solid rgba(0,255,180,0.15)", borderRadius: "20px", padding: "40px" }}>
            {/* ── ROI ANCHOR BLOCK ── */}
            {savMin > 0 ? (() => {
              const bpCost = currency.blueprintAmount / 100;
              const daysToROI = Math.ceil(bpCost / (savMin / 30));
              const roiPct = Math.round(((savMin * 12 - bpCost) / bpCost) * 100);
              return (
                <div style={{ background: "linear-gradient(135deg, rgba(0,255,180,0.1) 0%, rgba(0,255,180,0.04) 100%)", border: "1.5px solid rgba(0,255,180,0.3)", borderRadius: "16px", padding: "28px 32px", marginBottom: "28px", position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", top: "-40px", right: "-40px", width: "160px", height: "160px", background: "radial-gradient(circle, rgba(0,255,180,0.08) 0%, transparent 70%)", borderRadius: "50%", pointerEvents: "none" }} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "24px", alignItems: "center", flexWrap: "wrap" }}>
                    <div>
                      <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "8px" }}>The math is simple</p>
                      <p style={{ fontSize: "clamp(18px,2.5vw,26px)", fontWeight: 800, color: "#fff", letterSpacing: "-0.8px", lineHeight: 1.2, marginBottom: "6px" }}>
                        Spend <span style={{ color: "var(--green)" }}>{currency.blueprintPrice}</span> once.
                        Recover <span style={{ color: "var(--green)" }}>${savMin.toLocaleString()}/mo</span> after.
                      </p>
                      <p style={{ fontSize: "15px", color: "var(--text-dim)", marginBottom: "12px" }}>
                        That's <strong style={{ color: "#fff" }}>${(savMin * 12).toLocaleString()}+ per year</strong> — the Blueprint pays for itself in <strong style={{ color: "var(--green)" }}>{daysToROI <= 1 ? "day one" : daysToROI <= 7 ? `${daysToROI} days` : "the first week"}</strong>.
                      </p>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "6px 12px" }}>
                        <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>🛡 If the Blueprint doesn't cover its cost in 30 days — full refund, no questions asked.</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "center", flexShrink: 0 }}>
                      <p style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>Annual ROI</p>
                      <p className="display" style={{ fontSize: "clamp(32px,4vw,48px)", fontWeight: 800, color: "var(--green)", letterSpacing: "-2px", lineHeight: 1 }}>{roiPct.toLocaleString()}%</p>
                    </div>
                  </div>
                </div>
              );
            })() : (
              <div style={{ background: "rgba(0,255,180,0.05)", border: "1px solid rgba(0,255,180,0.15)", borderRadius: "14px", padding: "20px 24px", marginBottom: "24px", textAlign: "center" }}>
                <p style={{ fontSize: "15px", fontWeight: 700, color: "#fff", marginBottom: "4px" }}>Teams typically find $500–$4,000+/month.</p>
                <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>At those numbers, the {currency.blueprintPrice} Blueprint pays for itself in hours — not days.</p>
              </div>
            )}

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

            {/* Two CTAs side by side: Engineer vs CTO */}
            <div className="compare-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
              <div style={{ background: "rgba(0,255,180,0.05)", border: "1px solid rgba(0,255,180,0.2)", borderRadius: "14px", padding: "22px" }}>
                <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "8px" }}>⚙️ You're the engineer</p>
                <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "14px", lineHeight: 1.6 }}>Get the exact CLI commands and Terraform for every issue. Implement this afternoon.</p>
                <button className="glow-btn" onClick={() => { if (flagged.length > 0) { window.gtag?.('event', 'blueprint_clicked', { provider, savings_min: savMin, currency: currency.code }); setShowBlueprint(true); } }}
                  disabled={flagged.length === 0}
                  style={{ width: "100%", background: flagged.length > 0 ? "var(--green)" : "rgba(255,255,255,0.06)", color: flagged.length > 0 ? "#000" : "var(--text-muted)", border: "none", borderRadius: "10px", padding: "13px", fontSize: "14px", cursor: flagged.length > 0 ? "pointer" : "not-allowed", boxShadow: flagged.length > 0 ? "0 0 20px rgba(0,255,180,0.3)" : "none" }}>
                  Get Blueprint — {currency.blueprintPrice} →
                </button>
                <p style={{ fontSize: "11px", color: "var(--text-muted)", textAlign: "center", marginTop: "6px" }}>Inbox in 2 min · Full refund if nothing actionable</p>
              </div>
              <div style={{ background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: "14px", padding: "22px" }}>
                <p style={{ fontSize: "11px", fontWeight: 700, color: "#818cf8", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "8px" }}>👔 You're the CTO / manager</p>
                <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "14px", lineHeight: 1.6 }}>Forward this report to your team. Track improvement monthly. Show the board.</p>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {flagged.length > 0 && bill > 0 && (
                    <button onClick={() => setShowShareCard(true)} style={{ width: "100%", background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.35)", color: "#a5b4fc", borderRadius: "10px", padding: "13px", fontSize: "14px", cursor: "pointer", fontWeight: 700 }}>
                      📤 Share Report With Team →
                    </button>
                  )}
                  <button onClick={() => setShowBooking(true)} style={{ width: "100%", background: "transparent", border: "1px solid rgba(99,102,241,0.25)", color: "#818cf8", borderRadius: "10px", padding: "10px", fontSize: "13px", cursor: "pointer", fontWeight: 600 }}>
                    Book 1:1 with Samuel — {currency.sessionPrice}
                  </button>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <button className="ghost-btn" onClick={() => goTo("intro")} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: "12px", padding: "11px 22px", fontSize: "14px" }}>
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

          {/* ── CROSS-SELL: SECURITY AUDIT ── */}
          <div className="fade-up" style={{ background: "linear-gradient(135deg, rgba(248,113,113,0.06) 0%, rgba(251,146,60,0.04) 100%)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "20px", padding: "32px 36px", marginTop: "20px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "28px", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: "240px" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: "7px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: "20px", padding: "4px 12px", marginBottom: "12px" }}>
                  <span style={{ width: "5px", height: "5px", background: "#f87171", borderRadius: "50%", display: "inline-block" }} />
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "#f87171", letterSpacing: "1px" }}>ALSO FREE · 10 MIN · NO CREDENTIALS</span>
                </div>
                <h3 className="display" style={{ fontSize: "22px", fontWeight: 800, color: "#fff", letterSpacing: "-0.5px", marginBottom: "8px" }}>
                  You've found the waste. Now find the vulnerabilities.
                </h3>
                <p style={{ fontSize: "14px", color: "var(--text-muted)", lineHeight: 1.7, marginBottom: "16px" }}>
                  Cost waste shows up on your bill. A misconfigured IAM role or public S3 bucket shows up in a breach report. 16 security checkpoints — free risk score in 10 minutes.
                </p>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {["🔐 IAM & MFA", "🌐 Public exposure", "🗄 Encryption", "📋 Audit logging"].map(t => (
                    <span key={t} style={{ fontSize: "12px", color: "#f87171", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "20px", padding: "4px 10px", fontWeight: 600 }}>{t}</span>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: "8px", minWidth: "196px" }}>
                <button
                  onClick={() => { window.gtag?.('event', 'security_audit_crosssell_clicked', { source: 'cost_report' }); goTo("security_intro"); }}
                  style={{ background: "#f87171", color: "#000", border: "none", borderRadius: "12px", padding: "14px 24px", fontSize: "15px", fontWeight: 800, cursor: "pointer", boxShadow: "0 4px 20px rgba(248,113,113,0.3)", transition: "all 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 4px 32px rgba(248,113,113,0.5)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 4px 20px rgba(248,113,113,0.3)"; e.currentTarget.style.transform = "translateY(0)"; }}>
                  🛡 Run Security Audit →
                </button>
                <p style={{ fontSize: "11px", color: "var(--text-muted)", textAlign: "center", margin: 0 }}>Free · 16 checks · No account access</p>
              </div>
            </div>
          </div>

        </div>

        {/* ── STICKY BOTTOM BAR — report step ── */}
        {showStickyBar && flagged.length > 0 && (
          <div className="sticky-bottom-cta" style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 90, background: "rgba(8,8,16,0.97)", backdropFilter: "blur(20px)", borderTop: "1px solid rgba(0,255,180,0.2)", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ width: "8px", height: "8px", background: "var(--green)", borderRadius: "50%", boxShadow: "0 0 8px var(--green)", flexShrink: 0, animation: "pulse-dot 2s infinite" }} />
              <span style={{ fontSize: "13px", color: "var(--text-dim)" }}>
                ⚡ {flagged.length} {flagged.length === 1 ? "issue" : "issues"} found — get the exact CLI commands to fix {flagged.length === 1 ? "it" : "all of them"}
              </span>
            </div>
            <button className="glow-btn" onClick={() => { window.gtag?.('event', 'blueprint_clicked', { provider, savings_min: savMin, currency: currency.code, source: 'sticky_bar' }); setShowBlueprint(true); }}
              style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "10px", padding: "11px 28px", fontSize: "14px", fontWeight: 700, boxShadow: "0 0 20px rgba(0,255,180,0.3)", whiteSpace: "nowrap", cursor: "pointer" }}>
              Get Blueprint — {currency.blueprintPrice} →
            </button>
          </div>
        )}
      </div>
    );
  }
}
