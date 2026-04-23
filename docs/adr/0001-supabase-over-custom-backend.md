# ADR-0001: Supabase Over Custom Backend

**Status:** Accepted
**Date:** 2026-04-22 (retrospective — decision made at project inception, documented here)
**Deciders:** ALSA Technical Sub-Committee
**Supersedes:** None
**Related:** [ADR-0002: RLS + GRANT Security Model](./0002-rls-plus-grant-security-model.md), [ADR-0003: Authentication and Password Policy](./0003-authentication-and-password-policy.md)

---

## Context

The ALSA Portal needs a backend capable of:

1. **Persisting relational data** — members, teams, registrations, events, policy acknowledgements, referee test results, historical event records
2. **Authenticating users** — signup, login, password reset, email confirmation (see [ADR-0003](./0003-authentication-and-password-policy.md))
3. **Authorising access** — enforcing that members can only see their own data, captains can manage only their own teams, and the committee can administer the system (see [ADR-0002](./0002-rls-plus-grant-security-model.md))
4. **Storing files** — policy PDFs, media releases, team logos, historical event photos
5. **Running reliably without a dedicated operator** — ALSA is a volunteer-run incorporated association with no paid staff and no dedicated devops capacity

The portal is built and maintained by a single volunteer developer on the sub-committee, with occasional input from other technically-literate committee members. There is no on-call rotation, no after-hours engineer, and no budget for managed infrastructure beyond what a small association can justify from member fees and event surpluses.

We also have specific non-functional requirements that shaped the choice:

- **Row-level access control is the primary security model.** The data includes information about minors, signed legal documents, and financial records. We want ownership and role checks enforced by the database itself, not by application code that could have a bug or be bypassed (see [ADR-0002](./0002-rls-plus-grant-security-model.md)).
- **The frontend is a static SPA.** React + Vite, hosted on Vercel as static assets plus serverless functions. There is no long-running application server to own state or hold database connections.
- **Cost must scale with use, not with capacity.** A quiet off-season month should cost close to nothing; tournament registration weeks should scale up without manual intervention.

## Decision

We adopt **Supabase** as the backend for the ALSA Portal. Supabase provides the Postgres database, authentication service, object storage, and realtime subscriptions as a managed offering built around a standard Postgres instance.

### What Supabase provides

| Capability | Supabase component | What we use it for |
|---|---|---|
| Relational database | Managed Postgres | All structured data: profiles, teams, registrations, events, policy acknowledgements, referee test results |
| Authentication | Supabase Auth (GoTrue) | Email + password signup and login, email confirmation, password reset, session management |
| Authorisation | Postgres Row-Level Security | Per-row access policies written in SQL, evaluated by the database on every query |
| File storage | Supabase Storage | Policy PDFs, guardian forms, media releases, future team logos |
| Server-side privileged operations | Service role key, called from Vercel API routes | Committee admin actions that must bypass RLS (see [ADR-0002](./0002-rls-plus-grant-security-model.md), Layer 3) |
| Migrations | Supabase CLI | SQL migrations versioned in the repository, applied to production via the CLI |

### How it fits with the frontend

The React SPA talks directly to Supabase using the `@supabase/supabase-js` client library and the public **anon key**. Every query is subject to RLS policies. The anon key is not a secret — its security posture assumes it will be visible in the browser — and it can only do what the `anon` or `authenticated` Postgres role has been granted.

For operations that require bypassing RLS (committee admin, cross-user reads), the frontend calls Vercel API routes that run server-side and use the Supabase **service role key**, which is held only as a Vercel environment variable. This split is the subject of [ADR-0002](./0002-rls-plus-grant-security-model.md) and is currently being migrated from a transitional shim to proper API routes (tracked in the backlog as the `supabaseAdmin` migration).

### Hosting and cost model

The portal is hosted on Supabase's free tier during initial rollout. The free tier provides enough database, auth, and storage capacity to comfortably cover ALSA's scale (low hundreds of active members, one major tournament per year, handful of side events). Upgrading to the Pro tier ($25/month/project) unlocks specific features we want eventually — leaked-password detection, higher email rate limits, daily backups — but is not required for launch.

Vercel hosts the frontend and API routes on its Hobby tier, also free for our traffic levels.

## Consequences

### Positive

- **We do not operate a server.** No OS patching, no Node process supervision, no database backups script, no TLS certificate renewal, no log rotation. For a volunteer committee, this is the single largest benefit.

- **Security model is database-native.** RLS policies are evaluated by Postgres itself. A bug in the application cannot bypass them. This aligns with our defence-in-depth philosophy (see [ADR-0002](./0002-rls-plus-grant-security-model.md)).

- **Standard Postgres underneath.** Supabase is not a proprietary database with a Postgres-compatible veneer — it is actual Postgres. If Supabase ever becomes unsuitable, the data and schema are portable to any Postgres host (AWS RDS, DigitalOcean, self-hosted, etc.). There is no lock-in at the data layer.

- **SQL migrations are first-class.** Every schema change is a versioned `.sql` file in the repository, reviewable in pull requests, reproducible across environments. This suits the portal's "infrastructure as code" documentation discipline.

- **Auth is handled.** We did not have to implement password hashing, session management, email confirmation flows, password reset tokens, or rate limiting. These are well-trodden areas where bespoke implementations frequently introduce vulnerabilities.

- **Cost is negligible at our scale.** Free tier covers current usage. Pro tier, if and when needed, is predictable and modest.

- **Single vendor surface for the committee to understand.** A new committee member reviewing the infrastructure sees two services (Supabase for data/auth, Vercel for hosting) rather than a fleet of separately-provisioned components.

### Negative

- **Vendor dependency on Supabase.** If Supabase raises prices substantially, changes terms, or suffers a prolonged outage, we are affected. Mitigated by the fact that the data is standard Postgres and could be migrated to self-hosted or another provider with effort proportional to the schema size, not rewritten.

- **Some features require the Pro tier.** Leaked-password detection, daily backups, and higher email rate limits are gated behind $25/month. Documented in [ADR-0003](./0003-authentication-and-password-policy.md) and the backlog as planned upgrades.

- **Default email sender is unbranded and rate-limited.** Supabase's default auth emails come from `noreply@mail.supabase.io` at 4/hour. This is a platform characteristic, not a Supabase-specific defect, but it requires a custom SMTP provider before broad launch. Tracked in the backlog and planned for ADR-0005.

- **Client-library quirks.** The `@supabase/supabase-js` library occasionally surfaces behaviour that requires workarounds (multiple `GoTrueClient` instances warning, default-deny GRANT behaviour being surprising to developers used to "RLS-only"). These are manageable but represent a small ongoing tax.

- **Postgres expertise is required.** RLS policies, GRANT statements, and migrations are written in SQL. This raises the bar for contributors compared to an ORM-only backend. We accept this tradeoff because the security model depends on those primitives being used directly.

### Neutral

- **Realtime subscriptions are available but unused for now.** Supabase can push row changes to subscribed clients over WebSockets. The portal does not currently need this, but it is available if future features (live tournament scoring, real-time registration counts) want it.

- **Edge Functions are available but unused.** Supabase offers Deno-based edge functions as an alternative to Vercel API routes. We have chosen to keep server-side code on Vercel for stack coherence, but this could change.

- **Supabase Storage is used lightly.** Most policy PDFs are static assets bundled with the frontend. Storage is reserved for user-uploaded files (guardian forms, media releases) and dynamic documents.

## Alternatives considered

### Custom Node.js + Express + self-hosted Postgres

**Rejected.** This is the "traditional" stack and offers maximum control. For a team with dedicated devops capacity it may be the right choice. For ALSA it is not, because:

- We would own OS patching, Node version upgrades, Postgres upgrades, TLS renewal, backup scripting, log retention, monitoring, and uptime.
- We would implement or integrate auth ourselves. Password hashing, email confirmation, password reset tokens, and rate limiting are each individually straightforward and collectively a significant surface for bugs.
- We would lose the native RLS integration. Self-hosted Postgres supports RLS, but without a pre-integrated auth service, we would need to wire the current user's identity into the database session on every request.
- Hosting a Node + Postgres stack on any reputable platform (AWS, DigitalOcean, Railway, Fly) costs more than Supabase's free tier and requires more ongoing attention.

The volunteer-time cost of operating this stack would, over a year, substantially exceed the value of the control gained.

### Firebase (Google)

**Rejected.** Firebase is a mature managed backend with strong auth and hosting integration. We rejected it because:

- Firestore is a document database. ALSA's data is strongly relational — teams have captains, captains have registrations, registrations reference events, events have side events. Modelling this in a document store introduces joins-in-application-code and eventual-consistency concerns that are solved problems in SQL.
- Firebase's security rules language is bespoke and less auditable by committee members than SQL RLS policies.
- Data portability off Firebase is materially harder than off Supabase, because the destination would not be another Firestore.

Firebase would have been a reasonable choice for a different data shape. It is not a good match for ours.

### AWS Amplify

**Rejected.** Amplify bundles auth (Cognito), data (AppSync/DynamoDB or RDS), storage (S3), and hosting into a single AWS-native offering. We rejected it because:

- The generated GraphQL layer and the Amplify CLI introduce abstraction and vendor-specific configuration that a volunteer committee would find opaque.
- Cognito's user pool model is more complex than we need and more expensive than Supabase Auth at our scale once it exceeds the free tier.
- AWS pricing is notoriously unpredictable for small projects. A misconfiguration or unexpected traffic spike can produce a surprise bill. This risk is not acceptable for a volunteer-managed budget.

### PocketBase (self-hosted, single binary)

**Considered, rejected.** PocketBase is an attractive single-binary alternative with SQLite and built-in auth. We rejected it because:

- SQLite is not appropriate for a multi-writer production workload at our expected concurrency, even though the scale is modest.
- Self-hosting the binary still requires a server, backups, and patching. The operational simplification over a "real" custom backend is meaningful, but less than Supabase's fully-managed posture.
- The ecosystem, documentation, and third-party guidance are substantially thinner than Supabase's.

Worth revisiting for future standalone projects where SQLite is appropriate.

### Appwrite (open-source Supabase alternative)

**Considered, rejected.** Appwrite is functionally similar to Supabase and is a credible alternative. We chose Supabase because:

- Supabase is standard Postgres; Appwrite abstracts the database behind its own API layer, reducing portability.
- Supabase's Vercel integration is more mature and better-documented.
- Supabase's SQL-first posture aligns better with our preference for having the security model expressed in SQL that committee members can read.

## References

- [ADR-0002: RLS + GRANT Security Model](./0002-rls-plus-grant-security-model.md) — the access control model this backend choice enables
- [ADR-0003: Authentication and Password Policy](./0003-authentication-and-password-policy.md) — the auth configuration built on Supabase Auth
- [Data Access Matrix](../security/data-access-matrix.md) — authoritative table-by-table permissions
- [Supabase documentation](https://supabase.com/docs)
- [Postgres Row Level Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Vercel documentation: Serverless Functions](https://vercel.com/docs/functions)
