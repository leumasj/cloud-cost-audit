# KloudAudit — Architecture

## Stack
| Layer | Technology |
|---|---|
| Frontend | Vite + React (single-file `src/App.jsx`, ~6,700 lines) |
| Hosting | Vercel (Node 24.x, serverless functions, 12-function Hobby-tier ceiling) |
| Database | Supabase Postgres (RLS enabled on sensitive tables) |
| Payments | Stripe Checkout |
| AI | Anthropic Claude (claude-sonnet-4-6) |
| Email | Resend (webhook-backed delivery status and customer admin sends) |
| Error tracking | Sentry |
| Analytics | GA4 (deferred load) + Microsoft Clarity |

### Current data flow baseline
- `audits` stores questionnaire progress, unpaid/free report state, and payment flags.
- `delivery_queue` carries pending paid-report jobs; write access is service-role only.
- `report_cache` reuses identical remediation content across the same provider + flagged issue combination.
- `actual_delivery_status` from the Resend webhook is the source of truth for inbox delivery; `delivery_queue.status` only reflects queue/send acceptance.

## Request Flow: Purchase → Delivery
```
Frontend (App.jsx)
  → POST /api/create-checkout        [validates amount server-side, creates Stripe session]
  → Stripe Checkout (hosted)
  → Stripe fires checkout.session.completed
  → POST /api/webhook                [verifies signature, idempotency pre-check, inserts delivery_queue row]
  → cron (external, ~5min) hits /api/process-pending
      → claims job (status: pending → processing)
      → checks report_cache (sha256 of provider + sorted flagged IDs)
      → calls Claude if cache miss
      → validates quality (word count, truncation signals)
      → writes cache (ONLY after validation passes)
      → sends via Resend (customer + admin copy, parallel)
      → captures resend_email_id, marks delivered
  → Resend webhook (POST /api/resend-webhook)
      → verifies Svix signature
      → updates actual_delivery_status (delivered/bounced/delayed/complained)
      → alerts admin on bounce/complaint
```

## API Functions (at 12/12 Vercel Hobby limit — consolidate before adding more)
`audits.js` (multi-action: save/share/leaderboard/session/unsubscribe), `public.js`, `webhook.js`, `process-pending.js`, `create-checkout.js`, `ai-preview.js`, `email.js` (multi-action: send-report/send-reaudit), `get-benchmarks.js`, `dashboard.js`, `health.js`, `resend-webhook.js`, `api/lib/*` (not counted — shared helpers)

## Database Notes
- `delivery_queue`: RLS enabled, **zero policies** beyond service-role bypass — anon-key writes fail (42501) unless explicitly using `supabaseAdmin`. Always use the service-role client for this table.
- `audits.blueprint_paid`: set exactly one place (`process-pending.js`, post-delivery), matched via `session_id`. Falls back to email-match when `sessionId` is empty.
- No `blueprint_type` column exists — do not write to it.
- No `scheduled_for` column on `delivery_queue` — guard any reference with `job.scheduled_for &&`.
- Schema changes are **manual only** — no CLI migration runner. Record changes in `supabase/migrations/*.sql` as an audit trail; still must be run by hand in the SQL editor.

## Critical Patterns to Preserve
1. **Supabase clients initialized inside handlers, never at module scope** (Vercel cold-start staleness)
2. **Cache write happens AFTER quality validation**, never before
3. **Webhook idempotency**: pre-check SELECT on `stripe_session_id` before INSERT
4. **Cron auth fails closed**: reject when secret is unset, not only when mismatched
5. **All customer-facing HTML is escaped** before interpolation (prompt injection + XSS)
6. **Session IDs use `crypto.randomUUID()`**, not `Math.random()`

## Deployment
- Node 24.x pinned via `package.json` engines field (must match Vercel project settings)
- `npm test` (Jest) and `npm run build` (Vite + prerender, 93 SEO pages) must both pass before merge
- No `.sql` migration runner — DB changes are manual, tracked only via `supabase/migrations/` README convention
