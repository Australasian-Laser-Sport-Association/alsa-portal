# ALSA Portal — Backlog

**Purpose:** Running list of improvements, tasks, and ideas that are not immediately blocking, but should not be forgotten. Captured here so we can stay focused on the current task without losing future work.

**How to use this file:**

* Anyone (or Claude) can add an item at any time
* Items are grouped by category, and each has a priority: **P0** (blocker, do now), **P1** (before launch), **P2** (post-launch polish), **P3** (nice to have)
* When an item is done, move it to the `## Done` section at the bottom with the date
* When a decision is made about an item that warrants architectural reasoning, promote it to an ADR in `docs/adr/`
* Items that depend on external events (domain purchase, Pro plan upgrade) are noted with a `blocked by:` tag

\---

## Active

### Authentication \& Email

* **P1 — Post-signup "Check your email" screen.** Current post-signup flow is too vague — users may close the tab thinking registration completed. Build a dedicated confirmation screen showing the email address used, instructions to check inbox + spam, and a resend button with rate limiting (uses `supabase.auth.resend()`).
* **P1 — Custom SMTP provider for auth emails.** Replace Supabase's default `noreply@mail.supabase.io` sender with a branded address like `noreply@alsport.com.au`. Reasons: 4/hour rate limit on default sender will break at launch, branded sender looks professional, better deliverability. Recommended provider: **Resend** (3,000/month free, modern DX). Requires SPF, DKIM, and DMARC DNS records on the domain. Write ADR-0005 documenting the choice. **Blocked by:** domain purchase.
* **P1 — Branded email templates.** Once custom SMTP is in place, customise the HTML of all Supabase auth emails (Confirm Email, Reset Password, Magic Link, Invite) with ALSA logo, brand colours, proper signature, and footer with incorporated association details.
* **P2 — Enable "Prevent use of leaked passwords"** (Have I Been Pwned integration). Single highest-value auth hardening toggle Supabase offers. **Blocked by:** Pro plan upgrade ($25/month/project).
* **P3 — Consider adding OAuth providers** (Google and/or Discord). Would reduce signup friction for some members. If pursued, write an ADR weighing the tradeoff (convenience vs. third-party dependency + additional privacy implications). Discord specifically could make sense given the laser tag community's existing use of Discord.
* **P3 — Consider magic-link auth as an option alongside password.** Would reduce password-management burden for infrequent users.

### Database \& Backend

* **P0 — Migrate `supabaseAdmin.js` from anon-client shim to proper Vercel API routes using service role key.** Affects 7 files: AdminRegistrations, AdminTeams, AdminUsers, CaptainHub, EventPage, PlayerHub, RefereeTest. Currently admin cross-user queries are silently broken. Should be done before building any more admin features to avoid compounding migration surface area.
* **P2 — Code splitting for bundle size.** Current bundle is \~747KB, above Vite's recommended threshold. Vite warning present. Use `React.lazy()` + route-based splitting on admin routes (biggest wins) and dialog/modal components.
* **P2 — Fix "Multiple GoTrueClient instances" console warning.** Cosmetic. Usually caused by `createClient()` being called multiple times instead of exported from a single module.
* **P2 — Consolidate duplicate queries on the ZLTAC page.** Currently firing multiple overlapping `zltac\\\\\\\_events` and `zltac\\\\\\\_event\\\\\\\_history` queries on page load. Consolidate or memoise with React Query / SWR.
* **P2 — Seed production with real ZLTAC event data.** Once registration is tested end-to-end, seed 2018-2025 historical events into `zltac\\\\\\\_event\\\\\\\_history` and create the 2026 event in `zltac\\\\\\\_events`.

### Documentation

* **P1 — Write `README.md`** at repo root. Project overview, stack, links into `/docs`, screenshot of the live site, how to contribute.
* **P1 — Write `docs/architecture/01-system-overview.md`.** One-page "what is this thing" doc with a simple system diagram (React SPA → Vercel → Supabase → Postgres) for committee members.
* **P1 — Write `docs/architecture/03-access-control.md`** — longer-form narrative version of the data access matrix with reasoning, for readers who don't want to parse a table.
* **P1 — Write `docs/operations/runbook.md`.** Day-to-day ops, deployments, rollbacks, how to rotate keys, how to respond to common issues.
* **P1 — Write `docs/operations/environment-variables.md`.** What each env var does, where it lives, what happens if it's missing.
* **P2 — Write `docs/architecture/02-database-schema.md`** — ERD + table descriptions.
* **P2 — Write `docs/security/threat-model.md`** — what we defend against, what's out of scope.
* **P2 — Write `docs/security/incident-response.md`** — what to do if compromised.
* **P2 — Write `docs/contributing/development-setup.md`** — local dev setup.
* **P2 — Write `docs/contributing/coding-standards.md`** — conventions, linting, commit format.
* **P2 — Write `ADR-0001: Supabase over custom backend.`** Captures why we chose Supabase.
* **P2 — Write `ADR-0004: CMS removed in favour of static content.`** Captures today's decision to drop the three `cms\\\\\\\_\\\\\\\*` tables.
* **P2 — Write `ADR-0005: Custom SMTP provider choice.`** To be written when SMTP is configured (see above).

### Domain \& Infrastructure

* **P1 — Purchase `alsport.com.au` domain.** Blocks custom SMTP, branded emails, and final production URL. Unblocks a cascade of P1 items above.
* **P1 — Cut over to custom domain.** Once purchased: add to Vercel, update Supabase Site URL and redirect URLs, update environment variables, test thoroughly in preview before switching DNS.
* **P2 — Set up status page or uptime monitoring.** Something basic like UptimeRobot (free) pinging the homepage every 5 minutes and alerting on failure.
* **P2 — Set up error tracking.** Sentry free tier would catch frontend crashes in production that otherwise go unreported. Useful once real users start using the portal.

### Events \& Data

* **P2 — Build ZLTAC 2026 event in production** once registration flow is tested. Seed event, side events, pricing, and open registration.
* **P3 — Import historical event history** (2018-2025) into `zltac\\\\\\\_event\\\\\\\_history` with champion teams, locations, MVPs, photos.

### Code Quality

* **P2 — Fix "accessed before declared" pattern across 11 pages.** The `react-hooks/immutability` rule flags 11 pages where a `useEffect` references a function (`load`, `loadData`, `loadAll`, `fetchAll`, `loadVersions`, `loadStats`, `loadEvents`, `loadCurrentEvent`) declared below the effect; several are masked by `// eslint-disable-line`. Benign today for mount-only (`[]`) effects, but fragile — under React Compiler or any deps change these can produce real stale-closure bugs. Sweep PR: move declarations above the effect, or `useCallback` with proper deps, or use the ref pattern established in `src/pages/RefereeTest.jsx` / `src/pages/admin/AdminRefereeTest.jsx` (commit `37e4af8`) for cases where stable identity matters. Affected files: `CaptainHub.jsx`, `PlayerDashboard.jsx`, `PlayerHub.jsx`, `RefereeTest.jsx` (loadData), `admin/AdminCoC.jsx`, `admin/AdminEvent.jsx`, `admin/AdminEventHistory.jsx`, `admin/AdminEvents.jsx`, `admin/AdminMediaRelease.jsx`, `admin/AdminRefereeTest.jsx` (loadAll), `admin/AdminRegistrations.jsx`, `admin/AdminUnder18Form.jsx`. Reference: lint audit run 2026-04-25 against `86a6a64`.
* **P2 — Code-quality sweep: unused vars, stale eslint-disables, ESLint config gaps.** Ten `no-unused-vars` errors across `EventPage.jsx`, `Home.jsx`, `PlayerDashboard.jsx`, `PlayerHub.jsx`, `PlayerRegister.jsx`, `RefereeTest.jsx`, `admin/AdminEvent.jsx`, `admin/AdminHome.jsx` — delete or justify each. Two stale `// eslint-disable` directives in `admin/AdminRefereeTest.jsx` and `admin/AdminTeams.jsx` that no longer suppress anything. ESLint config is missing Node globals: `api/_lib/supabase.js` flags `process is not defined`; `vite.config.js` flags `__dirname is not defined` — add an override with `env: node` or the equivalent `globals` entry for those paths. **Eyeball before deleting:** the unused `role`/`user` destructures at `src/pages/admin/AdminEvent.jsx:98-99` and `src/pages/admin/AdminHome.jsx:35` may be clues about incomplete admin auth-guard code, not dead variables. Reference: lint audit run 2026-04-25 against `86a6a64`.
* **P3 — Restore Fast Refresh for `AuthContext.jsx`.** ESLint flags `src/context/AuthContext.jsx:96` with `react-refresh/only-export-components` — a non-component export is co-located with `AuthProvider`, which breaks HMR for the file (every edit triggers a full remount). Move the non-component export into `src/lib/`.


Community \& Profiles
===



P2 — About page "The Committee" section auto-populates from the admin users page. Committee members are assigned an ALSA Association role (President, Secretary, Treasurer, etc.) via the admin UI, and the About page reflects this dynamically.



P2 — ZLTAC page "Committee" section auto-populates the same way. Admin users page can assign people as ZLTAC Sub-Committee members (distinct from ALSA Association committee). A person can be on one, both, or neither.



Details for both:

\- Each assignment has an optional role. If no specific role assigned, display defaults to "Committee Member".

\- Display card shows: profile picture (fallback: initials on coloured circle), full name, alias, role.

\- Sort order: officeholders first (President → VP → Secretary → Treasurer → Public Officer → Ordinary Committee Member), then alphabetical by name.

\- Profile pictures are not implemented yet — initials fallback for now.

\- Schema: likely a `committee\_roles` table (user\_id, committee\_type, role, active) rather than columns on profiles — supports history, multi-role assignments, and clean audit trail.



P3 — Profile picture upload. Prerequisite for committee page photos and general profile polish. Supabase Storage bucket for avatars with RLS scoping upload to the user's own profile. Image crop + resize client-side before upload.

\---

## Done

*(Items move here when completed, with date and commit reference if applicable.)*

* **2026-04-22 — Role GRANT baseline migration applied.** Fixed systemic 42501 errors across all tables. Documented in `docs/security/data-access-matrix.md` and `ADR-0002`.
* **2026-04-22 — Dropped CMS tables** (`cms\\\\\\\_global`, `cms\\\\\\\_pages`, `cms\\\\\\\_sections`) in favour of static content managed through code. ADR-0004 still to be written.
* **2026-04-22 — Fixed Supabase URL configuration.** Site URL changed from `localhost:3000` to production URL. Added redirect URLs for production, local dev, and Vercel previews.
* **2026-04-22 — Hardened password policy.** Min 10 chars, mixed case + digits required, secure password change + require-current-password both on. Documented in ADR-0003.

