import { useState, useEffect, useRef } from "react";

// --- DATA ---
const AUDIT_SECTIONS = [
  {
    id: "compute", label: "Compute", icon: "⚡",
    description: "Instance sizing, reservation strategy & generation currency",
    summary: "Identifies idle VMs, missing savings plans, spot opportunities, and legacy instances burning money.",
    checks: [
      { id: "rightsizing", label: "Idle or oversized instances", detail: "Over 80% unused capacity detected", savingsRange: [15, 40], effort: "Medium", impact: "High" },
      { id: "reserved", label: "No Reserved Instances / Savings Plans", detail: "Running fully on-demand pricing", savingsRange: [20, 45], effort: "Low", impact: "High" },
      { id: "spot", label: "Spot instances unused for batch/dev", detail: "CI runners, ML training, ETL jobs eligible", savingsRange: [60, 80], effort: "Medium", impact: "Critical" },
      { id: "old_gen", label: "Previous-generation instance types", detail: "m4, c4, r4 families still in use", savingsRange: [5, 15], effort: "Low", impact: "Medium" },
    ],
  },
  {
    id: "storage", label: "Storage", icon: "🗄",
    description: "Object storage tiering, orphaned volumes & data transfer",
    summary: "Uncovers untriered S3 data, orphaned disks, stale snapshots, and expensive egress routing.",
    checks: [
      { id: "s3_tier", label: "Storage not tiered by access frequency", detail: "All data sitting in Standard class", savingsRange: [30, 60], effort: "Low", impact: "High" },
      { id: "unattached_volumes", label: "Unattached disks & orphaned volumes", detail: "Persisting after instance termination", savingsRange: [5, 20], effort: "Low", impact: "Medium" },
    ],
  },
  {
    id: "database", label: "Database", icon: "🗃",
    description: "RDS sizing, dev environment waste & caching gaps",
    summary: "Finds dev/staging RDS running 24/7 and over-provisioned production clusters.",
    checks: [
      { id: "rds_idle", label: "Dev/staging RDS running 24/7", detail: "Full-price uptime for non-production databases", savingsRange: [40, 70], effort: "Low", impact: "Critical" },
      { id: "rds_size", label: "RDS instances over-provisioned", detail: "High memory, <10% actual usage", savingsRange: [20, 40], effort: "Medium", impact: "High" },
    ],
  },
];

const PROVIDERS = ["AWS", "GCP", "Azure", "Multi-cloud"];

// --- UI COMPONENTS ---

const Nav = ({ onLogoClick, onBookClick }) => (
  <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(8,8,16,0.8)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.08)", padding: "0 5%", height: "70px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
    <div onClick={onLogoClick} style={{ display: "flex", alignItems: "center", gap: "12px", cursor: "pointer" }}>
      <div style={{ width: "35px", height: "35px", background: "var(--green)", borderRadius: "10px", display: "grid", placeItems: "center", color: "#000", fontWeight: "bold", boxShadow: "0 0 20px rgba(0,255,180,0.3)" }}>⚡</div>
      <span className="display" style={{ fontWeight: 800, fontSize: "20px", color: "#fff" }}>CloudAudit</span>
    </div>
    <button onClick={onBookClick} className="glow-btn" style={{ padding: "8px 20px", fontSize: "13px", borderRadius: "8px", background: "transparent", border: "1px solid var(--green)", color: "var(--green)", cursor: "pointer" }}>
      Book Session
    </button>
  </nav>
);

const ContactModal = ({ isOpen, onClose, savings }) => {
  if (!isOpen) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", padding: "20px" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.9)", backdropFilter: "blur(10px)" }} />
      <div className="glass fade-up" style={{ position: "relative", maxWidth: "500px", width: "100%", padding: "40px", borderRadius: "24px", border: "1px solid rgba(0,255,180,0.2)", background: "#0d0d1a" }}>
        <h2 className="display" style={{ fontSize: "28px", marginBottom: "12px" }}>Implementation Sprint</h2>
        <p style={{ color: "#94a3b8", marginBottom: "32px", fontSize: "15px" }}>Ready to save {savings}? Fill this in and I'll reach out within 24 hours to start the 48h cleanup.</p>
        
        <form action="https://formspree.io/f/mlgarana" method="POST" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <input type="hidden" name="_subject" value="New Audit Booking Request" />
          <div>
            <label style={{ display: "block", fontSize: "12px", color: "var(--green)", marginBottom: "8px", fontWeight: "bold" }}>WORK EMAIL</label>
            <input name="email" type="email" required placeholder="ceo@company.com" style={{ width: "100%", padding: "14px", borderRadius: "10px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "12px", color: "var(--green)", marginBottom: "8px", fontWeight: "bold" }}>INFRASTRUCTURE NOTES</label>
            <textarea name="message" rows="3" placeholder="Tell me about your tech stack..." style={{ width: "100%", padding: "14px", borderRadius: "10px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }} />
          </div>
          <button type="submit" className="glow-btn" style={{ background: "var(--green)", color: "#000", padding: "16px", borderRadius: "12px", fontWeight: "bold", border: "none", cursor: "pointer" }}>
            Send Request →
          </button>
        </form>
      </div>
    </div>
  );
};

// --- MAIN APP ---

export default function App() {
  const [step, setStep] = useState("intro");
  const [monthlyBill, setMonthlyBill] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [provider, setProvider] = useState("");
  const [checked, setChecked] = useState({});
  const [activeSection, setActiveSection] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Stats logic
  const bill = parseFloat(monthlyBill) || 0;
  const flagged = AUDIT_SECTIONS.flatMap(s => s.checks).filter(c => checked[c.id]);
  const savMin = Math.round(flagged.reduce((s, c) => s + bill * c.savingsRange[0] / 100, 0));
  const savMax = Math.round(flagged.reduce((s, c) => s + bill * c.savingsRange[1] / 100, 0));

  const handleLogoClick = () => {
    setStep("intro");
    setChecked({});
    setMonthlyBill("");
    setActiveSection(0);
  };

  return (
    <div className="app">
      <style>{`
        :root { --green: #00ffb4; --bg: #080810; }
        .display { font-family: 'Bricolage Grotesque', sans-serif; }
        .glass { background: rgba(255,255,255,0.03); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.08); }
        .glow-btn:hover { transform: translateY(-2px); box-shadow: 0 0 30px rgba(0,255,180,0.3); transition: all 0.3s; }
        .card-hover:hover { border-color: var(--green) !important; transform: translateY(-5px); transition: all 0.3s; }
        .fade-up { animation: fadeUp 0.6s ease-out forwards; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      <Nav onLogoClick={handleLogoClick} onBookClick={() => setIsModalOpen(true)} />
      <ContactModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} savings={`$${savMin}-$${savMax}/mo`} />

      {/* INTRO STEP */}
      {step === "intro" && (
        <main style={{ maxWidth: "1200px", margin: "0 auto", padding: "80px 24px" }}>
          <div style={{ textAlign: "center", marginBottom: "100px" }} className="fade-up">
            <h1 className="display" style={{ fontSize: "clamp(48px, 8vw, 84px)", lineHeight: 0.95, fontWeight: 800 }}>
              Cloud bills are <br/> <span style={{ color: "var(--green)" }}>financial leaks.</span>
            </h1>
            <p style={{ color: "#94a3b8", fontSize: "20px", margin: "32px auto", maxWidth: "600px" }}>
              Run a private, credential-free audit in 10 minutes. Discover exactly where your money is going.
            </p>
            <button className="glow-btn" onClick={() => setStep("intake")} style={{ background: "var(--green)", color: "#000", padding: "18px 45px", borderRadius: "14px", border: "none", fontWeight: 800, fontSize: "18px", cursor: "pointer" }}>
              Analyze My Infrastructure →
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "24px" }}>
            {AUDIT_SECTIONS.map(s => (
              <div key={s.id} className="glass card-hover fade-up" style={{ padding: "40px", borderRadius: "24px" }}>
                <span style={{ fontSize: "40px" }}>{s.icon}</span>
                <h3 className="display" style={{ fontSize: "24px", margin: "20px 0 12px" }}>{s.label}</h3>
                <p style={{ color: "#94a3b8", lineHeight: 1.6 }}>{s.summary}</p>
              </div>
            ))}
          </div>
        </main>
      )}

      {/* OTHER STEPS (Intake/Audit) - Logic remains same but with updated CSS classes */}
      {step === "intake" && (
        <div style={{ maxWidth: "500px", margin: "100px auto" }} className="fade-up">
           <div className="glass" style={{ padding: "40px", borderRadius: "24px" }}>
              <h2 className="display" style={{ fontSize: "32px", marginBottom: "32px" }}>The Baseline</h2>
              <label style={{ color: "var(--green)", fontSize: "12px", fontWeight: "bold" }}>ESTIMATED MONTHLY SPEND (USD)</label>
              <input type="number" value={monthlyBill} onChange={(e) => setMonthlyBill(e.target.value)} placeholder="e.g. 5000" 
                style={{ width: "100%", padding: "16px", borderRadius: "12px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", marginTop: "12px" }} />
              <button className="glow-btn" onClick={() => setStep("audit")} style={{ width: "100%", marginTop: "32px", background: "var(--green)", color: "#000", padding: "16px", borderRadius: "12px", border: "none", fontWeight: "bold" }}>
                Begin Audit →
              </button>
           </div>
        </div>
      )}

      {/* REPORT STEP */}
      {step === "report" && (
        <main style={{ maxWidth: "900px", margin: "60px auto", padding: "0 24px" }} className="fade-up">
          <div className="glass" style={{ padding: "50px", borderRadius: "32px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "40px" }}>
              <h1 className="display" style={{ fontSize: "42px" }}>Audit Report</h1>
              <button onClick={() => window.print()} style={{ background: "transparent", color: "#fff", border: "1px solid #444", borderRadius: "8px", padding: "8px 16px" }}>Download PDF</button>
            </div>

            <div style={{ background: "rgba(0,255,180,0.1)", border: "1px solid var(--green)", padding: "40px", borderRadius: "24px", textAlign: "center", marginBottom: "50px" }}>
              <p style={{ color: "var(--green)", fontWeight: "bold", letterSpacing: "2px" }}>ESTIMATED ANNUAL ROI</p>
              <h2 className="display" style={{ fontSize: "64px" }}>${savMin * 12} - ${savMax * 12}</h2>
            </div>

            {/* CTA SECTION */}
            <div style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #0d0d1a 100%)", padding: "40px", borderRadius: "24px", border: "1px solid rgba(99,102,241,0.3)", textAlign: "center" }}>
              <p style={{ color: "var(--green)", fontWeight: "bold", fontSize: "12px", marginBottom: "12px" }}>NEED HANDS-ON HELP?</p>
              <h3 className="display" style={{ fontSize: "28px" }}>Book an implementation session</h3>
              <p style={{ color: "#94a3b8", margin: "16px 0 32px" }}>Senior DevOps engineer · Remote · Full report + execution in 48hrs</p>
              <button onClick={() => setIsModalOpen(true)} className="glow-btn" style={{ background: "var(--green)", color: "#000", padding: "16px 40px", borderRadius: "12px", border: "none", fontWeight: 800 }}>
                Book for 999 PLN →
              </button>
            </div>
          </div>
        </main>
      )}
      
      {/* (Include your Audit Engine here as per previous logic) */}
      {step === "audit" && (
        <div style={{ maxWidth: "800px", margin: "40px auto", padding: "0 20px" }}>
           {/* Your Audit logic goes here */}
           <button onClick={() => setStep("report")}>Finish</button>
        </div>
      )}
    </div>
  );
}