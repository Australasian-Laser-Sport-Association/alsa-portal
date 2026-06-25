# Environment Variables

**Status:** Draft
**Last updated:** 2026-06-16

---

Reference for every environment variable the ALSA Portal uses. Update this file whenever a variable is added, renamed, or removed.

## Where values live

| Environment | Location | Notes |
|---|---|---|
| Production | Vercel dashboard → project → Settings → Environment Variables (Production scope) | Applied on every production deploy. |
| Preview | Vercel dashboard → Environment Variables (Preview scope) | Applied on pull request preview deploys. Must point at the staging Supabase project, not production (see [runbook](./runbook.md)). |
| Local development | `.env.local` in the repo root | Never committed. `.env.example` documents which variables are expected. |

## The `VITE_` prefix

Vite exposes environment variables to the browser-side code only if they start with `VITE_`. Anything without that prefix stays server-side.

This distinction is security-relevant: a value prefixed `VITE_` will be embedded in the JavaScript bundle and visible to anyone who loads the site. Only put things there that are safe to be public. Secrets go in server-side variables (no prefix).

## Variables

### Frontend (visible in the browser)

| Variable | Purpose | Safe to expose? | Where to get it |
|---|---|---|---|
| `VITE_SUPABASE_URL` | The Supabase project URL the frontend connects to. | Yes — this is a public URL. | Supabase dashboard → Settings → API |
| `VITE_SUPABASE_ANON_KEY` | The anon/public API key for the Supabase project. Grants only what the `anon` and `authenticated` Postgres roles are permitted to do (see [ADR-0002](../adr/0002-rls-plus-grant-security-model.md)). | Yes — designed to be public. Security is enforced by RLS and GRANTs, not by keeping this secret. | Supabase dashboard → Settings → API |
| `VITE_SENTRY_DSN` | The public Sentry DSN the browser uses to report errors/traces (`src/main.jsx`). Sentry initialises only when this is set; otherwise it no-ops silently. | Yes — a DSN is designed to be public (it only permits sending events, not reading them). | Sentry dashboard → Project → Settings → Client Keys (DSN) |

### Server-side (Vercel API routes only — never exposed to the browser)

| Variable | Purpose | Safe to expose? | Where to get it |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | The service role key. Bypasses RLS entirely. Used only from server-side API routes for privileged operations (see [ADR-0002](../adr/0002-rls-plus-grant-security-model.md), Layer 3). | **No** — leak of this key is a full database compromise. Rotate immediately if exposed. | Supabase dashboard → Settings → API |
| `RESEND_API_KEY` | Resend API key for transactional email. Used by `api/contact.js` and optional summary-only backup notifications. Backup files are stored privately and never attached. | **No** — allows sending mail from the project's Resend domain. | Resend dashboard → API Keys |
| `CRON_SECRET` | Shared secret protecting the backup cron. Vercel auto-injects `Authorization: Bearer <secret>` on scheduled requests; the handler rejects any request that does not match (constant-time compare). | **No** — leak lets anyone trigger the backup-run endpoint. Generate a long random string. | Self-generated (e.g. `openssl rand -hex 32`); set the same value in Vercel. |
| `SENTRY_AUTH_TOKEN` | Build-time token used by the Sentry Vite plugin (`vite.config.js`) to upload source maps during `vite build`. It is ignored unless `SENTRY_UPLOAD_SOURCEMAPS=true` is also set. | **No** — grants Sentry project write access. Build-time only; not in the runtime bundle. | Sentry dashboard → Settings → Auth Tokens |
| `SENTRY_UPLOAD_SOURCEMAPS` | Set to `true` only when `SENTRY_AUTH_TOKEN` is valid and source maps should be uploaded to Sentry. When unset or false, production builds do not emit source maps. | Yes — this is a non-secret toggle, but keep it server-side because only build tooling needs it. | Self-managed Vercel build toggle |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint used by public, authenticated, and admin API rate limiters. Required in production for routes that opt into distributed enforcement; local and preview environments can fall back to per-instance memory limits. | **No** - server-side only. | Upstash dashboard -> Redis database -> REST API |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST auth token paired with `UPSTASH_REDIS_REST_URL`. Required with `UPSTASH_REDIS_REST_URL` for production rate-limited routes. | **No** - grants read/write to the rate-limit store. | Upstash dashboard -> Redis database -> REST API |

Server API routes also read `SENTRY_DSN` at runtime for unexpected-error
telemetry. It may point at the same Sentry project as `VITE_SENTRY_DSN`, but it
should be configured as a server-side Vercel variable so API telemetry can be
changed independently of browser config.

## Adding a new variable

1. Decide whether it is frontend or server-side (does the browser need it?)
2. If frontend, prefix it with `VITE_` and confirm the value is safe to be public
3. Add it to Vercel (Production, Preview, and Development scopes as needed)
4. Add it to `.env.example` with a placeholder value
5. Add a row to the table in this document
6. Redeploy — env var changes do not apply to existing deployments

## Supabase environment isolation

Use the same variable names in all Vercel scopes, but use different Supabase
project values:

| Variable | Production scope | Preview scope |
|---|---|---|
| `VITE_SUPABASE_URL` | Production Supabase URL | Staging Supabase URL |
| `VITE_SUPABASE_ANON_KEY` | Production anon key | Staging anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Production service-role key | Staging service-role key |

After changing Preview-scope Supabase values, create a fresh preview deployment
and run the isolation proof in the runbook before trusting previews with admin
or destructive test flows.

## Removing a variable

1. Remove references from the code
2. Remove from `.env.example`
3. Remove from this document
4. Remove from Vercel (all scopes)
5. Redeploy

## Related

- [`.env.example`](../../.env.example) — template with expected variable names
- [Runbook](./runbook.md) — key rotation procedure, deployment workflow
- [ADR-0002](../adr/0002-rls-plus-grant-security-model.md) — why the service role key is server-side only
