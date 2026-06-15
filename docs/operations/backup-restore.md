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

## Free-plan full database recovery

This is disaster recovery, not the primary rollback path for a failed
migration. Expect at least 30-60 minutes of downtime and use the per-migration
reverse SQL first whenever the database is otherwise healthy.

The verified recovery model is:

1. Create a fresh Supabase project in the same region where practical.
2. Link a clean checkout of the repository to the replacement project.
3. Apply the repository migrations so Supabase's platform-managed Auth and
   Storage schemas and the application schema exist together.
4. Import the verified `data.sql` export with triggers disabled as emitted by
   `supabase db dump --data-only --use-copy`.
5. Reconcile Auth user, profile, event, registration, team, legal-acceptance,
   Storage bucket, and Storage object row counts.
6. Reconfigure project secrets, Auth URLs, SMTP, cron, and Vercel environment
   variables before directing traffic to the replacement project.

The 2026-06-15 drill restored the repository-equivalent Supabase schema into a
disposable local database and loaded the production data export without SQL or
COPY errors. A standalone schema dump is not sufficient to recreate Supabase's
platform-managed schemas.

Database dumps restore Storage metadata only. They do not contain uploaded file
bytes. A full replacement-project restore can therefore leave object records
whose files are missing. Maintain a separate private copy of required Storage
objects or accept that those files must be re-uploaded.

For encrypted off-machine copies, test both archive integrity and decryption
before treating the copy as recoverable. Never commit an export or encrypted
archive to Git.
