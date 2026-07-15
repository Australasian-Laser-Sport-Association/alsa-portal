# Data Access Matrix

**Status:** Active
**Last updated:** 2026-07-15
**Related:** [ADR-0002: RLS + GRANT Security Model](../adr/0002-rls-plus-grant-security-model.md)

## Purpose

This document summarizes the ALSA Portal's reviewed browser-facing database surfaces. It is a concise starting point for questions such as "can user X see or change data Y?"

The committed migrations, live Postgres catalog, and matching files in `supabase/verify/` are authoritative. Never add or restore a grant or policy solely to make the database match this document. If this summary and a verifier disagree, stop the rollout and review the migration history.

## Enforcement model

Browser access is enforced by both:

1. A Postgres grant that permits the operation on the table, view, or exact columns.
2. An RLS policy that admits the specific row.

Application code selects the intended surface, but it is not a substitute for grants and RLS because a user can call the Supabase Data API directly.

The roles in this matrix are:

| Role | Represents | Intended use |
|---|---|---|
| `anon` | Unauthenticated visitor | Public discovery and published content |
| `authenticated` | Signed-in portal account | Actor-owned data and reviewed public/configuration reads |
| `service_role` | Server-side Vercel API routes | Privileged, cross-user, and mutation workflows; bypasses RLS |

`SUPABASE_SERVICE_ROLE_KEY` is server-only and must never be bundled into the browser.

### Final browser contract

- `anon` and `authenticated` have no `INSERT`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, or `MAINTAIN` privilege in `public`.
- They have no `UPDATE` privilege in `public` except the exact own-profile column allow-list documented below.
- Browser roles have no privilege on `public` sequences. New application objects created by the `postgres` migration role fail closed through default privileges until a reviewed migration grants access. The final verifier rejects application objects owned by the platform `supabase_admin` role rather than assuming its defaults are application-controlled.
- Committee, superadmin, advisor, captain, and competition-manager authority does not create a direct cross-user browser database path. Privileged reads and writes use authenticated server routes with current role and account-status checks.
- Storage is a separate, Supabase-owned boundary. The Data API exposed-schema allow-list is exactly `public`; GraphQL is not an application dependency. No policy on a Storage relation applies to `public`, `anon`, or `authenticated`, so browser sessions cannot list object metadata or perform direct mutations. Public bucket bytes remain available by exact URL and are delivered through branded `/assets/...` routes. Team-logo writes use the authenticated, ownership-checked, phase-checked, rate-limited `/api/captain` route. Admin content uses exact-path, non-upsert signed upload capabilities issued by a rate-limited server route. Avatar mutation is disabled until it has an equivalent server-authorised workflow. Application migrations preserve the Supabase-owned Storage tables, their owner, and RLS setting.

## Public and configuration reads

| Surface | `anon` | `authenticated` | Contract and canonical application path |
|---|---|---|---|
| `public_zltac_events`, `public_competitions` | SELECT | SELECT | Masked discovery views. Sensitive base-table fields such as banking details and internal notes are absent. Public API: `/api/public?resource=event` and `resource=competitions`. |
| `public_zltac_teams`, `public_event_roster`, `public_competition_roster_safe` | SELECT | SELECT | Approved, alias-only roster presentation. Profile IDs, legal names, suspended accounts, and unapproved teams are excluded. Public API: `/api/public?resource=roster`. |
| `public_zltac_event_history`, `public_zltac_legends`, `public_zltac_dynasties`, `public_zltac_hall_of_fame` | SELECT | SELECT | Published history views. Hidden entries and `internal_notes` remain in server-only base tables. |
| `referee_questions_public`, `public_referee_test_settings` | SELECT | SELECT | Player-facing questions and settings without answer keys or internal configuration. |
| `zltac_event_placings` | SELECT | SELECT | Public results data. Browser writes are revoked. |
| `document_categories`, `documents`, `cms_global` | SELECT | SELECT | Published resources and the site banner. Committee changes use audited admin APIs. |
| `alsa_membership_periods` | SELECT | SELECT | Public membership-period definitions only. Member records are server-only. |
| `volunteer_roles`, `event_volunteer_settings` | None | SELECT | Signed-in volunteer configuration. Signup records and decisions are server-only. |

The compatibility view `public_competition_roster` may remain during rollout, but its identity and legal-name columns are always `NULL`. New consumers use `public_competition_roster_safe`.

## Actor-owned browser reads

| Table or view | `anon` | `authenticated` | RLS and grant intent |
|---|---|---|---|
| `profiles` | None | Own-row, column-limited SELECT and UPDATE | SELECT exposes only the reviewed account fields and never `email`. UPDATE is limited to `first_name`, `last_name`, `alias`, `dob`, `phone`, `state`, `home_arena`, `emergency_contact_name`, and `emergency_contact_phone`, with `profiles_update_own` enforcing `id = auth.uid()`. Profile creation is performed by the auth trigger. |
| `own_zltac_teams` | None | SELECT | Actor-scoped captain/manager presentation without ownership profile identifiers. Team reads and mutations outside this view use `/api/player`, `/api/captain`, or admin APIs. |
| `zltac_registrations` | None | Own-row, column-limited SELECT | Reviewed registration fields only. All registration mutations use `/api/player?resource=registration`. |
| `competition_registrations` | None | Own-row SELECT | All registration and payment-sensitive mutations use `/api/superadmin/[resource]` server workflows. |
| `doubles_pairs`, `triples_teams` | None | Own-membership SELECT | A player sees formations containing their user ID. Pair/triple writes use `/api/player`. |
| `referee_test_results` | None | Own-row SELECT | Attempts and result creation are server-authoritative. |
| `payments` | None | Own-row SELECT | Legacy payment ledger is browser read-only. |
| `payment_records` | None | Own-linked-registration SELECT | A player can read payment entries linked to their own ZLTAC or competition registration. All writes use server routes. |

## Legal evidence and under-18 records

Legal evidence is append-only from the user's perspective. Browser roles cannot insert, update, or delete these records after the final cutover.

| Table | `anon` | `authenticated` | Contract and canonical path |
|---|---|---|---|
| `legal_documents` | None | Column-limited active or own-accepted version metadata | Publication writes are service-only. The canonical public catalogue is `/api/public?resource=required-documents`; PDFs are delivered only through branded `/documents/...` routes backed by a private bucket. |
| `legal_acceptances` | None | Own-row SELECT | Signing uses `/api/player?resource=registration`; the server records the document hash and request evidence. Cross-user reporting uses admin APIs. |
| `under_18_approvals` | None | Own-row SELECT | Submission uses `/api/player?resource=registration`; committee decisions use `/api/admin/event?resource=under-18-approvals`. |
| `payment_records_history` | None | None | Immutable payment audit history is service-only. |

## Server-only sensitive surfaces

The following relations have no browser SELECT path. `service_role` retains access only through vetted routes:

- Membership and governance: `alsa_memberships`, `alsa_lifetime_members`
- Operational authority: `competition_managers`, `team_members`, `volunteer_signups`, `volunteer_signup_roles`
- Backup state: `backup_runs`, `backup_settings`
- Internal workflow state: `payment_mutation_requests`, `profile_governance_state`, `referee_test_attempts`, `zltac_side_event_roster_members`
- Audit evidence: `admin_asset_upload_audit`, `admin_content_mutation_audit`, `payment_records_history`, `placeholder_merge_audit`, `profile_access_audit`, `profile_change_audit`, `zltac_event_lifecycle_audit`
- Sensitive content bases: `zltac_events`, `competitions`, `teams`, `referee_questions`, `referee_test_settings`, and the ZLTAC history/legend/dynasty/hall-of-fame base tables
- Retired internal projection: `public_competition_roster`; browser consumers use `public_competition_roster_safe`

Cross-user reads of actor-owned tables, including profiles, registrations, payments, legal acceptances, and minor approvals, are also server-only even though each user may retain a narrow own-row SELECT policy.

The principal trusted routes are:

- `/api/public` for filtered public event, committee, membership, competition, roster, legal-document, and branded asset delivery
- `/api/player` and `/api/captain` for actor-bound workflows
- `/api/admin/event`, `/api/admin/users`, and `/api/admin/volunteers` for committee workflows
- `/api/superadmin/[resource]` for competition and superadmin workflows

## Removed CMS surfaces

`cms_pages` and `cms_sections` were removed under ADR-0004. Page content is maintained in the codebase and deployed through GitHub and Vercel. `cms_global` exists only for the reviewed site-banner record and is not a general-purpose CMS.

## Operational notes

### Adding a browser-readable table or view

1. Add the object in a committed migration.
2. Enable RLS on exposed tables and add a narrowly scoped SELECT policy.
3. Grant only the exact role, operation, and columns required. Do not rely on default privileges.
4. Keep mutations in an authenticated service route unless the reviewed exception is an own-profile update or signed Storage capability.
5. Add catalog and behavior tests, update the matching verifier, and update this matrix.

### Debugging access

| Symptom | Likely cause | Check |
|---|---|---|
| HTTP 401 or 403 with Postgres code `42501` | Missing table or column grant | `has_table_privilege`, `has_any_column_privilege`, and column ACLs |
| HTTP 200 with an empty result, or a mutation affecting zero rows | RLS denial | `pg_policies`, authenticated user ID, and policy expression |
| HTTP 401 with `Invalid API key` | Wrong or missing public key | Vercel environment scopes |
| HTTP 401 with `JWT expired` | Expired client session | Refresh or re-authenticate |

### Verifying the matrix

Run `npm run test:db:verify` against the intended migration state first. The query below is useful inventory, but it does not prove row ownership, view safety, function ACLs, default privileges, or inherited role membership.

```sql
SELECT relation.relname,
       has_any_column_privilege('anon', relation.oid, 'SELECT') AS anon_select,
       has_any_column_privilege('authenticated', relation.oid, 'SELECT') AS auth_select,
       has_any_column_privilege('authenticated', relation.oid, 'INSERT') AS auth_insert,
       has_any_column_privilege('authenticated', relation.oid, 'UPDATE') AS auth_update,
       has_table_privilege('authenticated', relation.oid, 'DELETE') AS auth_delete
FROM pg_class AS relation
JOIN pg_namespace AS relation_schema
  ON relation_schema.oid = relation.relnamespace
WHERE relation_schema.nspname = 'public'
  AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
ORDER BY relation.relname;
```
