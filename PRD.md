# KloudAudit — Product Requirements Document

## 1. Product Summary
KloudAudit is a zero-access cloud cost and security audit SaaS. Users complete a self-assessment questionnaire about their AWS, GCP, Azure, Multi-Cloud, or AI API (OpenAI/Anthropic/Bedrock) setup and receive a free waste score plus a paid "Blueprint" — an AI-generated remediation guide with exact CLI commands and Terraform snippets. No cloud credentials are ever requested.

### Current implementation snapshot (2026-09)
- Frontend is a Vite + React SPA with a single-file main experience in `src/App.jsx` and static SEO prerendering via `scripts/prerender.js`.
- Purchase flow uses Stripe Checkout, server-side price validation, and a queue-based async delivery pipeline.
- Post-payment processing writes to `delivery_queue`, uses `report_cache` for Claude result reuse, and records real delivery state from the Resend webhook.
- The product currently ships on Vercel Hobby with the 12-function limit in mind, so new serverless functionality should be folded into existing action handlers rather than creating more API files.

## 2. Problem Statement
Engineers know their cloud bill has waste but lack time to manually audit. Enterprise FinOps tools require IAM access and months of procurement. KloudAudit answers "what's wrong and how do I fix it" in ~15 minutes with zero access granted.

## 3. Users
- **Primary:** DevOps/Cloud/Platform engineers at 11–200 person companies, self-funding a $29–$249 purchase
- **Secondary:** CTOs/Engineering managers wanting board-ready cost reporting (CFO & Board Report)
- **Tertiary:** Teams with recurring cost drift (Cloud Health Monitor subscription)

## 4. Products & Pricing (USD default, 6 currencies supported)
| Product | Price | Delivers |
|---|---|---|
| Free Cost/Security Audit | $0 | Waste score, top findings |
| Cost Blueprint | $79 | CLI/Terraform fixes, all issues |
| Security Blueprint | $29 | IAM/compliance fixes |
| AI Blueprint | $79 | Model routing, caching, spend control fixes |
| Bundle (Cost+Security) | $89 | Both blueprints |
| CFO & Board Report | $199 | Executive summary, board-ready |
| Cloud Health Monitor | $19/mo | Monthly re-scan, 1 discounted Blueprint/mo |
| 1:1 Consulting Session | $249 | 60-min live implementation |

## 5. Core User Flow
1. Select provider (AWS/GCP/Azure/Multi-Cloud/AI APIs)
2. Enter monthly bill + company name
3. Complete 12–18 checks across category sections
4. See partial report (score + top 3 findings) — email gate
5. Enter email → full free report unlocked
6. Optional: purchase Blueprint → Stripe Checkout → webhook → queue → Claude generates → Resend delivers (~2–5 min)

## 6. Non-Functional Requirements
- **Zero cloud access, ever** — this is the core trust proposition; never compromise it
- **Delivery SLA:** Blueprint in inbox within 5 minutes of payment
- **Idempotency:** duplicate Stripe webhook events must never cause duplicate charges or deliveries
- **Server-side price trust:** client-sent amounts are never trusted directly for Stripe charges
- **No fabricated content:** testimonials, logos, and activity feeds must be real or absent — never invented

## 7. Known Fragile Areas (as of Aug 2026)
- Email delivery status (`delivery_queue.status`) reflects "API accepted," not "inbox reached" — `actual_delivery_status` (via Resend webhook) is the source of truth for real delivery
- `blueprint_paid` sync depends on `sessionId` being present at checkout time — cross-device/cleared-localStorage checkouts can silently skip this without the fallback match
- Quality validation word-count minimums are tuned for multi-issue reports; low-issue-count reports may retry unnecessarily
- `src/App.jsx` is a single ~6,700-line file — high regression risk, no code splitting yet

## 8. Out of Scope (deliberately)
- Real cloud account scanning/integration (breaks the zero-access moat — never)
- Sales-led / demo-gated flows (wrong buyer psychology for this audience)
- Enterprise SSO/team accounts (revisit after $10K MRR)
