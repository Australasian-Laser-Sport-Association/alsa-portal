# Performance audit — 2026-06-04

Pass 4 of the ALSA Portal full-stack audit. Read-only. Findings from four scoped
sub-agents (4.1 Bundle, 4.2 Queries, 4.3 Render, 4.4 Network & Images),
reconciled into one report — overlaps deduped, cross-section issues stated once
with cross-refs. Every quoted number/line was verified by running the actual
command or reading the actual file. No source was modified.

Build run: `npm run build` (Vite v8.0.13, rolldown) — succeeded, 2199 modules,
9.18s. Verified `dist/assets/index-Cuf-o0YJ.js` = 1,313,262 bytes on disk.

## Summary
- Critical: 0
- High: 3
- Medium: 6
- Low: 3
- Info: 3

The single biggest win is **route-level code-splitting** — the app ships one
1.31 MB / 323 KB-gzip JS bundle (all admin code included) to every anonymous
visitor. The scale risks are all on **bulk/admin data paths** (the backup
generator and the AdminRegistrations/AdminUsers loaders pull whole growing
tables), compounded by **no `useMemo`/virtualisation** on the largest tables.
No single heavy dependency is to blame; no `select('*')`-in-render or
query-in-render-body bugs exist. Deployed admin latency (the brief's ~900 ms
question) **cannot be settled statically** — see Coverage gaps.

---

## Findings

### [High] No route-level code-splitting — entire app ships as one 1.31 MB bundle
**Location:** `src/App.jsx` (all page imports, e.g. `:42` `import AdminVolunteers`, `:46` `import AdminZLTACResults`, route `:125 <Route path="zltac-results" element={<AdminZLTACResults />} />`); `vite.config.js:66-68`
**Evidence:** Vite emits effectively one JS asset:

| Asset | Raw | Gzip |
|---|---|---|
| `dist/assets/index-Cuf-o0YJ.js` | 1,313.26 kB | **323.22 kB** |
| `dist/assets/index-DgFeY13k.css` | 83.66 kB | 13.10 kB |

(There is no top-10 chunk list — there is only one chunk.) A repo-wide grep for
`React.lazy` / `lazy(` / `Suspense` / `import(` returns **NONE FOUND**. Every
page, including the heavy admin tree (`AdminZLTACResults`, `AdminVolunteers`,
`AdminRegistrations`, and the `superadmin/[resource]`-backed pages), is a static
top-of-file import in `App.jsx` with no `<Suspense>` boundary anywhere.
`vite.config.js` `build` block is only `{ sourcemap: true }` — no `manualChunks`
/ `rolldownOptions`. Vite warns verbatim: *"Some chunks are larger than 500 kB
after minification. Consider: Using dynamic import() to code-split…"* (the entry
is ~2.6× the 500 kB threshold).
**Impact:** Every visitor — including anonymous users on the public landing
page who will never open `/admin` — downloads and parses all admin/manager
code. Larger transfer + parse/compile cost on first load, worst on mobile and
on the AU↔`syd1` network path. This is the dominant front-end cost.
**Recommendation:** Convert the route tree to `React.lazy` + a `<Suspense>`
fallback, splitting at least the `/admin` and `/manage` subtrees (and ideally
per public page) into separate chunks. No dependency change required.
**Verification needed:** None — build output and grep both confirmed.

---

### [High] Backup generator pulls every growing table in full (two `select('*')`) plus a per-user N+1
**Location:** `src/lib/backup/generateBackupCsvs.js:86-94` and `:146-153`
**Evidence:**
```js
] = await Promise.all([
  supabase.from('zltac_events').select('*'),          // :86  select('*'), unbounded
  supabase.from('zltac_registrations').select('*'),   // :87  select('*'), unbounded
  supabase.from('teams').select('id, name, captain_id'),                 // :88 unbounded
  supabase.from('profiles').select('id, first_name, ... is_placeholder'),// :89 unbounded
  supabase.from('payment_records').select('id, registration_id, ...'),   // :91 unbounded
  supabase.from('doubles_pairs').select('event_year, ...'),              // :93 unbounded
  supabase.from('triples_teams').select('event_year, ...'),             // :94 unbounded
])
```
All seven reads have **no `.limit()`/`.range()`** — they load the entire history
of every growing table into one serverless function. The two largest
(`zltac_events`, `zltac_registrations`) additionally use `select('*')`. Then for
emails it fans out one Auth call per distinct user (`:146-153`,
`auth.admin.getUserById(uid)` in a loop) — a linear N+1 over every registrant.
Invoked on a cron and an admin button.
**Impact:** Memory and wall-clock grow linearly with the whole organisation
forever; the per-user Auth loop will dominate as registrant count rises. This is
the heaviest single query path in the codebase and the most likely to hit a
function memory/timeout ceiling over time.
**Recommendation:** Column-scope the two `select('*')`; stream/paginate via
`.range()` per table; replace the per-user `getUserById` loop with a single
batched lookup (or join emails server-side). Treat as the priority data-path fix.
**Verification needed:** Confirm current row counts and the function's
memory/timeout config to gauge how close it already is to a limit.

---

### [High] Admin list loaders fetch entire `profiles`/`teams`/`referee_test_results` unbounded on every load
**Location:** `api/admin/event.js:161-173` (AdminRegistrations data); `api/admin/users.js:113-118` (AdminUsers data)
**Evidence:**
```js
// api/admin/event.js — inside one Promise.all
:161 zltac_registrations  (eq year, ~30 explicit cols)        — no limit (per-event, can be large)
:162 profiles             .select('id,first_name,...')        — WHOLE TABLE, no filter/limit
:163 teams                .select('id,name,...')              — WHOLE TABLE, no filter/limit
:168 referee_test_results .select(...)                        — WHOLE TABLE, no filter/limit
:172 doubles_pairs        select('*') (eq year)               :173 triples_teams select('*') (eq year)
```
```js
// api/admin/users.js
:113 profiles            — whole table, order created_at, no limit
:117 zltac_registrations .select('user_id, year') — whole table, no limit
:118 teams               .select('id,name,captain_id') — whole table, no limit
```
The per-query columns are mostly disciplined, but `profiles`,
`referee_test_results`, and `teams` are read in **full, unbounded**, on every
admin page open. (The `Promise.all` batching itself is good — see contrast in the
waterfall finding below.)
**Impact:** These payloads grow monotonically with total signups; the
AdminRegistrations and AdminUsers pages get slower for everyone as the table
grows, independent of how many rows the admin actually views.
**Recommendation:** Bound/paginate the whole-table reads (server-side
pagination or scope to the active event/year where possible); only `profiles`
rows relevant to the current view are needed. `doubles_pairs`/`triples_teams`
`select('*')` should be column-scoped.
**Verification needed:** Confirm whether AdminUsers genuinely needs all profiles
at once or can paginate behind its search/filter UI.

---

### [Medium] Largest tables render unmemoised and unvirtualised (compounds the admin loaders above)
**Location:** `src/pages/admin/AdminRegistrations.jsx:281-412` (derive) + `:687` (table); `src/pages/admin/AdminVolunteers.jsx:588-653` (derive) + `:731` (table) + per-row `approvedRolesOf` `:589`/`:750`; `src/pages/admin/AdminUsers.jsx:173-188` (derive) + `:245` (table)
**Evidence:** No virtualisation library is installed (grep for
`react-window|react-virtual|virtuoso` → zero; confirmed absent from
`package.json`). The hot pages recompute their full pipeline in the render body
with **no `useMemo`** (verified: AdminRegistrations has no `useMemo`; the
pipeline is plain `const players = regs.map(...)` at `:315`, `const filtered =
players.filter(...)` at `:375`):
```jsx
// AdminRegistrations.jsx — runs over all 200+ regs on EVERY render (e.g. each search keystroke)
:281-289  build profMap/teamMap/cocSet/refMap/mediaSet + recordsByReg (paymentRecords.reduce)
:315      const players = regs.map(reg => { ... per-row payRecords.reduce, override-audit strings ... })
:375      const filtered = players.filter(...)
:687      {filtered.map(p => <tr> ...13 columns... </tr>)}   // all rows in DOM, ceiling 200+ players
```
AdminVolunteers `SignupsTab` recomputes `displayed` (filter+sort IIFE, `:646`)
every render and calls `approvedRolesOf` (a `.filter().slice().sort()`) **twice
per signup row** (`:589` def, used `:750` + in CSV). AdminUsers `allStates`
(`:173`) and `filtered` (`:175`) recompute over all profiles each render.
**Contrast (done right):** `AdminMembers.jsx:313-329` and
`AdminUnder18Approvals.jsx:88-400` correctly `useMemo` their derived lists.
**Impact:** On a large event the AdminRegistrations search box re-runs the full
200+-row enrichment on every keystroke and re-renders a ~2,600-cell table —
visible input lag. AdminUsers grows with all profiles.
**Recommendation:** Wrap the derived pipelines in `useMemo` keyed on their real
inputs; virtualise the three big tables (AdminRegistrations, AdminVolunteers
Signups, AdminUsers) once a windowing lib is acceptable, or paginate.
**Cross-ref:** AdminRegistrations is also gated by the unbounded server loader
(High, `api/admin/event.js:161-173`) and the client fetch waterfall (Medium,
below) — same page, three distinct causes.
**Verification needed:** None — code read directly.

---

### [Medium] `useCurrentEvent` has no cache — duplicate open-event query on every page
**Location:** `src/hooks/useCurrentEvent.js:4-37` (consumers: `NavBar.jsx`, `Footer.jsx`, `ActiveEventBanner.jsx`, `Welcome.jsx`)
**Evidence:** The hook is plain per-call `useState`/`useEffect` with no shared
cache/dedup; each mounting consumer fires its own identical
`zltac_events … status='open' … .limit(1).maybeSingle()`. NavBar and Footer
render on virtually every page → **≥2 identical queries per page load**, 3+ on
`/welcome`. The admin dashboards (`AdminZltacDashboard.jsx:64`,
`AdminRegistrations.jsx:238`, `AdminVolunteers`) each *also* issue their own
open-event lookup independently.
**Impact:** Redundant round trips on every navigation; each pays the AU↔`syd1`
RTT. No correctness issue.
**Recommendation:** Back `useCurrentEvent` with a module-level cache or a
context provider so the open event is fetched once per session and shared.
**Verification needed:** None.

---

### [Medium] Client-side fetch waterfalls on admin pages (event-then-data)
**Location:** `src/pages/admin/AdminRegistrations.jsx:236-264`; `src/pages/admin/AdminVolunteers.jsx:409-423` & `:920-930`; `src/pages/admin/AdminZltacDashboard.jsx:62-115`
**Evidence:** AdminRegistrations uses two chained effects: effect #1 fetches the
open `zltac_events` row and sets `eventYear` (`:236-247`); effect #2 only runs
after `eventYear` resolves, then calls `/api/admin/event?resource=registrations`
(`:253-264`) — a serial **client → DB(event) → render → client → API** chain.
AdminZltacDashboard awaits the active-event query alone (`:64-68`) before firing
its (otherwise well-parallelised) 8-query `Promise.all` (`:86`). AdminVolunteers
repeats the events-then-data shape (`:409-423`, `:920-930`).
**Impact:** Each extra serial hop adds one full AU↔`syd1` round trip before the
page can render data — the structural component of admin "slowness."
**Recommendation:** Resolve the active event server-side within the data
endpoint (or pass it through) so the page makes one request, not a dependent
pair. The per-request `Promise.all` batching is already correct; the waterfall
is in the *sequencing* of requests.
**Cross-ref:** feeds the latency Info finding below.
**Verification needed:** Magnitude needs runtime measurement (Coverage gaps).

---

### [Medium] Sequential N+1 `getUserById` in the superadmin managers endpoint
**Location:** `api/superadmin/[resource].js:491-498`
**Evidence:** The managers list loops over each manager row and `await`s
`supabaseAdmin.auth.admin.getUserById(r.user_id)` one at a time to resolve
emails. (By contrast `withRegistrationsCount`, `:185-203`, correctly batches via
a single `.in('competition_id', ids)`.) A code comment notes the set is "tiny"
today.
**Impact:** Latency scales linearly with manager count, each call a separate
Auth round trip; fine now, a latent cliff as competitions/managers grow.
**Recommendation:** Batch the email lookups (one admin call / a join) instead of
per-row sequential awaits.
**Verification needed:** None — the pattern is confirmed in source.

---

### [Medium] Images ship full-resolution with no width/height and no optimization layer
**Location:** all `<img>` in `src/` (none set `width`/`height`); notably full-width covers/banners `src/pages/EventPage.jsx:727` (`event.cover_photo_url`, `aspect-[4096/1716]`), `src/pages/public/CompetitionDetail.jsx:320` (`comp.banner_url`); galleries `EventPage.jsx:759` & `ZLTACYearDetail.jsx:312` (full-res `event-photos` as thumbnails); hero `Home.jsx:102` (`/alsa-logo.png`, 360px)
**Evidence:** No `<img>` in the codebase sets explicit `width`/`height`
attributes (sizing is Tailwind classes / inline `style` only); no `srcset`,
`sizes`, `decoding`, or `fetchpriority` anywhere, and only one `loading` hint
(`ZLTACLanding.jsx:133`, `loading="eager"`) — nothing uses `loading="lazy"`.
Storage buckets serve raw at upload resolution: `event-photos` and
`event-covers` (5 MB limit), `competition-banners` (5 MB). **No optimization
layer exists** — `vercel.json` has no `images` block (and this is a Vite SPA, so
`next/image` is unavailable); `package.json` has no `sharp`/`imgix`/`cloudinary`/
`vite-imagetools`; no Supabase `/render/image/` transform usage found. (All
`backgroundImage` uses are CSS gradients — no raster cost.)
**Impact:** Layout shift (CLS) from unsized images; full-resolution covers/
banners and gallery photos downscaled by CSS only mean large transfers,
especially on the AU network path and mobile.
**Recommendation:** Add intrinsic `width`/`height` (or `aspect-ratio` wrappers,
already used for covers) on all `<img>`; `loading="lazy"` for gallery/below-fold
images; introduce a transform/resize step (Supabase image transforms or a CDN)
so thumbnails aren't full-res.
**Verification needed:** Actual byte sizes of representative uploaded
cover/gallery assets (needs the live bucket) to quantify savings.

---

### [Low] Wide `profiles`/`events` single-row reads via `select('*')` on hot paths
**Location:** `src/context/AuthContext.jsx:14` (`profiles.select('*')`, every session); `src/pages/PlayerHub.jsx:827`, `src/pages/PlayerDashboard.jsx:435`, `src/pages/EventPage.jsx:510` (`profiles`/`zltac_events` `select('*')`)
**Evidence:** These are row-bounded (`.eq(id)`/`.eq(year)` + `.single()`/
`maybeSingle()`), so not unbounded, but they pull every column of wide rows.
`AuthContext` fetches the full profile on every session.
**Impact:** Minor over-fetch of unused columns on common paths; negligible vs
the High findings.
**Recommendation:** Column-scope to the fields actually consumed, especially the
AuthContext profile read.
**Verification needed:** None.

---

### [Low] User-uploaded SVG logos rendered with no dimension/complexity guard
**Location:** `src/pages/EventPage.jsx:52`, `src/pages/PlayerHub.jsx:1649`, `src/pages/CaptainHub.jsx:686` & `:961` (`team.logo_url`, `team-logos` bucket allows `image/svg+xml`)
**Evidence:** The `team-logos` bucket accepts SVG (migration
`20260520000000`); logos render via `<img src>` (a deliberate XSS mitigation,
per the comment at `CaptainHub.jsx:679-686`) but with no `width`/`height` and no
size/complexity cap.
**Impact:** A large/complex SVG could cause layout shift or render cost; bounded
by the 2 MB bucket limit, so low.
**Recommendation:** Set explicit dimensions on logo `<img>` and consider a
max-size guard on upload.
**Verification needed:** None.

---

### [Low] Sentry loaded eagerly in the entry path
**Location:** `src/main.jsx:5-13` (`import * as Sentry from "@sentry/react"`, `Sentry.init({ integrations: [Sentry.browserTracingIntegration()] })`)
**Evidence:** Sentry + `browserTracingIntegration` initialise eagerly on every
page (one of Sentry's heavier pieces). Exact gzip contribution is not separable
from the single bundle (see Info below), but Sentry browser+tracing is typically
~30–50 KB gzip.
**Impact:** Adds to the eager entry weight on every load.
**Recommendation:** Consider `Sentry.lazyLoadIntegration` / deferred init —
weighed against the value of catching startup errors early (a real trade-off,
not a clear win).
**Verification needed:** Per-dependency gzip size (needs a bundle visualizer —
out of scope, no new deps).

---

### [Info] No heavy visualization/3D/data dependency — bundle size is structural
**Location:** `package.json` dependencies
**Evidence:** None of recharts, d3, three, plotly, tone, tensorflow, chart.js,
framer-motion, moment, or lodash are present. Client runtime deps are
`@sentry/react`, `@supabase/supabase-js`, `react`, `react-dom`,
`react-router-dom`, `lucide-react` (named icon imports, tree-shake well).
**Impact:** Confirms the 323 KB gzip is **not** one fat library — the fix is
code-splitting (High finding), not dependency replacement.
**Recommendation:** None beyond the code-split finding.
**Verification needed:** Per-dependency attribution is inconclusive from Vite's
output alone because nothing is split (would need a visualizer — not installed
per scope).

---

### [Info] No `select('*')`-in-render and no query-in-render-body anti-patterns
**Location:** all of `src/` and `api/`
**Evidence:** Every client `supabase.from(...)` call sits inside a `useEffect`,
an async loader called from an effect, or an event handler — **zero** queries
execute during render (AuthContext, useCurrentEvent, NavBar, PlayerHub,
CaptainHub, EventPage, and all admin pages checked specifically). Interactive
list endpoints are largely column-scoped; dashboard "recent activity" feeds are
correctly capped (`AdminZltacDashboard.jsx:104/109/112` use `.limit(5/5/20)`).
**Impact:** Positive — the query layer is disciplined on the interactive
surfaces; the risks are confined to the bulk/admin paths called out above.
**Recommendation:** None.
**Verification needed:** None.

---

### [Info] Deployed admin latency requires runtime measurement
**Location:** `vercel.json` (`regions: ["syd1"]`)
**Evidence:** The brief's "~900 ms after the syd1 pin" figure **cannot be
derived from the repo** and was not fabricated here. The `syd1` pin is confirmed.
Static analysis supplies the candidate causes for a real measurement to confirm:
the eager 323 KB bundle (High), the event-then-data client waterfalls (Medium),
the uncached `useCurrentEvent` duplicate queries (Medium), the managers N+1
(Medium), and the unbounded admin loaders (High) — each serial hop multiplied by
the AU↔`syd1` RTT.
**Impact:** n/a (observation).
**Recommendation:** Measure with Vercel function logs/Observability + browser
DevTools Network (TTFB/waterfall) on the admin pages, ideally from an AU origin
(WebPageTest), then confirm against the candidates above.
**Verification needed:** All of the above — runtime only.

---

## Coverage gaps

- **Deployed/admin latency (4.4):** the ~900 ms figure is unmeasurable from
  source. Needs Vercel function execution logs, browser DevTools Network
  (TTFB + waterfall), and/or WebPageTest from an AU origin. Static pass only
  identified candidate causes, not timings.
- **Per-dependency gzip attribution (4.1):** inconclusive — the app builds to a
  single chunk, so Vite's output cannot break out how many KB Sentry vs Supabase
  vs React contribute. A bundle visualizer would settle it, but installing one is
  out of scope (no new deps).
- **Actual table row counts:** the High data-path findings (backup generator,
  admin loaders) scale with row counts that can't be read from the repo. Their
  real-world severity depends on current `profiles`/`zltac_registrations`/
  `payment_records` sizes (query the live DB / Supabase dashboard).
- **Uploaded asset byte sizes (4.4):** the image-weight impact depends on the
  actual bytes of cover/banner/gallery uploads in the live storage buckets,
  which a static pass can't see.
- **Function memory/timeout headroom:** whether the backup generator is near a
  serverless limit needs the function config + a real run against production
  data volume.
- **Render-cost profiling:** the unmemoised/unvirtualised findings are confirmed
  structurally from source, but the actual frame/interaction cost (e.g. search
  keystroke lag on AdminRegistrations) needs React Profiler / DevTools
  Performance against a realistically large dataset.
- **CSS / runtime memory / long-task profiling** and real Core Web Vitals (LCP,
  CLS, INP) were not measured — they require a deployed/profiled session.
