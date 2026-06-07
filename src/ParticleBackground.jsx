import { useState, useEffect } from "react";

export default function ParticleBackground() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const init = () => {
      setReady(true);
    };

    if ("requestIdleCallback" in window) {
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
