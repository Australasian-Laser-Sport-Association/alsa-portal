# ALSA Portal — AI Assistant Context

## Project Purpose

This is the ALSA Portal: a governance and event management platform for the
Australasian Laser Sport Association. It handles ZLTAC event registration,
team management, referee testing, code of conduct forms, media release forms,
under-18 forms, a lightweight CMS for public site content, and admin tooling
for the committee.

## Domain Concepts

**Members:** Two tiers, only one currently implemented in code.
- *ALSA Portal Member* — free, gained by signing up via the portal. Lets users register for ZLTAC events, complete required forms, manage profiles, and pay event fees. Currently represented as `profiles.roles=['player']`. The /welcome page acknowledges this status.
- *ALSA Member* — paid annual membership of the incorporated association (Australasian Laser Sport Association Inc.). Confers voting rights at AGMs and other formal member privileges. Not yet implemented; ADR-0006 proposes `membership_status` and `membership_expires_at` fields on profiles to model this.

## Critical Patterns

### Supabase clients

- `src/lib/supabase.js` — anon client. Used for auth and user-scoped queries.
  Respects Row Level Security. Import this in client components.
- `src/lib/supabaseAdmin.js` — service role client. Bypasses RLS. **Server-side
  only** (Vercel API routes). Do not import from client components — the
  service role key must never be bundled into the browser.
- Any query that reads data across multiple users (committee dashboards, bulk
  admin operations) must run via `supabaseAdmin` in a server context.

### Authorisation

- A user's roles live in `public.profiles.roles` (text array). The canonical
  admin/committee roles are: `superadmin`, `alsa_committee`, `zltac_committee`,
  `advisor`. Regular users have `['player']`; captains additionally have
  `'captain'`.
- RLS policies use the `public.is_committee()` helper function to check
  admin access. Do not duplicate the role list in ad-hoc policies — if the
  set of admin roles ever changes, it changes in one place.
- Never write RLS policies that reference `auth.jwt() -> 'user_metadata'`.
  user_metadata is user-editable and checking it for authorisation is a
  privilege-escalation hole.

## Conventions

- React components: PascalCase files in `src/components/`
- Pages: PascalCase files in `src/pages/` (admin pages under `src/pages/admin/`)
- Utilities and clients: `src/lib/`
- Routes defined in `src/App.jsx`
- Admin sidebar nav defined in `src/components/AdminLayout.jsx`
- Brand tokens: `src/index.css` under `@theme` (Tailwind v4) and `:root`.
  Palette reference: `brand.md`.

## Database Migrations

- Schema changes are managed via the Supabase CLI. Migration files live in
  `supabase/migrations/` and are named `YYYYMMDDHHMMSS_short_description.sql`.
- Migrations are applied to the linked Supabase project with `supabase db push`.
- Do not edit migrations that have already been applied to production. To
  change the schema, add a new migration file.
- Do not make schema changes via the Supabase dashboard SQL editor for
  anything that should be permanent — it creates drift between the deployed
  schema and the repo. One-off investigative queries in the dashboard are
  fine.

## Rules for AI Coding Assistants

These rules exist to keep changes focused, reviewable, and to save tokens.

### Always

- **Propose before editing.** When asked to make changes, first produce a
  summary list of files and specific changes. Wait for explicit confirmation
  before applying anything.
- **Stay in scope.** Only touch files explicitly mentioned in the prompt.
  If you notice issues elsewhere, flag them separately — don't fix them
  unprompted.
- **Ask, don't guess.** If a request is ambiguous, ask one clarifying
  question rather than making assumptions and doing work that may need
  to be redone.
- **Stop before committing.** Never run `git commit` or `git push`.
  The maintainer reviews diffs and commits manually.
- **Verify, don't assume.** Before modifying a file, read the current
  version. Codebases drift from what you may have in context.

### Never

- **Don't restyle or refactor unprompted.** If asked to rebrand text,
  only change text. Don't "improve" styling, component structure,
  naming, or logic unless explicitly asked.
- **Don't touch RLS policies without being asked.** Policy changes are
  security-sensitive. Flag any concerns; let the maintainer decide.
- **Don't add dependencies without asking.** Check `package.json` for
  existing tools first. If something genuinely needs a new library,
  propose it and wait for approval.
- **Don't write tests unprompted.** Ask first.
- **Don't "do everything"** when a prompt is open-ended. Request
  clarification on exact scope.

### Efficient working

- **Read once, edit precisely.** Don't re-read large files repeatedly
  in one session.
- **Batch related edits.** When doing a multi-file change, plan all
  edits upfront and apply in one pass.
- **Show diffs, not full file rewrites.** Only output the changed
  section with enough context to locate it.
- **Skip recaps unless asked.** Don't repeat what was just done at the
  end of every response.
- **Don't narrate.** Skip "Let me think about this" / "I'll now edit X"
  preamble. Just do it.

### Critical codebase patterns

- Cross-user Supabase queries must use `supabaseAdmin` (service role)
  in server-side code (Vercel API routes under `/api/`). The anon client
  will return empty results for queries that cross user boundaries.
- Routes are defined in `src/App.jsx`. Adding a page requires adding
  both the import and the `<Route>` entry.
- Admin sidebar nav lives in `src/components/AdminLayout.jsx`.
- Any new table requires an RLS policy. Use `public.is_committee()` for
  admin access checks — do not duplicate role arrays.

## Scope and Ownership

This is the ALSA organisational portal. Tournament scheduling and bracket
generation are out of scope for this portal.

## Brand

Palette and logo references live in `brand.md`. Primary accent is
`--brand-green: #00FF41` on dark backgrounds (`--brand-black: #0F0F0F`).
