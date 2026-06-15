# Production rollback pack

These files are operational SQL, not migrations. Never move them into
`supabase/migrations`.

## Compatibility rule

Roll application code back to the previous compatible production deployment before
rolling back `profile_alias_audit`, `atomic_zltac_capacity_and_captain_team`, or
`private_backup_storage`. The new code calls objects created by those
migrations.

`security_batch1` must be rolled back with the old signing code. Its rollback
refuses to restore the former unique constraint if duplicate attestations have
already been created. Preserve legal evidence and fix forward instead of
deleting duplicate attestations automatically.

The private-backup rollback removes `backup_runs` only when both it and the
bucket are empty. It deliberately leaves the empty private `portal-backups`
bucket because Supabase rejects direct bucket deletion from SQL. Remove that
bucket later through the Storage API or Dashboard if full cleanup is required.

## Reverse order

1. `20260615060000_security_batch1_rollback.sql`
2. `20260615050000_private_backup_storage_rollback.sql`
3. `20260615040000_atomic_zltac_capacity_and_captain_team_rollback.sql`
4. `20260615030000_profile_alias_audit_rollback.sql`
5. `20260615010000_suspension_enforcement_rollback.sql`

After each SQL rollback, mark its hosted migration history entry reverted only
when the SQL completed successfully:

```powershell
supabase migration repair --linked --status reverted <version>
```

The site-banner and documents migrations (`20260610040000` and
`20260610050000`) predate this branch and are required by current `main`; they
are not included in this rollback set.
