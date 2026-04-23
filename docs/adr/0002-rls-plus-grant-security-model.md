# ADR-0002: RLS + GRANT Security Model

**Status:** Draft — for committee review
**Date:** 2026-04-22
**Supersedes:** None

---

## Context

The ALSA Portal handles data that requires careful access control:

- **Personal information** of members and guardians, including minors
- **Legal audit trail** (signed policy acknowledgements, media releases, under-18 submissions)
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

Every table in the `public` schema has explicit GRANT statements for the `anon` and `authenticated` Postgres roles. If a role has no GRANT on a table, it cannot access that table at all — queries fail immediately with `42501 insufficient_privilege`, before RLS policies are even evaluated.

This is the **outer perimeter**. It answers: *"Is this role allowed to touch this table, in principle?"*

### Layer 2 — Row-Level Security (RLS) policies (fine-grained, row level)

Every table has RLS enabled and has explicit policies for SELECT, INSERT, UPDATE, and DELETE. Policies typically use the authenticated user's ID (`auth.uid()`) or role (`is_committee()`) to constrain which rows the query can see or modify.

This is the **inner perimeter**. It answers: *"Given this role is allowed to touch the table, which specific rows are they allowed to touch?"*

### Layer 3 — Service role for privileged operations

Administrative operations (deleting teams, updating payment status, editing event settings, managing policy versions) are **not** performed by authenticated users directly. They are performed by server-side Vercel API routes that use the `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS entirely.

This is the **privileged channel**. It answers: *"For actions that no ordinary user should be able to perform, who performs them and where?"*

The service role key:
- Is stored only as a Vercel environment variable, never in the frontend bundle
- Is used only from `/api/*` routes that run on Vercel's server-side runtime
- Has its usage gated by application-level authorisation checks (e.g., "is this user a committee member?") before any privileged query runs

### Default deny

The model is **default-deny**. A new table has no GRANTs and no RLS policies, and is therefore inaccessible to everyone except `service_role` until it is explicitly opened up. Starting closed and opening selectively is preferred over starting open and closing selectively.

### Destructive operations never go to the user

DELETE is never granted to the `authenticated` role on any table where deletion has cascading consequences (teams, registrations, payments, users). Users can *appear* to delete things through the UI, but the underlying operation routes through an API endpoint that uses the service role and writes an audit record.

## Consequences

### Positive

- **Defence in depth.** A bug in the application code that accidentally queries the wrong table still cannot leak data that the role has no GRANT on. A bug in an RLS policy still cannot give a user permissions their role hasn't been granted. Compromising the anon key still cannot write to any table.

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

### All writes through API routes (no `authenticated` write GRANTs at all)

**Considered, partially adopted.** Destructive and privileged writes route through API routes, but authenticated users perform their own registration-flow writes directly against the database (with RLS enforcing ownership). Routing every write through a custom API would have doubled the surface area for limited additional security benefit, given that RLS already enforces ownership at the row level.

## References

- [Data Access Matrix](../security/data-access-matrix.md) — authoritative table-by-table permissions
- [Supabase documentation: Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [PostgREST documentation: Authentication and authorization](https://postgrest.org/en/stable/auth.html)
