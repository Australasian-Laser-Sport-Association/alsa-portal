# Production rollout: 2026-06-15 remediation

Status: **NO-GO until every gate below is satisfied.**

This rollout contains seven hosted migrations: two existing application
migrations and five remediation migrations. There is no advisor migration.

## Go/no-go gates

- A pull request for `codex/remediation-launch-blockers` is open and GitHub CI
  is green: 23 tests pass, production build passes, ESLint is no worse than the
  0-error/7-warning baseline.
- A known-good production deployment is selected in Vercel for code rollback.
- Supabase backup/PITR availability has been confirmed for the production
  project.
- The exact linked dry-run list matches the seven migrations below.
- `supabase/verify/20260615_preflight_schema_verify.sql` passes in the production
  SQL Editor before any migration is applied.
- The rollback files in `supabase/rollback` are open and ready. The operator
  understands that code must be rolled back before the code-coupled SQL.
- An active test account and a suspended test account are ready, along with an
  advisor account and a legal document that can be signed safely.
- The operator can merge/deploy through Vercel immediately after the final
  migration. Do not begin without production Supabase and Vercel access.

Run this from the repository root and stop if the list differs:

```powershell
supabase db push --linked --dry-run
```

Expected order:

1. `20260610040000_site_banner_flag.sql`
2. `20260610050000_documents_and_categories.sql`
3. `20260615010000_suspension_enforcement.sql`
4. `20260615030000_profile_alias_audit.sql`
5. `20260615040000_atomic_zltac_capacity_and_captain_team.sql`
6. `20260615050000_private_backup_storage.sql`
7. `20260615060000_security_batch1.sql`

## Migration-history rule

The staged procedure below uses the Supabase SQL Editor so the suspension
migration can be verified before later migrations are applied. SQL Editor does
not update migration history automatically. After each migration and its
verification succeed, record it immediately:

```powershell
supabase migration repair --linked --status applied <version>
supabase migration list --linked
```

Never repair a version as applied before its SQL transaction succeeds. If SQL
succeeds but the repair command fails, stop and retry the repair; do not rerun
the migration blindly.

## Phase 1: prerequisites and additive changes

Apply each migration file in the production SQL Editor in this order. Verify
and repair migration history before continuing.

1. Apply `20260610040000_site_banner_flag.sql`, then repair `20260610040000`.
2. Apply `20260610050000_documents_and_categories.sql`, then repair
   `20260610050000`. These tables must exist before suspension enforcement so
   they receive the active-user policies.
3. Apply `20260615010000_suspension_enforcement.sql`.
4. Run `20260615010000_suspension_enforcement_verify.sql`.
5. Smoke an ordinary self-service write with the active test account and
   confirm the suspended account cannot perform the equivalent write. If an
   active write fails, run the suspension rollback immediately and stop.
6. Repair `20260615010000` only after the verifier and smoke test pass.
7. Apply and verify `20260615030000_profile_alias_audit.sql`, then repair
   `20260615030000`. This migration is additive and the application admin paths
   already use its service-role RPC. The earlier alias-lock trigger blocks
   direct authenticated alias changes for registered profiles. Unregistered
   profiles remain directly writable under the existing self/committee policy,
   so their audit trail is not guaranteed complete.
8. Apply and verify `20260615040000_atomic_zltac_capacity_and_captain_team.sql`,
   then repair `20260615040000`.
9. Apply and verify `20260615050000_private_backup_storage.sql`, then repair
   `20260615050000`.

Run the corresponding verifier from `supabase/verify` after each remediation
migration. Do not continue after any exception or failed smoke test.

## Phase 2: coupled security migration and deploy

1. Run `supabase/rollback/20260615060000_security_batch1_snapshot.sql` in the
   production SQL Editor. Confirm all three snapshot tables were created.
2. Run the SVG purge script without `--apply`; retain its object list in the
   deployment evidence:

   ```powershell
   npm.cmd run security:purge-svg
   ```

3. Apply `20260615060000_security_batch1.sql` and run
   `20260615060000_security_batch1_verify.sql`.
4. Repair migration history for `20260615060000`.
5. Immediately merge the approved branch and watch the Vercel production
   deployment until it is healthy. The old signing code is incompatible with
   the dropped legal-acceptance unique constraint, so signing may fail during
   this brief deployment gap.
6. After the new deployment is healthy, permanently remove the listed SVG
   objects through the Storage API:

   ```powershell
   npm.cmd run security:purge-svg -- --apply
   ```

7. Run the dry command again and require zero active SVG objects.

## Phase 3: production smoke tests

Run all of these with the new deployment live:

- Active user can update an allowed profile or registration field.
- Suspended test user is rejected by an admin/API action and cannot write
  directly through an authenticated Supabase client.
- Registration and side-event confirmation recompute `amount_owing` correctly.
- Captain creates a team through `create_zltac_captain_team`.
- User signs a legal document and a new acceptance row is inserted.
- Backup completes into the private `portal-backups` bucket and creates a
  `backup_runs` record; no PII attachment is emailed.
- Advisor retains committee access and is absent from the public committee
  roster.
- Public team/referee media pages do not reference or serve SVG uploads.

Finally run every remediation verifier again, confirm `supabase migration list
--linked` is reconciled, and record timestamps, deployment URL/ID, operator,
test accounts, verifier output, and smoke outcomes in `docs/REMEDIATION.md`.

## Rollback triggers

- Active users cannot write after suspension migration: run
  `20260615010000_suspension_enforcement_rollback.sql`, repair that version as
  reverted, and stop.
- Signing fails after the new deployment: first confirm the new code actually
  deployed. Roll the application back before running the security SQL rollback.
- Captain, alias-audit, or backup code must be rolled back: restore the previous
  application deployment before removing their database functions/tables.

Run database rollback files in the reverse order documented in
`supabase/rollback/README.md`. After each successful rollback:

```powershell
supabase migration repair --linked --status reverted <version>
```

The private-backup rollback intentionally leaves an empty private bucket;
Supabase requires bucket deletion through the Storage API or Dashboard.

## Authority boundary

Codex may prepare, validate, commit, and push the rollout artifacts. Production
mutation requires an explicit operator go-ahead for the agreed window. The
operator must remain present for account-based smoke tests and any Vercel or
Supabase confirmation prompts.
