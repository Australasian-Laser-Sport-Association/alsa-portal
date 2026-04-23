# ADR-0006: Membership Model

**Status:** Draft — for committee review
**Date:** 2026-04-22
**Supersedes:** None
**Related:** [ADR-0002: RLS + GRANT Security Model](./0002-rls-plus-grant-security-model.md), [ADR-0003: Authentication and Password Policy](./0003-authentication-and-password-policy.md), [ADR-0007: Page Access and Navigation Policy](./0007-page-access-and-navigation-policy.md)

---

## Context

ALSA is an incorporated association registered in Victoria, governed by the **Associations Incorporation Reform Act 2012 (Vic)**. Under that Act and the model rules, an incorporated association must:

- Maintain a **register of members** with each member's name and the date they became a member (s. 57)
- Distinguish members from non-members for the purposes of voting, standing for committee, and receiving notice of general meetings
- Keep the register reasonably current and make it available for inspection under the conditions specified in the Act

The ALSA Portal is the natural home for this register. It is where people create accounts, sign policy acknowledgements, register for events, and interact with the association. The question is: **what is the relationship between "has an account on the portal" and "is a member of ALSA"?**

Three practical realities shape the answer:

1. **Most people who sign up are members, in spirit.** They are laser tag players who want to participate in ALSA-run events. Treating them as "outsiders until they pay a fee" is at odds with how the community actually operates and with ALSA's open, welcoming ethos.

2. **Associations law requires that formal members be identifiable.** Voting rights, eligibility to serve on the committee, and quorum calculations at general meetings all depend on knowing who is a formally-enrolled member at a given moment.

3. **A paid membership tier may be introduced in future.** Paid membership — unlocking benefits such as event discounts, merchandise access, or voting rights — is a plausible future direction for the association. The data model should not preclude this, but this document does not propose or assume that it will happen.

We also want the model to be **readable to non-technical committee members**. A committee member reviewing the portal should be able to answer the question *"who is a member of ALSA and what does that mean?"* without reading application code.

## Decision

**Every account on the ALSA Portal is a member.** Membership is not a separate concept layered on top of accounts — signing up *is* joining. What differs between members is their **status**, which is tracked explicitly on the profile and can be used to gate specific benefits and obligations.

### The three statuses

| Status | Meaning | How you get it | What it grants |
|---|---|---|---|
| **Free Tier** | Default state on signup. The person has created an account and is part of the community, but has not paid for formal membership of the incorporated association. | Automatic on account creation. | Portal access, event registration, community participation. Not counted in formal membership for the purposes of the Associations Incorporation Reform Act 2012. |
| **Official Paid Member** | The person has paid the membership fee for the current membership year and is formally enrolled in the incorporated association. | Payment of the annual fee (when a paid tier is introduced; until then, no-one holds this status). | Everything Free Tier has, plus formal membership rights: voting at general meetings, eligibility to stand for committee, counted in the statutory register of members. |
| **Lapsed** | The person previously held Official Paid Member status but did not renew. | Automatic status change after the membership year ends without renewal (manually triggered for now; see below). | Same portal access as Free Tier. Does not have formal membership rights. |

### Why "everyone is a member"

The proposed approach — treating every account as a member, with status distinguishing the formal-vs-informal relationship — reflects the following reasoning:

- **It matches reality.** Someone who creates an account to register for ZLTAC is participating in ALSA, whether or not they have paid a fee. Labelling them as "not a member" creates a two-class system inside the portal that may not match how the association operates in practice.
- **It simplifies the data model.** There is no separate "memberships" table with a foreign key to "users." Status is a column on the profile. Querying "who is a Paid Member right now?" is a single `WHERE` clause.
- **It supports future growth without restructuring.** If paid membership is introduced, it becomes a status change on existing profiles rather than a new record type. If benefits are layered on (discounts, merchandise), they key off the status.
- **It keeps the statutory register computable.** The Act requires a register of members. We implement this as a view or query: `SELECT ... FROM profiles WHERE membership_status = 'paid'`. The register is always current with the source data, by construction.

### The membership year

The membership year runs **from ZLTAC to ZLTAC** — that is, from one year's Australasian Laser Tag Championships to the next. This is unconventional for an incorporated association (most run calendar or financial years) but it is proposed for ALSA because:

- ZLTAC is the single annual event that anchors the association's calendar.
- Almost all members join or renew in the weeks around ZLTAC.
- A membership year that ends at the close of ZLTAC makes "did you renew this year?" a clean question with a natural deadline.

The membership year is stored as an expiry date per profile (`membership_expires_at`), rather than as a shared global "current year." This means a member who joins mid-year has an individual expiry, which simplifies the edge cases (late joiners, proration, replacements).

### Lapse behaviour (current)

Lapse is **manually triggered for now**. When a membership year closes, the treasurer (or a delegated committee member) reviews the member list and changes the status of non-renewing Paid Members to Lapsed. Free Tier accounts are not affected.

This is deliberately simple for initial rollout. It reflects the current scale (membership is tracked by hand anyway) and avoids the risk of automated logic silently flipping statuses in ways that would need to be undone.

**Future work:** once paid membership is actually in operation and the process has been run manually for at least one cycle, the lapse flip can be automated — either as a scheduled job that runs after the ZLTAC end date, or as a computed value derived from `membership_expires_at` at read time. This is a later decision that will merit its own note but does not need its own ADR.

### Lifetime members

Lifetime membership — a status that does not lapse, typically granted by committee resolution — is **not defined in this ADR**. It is flagged here as a plausible future category. If introduced, it should be the subject of a committee resolution recorded in minutes, and reflected in the portal as an additional status value or a flag on the profile. No lifetime members exist at the time of writing.

### Directory visibility

Separate from membership status, each profile has a **directory visibility** setting. This controls whether the profile appears in the member-visible directory (e.g., "find your captain," "who's going to ZLTAC"). The default is off; members opt in. Directory visibility is independent of membership status — a Free Tier member can choose to be visible, and a Paid Member can choose to be hidden.

This exists because the statutory register of members (accessible on conditions defined by the Act) is a different thing from a social directory for community use. Keeping them separate avoids conflating a legal obligation with a convenience feature.

## Schema changes

The following columns are added to the `profiles` table:

| Column | Type | Default | Notes |
|---|---|---|---|
| `membership_status` | `text` (constrained by check to `'free'`, `'paid'`, `'lapsed'`) | `'free'` | Current membership status. |
| `membership_expires_at` | `timestamptz` | `NULL` | For Paid Members, the end of their paid year (i.e., the next ZLTAC end date). `NULL` for Free Tier and Lapsed. |
| `directory_visible` | `boolean` | `false` | Whether the profile appears in the member-visible directory. |

A future migration may add:

- `lifetime_member` (`boolean`) when lifetime membership is formalised
- `membership_joined_at` (`timestamptz`) if the statutory register requires an original-join-date distinct from the current expiry cycle

Row-level security follows the pattern established in [ADR-0002](./0002-rls-plus-grant-security-model.md):

- Members can read their own `membership_status` and `membership_expires_at`
- Other members can see another profile's `membership_status` and `directory_visible` only when `directory_visible = true`
- The committee can read and update all three fields via service-role API routes (not direct RLS write access)

## Consequences

### Positive

- **Clear, readable model for committee members.** The answer to *"is this person a member?"* is *"yes — check their status for what kind"*. This avoids a confusing two-tier "users vs members" distinction.
- **Statutory register is derivable from the data.** The formal register of members under the Act is a view over profiles with `membership_status = 'paid'`. Always current, always auditable.
- **Paid membership can be introduced without restructuring.** If a paid tier is introduced, no tables are added and no accounts migrate. Existing members change status; new members choose at signup.
- **Directory visibility is decoupled from membership.** Privacy-conscious members can participate without appearing in lists. The legal register is separate from the social directory.
- **Scale-appropriate operational model.** Manual lapse handling is realistic at current scale. Automation is available when the volume justifies it.

### Negative

- **"Member" is overloaded.** The word means both "has an account" and "is enrolled under the Act." This is intentional but requires that committee communications distinguish *Paid Member* from *member of the community* when it matters. Documentation and UI copy should be careful.
- **Manual lapse process has a correctness risk.** If the treasurer forgets to flip statuses after ZLTAC, the register is wrong. Mitigated by making the process an explicit post-event task and by eventually automating it.
- **Paid membership is not yet operational.** Until it is introduced, no-one holds Paid Member status, which means the statutory register is technically empty. This is not unusual for an incorporated association in a dormant year, but it should be acknowledged as a known state rather than a bug.

### Neutral

- **ZLTAC-to-ZLTAC membership year is unconventional.** It will surprise auditors or external reviewers expecting a calendar or financial year. The justification belongs in the association's rules or in a note attached to the register, so the oddity is documented outside the code.
- **Lifetime membership is deferred.** No decisions are blocked; it can be added cleanly if and when it is formalised.

## Alternatives considered

### Option A — Unified model: all accounts are members, no status distinction

**Rejected.** The simplest possible model: account creation is membership, full stop. Rejected because it does not support the statutory distinction between formal members (who vote, who count toward quorum, who are entitled to notice) and the broader community of account holders. It also forecloses the introduction of a paid tier.

### Option B — Free tier + Paid tier: two strict classes, cleanly separated

**Rejected.** Under this model, Free Tier and Paid Member are two distinct user categories, potentially with separate tables or a hard boolean. Rejected because:

- It creates a cultural two-class system at odds with how the community operates
- Lapse is messier — a former Paid Member is neither "Free Tier" nor "Paid," and either category is slightly wrong
- The schema is more rigid: moving between tiers or introducing new categories (Lifetime, Honorary, Junior) requires more restructuring

### Option C — Status-based hybrid: everyone is a member, status tracks their relationship to the association

**Chosen.** Described above. Combines the welcoming, unified framing of Option A with the legal precision of Option B. Supports future expansion (lifetime, honorary, junior categories can be added as additional status values) without structural change.

## References

- Associations Incorporation Reform Act 2012 (Vic) — [legislation.vic.gov.au](https://www.legislation.vic.gov.au/in-force/acts/associations-incorporation-reform-act-2012)
- Model rules for an incorporated association (Vic) — [Consumer Affairs Victoria](https://www.consumer.vic.gov.au/clubs-and-fundraising/incorporated-associations)
- [ADR-0002: RLS + GRANT Security Model](./0002-rls-plus-grant-security-model.md) — the access model that enforces membership-based row access
- [ADR-0003: Authentication and Password Policy](./0003-authentication-and-password-policy.md) — account creation and authentication
- [ADR-0007: Page Access and Navigation Policy](./0007-page-access-and-navigation-policy.md) — how membership status interacts with page-level access
- [Data Access Matrix](../security/data-access-matrix.md) — table-by-table permissions including profile columns
