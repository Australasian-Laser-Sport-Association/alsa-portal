# Environment Variables

**Status:** Draft
**Last updated:** 2026-07-15

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
| `VITE_SENTRY_DSN` | The public Sentry DSN the browser uses to report errors/traces (`src/main.jsx`). Sentry initialises only when this is set; otherwise it no-ops silently. It is optional locally but required by the deployed release check. | Yes — a DSN is designed to be public (it only permits sending events, not reading them). | Sentry dashboard → Project → Settings → Client Keys (DSN) |
| `VITE_PUBLIC_ASSET_BASE_URL` | Optional canonical HTTPS origin for branded `/assets` and `/documents` URLs. Leave empty to use the portal origin. The server restricts production asset requests to this host when set. | Yes — it is a public origin. | Portal/domain configuration |

### Server-side (Vercel API routes only — never exposed to the browser)

| Variable | Purpose | Safe to expose? | Where to get it |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | The service role key. Bypasses RLS entirely. Used only from server-side API routes for privileged operations (see [ADR-0002](../adr/0002-rls-plus-grant-security-model.md), Layer 3). | **No** — leak of this key is a full database compromise. Rotate immediately if exposed. | Supabase dashboard → Settings → API |
| `RESEND_API_KEY` | Resend API key for transactional email. Used by `api/contact.js` and optional summary-only backup notifications. Backup files are stored privately and never attached. Use different sending-only keys for Production and non-production scopes. | **No** — allows sending mail from the project's Resend domain. | Resend dashboard → API Keys |
| `CRON_SECRET` | Shared secret protecting the backup cron. Vercel auto-injects `Authorization: Bearer <secret>` on scheduled requests; the handler rejects any request that does not match (constant-time compare). | **No** — leak lets anyone trigger the backup-run endpoint. Generate a long random string and never reuse the Production value in another scope. | Self-generated (e.g. `openssl rand -hex 32`); set a distinct value in each Vercel scope. |
| `SENTRY_DSN` | Server-side Sentry DSN for unexpected API-route errors. It may use the same Sentry project as the browser DSN within one environment, but remains independently configurable. It is required by the deployed release check. | Yes — a DSN permits event submission, not event reading. | Sentry dashboard → Project → Settings → Client Keys (DSN) |
| `SENTRY_AUTH_TOKEN` | Build-time token used by the Sentry Vite plugin (`vite.config.js`) to upload source maps during `vite build`. It is ignored unless `SENTRY_UPLOAD_SOURCEMAPS=true` is also set. | **No** — grants Sentry project write access. Build-time only; not in the runtime bundle. | Sentry dashboard → Settings → Auth Tokens |
| `SENTRY_UPLOAD_SOURCEMAPS` | Set to `true` only when `SENTRY_AUTH_TOKEN` is valid and source maps should be uploaded to Sentry. When unset or false, production builds do not emit source maps. | Yes — this is a non-secret toggle, but keep it server-side because only build tooling needs it. | Self-managed Vercel build toggle |
| `SENTRY_DISABLE_UPLOAD` | Emergency build-only override. Setting it to `true` disables source-map upload even if the upload toggle and token are present. Keep it unset or false for an intended release upload. | Yes — this is a non-secret toggle. | Self-managed Vercel build toggle |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint used by API rate limiters and serialized account-access changes. Required in deployed Preview and Production; only local development/tests may fall back to per-process memory. | **No** - server-side only. | Upstash dashboard -> Redis database -> REST API |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST auth token paired with `UPSTASH_REDIS_REST_URL`. Required in every deployed environment for distributed rate limits and account-access locks. | **No** - grants read/write to the shared protection store. | Upstash dashboard -> Redis database -> REST API |

### Release-scope validation

Before trusting a release deployment, list both Vercel scopes and use the
guarded repository runner below. It refuses root `.env*` files other than
`.env.example`, removes every inspected variable from the parent process, and
only then asks Vercel to inject the selected remote scope. Run it from an
authenticated checkout whose Vercel project link has been independently
compared with the private release record; the runner refuses an unlinked
checkout and clears shell variables that could override the link. The checker
reports only variable names and pass/fail results. It never prints values or
project references.

```sh
vercel env ls production
vercel env ls preview

node scripts/run-vercel-release-environment-check.mjs --target production --expected-supabase-project-ref '<production-project-ref>' --forbid-supabase-project-ref '<staging-project-ref>'

node scripts/run-vercel-release-environment-check.mjs --target preview --git-branch '<release-branch>' --expected-supabase-project-ref '<staging-project-ref>' --forbid-supabase-project-ref '<production-project-ref>'
```

Use independently recorded project references, not values copied from the
Vercel configuration being checked. The runner passes those references through
the sanitized parent environment and keeps them out of the spawned command.
Move any real root dotenv file outside the repository for the check; do not
rename it to another `.env.*` filename or retain a new environment export.
Passing this structural check does not replace the preview write-isolation
proof in the runbook.

### GitHub Actions disaster-recovery settings

The DR secrets below belong in the protected GitHub Environment named
`disaster-recovery`, not Vercel, repository-level secrets, or `.env.local`.
Restrict that environment to the protected `main` branch. Do not add a
per-run deployment approval that unattended scheduled backups cannot satisfy;
instead require at least one independent approving pull-request review before
any change can reach `main`, including changes to the backup workflow, and
restrict environment and secret administration to maintainers with
multi-factor authentication. Do not add a bypass actor to that branch rule.
`DR_BACKUPS_ENABLED` and `DR_DEST_PREFIX` remain repository variables because
job-level conditions are evaluated before GitHub makes environment values
available. These settings configure the disabled-by-default
`disaster-recovery-backup.yml` workflow.

| Name | Kind | Purpose |
|---|---|---|
| `DR_BACKUPS_ENABLED` | Variable | Must equal `true` before scheduled jobs run. Enable only after a manual backup and restore drill passes. |
| `DR_DATABASE_URL` | Secret | Production direct/session-pooler PostgreSQL URL with the minimum access required for a complete `pg_dump`. |
| `DR_SOURCE_S3_ACCESS_KEY`, `DR_SOURCE_S3_SECRET_KEY`, `DR_SOURCE_S3_ENDPOINT`, `DR_SOURCE_S3_REGION` | Secrets | Supabase Storage S3 credentials, endpoint, and signing region used to enumerate and download every bucket. |
| `DR_DEST_S3_ACCESS_KEY`, `DR_DEST_S3_SECRET_KEY`, `DR_DEST_S3_ENDPOINT`, `DR_DEST_S3_BUCKET`, `DR_DEST_S3_REGION` | Secrets | Credentials, endpoint, bucket, and signing region for an independent S3-compatible account. The endpoint may be blank only for AWS S3. |
| `DR_AGE_RECIPIENT` | Secret | Public age recipient whose private key is held separately by authorised recovery custodians. It is stored as a secret to keep the recovery design out of logs. |
| `DR_DEST_PREFIX` | Variable | Optional destination prefix; defaults to `alsa-portal`. |

Destination credentials must not belong to the Supabase project/account. Give
the workflow write and read-after-write verification access but no retention or
bucket-policy administration. Configure provider-side versioning, object lock,
retention, and failure notifications before enabling the schedule.

## Adding a new variable

1. Decide whether it is frontend or server-side (does the browser need it?)
2. If frontend, prefix it with `VITE_` and confirm the value is safe to be public
3. Add it to Vercel (Production, Preview, and Development scopes as needed)
4. Add it to `.env.example` with a placeholder value
5. Add a row to the table in this document
6. Redeploy — env var changes do not apply to existing deployments

## Deployed environment isolation

Use the same variable names in all Vercel scopes, but isolate every stateful or
privileged integration. A Preview deployment must not be able to consume a
Production rate-limit bucket, hold a Production account-access lock, send with
a Production provider key, or pollute Production monitoring.

| Variable | Production scope | Preview scope |
|---|---|---|
| `VITE_SUPABASE_URL` | Production Supabase URL | Staging Supabase URL |
| `VITE_SUPABASE_ANON_KEY` | Production anon key | Staging anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Production service-role key | Staging service-role key |

Also keep these resources distinct:

| Integration | Production scope | Preview scope |
|---|---|---|
| Upstash Redis | Production-only database and token | Separate non-production database and token |
| Resend | Production sending-only API key | Separate non-production sending-only API key; use only for approved canaries |
| Cron authentication | Production-only random `CRON_SECRET` | Different random `CRON_SECRET` |
| Sentry | Production project/DSNs and alert routing | Dedicated non-production project/DSNs, or an equivalently isolated provider setup |

Record non-secret provider resource identifiers in the private release record
so the two scopes can be compared without printing credentials.

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
