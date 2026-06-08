# Accessibility & UX correctness audit — 2026-06-08

Pass 5 of the ALSA Portal full-stack audit. Read-only. Findings only — no code was
modified for this report. Token values were read from `src/index.css`; markup
patterns were confirmed by reading the cited files. Contrast ratios are computed
estimates (sRGB relative luminance over the base `#0F0F0F`) and are triage-grade,
not lab-measured.

## Summary
- Critical: 0
- High: 5
- Medium: 5
- Low: 3
- Info: 3

There are no Critical findings — Pass 5 covers UX/a11y, where the realistic
ceiling is High. The dominant systemic issues are structural and pervasive: no
`<main>` landmark anywhere, no live-region announcement of errors/status, modals
that are not exposed as dialogs and trap no focus, form labels that are never
programmatically associated with their inputs, and a low-opacity grey text scale
that fails WCAG AA across hundreds of call sites. Empty states and destructive-
action confirmations are broadly handled well.

---

## Findings

### [High] No `<main>` landmark on any page
**Location:** entire `src/` (`<main>` = 0 occurrences; only `<header>` `src/components/NavBar.jsx:162` and `<footer>` `src/components/Footer.jsx:35`, plus `<nav>` in NavBar/AdminLayout/ManagerLayout)
**Evidence:**
```
grep '<main' src/ → 0 matches
```
**Impact:** No main-content landmark on any page; screen-reader users cannot "skip to main content" and the document exposes no programmatic main region.
**Recommendation:** (deferred — discovery pass, no fixes)
**Verification needed:** None — grep confirmed.

---

### [High] Validation errors and status messages are never announced to assistive tech
**Location:** entire `src/` (`role="alert"` / `aria-live` / `role="status"` = 0 occurrences); representative: `src/pages/Login.jsx:76-80`, `src/components/RecordPaymentModal.jsx:262-266`
**Evidence:**
```jsx
// Login.jsx:76-80
{error && (<p className="text-red-400 ...">{error}</p>)}
```
**Impact:** Errors and success banners render visually but are not in a live region, so screen-reader users get no notification when a submission fails or validation triggers.
**Recommendation:** (deferred)
**Verification needed:** None.

---

### [High] Modals are not exposed as dialogs and trap no focus
**Location:** all overlay components — `src/components/RecordPaymentModal.jsx:227`, `src/components/RegistrationEditModal.jsx:232`, `src/components/AddPlaceholderRegistrationModal.jsx:128`, `src/pages/admin/AdminMembers.jsx:65/157/511`, `src/pages/admin/AdminUsers.jsx:350`, `src/pages/admin/AdminVolunteers.jsx:770/974`, `src/pages/admin/AdminUnder18Approvals.jsx:431`, `src/pages/admin/AdminRequiredDocuments.jsx:610`, `src/pages/ZLTACYearDetail.jsx:32` (`role="dialog"` = 0 occurrences)
**Evidence:**
```jsx
<div className="fixed inset-0 ..." onClick={onClose}> ... </div>
```
No `role="dialog"`, no `aria-modal`, no `aria-labelledby`, no focus trap, and most have no Escape handler.
**Impact:** Focus stays behind the overlay, the dialog is not announced as such, and several modals cannot be dismissed from the keyboard.
**Recommendation:** (deferred)
**Verification needed:** Runtime focus behaviour not observed — assessed from source only.

---

### [High] Form labels are not programmatically associated with inputs
**Location:** pervasive — `htmlFor=` = 0 occurrences across `src/`, against 215 `<label>` elements in 27 files; representative: `src/pages/Login.jsx:49,61`, `src/components/RecordPaymentModal.jsx:275,285,295,305,318`, `src/pages/admin/AdminRefereeTest.jsx:316,344,351,359`
**Evidence:**
```jsx
<label className="block text-sm ...">Email</label>
<input ... />   // sibling, no id / no htmlFor, not wrapped by the label
```
**Impact:** Labels are visual-only; screen readers announce unlabelled fields and clicking a label does not focus its control.
**Recommendation:** (deferred)
**Verification needed:** None.

---

### [High] Pervasive low-contrast grey text fails WCAG AA on the dark base
**Location:** 594 occurrences of `text-[#e5e5e5]/{20,25,30,40,50}` across 45 files; heaviest in `src/pages/admin/AdminEvent.jsx` (~64), `src/pages/admin/AdminVolunteers.jsx` (~49); placeholders use the same scale (e.g. `placeholder-[#e5e5e5]/20` `src/components/RecordPaymentModal.jsx:281`)
**Evidence (computed over base `#0F0F0F`):**
```
/50 ≈ #7A7A7A ≈ 4.4:1  (borderline — fails 4.5:1 for normal text)
/40 ≈ #646464 ≈ 3.3:1  (fails normal text)
/30 ≈ #4E4E4E ≈ 2.3:1  (fails)
/25 ≈ #444444 ≈ 2.0:1  (fails)
/20 ≈ #3B3B3B ≈ 1.7:1  (fails badly)
```
AA thresholds: 4.5:1 normal text, 3:1 large text.
**Impact:** Labels, helper text, table cells, "—" fallbacks and input placeholders at /40 and below are below AA and are hard or impossible to read for low-vision users.
**Recommendation:** (deferred)
**Verification needed:** Ratios computed from token hex + Tailwind opacity over `#0F0F0F`; elements rendered over `bg-surface #191919` / `bg-line #2D2D2D` will differ and were not individually recomputed. No contrast tool was run.

---

### [Medium] Clickable table rows are not keyboard-operable
**Location:** `src/pages/admin/AdminVolunteers.jsx:732`
**Evidence:**
```jsx
<tr ... onClick={() => { setDetail(s); setDetailErr('') }} className="... cursor-pointer">
```
No `tabIndex`, no `role="button"`, no key handler. (Contrast `src/pages/admin/AdminUsers.jsx:99`, which uses a real `<button>View</button>`.)
**Impact:** The volunteer detail panel can only be opened with a mouse; keyboard/SR users cannot reach it.
**Recommendation:** (deferred)
**Verification needed:** Not every admin table was opened — other `<tr onClick>` instances may exist (AdminUsers and AdminRegistrations use proper buttons).

---

### [Medium] Users can be shown raw Supabase/Postgres error text
**Location:** many — `src/pages/Login.jsx:33`, `src/pages/PlayerHub.jsx:177,235,327`, `src/pages/admin/AdminMembers.jsx:58,150,307,340,350`, `src/pages/admin/AdminUsers.jsx:168,213,239`, `src/pages/admin/AdminVolunteers.jsx:92,562,577,947`, `src/pages/admin/AdminUnder18Approvals.jsx:72,285`, `src/components/RecordPaymentModal.jsx:109,193,210`
**Evidence:**
```jsx
setError(error.message)   // rendered directly into the UI as {error}
```
`src/pages/PlayerDashboard.jsx:127` maps codes 23514/23505 to friendly copy but still falls back to `error.message` for anything else.
**Impact:** Unmapped failures surface raw DB/driver text (constraint names, SQLSTATE) to end users. (Overlaps Pass 1/Pass 3 error-handling scope.)
**Recommendation:** (deferred)
**Verification needed:** None.

---

### [Medium] `role="menu"` is half-implemented (no keyboard menu semantics)
**Location:** `src/components/MyEventsPill.jsx:146,155,181,199,216`; `src/components/ActiveEventsPill.jsx:152,163`
**Evidence:**
```jsx
<div role="menu"> <Link role="menuitem"> ... </Link> </div>
```
The trigger has `aria-haspopup="menu"`/`aria-expanded` and Escape/outside-click close (good), but items are not roving-tabindex focusable and arrow-key navigation is not implemented.
**Impact:** The ARIA menu role promises arrow-key navigation that does not exist, misrepresenting the widget to screen-reader users.
**Recommendation:** (deferred)
**Verification needed:** Keyboard behaviour inferred from markup; not tested with a screen reader.

---

### [Medium] Suspend toggle is a styled switch with no switch semantics
**Location:** `src/pages/admin/AdminUsers.jsx:509-511`
**Evidence:**
```jsx
<button onClick={() => toggleSuspend(...)} className="w-10 h-5 rounded-full ...">
  <span ... />   {/* sliding knob */}
</button>
```
No `role="switch"`, no `aria-checked`, no accessible name.
**Impact:** Screen-reader users hear an unlabelled button with no on/off state for a security-relevant account-suspend control.
**Recommendation:** (deferred)
**Verification needed:** None.

---

### [Medium] Informational images rendered with `alt=""`
**Location:** `src/components/RulesTestRunner.jsx:356` (referee-test question image); `src/pages/EventPage.jsx:664` (lightbox image)
**Evidence:**
```jsx
// RulesTestRunner.jsx — question image shown directly above the question text
<img src={maskStorageUrl(currentQ.image_url)} alt="" ... />
```
**Impact:** A referee-test question image can carry the actual question content; `alt=""` hides it from screen-reader test-takers (verdict: defect — informational, not decorative). The EventPage lightbox `alt=""` enlarges an informational gallery image with no text alternative, though its thumbnail is alt'd (lower impact).
**Recommendation:** (deferred)
**Verification needed:** None.

---

### [Low] Weak or absent visible focus indicators
**Location:** pervasive — `outline-none` appears 127 times across 31 files; only one `focus-visible`/`focus:ring` in the codebase (`src/components/zltac/YearCard.jsx:1`). Inputs: shared `inputClass` patterns (e.g. `src/pages/Register.jsx:7`, ~30 inputs in `src/pages/admin/AdminEvent.jsx`)
**Evidence:**
```jsx
className="... focus:outline-none focus:border-brand ..."   // 1px border colour shift only
```
Buttons and `<Link>`s largely have no focus style at all.
**Impact:** Keyboard focus is hard to see on inputs (single-pixel border change) and effectively invisible on most buttons/links, because the native outline is suppressed app-wide without a consistent replacement ring.
**Recommendation:** (deferred)
**Verification needed:** None.

---

### [Low] Glyph close buttons with no accessible name
**Location:** `src/components/RecordPaymentModal.jsx:238` (`×`), `src/pages/admin/AdminVolunteers.jsx:774` (`✕`); contrast `src/pages/EventPage.jsx:671`, which correctly adds `aria-label="Close"`
**Evidence:**
```jsx
<button onClick={onClose} className="...">×</button>
```
**Impact:** Screen-reader users hear "times" or nothing meaningful instead of "Close" on several modal close buttons. Inconsistent — some have `aria-label`, most do not.
**Recommendation:** (deferred)
**Verification needed:** None.

---

### [Low] Modal backdrop close is a `<div onClick>` (not keyboard dismissible)
**Location:** every modal backdrop — e.g. `src/components/AddPlaceholderRegistrationModal.jsx:128`, `src/pages/admin/AdminMembers.jsx:65`, `src/pages/ZLTACYearDetail.jsx:32`
**Evidence:**
```jsx
<div className="fixed inset-0 ..." onClick={onClose}>
```
**Impact:** Backdrop dismissal is mouse-only; combined with the missing Escape handler on most modals (see High above), several modals have no keyboard dismissal path at all.
**Recommendation:** (deferred)
**Verification needed:** None.

---

### [Info] Empty states are broadly present and good
**Location:** `src/components/RecordPaymentModal.jsx:380` ("No payments recorded yet."); `src/pages/admin/AdminRegistrations.jsx:896,929`; `src/pages/admin/AdminUsers.jsx:524,543`; `src/pages/admin/AdminVolunteers.jsx:457`; `src/pages/EventPage.jsx:197` ("No teams registered yet"); `src/pages/public/CompetitionsList.jsx:127,160`
**Impact:** None — the brief's empty-states criterion (no registrations / no payments / no events) is satisfied.

---

### [Info] Destructive actions generally have confirmation; most are reversible by design
**Location:** `src/components/RecordPaymentModal.jsx:450-468` (inline delete confirm), `:131-150` (multi-step refund confirm); `src/pages/admin/AdminUsers.jsx:129,577-588` (delete-user confirm); `src/pages/admin/AdminEvent.jsx:464` (event delete gated on typing the year); `src/pages/admin/AdminRequiredDocuments.jsx:191`; `src/pages/CaptainHub.jsx:389`. Two bare native prompts: `src/pages/admin/AdminMembers.jsx:345`, `src/pages/admin/AdminRefereeTest.jsx:153` (`window.confirm`).
**Impact:** None blocking — the destructive-action criterion is mostly satisfied; the two `window.confirm` cases are functional but inconsistent with the app's custom confirm UI.

---

### [Info] Decorative icons not consistently `aria-hidden`
**Location:** lucide imports in ~15 files (e.g. `src/components/AdminLayout.jsx`, `src/components/RulesTestRunner.jsx`); inline chevron SVGs e.g. `src/components/MyEventsPill.jsx:125`; NavBar hamburger `src/components/NavBar.jsx:243`
**Impact:** Most decorative icons sit beside a text label, so impact is low, but they are not marked `aria-hidden`, adding minor screen-reader noise. (The NavBar hamburger correctly carries `aria-label="Toggle menu"`.)

---

## Not applicable / non-issues on this stack
- **Native `<dialog>` focus behaviour** does not apply: there is no `<dialog>` usage; all modals are hand-rolled `fixed inset-0` divs, so the relevant defect is the missing ARIA dialog pattern (filed High), not native-dialog handling.
- **`alt=""` on decorative brand logos is correct** and is not flagged: `src/pages/Welcome.jsx:94` (event logo beside a heading) and the brand marks carrying `alt="ALSA"`/`alt="ZLTAC"` (`Home`, `About`, `Footer`, `NavBar`, `ProtectedRoute`).
- **Avatar / team-logo images mostly carry meaningful alt** (member name / team name), e.g. `src/pages/CaptainHub.jsx:726,920`, `src/pages/About.jsx:242`, `src/pages/ZLTACLanding.jsx:169` — correct, not defects.

---

## Coverage gaps
- **Runtime focus behaviour:** could not confirm whether any modal moves focus on open, restores it on close, or traps it — assessed from source only (no trap code found).
- **Actual rendered contrast:** ratios computed from token hex + Tailwind opacity over `#0F0F0F`; elements over `bg-surface #191919` / `bg-line #2D2D2D` were not individually recomputed; no luminance/contrast tool was run.
- **Screen-reader testing:** no NVDA/VoiceOver pass — announcements, reading order, and the `role="menu"` keyboard behaviour are inferred from markup.
- **Heading order:** `<h1>/<h2>/<h3>` presence confirmed; not every page audited for skipped levels (spot-checked Login, RecordPaymentModal, AdminRefereeTest, RulesTestRunner).
- **Exhaustiveness:** `onClick`-on-non-button results were capped at 120 rows; `<img>`/`alt` swept broadly but representative files (not all 60+) were read. The `<tr onClick>` enumeration found AdminVolunteers; not every admin table was opened to rule out others.
- **Colour-only state encoding** (e.g. balance shown only via red/green at `src/components/RecordPaymentModal.jsx:255`) was noted but not fully swept as a separate criterion.
