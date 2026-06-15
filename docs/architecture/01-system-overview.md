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
- Policy acknowledgements and legal audit trail
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

- **Normal member activity** (viewing your team, registering for an event, signing a policy) goes from the browser directly to Supabase over HTTPS, using the Supabase JavaScript client. Access is enforced by database-level policies — users can only see and modify rows they are permitted to.
- **Committee admin activity** (managing registrations, editing event settings) goes from the browser to a Vercel API route, which then talks to Supabase with elevated privileges on the user's behalf. This keeps the elevated credentials on the server side.

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
| Running to-do / backlog | `docs/BACKLOG.md` |
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
- [Runbook](./runbook.md) — day-to-day operations
- [Environment variables](./environment-variables.md) — configuration reference
- [Backlog](../BACKLOG.md) — current priorities and open work
