import { useState, useEffect, useRef } from "react";

// --- DATA & CONSTANTS ---
const AUDIT_SECTIONS = [
  {
    id: "compute", label: "Compute", icon: "⚡",
    description: "Instance sizing, reservation strategy & generation currency",
    summary: "Identifies idle VMs, missing savings plans, spot opportunities, and legacy instance types burning money silently.",
    checks: [
      { id: "rightsizing", label: "Idle or oversized instances", detail: "Over 80% unused capacity detected", savingsRange: [15, 40], effort: "Medium", impact: "High" },
      { id: "reserved", label: "No Reserved Instances / Savings Plans", detail: "Running fully on-demand pricing", savingsRange: [20, 45], effort: "Low", impact: "High" },
      { id: "spot", label: "Spot instances unused for batch/dev", detail: "CI runners, ML training, ETL jobs eligible", savingsRange: [60, 80], effort: "Medium", impact: "Critical" },
    ],
  },
  {
    id: "storage", label: "Storage", icon: "🗄",
    description: "Object storage tiering, orphaned volumes & data transfer",
    summary: "Uncovers untriered S3/GCS data, orphaned disks, and expensive egress routing.",
    checks: [
      { id: "s3_tier", label: "Storage not tiered by access frequency", detail: "All data sitting in Standard class", savingsRange: [30, 60], effort: "Low", impact: "High" },
    ],
  },
  {
    id: "database", label: "Database", icon: "🗃",
    description: "RDS sizing, dev environment waste & caching gaps",
    summary: "Finds dev/staging RDS running 24/7 and over-provisioned databases.",
    checks: [
      { id: "rds_idle", label: "Dev/staging RDS running 24/7", detail: "Full-price uptime for non-production databases", savingsRange: [40, 70], effort: "Low", impact: "Critical" },
    ],
  },
];

const PROVIDERS = ["AWS", "GCP", "Azure", "Multi-cloud"];
const IMPACT_COLOR = { Critical: "#f87171", High: "#fb923c", Medium: "#fbbf24", Low: "#4ade80" };
const EFFORT_COLOR = { Low: "#4ade80", Medium: "#fbbf24", High: "#f87171" };

// --- NEW MODAL COMPONENT ---
function ContactFormModal({ isOpen, onClose }) {
  if (!isOpen) return null;
  return (
    <div className="modal-overlay" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ background: "#0d0d1a", border: "1px solid rgba(0,255,180,0.2)", borderRadius: "24px", maxWidth: "500px", width: "100%", padding: "40px", position: "relative" }}>
        <button onClick={onClose} style={{ position: "absolute", top: "24px", right: "24px", background: "none", border: "none", color: "#64748b", fontSize: "24px", cursor: "pointer" }}>×</button>
        
        <h2 className="display" style={{ fontSize: "28px", color: "#fff", marginBottom: "12px" }}>Implementation Sprint</h2>
        <p style={{ color: "#94a3b8", fontSize: "15px", marginBottom: "32px" }}>Fill this in and I'll reach out within 24 hours to start your 48h cloud cost cleanup.</p>
        
        <form action="https://formspree.io/f/mlgarana" method="POST" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div>
            <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "8px", textTransform: "uppercase" }}>Work Email</label>
            <input name="email" type="email" required placeholder="name@company.com" style={{ width: "100%", padding: "14px", borderRadius: "10px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "8px", textTransform: "uppercase" }}>Tell me about your setup</label>
            <textarea name="message" rows="3" placeholder="Which cloud provider? Main issues?" style={{ width: "100%", padding: "14px", borderRadius: "10px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontFamily: "inherit" }}></textarea>
          </div>
          <button type="submit" className="glow-btn" style={{ width: "100%", padding: "16px", background: "var(--green)", color: "#000", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "16px" }}>
            Book Session →
          </button>
        </form>
      </div>
    </div>
  );
}

// --- MAIN APP ---
export default function App() {
  const [step, setStep] = useState("intro");
  const [provider, setProvider] = useState("");
  const [monthlyBill, setMonthlyBill] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [checked, setChecked] = useState({});
  const [activeSection, setActiveSection] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const resetToHome = () => {
    setStep("intro");
    setMonthlyBill("");
    setProvider("");
    setCompanyName("");
    setChecked({});
    setActiveSection(0);
  };

  const bill = parseFloat(monthlyBill) || 0;
  const flagged = AUDIT_SECTIONS.flatMap(s => s.checks).filter(c => checked[c.id]);
  const savMin = Math.round(flagged.reduce((s, c) => s + bill * c.savingsRange[0] / 100, 0));
  const savMax = Math.round(flagged.reduce((s, c) => s + bill * c.savingsRange[1] / 100, 0));
  const savPct = bill > 0 ? Math.round(((savMin + savMax) / 2 / bill) * 100) : 0;

  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700;800&family=DM+Sans:wght@400;500;700&display=swap');
        :root { --green: #00ffb4; --bg: #080810; }
        .display { font-family: 'Bricolage Grotesque', sans-serif; }
        body { background: var(--bg); color: #e2e8f0; font-family: 'DM Sans', sans-serif; }
        .glow-btn { transition: all 0.2s; cursor: pointer; }
        .glow-btn:hover { box-shadow: 0 0 25px rgba(0,255,180,0.4); transform: translateY(-2px); }
      `}</style>

      <ContactFormModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />

      {/* NAV */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(8,8,16,0.8)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.08)", padding: "0 24px", height: "60px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div onClick={resetToHome} style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
          <div style={{ width: "30px", height: "30px", background: "var(--green)", borderRadius: "8px", display: "grid", placeItems: "center", color: "#000", fontWeight: "bold" }}>⚡</div>
          <span className="display" style={{ fontWeight: 800, fontSize: "18px", color: "#fff" }}>CloudAudit</span>
        </div>
      </nav>

      {/* HERO / INTRO */}
      {step === "intro" && (
        <main style={{ maxWidth: "1100px", margin: "0 auto", padding: "100px 24px", textAlign: "center" }}>
          <h1 className="display" style={{ fontSize: "clamp(40px, 7vw, 72px)", fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>
            Cloud bills are <span style={{ color: "var(--green)" }}>financial leaks.</span>
          </h1>
          <p style={{ color: "#94a3b8", fontSize: "19px", margin: "32px auto", maxWidth: "600px" }}>
            A structured audit to uncover exactly where your spend is disappearing. No credit card, no signup.
          </p>
          <button className="glow-btn" onClick={() => setStep("intake")} style={{ background: "var(--green)", color: "#000", padding: "18px 48px", borderRadius: "12px", border: "none", fontWeight: "bold", fontSize: "17px" }}>
            Start Free Audit →
          </button>
        </main>
      )}

      {/* INTAKE STEP */}
      {step === "intake" && (
        <div style={{ maxWidth: "480px", margin: "80px auto", padding: "0 24px" }}>
          <div style={{ background: "#0d0d1a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "24px", padding: "40px" }}>
            <h2 className="display" style={{ fontSize: "28px", marginBottom: "32px" }}>Set the Baseline</h2>
            <label style={{ display: "block", color: "var(--green)", fontSize: "12px", fontWeight: 700, marginBottom: "10px" }}>MONTHLY CLOUD BILL (USD)</label>
            <input type="number" value={monthlyBill} onChange={(e) => setMonthlyBill(e.target.value)} placeholder="e.g. 5000" style={{ width: "100%", padding: "16px", borderRadius: "12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontSize: "16px" }} />
            <button className="glow-btn" onClick={() => setStep("audit")} style={{ width: "100%", marginTop: "24px", background: "var(--green)", color: "#000", padding: "16px", borderRadius: "12px", border: "none", fontWeight: 700 }}>Next Step →</button>
          </div>
        </div>
      )}

      {/* REPORT STEP (With your specific CTA) */}
      {step === "report" && (
        <div style={{ maxWidth: "800px", margin: "40px auto", padding: "0 24px" }}>
          <div style={{ background: "#0d0d1a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "24px", padding: "48px" }}>
            <div style={{ background: "rgba(0,255,180,0.1)", border: "1px solid var(--green)", borderRadius: "16px", padding: "32px", textAlign: "center", marginBottom: "40px" }}>
              <p style={{ color: "var(--green)", fontWeight: "bold", fontSize: "13px" }}>POTENTIAL MONTHLY SAVINGS</p>
              <h2 className="display" style={{ fontSize: "56px", margin: "8px 0" }}>${savMin} - ${savMax}</h2>
            </div>

            {/* YOUR TARGETED CTA SECTION */}
            <div style={{ background: "linear-gradient(135deg, rgba(0,255,180,0.07) 0%, rgba(99,102,241,0.07) 100%)", border: "1px solid rgba(0,255,180,0.15)", borderRadius: "20px", padding: "40px", textAlign: "center" }}>
              <p style={{ fontSize: "12px", fontWeight: 700, color: "var(--green)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "12px" }}>Need hands-on help?</p>
              <h3 className="display" style={{ fontSize: "28px", fontWeight: 800, letterSpacing: "-0.5px", color: "#fff", marginBottom: "10px" }}>Book an implementation session</h3>
              <p style={{ color: "#94a3b8", fontSize: "15px", marginBottom: "28px" }}>Senior DevOps engineer · Remote · Full report + implementation in 48hrs</p>
              <button onClick={() => setIsModalOpen(true)} className="glow-btn" style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: "12px", padding: "14px 32px", fontSize: "15px", fontWeight: 700, boxShadow: "0 0 28px rgba(0,255,180,0.35)" }}>
                Book for 999 PLN →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Placeholders for Audit Logic (to keep file clean) */}
      {step === "audit" && (
        <div style={{ textAlign: "center", marginTop: "100px" }}>
          <p>Complete the audit categories...</p>
          <button onClick={() => setStep("report")} style={{ marginTop: "20px", color: "var(--green)", background: "none", border: "1px solid var(--green)", padding: "10px 20px", cursor: "pointer" }}>Finish Audit</button>
        </div>
      )}
    </div>
  );
}