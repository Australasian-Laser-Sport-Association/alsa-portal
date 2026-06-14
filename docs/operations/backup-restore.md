# Backup and restore runbook

Portal backups are written by the service-role cron to the private
`portal-backups` Supabase Storage bucket. Each run has its own prefix containing
three CSV files and `manifest.json`. The manifest records row counts and SHA-256
digests so downloads can be checked before use.

## Restore procedure

1. Download one complete prefix using an authorized service-role process. Never
   make the bucket public or email the files.
2. Verify each file's SHA-256 digest against `manifest.json`.
3. Restore into a non-production Supabase project first.
4. Import events, registrations, then payment records with a reviewed importer
   that maps current primary and foreign keys.
5. Reconcile manifest counts, registration totals per event, payment totals,
   and a sample of member records.
6. Take a fresh production database backup before an approved production
   restore, then repeat the reconciliation.

Run a non-production restore exercise before launch and after material schema
changes. A stored export that has never been restored is not a proven backup.
