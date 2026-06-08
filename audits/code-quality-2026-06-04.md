# Code quality & maintainability audit — 2026-06-04

Pass 3 of the ALSA Portal full-stack audit. Read-only. Every claim below was
verified by reading the actual file or running the actual command; where a check
was inconclusive it is marked as such rather than guessed.

Scope reviewed: `src/**/*.{js,jsx}`, `api/**/*.js`, `eslint.config.js`,
`src/index.css`, `docs/`. Lint run: `npm run lint` (eslint 9, flat config).

## Summary
- Critical: 0
- High: 0
- Medium: 5
- Low: 12
- Info: 8

The codebase is in good shape on the things that usually rot first: **no
`console.log`/`console.debug` in production paths**, **no `dangerouslySetInnerHTML`
/`eval`/`innerHTML`**, **no commented-out code blocks**, **no N+1 fetch patterns**,
**clean memoisation hygiene**, and a **lint baseline that exactly matches the
expected 30 problems** with no regression. The recurring weaknesses are all in
two areas: (1) error handling — Supabase results destructured as `{ data }` with
`error` discarded, and a few genuinely unhandled promise rejections; and (2)
consistency drift — design-token bypass and timezone handling that is only wired
into one screen.

---

## Findings

### [Medium] Async handlers with no rejection handler (sticky spinner / silent state divergence)
**Location:** `src/pages/admin/AdminUsers.jsx:82-86`; `src/pages/PlayerHub.jsx:946-957`
**Evidence:**
```js
// AdminUsers.jsx — loadUsers has no try/catch; apiFetch throws on non-ok
useEffect(() => { loadUsers() }, [])
async function loadUsers() {
  setLoading(true)
  const { profiles, registrations, teams } = await apiFetch('/api/admin/users')
  ...
  setLoading(false)   // never reached if apiFetch rejects
}
```
```js
// PlayerHub.jsx — .then() with no .catch in a toggle handler
apiFetch('/api/player?resource=doubles', { method:'POST',
  body: JSON.stringify({ action:'delete', id: doublesRecord.id }) })
  .then(() => setDoublesRecord(null))      // no .catch
...
apiFetch('/api/player?resource=triples', { ... }).then(() => setTriplesRecord(null))  // no .catch
```
`apiFetch` throws on any non-OK response (`src/lib/apiFetch.js:13`). In
`AdminUsers.loadUsers` a failed fetch leaves an unhandled promise rejection and
`setLoading(false)` never runs, so the page is stuck on the spinner with no error
UI. In `PlayerHub.toggleSideEvent` a failed delete/disband is an unhandled
rejection and the checkbox state silently diverges from the server.
**Impact:** On a backend/network failure an admin sees a permanent spinner; a
player's side-event selection silently desyncs from what's actually stored.
**Recommendation:** Wrap `loadUsers` in `try/catch (e) { setError(e.message) } finally { setLoading(false) }` (the pattern already used in most other admin loaders, e.g. `AdminMembers.jsx`). Add `.catch()` to both `toggleSideEvent` chains and revert the optimistic `setSelectedSlugs` on failure.
**Verification needed:** None — confirmed by reading both files and `apiFetch.js`.

---

### [Medium] Supabase writes destructure `{ data }` and discard `error` — mutations fail silently
**Location:** `src/pages/PlayerHub.jsx:964-966` and `:980-982`; `src/pages/CaptainRegister.jsx:137`
**Evidence:**
```js
// PlayerHub.confirmSideEvents — write error is discarded
const { data: updated } = await supabase.from('zltac_registrations')
  .update({ side_events:[...selectedSlugs], has_confirmed_side_events:true })
  .eq('user_id', user.id).eq('year', event.year).select().single()
if (updated) { ... }      // if the UPDATE errors, updated is undefined → silent no-op
```
```js
// CaptainRegister.jsx:137 — captain self-registration upsert, error ignored
const { data: capReg } = await supabase.from('zltac_registrations')
  .upsert({...}).select('id').single()
if (capReg?.id) await recomputeOwing(capReg.id)   // failure: team exists, captain not registered, user advanced to step 2
```
`confirmExtras` (`PlayerHub.jsx:980`) has the identical shape. None of these check
the `error` field, so a failed mutation produces **no** user feedback — the
spinner simply stops and the UI proceeds as if it saved.
**Impact:** A player can believe their side events / dinner guests are confirmed
when the write failed; a captain's team can be created without the captain being
registered onto it. Only triggers on a DB/RLS error, but when it does it is
invisible.
**Recommendation:** Destructure `{ data, error }` and surface `error` (the codebase
already has `setError`/toast patterns in the same components). For the write +
recompute + refetch sequence, treat a write `error` as a hard failure shown to the
user before advancing UI state.
**Verification needed:** None — verified by reading the handlers.

---

### [Medium] AuthContext swallows profile-load error → null profile drives role-gated UI
**Location:** `src/context/AuthContext.jsx:12-16`
**Evidence:**
```js
async function fetchProfile(userId) {
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
  setProfile(data ?? null)   // error ignored: a transient failure looks like "no profile"
  setProfileLoading(false)
}
```
The profile drives `isAdmin`/role checks consumed across the app. A transient
load failure resolves to `profile = null`, indistinguishable from a user who has
no roles.
**Impact:** On a flaky profile fetch a committee member can momentarily render as a
plain player (admin nav/tiles hidden), or a logged-in user can be treated as
unauthenticated by role-gated UI. Contained (RLS still enforces server-side) but
confusing and hard to diagnose.
**Recommendation:** Destructure `{ data, error }`; on `error`, keep a distinct
`profileError` state and retry or show a non-blocking "couldn't load your profile"
notice rather than silently falling to `null`.
**Verification needed:** None.

---

### [Medium] Event/competition dates rendered in browser-local timezone, bypassing the TZ layer
**Location:** `src/lib/dateFormat.js:13`; `src/pages/Welcome.jsx:8-22`; `src/components/ActiveEventBanner.jsx:10-13`; `src/components/ActiveEventsPill.jsx:25-26`; `src/components/Footer.jsx:16-20`; `src/pages/public/CompetitionDetail.jsx:13-26` (and duplicated in `CompetitionsList.jsx:15-24`, `CompetitionRegister.jsx:15-22`, `CompetitionHub.jsx:21-28`, `ManagerHub.jsx:14-15`, `AdminCompetitions.jsx:24-25`, `ManagerCompetitionDetail.jsx:25-33`)
**Evidence:**
```js
// dateFormat.js — formats in the browser's TZ, no zone argument
return new Date(value).toLocaleDateString('en-AU', opts)
```
```js
// Footer.jsx:18 — parses a date-only string as LOCAL midnight (no Z)
new Date(`${event.start_date}T00:00:00`)
```
There are three date helpers but only `src/lib/eventTimezone.js`
(`formatInEventTz`, `parseFromEventTz`, `toInputValue`, `getTzAbbr`) is
timezone-aware. A grep shows it is imported essentially only by the admin event
editor (`src/pages/admin/AdminEvent.jsx:1025`). Almost all *display* of event and
competition dates goes through `dateFormat.js` or hand-rolled
`toLocaleDateString`/`toLocaleString`, i.e. the viewer's local zone.
**Impact:** For an AU/NZ audience spanning AEST/AWST/NZDT, an event date stored
against a specific event timezone can render as the wrong calendar day near
midnight (e.g. a Perth viewer sees a Sydney event a day off). Window-state logic
(open/close instant comparisons) is unaffected — only displayed dates.
**Recommendation:** Route event/competition date *display* through
`formatInEventTz(value, event.timezone)`; the timezone column already exists
(`20260522060000_event_timezone.sql`). Consolidate the six near-identical
competition date formatters into one shared helper while doing so.
**Verification needed:** Confirm each competition record carries a usable IANA
timezone (events do; competitions table not checked for a timezone column in this
pass).

---

### [Medium] Props copied into `useState` without a remount key — stale local state
**Location:** `src/pages/competition/CompetitionHub.jsx:169-170` (def) and `:1076` (call site)
**Evidence:**
```js
function CaptainTeamCard({ team, onChanged }) {
  const [name, setName]   = useState(team.name)
  const [colour, setColour] = useState(team.colour ?? TEAM_COLOURS[0])
  ...
  // dirty check compares local state against (possibly fresh) props:
  // CompetitionHub.jsx:178  name.trim() !== team.name || colour !== team.colour
}
// call site — no key, component stays mounted across reloads:
{team && isCaptain && <CaptainTeamCard team={team} onChanged={load} />}
```
After a save, `onChanged() → load()` refetches and re-renders `CaptainTeamCard`
with a new `team` prop, but `name`/`colour` are never re-synced (no `useEffect`
syncing them, confirmed by reading lines 168-216). There is no `key={team.id}` to
force a remount.
**Impact:** If the team row changes from elsewhere (or the refetch normalises a
value), the card shows stale text and computes a wrong "dirty" flag.
**Recommendation:** Add `key={team.id}` at the call site (cheapest fix) or sync the
two fields on `team` change.
**Verification needed:** None.

---

### [Low] Non-write Supabase loads ignore `error` — silent empty/stale states
**Location:** `src/pages/admin/AdminEvent.jsx:158` & `:505`; `AdminRequiredDocuments.jsx:82`; `AdminUnder18Approvals.jsx:52` & `:79`; `AdminZLTACHallOfFame.jsx:69`; `AdminZLTACResults.jsx:817,1078,1369,1384`; `AdminZltacDashboard.jsx:64`; `AdminRefereeTest.jsx:88`; `CaptainHub.jsx:201,315`; `PlayerDashboard.jsx:435-436,442`; `PlayerHub.jsx:805`; `RefereeTest.jsx:58`; `AdminVolunteers.jsx:559`
**Evidence:**
```js
const { data } = await supabase.from('zltac_events')...maybeSingle()
setEvent(data)   // a load error looks identical to "no event exists"
```
~20 read sites destructure only `data`. Most set state to `data ?? []`/`null`, so
a query failure renders as empty/absent data with no error surfaced. `AdminEvent.jsx:505`
is an inline "Create New Event" insert whose failure produces no message at all.
**Impact:** Failed loads present as empty dashboards/lists; the user cannot tell a
real "nothing here" from a broken query.
**Recommendation:** Adopt a consistent `{ data, error }` + error-state convention in
loaders; at minimum log+toast on `error` for admin screens.
**Verification needed:** None — each site read.

---

### [Low] Silently swallowed catches that can mask real failures
**Location:** `src/pages/public/CompetitionDetail.jsx:284`; `src/pages/admin/AdminAlsaDashboard.jsx:32`; (full inventory in Appendix A)
**Evidence:**
```js
// CompetitionDetail.jsx:284 — any failure is treated as "not registered"
.catch(() => { if (!cancelled) setRegState('not_registered') })
// AdminAlsaDashboard.jsx:32 — a members-fetch failure silently becomes an empty list
apiFetch('/api/admin/alsa?resource=members').catch(() => ({ active: [] }))
```
Of 103 catch sites, 24 swallow silently. Most are deliberate graceful degradation
on non-critical background widgets (pills, committee lists) and are acceptable.
The two above are the ones where swallowing changes a meaningful state: a real
error makes a registered user look not-registered, and an admin's member list
silently empties.
**Impact:** A backend hiccup can show a registered user the "register" CTA, or show
an admin an empty members panel as if there are none.
**Recommendation:** Distinguish "loaded, empty" from "failed to load" for these two;
show a retry/error affordance instead of a misleading success state.
**Verification needed:** None.

---

### [Low] Write-then-secondary-step handlers leave secondary state able to drift silently
**Location:** `api/captain.js:87-91` (add-player) & `:155-160` (disband); `api/player.js:566-571` (cancel); `src/pages/CaptainHub.jsx:391-395`; `src/pages/CaptainRegister.jsx:149-160`
**Evidence:**
```js
// api/captain.js — primary write done; mirror dual-write only logged, then success returned
} catch (err) {
  console.error('[api/captain add-player] dual-write threw:', err)
}
return res.json({ data })   // caller sees success even if team_members mirror failed
```
```js
// CaptainHub.jsx:391 — dual-write threw (logged), UI still removes the player
console.error('[CaptainHub confirmRemove] dual-write threw:', err)
...
setRoster(r => r.filter(...))   // unconditional
```
These are intentional "primary write is already durable, mirror is best-effort"
dual-writes (the brief specifically asked to flag write-then-refetch/secondary
patterns). They do not error the user, but the secondary table (`team_members`)
can diverge from the source of truth with only a console line as evidence.
**Impact:** Roster mirror rows can silently drift out of sync with registrations;
no user-visible failure and no durable audit beyond client/server console logs.
**Recommendation:** Either make the mirror write transactional with the primary
(single RPC), or record a reconciliation flag/row when the mirror fails so drift is
detectable. At minimum, route these console errors to the error tracker (Sentry is
installed).
**Verification needed:** Whether a periodic reconciliation already exists for
`team_members` (not found in this pass).

---

### [Low] Design tokens bypassed by raw colour values
**Location:** `src/index.css:4-13` (token definitions); raw usage pervasive — representative: `src/pages/EventPage.jsx:49,106,379,580,789,829,871`; `src/pages/CaptainHub.jsx:27,808`; `src/pages/admin/AdminRequiredDocuments.jsx:6,163,378`; `src/pages/admin/AdminRefereeTest.jsx:49`; `src/components/ProtectedRoute.jsx:8`
**Evidence:**
Tokens defined: `base #0F0F0F`, `surface #191919`, `line #2D2D2D`, `brand #00FF41`,
`text-secondary #A0A0A0`, etc. Yet across `src/` (962 hex occurrences in 64 files):

| Hex | Count | Verdict |
|-----|------:|---------|
| `#e5e5e5` | 824 | **Off-brand, no token** — used everywhere as `text-[#e5e5e5]/NN`. Not in the palette at all (palette text is `#FFFFFF`/`#A0A0A0`/`#666666`). |
| `#00FF41` | 39 | = `brand`. Legit as SVG fill/`accent-[...]`, but hardcoded brand fills exist (`CaptainHub.jsx:27`, `EventPage.jsx:49,106,831`). |
| `#374056` | 38 | Off-brand neutral, no token (`CompetitionDetail.jsx:40`, `Contact.jsx:215`). |
| `#191919` | 34 | = `surface` — hardcoded `bg-[#191919]` despite `bg-surface` token. |
| `#0F0F0F` | 18 | = `base` — gradient stops (legit) + solid uses that should be `bg-base` (`AdminRefereeTest.jsx:49`, `ProtectedRoute.jsx:8`). |
| `#2D2D2D` | 5 | = `line` — hardcoded despite `border-line`. |
| `#A0A0A0` | 3 | = `text-secondary` — hardcoded. |

Legitimate, data-driven colours (not violations): the team-colour palette
`src/lib/teamColours.js:8-17`, SVG brand strokes in `Home.jsx`/`icons.jsx`, and
medal/award/chart palettes in `zltac/*`.
**Impact:** The same colour is expressed two ways across the app; a token change
(e.g. dark-mode tuning, rebrand) won't propagate. `#e5e5e5` (824×) is an
undocumented text colour with no token at all.
**Recommendation:** Add a token for the `#e5e5e5` text ramp (or migrate it to
`text-text-secondary`/white), then sweep `bg-[#191919]`/`bg-[#0F0F0F]`/`#2D2D2D`/
hardcoded `#00FF41` to their existing tokens. Leave gradients and data-driven
colours as raw values.
**Verification needed:** None — counts from full grep across `src/`.

---

### [Low] Very large components (maintainability)
**Location:** `src/pages/PlayerHub.jsx` (2016), `api/superadmin/[resource].js` (1892), `src/pages/admin/AdminZLTACResults.jsx` (1613), `src/pages/admin/AdminEvent.jsx` (1196), `src/pages/competition/CompetitionHub.jsx` (1190), `src/pages/CaptainHub.jsx` (1085), `src/pages/admin/AdminVolunteers.jsx` (1084), `src/pages/admin/AdminRegistrations.jsx` (973), `src/pages/EventPage.jsx` (923), `api/admin/event.js` (923) — 37 files exceed 300 lines.
**Evidence:** `wc -l` over `src/` and `api/`; counts above are exact.
**Impact:** Hard to review/test; the largest carry most of the error-handling and
state-management findings in this report.
**Recommendation (concrete extraction points):**
- **PlayerHub.jsx (main render ~1300 lines):** extract `RequirementsChecklist`
  (the `ChecklistItem` stack ~1490-1617), `MyTeamCard` (1620-1683), and the three
  `CollapsibleSection` bodies `SideEventsSection`/`ExtrasSection`/
  `PaymentDetailsSection`; move `load()` + focus-refetch + hash-open effects into a
  `usePlayerHubData()` hook.
- **AdminEvent.jsx:** it already declares `TABS` (`:8`) but renders all five panels
  inline — split into `DetailsTab`/`SideEventsTab`/`PricingTab`/
  `RegistrationSettingsTab`/`HeroPhotosTab`, plus extract the Delete and Archive
  modals.
- **AdminZLTACResults.jsx:** already decomposed into tab functions; the win is
  splitting them into separate files (`results/LegendsSection.jsx`, etc.).
- **CaptainHub.jsx:** extract `TeamSettingsForm`, `RosterList`/`RosterRow`,
  `PlayerSearchPanel`, and the two confirm modals; add a `useCaptainHubData()` hook.
- **CompetitionHub.jsx:** leaf components exist; split the ~370-line page body into
  "Your Registration" and "Your Team" sections + `useCompetitionHubData()`.
**Verification needed:** None.

---

### [Low] No shared loading/error component; `Home.jsx` has neither
**Location:** repo-wide; `src/pages/Home.jsx:66-74`
**Evidence:** No `Spinner`/`Loading`/`ErrorState` component exists. The same spinner
markup `<div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />`
appears 49 times across 36 files. Error display is ad-hoc: sentinel values
(`CompetitionDetail.jsx:157` `roster === false`), silent empty fallback
(`About.jsx:72`, `ZLTACLanding.jsx:34`), or none. `Home.jsx` fetches the active
event with no `.catch`, no loading state, and no error state:
```js
// Home.jsx — no .catch, no error/loading surface
supabase.from('zltac_events').select(...).eq('status','open').limit(1).maybeSingle()
```
**Impact:** The loading *visual* is consistent only because it is copy-pasted;
error UX differs per page. On Home, a rejected event fetch can leave the hero in a
permanent loading sentinel.
**Recommendation:** Extract a `<Spinner>` and a `<LoadStateBoundary loading error>`
wrapper; adopt across pages. Give Home an error fallback.
**Verification needed:** None.

---

### [Low] Forms without a single source of truth
**Location:** `src/components/RegistrationEditModal.jsx:91-142`; `src/pages/CaptainHub.jsx:135-173`
**Evidence:** `RegistrationEditModal` declares ~30 independent `useState` fields
(`alias`, `stateVal`, `ecName`, `ecPhone`, `selectedSlugs`, `dinnerGuests`,
`status`, `doublesPartnerId`, `triplesP2/3`, four `ov*`/`ov*Reason` override pairs,
`adminNote`, `overrideErrors`…), all seeded from props and re-validated by hand in
`save()`. `CaptainHub` mixes a controlled `settingsForm` object with a DOM ref for
logo upload (`logoInputRef`, `:171`) and two ad-hoc confirm flows.
**Impact:** Seeding/sync fragility and parallel error bookkeeping; high cost to
change a field. (`AdminEvent.jsx` by contrast groups state into cohesive objects —
the right pattern.)
**Recommendation:** Move `RegistrationEditModal` to a single form object or
`useReducer` keyed by registration id; unify CaptainHub's controlled state and
file-input handling.
**Verification needed:** None — both forms read in full.

---

### [Low] Redundant data fetching (no shared cache)
**Location:** `src/hooks/useCurrentEvent.js:5-34`; `EventPage.jsx:514-519`; `PlayerHub.jsx:825,850`; `PlayerDashboard.jsx:435-438`; `AdminHubPill.jsx:54` + `AdminLayout.jsx:238`; `VolunteerSection.jsx:62`
**Evidence:** `useCurrentEvent` is a plain per-call `useState`/`useEffect` with no
shared cache, so every consumer issues the same `zltac_events…status='open'` query.
`NavBar` and `Footer` (always mounted) each run it, and `Home`/`PlayerHub`/
`PlayerDashboard`/`CaptainHub` additionally re-query the open event directly.
`AuthContext` already exposes the full `profile`/`isAdmin`, yet `EventPage` re-fetches
`roles`, and `PlayerHub`/`PlayerDashboard` re-fetch the whole `profiles` row.
`/api/superadmin/my-competitions` is fetched by `AdminHubPill` (in NavBar) and again
by `AdminLayout` on the destination page. `VolunteerSection` re-queries event
columns its PlayerHub parent already passed in.
**Impact:** Several duplicate round-trips per page load; more network and re-renders
than necessary. No correctness bug.
**Recommendation:** Back `useCurrentEvent` with a module-level cache/context so it
fetches once per session; consume `AuthContext.profile`/`isAdmin` instead of
re-fetching; pass event fields down to `VolunteerSection` rather than re-querying.
**Verification needed:** None.

---

### [Low] Dead exports
**Location:** `src/lib/pricing.js:4,6,38,40,42` (`MAIN_EVENT_FEE`, `SIDE_EVENTS`, `SIDE_PRICES`, `DINNER_GUEST_PRICE`, `calcTotal`); `src/lib/eventPhase.js:26` (`PHASE_LABEL`); `src/lib/teamColours.js:19` (`isValidTeamColour`)
**Evidence:** `pricing.js` is imported in 6 files but **only** for `dollars`
(verified: every `import` from `pricing` pulls `{ dollars }`). The fee constants and
`calcTotal` have zero external references — pricing moved to event-driven columns
(`main_fee`/`team_fee`/`dinner_guest_price`). `PHASE_LABEL` is never imported (only
`eventPhase` and `COMMITTEE_EMAIL` are). `isValidTeamColour` has zero external
references.
**Impact:** Misleading dead code; the stale `MAIN_EVENT_FEE = 0 // TBC` and
`DINNER_GUEST_PRICE = 6500` constants invite accidental reuse of hardcoded prices
that are now per-event.
**Recommendation:** Remove the unused exports (keep `dollars`).
**Verification needed:** None — usage counts run across `src/`.

---

### [Low] Brittle / latent React effects
**Location:** `src/components/competition/CompetitionEditForm.jsx:63-104`; `src/pages/admin/AdminVolunteers.jsx:907-910`
**Evidence:**
```js
// CompetitionEditForm — re-seeds from `initial` only via manual reset(), not on prop change
function reset() { setName(initial.name); ... }   // never called from an effect on `initial`
// call sites have no key={initial.id} (AdminCompetitions.jsx:107, ManagerCompetitionDetail.jsx:94)
```
```js
// AdminVolunteers.jsx — [] effect reads prop-derived activeRoles
useEffect(() => {
  const def = activeRoles.find(r => r.is_default)
  if (def) setSelectedRoleIds([def.id])
}, []) // eslint-disable-line
```
Neither is currently broken (each editor mounts fresh; the modal opens after roles
load), but both rely on mount timing rather than reacting to data.
**Impact:** If `initial`/`roles` ever change without a remount, the form keeps stale
values / skips the default pre-selection.
**Recommendation:** Add `key={initial.id}` to `CompetitionEditForm` call sites;
include `activeRoles` (or a guarded effect) in the AdminVolunteers default-selection.
**Verification needed:** None.

---

### [Low] Em-dashes in user-facing prose (house no-dash rule)
**Location:** representative: `src/pages/Home.jsx:59,148,297`; `src/pages/PlayerHub.jsx:161,260,311,1438,1955`; `src/pages/admin/AdminRefereeTest.jsx:53,111,115`; `src/pages/MemberRegister.jsx:27,82`; `src/pages/Contact.jsx:87`; `src/pages/ZLTACLanding.jsx:155`
**Evidence:** Em-dashes appear throughout user-facing prose, status labels, and
error/toast strings, e.g. `"Thanks — your message is on its way to the committee."`
(Contact.jsx:87), `"… is not yet available — contact the committee."`
(PlayerHub.jsx:161/260/311), and Home marketing copy. Per the recorded house rule,
this audit flags only **AI-sounding user-facing prose** — code comments, numeric
ranges (`"1–5"`, `About.jsx:25`), and the deliberate empty-value `"—"` glyph are
**exempt**.
**Specific check requested — RecordPaymentModal "Recorded by":** the label at
`src/components/RecordPaymentModal.jsx:433` is `Recorded by {resolveRecorder(rec.recorded_by)}`.
The label text contains **no dash**. The em-dash that can appear there is the
*fallback return value* of `resolveRecorder` (`:56-57`, `return '—'` when no
recorder is known) — i.e. it is the empty-value glyph, not a literal "Recorded by —"
placeholder. **Not a violation** under the no-dash rule.
**Impact:** Cosmetic / house-style; the dense prose hits (Home, PlayerHub checklist
labels) are the candidates if the rule is enforced on copy.
**Recommendation:** If enforcing, replace em-dashes in prose strings with commas/
periods/colons; leave the `"—"` empty-value glyph and numeric ranges alone.
**Verification needed:** None — all hits classified.

---

### [Low] No central snake_case ↔ camelCase mapping; API naming inconsistent
**Location:** repo-wide; `src/lib/recomputeOwing.js:9-13`; `src/components/RecordPaymentModal.jsx:84-95`
**Evidence:** No converter exists (search for `toCamel|toSnake|mapKeys|mapRow`
returns nothing; `apiFetch.js` does no key transformation). The consistent
convention is to read snake_case columns directly off Supabase rows
(`event.main_fee`, `registration.amount_owing`, `rec.recorded_at`). That part is
consistent. The inconsistency is at the API boundary: `/api/player` returns
`amountOwing` (camel, `recomputeOwing.js:9`) while the pre-nats payment endpoint
speaks `amount_dollars`/`recorded_at`/`bank_reference` (snake) and the other path
uses `amountCents`/`datePaid`/`bankReference` (camel) — both hand-built in the same
file (`RecordPaymentModal.jsx:84-95`).
**Impact:** Low; works today but the per-call manual field naming across API bodies
is a footgun for new endpoints.
**Recommendation:** Pick one casing for API JSON and document it; the DB-direct
snake_case read convention is fine to keep as-is.
**Verification needed:** None.

---

### [Info] Lint baseline confirmed — no regression; warnings assessment
**Location:** `eslint.config.js`; `npm run lint`
**Evidence:** `npm run lint` reports exactly **30 problems (23 errors, 7 warnings)**,
matching the expected baseline. Full itemisation in Appendix B. Breakdown:
`react-hooks/immutability` (15 errors, "cannot access variable before it is
declared" — load functions referenced by an effect above their declaration),
`react-hooks/rules-of-hooks` (4, all in `FormatEvolutionTimeline.jsx:70-128`),
`no-unused-vars` (3), `react-hooks/set-state-in-effect` (1,
`AdminRequiredDocuments.jsx:91`), and 7 `react-hooks/exhaustive-deps` warnings.
**Impact:** None new.
**Recommendation:** The 7 `exhaustive-deps` warnings are all on intentional
load-once effects (`// eslint-disable-line` in several). They are **not** worth
promoting to errors wholesale — doing so would force disables everywhere. The one
genuinely worth attention is `react-hooks/set-state-in-effect`
(`AdminRequiredDocuments.jsx:91`), already an error, and the
`rules-of-hooks` cluster in `FormatEvolutionTimeline.jsx` (hooks called
conditionally — a real correctness smell) which should be fixed rather than
suppressed. No warning should be promoted; instead fix the rules-of-hooks errors.
**Verification needed:** None.

---

### [Info] No `console.log`/`console.debug` in production paths
**Location:** repo-wide
**Evidence:** 35 `console.*` calls total, all `console.error` except one
`console.warn`. A targeted search for `console.log`/`console.debug` returned **zero**
matches in `src/` and `api/`.
**Impact:** None (positive).
**Recommendation:** Keep it this way. Note (cross-ref to error-handling findings):
several client-side `console.error` sites log without surfacing anything to the
user; with Sentry installed, route these to the tracker.
**Verification needed:** None.

---

### [Info] No `dangerouslySetInnerHTML`, `eval`, or `innerHTML` assignment
**Location:** repo-wide; `src/pages/CaptainHub.jsx:678-684`
**Evidence:** The only match for `dangerouslySetInnerHTML` is inside a **safety
comment** explaining why SVG logos are rendered via `<img src>` and never inlined.
No `eval`/`new Function`/`innerHTML =` anywhere.
**Impact:** None (positive — clean XSS surface).
**Recommendation:** None.
**Verification needed:** None.

---

### [Info] One TODO (within 30 days); no commented-out code blocks
**Location:** `src/pages/admin/AdminEvent.jsx:1073`
**Evidence:** The single TODO/FIXME in the codebase is the AdminEvent block
explaining deferred "Allow Side Events Only / Enable Waitlist" toggles, introduced
2026-05-20 (16 days before this audit — **not** older than 30 days). A scan for
runs of >5 consecutive comment lines returned only file-header doc comments and
JSDoc, plus this TODO — **no commented-out code blocks**.
**Impact:** None.
**Recommendation:** None.
**Verification needed:** None.

---

### [Info] No N+1 fetch patterns; clean memoisation
**Location:** repo-wide
**Evidence:** Lists render from already-fetched arrays; detail data is batched via
id-list endpoints (`CaptainHub.jsx:211-213` posts all `ids` to `/api/profiles`;
`CompetitionDetail.jsx` renders the whole roster from one `/api/public?resource=roster`
call). No row component issues its own fetch. Every `useMemo`/`useCallback` dep
array was read — no inline object/array/arrow literals in deps, no value recreated
every render; `AdminCompetitions.jsx:438` correctly stabilises a callback with
`useCallback`. No fetch calls in render bodies; no missing dependency arrays on
data-fetching effects.
**Impact:** None (positive).
**Recommendation:** None.
**Verification needed:** None.

---

### [Info] "State Associations" scrapped work — not found in repository
**Location:** n/a
**Evidence:** A repo-wide search (`*.md`, `*.sql`, `*.js`, `*.jsx`) for "state
association"/"state_assoc"/"stateassoc" returns matches **only in `AUDIT_BRIEF.md`
itself**. There is no State Associations migration, table, or feature code present.
The only "state column" removal is
`supabase/migrations/20260519010000_drop_unused_state_columns.sql`, which drops
podium-state columns (`champion_state`/`runner_up_state`/`third_place_state`) from
`zltac_event_history` — a different concern, and it is well-documented in its own
header as never-populated and removed alongside code references.
**Impact:** Cannot confirm the brief's "scrapped State Associations migration is
clearly marked as not-applied" — there is nothing to mark.
**Recommendation:** Clarify with the maintainer whether the State Associations work
was removed in an earlier cleanup (so it legitimately no longer exists) or lives on
a branch not in this tree. If the latter, it was not in scope for this pass.
**Verification needed:** **Yes** — confirm whether State Associations work ever
landed in `main`/history; this audit found no trace.

---

### [Info] Lint-flagged unused identifiers (already failing as errors)
**Location:** `api/admin/alsa.js:114` (`_user`); `api/player.js:62` (`addPartnerSideEventForTriples`); `src/pages/admin/AdminUnder18Approvals.jsx:375` (`showToast`)
**Evidence:** Three `no-unused-vars` errors in the lint baseline. `_user` matches the
ignore pattern intent but is `[a-z]` after the underscore so still flagged;
`addPartnerSideEventForTriples` is dead; `showToast` is destructured but unused.
**Impact:** Minor dead code; counted in the 23 lint errors.
**Recommendation:** Remove the three unused identifiers as part of clearing the lint
backlog.
**Verification needed:** None.

---

## Appendix A — Error-handling tabulation (3.2)

103 catch sites total (94 in `src/`, 9 in `api/`). Verified by reading.

| Classification | Count | Notes |
|---|---:|---|
| (a) Surfaced to user (`setError`/`showToast`/`setMsg`/HTTP 500 JSON) | 61 | Dominant healthy pattern; e.g. `CompetitionHub.jsx:95/191/204/368`, `AdminMembers.jsx:57/149/306`, `RecordPaymentModal.jsx:108/192/209`, api routes `contact.js:91`, `admin/alsa.js:144/204`. |
| (b) Logged only (`console.error`, no UI) | 13 | `EventPage.jsx:440,534`; `CaptainHub.jsx:391`; `CaptainRegister.jsx:158`; `PlayerRegister.jsx:157`; `AdminCompetitions.jsx:187,206`; `PlaceholderClaimPrompt.jsx:41`; `api/captain.js:88,156`; `api/player.js:567`; `PlayerHub.jsx:68`. |
| (c) Swallowed silently | 24 | Mostly intentional graceful degradation on pills/lists (`useCurrentEvent.js:22`, `About.jsx:72`, `ZLTACLanding.jsx:34`, `AdminLayout.jsx:240`, `AdminHubPill.jsx:56`, `MyEventsPill.jsx:70`, `PlayerDashboard.jsx:459`). Meaningful-state ones flagged above: `CompetitionDetail.jsx:284`, `AdminAlsaDashboard.jsx:32`. Empty no-ops: `AdminRequiredDocuments.jsx:496`, `generateBackupCsvs.js:150`. |
| (d) Re-thrown | 1 | Only `apiFetch.js:13` (`throw new Error(...)`) — the single shared throw point all callers rely on. No `catch(e){throw e}` rethrow blocks exist. |
| `.json().catch(()=>({}))` parse fallbacks (benign sub-class of c) | 6 | `Contact.jsx:33`, `PlayerHub.jsx:1009`, `MemberRegister.jsx:24`, `AdminVolunteers.jsx:62`, `apiFetch.js:12`. |

**Unhandled promise rejections:** `AdminUsers.jsx:84` and `PlayerHub.jsx:946-957`
(see first Medium finding).
**Supabase `{ data }` without `error` check:** ~20 sites enumerated in the Low
finding above (writes among them escalated to Medium).

## Appendix B — Lint baseline itemisation (3.1)

`npm run lint` → 30 problems (23 errors, 7 warnings).

Errors (23):
- `api/admin/alsa.js:114` no-unused-vars (`_user`)
- `api/player.js:62` no-unused-vars (`addPartnerSideEventForTriples`)
- `src/components/zltac/FormatEvolutionTimeline.jsx:70,71,72,128` rules-of-hooks (×4, hooks called conditionally)
- `src/pages/PlayerDashboard.jsx:430` immutability
- `src/pages/PlayerHub.jsx:771` immutability
- `src/pages/RefereeTest.jsx:35` immutability
- `src/pages/admin/AdminRequiredDocuments.jsx:91` set-state-in-effect; `:193` immutability
- `src/pages/admin/AdminUnder18Approvals.jsx:47,48` immutability; `:375` no-unused-vars (`showToast`)
- `src/pages/admin/AdminVolunteers.jsx:83,422,565,912` immutability (×4)
- `src/pages/admin/AdminZLTACHallOfFame.jsx:42` immutability
- `src/pages/admin/AdminZLTACResults.jsx:126,813,1074,1363` immutability (×4)

Warnings (7), all `react-hooks/exhaustive-deps`:
- `src/pages/PlayerHub.jsx:772` (`load`)
- `src/pages/admin/AdminEvent.jsx:154` (`loadCurrentEvent`)
- `src/pages/admin/AdminRegistrations.jsx:253` (`fetchAll`)
- `src/pages/admin/AdminRequiredDocuments.jsx:193` (`load`)
- `src/pages/admin/AdminUnder18Approvals.jsx:48` (`load`)
- `src/pages/admin/AdminVolunteers.jsx:565` (`loadSignups`), `:912` (`loadPlayers`)

---

## Coverage gaps

- **State Associations scrapped work:** could not be checked because **no such
  migration or code exists in this tree** (only `AUDIT_BRIEF.md` references the
  phrase). Whether it was removed earlier or lives on an unmerged branch is
  unconfirmed — needs maintainer input. The `drop_unused_state_columns` migration is
  a different (podium-state) change and is well-documented.
- **Competition timezone column:** the timezone finding assumes competitions carry a
  usable timezone like events do; the competitions table schema was not inspected in
  this code-quality pass (it is a Pass 2 / DB concern).
- **Runtime/render performance** (re-render counts, virtualisation thresholds,
  bundle splitting, query column selection) is **Pass 4** and was not measured here,
  beyond noting the redundant-fetch and large-component static observations.
- **Dead-export analysis** used grep heuristics over `src/`; it does not catch
  exports referenced only by dynamic strings or tests. The three confirmed dead
  exports were each grep-verified, but a tree-shaking/`knip`-style tool was not run
  (no such tool is in `package.json`, and the brief forbids adding dependencies).
- **`api/` internals** were reviewed only for the error-handling and dead-code
  questions relevant to Pass 3; full server-side code-quality (input validation
  structure, handler decomposition) overlaps Pass 1/4 and was not exhaustively
  graded here.
- **Error-handling classification** of the 61 "surfaced" catches was sampled and
  counted, not individually quoted — every (c) swallowed, (d) re-thrown, and
  unhandled-rejection site was read and is listed.
- **Accessibility of loading/error states** (focus management, screen-reader
  announcement) is **Pass 5** and out of scope here.
