# Security Remediation Rollout

**Status:** Final local verification complete; controlled rollout not started
**Baseline commit:** `ff15a7cc589eef55b8be5f39421019262c447ba0`
**Baseline branch:** `main`
**Last updated:** 2026-07-15

This runbook controls the release of the July 2026 security and reliability
remediation. It does not authorise a production change by itself. A maintainer
must approve each production migration and deployment checkpoint separately.

Final local evidence on 2026-07-15: 131 of 131 migrations replayed, 32 of 32
remediation verifiers passed, 15 of 15 SQL behavior suites passed with 393
assertions, 72 Vitest files passed with 495 tests passed and 1 intentionally
skipped, fail-on-warning schema lint reported no errors, full application lint
and production build passed, 18 of 18 Playwright journeys passed, and both the
full and production-only dependency advisory audits reported zero
vulnerabilities. Refresh these counts against any later commit. Local evidence
does not replace staging or production proof.

## Evidence record

Complete this table in private release notes. Project references, deployment
identifiers, backup locations, and inventory output are operationally sensitive
and must not be committed here.

| Evidence | Staging | Production |
|---|---|---|
| Supabase project reference, independently verified | Pending | Pending |
| Current migration history captured | Pending | Pending |
| Read-only remediation inventory captured | Pending | Pending |
| Data API exposed schemas exactly `public` | Pending | Pending |
| Vercel deployment identifier | Pending | Pending |
| Deployment URL protection verified | Pending | Pending |
| Pre-change full database backup | Pending | Pending approval |
| Off-project Storage copy verified | Pending provider configuration and manual workflow run | Pending provider configuration and manual workflow run |
| Restore drill identifier and result | Pending | Pending |

Use `supabase/verify/20260713_pre_remediation_inventory.sql` for catalog and
aggregate integrity evidence. The script deliberately returns no member-row
values.

## Before touching a linked database

1. Run `supabase projects list` and identify the expected project reference.
2. Run `supabase status` and `supabase migration list --linked`.
3. Compare the linked reference with the private environment record. Stop on
   any mismatch.
4. Capture the read-only inventory and migration list.
5. In Supabase API settings, verify the Data API exposed-schema list is exactly
   `public`, matching `supabase/config.toml`. Stop on any additional schema.
   The portal does not use the GraphQL API. The `066000` contract requires no
   Storage policy to apply to `public`, `anon`, or `authenticated`; public
   object bytes remain available only when their exact URL is known, and all
   supported mutations use server-authorised workflows.
6. Resolve every non-zero integrity count or record an approved remediation.
7. Create and verify a restore-capable backup. Same-project CSV files are not a
   disaster-recovery backup.
8. Run `npm run release:check-vercel-env` for Preview with independently
   recorded staging/production refs, then repeat for Production with the refs
   reversed. Retain only the redacted reports.
9. Confirm Vercel Deployment Protection is configured for Preview and
   unaliased Production deployment URLs. After each exact URL is generated,
   verify protection before any smoke test. An unaliased or hard-to-guess URL
   is not access control. Retain only redacted evidence.
10. Confirm Upstash Redis is configured and healthy in each deployed scope.
   Distributed rate limits and account-access locks fail closed without it.

Never put a production service-role key in Preview or local test settings.

### Bootstrap disaster recovery before the broad release

The off-project backup workflow is a prerequisite for production phase 1, but
GitHub can dispatch it only after the workflow exists on the default branch and
the job itself accepts only `main`. If the workflow is not already on `main`,
land `.github/workflows/disaster-recovery-backup.yml` by itself in a small
preliminary pull request. Do not merge this broad schema-dependent release
branch merely to unlock the backup: the normal Git integration would also
auto-deploy the new application against the old database.

After the workflow-only change is on `main`, configure the protected
`disaster-recovery` environment, run the manual backup, verify its downloaded
hashes, and complete the documented restore drill. Leave
`DR_BACKUPS_ENABLED` false until that drill passes; manual dispatch is the
bootstrap path and the flag enables only the unattended schedule.

## Dependency-ordered checkpoints

Do not run an unrestricted `supabase db push` while all 32 remediation files
are pending. It has no "stop at version" option and would collapse mandatory
application and publication checkpoints.

Use the repository phase runner instead. It creates a temporary Supabase
workdir containing only migrations through the selected endpoint, verifies the
linked project against an independently supplied project ref, runs the native
`supabase db push --dry-run`, and uses native `db push` for the approved apply.
It never moves repository migrations and never writes migration history by
hand.

```powershell
npm run rollout:db -- --list
$env:EXPECTED_SUPABASE_PROJECT_REF = '<private-verified-project-ref>'
$env:FORBIDDEN_SUPABASE_PROJECT_REF = '<private-other-environment-project-ref>'

npm run rollout:db -- --phase legal-expand --environment staging --dry-run
$env:EXPECTED_RELEASE_COMMIT = '<full-40-character-approved-release-commit>'
npm run rollout:db -- --phase legal-expand --environment staging --apply --confirm APPLY-STAGING-LEGAL-EXPAND

npm run rollout:db -- --phase application-cutover --environment staging --dry-run
npm run rollout:db -- --phase application-cutover --environment staging --apply --confirm APPLY-STAGING-APPLICATION-CUTOVER

npm run rollout:db -- --phase admin-content-contract --environment staging --dry-run
npm run rollout:db -- --phase admin-content-contract --environment staging --apply --confirm APPLY-STAGING-ADMIN-CONTENT-CONTRACT
```

For production, replace `staging` with `production` and use the confirmation
printed by the runner, for example
`APPLY-PRODUCTION-LEGAL-EXPAND`. A dry-run and explicit maintainer approval are
still required for each phase. For staging, the expected ref is staging and the
forbidden ref is production; reverse them for production. The runner refuses an
apply unless `HEAD` equals `EXPECTED_RELEASE_COMMIT` and `git status --short`
is empty, so no uncommitted or unreviewed migration can enter its isolated
manifest. The dry-run intentionally remains available while review changes are
present.

Clear the private release values after the session:

```powershell
Remove-Item Env:EXPECTED_SUPABASE_PROJECT_REF
Remove-Item Env:FORBIDDEN_SUPABASE_PROJECT_REF
Remove-Item Env:EXPECTED_RELEASE_COMMIT
```

### Environment-specific deployment rule

Staging rehearsals use an immutable Vercel Preview deployment from the exact
reviewed release commit and Preview-scope environment variables. Never use
`vercel --prod` or `vercel promote` for a staging checkpoint.

Production uses a separate unaliased deployment built with Production-scope
variables. `vercel --prod --skip-domain` prevents the public alias from moving;
it does not enable Deployment Protection. Before exercising any intermediate
schema, prove that Vercel Authentication or the approved equivalent protects
the generated URL and that only authorised operators hold bypass access.

### Required maintenance and stale-client strategy

The initial migrations revoke browser writes that the old bundle still uses,
while the new bundle calls functions and views that do not exist at the start
of the rollout. There is no zero-downtime ordering for this one-time security
cutover. Production must therefore use an announced write-maintenance window
from the first `010000` apply until `066000` and final smoke tests pass.

1. Close active event and competition registration windows through the normal
   committee controls, pause committee/captain changes, set the portal backup
   frequency to `off`, and record every prior value for restoration. The final
   API calls the `065500` backup lease functions, so neither cron nor a manual
   backup may run against an earlier phase.
2. After writes are stopped, create the final pre-change encrypted database
   dump and off-project Storage copy. Download and hash-check that exact backup
   set. Do not begin production phase 1 unless an earlier set from the same
   workflow has also passed the documented hosted replacement-project restore
   drill.
3. Serve a reviewed static maintenance response at the public production
   domain. A banner is not maintenance. Keep the release owner's immutable
   production deployment URL protected and available for the controlled smoke
   tests.
4. Ask committee users to sign out and close portal tabs before the window.
   Existing tabs cannot be recalled; once contracts apply their obsolete
   direct writes must fail closed with 401/403. Never restore unsafe grants to
   accommodate a stale tab.
5. Keep maintenance in place while running all three phases below. If a person
   reaches an old tab, instruct them to close it and load the production domain
   again only after the all-clear.
6. Reopen the recorded registration windows and restore the reviewed backup
   frequency only after the final deployment, direct-write denial tests, one
   successful `065500`-guarded backup, logs, and health checks pass.

### Phase 1: legal expansion (`010000` through `041000`)

1. Apply `legal-expand` with the phase runner.
2. Run the matching verification SQL for every newly applied migration, ending
   with `20260713041000_add_masked_public_views_verify.sql`.
3. Use the environment-specific immutable deployment method defined above. For
   staging, use the protected Preview deployment bound to staging. For
   Production, run `vercel --prod --skip-domain` from the exact reviewed
   release commit, confirm protection on the generated URL, and do not run
   `vercel promote` while the public domain remains on the maintenance
   response. Verify the backup schedule remains off. At this intermediate
   schema, exercise only the controlled legal publication path. Migration
   `012000` supplies the
   access-revocation column read by server authorisation and guards it against
   browser writes. Migration `040000` supplies both publication and
   response-reconciliation functions. Do not deliberately exercise any other
   final-build workflow until phase 2; incidental authentication and
   administrative layout reads must succeed but are not cutover evidence.
4. Through that deployed server flow, publish a fresh verified PDF for
   `code_of_conduct`, `media_release`, and `under_18_form`.
5. Confirm each active row has digest, size, publication time, and a matching
   `storage.objects` row, each branded `/documents/...` URL works, and each
   retired URL returns 404.

Migration `042000` now fails closed on a populated database unless all three
active published objects exist. This protects even an accidental unrestricted
push, but it is not a substitute for saved smoke evidence.

### Phase 2: application cutover (`042000` through `065500`)

1. Apply `application-cutover` with the phase runner.
2. Run every matching verification through
   `20260713065500_backup_run_concurrency_guard_verify.sql`.
3. Exercise registration, under-18, team, competition, side-event, payment,
   legal, volunteer, profile-governance, public-read, and referee-test paths
   from the recorded environment-specific immutable deployment. Production
   maintenance remains active throughout this phase.
4. Exercise all admin-content paths, including one harmless site-banner upsert
   through the deployed API. Confirm that it creates an attributed row in
   `admin_content_mutation_audit`; this is the database checkpoint for phase 3.
5. Through the deployed signed-upload APIs, issue, upload, and finalize one event
   logo, event photo, event cover, history logo/photo, referee image/video, and
   competition banner. Confirm every saved reference is a branded `/assets/...`
   path and every object is readable. Retain one immutable
   `admin_asset_upload_audit` row per purpose with actor, scope, bucket, exact
   generated path, actual size, and actual MIME type. Confirm cross-competition
   issuance is denied and archived/missing targets fail before a token. Retain
   no token in logs.
6. Confirm event and placing saves are atomic and public history exposes neither
   internal notes nor hidden drafts.
7. Keep scheduled and manual backups paused until `065500` is applied. Then run
   one controlled manual backup while cron remains paused, prove it can acquire
   and finish its lease, and prove a concurrent start is rejected without
   creating a second running row. Verify the completed prefix contains
   `admin-asset-upload-audit.csv` and that its manifest count and hash match the
   file. Restore the recorded schedule only after phase 3 and final smoke tests.

### Phase 3: admin browser contract (`066000`)

1. Apply `admin-content-contract` only after phase 2 smoke evidence is accepted.
   On a populated database, `066000` fails closed unless phase 2 produced at
   least one `admin_content_mutation_audit` row and finalized evidence for all
   eight purposes in `admin_asset_upload_audit`.
2. Run `20260713066000_admin_content_browser_contract_verify.sql`.
3. Repeat admin/public smoke tests and prove direct base-table reads/writes are
   denied for browser roles.
4. Prove direct authenticated Storage insert, overwrite, and delete are denied
   for `event-logos`, `event-photos`, `event-covers`, `referee-test-media`, and
   `competition-banners`. Repeat all signed-upload paths and confirm public
   branded reads still work. Do not restore the legacy Storage policies to
   accommodate a stale browser.
5. Prove `anon` and `authenticated` cannot list Storage metadata or directly
   insert, overwrite, or delete avatar and team-logo objects. Exercise the
   server team-logo route and prove captain ownership, open-event enforcement,
   file signature and size validation, rate limiting, safe rollback, and old
   object cleanup. Confirm replacement is visible immediately through the
   branded renderer. Avatar mutation remains unavailable until an equivalent
   server route is reviewed and shipped.
6. Check Vercel and Supabase logs. For staging, retain the Preview evidence and
   do not promote the deployment. For Production, run
   `vercel promote <verified-deployment-url>` for the exact protected staged
   Production deployment. Coordinate the later merge to `main` so its
   automatic Vercel deployment cannot replace the maintenance or verified
   final alias before approval. Tell users to reload and reopen the recorded
   registration windows.

The three phases above are mandatory in disposable, staging, and production
rehearsals. The maintenance window addresses the earlier mutually incompatible
browser/database contracts; the `065000` expansion, additive `065500` backup
lease/audit-export guard, signed-upload evidence checkpoint, and `066000`
contraction still provide explicit application and contract checkpoints.

For every migration:

1. Apply it to a disposable local database, then staging.
2. Run its matching file in `supabase/verify/`.
3. Exercise the relevant negative and happy-path tests.
4. Save query/test output in private release evidence.
5. Review the matching rollback file as documentation of the boundary. Every
   `20260713` rollback is intentionally fail-closed and roll-forward-only; none
   is an executable production reversal.
6. Obtain explicit approval before applying the same checkpoint to production.

All 32 `20260713` migrations have a strict roll-forward-only security boundary.
Migration `20260713053000_preserve_anonymized_legal_evidence.sql` additionally
crosses an irreversible data-retention boundary. Read
`docs/operations/legal-evidence-retention.md` before applying it. Once evidence
has been anonymized, no schema or application rollback can reconstruct the
discarded identity, so any correction must roll forward.

If SQL is applied through the Supabase SQL Editor, immediately run
`supabase migration repair <version> --status applied --linked`, followed by
`supabase migration list --linked`.

## Required staging roles and journeys

Use dedicated disposable accounts for player, under-18 player, captain,
competition manager, ALSA committee, ZLTAC committee, advisor, superadmin, and
suspended-user scenarios. Never use production accounts in automated tests.

The release evidence must show:

- direct privileged table writes are rejected;
- direct privileged Storage writes are rejected while server-issued exact-path
  uploads are finalized, immutably audited, and served through branded reads;
- server registration, team, payment, legal, and volunteer paths still work;
- closed and archived event/competition mutations fail;
- player, captain, and committee readiness results agree;
- inactive legal documents, bank details, UUIDs, and legal names are not public;
- recovery links, manager route boundaries, failure/retry states, and safe
  return paths work;
- cron authentication, stale-backup alerting, CSV neutralisation, asset range
  requests, and enforced CSP work;
- guarded Preview/Production environment checks pass and deployed Redis-backed
  rate limiting/account locks fail closed when intentionally made unavailable;
- approved contact/Auth email and browser/server Sentry canaries reach only the
  intended environment's provider records, and Production alert routing works;
- normal suspend/restore and remove-access work; concurrent requests conflict;
  differently cased spellings of the same UUID also conflict; a permanently
  removed account cannot be restored, reset, re-identified, or granted roles;
  timeout quarantine and `ACCOUNT_ACCESS_RECONCILIATION_REQUIRED` follow the
  documented superadmin reconciliation path without a blind retry;
- a confirmed Auth email can claim only its matching placeholder, unconfirmed
  and alias-only claims fail, inactive merge targets are excluded, and each
  successful self/admin merge creates one immutable attributed audit row;
- the database plus Storage restore succeeds in a disposable project;
- account deletion preserves pseudonymous legal and under-18 evidence, and
  hard event deletion is refused when that evidence exists.

## Failure and rollback handling

- Stop the rollout at the first failed verification or smoke test.
- Do not continue to dependent application code if its migration is not proven.
- Preserve logs without copying tokens, member data, or secret values.
- Before `010000`, an application rollback remains a normal deployment
  decision. After `010000`, do not re-promote the baseline application: it
  depends on browser writes that the remediation deliberately revokes. Keep
  maintenance active and deploy a reviewed roll-forward fix compatible with
  the highest applied migration.
- Do not execute a `20260713` rollback file or mark one reverted in migration
  history; each file intentionally raises before changing state. Older
  compatibility rollbacks are separate, require their own proof, and are
  governed by `supabase/rollback/README.md`.
- Rotate the service-role key immediately if it appears in Preview, logs, a
  browser bundle, or source control.
- On account-lock loss, timeout, or `ACCOUNT_ACCESS_RECONCILIATION_REQUIRED`,
  stop changes for that target and do not blindly retry. Verify Redis health,
  independently inspect Auth `banned_until` and profile access state, reconcile
  under superadmin control, and retain telemetry/audit evidence.

## Final release record

Production release approval requires passing unit/API tests, lint, build,
dependency audit, database integration tests, browser journeys, all 32
remediation verification scripts, the staging role matrix, and a documented
independent restore drill. The approval record must also include guarded environment-check
reports, deployment-protection evidence, all-eight upload finalization
evidence, the verified asset-audit backup, and account-access
saga/reconciliation evidence. Record the approving maintainer and timestamp in
private release evidence.
