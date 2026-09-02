# AGENTS.md

Instructions for any AI coding agent (Claude Code, Cursor, Copilot, etc.) working in this repository.

## Before You Start
Read `ARCHITECTURE_ESSENTIALS.md` in full. It documents 10 specific bugs that have already happened in production and cost real money or customer trust. Do not reintroduce any of them.

## Required Workflow
1. **Investigate before fixing.** When asked to fix a bug, verify the actual behavior first — read the real code, check real database state via SQL, or request a screenshot/log rather than assuming from a description. Several past incidents in this project were caused by fixing a guessed cause instead of the confirmed one.
2. **Never guess database schema.** Run `SELECT column_name FROM information_schema.columns WHERE table_name = '<table>'` before writing any query or migration referencing a column you haven't directly confirmed exists in this session.
3. **Test after every change.** Run `npm test` and `npm run build` before reporting a fix as complete. A passing build does not guarantee a working page — for UI changes, request or take a screenshot at both desktop and mobile (390×844) viewports before declaring done.
4. **Flag deviations honestly.** If an instruction's literal code would break something else you can see (e.g., overwrite a query param a later effect depends on), do not silently comply — implement the safe version and explain the deviation.
5. **Database/schema changes are manual only.** This project has no CLI migration runner. Write a `.sql` file to `supabase/migrations/` as an audit-trail record, but state clearly that it still must be run by hand in the Supabase SQL editor — do not claim a schema change is "done" just because the file was committed.
6. **Commit atomically.** One logical fix per commit, with a message describing the actual root cause, not just the symptom.

## Non-Negotiable Constraints
- **Never** add code that grants or requests real cloud account access (IAM keys, OAuth to AWS/GCP/Azure). Zero-access is the core product differentiator.
- **Never** fabricate customer testimonials, logos, or activity/usage data. Real or absent, never invented.
- **Never** trust client-supplied payment amounts directly — always validate server-side against a price floor before any Stripe call.
- **Never** initialize a Supabase client at module scope in an `api/*.js` file — always inside the handler.
- **Never** write to the anon-key Supabase client for `delivery_queue` — service-role only.

## When You Find a Bug While Working on Something Else
Report it. Do not silently fix unrelated issues without flagging them first, but do not ignore them either — a past session found a live pricing-manipulation bug and a silent payment-delivery failure this way. Small "unrelated" observations have repeatedly turned out to be the most important finding in the task.

## Verification Standard
"The build succeeded" is not sufficient proof a fix works, if the fix touches:
- Payment/checkout logic → verify with a real or test-mode Stripe transaction end to end
- Delivery pipeline → verify with a real `delivery_queue` insert + cron run + database check
- UI rendering → verify with an actual screenshot, not just a source-code read
