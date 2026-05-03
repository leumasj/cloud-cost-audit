// public/widget.js
// KloudAudit Embeddable Savings Widget
//
// Usage: <script src="https://www.kloudaudit.eu/widget.js"></script>
// Place <div id="kloudaudit-widget"></div> anywhere on the page.
//
// Fully self-contained — no dependencies, no React, no external CSS.
// Works in any HTML page. Shadow DOM isolates styles from host page.

(function () {
  'use strict';

  const PROVIDERS = ['AWS', 'GCP', 'Azure'];
  const RANGES = [
    { label: 'Under $1K/mo',   value: 500,   min: 0.10, max: 0.20 },
    { label: '$1K – $5K/mo',   value: 2500,  min: 0.15, max: 0.30 },
    { label: '$5K – $20K/mo',  value: 10000, min: 0.18, max: 0.35 },
    { label: '$20K – $50K/mo', value: 35000, min: 0.20, max: 0.40 },
    { label: '$50K+/mo',       value: 75000, min: 0.22, max: 0.45 },
  ];

  const CSS = `
    :host { display: block; font-family: system-ui, -apple-system, sans-serif; }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .widget {
      background: linear-gradient(145deg, #0a0a14, #0f0f1e);
      border: 1px solid rgba(0,255,180,0.2);
      border-radius: 16px;
      padding: 28px;
      max-width: 480px;
      color: #fff;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,255,180,0.05);
    }

    .header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 20px;
    }
    .logo {
      width: 30px; height: 30px;
      background: #00ffb4;
      border-radius: 7px;
      display: flex; align-items: center; justify-content: center;
      font-size: 15px; flex-shrink: 0;
    }
    .title {
      font-size: 15px; font-weight: 800;
      color: #fff; letter-spacing: -0.3px;
    }
    .subtitle {
      font-size: 11px; color: #475569;
      font-weight: 500;
    }

    .label {
      font-size: 11px; font-weight: 700;
      color: #64748b; text-transform: uppercase;
      letter-spacing: 1px; margin-bottom: 8px;
    }

    .section { margin-bottom: 18px; }

    .pills {
      display: flex; gap: 6px; flex-wrap: wrap;
    }
    .pill {
      padding: 6px 14px;
      border-radius: 20px;
      border: 1.5px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.03);
      color: #94a3b8;
      font-size: 12px; font-weight: 600;
      cursor: pointer;
      transition: all 0.18s;
    }
    .pill:hover { border-color: rgba(0,255,180,0.4); color: #fff; }
    .pill.active {
      border-color: #00ffb4;
      background: rgba(0,255,180,0.1);
      color: #00ffb4;
    }

    .result {
      background: rgba(0,255,180,0.06);
      border: 1.5px solid rgba(0,255,180,0.2);
      border-radius: 12px;
      padding: 18px 20px;
      margin-bottom: 16px;
      text-align: center;
      transition: all 0.3s;
    }
    .result-label {
      font-size: 11px; font-weight: 700;
      color: #00ffb4; letter-spacing: 1.5px;
      text-transform: uppercase; margin-bottom: 8px;
    }
    .result-amount {
      font-size: 36px; font-weight: 800;
      color: #00ffb4; letter-spacing: -2px;
      line-height: 1; margin-bottom: 4px;
    }
    .result-sub {
      font-size: 12px; color: #64748b;
    }

    .cta {
      display: block; width: 100%;
      padding: 13px;
      background: #00ffb4;
      color: #000;
      border: none; border-radius: 10px;
      font-size: 14px; font-weight: 800;
      cursor: pointer;
      text-decoration: none;
      text-align: center;
      letter-spacing: -0.2px;
      transition: all 0.18s;
      box-shadow: 0 4px 20px rgba(0,255,180,0.3);
    }
    .cta:hover {
      background: #00e6a0;
      box-shadow: 0 6px 28px rgba(0,255,180,0.45);
      transform: translateY(-1px);
    }

    .footer {
      margin-top: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .powered {
      font-size: 10px; color: #1e293b;
    }
    .powered a {
      color: #334155; text-decoration: none; font-weight: 600;
    }
    .powered a:hover { color: #00ffb4; }
    .trust {
      font-size: 10px; color: #1e293b;
    }

    @keyframes pop {
      0%   { transform: scale(0.95); opacity: 0.7; }
      60%  { transform: scale(1.02); }
      100% { transform: scale(1);    opacity: 1; }
    }
    .pop { animation: pop 0.25s cubic-bezier(0.34,1.56,0.64,1); }
  `;

  function fmt(n) {
    if (n >= 1000) return '$' + (n / 1000).toFixed(0) + 'K';
    return '$' + Math.round(n).toLocaleString();
  }

  function createWidget(container) {
    // Shadow DOM — fully isolated from host page styles
    const shadow = container.attachShadow({ mode: 'open' });

    let selectedProvider = 'AWS';
    let selectedRange    = RANGES[1]; // default $1K-$5K

    function calc() {
      const min = Math.round(selectedRange.value * selectedRange.min);
      const max = Math.round(selectedRange.value * selectedRange.max);
      return { min, max, annual: max * 12 };
    }

    function render() {
      const { min, max, annual } = calc();

      shadow.innerHTML = `
        <style>${CSS}</style>
        <div class="widget">
          <div class="header">
            <div class="logo">⚡</div>
            <div>
              <div class="title">Cloud Savings Estimator</div>
              <div class="subtitle">How much is your cloud bill hiding?</div>
            </div>
          </div>

          <div class="section">
            <div class="label">Cloud Provider</div>
            <div class="pills" id="providers">
              ${PROVIDERS.map(p => `
                <button class="pill ${p === selectedProvider ? 'active' : ''}" data-provider="${p}">${p}</button>
              `).join('')}
            </div>
          </div>

          <div class="section">
            <div class="label">Monthly Cloud Spend</div>
            <div class="pills" id="ranges">
              ${RANGES.map((r, i) => `
                <button class="pill ${r === selectedRange ? 'active' : ''}" data-range="${i}">${r.label}</button>
              `).join('')}
            </div>
          </div>

          <div class="result" id="result">
            <div class="result-label">Estimated Monthly Waste</div>
            <div class="result-amount" id="amount">${fmt(min)}–${fmt(max)}</div>
            <div class="result-sub">
              ${fmt(annual)}+ per year · typical ${selectedProvider} infrastructure
            </div>
          </div>

          <a class="cta" href="https://www.kloudaudit.eu?utm_source=widget&utm_medium=embed&utm_campaign=${selectedProvider.toLowerCase()}" target="_blank" rel="noopener">
            Find My Exact Savings — Free →
          </a>

          <div class="footer">
            <div class="powered">Powered by <a href="https://www.kloudaudit.eu?utm_source=widget&utm_medium=embed" target="_blank" rel="noopener">KloudAudit.eu</a></div>
            <div class="trust">🔒 No account access required</div>
          </div>
        </div>
      `;

      // Bind events
      shadow.querySelectorAll('[data-provider]').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedProvider = btn.dataset.provider;
          render();
        });
      });

      shadow.querySelectorAll('[data-range]').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedRange = RANGES[parseInt(btn.dataset.range)];
          const result = shadow.getElementById('result');
          if (result) result.classList.remove('pop');
          setTimeout(() => {
            render();
            const newResult = shadow.getElementById('result');
            if (newResult) newResult.classList.add('pop');
          }, 10);
        });
      });
    }

    render();
  }

  // ── Auto-mount ────────────────────────────────────────────────────────────
  function mount() {
    const containers = document.querySelectorAll(
      '#kloudaudit-widget, .kloudaudit-widget, [data-kloudaudit-widget]'
    );
    containers.forEach(el => {
      if (!el.shadowRoot) createWidget(el);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  // Expose API for dynamic use
  window.KloudAudit = { mount };
})();
