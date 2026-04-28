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

* **P2 — Enable "Prevent use of leaked passwords"** (Have I Been Pwned integration). Single highest-value auth hardening toggle Supabase offers. **Blocked by:** Pro plan upgrade ($25/month/project).
* **P3 — Consider adding OAuth providers** (Google and/or Discord). Would reduce signup friction for some members. If pursued, write an ADR weighing the tradeoff (convenience vs. third-party dependency + additional privacy implications). Discord specifically could make sense given the laser tag community's existing use of Discord.
* **P3 — Consider magic-link auth as an option alongside password.** Would reduce password-management burden for infrequent users.
* **P3 — Custom expired-link page for email confirmation.** Supabase confirmation links expire after 24h. Currently the user lands on a generic Supabase error. Build a friendly `/auth/expired` route that explains "this link has expired" and offers a "send me a new one" button.
* **P2 — Verify production Supabase auth settings match ADR-0003.** Several auth policy settings (password complexity, OTP length, secure password change, require current password on change, secure email change) live in the Supabase dashboard rather than in config.toml or migrations. Committee should open the production project → Authentication → Settings and confirm each matches the ADR. Document the verified state in the runbook.
* **P3 — Show password complexity hints inline.** Production Supabase enforces letters + uppercase + digits server-side; the frontend doesn't show this upfront, so users hit a confusing rejection. Add a hint line and live validation feedback below the password field in Register.jsx.

### Database \& Backend

* **P2 — Code splitting for bundle size.** Current bundle is \~747KB, above Vite's recommended threshold. Vite warning present. Use `React.lazy()` + route-based splitting on admin routes (biggest wins) and dialog/modal components.
* **P2 — Rate-limit `/api/contact`.** The contact-form endpoint has no rate limiting — a single attacker can drain the Resend free-tier quota or fill the committee inbox. Add a basic per-IP limit (e.g. 5/hour, 20/day) using Upstash Redis or Vercel KV. The honeypot field handles naive bots but won't stop a determined sender. Pre-launch hardening — not blocking, but should land before the public domain cutover.
* **P2 — Fix "Multiple GoTrueClient instances" console warning.** Cosmetic. Usually caused by `createClient()` being called multiple times instead of exported from a single module.
* **P2 — Consolidate duplicate queries on the ZLTAC page.** Currently firing multiple overlapping `zltac\\\\\\\_events` and `zltac\\\\\\\_event\\\\\\\_history` queries on page load. Consolidate or memoise with React Query / SWR.
* **P2 — Seed production with real ZLTAC event data.** Once registration is tested end-to-end, seed 2018-2025 historical events into `zltac\\\\\\\_event\\\\\\\_history` and create the 2026 event in `zltac\\\\\\\_events`.
* **P3 — Storage object cleanup sweep job.** Several actions (profile reset, future account deletion, event archive) leave storage objects orphaned in the `avatars`, `team-logos`, `event-logos`, and `event-photos` buckets. Cumulative cost is small (KB-scale), and orphaned URLs aren't referenced anywhere so there's no PII leak risk. But over years this drifts. Build a periodic sweep job that compares storage objects against database references and removes the unreferenced ones.

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

* **P2 — Set up status page or uptime monitoring.** Something basic like UptimeRobot (free) pinging the homepage every 5 minutes and alerting on failure.
* **P2 — Set up error tracking.** Sentry free tier would catch frontend crashes in production that otherwise go unreported. Useful once real users start using the portal.

### Events \& Data

* **P2 — Build ZLTAC 2026 event in production** once registration flow is tested. Seed event, side events, pricing, and open registration.
* **P3 — Import historical event history** (2018-2025) into `zltac\\\\\\\_event\\\\\\\_history` with champion teams, locations, MVPs, photos.

### Code Quality

* **P2 — Fix "accessed before declared" pattern across 11 pages.** The `react-hooks/immutability` rule flags 11 pages where a `useEffect` references a function (`load`, `loadData`, `loadAll`, `fetchAll`, `loadVersions`, `loadStats`, `loadEvents`, `loadCurrentEvent`) declared below the effect; several are masked by `// eslint-disable-line`. Benign today for mount-only (`[]`) effects, but fragile — under React Compiler or any deps change these can produce real stale-closure bugs. Sweep PR: move declarations above the effect, or `useCallback` with proper deps, or use the ref pattern established in `src/pages/RefereeTest.jsx` / `src/pages/admin/AdminRefereeTest.jsx` (commit `37e4af8`) for cases where stable identity matters. Affected files: `CaptainHub.jsx`, `PlayerDashboard.jsx`, `PlayerHub.jsx`, `RefereeTest.jsx` (loadData), `admin/AdminCoC.jsx`, `admin/AdminEvent.jsx`, `admin/AdminEventHistory.jsx`, `admin/AdminEvents.jsx`, `admin/AdminMediaRelease.jsx`, `admin/AdminRefereeTest.jsx` (loadAll), `admin/AdminRegistrations.jsx`, `admin/AdminUnder18Form.jsx`. Reference: lint audit run 2026-04-25 against `86a6a64`.
* **P2 — Code-quality sweep: unused vars, stale eslint-disables, ESLint config gaps.** Ten `no-unused-vars` errors across `EventPage.jsx`, `Home.jsx`, `PlayerDashboard.jsx`, `PlayerHub.jsx`, `PlayerRegister.jsx`, `RefereeTest.jsx`, `admin/AdminEvent.jsx`, `admin/AdminHome.jsx` — delete or justify each. One stale `// eslint-disable` directive in `admin/AdminRefereeTest.jsx` that no longer suppresses anything. ESLint config is missing Node globals: `api/_lib/supabase.js` flags `process is not defined`; `vite.config.js` flags `__dirname is not defined` — add an override with `env: node` or the equivalent `globals` entry for those paths. **Eyeball before deleting:** the unused `role`/`user` destructures at `src/pages/admin/AdminEvent.jsx:98-99` and `src/pages/admin/AdminHome.jsx:35` may be clues about incomplete admin auth-guard code, not dead variables. Reference: lint audit run 2026-04-25 against `86a6a64`.
* **P3 — Restore Fast Refresh for `AuthContext.jsx`.** ESLint flags `src/context/AuthContext.jsx:96` with `react-refresh/only-export-components` — a non-component export is co-located with `AuthProvider`, which breaks HMR for the file (every edit triggers a full remount). Move the non-component export into `src/lib/`.

### Governance

* **P3 — Committee role differentiation.** `AdminEvent` has sensitive actions (`handleArchiveAndCreate`, status transitions, event-config writes) with no differentiated authorization — any committee member can do any of them. Server-side `verifyCommittee()` in `api/_lib/auth.js` treats all four committee roles (`superadmin`, `alsa_committee`, `zltac_committee`, `advisor`) equivalently; only the `DELETE` in `api/admin/users.js` uses the stricter `verifySuperAdmin()`. No policy currently exists for "only superadmin can archive an event," "advisor is read-only," or similar. This is a real committee decision + an ADR + API route changes, not a cleanup — surface for committee discussion when the portal reaches review. Context: investigated at commit `1f37874` while removing the dead `role` destructure that anticipated this work.


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
* **2026-04-26 — Custom SMTP provider configured (Resend).** `lasersport.org.au` domain verified with SPF/DKIM/DMARC. Two separate API keys: one for Supabase auth emails, one for `/api/contact`. ADR-0005 to be written.
* **2026-04-26 — Domain `lasersport.org.au` purchased and live.** Cutover complete: Vercel custom domain, Supabase Site URL + redirect URLs, env vars all updated. Note: domain is `lasersport.org.au`, not the previously planned `alsport.com.au`.
* **2026-04-27 — Post-signup "Check your email" screen.** Phase 2A added the post-signup messaging; Phase 2B added the `/welcome` page reached after email confirmation.
* **2026-04-27 — Branded email templates via Resend.** Auth emails sent through Resend using verified `lasersport.org.au` domain.
* **2026-04-28 — supabaseAdmin migration to API routes complete.** All six pages (AdminRegistrations, AdminUsers, CaptainHub, EventPage, PlayerHub, RefereeTest) now use proper Vercel API routes with service role key.
* **2026-04-28 — Granted service_role privileges on all public tables.** Migration leftover: service_role had no GRANTs on profiles/teams/zltac_registrations, causing 42501 permission errors on /admin/users. Fixed with schema-wide grant + default privileges for future tables.

