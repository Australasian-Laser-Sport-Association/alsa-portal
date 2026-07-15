# Backup and restore runbook

Portal backups are written by the service-role cron to the private
`portal-backups` Supabase Storage bucket. Each run has its own prefix containing
four CSV files and `manifest.json`: registrations, payments, events, and the
immutable privileged asset-upload audit. The manifest records row counts and
SHA-256 digests so downloads can be checked before use.

These CSV snapshots are an operational convenience, not disaster recovery.
They are incomplete exports and live in the same Supabase project as the
primary database. Loss or compromise of that project can remove both copies.

## Portal export failure recovery

Migration `20260713065500_backup_run_concurrency_guard.sql` must be applied
before deploying the API that calls its backup lifecycle functions. Scheduled
and manual exports share a database singleton lease and have separate global,
distributed rate limits. HTTP 409 means another export owns the lease; HTTP
429 means the caller must wait for the rate-limit window. In production, a
missing or unavailable distributed limiter stops the request with HTTP 503.

The worker records every candidate Storage path before uploading. A failed
`backup_runs` row with a non-empty `object_paths` array means deletion was not
confirmed. The next backup run retries those private-object removals and only
clears the array after Storage reports success. Do not clear the paths or
delete the row manually unless an operator has verified that every listed
object is absent. Alert on failed rows whose paths remain after the next
successful run.

## Required recovery layers

Before production launch, the maintainer must configure and record all three:

1. Supabase managed database backups with point-in-time or daily recovery as
   the primary database recovery layer.
2. Encrypted database dumps stored in a different provider account, with the
   encryption key held separately from both Supabase and the backup account.
3. A private off-project mirror of Storage object bytes, including
   acknowledgement and consent source documents, guardian forms, event media,
   team logos, and other required uploads.

The provider-neutral workflow at
`.github/workflows/disaster-recovery-backup.yml` creates a PostgreSQL 17 custom
dump with the digest-pinned Linux/AMD64
`postgres:17.10-alpine3.24@sha256:af194ccf3e2d7fe367012c7b88ce8b816c5c889b18a5b316799a1f0d7eac746a`
tool image. It validates the database archive with `pg_restore --list`, copies
every Storage bucket through Supabase's S3 endpoint, validates the resulting
tar archive, encrypts both archives with `age`, and uploads them to a
separately credentialed S3-compatible destination. Before reporting success,
it downloads all four objects to a fresh runner directory, confirms that the
downloaded checksum file matches the one just generated, and runs
`sha256sum -c`. `SHA256SUMS` covers both
encrypted archives and `manifest.json`; a later restore drill must still prove
decryption and restoration.

The job reads its secrets from the protected GitHub Environment named
`disaster-recovery`. Restrict that environment to the protected `main` branch;
the workflow also refuses to run from any other ref.
Scheduled runs remain disabled until the repository variable
`DR_BACKUPS_ENABLED` is explicitly set to `true`. A maintainer-triggered
`workflow_dispatch` intentionally bypasses that flag so the first backup and
restore drill can bootstrap the schedule. GitHub evaluates the job-level
condition before environment-level variables are available, so keep
`DR_BACKUPS_ENABLED` and the non-sensitive optional `DR_DEST_PREFIX` at
repository level. Do not enable the schedule until the manual backup and
restore drill has passed. This prevents an unconfigured scheduled workflow from
pretending that disaster recovery exists.
Do not add a required-review wait that unattended scheduled runs cannot
satisfy. Protect the workflow itself with the branch rule requiring at least
one independent approving pull-request review, without a bypass actor. The
workflow injects each credential only into its configuration check and the one
operational step that needs it; keep future steps equally narrow.

Configure `DR_SOURCE_S3_REGION` to the Supabase project's region and
`DR_DEST_S3_REGION` to the independent provider's signing region. These are
required even when a custom endpoint is supplied. Keep each region beside its
matching endpoint and credentials in the protected GitHub Environment so a
request cannot be signed for the other provider by mistake.

The database dump and Storage sync are sequential, not one atomic snapshot.
The manifest records when each stage completed so a restore operator can see
the consistency window. Run pre-migration backups during the write-maintenance
window. Scheduled backups should run during a low-write period, retain source
object versions at the destination, and reconcile database `storage.objects`
rows with extracted bytes during every drill.

The repository does not provision a paid backup provider or hold its
credentials. Record the chosen provider, retention policy, owners, GitHub
Actions failure-alert destination, and age private-key recovery process in the
committee password vault and the private operations register. Configure
versioning/object lock and retention at the destination account so compromise
of the source GitHub or Supabase account cannot silently rewrite all copies.

Recommended minimum disaster-recovery retention is 30 daily database copies
and 12 monthly copies. Retain source-document versions and operational records
only for the separate schedule approved by ALSA. Configure backup expiry so
account or event deletion does not create indefinite retention in old archives.

## Verify one backup set

Download one complete off-project prefix into an access-controlled working
directory. Never make the destination public or email the files. The expected
files are `database.dump.age`, `storage.tar.gz.age`, `manifest.json`, and
`SHA256SUMS`.

```bash
set -euo pipefail
sha256sum -c SHA256SUMS
age --decrypt --identity "$AGE_IDENTITY_FILE" \
  --output database.dump database.dump.age
age --decrypt --identity "$AGE_IDENTITY_FILE" \
  --output storage.tar.gz storage.tar.gz.age
pg_restore --list database.dump > database.restore-list
tar -tzf storage.tar.gz > storage.archive-list
jq -e '.format_version == 1 and (.storage_buckets | length > 0)' manifest.json >/dev/null
```

The hash check must pass before decryption. Review both lists for unexpected
schemas, buckets, or paths without opening member data. Confirm the manifest's
database and Storage completion timestamps are plausible and in order.

## Disposable database restore drill

The workflow artifact is a full custom-format `pg_dump`, not the `data.sql`
file produced by `supabase db dump --data-only`. Do not feed it to a data-only
procedure or blindly restore it over an already-provisioned hosted project.

For the first integrity stage, use a disposable PostgreSQL database inside a
matching local Supabase stack. The local stack supplies the Supabase extensions
and cluster roles referenced by the dump. Never point these commands at a
linked or remote database.

```powershell
supabase start
$env:PGHOST = '127.0.0.1'
$env:PGPORT = '54322'
$env:PGUSER = 'postgres'
$env:PGPASSWORD = 'postgres'
$env:PGDATABASE = 'postgres'

createdb --template=template0 alsa_dr_restore
pg_restore --exit-on-error --dbname=alsa_dr_restore database.dump
psql --dbname=alsa_dr_restore --set=ON_ERROR_STOP=1 --file=supabase/verify/20260713_pre_remediation_inventory.sql
```

Use a new disposable database for every attempt. A successful command proves
the custom archive can be read and restored in a Supabase-capable PostgreSQL
cluster. It does not yet prove that a fresh hosted project's Auth, Storage, and
API services accept the restored state.

## Replacement-project recovery drill

1. Create a disposable Supabase project in the same region and PostgreSQL major
   version as production. Record its project ref privately.
2. Use `pg_restore --list database.dump` to create a reviewed restore list for
   the current provider version. A fresh hosted project already owns platform
   schemas and roles, so do not use `--clean`, do not drop platform schemas, and
   do not improvise filters during an incident.
3. Rehearse the provider-supported restore into that disposable project using
   the reviewed list. Save the exact successful `pg_restore --use-list` command
   and list file in the private operations register. The list can contain
   schema details and must not be committed if it reveals the deployment.
4. Extract `storage.tar.gz`, compare its bucket names with both
   `manifest.json` and restored `storage.buckets`, then upload every bucket
   through the replacement project's S3 endpoint.
5. Reconcile Storage metadata to actual bytes in both directions: no database
   object may be missing a byte object, and no restored byte object may be
   unaccounted for. Investigate changes made inside the manifest consistency
   window explicitly.
6. Reconcile Auth user, profile, event, registration, payment,
   acknowledgement, under-18, membership, referee-attempt, bucket, and object
   counts. Run every migration verifier and database test that is safe for
   restored data.
7. Configure replacement Auth URLs, SMTP, secrets, cron, and a protected Vercel
   deployment. Exercise sampled login, public-asset, registration, payment, and
   committee workflows without redirecting production traffic.
8. Record elapsed time, commands, filtered restore list, row/object totals,
   discrepancies, and sign-off. Destroy the disposable project and working
   copies after the approved restore-drill result is recorded without member
   row data.
9. Before an approved real recovery, take another production backup if the
   source remains accessible and repeat only the already-rehearsed procedure.

Run a non-production restore exercise before launch and after material schema
changes. A stored export that has never been restored is not a proven backup.

Run a complete drill at least quarterly into a disposable project. Capture the
date, operator, source backup identifier, elapsed restore time, row/object
reconciliation, sampled login and registration journeys, failures, and the
next remediation owner. A successful drill restores database data and Storage
bytes without reading from the primary project.

## Incident use

Disaster recovery is not the primary response to a failed migration. The July
2026 remediation boundaries are roll-forward-only, so their rollback files
intentionally stop without changing state. Prefer a compatible application
rollback or reviewed roll-forward fix while the database is healthy.

Expect meaningful downtime for replacement-project recovery. Never discover a
restore filter, missing key, Storage gap, or provider incompatibility during
the incident itself. An encrypted archive is not recoverable evidence until
the exact workflow artifact has passed both the local archive restore and the
hosted replacement-project drill above. Never commit an export, decrypted
working copy, restore list containing deployment details, or encrypted archive
to Git.
