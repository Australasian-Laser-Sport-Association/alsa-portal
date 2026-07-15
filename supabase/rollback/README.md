# Production rollback pack

These files are operational SQL, not migrations. Never move them into
`supabase/migrations` and never run them automatically from CI.

## Safety model

A code rollback and a database rollback are separate decisions. Prefer rolling
application code forward with a focused fix while keeping additive schema and
security boundaries in place. Do not deploy an application version that needs
browser grants, public storage, unsafe views, or non-atomic writes removed by a
later migration.

Every `20260713` rollback is deliberately marked
`ROLL_FORWARD_ONLY_SECURITY_BOUNDARY`. Executing one raises an exception before
changing state. This is intentional: those migrations close confirmed security
or integrity defects, or contain live evidence that a downgrade could discard.

Never mark a roll-forward-only migration as reverted with
`supabase migration repair`. Its rollback did not complete and the hosted
migration history must continue to report it as applied.

## Project verification

Production and Preview use different Supabase projects. Before any linked
migration-history or database command:

1. Identify the intended environment and expected project ref.
2. Inspect the CLI's linked project ref and compare it with the expected ref.
3. Stop if the refs differ or cannot be independently confirmed.
4. Test any genuine compatibility rollback against a disposable or staging
   database restored from a recent backup.
5. Obtain explicit maintainer approval for the exact production operation.

Do not infer production authorization from approval to author or review these
files.

## 20260713 security remediation order

Forward application order is:

1. `20260713010000_registration_insert_lockdown.sql`
2. `20260713011000_registration_under18_identity_primitives.sql`
3. `20260713012000_team_profile_write_guards.sql`
4. `20260713013000_volunteer_write_lockdown.sql`
5. `20260713020000_player_team_api_write_cutover.sql`
6. `20260713030000_atomic_competition_team_workflows.sql`
7. `20260713031000_atomic_side_event_rosters.sql`
8. `20260713032000_atomic_event_archive_and_delete.sql`
9. `20260713033000_referee_test_attempts.sql`
10. `20260713040000_add_legal_document_integrity.sql`
11. `20260713041000_add_masked_public_views.sql`
12. `20260713042000_make_legal_storage_private.sql`
13. `20260713043000_revoke_public_base_table_access.sql`
14. `20260713050000_prevent_membership_period_overlap.sql`
15. `20260713051000_harden_function_execute_privileges.sql`
16. `20260713052000_fix_team_members_recursive_rls.sql`
17. `20260713053000_preserve_anonymized_legal_evidence.sql`
18. `20260713054000_atomic_zltac_registration_lifecycle.sql`
19. `20260713055000_legal_event_lifecycle_integrity.sql`
20. `20260713056000_limit_authenticated_profile_columns.sql`
21. `20260713057000_atomic_zltac_registration_mutations.sql`
22. `20260713058000_config_and_roster_integrity.sql`
23. `20260713059000_atomic_payment_ledgers.sql`
24. `20260713060000_authenticated_data_minimization.sql`
25. `20260713061000_profile_governance_and_evidence_guards.sql`
26. `20260713062000_zltac_captain_and_team_approval_guards.sql`
27. `20260713063000_atomic_volunteer_workflows.sql`
28. `20260713064000_actor_explicit_placeholder_claim.sql`
29. `20260713065000_admin_content_write_cutover.sql`
30. `20260713065500_backup_run_concurrency_guard.sql`
31. `20260713066000_admin_content_browser_contract.sql`

The dependency order for evaluating a theoretical downgrade is the exact
reverse:

1. `20260713066000_admin_content_browser_contract_rollback.sql`
2. `20260713065500_backup_run_concurrency_guard_rollback.sql`
3. `20260713065000_admin_content_write_cutover_rollback.sql`
4. `20260713064000_actor_explicit_placeholder_claim_rollback.sql`
5. `20260713063000_atomic_volunteer_workflows_rollback.sql`
6. `20260713062000_zltac_captain_and_team_approval_guards_rollback.sql`
7. `20260713061000_profile_governance_and_evidence_guards_rollback.sql`
8. `20260713060000_authenticated_data_minimization_rollback.sql`
9. `20260713059000_atomic_payment_ledgers_rollback.sql`
10. `20260713058000_config_and_roster_integrity_rollback.sql`
11. `20260713057000_atomic_zltac_registration_mutations_rollback.sql`
12. `20260713056000_limit_authenticated_profile_columns_rollback.sql`
13. `20260713055000_legal_event_lifecycle_integrity_rollback.sql`
14. `20260713054000_atomic_zltac_registration_lifecycle_rollback.sql`
15. `20260713053000_preserve_anonymized_legal_evidence_rollback.sql`
16. `20260713052000_fix_team_members_recursive_rls_rollback.sql`
17. `20260713051000_harden_function_execute_privileges_rollback.sql`
18. `20260713050000_prevent_membership_period_overlap_rollback.sql`
19. `20260713043000_revoke_public_base_table_access_rollback.sql`
20. `20260713042000_make_legal_storage_private_rollback.sql`
21. `20260713041000_add_masked_public_views_rollback.sql`
22. `20260713040000_add_legal_document_integrity_rollback.sql`
23. `20260713033000_referee_test_attempts_rollback.sql`
24. `20260713032000_atomic_event_archive_and_delete_rollback.sql`
25. `20260713031000_atomic_side_event_rosters_rollback.sql`
26. `20260713030000_atomic_competition_team_workflows_rollback.sql`
27. `20260713020000_player_team_api_write_cutover_rollback.sql`
28. `20260713013000_volunteer_write_lockdown_rollback.sql`
29. `20260713012000_team_profile_write_guards_rollback.sql`
30. `20260713011000_registration_under18_identity_primitives_rollback.sql`
31. `20260713010000_registration_insert_lockdown_rollback.sql`

Do not execute that list. Every item stops fail closed. In particular, never
skip `54000`, `55000`, `56000`, `57000`, `58000`, `59000`, `60000`, `61000`, `62000`, `63000`, `64000`, `65000`, `65500`, or `66000`
and continue with an older downgrade: doing so would mix incompatible
lifecycle, evidence, privilege, and roster contracts.

## Older guarded compatibility rollbacks

The older `20260615` pack predates the roll-forward-only remediation. If a
maintainer explicitly approves a genuine database downgrade, its dependency
order remains:

1. `20260615060000_security_batch1_rollback.sql`
2. `20260615050000_private_backup_storage_rollback.sql`
3. `20260615040000_atomic_zltac_capacity_and_captain_team_rollback.sql`
4. `20260615030000_profile_alias_audit_rollback.sql`
5. `20260615010000_suspension_enforcement_rollback.sql`

Roll application code back to the previous compatible deployment first. The
`security_batch1` rollback refuses to restore its former unique constraint when
duplicate attestations exist. Preserve legal evidence and fix forward rather
than deleting attestations. The private-backup rollback removes `backup_runs`
only when it and the bucket are empty; it deliberately leaves an empty private
`portal-backups` bucket for later Storage API or Dashboard cleanup.

After a non-fail-only SQL rollback has completed successfully and its invariants
have been verified, reconcile only that version's hosted migration history:

```powershell
supabase migration repair --linked --status reverted <version>
supabase migration list --linked
```

The site-banner and documents migrations (`20260610040000` and
`20260610050000`) are required by current `main` and are not included here.
