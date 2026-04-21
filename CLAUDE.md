# ALSA Portal — AI Assistant Context

## Project Purpose

This is the ALSA Portal: a governance and event management platform for the Australasian Laser Sport Association. It handles ZLTAC event registration, team management, finals administration, referee testing, code of conduct forms, and admin tooling for the committee.

## Critical Patterns

**Supabase client usage:**
- `src/lib/supabase.js` — anon client, used for auth and user-scoped queries (respects RLS)
- `src/lib/supabaseAdmin.js` — service role client, used for all cross-user queries that need to bypass RLS (e.g. admin reads of other users' registrations, team lookups, bulk operations)
- Any query that reads data across multiple users MUST use `supabaseAdmin`, not `supabase`

## Conventions

- React components: PascalCase files in `src/components/`
- Pages: PascalCase files in `src/pages/` (admin pages under `src/pages/admin/`)
- Utilities and clients: `src/lib/`
- Routes defined in `src/App.jsx`
- Admin sidebar nav defined in `src/components/AdminLayout.jsx`

## Do NOT Touch

- Supabase table names or column names
- RLS policies (managed in Supabase dashboard)
- Environment variables (do not rename or add without team discussion)
- `supabase/` directory contents

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
- **Don't touch Supabase schema, RLS policies, or env vars.** These
  are managed separately and changes here break deployed environments.
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

### Critical patterns in this codebase

- Cross-user Supabase queries MUST use `supabaseAdmin` (service role client)
  from `src/lib/supabaseAdmin.js` to bypass RLS. Regular `supabase` client
  will return empty results for queries that cross user boundaries.
- Routes are defined in `src/App.jsx`. Adding a page requires adding
  both the import and the `<Route>` entry.
- Admin sidebar nav lives in `src/components/AdminLayout.jsx`.

## Scope and Ownership

- This is the ALSA organisational portal. Tournament scheduling algorithms
  (cascade generators, round robin, finals brackets) live in a separate
  project owned personally by Adam Crouch and are not part of this repo.
- If schedule generation features are requested in the future, the committee
  should discuss whether to license or integrate the external tool, rather
  than rebuilding here.

## Brand

Palette and logo references live in `brand.md`. Primary accent is `--brand-green: #00FF41` on dark backgrounds.
