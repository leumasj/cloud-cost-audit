# CLAUDE.md

Project-specific context for Claude Code sessions in this repository. Read `ARCHITECTURE_ESSENTIALS.md` and `AGENTS.md` first — this file adds Claude-specific working notes.

## Project
KloudAudit — zero-access cloud cost/security/AI-spend audit SaaS. React frontend (`src/App.jsx`), Vercel serverless API (`api/*.js`), Supabase Postgres, Stripe, Claude (Anthropic API) for report generation, Resend for email.

## Commands
```bash
npm test              # Jest, must pass before any commit
npm run build          # Vite build + prerender (93 SEO pages) — must succeed
node --check <file>     # Quick syntax check for a single API file
```

## Where Things Live
- `src/App.jsx` — the entire frontend. ~6,700 lines, no code splitting yet. Search before assuming a section doesn't exist; most "missing" features turn out to already be built somewhere in this file.
- `api/*.js` — one file per serverless function, at the 12-function Vercel Hobby ceiling. Multi-action files (`audits.js`, `email.js`) route via `?action=` query param — extend these rather than creating new files when possible.
- `api/lib/_*.js` — shared helpers (config, logger, sentry, validation, scoring, ratelimit) — excluded from the function count.
- `scripts/prerender.js` — generates the 93 static SEO pages at build time, including JSON-LD schema. Update this alongside any change to supported providers/products, since schema here has drifted from the live product before.
- `supabase/migrations/` — manual audit trail only, not auto-applied. Always tell the user to run any `.sql` file by hand.

## Known-Fragile Files (extra care required)
- `api/process-pending.js` — the delivery pipeline. Touches Claude generation, quality validation, caching, and Resend sends. Most production incidents this project has had trace back to this file.
- `api/webhook.js` — Stripe webhook handler. Must remain idempotent; must use service-role Supabase client.
- `api/create-checkout.js` — must never trust client-sent price/amount without server-side validation.

## Investigation Discipline
This project has a strong track record when bugs are investigated with real evidence (SQL queries against live data, actual screenshots, real end-to-end test transactions) before a fix is written, and a poor track record when fixes are guessed from a description alone. Default to investigate-first. If a user reports something "not working," ask for or run a concrete check (query, screenshot, curl) before proposing a change.

## Common Recurring Mistakes in This Codebase (already fixed once, don't reintroduce)
- Assuming a database column exists without checking `information_schema.columns`
- Writing to `delivery_queue` with the anon-key client instead of service-role
- Reading `delivery_queue.status` as proof of actual email delivery (it isn't — check `actual_delivery_status`)
- Adding a new provider/product to one UI location without searching for and updating every other mention (pricing cards, footer, FAQ, meta tags, JSON-LD schema, verify-command mappings) — this has caused multiple incomplete-rollout bugs
- Module-level Supabase/Resend client initialization in `api/*.js` files
