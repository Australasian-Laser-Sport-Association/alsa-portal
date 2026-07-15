# Operational Runbook

**Status:** Draft
**Last updated:** 2026-07-15

---

Day-to-day operations reference for the ALSA Portal. Kept short on purpose — expand it when something new comes up that future-you or a future committee member will need to know.

## Deployment

### Normal deploy

Deployment is automatic. Pushing to `main` triggers a Vercel build; a new version is live within roughly two minutes.

The workflow is:

1. Create a feature branch from `main`
2. Commit changes
3. Open a pull request
4. Vercel automatically builds a preview deployment on the PR for review
5. Merge to `main` when ready — production deploys automatically

Do not push directly to `main`.

An approved controlled rollout may override this normal path. In particular,
the July 2026 security remediation must follow
[security-remediation-rollout.md](./security-remediation-rollout.md): do not
merge its broad release branch merely to make an operational workflow
available, because that merge would also auto-deploy the schema-dependent
application.

### Preview deploys

Every pull request gets its own preview URL from Vercel. Preview deploys must
use the staging Supabase project described below. If Preview-scope Vercel env
vars are ever pointed at production, do not run destructive admin flows from a
preview deployment.

### Preview environment isolation

Preview deploys must use a separate staging Supabase project before launch. The
application code uses the same variable names in every environment; isolation is
provided by Vercel environment scopes.

Setup checklist:

1. Create a new Supabase project for staging in the same region as production
   where possible.
2. If a controlled migration rollout is active, follow its phased runner and
   checkpoints instead of applying every pending migration at once. For the
   July 2026 remediation, use
   [security-remediation-rollout.md](./security-remediation-rollout.md). Only
   use the normal all-committed-migrations path when no active rollout says
   otherwise.
3. Configure staging Auth URL settings:
   - Site URL: the main Vercel preview URL or a stable staging URL if one is
     configured.
   - Redirect URLs: production domain is not required for staging; include the
     Vercel preview URL pattern used for PR previews and the local dev URL.
4. Recreate required Storage buckets and policies via migrations or reviewed
   SQL, not dashboard-only changes.
5. Add Vercel Preview-scope variables using staging or non-production values:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `RESEND_API_KEY` and `CRON_SECRET`
   - browser and server Sentry DSNs
   - the Upstash REST URL and token
6. Use a separate Preview Upstash database, a separate sending-only Resend key,
   a different `CRON_SECRET`, and non-production Sentry DSNs. Do not reuse the
   corresponding Production credentials or state stores.
7. Keep Vercel Production-scope variables pointed at Production resources.
8. Create a PR preview deployment and perform a write test with disposable data.
9. Confirm the disposable test row appears in staging and does not appear in
   production.
10. Confirm admin/API routes still work in preview with the staging service-role
   key.
11. Send only approved email and Sentry canaries. Confirm they appear in the
    non-production provider records and do not trigger Production alerting.
12. Document the staging project reference, non-secret provider resource
    identifiers, and date verified in the private
    audit notes.

Never copy the production service-role key into the Preview scope. If that
happens, rotate the production service-role key and redeploy production.

## Rollback

If a deploy causes a problem:

First check whether a database security cutover is in progress. After migration
`20260713010000` in the July 2026 remediation, the baseline application is no
longer compatible with the hardened database and must not be re-promoted. Keep
maintenance active and follow the roll-forward procedure in
[security-remediation-rollout.md](./security-remediation-rollout.md#failure-and-rollback-handling)
instead.

For an ordinary application-only deploy with a compatible database:

1. Open the Vercel dashboard → the portal project → Deployments
2. Find the last known-good deployment
3. Click the `...` menu → **Promote to Production**

This swaps the production alias to the earlier build in seconds. No git revert is required for a fast rollback.

After rollback, fix the issue in a new branch and re-deploy through the normal flow.

## Supabase: key rotation

If a Supabase key is exposed (committed to a public repo, leaked in a screenshot, shared by mistake):

1. Open the Supabase dashboard → the portal project → Settings → API
2. Regenerate the affected key:
   - **Anon key** — safe to regenerate; does not break anything except for clients still using the old key. Update the Vercel env var.
   - **Service role key** — regenerate immediately if exposed. This key has full database access. Update the Vercel env var.
3. Redeploy from Vercel so the new env var takes effect.
4. Review recent database activity for anything suspicious (auth logs, unexpected writes).

The anon key is designed to be public — its security posture assumes it is visible in the browser bundle. A leaked anon key is not a security incident on its own; a leaked service role key is.

## Hosting plan and region gate

Do not approve production while the portal is assumed to run on personal free
tiers. Record the owning organisation, plan, billing contact, region, limits,
and renewal owner in the private operations register.

- Confirm Vercel Pro or another plan explicitly eligible for an
  association-operated service. The repository currently deploys 12 direct
  functions, which is the entire Hobby allowance, and Vercel restricts Hobby
  to personal use. There must be function headroom and an active billing alert.
- Confirm Supabase Pro for production. Free projects can pause during quiet
  off-season periods and have no managed daily-backup entitlement. Managed
  backups remain only one layer; the off-project restore drill below is still
  mandatory.
- Confirm the Supabase database region is in Australia and record it beside the
  Vercel `syd1` function region. Investigate any cross-region configuration
  before measuring or approving the deployed journeys.

References: [Vercel Function limits](https://vercel.com/docs/functions/runtimes),
[Vercel Hobby eligibility](https://vercel.com/docs/plans/hobby), and
[Supabase database backups](https://supabase.com/docs/guides/platform/backups).

## Authentication configuration gate

Before staging sign-off and again before production launch, compare the live
Supabase Auth settings with ADR-0003. Capture a private, timestamped checklist
showing email confirmation, the documented password requirements,
leaked-password protection, secure password/email changes, OTP expiry/length,
disabled anonymous access, and the intended provider list. Do not infer these
dashboard settings from application code.

Require MFA and recovery ownership for every GitHub, Vercel, Supabase, Resend,
Sentry, Upstash, backup-provider, DNS, and registrar account that can alter,
observe, deploy, or recover production. Keep at least two authorised recovery
custodians and test the documented recovery path before launch.

References: [Supabase password security](https://supabase.com/docs/guides/auth/password-security)
and [Supabase platform MFA](https://supabase.com/docs/guides/platform/multi-factor-authentication).

## Supabase: database backups

Free projects need regular off-site logical exports. Pro, Team, and Enterprise
projects have managed daily database backups, but those backups are removed
with the project and do not contain Storage object bytes. Managed backups are
therefore the first recovery layer, not the only one.

The scheduled, encrypted off-project workflow and its required credentials are
documented in [backup-restore.md](./backup-restore.md). Do not enable it until a
manual run has restored both the database and every Storage bucket into a
disposable project. Take an additional verified backup before every risky
production migration.

## Environment variables

Application, API-runtime, and build environment variables live in the Vercel
dashboard: project → Settings → Environment Variables. Disaster-recovery
workflow secrets and variables live in GitHub as documented below.

Never commit a real `.env` file. The repo's `.env.example` documents which variables exist. A detailed reference for each variable is in [environment-variables.md](./environment-variables.md).

Before a preview is approved or a production deployment is promoted, verify
both scopes without printing or writing secret values. The guarded runner
rejects root dotenv overrides and removes already-exported inspected values
before Vercel injects the selected remote scope. First authenticate the Vercel
CLI and independently compare this checkout's linked project with the private
release record; the runner refuses an unlinked checkout and clears project-ID
shell overrides:

```sh
vercel env ls production
vercel env ls preview

node scripts/run-vercel-release-environment-check.mjs --target production --expected-supabase-project-ref '<production-project-ref>' --forbid-supabase-project-ref '<staging-project-ref>'

node scripts/run-vercel-release-environment-check.mjs --target preview --git-branch '<release-branch>' --expected-supabase-project-ref '<staging-project-ref>' --forbid-supabase-project-ref '<production-project-ref>'
```

Take both project references from the independently maintained private release
record. The checker logs names and pass/fail results only, and the guarded
runner keeps those references out of the spawned command. Move any real root
dotenv file outside the repository for the check and do not retain a new
environment export. After the structural check passes, complete the disposable
preview write-isolation proof above.

When adding or changing an env var:

1. Update it in Vercel (remember: Production, Preview, and Development are separate)
2. Update `.env.example` if the variable is new
3. Update [environment-variables.md](./environment-variables.md)
4. Redeploy — env var changes do not apply to existing deployments

## Vercel function cap

The app deliberately keeps API routes multiplexed because function limits and
operational comprehension still matter even on the required production plan.
The current deployable API files are:

- `api/admin/alsa.js`
- `api/admin/event.js`
- `api/admin/users.js`
- `api/admin/volunteers.js`
- `api/captain.js`
- `api/contact.js`
- `api/player.js`
- `api/profiles.js`
- `api/public.js`
- `api/referee-test.js`
- `api/superadmin/[resource].js`
- `api/volunteer-signup.js`

That is exactly 12 functions. Do not add a new top-level `api/*.js` or
`api/**/[route].js` file without first checking the plan limit and deciding
whether the new behaviour should be added to an existing multiplexed route via
a `?resource=` dispatch. Helper files belong under `api/_lib/` and do not count
as deployable functions.

`api/admin/event.js` also runs the scheduled portal backup. Its explicit
300-second `maxDuration` in `vercel.json` is a release requirement, not spare
latency for ordinary admin requests. Confirm the selected Vercel plan supports
that duration and alert on backup runs that approach it.

## Common issues

### "The site is down"

1. Check Vercel's status page and the portal project's deployments tab. A failed build will not replace the live site — the previous version keeps serving.
2. Check Supabase's status page. If Supabase is down, the frontend loads but data operations fail. Not much to do except wait and communicate.
3. Check browser DevTools → Network tab for what is actually failing. 401/403 usually means auth or RLS; 500 usually means a Supabase or API route error.

### "Users can't log in"

1. Confirm the Supabase Auth settings have not changed (dashboard → Authentication → Providers).
2. Confirm the Site URL and redirect URLs in Supabase match the production domain (dashboard → Authentication → URL Configuration).
3. Check the browser console for specific errors — expired session, rate limit, or email delivery failure are the usual suspects.

### "Users are getting 42501 / permission denied errors"

This is a database permissions issue. See the debugging table in the [Data Access Matrix](../security/data-access-matrix.md). The usual causes are a missing GRANT on a new table, or an RLS policy that references a column that has changed.

### "Auth emails aren't arriving"

The production design uses Resend custom SMTP; falling back to Supabase's shared
default sender is not an acceptable fix.

1. Check the Resend status page and the separate Auth/contact API-key logs.
2. Check Supabase Auth SMTP settings, Auth logs, and the configured email rate
   limits.
3. Confirm SPF, DKIM, and DMARC still pass for `lasersport.org.au`.
4. Check spam handling and one approved recipient-domain canary.
5. Rotate only the affected environment/key, update its Vercel or Supabase
   scope, and redeploy before retesting.

### "API requests return 503 when Redis is unavailable"

This is the intended fail-closed behavior in Preview and Production. Check the
scope-specific Upstash service and both REST variables. Do not switch a
deployed environment to the in-memory fallback or temporarily point Preview at
the Production Redis database.

### "Expected errors are missing from Sentry"

Confirm the browser and server DSNs are present in the correct Vercel scope,
redeploy after any change, and send a controlled canary. Preview canaries must
remain in non-production monitoring and must not trigger Production alerting.

## Making schema changes

1. Create a new migration file in `supabase/migrations/` with a timestamp prefix
2. Write the SQL — remember to include both RLS policies and GRANT statements (see [ADR-0002](../adr/0002-rls-plus-grant-security-model.md))
3. Test locally if possible
4. Apply to production using the Supabase CLI (`supabase db push`) or via the SQL editor in the Supabase dashboard
5. Commit the migration file to the repo in the same PR as the code change that needs it

Never change the schema through the Supabase dashboard without also committing a migration file. The repo is the source of truth; undocumented schema changes will eventually cause a merge or environment drift problem.

### Reconciling SQL Editor migrations

If a production migration is applied through the Supabase SQL Editor instead of `supabase db push`, immediately reconcile the migration history from Git Bash:

1. Confirm the linked project and current history:
   `supabase migration list --linked`
2. If the new migration appears as local-only, mark it applied:
   `supabase migration repair <version> --status applied --linked`
3. Verify the local and remote columns now both show the migration version:
   `supabase migration list --linked`
4. Keep the migration file committed in the same PR as the code that depends on it.

Do this before deploying any API or frontend code that depends on the new schema.

## Who to contact

| Topic | Contact |
|---|---|
| Portal issues | Portal maintainer |
| Hosting / Vercel account | Portal maintainer |
| Database / Supabase account | Portal maintainer |
| Domain / DNS | Committee |
| Association matters | Committee |

## Further reading

- [System overview](../architecture/01-system-overview.md)
- [Environment variables](./environment-variables.md)
- [Data Access Matrix](../security/data-access-matrix.md)
- [ADR index](../adr/)
- [Security remediation rollout](./security-remediation-rollout.md)
