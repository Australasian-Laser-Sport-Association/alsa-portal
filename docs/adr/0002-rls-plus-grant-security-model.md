# ADR-0002: RLS + GRANT Security Model

**Status:** Draft — for committee review
**Date:** 2026-04-22
**Supersedes:** None

---

## Context

The ALSA Portal handles data that requires careful access control:

- **Personal information** of members and guardians, including minors
- **Required acknowledgement and consent records** (code of conduct and media
  release responses), with under-18 submissions handled separately
- **Financial records** (registration payments)
- **Committee-administered configuration** (event settings, pricing, referee test questions)

The security model must:

1. Prevent unauthenticated visitors from accessing any non-public data
2. Prevent logged-in users from accessing other users' data
3. Allow the committee to perform administrative operations without giving general users those privileges
4. Provide **defence-in-depth** — a single misconfiguration or application-level bug should not expose sensitive data
5. Be reviewable by non-specialist committee members

The model must also be compatible with the chosen stack (Supabase Postgres, accessed from a React SPA on Vercel).

## Decision

The portal uses a **three-layer access control model**:

### Layer 1 — Role GRANTs (coarse-grained, table level)

Every application table or view in the `public` schema has explicit GRANT
statements for the `anon` and `authenticated` Postgres roles. If a role has no
GRANT on a relation, it cannot access it at all - queries fail immediately with
`42501 insufficient_privilege`, before RLS policies are even evaluated.

This is the **outer perimeter**. It answers: *"Is this role allowed to touch this table, in principle?"*

### Layer 2 — Row-Level Security (RLS) policies (fine-grained, row level)

Every exposed application table has RLS enabled and only the policies needed
for its reviewed browser operations. The final browser contract is primarily
read-only; the narrow own-profile update uses `auth.uid()` to enforce ownership.
Missing operations stay denied rather than receiving placeholder policies.

This is the **inner perimeter**. It answers: *"Given this role is allowed to touch the table, which specific rows are they allowed to touch?"*

### Layer 3 — Service role for application mutations

Domain mutations (registrations, teams, payments, acknowledgements, and
under-18 submissions) and administrative operations are **not** performed
directly against application tables by browser roles. Authenticated Vercel API
routes perform them using `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS.

This is the **trusted mutation channel**. It answers: *"For application writes
that a browser must not perform directly, which server route authorises them?"*

The service role key:
- Is stored only as a Vercel environment variable, never in the frontend bundle
- Is used only from `/api/*` routes that run on Vercel's server-side runtime
- Has its usage gated by application-level account, ownership, lifecycle, and
  role checks before any privileged query runs

### Default deny

The model is **default-deny**. A new table has no GRANTs and no RLS policies, and is therefore inaccessible to everyone except `service_role` until it is explicitly opened up. Starting closed and opening selectively is preferred over starting open and closing selectively.

### Destructive operations never go to the user

DELETE is not granted to the `authenticated` role on application tables. A user
may initiate a supported removal through the UI, but the operation runs through
an authenticated API route that validates ownership, lifecycle, and any
required audit behaviour.

## Consequences

### Positive

- **Defence in depth.** A bug in the application code that accidentally queries the wrong table still cannot leak data that the role has no GRANT on. A bug in an RLS policy still cannot give a user permissions their role hasn't been granted. Possessing the public key does not permit unreviewed application-table writes.

- **Clear audit story.** For any piece of data, the question *"who can access this and how?"* has a three-part answer that can be shown to a committee member or auditor: the GRANT, the RLS policy, the API route.

- **Aligned with platform defaults.** Supabase is designed around this exact model. The approach does not fight the tooling.

- **Reviewable.** The access model lives in SQL migrations and two markdown documents. It is version-controlled, reviewed in pull requests, and inspectable by any committee member.

### Negative

- **More moving parts.** Three layers is more to get right than one. A new feature requires thinking about all three. This is mitigated with the Data Access Matrix document, which serves as a checklist.

- **Debugging requires knowing the layer.** A failed query could be any of the three layers; the symptoms differ. This is captured in the debugging table in the Data Access Matrix.

- **Service-role code is sensitive.** API routes that use the service role key are effectively running with full database access. Application-level authorisation checks must be correct. The set of service-role endpoints is kept small, well-named, and easy to audit.

### Neutral

- Migrations must include both RLS policies and GRANT statements. A migration that adds a table without GRANTs will appear broken (queries fail with 42501). This is a feature, not a bug — it forces the access model to be thought about at the time the table is created.

## Alternatives considered

### Single-layer: RLS only, no explicit GRANTs

**Rejected.** Supabase's default is to grant SELECT to `anon` and `authenticated` on all tables, relying on RLS alone for access control. This is a single point of failure: an RLS policy bug directly exposes data. It also makes the access model harder to review, because "this table has no RLS policies" quietly means "this table is readable by anyone."

### Single-layer: application-level checks only

**Rejected.** Relying on the application code to enforce access control means any bug, forgotten check, or direct database query compromises security. The database should refuse the query regardless of what the application does.

### Application writes through API routes

**Adopted for domain workflows.** Registration, team, payment,
acknowledgement, under-18, and committee mutations route through authenticated
APIs. The narrow exception is the own-profile column allow-list, where both
column grants and RLS enforce ownership. Supabase Auth operations remain direct
through the supported Auth client and are not application-table writes.

## References

- [Data Access Matrix](../security/data-access-matrix.md) — authoritative table-by-table permissions
- [Supabase documentation: Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [PostgREST documentation: Authentication and authorization](https://postgrest.org/en/stable/auth.html)
