# Operational Runbook

**Status:** Draft
**Last updated:** 2026-04-22

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

### Preview deploys

Every pull request gets its own preview URL from Vercel. Preview deploys use the same Supabase instance as production, so **be careful with destructive changes** in PRs — a delete or truncate run in a preview deploy affects production data.

A separate staging Supabase project is a planned future improvement (tracked in the backlog).

## Rollback

If a deploy causes a problem:

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

## Supabase: database backups

The free tier does **not** include automated daily backups. The Pro tier does.

Until the portal is on Pro, a manual backup via `pg_dump` against the Supabase connection string is the fallback. For a small dataset this is a one-liner that can be run ad hoc; worth doing before any risky migration.

Upgrading to Pro is tracked in the backlog and is the recommended medium-term step.

## Environment variables

All environment variables live in the Vercel dashboard: project → Settings → Environment Variables.

Never commit a real `.env` file. The repo's `.env.example` documents which variables exist. A detailed reference for each variable is in [environment-variables.md](./environment-variables.md).

When adding or changing an env var:

1. Update it in Vercel (remember: Production, Preview, and Development are separate)
2. Update `.env.example` if the variable is new
3. Update [environment-variables.md](./environment-variables.md)
4. Redeploy — env var changes do not apply to existing deployments

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

The default Supabase sender (`noreply@mail.supabase.io`) is rate-limited to 4/hour and occasionally gets filtered by strict mail providers. Check spam folders first. Moving to a custom SMTP provider is a P1 backlog item; it will resolve this class of issue.

## Making schema changes

1. Create a new migration file in `supabase/migrations/` with a timestamp prefix
2. Write the SQL — remember to include both RLS policies and GRANT statements (see [ADR-0002](../adr/0002-rls-plus-grant-security-model.md))
3. Test locally if possible
4. Apply to production using the Supabase CLI (`supabase db push`) or via the SQL editor in the Supabase dashboard
5. Commit the migration file to the repo in the same PR as the code change that needs it

Never change the schema through the Supabase dashboard without also committing a migration file. The repo is the source of truth; undocumented schema changes will eventually cause a merge or environment drift problem.

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
- [Backlog](../BACKLOG.md)
