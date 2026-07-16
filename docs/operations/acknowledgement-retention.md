# Acknowledgement and Under-18 Record Retention

> The `legal_documents` and `legal_acceptances` database names are legacy
> technical identifiers, not a statement that these records are electronic
> signatures or formal legal documents.

## Record purpose

The portal presents versioned documents such as the code of conduct and media
release, then records that a signed-in account agreed to the applicable version
for an event. An acknowledgement records the account, event, document version
and hash, and acceptance timestamp. It does not capture a drawn or typed
signature and must not be described as an electronic-signature service.

Under-18 parental consent and committee approval are a separate operational
workflow. They are not part of the general acknowledgement record and must not
be presented as though the player signed on behalf of a parent or guardian.

## Current retention contract

Migration `20260713053000_minimise_acknowledgement_metadata.sql` implements the
following simplified behaviour:

- existing acceptance IP addresses and user agents are cleared;
- new acceptances must keep both request-metadata fields `NULL`;
- the accepted document hash, account, event, and timestamp remain available
  while the related account and event exist;
- removing access or deleting the Auth account deletes that person's
  acknowledgements and under-18 approval while retaining only the disabled,
  de-identified profile key required by other governance history;
- hard deletion of an otherwise empty placeholder retains the normal database
  cascade backstop;
- controlled hard deletion of an event deletes the event's acknowledgements and
  under-18 approvals;
- no pseudonymous subject token or permanent anonymized record is retained; and
- published document versions remain protected against in-place replacement so
  an existing acknowledgement continues to identify the content presented at
  the time.

These are ordinary association records. ALSA should approve a practical
retention schedule for active and archived events, source-document versions,
operational exports, and disaster-recovery backups. This runbook makes no claim
that a statutory or indefinite retention period applies. Backup rotation must
not become an accidental way to keep deleted account records forever.

## Account and event deletion

The superadmin deletion preview includes acknowledgement and under-18 rows in
the deleted category. Their presence means the account is not a truly empty
placeholder, so the permanent-delete API directs the committee to **Remove
access**. That operation deletes the subject's acknowledgement and under-18
rows inside the same transaction that de-identifies and disables the retained
governance profile. Auth-account deletion performs the same cleanup. Reviewer
attribution is detached from another subject's under-18 decision rather than
deleting that decision. The API rebuilds hard-delete impact immediately before
any permitted deletion.

Event archiving is the normal lifecycle choice when an event should remain in
history. If a superadmin deliberately uses the controlled hard-delete workflow,
the event's acknowledgement and under-18 records are deleted with it; they do
not block the operation.

## Release and verification

Apply migration 53000 after migrations 40000 and 32000. Run:

```text
supabase/verify/20260713053000_minimise_acknowledgement_metadata_verify.sql
```

In a disposable or staging database, verify all of these cases:

- applying the migration clears existing acceptance IP and user-agent values;
- creating an acceptance with either request-metadata field populated fails;
- a normal acceptance records the exact document hash, account, event, and
  timestamp with both request-metadata fields `NULL`;
- remove-access and Auth-account deletion each remove the subject's
  acknowledgements and under-18 approval while retaining the disabled profile
  tombstone;
- each removal path clears reviewer attribution without deleting another
  subject's under-18 decision;
- hard deletion at the database lifecycle boundary retains the cascade
  backstop;
- the superadmin preview classifies those rows as deleted and refuses permanent
  deletion of that non-empty account;
- deleting a reviewer account does not prevent normal handling of a separate
  player's under-18 record;
- controlled hard deletion of an event removes its acknowledgement and
  under-18 records;
- archiving an event leaves its operational records available; and
- an empty placeholder's admin deletion preview and successful API response
  report the same impact snapshot.

Use only synthetic accounts, acknowledgements, and under-18 records in these
tests.

## Rollback boundary

Migrations 32000, 40000, and 53000 have no executable rollback. Their rollback
files raise an exception unconditionally and document a roll-forward-only
security boundary. Keep them applied and use a reviewed forward migration or
application fix when behaviour needs to change.

Migration 53000 is a data-minimisation boundary, not a permanent evidence
retention boundary. Once pre-existing IP addresses and user agents are cleared,
an application or schema rollback cannot reconstruct them. They are not needed
for the acknowledgement workflow and must not be restored from a backup during
a routine rollback. Pre-migration backups remain for disaster recovery under
the approved backup-retention schedule, not for reintroducing request metadata
or indefinite acknowledgement retention.
