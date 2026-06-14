# Production Remediation Ledger

This ledger tracks the production-readiness audit findings. A finding is only
closed when the implementation, regression coverage, and deployment evidence
are all complete.

## Launch blockers

| ID | Finding | Status | Evidence required |
| --- | --- | --- | --- |
| SEC-01 | Active storage content exposed on the application origin | Code complete | Apply migration, run verification SQL and hosted-object cleanup |
| SEC-02 | Suspended accounts remain authorized | Code complete | Apply migration and run API/RLS verification |
| AUTH-01 | Committee roles have overly broad write access | Partially fixed | Advisor authority removed and alias changes audited; finer ALSA/ZLTAC capability scopes remain |
| DATA-01 | Registration and team limits are not atomic | In progress | ZLTAC team/player/roster caps serialized; remaining competition caps need coverage |
| DATA-02 | Multi-table registration/team/payment workflows are not transactional | In progress | Captain team creation is atomic; remaining roster, partner, and admin edit flows remain |
| OPS-01 | PII exports are emailed and are not restorable backups | Code complete | Apply private-bucket migration and complete a non-production restore exercise |
| TEST-01 | Critical authorization and migration paths lack automated tests | In progress | CI now runs tests; API, RLS, and migration-reset gates remain |
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
