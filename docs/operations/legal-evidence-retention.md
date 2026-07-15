# Legal Evidence Retention and Account Deletion

## Current policy

Permanent account deletion does not delete signed legal acceptances or
under-18 approval decisions. Those rows are retained pseudonymously pending a
maintainer-approved retention schedule.

This document intentionally states no statutory retention duration. ALSA must
approve a schedule with appropriate legal and privacy advice before automated
expiry or evidence destruction is implemented.

Migration `20260713053000_preserve_anonymized_legal_evidence.sql` enforces the
following database behaviour:

- the subject `user_id` link is removed;
- acceptance IP addresses and user agents are cleared;
- under-18 free-text notes are cleared;
- under-18 reviewer profile links are removed when the subject or reviewer
  account is deleted;
- one random `subject_token` correlates that deleted subject's retained rows
  without retaining their profile or auth identifier;
- anonymized evidence cannot be updated or deleted;
- an event with legal or under-18 evidence cannot be hard-deleted and must be
  archived instead.

The token is pseudonymous evidence metadata, not proof of anonymity against all
external information. It must not be exported into public reports or used to
re-identify a person.

## Account deletion workflow

The superadmin user screen shows four separate impact groups before deletion:

1. rows permanently deleted by profile cascades;
2. evidence retained and anonymized;
3. links removed from otherwise surviving records;
4. committee audit references that block deletion.

When blockers exist, use **Remove access**. Do not edit attribution fields only
to make a hard delete succeed. A later policy may define a separately audited
way to transfer or pseudonymize those references.

The API rebuilds the impact immediately before deletion. Database foreign keys
and triggers remain the final authority if data changes after the preview.

## Release and verification

Apply migration 53000 after migrations 40000 and 32000. Run:

```text
supabase/verify/20260713053000_preserve_anonymized_legal_evidence_verify.sql
```

In a disposable or staging database, verify all of these cases:

- deleting an account with acceptances retains the evidence, clears IP and
  user-agent fields, and removes the profile;
- deleting an under-18 subject retains status, timestamps, event, and document
  evidence while clearing profile links and notes;
- every retained row for one deleted subject receives the same token;
- an update or delete against anonymized evidence fails;
- deleting a reviewer unlinks the reviewer without deleting the subject's
  decision evidence;
- hard-deleting an event with either evidence type returns a conflict directing
  the committee to archive it;
- hard-deleting an event with no retained evidence still follows the existing
  controlled delete workflow;
- the admin preview categories and the successful API response report the same
  impact snapshot.

Use only synthetic accounts and evidence in these tests.

## Rollback boundary

Rollback must be performed in reverse migration order: 53000 before 40000 or
32000. The 32000 rollback refuses to run while the 53000 marker columns exist.

The 53000 rollback refuses to run after any subject evidence or reviewer link
has been anonymized because the original identifiers cannot be reconstructed.
At that point, keep the migration and use a reviewed roll-forward fix. A legal
document uploader link already cleared by account deletion is not restored by
rollback.
