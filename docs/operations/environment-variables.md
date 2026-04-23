# Environment Variables

**Status:** Draft
**Last updated:** 2026-04-22

---

Reference for every environment variable the ALSA Portal uses. Update this file whenever a variable is added, renamed, or removed.

## Where values live

| Environment | Location | Notes |
|---|---|---|
| Production | Vercel dashboard → project → Settings → Environment Variables (Production scope) | Applied on every production deploy. |
| Preview | Vercel dashboard → Environment Variables (Preview scope) | Applied on pull request preview deploys. Currently shares Supabase with production (see [runbook](./runbook.md)). |
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

### Server-side (Vercel API routes only — never exposed to the browser)

| Variable | Purpose | Safe to expose? | Where to get it |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | The service role key. Bypasses RLS entirely. Used only from server-side API routes for privileged operations (see [ADR-0002](../adr/0002-rls-plus-grant-security-model.md), Layer 3). | **No** — leak of this key is a full database compromise. Rotate immediately if exposed. | Supabase dashboard → Settings → API |

## Adding a new variable

1. Decide whether it is frontend or server-side (does the browser need it?)
2. If frontend, prefix it with `VITE_` and confirm the value is safe to be public
3. Add it to Vercel (Production, Preview, and Development scopes as needed)
4. Add it to `.env.example` with a placeholder value
5. Add a row to the table in this document
6. Redeploy — env var changes do not apply to existing deployments

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
