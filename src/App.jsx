import { useState, useEffect } from "react";

const AUDIT_SECTIONS = [
  {
    id: "compute",
    label: "Compute & Instances",
    icon: "⚡",
    checks: [
      { id: "rightsizing", label: "Idle or oversized instances (>80% unused capacity)", savingsRange: [15, 40], tip: "Use AWS Compute Optimizer or GCP Recommender to detect waste." },
      { id: "reserved", label: "No Reserved Instances / Savings Plans in use", savingsRange: [20, 45], tip: "Committing 1yr can cut on-demand costs by up to 40%." },
      { id: "spot", label: "Spot/Preemptible instances not used for batch/dev workloads", savingsRange: [60, 80], tip: "Spot is 70–90% cheaper — ideal for CI runners, ML training, ETL." },
      { id: "old_gen", label: "Using previous-generation instance types (m4, c4, r4…)", savingsRange: [5, 15], tip: "New-gen instances (m7, c7) are cheaper and faster." },
      { id: "stopped", label: "Stopped instances still accruing EBS/IP charges", savingsRange: [2, 8], tip: "Stopped EC2 still pays for attached storage and Elastic IPs." },
    ],
  },
  {
    id: "storage",
    label: "Storage & Data",
    icon: "🗄️",
    checks: [
      { id: "s3_tier", label: "S3/GCS data not tiered (all in Standard class)", savingsRange: [30, 60], tip: "Move data not accessed in 30+ days to Infrequent Access or Glacier." },
      { id: "unattached_volumes", label: "Unattached EBS volumes / orphaned disks", savingsRange: [5, 20], tip: "Terminated instances often leave disks behind. Pure waste." },
      { id: "snapshots", label: "Old snapshots / backups never cleaned up", savingsRange: [5, 15], tip: "Automate retention policies. Snapshots compound silently." },
      { id: "data_transfer", label: "High cross-region or internet egress data transfer costs", savingsRange: [10, 35], tip: "Use CloudFront / CDN to reduce egress. Keep data in one region." },
    ],
  },
  {
    id: "network",
    label: "Networking",
    icon: "🌐",
    checks: [
      { id: "nat_gateway", label: "Excessive NAT Gateway usage for internal traffic", savingsRange: [10, 30], tip: "Use VPC endpoints for S3/DynamoDB to bypass NAT charges entirely." },
      { id: "unused_ips", label: "Unused Elastic IPs / reserved static IPs", savingsRange: [1, 5], tip: "AWS charges ~$3.60/month per unattached Elastic IP." },
      { id: "lb_unused", label: "Load balancers with no active targets", savingsRange: [3, 10], tip: "Idle ALBs/NLBs still bill hourly. Audit and delete unused ones." },
    ],
  },
  {
    id: "database",
    label: "Databases",
    icon: "🗃️",
    checks: [
      { id: "rds_idle", label: "RDS instances running 24/7 for dev/staging environments", savingsRange: [40, 70], tip: "Auto-stop dev RDS outside business hours. Save 65% immediately." },
      { id: "rds_size", label: "RDS over-provisioned (high memory, low actual usage)", savingsRange: [20, 40], tip: "Downsize and monitor — most dev DBs run at <10% capacity." },
      { id: "cache_missing", label: "No caching layer (ElastiCache/Memorystore) — DB overloaded", savingsRange: [15, 30], tip: "A small Redis instance reduces DB queries by 60–80% in most apps." },
    ],
  },
  {
    id: "monitoring",
    label: "Monitoring & Misc",
    icon: "📊",
    checks: [
      { id: "no_budgets", label: "No cost budgets or billing alerts configured", savingsRange: [5, 20], tip: "Unmonitored costs drift. Set budget alerts at 80% and 100% of target." },
      { id: "unused_services", label: "Forgotten services / shadow IT (old Lambda, API GWs, queues)", savingsRange: [3, 15], tip: "Run a full resource inventory monthly. Forgotten ≠ free." },
      { id: "dev_prod_parity", label: "Dev/staging environment mirrors production in size", savingsRange: [30, 50], tip: "Dev envs should be 10–20% of prod. Use smaller instances + auto-stop." },
    ],
  },
];

const PROVIDERS = ["AWS", "GCP", "Azure", "Multi-cloud"];

export default function CloudCostAudit() {
  const [step, setStep] = useState("intro"); // intro | audit | report
  const [provider, setProvider] = useState("");
  const [monthlyBill, setMonthlyBill] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [checked, setChecked] = useState({});
  const [activeSection, setActiveSection] = useState(0);
  const [animIn, setAnimIn] = useState(true);

  const toggleCheck = (id) => setChecked((prev) => ({ ...prev, [id]: !prev[id] }));

  const allChecks = AUDIT_SECTIONS.flatMap((s) => s.checks);
  const flaggedChecks = allChecks.filter((c) => checked[c.id]);
  const bill = parseFloat(monthlyBill) || 0;

  const totalSavingsMin = flaggedChecks.reduce((sum, c) => sum + (bill * c.savingsRange[0]) / 100, 0);
  const totalSavingsMax = flaggedChecks.reduce((sum, c) => sum + (bill * c.savingsRange[1]) / 100, 0);
  const savingsPct = bill > 0 ? Math.round(((totalSavingsMin + totalSavingsMax) / 2 / bill) * 100) : 0;

  const sectionProgress = AUDIT_SECTIONS.map((s) => ({
    ...s,
    done: s.checks.filter((c) => checked[c.id] !== undefined).length,
    total: s.checks.length,
  }));

  const totalDone = sectionProgress.reduce((a, s) => a + s.done, 0);
  const totalChecks = allChecks.length;

  function goTo(newStep) {
    setAnimIn(false);
    setTimeout(() => { setStep(newStep); setAnimIn(true); }, 200);
  }

  const styles = {
    root: {
      minHeight: "100vh",
      background: "#0a0a0f",
      color: "#e8e8f0",
      fontFamily: "'DM Mono', 'Fira Code', monospace",
      padding: "0",
      margin: "0",
      overflowX: "hidden",
    },
    grid: {
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 0,
      backgroundImage: `
        linear-gradient(rgba(0,255,180,0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0,255,180,0.03) 1px, transparent 1px)
      `,
      backgroundSize: "40px 40px",
      pointerEvents: "none",
    },
    container: {
      position: "relative", zIndex: 1,
      maxWidth: "860px", margin: "0 auto", padding: "48px 24px",
      opacity: animIn ? 1 : 0,
      transform: animIn ? "translateY(0)" : "translateY(16px)",
      transition: "opacity 0.2s ease, transform 0.2s ease",
    },
    badge: {
      display: "inline-block",
      background: "rgba(0,255,180,0.08)",
      border: "1px solid rgba(0,255,180,0.2)",
      color: "#00ffb4",
      padding: "4px 14px", borderRadius: "2px",
      fontSize: "11px", letterSpacing: "3px", textTransform: "uppercase",
      marginBottom: "24px",
    },
    h1: {
      fontSize: "clamp(28px,5vw,52px)", fontWeight: "700",
      lineHeight: "1.1", margin: "0 0 16px",
      fontFamily: "'Space Grotesk', 'DM Mono', sans-serif",
      letterSpacing: "-1px",
      background: "linear-gradient(135deg, #ffffff 0%, #00ffb4 100%)",
      WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
    },
    sub: { color: "#8888aa", fontSize: "16px", lineHeight: "1.6", marginBottom: "40px", maxWidth: "560px" },
    card: {
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "8px", padding: "28px", marginBottom: "20px",
    },
    label: { display: "block", fontSize: "11px", letterSpacing: "2px", color: "#00ffb4", textTransform: "uppercase", marginBottom: "10px" },
    input: {
      width: "100%", background: "rgba(255,255,255,0.05)",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: "4px", color: "#fff", fontSize: "15px",
      padding: "12px 16px", outline: "none", boxSizing: "border-box",
      fontFamily: "inherit",
      transition: "border-color 0.2s",
    },
    select: {
      width: "100%", background: "#0f0f1a",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: "4px", color: "#fff", fontSize: "15px",
      padding: "12px 16px", outline: "none", boxSizing: "border-box",
      fontFamily: "inherit", cursor: "pointer",
    },
    btnPrimary: {
      background: "#00ffb4", color: "#0a0a0f",
      border: "none", borderRadius: "4px",
      padding: "14px 32px", fontSize: "13px", fontWeight: "700",
      letterSpacing: "1px", textTransform: "uppercase",
      cursor: "pointer", fontFamily: "inherit",
      transition: "transform 0.1s, box-shadow 0.2s",
    },
    btnOutline: {
      background: "transparent", color: "#00ffb4",
      border: "1px solid rgba(0,255,180,0.3)",
      borderRadius: "4px", padding: "12px 28px",
      fontSize: "13px", fontWeight: "600", letterSpacing: "1px",
      textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit",
    },
    pill: (active) => ({
      padding: "6px 14px", borderRadius: "2px", fontSize: "12px",
      letterSpacing: "1px", cursor: "pointer", fontFamily: "inherit",
      fontWeight: "600", textTransform: "uppercase",
      background: active ? "#00ffb4" : "transparent",
      color: active ? "#0a0a0f" : "#8888aa",
      border: `1px solid ${active ? "#00ffb4" : "rgba(255,255,255,0.1)"}`,
      transition: "all 0.15s",
    }),
    checkRow: (flagged) => ({
      display: "flex", alignItems: "flex-start", gap: "14px",
      padding: "16px", marginBottom: "10px",
      background: flagged ? "rgba(0,255,180,0.06)" : "rgba(255,255,255,0.02)",
      border: `1px solid ${flagged ? "rgba(0,255,180,0.2)" : "rgba(255,255,255,0.06)"}`,
      borderRadius: "6px", cursor: "pointer",
      transition: "all 0.15s",
    }),
    checkbox: (flagged) => ({
      width: "20px", height: "20px", borderRadius: "3px", flexShrink: 0, marginTop: "2px",
      background: flagged ? "#00ffb4" : "transparent",
      border: `2px solid ${flagged ? "#00ffb4" : "rgba(255,255,255,0.2)"}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      transition: "all 0.15s",
    }),
    savingsBar: {
      height: "6px", background: "rgba(255,255,255,0.06)",
      borderRadius: "3px", overflow: "hidden", marginTop: "8px",
    },
    savingsFill: (pct) => ({
      height: "100%",
      width: `${Math.min(pct, 100)}%`,
      background: "linear-gradient(90deg, #00ffb4, #00d4ff)",
      borderRadius: "3px",
      transition: "width 0.4s ease",
    }),
    sectionTab: (active) => ({
      padding: "10px 16px", cursor: "pointer",
      borderBottom: active ? "2px solid #00ffb4" : "2px solid transparent",
      color: active ? "#00ffb4" : "#666688",
      fontSize: "12px", letterSpacing: "1px", textTransform: "uppercase",
      fontWeight: "600", transition: "all 0.15s", whiteSpace: "nowrap",
    }),
    statBox: {
      background: "rgba(0,255,180,0.05)",
      border: "1px solid rgba(0,255,180,0.15)",
      borderRadius: "8px", padding: "24px", flex: "1", minWidth: "160px",
    },
    reportRow: (severity) => ({
      padding: "16px 20px", marginBottom: "10px",
      borderLeft: `3px solid ${severity === "high" ? "#ff4466" : severity === "med" ? "#ffaa00" : "#00ffb4"}`,
      background: "rgba(255,255,255,0.02)", borderRadius: "0 6px 6px 0",
    }),
  };

  if (step === "intro") return (
    <div style={styles.root}>
      <div style={styles.grid} />
      <div style={styles.container}>
        <div style={styles.badge}>Cloud Cost Audit · MVP v1.0</div>
        <h1 style={styles.h1}>Find the money your cloud is burning.</h1>
        <p style={styles.sub}>
          A structured, 15-minute audit that finds real savings in your AWS, GCP, or Azure bill.
          No tools required — just your monthly invoice and this checklist.
        </p>

        <div style={styles.card}>
          <label style={styles.label}>Company / Project name</label>
          <input
            style={styles.input} placeholder="e.g. Acme Corp"
            value={companyName} onChange={e => setCompanyName(e.target.value)}
          />
        </div>

        <div style={styles.card}>
          <label style={styles.label}>Cloud Provider</label>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {PROVIDERS.map(p => (
              <button key={p} style={styles.pill(provider === p)} onClick={() => setProvider(p)}>{p}</button>
            ))}
          </div>
        </div>

        <div style={styles.card}>
          <label style={styles.label}>Current Monthly Cloud Bill (USD)</label>
          <input
            style={styles.input} type="number" placeholder="e.g. 3500"
            value={monthlyBill} onChange={e => setMonthlyBill(e.target.value)}
          />
          {bill > 0 && (
            <p style={{ color: "#00ffb4", fontSize: "13px", marginTop: "10px" }}>
              ✦ Typical savings found: ${Math.round(bill * 0.2).toLocaleString()} – ${Math.round(bill * 0.45).toLocaleString()} / month
            </p>
          )}
        </div>

        <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
          <button
            style={styles.btnPrimary}
            disabled={!provider || !monthlyBill}
            onClick={() => goTo("audit")}
          >
            Start Audit →
          </button>
        </div>

        <div style={{ marginTop: "60px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: "16px" }}>
          {[
            { n: "18", label: "Audit checks" },
            { n: "15min", label: "Average time" },
            { n: "20–45%", label: "Typical savings" },
            { n: "0 PLN", label: "Cost to run" },
          ].map(s => (
            <div key={s.n} style={{ textAlign: "center", padding: "20px", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "6px" }}>
              <div style={{ fontSize: "28px", fontWeight: "700", color: "#00ffb4", letterSpacing: "-1px" }}>{s.n}</div>
              <div style={{ fontSize: "11px", color: "#666688", letterSpacing: "1px", textTransform: "uppercase", marginTop: "4px" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (step === "audit") {
    const section = AUDIT_SECTIONS[activeSection];
    const progressPct = Math.round((totalDone / totalChecks) * 100);

    return (
      <div style={styles.root}>
        <div style={styles.grid} />
        <div style={styles.container}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px", flexWrap: "wrap", gap: "12px" }}>
            <div>
              <div style={styles.badge}>{provider} · {companyName || "Audit"}</div>
              <div style={{ fontSize: "13px", color: "#666688" }}>
                {totalDone}/{totalChecks} checks reviewed · {progressPct}% complete
              </div>
            </div>
            {/* Live savings ticker */}
            {flaggedChecks.length > 0 && bill > 0 && (
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "11px", color: "#666688", letterSpacing: "1px", textTransform: "uppercase" }}>Potential savings found</div>
                <div style={{ fontSize: "24px", fontWeight: "700", color: "#00ffb4" }}>
                  ${Math.round(totalSavingsMin).toLocaleString()} – ${Math.round(totalSavingsMax).toLocaleString()}/mo
                </div>
              </div>
            )}
          </div>

          {/* Progress bar */}
          <div style={styles.savingsBar}>
            <div style={styles.savingsFill(progressPct)} />
          </div>

          {/* Section tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.08)", marginTop: "28px", marginBottom: "28px", overflowX: "auto" }}>
            {AUDIT_SECTIONS.map((s, i) => (
              <div key={s.id} style={styles.sectionTab(i === activeSection)} onClick={() => setActiveSection(i)}>
                {s.icon} {s.label}
                <span style={{ marginLeft: "6px", color: sectionProgress[i].done === sectionProgress[i].total && sectionProgress[i].done > 0 ? "#00ffb4" : "#555" }}>
                  {sectionProgress[i].done > 0 ? `(${sectionProgress[i].done}/${sectionProgress[i].total})` : ""}
                </span>
              </div>
            ))}
          </div>

          <h2 style={{ fontSize: "18px", fontWeight: "600", margin: "0 0 6px", color: "#fff" }}>{section.icon} {section.label}</h2>
          <p style={{ color: "#666688", fontSize: "13px", marginBottom: "20px" }}>
            Check any item that applies to your infrastructure. Each flagged issue shows its savings range.
          </p>

          {section.checks.map((check) => {
            const flagged = !!checked[check.id];
            const savMin = bill > 0 ? Math.round(bill * check.savingsRange[0] / 100) : null;
            const savMax = bill > 0 ? Math.round(bill * check.savingsRange[1] / 100) : null;
            return (
              <div key={check.id} style={styles.checkRow(flagged)} onClick={() => toggleCheck(check.id)}>
                <div style={styles.checkbox(flagged)}>
                  {flagged && <span style={{ color: "#0a0a0f", fontSize: "14px", fontWeight: "900" }}>✓</span>}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "14px", fontWeight: "600", color: flagged ? "#fff" : "#aaaacc", marginBottom: "4px" }}>
                    {check.label}
                  </div>
                  <div style={{ fontSize: "12px", color: "#666688" }}>{check.tip}</div>
                  {flagged && bill > 0 && (
                    <div style={{ marginTop: "8px", fontSize: "12px", color: "#00ffb4", fontWeight: "700" }}>
                      ↳ Est. savings: ${savMin?.toLocaleString()} – ${savMax?.toLocaleString()} / month
                    </div>
                  )}
                </div>
                <div style={{ fontSize: "11px", color: "#444466", textAlign: "right", flexShrink: 0 }}>
                  {check.savingsRange[0]}–{check.savingsRange[1]}%
                </div>
              </div>
            );
          })}

          <div style={{ display: "flex", gap: "14px", marginTop: "28px", flexWrap: "wrap" }}>
            {activeSection > 0 && (
              <button style={styles.btnOutline} onClick={() => setActiveSection(a => a - 1)}>← Previous</button>
            )}
            {activeSection < AUDIT_SECTIONS.length - 1 ? (
              <button style={styles.btnPrimary} onClick={() => setActiveSection(a => a + 1)}>
                Next Section →
              </button>
            ) : (
              <button style={styles.btnPrimary} onClick={() => goTo("report")}>
                Generate Report →
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (step === "report") {
    const annualMin = totalSavingsMin * 12;
    const annualMax = totalSavingsMax * 12;

    const getSeverity = (check) => {
      const pct = (check.savingsRange[0] + check.savingsRange[1]) / 2;
      return pct >= 30 ? "high" : pct >= 15 ? "med" : "low";
    };

    const highFindings = flaggedChecks.filter(c => getSeverity(c) === "high");
    const medFindings = flaggedChecks.filter(c => getSeverity(c) === "med");
    const lowFindings = flaggedChecks.filter(c => getSeverity(c) === "low");

    return (
      <div style={styles.root}>
        <div style={styles.grid} />
        <div style={styles.container}>
          <div style={styles.badge}>Audit Report · {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</div>

          <h1 style={{ ...styles.h1, fontSize: "clamp(22px,4vw,40px)" }}>
            {companyName || "Your"} Cloud Cost Report
          </h1>

          <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", marginBottom: "36px" }}>
            {[
              { label: "Provider", val: provider },
              { label: "Monthly Bill", val: `$${bill.toLocaleString()}` },
              { label: "Issues Found", val: flaggedChecks.length },
              { label: "Audit Coverage", val: `${Math.round((totalDone / totalChecks) * 100)}%` },
            ].map(s => (
              <div key={s.label} style={{ padding: "10px 18px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px" }}>
                <span style={{ color: "#666688", fontSize: "11px", letterSpacing: "1px", textTransform: "uppercase" }}>{s.label}: </span>
                <span style={{ color: "#fff", fontWeight: "700" }}>{s.val}</span>
              </div>
            ))}
          </div>

          {/* Savings summary */}
          {flaggedChecks.length > 0 ? (
            <div style={{ background: "rgba(0,255,180,0.06)", border: "1px solid rgba(0,255,180,0.2)", borderRadius: "8px", padding: "28px", marginBottom: "32px" }}>
              <div style={{ fontSize: "12px", letterSpacing: "2px", color: "#00ffb4", textTransform: "uppercase", marginBottom: "16px" }}>💰 Estimated Savings Opportunity</div>
              <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: "38px", fontWeight: "700", color: "#00ffb4", letterSpacing: "-2px" }}>
                    ${Math.round(totalSavingsMin).toLocaleString()} – ${Math.round(totalSavingsMax).toLocaleString()}
                  </div>
                  <div style={{ color: "#888", fontSize: "13px" }}>per month ({savingsPct}% of bill)</div>
                </div>
                <div>
                  <div style={{ fontSize: "38px", fontWeight: "700", color: "#00cc8f", letterSpacing: "-2px" }}>
                    ${Math.round(annualMin).toLocaleString()} – ${Math.round(annualMax).toLocaleString()}
                  </div>
                  <div style={{ color: "#888", fontSize: "13px" }}>annualized savings</div>
                </div>
              </div>
              <div style={{ marginTop: "16px", fontSize: "13px", color: "#666688" }}>
                ⚠ Conservative estimates based on industry benchmarks. Actual savings vary by implementation.
              </div>
            </div>
          ) : (
            <div style={{ ...styles.card, textAlign: "center", padding: "40px" }}>
              <div style={{ fontSize: "40px" }}>✅</div>
              <div style={{ color: "#00ffb4", fontWeight: "700", marginTop: "12px" }}>No issues flagged</div>
              <div style={{ color: "#666688", fontSize: "13px", marginTop: "6px" }}>Your infrastructure looks well-optimized.</div>
            </div>
          )}

          {/* Findings by severity */}
          {[
            { label: "🔴 High Impact Findings", items: highFindings, severity: "high", color: "#ff4466" },
            { label: "🟡 Medium Impact Findings", items: medFindings, severity: "med", color: "#ffaa00" },
            { label: "🟢 Quick Wins", items: lowFindings, severity: "low", color: "#00ffb4" },
          ].filter(g => g.items.length > 0).map(group => (
            <div key={group.severity} style={{ marginBottom: "28px" }}>
              <h3 style={{ fontSize: "13px", letterSpacing: "2px", textTransform: "uppercase", color: group.color, marginBottom: "14px" }}>{group.label}</h3>
              {group.items.map(check => {
                const savMin = bill > 0 ? Math.round(bill * check.savingsRange[0] / 100) : null;
                const savMax = bill > 0 ? Math.round(bill * check.savingsRange[1] / 100) : null;
                return (
                  <div key={check.id} style={styles.reportRow(group.severity)}>
                    <div style={{ fontWeight: "600", fontSize: "14px", marginBottom: "4px" }}>{check.label}</div>
                    <div style={{ fontSize: "12px", color: "#888899", marginBottom: "6px" }}>{check.tip}</div>
                    {bill > 0 && (
                      <div style={{ fontSize: "12px", fontWeight: "700", color: group.color }}>
                        Potential saving: ${savMin?.toLocaleString()} – ${savMax?.toLocaleString()} / month
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {/* Next steps */}
          <div style={{ ...styles.card, marginTop: "10px" }}>
            <div style={styles.label}>Recommended Next Steps</div>
            <ol style={{ paddingLeft: "20px", color: "#aaaacc", lineHeight: "2", fontSize: "14px", margin: 0 }}>
              {highFindings.length > 0 && <li>Tackle <strong style={{ color: "#ff4466" }}>high-impact findings</strong> first — these yield the fastest ROI.</li>}
              <li>Schedule a <strong style={{ color: "#00ffb4" }}>rightsizing review</strong> in your cloud provider's console (free tooling available).</li>
              <li>Set <strong style={{ color: "#00ffb4" }}>budget alerts</strong> at 80% and 100% of your monthly target — today.</li>
              <li>Implement <strong style={{ color: "#00ffb4" }}>automated dev/staging shutdown</strong> outside business hours.</li>
              <li>Revisit this audit in <strong style={{ color: "#fff" }}>30 days</strong> after changes are applied.</li>
            </ol>
          </div>

          {/* CTA for the DevOps side hustle */}
          <div style={{ marginTop: "24px", padding: "24px", background: "rgba(0,255,180,0.04)", border: "1px dashed rgba(0,255,180,0.2)", borderRadius: "8px", textAlign: "center" }}>
            <div style={{ fontSize: "13px", color: "#666688", marginBottom: "8px" }}>Want hands-on help implementing these savings?</div>
            <div style={{ fontSize: "18px", fontWeight: "700", color: "#fff" }}>Book a 1-hour implementation session</div>
            <div style={{ fontSize: "13px", color: "#00ffb4", marginTop: "4px" }}>Starting from 800 PLN · Remote · Delivered within 48hrs</div>
          </div>

          <div style={{ display: "flex", gap: "14px", marginTop: "32px", flexWrap: "wrap" }}>
            <button style={styles.btnPrimary} onClick={() => window.print()}>
              Export Report
            </button>
            <button style={styles.btnOutline} onClick={() => { setChecked({}); setActiveSection(0); goTo("audit"); }}>
              ← Re-run Audit
            </button>
            <button style={styles.btnOutline} onClick={() => goTo("intro")}>
              New Audit
            </button>
          </div>
        </div>
      </div>
    );
  }
}