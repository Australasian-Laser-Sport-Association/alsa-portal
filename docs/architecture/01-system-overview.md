# System Overview

**Status:** Draft
**Last updated:** 2026-04-22

---

This document is the one-page introduction to the ALSA Portal for anyone opening the repository for the first time. It describes what the portal is, what it is built on, and how the pieces fit together. More detail on specific areas (security model, authentication, membership) lives in the [ADRs](../adr/).

## What the portal is

The ALSA Portal is the member-facing web application for the Australasian Laser Sport Association. It handles:

- Member account creation and authentication
- Event registration (primarily ZLTAC, the Zone Laser Tag Australasian Championship)
- Team formation and captain management
- Required policy acknowledgements and consent records, with under-18 approval
  handled separately
- Referee test and accreditation
- Committee administration (user management, registration management, event configuration)

It is a single web application, accessed at the production URL, usable on desktop and mobile browsers.

## Architecture at a glance

```
 ┌─────────────────────┐
 │  Browser            │
 │  (React SPA)        │
 └──────────┬──────────┘
            │
            │  static assets + API routes
            ▼
 ┌─────────────────────┐
 │  Vercel             │
 │  - Static hosting   │
 │  - Serverless APIs  │
 └──────────┬──────────┘
            │
            │  SQL + Auth + Storage
            ▼
 ┌─────────────────────┐
 │  Supabase           │
 │  - Postgres         │
 │  - Auth (GoTrue)    │
 │  - Object Storage   │
 └─────────────────────┘
```

Three moving parts:

1. **A React single-page application** served as static files from Vercel. This is what the user sees. Built with React 19, Vite, and Tailwind CSS v4.
2. **Vercel**, which hosts the static frontend and runs a small number of server-side API routes (for operations that require elevated database permissions).
3. **Supabase**, which provides the Postgres database, authentication service, and file storage.

There is no separately-operated server, no container infrastructure, and no queue or worker tier. The portal is a frontend plus a managed backend.

## Data flow

- **Public and own-account reads** go from the browser directly to Supabase over
  HTTPS using the public client. Grants and row-level policies limit each read;
  the only direct application-table update is the reviewed own-profile column
  allow-list.
- **Member workflow mutations** (registration, teams, payments,
  acknowledgements, and under-18 submissions) go through authenticated Vercel
  API routes that enforce account state, ownership, and event lifecycle.
- **Committee admin activity** (managing registrations and editing event
  settings) also goes through authenticated Vercel API routes with explicit
  role checks. The service-role credential stays server-side.

The reasoning behind this split is documented in [ADR-0002: RLS + GRANT Security Model](../adr/0002-rls-plus-grant-security-model.md).

## Where things live

| What | Where |
|---|---|
| Frontend source code | `src/` |
| Static assets (images, favicon) | `public/` |
| Database schema and migrations | `supabase/migrations/` |
| Architectural decisions | `docs/adr/` |
| Security documentation | `docs/security/` |
| Operational runbook | `docs/operations/runbook.md` |
| Environment variable reference | `docs/operations/environment-variables.md` |
| Brand guidelines | `brand.md` |

## Who can do what

At the application level there are three kinds of user:

- **Visitors** (not logged in) — see public pages only
- **Members** (logged in) — see and manage their own data, register for events, acknowledge policies
- **Committee** (logged in with committee role) — all member abilities plus access to admin pages

The precise table-by-table permissions are recorded in the [Data Access Matrix](../security/data-access-matrix.md). Proposed rules for which pages members can reach, and how navigation is handled, are described in [ADR-0007: Page Access and Navigation Policy](../adr/0007-page-access-and-navigation-policy.md).

## Further reading

- [ADR index](../adr/) — architectural decisions with reasoning
- [Data Access Matrix](../security/data-access-matrix.md) — authoritative per-table permissions
- [Runbook](../operations/runbook.md) — day-to-day operations
- [Environment variables](../operations/environment-variables.md) — configuration reference
