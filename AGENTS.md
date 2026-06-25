# ALSA Portal - AI Contributor Guide

## Project Purpose

This is the ALSA Portal: a governance and event management platform for the
Australasian Laser Sport Association. It handles ZLTAC event registration,
team management, referee testing, required legal documents, under-18 approvals,
ALSA membership records, public document/media delivery, and admin tooling for
the committee.

## Domain Concepts

**Members:** The portal separates an account from formal ALSA membership.

- *Portal account holder* - a person who can sign in, manage their profile,
  register for events, complete required documents, and pay event fees. Regular
  users usually have `profiles.roles=['player']`.
- *ALSA annual member* - a person granted membership for an active membership
  period in `alsa_memberships`.
- *ALSA lifetime member* - an honorary public status stored separately in
  `alsa_lifetime_members`.

## Critical Patterns

### Supabase Clients

- `src/lib/supabase.js` - anon client. Used for auth and user-scoped queries.
  Respects Row Level Security. Import this in client components.
- `api/_lib/supabase.js` - service-role client. Bypasses RLS. Server-side only
  in Vercel API routes. Do not import it from client components; the service
  role key must never be bundled into the browser.
- Any query that crosses user boundaries, including committee dashboards, bulk
  admin operations, backup/admin exports, and privileged profile lookups, must
  run through a server API route using the service-role client. The anon client
  will return empty results or hit RLS boundaries for cross-user reads.

### Authorisation

- A user's roles live in `public.profiles.roles` as a text array. The canonical
  admin/committee roles are `superadmin`, `alsa_committee`, `zltac_committee`,
  and `advisor`. Regular users have `['player']`; captains additionally have
  `'captain'`.
- Committee membership is driven entirely off `profiles.roles`. Do not add
  parallel boolean columns such as `is_alsa_committee` or `is_zltac_committee`;
  they would duplicate the roles array and create drift risk.
- `advisor` has committee access but is intentionally excluded from public
  committee rosters. Keep advisor in the committee role set and out of public
  roster queries unless the product decision changes.
- RLS policies use the `public.is_committee()` helper function to check admin
  access. Do not duplicate the role list in ad-hoc policies; if the set of
  admin roles ever changes, it changes in one place.
- Never write RLS policies that reference `auth.jwt() -> 'user_metadata'`.
  `user_metadata` is user-editable and checking it for authorisation is a
  privilege-escalation hole.
- Committee/admin writes go through service-role API routes under `/api/`.
  Authorisation is enforced in route helpers with role and account-status
  checks; RLS is defence-in-depth, not the only gate.

### Data Conventions

- Monetary values are integer cents in storage, logic, and API transport.
  Convert to dollars only for display.
- Public files and uploaded media should be served through branded public asset
  paths, not raw Supabase storage URLs.
- Avoid em dashes and en dashes in user-facing copy. Use hyphens or rephrase.
  Code comments, documentation, and numeric ranges may use normal punctuation
  when it improves clarity.

## Code Conventions

- React components: PascalCase files in `src/components/`.
- Pages: PascalCase files in `src/pages/`, with admin pages under
  `src/pages/admin/`.
- Utilities and browser clients: `src/lib/`.
- Server API helpers: `api/_lib/`.
- Routes are defined in `src/App.jsx`; adding a page requires both the import
  and the `<Route>` entry.
- Admin sidebar nav lives in `src/components/AdminLayout.jsx`.
- Brand tokens live in `src/index.css` under `@theme` and `:root`. Palette
  reference: `brand.md`.

## Database Migrations

- Schema changes are managed with committed migration files in
  `supabase/migrations/`, named `YYYYMMDDHHMMSS_short_description.sql`.
- Production and Preview use separate Supabase projects. Vercel Production
  scope must point at production Supabase; Vercel Preview scope must point at
  staging Supabase. The split applies to `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.
- Never put the production `SUPABASE_SERVICE_ROLE_KEY` in the Vercel Preview
  scope.
- The local Supabase CLI may be linked to staging during normal development.
  Before any production migration-history command or production database
  command, explicitly verify the linked project/ref.
- Production migrations are applied deliberately by the maintainer. High-risk
  production rollouts may be applied manually in the Supabase SQL Editor so
  each migration can be verified before continuing.
- When a migration is applied outside `supabase db push`, reconcile migration
  history immediately with `supabase migration repair` and verify with
  `supabase migration list`.
- Do not run commands that mutate the production database unless the maintainer
  explicitly asks you to do that exact operation. It is fine to author migration
  files and run read-only inventory/dry-run commands.
- Migrations must precede any code that depends on them. When a schema change
  and its consumers ship together, apply the migration first, then deploy.
- Do not edit migrations that have already been applied to production. To
  change the schema, add a new migration file.
- New tables need explicit `GRANT`s in addition to RLS policies. Postgres
  privileges and RLS are both enforced, so a permissive policy still fails
  without the right grant.
- Do not make dashboard-only schema changes. Any permanent schema change must
  have a committed migration file, even if production execution happens through
  the SQL Editor during a controlled rollout.

## Rules for AI Coding Assistants

These rules keep changes focused, reviewable, and safe.

### Always

- **Match the requested workflow.** For broad, ambiguous, security-sensitive, or
  destructive changes, propose the file list and wait for confirmation. For
  explicit fixes, make focused edits and verify them.
- **Stay in scope.** Keep edits tied to the request. If you notice unrelated
  issues, flag them separately.
- **Ask when guessing would be risky.** Prefer one clear clarifying question
  over work that may need to be undone.
- **Stop before publishing.** Do not push, deploy, force-push, merge, or apply
  production migrations without an explicit maintainer go-ahead. Commits are
  acceptable only when requested.
- **Verify, don't assume.** Before modifying a file, read the current version.
  Codebases drift from what may be in context.
- **Protect secrets.** Do not print real `.env` values, API keys, tokens, or
  private user data. Inspect sensitive files only when the task explicitly
  requires it, and report findings without exposing secret values.

### Never

- **Do not restyle or refactor unprompted.** If asked to change text, only
  change text. Avoid structural changes unless they are needed for the request.
- **Do not touch RLS policies casually.** Policy and grant changes are
  security-sensitive. Flag concerns and make changes only as part of an
  explicit security/database task.
- **Do not add dependencies without justification.** Check `package.json` for
  existing tools first. If a new library is genuinely needed, explain why.
- **Do not do everything from an open-ended prompt.** Clarify scope when the
  request could reasonably mean several different things.

### Efficient Working

- Read once, edit precisely.
- Batch related edits.
- Show focused diffs rather than full rewrites unless a full-file replacement
  is genuinely clearer.
- Keep recaps short and mention verification results.
- Scale tests to risk. Add or update tests for security, shared behavior, data
  integrity, and user-facing workflows; keep them focused.

## Scope and Ownership

This is the ALSA organisational portal. Tournament scheduling and bracket
generation are out of scope for this portal.

## Brand

Palette and logo references live in `brand.md`. Primary accent is
`--brand-green: #00FF41` on dark backgrounds (`--brand-black: #0F0F0F`).
