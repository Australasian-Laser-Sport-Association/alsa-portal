# ALSA Portal — Full Stack Audit Brief

**Purpose:** Pre-committee, peer-review-ready audit of the ALSA Portal codebase, database, infrastructure, and operational posture. Designed for execution by Claude Code in scoped passes, with findings to be human-verified before any remediation.

**Stack under review**
- Frontend: Vite + React SPA, Tailwind (custom tokens), deployed to Vercel (`syd1`)
- Backend: Supabase (PostgreSQL + RLS + Auth), project ID `atwutsywnlnzqkqudxdv`, region `ap-southeast-2`
- Serverless: Vercel functions pinned to `syd1`
- Payments: manual reconciliation only — no gateway, no PCI scope

---

## How to run this audit

Do **not** paste this whole brief into one Claude Code session. Run it as **six scoped passes**, in this order. Each pass gets its own session, its own report file, and its own commit-and-review cycle before the next begins.

1. Security & authorization
2. Database & data integrity
3. Code quality & maintainability
4. Performance
5. Accessibility & UX correctness
6. DevOps, observability, documentation

For each pass, give Claude Code this exact instruction up front:

> **Audit mode.** Read-only. No code changes, no fixes, no migrations. No `git` operations. Verify every claim by reading the actual file or running the actual query — do not infer from naming. Output a single findings report at `audits/<pass-name>-YYYY-MM-DD.md` in the format defined in `AUDIT_BRIEF.md`. If a check is inconclusive, say so — do not guess.

Then paste the relevant pass section below.

---

## Severity scale (use these exact labels)

- **Critical** — exploitable now, data loss, privilege escalation, or money/reputation at stake. Fix before next deploy.
- **High** — real risk under normal use, or violates a stated invariant. Fix this sprint.
- **Medium** — wrong but contained, or only triggers under unusual input. Fix before committee review.
- **Low** — code smell, inconsistency, minor UX bug. Backlog.
- **Info** — observation, not a defect. Useful context.

Every finding must include: **severity, location (file:line or table.column), evidence (quote the code/query), impact (what breaks), recommendation (what to do).** No finding without evidence.

---

## Report format (every pass uses this)

```markdown
# <Pass name> audit — YYYY-MM-DD

## Summary
- Critical: N
- High: N
- Medium: N
- Low: N
- Info: N

## Findings

### [SEVERITY] Short title
**Location:** `path/to/file.jsx:42` or `public.zltac_registrations`
**Evidence:**
\`\`\`
<exact code or query>
\`\`\`
**Impact:** What an attacker / a buggy state / a real user experiences.
**Recommendation:** Concrete fix, not "consider improving".
**Verification needed:** Anything Claude Code couldn't confirm without running it.

---
```

End every report with a **Coverage gaps** section: list everything the audit could not check (e.g. "did not verify storage bucket policies because no buckets were enumerated").

---

# Pass 1 — Security & authorization

## 1.1 Supabase RLS (highest priority)

For **every** table in the `public` schema:

1. Confirm RLS is **enabled**. List any table where it is not.
2. List every policy attached (`SELECT`, `INSERT`, `UPDATE`, `DELETE`).
3. For each policy, evaluate it against these threat models:
   - Anonymous user reads/writes data they shouldn't see
   - Authenticated player reads/writes another player's data
   - Authenticated player escalates to committee/admin role
   - Committee member edits superadmin records
   - Service role key accidentally exposed in frontend
4. Identify any policy that uses `auth.uid()` without checking the join path back to the user (a common gap).
5. Identify any policy using `USING (true)` or no `WITH CHECK` on writes.
6. Flag any table without an `INSERT`/`UPDATE`/`DELETE` policy that nonetheless receives writes from client code (search `src/` for writes to that table).

## 1.2 Authorization (role logic)

- Locate the role/permission resolution code (player / committee / superadmin).
- Trace **every** admin-only route and admin-only mutation. For each, confirm the check happens **server-side** (RLS or function), not just in the React component.
- Flag any admin action that is only gated by hiding a button.
- Confirm the known committee-can-suspend-superadmin bug is still present and document it as a finding.
- Look for the self-reset / self-suspend gaps noted as Phase 2D deferred items and confirm their current status.

## 1.3 Auth & session

- How is the Supabase session stored? (localStorage / cookies / both)
- Is there any token logged to console or sent to a third party?
- Password reset / email change flows: any open redirect, any token replay risk?
- Account deletion: confirm whether `supabase.auth.admin.deleteUser` is actually called or whether the user row is just soft-deleted.

## 1.4 Payment system

This is the highest business-risk surface even without a gateway. Check:

- Can a non-admin write to `payment_records`?
- Can a player modify their own `amount_owing` or `payment_reference`?
- Is the reference-generation trigger marked `SECURITY DEFINER`? If so, is it safe (no dynamic SQL with user input)?
- Race condition: can two simultaneous registrations produce the same `payment_reference`? Inspect the collision-suffix logic.
- Can `amount_owing` go negative? Is there a `CHECK` constraint?
- Can a registration be marked paid by anyone other than an admin? Trace the write path.
- Audit log: is there a record of *who* recorded a payment and *when*? Can it be edited or deleted after the fact?
- Bank details on `zltac_events`: who can read them, who can edit them?

## 1.5 Frontend security

- Search for `dangerouslySetInnerHTML`. For each hit, confirm the input is trusted/sanitized.
- Search for `eval`, `new Function`, `innerHTML =`. Flag every hit.
- Search for hardcoded keys, tokens, URLs with credentials. Check `src/**` and any committed `.env*` files.
- Confirm `VITE_SUPABASE_ANON_KEY` is the **anon** key, not the service role key.
- Search for any use of `service_role` anywhere in the frontend bundle. **Critical** if found.
- Check `.gitignore` covers `.env`, `.env.local`, `.env.*.local`.
- Check git history for previously committed secrets (`git log -p -- .env*` and `git log -S 'service_role'`).

## 1.6 Vercel functions

- List every function. For each: authentication required? Rate limited? Input validated?
- Any function that accepts user input and forwards it to Supabase using the service role key is a high-risk surface — list every one.
- CORS: any `Access-Control-Allow-Origin: *` on a function that returns sensitive data?

## 1.7 Dependencies

- Run `npm audit --production` and list every High/Critical with the upgrade path.
- Identify any abandoned package (no release in 2+ years) used in production code.
- Flag any package pulled from a non-npm registry or a git URL.

---

# Pass 2 — Database & data integrity

## 2.1 Schema review

For every table:
- Does it have a primary key?
- Are foreign keys declared, with appropriate `ON DELETE` behaviour?
- Are columns that should be `NOT NULL` actually `NOT NULL`?
- Are enums / status fields constrained (CHECK constraint or enum type), or just free text?
- Are timestamps (`created_at`, `updated_at`) present and defaulted?
- Are unique constraints where uniqueness is assumed (e.g. payment reference)?

## 2.2 Indexes

- List every index. For each: is it actually used? (use `pg_stat_user_indexes`)
- For every column appearing in a `WHERE` or `JOIN` in frontend queries, does it have an index?
- Any duplicate or redundant indexes?

## 2.3 Triggers & functions

- For each trigger and function: is it `SECURITY DEFINER` or `SECURITY INVOKER`? Justify.
- Any function building SQL via string concatenation with user input?
- Are payment reference generation, collision handling, and registration triggers idempotent?

## 2.4 Migrations

- Are migrations versioned and committed?
- Any migration that would fail if re-run? Any destructive migration without a documented rollback?
- Is the `zltacHistory.js` file ever written to by the app, or is it strictly compile-time data?

## 2.5 Backups

- Is point-in-time recovery enabled on the Supabase project?
- What is the retention window? When was the last successful backup verified by restore?

---

# Pass 3 — Code quality & maintainability

## 3.1 Baseline

- Confirm `npm run lint` reports **no more than 30 problems (23 errors, 7 warnings)**. List any regression.
- Run with `--max-warnings 0` mentally — which warnings, if any, should be promoted to errors?

## 3.2 Error handling

- Search for `catch (` and `.catch(`. For each: is the error surfaced to the user, logged, swallowed silently, or re-thrown? Tabulate.
- Identify async paths where a rejected promise has no handler.
- Identify Supabase calls that destructure `{ data }` without checking `error`.

## 3.3 React patterns

- Components over 300 lines: list them, recommend extraction points.
- `useEffect` with missing or wrong dependency arrays.
- State derived from props stored in `useState` (anti-pattern).
- Inline functions or objects in `useMemo`/`useCallback` deps that defeat memoisation.
- Forms without a single source of truth for their state.

## 3.4 Data fetching

- Any component fetching the same data its parent already fetched?
- Any N+1 pattern (a list rendering rows where each row fetches its own detail)?
- Any data fetched on every render due to a missing dep array?
- Loading and error states: is there a consistent pattern, or does every page invent its own?

## 3.5 Dead code & drift

- Unused exports, unused imports, unreferenced files (especially the scrapped State Associations migration — confirm it is clearly marked as not-applied).
- `console.log` / `console.debug` left in production paths.
- TODO/FIXME comments older than 30 days — list with file:line.
- Commented-out code blocks larger than 5 lines.

## 3.6 Consistency

- Naming: `camelCase` in JS vs `snake_case` in DB — is the mapping done in one place or scattered?
- Tailwind: confirm `bg-base`, `bg-surface`, `text-brand` etc are used consistently and no raw colour values bypass the tokens.
- Date/time: any place where dates are constructed without explicit timezone handling (relevant for AU events)?
- Em-dash / en-dash audit on user-facing strings only (page copy, button labels, toast messages). Code comments and numeric ranges are exempt.

---

# Pass 4 — Performance

## 4.1 Bundle

- Run `vite build` and report the largest 10 chunks.
- Identify any dependency contributing >100KB gzipped that could be replaced or lazy-loaded.
- Confirm code splitting on the admin routes (heaviest surface).

## 4.2 Queries

- For every Supabase query in the frontend: is it using `.select()` with explicit columns, or `select('*')` everywhere?
- Any query without pagination on a table that will grow (registrations, payment_records)?
- Any query in a render path (not a `useEffect`)?

## 4.3 Render performance

- Lists rendering >100 items without virtualisation?
- Inline `.sort()` / `.filter()` on large arrays in render?

## 4.4 Network

- Are admin pages still ~900ms after the `syd1` pin? Measure cold and warm.
- Any image served unoptimised (no `width`/`height`, no modern format)?

---

# Pass 5 — Accessibility & UX correctness

- Every interactive element: keyboard-reachable? Has a visible focus state?
- Every form input: associated `<label>`? Errors announced to screen readers?
- Colour contrast on the custom Tailwind tokens against `bg-base` and `bg-surface` — meets WCAG AA?
- Any `<div onClick>` that should be a `<button>`?
- Empty states for: no registrations yet, no payments recorded, no events scheduled.
- Error states: does the user ever see a raw Supabase error message? They shouldn't.
- Destructive actions (delete registration, mark unpaid, suspend user): require confirmation? Reversible?

---

# Pass 6 — DevOps, observability, documentation

## 6.1 CI/CD

- Is there CI on PRs? Does it run lint and build? Does it block merge on failure?
- Preview deployments confirmed working?
- Environment variables documented somewhere committed (names, not values)?

## 6.2 Observability

- Error tracking installed? (Likely no — flag as High.)
- Are Supabase auth and database logs being reviewed? Any retention?
- Are Vercel function logs being reviewed?
- Is there a uptime check on the production URL?

## 6.3 Documentation

- `README.md`: can a new developer clone, install, configure env, and run the app in under 15 minutes following only the README?
- `CLAUDE.md`: still accurate? Hard rules still enforced?
- Architecture decision records or equivalent: do they exist for the payment design, the reference format change, and the scrapped State Associations work?
- Runbook: what does the operator do if Supabase is down, if a payment is recorded wrong, if a user reports they can see another user's data?

## 6.4 Recovery

- If the Vercel project is deleted tomorrow, what is the recovery path?
- If the Supabase project is deleted tomorrow, what is the recovery path?
- Where are the secrets backed up?

---

# Final deliverable

After all six passes, consolidate into `audits/SUMMARY-YYYY-MM-DD.md`:

- One-paragraph executive summary suitable for the committee.
- Counts by severity across all passes.
- Top 10 findings ranked by severity then by effort-to-fix.
- A proposed remediation order with rough effort estimates.
- An honest "what this audit did not cover" section.

The summary is what the committee reads. The pass reports are the evidence.
