# Changelog

All notable changes to KloudAudit are documented here. Format: date, category, one-line description, and root cause if it was a bug fix (not just what changed, but why it happened).

## 2026-09-02

### Added
- Added the core project documentation baseline for product requirements, architecture, operational safeguards, and AI-agent working rules.

### Changed
- Synced the documentation with the live implementation: Stripe Checkout + webhook-driven delivery, Supabase queueing, Resend delivery-status handling, and the 12-function Vercel Hobby architecture.

### Fixed
- Documentation drift: removed outdated assumptions about customer delivery tracking and clarified the enforced safeguards around service-role writes, webhook idempotency, and zero-access product design.

### Security
- Confirmed the repository-level guardrails: zero cloud access, server-side price validation, no client-trusted payment amounts, and no fabricated customer activity data.

---

<!-- New entries go above this line, most recent first -->
