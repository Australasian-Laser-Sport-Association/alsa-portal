# Security Audit — Pass 1 Status

**Date:** 2026-05-29
**Scope:** Pass 1 of AUDIT_BRIEF.md (Supabase RLS, authorization, auth/session, payments, frontend, Vercel functions, dependencies).
**Verification method:** Claude Code static report (`audits/security-2026-05-28.md`) plus live production-DB ground-truthing via the Supabase SQL Editor (grant matrix, RLS policy dump, column grants, `has_table_privilege` checks). Findings below reflect the LIVE database state, not just the migration files.

---

## Headline

Pass 1 surfaced 4 Critical, ~8 High, ~9 Medium findings. The most important structural takeaway: **the entire write-security model rests on RLS being correct across ~20 tables, with broad `authenticated` CRUD grants giving no defense-in-depth behind it.** Live verification showed most of those broad grants fail closed (no matching non-committee write policy), so they are untidy warts rather than live holes — but the architecture is one wrong policy away from exposure, which is the thing to harden.

Two Criticals are already fixed and verified live. Two remain (code-layer) and are the immediate next task.

---

## Findings & status

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | Critical | Committee can escalate self/anyone to superadmin. Exists at BOTH the API (`/api/admin/users` PATCH, service role) AND the RLS layer (`profiles_update_committee` had no roles lock). | RLS half **FIXED** (migration). API half **PENDING** (Claude Code). |
| 2 | Critical | `claim_placeholder_profile` RPC lets any logged-in user claim another player's placeholder (incl. paid registrations) — checks `auth.uid()=real_id` but not placeholder ownership. | **PENDING** (Claude Code: function migration + API guard). |
| 3 | Critical | Anon can read bank details (BSB/account no./name) from `zltac_events` via PostgREST (table-level `GRANT SELECT TO anon` on those columns). | **FIXED** — anon column SELECT revoked; authenticated SELECT retained for the payment panel. |
| 4 | Critical | Players can UPDATE their own `zltac_registrations` row and tamper with `amount_owing`, `payment_reference`, and the `admin_override_*` fields (RLS WITH CHECK pinned only owner + open-phase, not columns). Confirmed live: `has_table_privilege` = true (undocumented prod UPDATE grant). | **FIXED** — `protect_registration_admin_fields` BEFORE UPDATE trigger blocks non-committee column changes; player-block proven via simulated-JWT test; service role recompute allowed via `auth.uid() IS NOT NULL` guard. |
| — | High | `payment_records` editable/deletable by any committee role with no history table. | Pending. |
| — | High | Committee can hard-delete an event + all registrations/payments, no superadmin gate, no confirmation. | Pending. |
| — | High | `competition_registrations`: self-insert WITH CHECK pins only `user_id`, so `amount_owing` can be self-set; AND `self_update_nonpayment` policy has a SQL bug (`cr1.id = cr1.id` self-comparison) making the payment-field lock non-functional (errors / fails closed). | Pending. |
| — | High | `/api/profiles` lets any logged-in user enumerate every other user's roles/name/alias/state (no relationship check on requested ids). | Pending. |
| — | High | Placeholder profiles: `profiles.id -> auth.users` FK was dropped without an insert guard ensuring non-placeholder rows have an auth user. | Pending. |
| — | Med | `api/captain.js` interpolates client `playerIds` into a PostgREST `.or()` filter. Mitigated today by the ownership guard. | **Downgraded** from High (mitigated). Cleanup: UUID-validate or use `.in()`. |
| — | Med | `team_members`: broad `authenticated` CRUD grant, but RLS has no non-committee write policy. | **Downgraded** — fails closed (not a live hole). Revoke unused grants; verify captain team-creation actually works (Pass 3). |
| — | Med | `payment_reference` / registration trigger functions not `SECURITY DEFINER`; collision check runs under caller RLS. | Pending. |
| — | Med | Public competition roster exposes `first_name`/`last_name` to anon (ZLTAC roster deliberately exposes only alias+state). | Pending. |
| — | Med | No security headers / CSP on Vercel functions; password floor only 6 chars, no breached-password check; no DELETE/account-deletion path. | Backlog. |
| — | Low | No rate limiting on authenticated endpoints (only `/api/contact`); SVG mime allowed in team-logos bucket (safe via `<img>` today). | Backlog. |

---

## Systemic / hardening findings (defense-in-depth, not live holes)

Live RLS verification confirmed these tables grant `authenticated` broad CRUD but have NO non-committee write policy, so writes fail closed today:

`under_18_approvals`, `referee_questions`, `legal_documents`, `payments` (legacy), `team_members`, and the history tables (`zltac_dynasties`, `zltac_event_history`, `zltac_event_placings`, `zltac_hall_of_fame`, `zltac_legends`).

**Action:** revoke the unused INSERT/UPDATE/DELETE grants from `authenticated` on these so the grant layer matches RLS intent. Not urgent, but it removes the "one bad policy = breach" fragility. Bundle as one hardening migration.

**Drift note:** production grants exceed the migration history on multiple tables (`zltac_registrations` UPDATE, `team_members` INSERT, etc.). Reconcile the full grant matrix against migrations and write catch-up migrations so prod and repo agree.

---

## What was applied (and verified) in this session

Migration `supabase/migrations/20260529000000_security_pass1_criticals.sql`, applied to production and verified:

1. `REVOKE SELECT (bank columns) ... FROM anon` — closes Critical #3.
2. `protect_registration_admin_fields` trigger — closes Critical #4. Verified: simulated-player UPDATE of `amount_owing` errors with "Cannot modify protected registration fields"; service-role recompute path allowed (corrected `auth.uid() IS NOT NULL` guard after an initial version broke the side-events confirm flow).
3. `profiles_update_committee` rewritten with a roles-lock WITH CHECK + new `profiles_update_superadmin` policy — closes the RLS half of Critical #1.

**Outstanding verification:** browser confirmation that PlayerHub side-events/extras confirm succeeds with no 500 (logic + null-uid test indicate it does; visual confirm recommended before relying on it).

---

## Remaining work, in order

**Before next deploy (Criticals):**
1. Critical #1 API half — `api/admin/users.js` role/suspend gating (Claude Code).
2. Critical #2 — `claim_placeholder_profile` ownership check + API guard (Claude Code, produces a migration).

**Before committee submission (Highs):**
3. `competition_registrations` — fix self-insert amount lock + the buggy `self_update_nonpayment` subqueries.
4. `payment_records` — make append-only or add an audit-history table.
5. Event hard-delete — require superadmin + typed confirmation.
6. `/api/profiles` — constrain to teammates/self/committee; drop `roles` from payload unless committee.

**Hardening backlog:**
7. Revoke unused write grants on the fail-closed tables (one migration).
8. `competition`/`triples`/`doubles` consent constraints; trigger `SECURITY DEFINER` fixes; roster name exposure; security headers/CSP; password floor; authenticated rate limiting; account deletion.

**Cheap verification to slot in:** `SELECT pg_get_viewdef('public.referee_questions_public', true);` — confirm the answer column is NOT in the view (now the only thing between players and the referee answer key).

---

## Not yet covered (Passes 2–6)

Pass 1 was security/authorization only. Still to run as separate Claude Code sessions against AUDIT_BRIEF.md: Pass 2 (database & data integrity), Pass 3 (code quality & maintainability — includes the parked "does captain player-removal / team-creation actually work" functional questions), Pass 4 (performance), Pass 5 (accessibility & UX correctness), Pass 6 (DevOps, observability, documentation — error tracking via Sentry, etc.).
