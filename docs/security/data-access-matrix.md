# Data Access Matrix

**Status:** Active
**Last updated:** 2026-04-22
**Related:** [ADR-0002: RLS + GRANT Security Model](../adr/0002-rls-plus-grant-security-model.md)

---

## Purpose

This document is the authoritative reference for who can access what in the ALSA Portal database. It exists so that any future question of the form *"can user X see data Y?"* has a single, reviewable answer.

Every table in the `public` schema is listed below with:
- Which roles have table-level GRANT permissions
- The rationale for those permissions
- The intended Row-Level Security (RLS) policies that further constrain access

## How to read this document

Database access in the ALSA Portal is enforced by **three layers**, all of which must pass for a query to succeed:

1. **Role GRANT** — does the Postgres role have permission on the table at all?
2. **Row-Level Security (RLS) policy** — does the specific row match a policy the role is allowed to apply?
3. **Application logic** — does the application code even attempt the query?

If layer 1 fails, the query returns HTTP 401 with Postgres error code `42501` (*insufficient_privilege*). If layer 1 passes but layer 2 denies, the query returns HTTP 200 with an empty result set. This distinction matters when debugging.

The three roles that appear in this matrix:

| Role | Who it represents | Typical use |
|---|---|---|
| `anon` | Unauthenticated visitors | Public pages, pre-login content |
| `authenticated` | Logged-in users | Player hub, registration, captain hub, referee test |
| `service_role` | Server-side admin code | API routes that run admin operations; **bypasses RLS entirely** |

`service_role` is used exclusively from server-side Vercel API routes using the `SUPABASE_SERVICE_ROLE_KEY` environment variable. It is **never** exposed to the browser.

---

## Matrix

Legend: ✅ granted, ❌ not granted, ⚙️ granted at GRANT level but restricted by RLS

### Public event data

| Table | anon | authenticated | RLS intent |
|---|---|---|---|
| `zltac_events` | SELECT | SELECT | Public read for events with status `open`, `closed`, or `archived`. Committee read all via `is_committee()`. Committee write. |
| `zltac_event_history` | SELECT | SELECT | Public read all. Committee write. |
| `event_side_events` | SELECT | SELECT | Public read. Committee write via service role. |
| `event_pricing` | SELECT | SELECT | Public read. Committee write via service role. |

### User identity

| Table | anon | authenticated | RLS intent |
|---|---|---|---|
| `profiles` | ❌ | SELECT, INSERT, UPDATE | Users read/update their own profile. Committee reads all via service role. |

### Teams and pair/triple formations

| Table | anon | authenticated | RLS intent |
|---|---|---|---|
| `teams` | ❌ | SELECT, INSERT, UPDATE | Authenticated users read teams they're a member of. Captains update their own team. **DELETE is service-role only** — destructive, cascades into registrations/payments. |
| `doubles_pairs` | ❌ | SELECT, INSERT, UPDATE, DELETE | Users manage their own pairings. |
| `triples_teams` | ❌ | SELECT, INSERT, UPDATE, DELETE | Users manage their own triples. |

### Registration and payments

| Table | anon | authenticated | RLS intent |
|---|---|---|---|
| `event_registrations` | ❌ | SELECT, INSERT, UPDATE | Users read/update their own registration. Committee reads all via service role. |
| `zltac_registrations` | ❌ | SELECT, INSERT | Users create own registration, read own record. Updates handled by service role. |
| `payments` | ❌ | SELECT, INSERT | Users insert on checkout, read own records. **Payment status updates are service-role only** (webhook callbacks from payment provider). |
| `event_settings` | ❌ | SELECT | Authenticated users read current settings (e.g., "registration open until X"). **Writes are service-role only.** |

### Policy acknowledgements (legal audit trail)

These tables form an **immutable audit trail**. Once a user signs a policy version, that row cannot be edited or deleted through the API.

| Table | anon | authenticated | RLS intent |
|---|---|---|---|
| `code_of_conduct_versions` | SELECT | SELECT | Public read (anyone can view current policy). Writes service-role only. |
| `code_of_conduct_signatures` | ❌ | SELECT, INSERT | Users insert own signature, read own. No UPDATE or DELETE. |
| `media_release_versions` | SELECT | SELECT | Public read. Writes service-role only. |
| `media_release_submissions` | ❌ | SELECT, INSERT | Users insert own submission, read own. No UPDATE or DELETE. |
| `under18_form_versions` | SELECT | SELECT | Public read. Writes service-role only. |
| `under18_submissions` | ❌ | SELECT, INSERT | Guardians submit forms. No UPDATE or DELETE from the API. |

### Referee test

| Table | anon | authenticated | RLS intent |
|---|---|---|---|
| `referee_questions` | ❌ | SELECT | Authenticated users read questions during the test. Writes service-role only. |
| `referee_test_settings` | ❌ | SELECT | Authenticated users read settings (pass mark, time limit). Writes service-role only. |
| `referee_test_results` | ❌ | SELECT, INSERT | Users submit own attempt, read own results. |

---

## Tables explicitly NOT in this matrix

The following tables were present in the original schema and have been **removed** per ADR-0004:

- `cms_global`
- `cms_pages`
- `cms_sections`

Content previously managed through the CMS is now maintained as static values in the codebase and deployed via standard GitHub → Vercel workflow.

---

## Operational notes

### When adding a new table

1. Add the table in a migration
2. Add RLS policies in the same migration (or immediately after)
3. Add GRANT statements to the appropriate roles
4. **Update this document** with the new row
5. Add or update an ADR if the access pattern is novel

### When debugging access issues

| Symptom | Likely cause | Where to look |
|---|---|---|
| HTTP 401, `Proxy-Status: PostgREST; error=42501` | Missing GRANT | This document + `pg_privileges` |
| HTTP 200, empty result when data should exist | RLS policy denial | `pg_policies`, confirm role and qual |
| HTTP 401, `Invalid API key` | Wrong or missing anon key | Vercel env vars |
| HTTP 401, `JWT expired` | Client session expired | Re-login or refresh session |

### Verifying the matrix

Run this in the Supabase SQL editor to confirm the matrix matches the database state:

```sql
SELECT table_name,
       has_table_privilege('anon',          'public.' || table_name, 'SELECT') AS anon_select,
       has_table_privilege('authenticated', 'public.' || table_name, 'SELECT') AS auth_select,
       has_table_privilege('authenticated', 'public.' || table_name, 'INSERT') AS auth_insert,
       has_table_privilege('authenticated', 'public.' || table_name, 'UPDATE') AS auth_update,
       has_table_privilege('authenticated', 'public.' || table_name, 'DELETE') AS auth_delete
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```
