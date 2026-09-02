# Architecture Essentials — Read This First

The 10 things that have caused real production bugs. Check every one of these before touching payment, delivery, or database code.

1. **`delivery_queue` table requires the service-role Supabase client for ALL writes.** RLS is enabled with zero anon-accessible policies. Using the anon-key client here fails silently or throws 42501.

2. **Supabase clients must be created inside the handler function, not at module top level.** Vercel serverless cold-starts cause stale/broken clients otherwise.

3. **The report cache write must happen AFTER quality validation passes, never before.** A bad Claude response cached early gets served to every future customer with the same flagged-issue combination.

4. **`audits.blueprint_paid` is set in exactly one place**, after successful delivery in `process-pending.js`, matched by `session_id`. If the frontend's session ID was empty/stale at checkout time, this silently skips — there's an email-based fallback match for this case. Don't assume payment = paid flag set; verify.

5. **There is no `blueprint_type` column and no `scheduled_for` column on `delivery_queue`.** Both have been mistakenly referenced before and thrown errors. Check `information_schema.columns` before assuming a column exists.

6. **Cron/internal endpoints must reject when the auth secret is UNSET, not only when it mismatches.** `if (!secret || header !== secret)`, never `if (secret && header !== secret)`.

7. **Never trust a client-sent charge amount.** `create-checkout.js` must validate against server-side price floors before passing anything to Stripe's `unit_amount`.

8. **Webhook handler needs an idempotency pre-check** (SELECT before INSERT on `stripe_session_id`) — Stripe retries webhooks, and without this, customers get duplicate deliveries.

9. **`delivery_queue.status = 'delivered'` means Resend accepted the send, not that it reached an inbox.** Real delivery status lives in `actual_delivery_status`, populated by the Resend webhook (`/api/resend-webhook`). Check both when investigating "customer says they didn't get their email."

10. **Never add fabricated testimonials, fake customer logos, or fake "real-time" activity data.** This has been explicitly removed once already. Zero real testimonials is an honest, acceptable state — invented ones are not.

## Current repo baseline (as of 2026-09-02)
- Vercel Hobby usage remains capped at 12 serverless functions; route new logic into existing multi-action handlers instead of adding more files.
- `delivery_queue` and `report_cache` are the key delivery-state tables; do not assume other columns exist without checking `information_schema.columns`.
- Resend is the active email provider, with `actual_delivery_status` populated by the Resend webhook and checked before declaring a customer email as received.
