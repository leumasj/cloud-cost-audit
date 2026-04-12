import { useState, useEffect, useRef, useMemo } from "react";

// --- CONSTANTS & DATA ---
const STORAGE_KEY = "cloudaudit_progress";

const AUDIT_SECTIONS = [
  {
    id: "compute", label: "Compute", icon: "⚡",
    description: "Instance sizing, reservation strategy & generation currency",
    summary: "Analyzes CPU/RAM utilization to find 'Zombie' instances and identifies where Spot Instances or Savings Plans could cut costs by 70%.",
    checks: [
      { id: "rightsizing", label: "Idle or oversized instances", detail: "Over 80% unused capacity detected", savingsRange: [15, 40], effort: "Medium", impact: "High" },
      { id: "reserved", label: "No Reserved Instances / Savings Plans", detail: "Running fully on-demand pricing", savingsRange: [20, 45], effort: "Low", impact: "High" },
      { id: "spot", label: "Spot instances unused for batch/dev", detail: "CI runners, ML training, ETL jobs eligible", savingsRange: [60, 80], effort: "Medium", impact: "Critical" },
    ],
  },
  {
    id: "storage", label: "Storage", icon: "🗄",
    description: "Object storage tiering, orphaned volumes & snapshots",
    summary: "Finds unattached disks from deleted VMs and moves 'cold' data to cheaper S3 Glacier tiers automatically.",
    checks: [
      { id: "s3_tier", label: "Storage not tiered by access frequency", detail: "All data sitting in Standard class", savingsRange: [30, 60], effort: "Low", impact: "High" },
      { id: "unattached_volumes", label: "Unattached disks & orphaned volumes", detail: "Persisting after instance termination", savingsRange: [5, 20], effort: "Low", impact: "Medium" },
    ],
  },
  {
    id: "database", label: "Database", icon: "🗃",
    description: "RDS sizing, dev environment waste & caching gaps",
    summary: "Identifies databases running 24/7 in dev environments and suggests rightsizing for over-provisioned production clusters.",
    checks: [
      { id: "rds_idle", label: "Dev/staging RDS running 24/7", detail: "Full-price uptime for non-production databases", savingsRange: [40, 70], effort: "Low", impact: "Critical" },
      { id: "rds_size", label: "RDS instances over-provisioned", detail: "High memory, <10% actual usage", savingsRange: [20, 40], effort: "Medium", impact: "High" },
    ],
  },
];

const IMPACT_COLOR = { Critical: "#f87171", High: "#fb923c", Medium: "#fbbf24", Low: "#4ade80" };

// --- STYLES ---
const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;600;800&family=DM+Sans:wght@400;500;700&display=swap');
    
    :root {
      --bg: #050508;
      --bg-card: rgba(255, 255, 255, 0.03);
      --border: rgba(255, 255, 255, 0.08);
      --green: #00ffb4;
      --green-glow: rgba(0, 255, 180, 0.15);
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --display: 'Bricolage Grotesque', sans-serif;
    }

    body { 
      background: var(--bg); 
      color: var(--text); 
      font-family: 'DM Sans', sans-serif;
      overflow-x: hidden;
    }

    .glass {
      background: var(--bg-card);
      backdrop-filter: blur(10px);
      border: 1px solid var(--border);
      border-radius: 24px;
    }

    .hero-gradient {
      position: absolute;
      top: -10%;
      left: 50%;
      transform: translateX(-50%);
      width: 100%;
      height: 600px;
      background: radial-gradient(circle at center, rgba(0, 255, 180, 0.08) 0%, transparent 70%);
      z-index: -1;
    }

    .btn-glow {
      background: var(--green);
      color: #000;
      font-weight: 700;
      border: none;
      padding: 16px 32px;
      border-radius: 14px;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      box-shadow: 0 0 20px var(--green-glow);
    }

    .btn-glow:hover {
      transform: scale(1.05);
      box-shadow: 0 0 35px var(--green-glow);
    }

    .card-hover {
      transition: transform 0.3s ease, border-color 0.3s ease;
    }
    .card-hover:hover {
      transform: translateY(-5px);
      border-color: rgba(0, 255, 180, 0.3);
    }

    @media print {
      .no-print { display: none !important; }
      body { background: #fff; color: #000; }
      .glass { border: 1px solid #eee; background: #fff; }
    }
  `}</style>
);

// --- COMPONENTS ---

export default function App() {
  const [step, setStep] = useState("intro");
  const [monthlyBill, setMonthlyBill] = useState("");
  const [checked, setChecked] = useState({});
  const [activeSection, setActiveSection] = useState(0);

  // Simple Savings Logic
  const savings = useMemo(() => {
    const bill = parseFloat(monthlyBill) || 0;
    const count = Object.keys(checked).length;
    return {
      min: Math.round(bill * 0.15 * count * 0.5), // Dummy math for preview
      max: Math.round(bill * 0.35 * count * 0.8)
    };
  }, [monthlyBill, checked]);

  const toggleCheck = (id) => setChecked(prev => ({...prev, [id]: !prev[id]}));

  return (
    <div className="app">
      <GlobalStyles />
      <div className="hero-gradient" />
      
      {/* NAVBAR */}
      <nav className="no-print" style={{ display: 'flex', justifyContent: 'space-between', padding: '24px 5%', alignItems: 'center' }}>
        <div style={{ fontWeight: 800, fontSize: '24px' }} className="display">⚡ CloudAudit</div>
        <button onClick={() => setStep('report-preview')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>View Sample Report</button>
      </nav>

      {/* STEP 1: INTRO (WITH UX SUMMARY) */}
      {step === "intro" && (
        <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '60px 24px' }}>
          <div style={{ textAlign: 'center', marginBottom: '80px' }}>
            <h1 className="display" style={{ fontSize: 'clamp(48px, 8vw, 84px)', fontWeight: 800, lineHeight: 0.9, marginBottom: '24px' }}>
              Cut your cloud bill <br/><span style={{ color: 'var(--green)' }}>without opening AWS.</span>
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '20px', maxWidth: '700px', margin: '0 auto 40px' }}>
              Most companies waste 30% of their cloud budget. Run this manual audit to see exactly where your money is leaking.
            </p>
            <button className="btn-glow" onClick={() => setStep('intake')}>Start My Free Audit →</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
            {AUDIT_SECTIONS.map(s => (
              <div key={s.id} className="glass card-hover" style={{ padding: '32px' }}>
                <span style={{ fontSize: '40px' }}>{s.icon}</span>
                <h3 className="display" style={{ fontSize: '24px', margin: '16px 0 8px' }}>{s.label} Audit</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '15px', lineHeight: 1.6 }}>{s.summary}</p>
              </div>
            ))}
          </div>
        </main>
      )}

      {/* STEP: INTAKE */}
      {step === "intake" && (
        <main style={{ maxWidth: '500px', margin: '100px auto', padding: '0 24px' }}>
          <div className="glass" style={{ padding: '40px' }}>
            <h2 className="display" style={{ fontSize: '32px', marginBottom: '8px' }}>Let's talk numbers</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '32px' }}>What is your estimated monthly cloud spend?</p>
            <input 
              type="number" 
              placeholder="$5,000" 
              value={monthlyBill} 
              onChange={(e) => setMonthlyBill(e.target.value)}
              style={{ width: '100%', padding: '16px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: '#fff', fontSize: '18px', marginBottom: '24px' }}
            />
            <button className="btn-glow" style={{ width: '100%' }} onClick={() => setStep('audit')}>Begin Checklist</button>
          </div>
        </main>
      )}

      {/* STEP: AUDIT ENGINE */}
      {step === "audit" && (
        <main style={{ maxWidth: '1000px', margin: '40px auto', padding: '0 24px', display: 'grid', gridTemplateColumns: '1fr 300px', gap: '40px' }}>
          <div>
            <div style={{ marginBottom: '40px' }}>
              <h2 className="display" style={{ fontSize: '32px' }}>{AUDIT_SECTIONS[activeSection].icon} {AUDIT_SECTIONS[activeSection].label}</h2>
              <p style={{ color: 'var(--text-muted)' }}>{AUDIT_SECTIONS[activeSection].description}</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {AUDIT_SECTIONS[activeSection].checks.map(c => (
                <div key={c.id} onClick={() => toggleCheck(c.id)} className="glass card-hover" style={{ padding: '24px', cursor: 'pointer', borderColor: checked[c.id] ? 'var(--green)' : 'var(--border)', background: checked[c.id] ? 'var(--green-glow)' : 'var(--bg-card)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 700 }}>{c.label}</span>
                    <div style={{ width: '20px', height: '20px', borderRadius: '6px', border: '2px solid var(--green)', background: checked[c.id] ? 'var(--green)' : 'transparent' }} />
                  </div>
                  <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginTop: '8px' }}>{c.detail}</p>
                </div>
              ))}
            </div>
            <div style={{ marginTop: '40px', display: 'flex', gap: '16px' }}>
              {activeSection > 0 && <button onClick={() => setActiveSection(s => s - 1)} style={{ background: 'none', color: '#fff', border: '1px solid var(--border)', padding: '12px 24px', borderRadius: '12px' }}>Back</button>}
              {activeSection < AUDIT_SECTIONS.length - 1 ? 
                <button className="btn-glow" onClick={() => setActiveSection(s => s + 1)}>Next Section</button> :
                <button className="btn-glow" onClick={() => setStep('report')}>Generate Final Report</button>
              }
            </div>
          </div>

          <aside>
            <div className="glass" style={{ padding: '24px', position: 'sticky', top: '40px' }}>
              <p style={{ fontSize: '12px', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '1px' }}>TOTAL POTENTIAL SAVINGS</p>
              <h2 className="display" style={{ color: 'var(--green)', fontSize: '36px', margin: '8px 0' }}>${savings.min} - ${savings.max}</h2>
              <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>/ per month</p>
              <div style={{ height: '1px', background: 'var(--border)', margin: '20px 0' }} />
              <p style={{ fontSize: '13px', lineHeight: 1.5 }}>You have flagged <b>{Object.keys(checked).length}</b> infrastructure leaks.</p>
            </div>
          </aside>
        </main>
      )}

      {/* STEP: FINAL REPORT (WITH DOWNLOAD) */}
      {step === "report" && (
        <main style={{ maxWidth: '800px', margin: '60px auto', padding: '0 24px' }}>
          <div className="glass" style={{ padding: '48px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '40px' }}>
              <div>
                <h1 className="display" style={{ fontSize: '40px' }}>Optimization Report</h1>
                <p style={{ color: 'var(--text-muted)' }}>Prepared on {new Date().toLocaleDateString()}</p>
              </div>
              <button className="btn-glow no-print" onClick={() => window.print()}>Download PDF</button>
            </div>

            <div style={{ background: 'var(--green-glow)', padding: '32px', borderRadius: '20px', border: '1px solid var(--green)', marginBottom: '40px', textAlign: 'center' }}>
              <p style={{ fontWeight: 800, fontSize: '14px', color: 'var(--green)' }}>ESTIMATED ANNUAL SAVINGS</p>
              <h2 className="display" style={{ fontSize: '56px' }}>${savings.min * 12} - ${savings.max * 12}</h2>
            </div>

            <h3 className="display" style={{ fontSize: '24px', marginBottom: '24px' }}>Critical Action Items</h3>
            {AUDIT_SECTIONS.flatMap(s => s.checks).filter(c => checked[c.id]).map(c => (
              <div key={c.id} style={{ padding: '20px 0', borderBottom: '1px solid var(--border)' }}>
                <p style={{ fontWeight: 700, fontSize: '18px' }}>{c.label}</p>
                <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>{c.detail}</p>
              </div>
            ))}

            <div className="no-print" style={{ marginTop: '60px', padding: '40px', background: 'linear-gradient(rgba(0,255,180,0.1), transparent)', borderRadius: '24px', textAlign: 'center', border: '1px solid var(--green-glow)' }}>
              <h3 className="display" style={{ fontSize: '28px' }}>Want us to fix these for you?</h3>
              <p style={{ color: 'var(--text-muted)', margin: '16px 0 32px' }}>We offer a 48-hour "Cost Killer" sprint where we implement these changes for a flat fee.</p>
              <button className="btn-glow" style={{ fontSize: '18px' }}>Book for 999 PLN</button>
            </div>
          </div>
        </main>
      )}

      {/* PREVIEW MODAL */}
      {step === 'report-preview' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 1000, display: 'grid', placeItems: 'center', padding: '24px' }}>
           <div className="glass" style={{ maxWidth: '600px', width: '100%', padding: '40px', textAlign: 'center' }}>
              <h2 className="display">This is your goal.</h2>
              <div style={{ margin: '30px 0', opacity: 0.5 }}>
                 <div style={{ height: '20px', background: 'var(--green)', width: '60%', margin: '10px auto', borderRadius: '10px' }}></div>
                 <div style={{ height: '100px', border: '1px dashed var(--text-muted)', borderRadius: '10px', marginTop: '20px' }}></div>
                 <p style={{ marginTop: '10px' }}>[Sample PDF Structure]</p>
              </div>
              <p style={{ marginBottom: '30px', color: 'var(--text-muted)' }}>The final report provides a line-item breakdown of every dollar you can save, formatted for your CFO.</p>
              <button className="btn-glow" onClick={() => setStep('intro')}>Got it, let's start</button>
           </div>
        </div>
      )}
    </div>
  );
}