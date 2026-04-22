# ALSA Portal — Backlog

**Purpose:** Running list of improvements, tasks, and ideas that are not immediately blocking, but should not be forgotten. Captured here so we can stay focused on the current task without losing future work.

**How to use this file:**
- Anyone (or Claude) can add an item at any time
- Items are grouped by category, and each has a priority: **P0** (blocker, do now), **P1** (before launch), **P2** (post-launch polish), **P3** (nice to have)
- When an item is done, move it to the `## Done` section at the bottom with the date
- When a decision is made about an item that warrants architectural reasoning, promote it to an ADR in `docs/adr/`
- Items that depend on external events (domain purchase, Pro plan upgrade) are noted with a `blocked by:` tag

---

## Active

### Authentication & Email

- **P0 — Fix post-signup flow UX (cluster of 5 items, tackle as one focused session).** The current signup experience is confusing and drops users at multiple points. Fix all together:
  - Dedicated "Check your email" screen after signup (instead of auto-redirecting to login with vague toast)
  - Resend confirmation email button from login error state (uses `supabase.auth.resend()`, rate-limited)
  - Dedicated `/auth/confirmed` landing page (currently redirects to homepage with no success message)
  - First-time profile completion flow (currently drops user on empty dashboard)
  - Dashboard "Complete your profile" nudge for users who skipped fields
- **P1 — Custom SMTP provider for auth emails.** Replace Supabase's default `noreply@mail.supabase.io` sender with a branded address like `noreply@alsport.com.au`. Reasons: 4/hour rate limit on default sender will break at launch, branded sender looks professional, better deliverability. Recommended provider: **Resend** (3,000/month free, modern DX). Requires SPF, DKIM, and DMARC DNS records on the domain. Write ADR-0005 documenting the choice. **Blocked by:** domain purchase.
- **P1 — Branded email templates.** Once custom SMTP is in place, customise the HTML of all Supabase auth emails (Confirm Email, Reset Password, Magic Link, Invite) with ALSA logo, brand colours, proper signature, and footer with incorporated association details.
- **P2 — Enable "Prevent use of leaked passwords"** (Have I Been Pwned integration). Single highest-value auth hardening toggle Supabase offers. **Blocked by:** Pro plan upgrade ($25/month/project).
- **P3 — Consider adding OAuth providers** (Google and/or Discord). Would reduce signup friction for some members. If pursued, write an ADR weighing the tradeoff. Discord specifically could make sense given the laser tag community's existing use of Discord.
- **P3 — Consider magic-link auth as an option alongside password.** Would reduce password-management burden for infrequent users.

### Database & Backend

- **P0 — Migrate `supabaseAdmin.js` from anon-client shim to proper Vercel API routes using service role key.** Affects 7 files: AdminRegistrations, AdminTeams, AdminUsers, CaptainHub, EventPage, PlayerHub, RefereeTest. **Confirmed necessary by smoke test:** AdminUsers shows "0 members registered" despite 1 user existing; AdminRegistrations throws 6 distinct "permission denied" errors on page load. The admin panel is visibly non-functional for cross-user workflows until this is done.
- **P1 — Fix schema drift bug: `payments.amount_paid` column doesn't exist.** Admin registrations code references `amount_paid` but the actual column is named `amount` (integer, storing cents). Grep-and-rename job across codebase. Check for other similar drift while at it.
- **P1 — Investigate phantom "ZLTAC 2027" event appearing in UI.** Admin dashboard shows "ZLTAC 2027 — Registration open" and AdminRegistrations shows "ZLTAC 2027 — 0 players." No 2027 event seeded. Likely a hardcoded fallback or stale default in `event_settings` table. Find source, remove.
- **P1 — Expand `payments` table schema for production use.** Missing fields that a real payment flow needs:
  - `paid_at timestamptz` — distinct from `created_at`
  - `currency text DEFAULT 'AUD'` — explicit, not assumed
  - `payment_method text` — card/bank/manual
  - `payment_provider_id text` — for Stripe/PayPal webhook reconciliation
  - Add CHECK constraint or enum on `status` (currently free-text, invites typos)
- **P1 — Drop `emergency_contact_name` and `emergency_contact_phone` columns from `profiles`.** Move to `event_registrations` where they belong (event-specific, time-sensitive). Under-18s will continue to capture this via the guardian form.
- **P1 — Implement membership model per ADR-0006 (to be written).** Add `membership_status`, `membership_expires_at`, `directory_visible` columns to `profiles`. Create scheduled lapse logic. See architecture question below.
- **P2 — Code splitting for bundle size.** Current bundle is ~747KB, above Vite's recommended threshold. Vite warning present. Use `React.lazy()` + route-based splitting on admin routes (biggest wins) and dialog/modal components.
- **P2 — Fix "Multiple GoTrueClient instances" console warning.** Cosmetic. Usually caused by `createClient()` being called multiple times instead of exported from a single module.
- **P2 — Consolidate duplicate queries on the ZLTAC page.** Was firing multiple overlapping queries originally; now down to 3 after GRANT fix. Still worth memoising with React Query / SWR as query volume grows.
- **P2 — Seed production with real ZLTAC event data.** Seed 2018-2025 historical events into `zltac_event_history` and create the 2026 event in `zltac_events`. Do this via the admin UI (not SQL) to simultaneously test the admin flow.
- **P2 — Decide: is "ALSA #715B7947" (first 8 chars of UUID) the right member ID format?** Alternative: proper sequential/formatted IDs like `ALSA-2026-0042`. Former is simpler and collision-free. Latter is more professional for external-facing display. Committee decision, worth an ADR.

### Frontend & UX

- **P1 — Scroll-to-top on route change.** Classic React SPA bug — navigating to a new page preserves scroll position from the previous page. Fix: standard `ScrollToTop` component that calls `window.scrollTo(0, 0)` on route change.
- **P1 — Design authenticated navigation and page gating policy.** Clarify which pages are always accessible (dashboard, profile, event info), progressively disclosed (referee test requires intent), and role-gated (admin). Write **ADR-0007: Page Access and Navigation Policy**.
- **P1 — Decide "View Current Event" button destination.** Currently routes to ZLTAC main page. Alternatives: dedicated `/event/zltac-2026` detail page, or keep routing to ZLTAC page with current event prominently displayed there. UX + information architecture question.
- **P1 — Delete `/admin/teams` page.** Leftover from old project architecture (references deprecated Round Robin Generator). Duplicate of functionality available in AdminRegistrations. Replace with richer unified registrations view per admin philosophy ADR.
- **P1 — Build unified AdminRegistrations view.** Show each registration with team, players, payments, and policy submissions inline. Philosophy: data in context beats data in isolation (modern SaaS admin pattern). Write **ADR-0008: Admin Panel Philosophy** capturing the unified-view approach.
- **P3 — Rename "Back to Player Hub" link on referee test empty state → "Back to Dashboard"** for consistency with nav labelling.
- **P3 — Profile picture upload.** Currently broken. Initials fallback works fine (AC on green circle). Not launch-critical. Requires Supabase Storage bucket setup, RLS on storage, image resizing, moderation. Defer unless specifically requested.

### Architecture Decisions Needed (ADRs)

- **ADR-0001** — Supabase over custom backend. Captures why we chose Supabase.
- **ADR-0004** — CMS removed in favour of static content. Captures today's decision to drop the three `cms_*` tables.
- **ADR-0005** — Custom SMTP provider choice. To be written when SMTP is configured.
- **ADR-0006 — Membership Model.** Critical ADR before the committee architecture meeting. Captures the "everyone is a member, tracked by status (active/lapsed/lifetime)" decision from this session. Schema changes to follow.
- **ADR-0007 — Page Access and Navigation Policy.** When direct URL access is fine vs. when progressive disclosure is appropriate.
- **ADR-0008 — Admin Panel Philosophy.** Unified registrations view vs. specialised per-entity pages.
- **ADR-0009 — Volunteer Registration Model.** See feature below.
- **ADR-0010 — Member Notification System.** See feature below.
- **ADR-0011 — Role Resolution Strategy.** Captures decision to read roles from DB on render rather than from JWT claims. Trade-off: responsiveness (roles take effect immediately, no re-login) vs. performance (every check hits DB). Observed during session.

### New Features (post-launch)

- **P1 — Volunteer registration system.** Volunteers (photographers, referees, scorekeepers, medics, gear wranglers) need:
  - Separate registration flow (`/volunteer-register/zltac-2026`)
  - `volunteer_roles` enum (photographer, referee, scorekeeper, medic, general)
  - `volunteer_registrations` table linked to events
  - Role-specific waivers (photographer media release differs from general)
  - Admin UI to see volunteer list per event
  - Possibly bulk comms to volunteer cohort
  - Required for ZLTAC 2026 if volunteers are involved. See ADR-0009.
- **P2 — Member notification system.** Four-part feature:
  - **A.** In-portal notifications (bell icon, notification centre, `notifications` table with `recipient_id`, `type`, `title`, `body`, `read_at`, `sent_at`, `action_url`)
  - **B.** Admin "send announcement" UI (pick recipients: all / event registrants / specific team / specific role / individual)
  - **C.** Email fan-out when announcement is sent (uses SMTP from ADR-0005, needs templating, rate limiting, unsubscribe links — check Spam Act 2003 compliance)
  - **D.** Scheduled/triggered notifications ("7 days before rego closes, email unregistered members") — needs Supabase scheduled functions or Vercel Cron
  - See ADR-0010. Substantial feature (~3-4 focused days). Meaningful engagement improvement.

### Documentation

- **P1 — Write `README.md`** at repo root. Project overview, stack, links into `/docs`, screenshot of the live site, how to contribute.
- **P1 — Write `docs/architecture/01-system-overview.md`.** One-page "what is this thing" doc with a simple system diagram (React SPA → Vercel → Supabase → Postgres) for committee members.
- **P1 — Write `docs/architecture/03-access-control.md`** — longer-form narrative version of the data access matrix with reasoning, for readers who don't want to parse a table.
- **P1 — Write `docs/operations/runbook.md`.** Day-to-day ops, deployments, rollbacks, how to rotate keys, how to respond to common issues. Include: "how to grant a user admin access" (UPDATE profiles SET roles), "how to add a past event via admin UI", "role changes take effect immediately — no re-login required."
- **P1 — Write `docs/operations/environment-variables.md`.** What each env var does, where it lives, what happens if it's missing. Include note about Site URL cutover when custom domain is ready.
- **P2 — Write `docs/architecture/02-database-schema.md`** — ERD + table descriptions.
- **P2 — Write `docs/security/threat-model.md`** — what we defend against, what's out of scope.
- **P2 — Write `docs/security/incident-response.md`** — what to do if compromised.
- **P2 — Write `docs/contributing/development-setup.md`** — local dev setup.
- **P2 — Write `docs/contributing/coding-standards.md`** — conventions, linting, commit format.
- **P2 — Committee onboarding runbook.** Step-by-step for non-technical committee members: "how to add a past event," "how to publish a new Code of Conduct version," "how to approve a registration," etc. Turns the admin UI's existing richness into documented institutional knowledge.

### Domain & Infrastructure

- **P1 — Purchase `alsport.com.au` domain.** Blocks custom SMTP, branded emails, and final production URL. Unblocks a cascade of P1 items above.
- **P1 — Cut over to custom domain.** Once purchased: add to Vercel, update Supabase Site URL and redirect URLs, update environment variables, test thoroughly in preview before switching DNS.
- **P2 — Set up status page or uptime monitoring.** Something basic like UptimeRobot (free) pinging the homepage every 5 minutes and alerting on failure.
- **P2 — Set up error tracking.** Sentry free tier would catch frontend crashes in production that otherwise go unreported. Useful once real users start using the portal.

### Events & Data

- **P2 — Build ZLTAC 2026 event in production** via admin UI (not SQL). Seed event, side events, pricing, and open registration. Doubles as an admin UI validation test.
- **P2 — Import historical event history** (2018-2025) into `zltac_event_history` with champion teams, locations, MVPs, photos. Via admin UI. Basis for committee onboarding runbook.

---

## Done

- **2026-04-22 — Role GRANT baseline migration applied.** Fixed systemic 42501 errors across all tables. Documented in `docs/security/data-access-matrix.md` and `ADR-0002`.
- **2026-04-22 — Dropped CMS tables** (`cms_global`, `cms_pages`, `cms_sections`) in favour of static content managed through code. ADR-0004 still to be written.
- **2026-04-22 — Fixed Supabase URL configuration.** Site URL changed from `localhost:3000` to production URL. Added redirect URLs for production, local dev, and Vercel previews.
- **2026-04-22 — Hardened password policy.** Min 10 chars, mixed case + digits required, secure password change + require-current-password both on. Documented in ADR-0003.
- **2026-04-22 — Completed full 4-phase smoke test of the ALSA Portal.** Phase 1 (public): passing. Phase 2 (auth): core works, UX polish needed. Phase 3 (player-side): passing, all empty states well-built. Phase 4 (admin): routes gated correctly, admin UI well-built, confirmed P0 shim migration necessary.
- **2026-04-22 — Promoted test account to `superadmin` role** to enable admin panel testing.
