# Production Remediation Ledger

This ledger tracks the production-readiness audit findings. A finding is only
closed when the implementation, regression coverage, and deployment evidence
are all complete.

## Launch blockers

| ID | Finding | Status | Evidence required |
| --- | --- | --- | --- |
| SEC-01 | Active storage content exposed on the application origin | Code complete | Apply migration, run verification SQL and hosted-object cleanup |
| SEC-02 | Suspended accounts remain authorized | Code complete | Apply migration and run API/RLS verification |
| AUTH-01 | Committee roles have overly broad write access | Partially fixed | Alias changes audited; finer ALSA/ZLTAC capability scopes remain. Advisor intentionally has full committee authority but is excluded from public committee rosters. |
| DATA-01 | Registration and team limits are not atomic | In progress | ZLTAC team/player/roster caps serialized; remaining competition caps need coverage |
| DATA-02 | Multi-table registration/team/payment workflows are not transactional | In progress | Captain team creation is atomic; remaining roster, partner, and admin edit flows remain |
| OPS-01 | PII exports are emailed and are not restorable backups | Code complete | Apply private-bucket migration and complete a non-production restore exercise |
| TEST-01 | Critical authorization and migration paths lack automated tests | In progress | Local reset, API tests, RLS behavior checks, and migration verifiers pass; CI migration-reset gate remains |
| AUTH-02 | Hosted authentication hardening is not proven | Open | Supabase setting evidence and privileged MFA |
| SEC-03 | Production security headers are incomplete | Baseline complete | Deploy smoke test and tested CSP remain |

## Pre-launch hardening

| ID | Finding | Status |
| --- | --- | --- |
| ABUSE-01 | Application endpoints lack consistent rate limits | Partially fixed; high-impact search, claim, profile, captain, volunteer, and admin event routes protected |
| OPS-02 | Backup failures are not externally actionable | Open |
| LEGAL-01 | Legal acceptance evidence and immutability are incomplete | Code complete; deployment verification pending |
| DB-01 | Database reset, seed, and drift checks are not in CI | Open |
| APP-01 | Root and route error boundaries are missing | Open |
| PRIV-01 | Public roster/member exposure needs an explicit privacy decision | Open |

## Post-launch optimisation

Large route modules, the shared bundle, hook warning backlog, request
cancellation, image optimisation, and admin-table rendering remain tracked as
maintainability and performance work. They do not override any launch blocker.

## Launch-blocker migration review evidence

Run `supabase/verify/20260615_preflight_schema_verify.sql` against the hosted
database before applying any `20260615*` migration. It checks the live tables,
columns, function signatures, trigger names, bucket rows, and uniqueness
constraints assumed by this branch. The local migration reset confirms these
assumptions against the repository schema only; it is not evidence of hosted
schema parity.

The high-risk assumptions are:

- `security_batch1` (`20260615060000`, deliberately last):
  `legal_acceptances` evidence columns and grants;
  `storage.buckets.allowed_mime_types`; `teams.logo_url`; and
  `referee_questions.image_url` (confirmed in the local reset schema).
- `suspension_enforcement`: `profiles.id/roles/suspended`,
  `competition_managers.competition_id/user_id`, the existing permissive RLS
  write policies, `storage.objects`, and the
  `claim_placeholder_profile(uuid, uuid)` signature.
- `profile_alias_audit`: `profiles.id/alias` and the service-side callers that
  supply target, actor, reason, and source.
- `atomic_zltac_capacity_and_captain_team`: ZLTAC event capacity/fee columns,
  team ownership/status columns, registration roster/payment columns,
  team-member invitation columns, and unique keys on
  `zltac_registrations(user_id, year)` and `team_members(team_id, user_id)`.
- `private_backup_storage`: the standard Supabase bucket columns and the
  absence of an existing conflicting `backup_runs` relation.

Registration trigger responsibilities and firing order:

1. `trg_enforce_zltac_roster_lock` blocks membership changes involving a
   pending/approved team. It runs first for INSERT and UPDATE.
2. `trg_protect_registration_admin_fields` blocks non-committee changes to
   money and admin override fields. It runs second for UPDATE.
3. `zltac_registrations_enforce_event_capacity` serializes the event row and
   enforces the total registration cap on INSERT.
4. `zltac_registrations_enforce_roster_capacity_insert/update` locks the team
   row and enforces event-year and team-size consistency. The UPDATE trigger
   runs after both existing guards and only when `team_id` or `year` changes.
5. `zltac_registrations_set_payment_reference` runs last on INSERT and only
   generates the payment reference.

The migration verifier asserts this exact PostgreSQL name-based order. There is
no live trigger named `enforce_registration_lock`; the existing registration
lock referred to in review is `trg_enforce_zltac_roster_lock`.
