# Supabase Migrations — Manual Audit Trail

This repo does **not** use the Supabase CLI's migration runner. These `.sql`
files are not applied automatically by any tool, CI step, or deploy hook —
they exist purely as a version-controlled audit trail.

## Why

Schema and RLS changes for this project are made directly in the Supabase
dashboard's SQL editor against the live database. That means there is
normally no record of *what* changed or *why* outside of Supabase's own
dashboard history. This folder exists to fix that: a durable, reviewable
record that lives in git alongside the code that depends on it.

## Workflow

Whenever you make a schema or RLS change directly in the Supabase SQL
editor:

1. Add a new `.sql` file here named `YYYYMMDD_short_description.sql`,
   using the date the change was actually applied.
2. Include a comment at the top of the file explaining *why* the change
   was made, not just what it does — the SQL itself already shows what.
3. Still apply the change manually via the Supabase SQL editor. Adding
   the file here does not run it anywhere.

Files are ordered by filename (date-prefixed) so the history reads
chronologically, but nothing enforces that order — there's no runner
tracking "applied" vs "pending" state. Treat this folder as a changelog,
not a deployment mechanism.
