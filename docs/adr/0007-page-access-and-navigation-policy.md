# ADR-0007: Page Access and Navigation Policy

**Status:** Draft — for committee review
**Date:** 2026-04-22
**Supersedes:** None
**Related:** [ADR-0002: RLS + GRANT Security Model](./0002-rls-plus-grant-security-model.md), [ADR-0003: Authentication and Password Policy](./0003-authentication-and-password-policy.md), [ADR-0006: Membership Model](./0006-membership-model.md)

---

## Context

The ALSA Portal has pages at different sensitivity levels:

- **Marketing and information pages** (home, about, events overview) that should be reachable by anyone
- **Member-facing pages** (dashboard, team hub, registration flow) that require a logged-in account
- **Committee admin pages** (registrations manager, user admin, event configuration) that require committee role
- **Specialised pages** (referee test, captain hub, policy acknowledgement flows) that are role- or state-dependent

Two distinct questions have to be answered for every page:

1. **Access:** can a given user reach this page at all? This is a security question. The answer is enforced by route guards and, underneath them, by the database ([ADR-0002](./0002-rls-plus-grant-security-model.md)).
2. **Navigation:** should a given user be *shown* a link to this page? This is a user-experience question. Hiding a link does not provide security; it provides clarity.

Conflating these two questions produces two common bugs:

- Showing a link that the user cannot actually use (bad UX, users feel locked out)
- Assuming that hiding a link is sufficient to prevent access (bad security, the page is still reachable by URL)

This ADR proposes a consistent policy for both.

## Current observed behaviour

At time of writing, the portal's routes behave as follows:

| Area | Current behaviour |
|---|---|
| Admin routes (`/admin/*`) | Correctly gated — non-committee users are redirected to the dashboard. Route guards wrap the admin section. |
| Player-facing routes (team hub, captain hub, player hub, event page) | Directly accessible by URL with good empty states. A user who is not a captain can reach the captain hub and sees a helpful "you are not a captain" state rather than a hard block. |
| Referee test (`/referee-test` or equivalent) | Directly accessible by URL. Any logged-in user can reach it and take the test, whether or not they have indicated they want to become a referee. |

The admin gating is working as intended. The player-facing approach of "directly accessible with empty state" is working as intended. The referee test is the one case where the current behaviour may not match the intent.

## Decision

### Three access tiers

Every page is assigned to one of three access tiers:

| Tier | Meaning | Enforcement |
|---|---|---|
| **Public** | Reachable by anyone, logged in or not. | No route guard. No database data returned that is not also public. |
| **Authenticated** | Reachable by any logged-in user. Content may be empty or degraded if the user does not have the relevant role or state, but the page itself renders. | Route guard redirects to `/login` if not authenticated. RLS ([ADR-0002](./0002-rls-plus-grant-security-model.md)) ensures no data is returned that the user should not see. |
| **Role-gated** | Reachable only by users holding a specific role (committee, potentially referee in future). Anyone else is redirected. | Route guard checks the role and redirects if absent. Database-level enforcement ([ADR-0002](./0002-rls-plus-grant-security-model.md), service-role API routes for privileged operations) prevents action even if the guard is bypassed. |

### Three navigation tiers

Separately from access, each page has a navigation visibility rule:

| Visibility | Meaning |
|---|---|
| **Always visible** | Link is always shown in the navigation. |
| **Role-visible** | Link appears only when the user has the relevant role. A non-committee user never sees a link to `/admin`. |
| **Intent-visible** | Link appears only when the user has indicated interest in that flow. A user who has not indicated they want to become a referee does not see a link to the referee test, even though the page itself is reachable. |

"Intent-visible" is distinct from "role-visible": role gates access; intent gates discovery. A user who intent-hides a page can still reach it by direct URL — this is deliberate, and it is how we keep the page count visible in navigation manageable without building artificial access rules.

### Progressive disclosure is the default for authenticated pages

For the **Authenticated** tier, the default approach is **progressive disclosure with good empty states** rather than hard blocking. Concretely:

- A user who is not a captain can visit the captain hub. They see a friendly empty state explaining that captains manage their team here, and what being a captain entails. They do not see another captain's data (RLS prevents this at the database level).
- A user who is not registered for an event can visit the event page. They see the event information and a call-to-action to register. They do not see anyone else's registration status (again, RLS).
- A user whose team has not been formed yet can visit the team page. They see the "you don't have a team yet" state.

This approach is preferred over hard blocking because:

- It reduces the number of "you don't have access" dead-ends in the UI
- It lets users *learn* about features before they have them ("ah, so if I became a captain I'd see this")
- It keeps the security boundary at the data layer, where it belongs, rather than scattering it across the UI
- It means a link shared between users (e.g., "check out the event page") always works, rather than behaving differently depending on who clicks it

### Role-gating is reserved for committee admin (and optionally referee)

Hard role-gating — redirecting the user away from the page — is used only where visiting the page is either:

1. **Not meaningful** for users without the role (the admin registrations page is not useful to a non-committee user)
2. **Potentially confusing or misleading** for users without the role

The committee admin section (`/admin/*`) meets both criteria and is fully role-gated. This is the existing behaviour and is retained.

The referee test is a proposed candidate for **intent-gating rather than role-gating**. Rather than hide the test from the navigation of users who are not referees, and rather than role-gate it behind a "you are a referee" flag, the proposed approach is:

- Add an **"I want to become a referee"** flow somewhere in the player dashboard — a short declaration of interest plus a link to the test.
- Users who have made that declaration see the referee test in their navigation.
- Users who have not made that declaration do not see the link but can still reach the test by URL if directed there.
- Passing the test sets a `is_referee` flag on the profile which unlocks referee-specific features and navigation elsewhere.

This design treats "becoming a referee" as an intent the user expresses, rather than a role the committee assigns. It reduces friction for self-motivated members and avoids a committee-bottleneck for onboarding officials.

### The policy as a table

The policy applied to current pages:

| Page | Access tier | Navigation visibility | Reasoning |
|---|---|---|---|
| Home / landing | Public | Always visible | Reachable by anyone. |
| About / contact | Public | Always visible | Reachable by anyone. |
| Events overview | Public | Always visible | Showcase of upcoming and historical events. |
| ZLTAC event page | Authenticated | Always visible (once logged in) | Registration requires an account. Empty state for non-registrants. |
| Dashboard | Authenticated | Always visible (once logged in) | Personal landing page. Content adapts to user state. |
| Profile / settings | Authenticated | Always visible (once logged in) | User's own data only; RLS enforces this. |
| Player hub | Authenticated | Always visible (once logged in) | Progressive disclosure based on user state. |
| Team hub | Authenticated | Always visible (once logged in) | Empty state for users without a team. |
| Captain hub | Authenticated | Always visible (once logged in) | Empty state for non-captains; captain features for captains. |
| Event registration flow | Authenticated | Linked from event page | Empty state / CTA if not yet registered. |
| Policy acknowledgement flow | Authenticated | Part of registration flow | Part of registration, not standalone navigation. |
| Referee test | Authenticated | Intent-visible | Reachable by URL; linked in navigation only after user expresses intent to become a referee. |
| Admin: registrations | Role-gated (committee) | Role-visible (committee) | Committee-only content; fully gated. |
| Admin: users | Role-gated (committee) | Role-visible (committee) | Committee-only content; fully gated. |
| Admin: events | Role-gated (committee) | Role-visible (committee) | Committee-only content; fully gated. |
| Admin: teams | Role-gated (committee) | Role-visible (committee) | Committee-only content; fully gated. |
| Login / signup | Public | Always visible (when logged out) | Authentication entry points. |

### What the policy does *not* rely on

Hiding a link is **not** a security measure. A user who knows the URL of an intent-hidden page (e.g., the referee test) can reach it. Security is enforced by:

- The route guard checking authentication and, where applicable, role
- The database ([ADR-0002](./0002-rls-plus-grant-security-model.md)) refusing any query that the user is not permitted to run
- Service-role API routes ([ADR-0002](./0002-rls-plus-grant-security-model.md), Layer 3) performing any privileged operation on the server side after an application-level authorisation check

Navigation visibility is about **clarity and discoverability**, not enforcement. Conflating the two is how access-control bugs get built.

## Consequences

### Positive

- **Consistent mental model.** Every page has a defined access tier and navigation rule. Adding a new page becomes a matter of picking from the small set of established patterns, not inventing a new one.
- **UX is humane.** Users who do not yet have a role can see what they are missing and how to get it, rather than hitting dead ends.
- **Security is at the data layer.** The policy explicitly keeps enforcement in the guard + database, not in the UI. This aligns with [ADR-0002](./0002-rls-plus-grant-security-model.md).
- **Intent-gated navigation scales well.** As the portal grows, new specialised pages (coaching pathway, photographer accreditation, volunteer coordinator hub) can use the same pattern without adding permanent navigation clutter.

### Negative

- **Intent-gating is less rigorous than role-gating.** A user who "shouldn't" see the referee test can still reach it if they find the URL. This is acceptable because nothing privileged happens there — taking the test is opt-in, passing is what unlocks referee features — but it is a design choice worth being deliberate about.
- **Empty states are work.** Every Authenticated page needs a thoughtful empty state for every user state. This is more design and frontend work than a hard "you can't access this" redirect.
- **Users may occasionally see features they cannot use.** A user visiting the captain hub while not being a captain sees the page but cannot act on it. This is intentional (learning-by-exposure), but some users will find it momentarily confusing. Empty state copy should be clear about what is happening and why.

### Neutral

- **The referee test is the only current page where the intent-gating proposal is non-trivial.** Everything else fits cleanly into Public, Authenticated, or Role-gated. The referee test is flagged explicitly because its current behaviour predates this policy and may need a small UX change.
- **Future specialised pages should use this taxonomy.** Coaching pathway, photographer accreditation, or similar will fit into the same three tiers without new invention.

## Alternatives considered

### Role-gate everything that is role-specific

**Rejected.** A strict "you can't see the captain hub unless you are a captain" policy is simpler to implement and easier to reason about. It is rejected because it produces a worse user experience — users cannot discover features they might want, shared links behave inconsistently depending on who clicks, and the portal feels more locked-down than it is. Progressive disclosure is more work but results in a more welcoming product.

### Navigation-only gating (hide links but do not guard routes)

**Rejected.** Relying on hidden links is not security. Any URL sharing, browser history recall, or curious user with dev tools defeats it. This option is mentioned only to make explicit that the policy rejects it.

### A single "authenticated or not" boundary

**Rejected.** Treating every logged-in user as equivalent ignores the committee / member distinction that the portal actually requires. Admin actions must be gated at the role level (and at the database level via service-role API routes per [ADR-0002](./0002-rls-plus-grant-security-model.md)), not just by authentication.

### Expose the referee test to everyone including logged-out users

**Rejected.** Taking the test writes a result record tied to a user ID. Anonymous test-taking would either require a separate flow for logged-out users (more code for little gain) or would leave orphan test results (data quality problem). The current "any logged-in user can take the test" boundary is sound; the open question is only about navigation visibility.

## References

- [ADR-0002: RLS + GRANT Security Model](./0002-rls-plus-grant-security-model.md) — the data-layer enforcement that backs the access tiers here
- [ADR-0003: Authentication and Password Policy](./0003-authentication-and-password-policy.md) — how "authenticated" is established
- [ADR-0006: Membership Model](./0006-membership-model.md) — how membership status interacts with authenticated access
- [Data Access Matrix](../security/data-access-matrix.md) — authoritative table-by-table permissions
