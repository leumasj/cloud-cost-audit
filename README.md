# KloudAudit — Free Cloud Cost & Security Audit

**Find 20–45% cloud waste in 15 minutes. No AWS credentials. No procurement. No agents.**

Live at **[kloudaudit.eu](https://www.kloudaudit.eu)**

---

## What it does

KloudAudit is a self-assessment SaaS for engineering teams. Engineers answer 18 structured questions about their AWS, GCP, Azure, or multi-cloud infrastructure and receive:

- **Waste Score** (0–100) with letter grade A+ through F
- **Savings estimate** anchored to their actual monthly bill
- **Prioritised findings** sorted by ease of implementation — quick wins first
- **AI Blueprint** with exact CLI commands, Terraform snippets, and a 30-day roadmap ($79)
- **CFO Team Report** — executive summary formatted for board/finance ($199)

Zero cloud credentials required at every step.

---

## Products

| Product | Price | Who it's for |
|---|---|---|
| Cost Audit | Free | Any engineer |
| Security Audit | Free | Any engineer |
| Cost Blueprint | $79 | DevOps / Infrastructure engineers |
| Security Blueprint | $29 | Security engineers |
| Bundle | $89 | Both blueprints |
| CFO Team Report | $199 | CTOs / Finance teams |
| 1:1 Session | $249 | Teams needing hands-on implementation |

Prices are geo-detected — PLN for Poland, USD default, GBP/EUR/CAD/AUD for other regions.

---

## Stack

- **Frontend:** Vite + React — SPA with 8 steps, session persistence, URL hash routing
- **Hosting:** Vercel serverless (12 functions)
- **Payments:** Stripe Checkout — 5 product types, 6 currencies
- **AI:** Anthropic Claude Sonnet 4.6 — server-side only
- **Email:** SendGrid — DKIM authenticated (em7391.kloudaudit.eu)
- **Database:** Supabase (Postgres) — RLS enabled
- **Validation:** Zod schemas on all API inputs
- **Error tracking:** Sentry
- **Analytics:** GA4 with full funnel custom events
- **Monitoring:** UptimeRobot — /api/health every 5 minutes

---

## Architecture

```
Frontend (React SPA)
    ↓ user completes audit
api/audits.js          — save audit, score calculation, rate limiting (Supabase-backed)
    ↓ user pays
api/create-checkout.js — Stripe session creation (5 product types, 6 currencies)
    ↓ payment webhook
api/webhook.js         — verify signature, queue delivery job, return 200
    ↓ cron fires
api/process-pending.js — atomic claim, Claude AI generation, SendGrid delivery
```

### API Functions (12/12 Vercel Hobby limit)

| Function | Method | Purpose |
|---|---|---|
| audits.js | POST | Save audit · share · leaderboard · scoring |
| public.js | GET | Public audit view + leaderboard |
| webhook.js | POST | Stripe event handling |
| process-pending.js | GET | Blueprint/CFO Report delivery cron |
| create-checkout.js | POST | Stripe session creation |
| ai-preview.js | POST | Rate-limited AI preview |
| send-report.js | POST | Free audit report email |
| send-reaudit.js | GET | 90-day re-audit reminders |
| get-benchmarks.js | GET | Aggregated audit statistics |
| dashboard.js | GET | Admin analytics |
| unsubscribe.js | GET | GDPR one-click unsubscribe |
| health.js | GET | Uptime check |

### Shared Library (api/lib/ — excluded from function count)

| File | Purpose |
|---|---|
| _config.js | ALLOWED_ORIGINS, env validation |
| _logger.js | Structured JSON logging |
| _sentry.js | Sentry init with graceful fallback |
| _validation.js | Zod schemas — all API inputs |
| _scoring.js | Waste score, letter grade, savings cap |
| _ratelimit.js | Supabase-backed per-IP rate limiting |

---

## Environment Variables

```bash
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_CFO_REPORT_PRICE_ID=          # price_1TcpMr4UtZkJQGHbFe7N2Elu (USD)
ANTHROPIC_API_KEY=
SENDGRID_API_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
SENTRY_DSN=                           # optional — degrades gracefully
NEXT_PUBLIC_URL=https://www.kloudaudit.eu
```

---

## Local Development

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Build + prerender 77 SEO pages
npm run build

# Run tests
npm test
```

---

## Testing

```bash
npm test
# 13 tests across 2 suites — payment path, webhook handling
# All mocked — no real Stripe or Supabase calls
```

Test a live checkout (no charge):
```bash
curl -X POST https://www.kloudaudit.eu/api/create-checkout \
  -H "Content-Type: application/json" \
  -H "Origin: https://www.kloudaudit.eu" \
  -d '{"productType":"blueprint","email":"test@test.com","currency":"usd","amount":7900,"provider":"AWS","flaggedCount":5}'
```

---

## SEO

77 pre-rendered static pages covering:
- 15 AWS cost guides
- 10 GCP cost guides  
- 10 Azure cost guides
- 5 multi-cloud guides
- 10 security guides
- 20 problem-specific pages (engineer search intent — CLI commands)
- 4 comparison pages (vs AWS Cost Explorer, CloudHealth, Infracost)
- 3 blog posts

All pages have TechArticle JSON-LD schema, canonical tags, and optimised meta descriptions. Homepage has FAQPage and HowTo schema.

---

## Performance (May 2026)

| Metric | Score |
|---|---|
| Mobile Performance | 89 |
| Desktop Performance | 92+ |
| Accessibility | 96 |
| Best Practices | 100 |
| SEO | 100 |

---

## Related

- [aws-bill-analyzer](https://github.com/leumasj/aws-bill-analyzer) — zero-dependency Python script to analyse AWS Cost Explorer CSV exports

---

## Author

**Samuel Ayodele Adomeh** — Senior DevOps Engineer · Azure Solutions Architect  
Wrocław, Poland · [linkedin.com/in/samuel-ayodele-adomeh](https://www.linkedin.com/in/samuel-ayodele-adomeh)  
admin@kloudaudit.eu · [kloudaudit.eu](https://www.kloudaudit.eu)