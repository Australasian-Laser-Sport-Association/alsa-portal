# ADR-0003: Authentication and Password Policy

**Status:** Accepted
**Date:** 2026-04-22
**Deciders:** ALSA Technical Sub-Committee
**Supersedes:** None
**Related:** [ADR-0002: RLS + GRANT Security Model](./0002-rls-plus-grant-security-model.md)

---

## Context

The ALSA Portal requires user authentication for members to register for events, sign policy acknowledgements, and access role-specific features (captain hub, referee test, committee admin). The authentication system must:

1. Protect access to personal data, including data about minors
2. Protect the integrity of the legal audit trail (signed policies, media releases, guardian forms)
3. Be operable by a volunteer committee without specialist security expertise
4. Align with contemporary authentication best practice, not historical defaults

Supabase Auth provides the authentication primitives. Many of its default settings are conservative for a generic project but too weak for an organisation handling personal data for minors. This ADR documents which defaults we have changed and why.

## Decision

### Authentication method: email + password, with email confirmation

Users sign up with an email address and password. New accounts cannot sign in until the email address has been confirmed via a one-time link sent to that address.

We chose email + password over OAuth (Google, Discord, Apple, etc.) for launch because:
- It does not require members to have an account with a third-party provider
- It does not require the committee to register and maintain OAuth applications with external vendors
- It gives us control over the account lifecycle without external dependencies
- It is universally understood by members of all ages and technical backgrounds

Social login can be added later as an additional option without disrupting existing accounts.

Email confirmation is required because:
- It prevents account creation with typo'd email addresses (which would otherwise create orphan accounts that cannot recover their password)
- It is a baseline anti-spam measure
- It verifies that the person signing up actually controls the email address they entered — important when that email address will be used for legal document delivery

### Password policy

| Setting | Value | Rationale |
|---|---|---|
| Minimum password length | 10 characters | Above the OWASP floor of 8; resistant to modern offline brute-force on common hash algorithms. |
| Password requirements | Lowercase, uppercase letters, and digits | Blocks trivial passwords without forcing symbol substitutions, which research shows do not meaningfully improve entropy. |
| Symbols required | No | NIST SP 800-63B guidance: length adds more entropy than symbol complexity. Symbol requirements produce predictable substitutions (`a → @`, `o → 0`) and user frustration. |
| Prevent use of leaked passwords | Off (requires Pro plan) | Tracked as a future upgrade — the Have I Been Pwned integration is the single highest-value auth hardening toggle available and should be enabled when the portal moves to the Pro plan. |

Our policy favours **length over complexity**, consistent with modern guidance (NIST SP 800-63B, 2020+). A 10-character mixed-case-with-digits password provides approximately 60 bits of entropy, which is adequate for an application of this sensitivity given the other controls in place (rate limiting, email confirmation, secure password change).

### Password change protections

Both of the following are enabled:

| Setting | Value | Rationale |
|---|---|---|
| Secure password change | On | User must have an active session created within the last 24 hours to change their password. Defends against an attacker walking up to an unattended browser with a long-lived session. |
| Require current password when updating | On | Password changes require supplying the current password. Paired with the above, provides defence in depth against session hijack → password change → account takeover. |

Both controls are enabled together deliberately. Each alone has a plausible bypass; together they require an attacker to possess both an active session *and* the current password, which is a substantially higher bar than either alone.

### Email change protection

| Setting | Value | Rationale |
|---|---|---|
| Secure email change | On | Changing the email on an account requires confirmation from *both* the old and new addresses. Prevents an attacker from silently redirecting password resets to an address they control. |

### Session and token settings

| Setting | Value | Rationale |
|---|---|---|
| Email OTP / magic link expiration | 3600 seconds (1 hour) | Long enough to accommodate email delivery delays and users checking mail on another device; short enough that stale links are not a long-lived security liability. |
| Email OTP length | 8 digits | 100 million combinations. Sufficient given rate limiting on OTP attempts. |

### Signup controls

| Setting | Value | Rationale |
|---|---|---|
| Allow new users to sign up | On | Public registration is required for members to self-serve. |
| Allow manual linking | Off | Manual account linking is an administrative operation and should not be exposed to general users. |
| Allow anonymous sign-ins | Off | Anonymous/guest accounts are not a feature of the portal and would complicate the user model. |

### Providers disabled at launch

All OAuth providers (Google, Apple, Discord, GitHub, Facebook, etc.), SAML 2.0, phone auth, and Web3 wallet auth are **disabled**. If social login is added in the future, it will be the subject of its own ADR so the tradeoff (convenience vs. external dependency + additional privacy implications) can be documented.

## Consequences

### Positive

- **Defensible to a security-conscious committee member.** Every setting that differs from the Supabase default has a documented rationale in this ADR.
- **Aligned with 2025–2026 best practice.** Length-over-complexity, layered password change protections, and email confirmation are all current recommendations rather than legacy conventions.
- **Defence in depth.** Account takeover requires an attacker to overcome multiple independent controls: email verification at signup, active session + current password for changes, two-address confirmation for email changes.
- **No third-party dependencies for authentication.** The portal can operate without relying on Google, Apple, or any other auth provider being available.

### Negative

- **Stricter password requirements create minor friction.** A 10-character password with mixed case and digits is harder to type on mobile than a 6-character lowercase password. We believe the security tradeoff is worth the friction for an application handling this kind of data.
- **Email confirmation adds a step to signup.** Members must check their email before they can log in. Mitigated by clear UI messaging and the 1-hour confirmation window.
- **Leaked-password detection is not active.** A member who reuses a password that has been exposed in a third-party breach can still use it. This gap is accepted for the free tier and should be closed when the portal upgrades to Pro.
- **Default Supabase email sender is rate-limited and unbranded.** Emails come from `noreply@mail.supabase.io` at 4/hour. This is tolerable for initial rollout but should be replaced with a dedicated SMTP provider (Resend, Postmark, or AWS SES) before broad launch. Tracked as an operational task.

### Neutral

- **Password policy can be tightened later without migration.** Increasing the minimum length from 10 to 12, or adding symbol requirements, only affects *new* passwords. Existing accounts are not forced to reset.
- **OAuth can be added without breaking existing accounts.** Supabase supports linking an OAuth identity to an existing email+password account, so adding Google login later is additive, not a migration.

## Alternatives considered

### OAuth-only authentication (no password)

**Rejected.** Would force every member to have a Google, Apple, or similar account. Not appropriate for an organisation that includes members across a wide age range and technical comfort level.

### Magic-link-only authentication (no password)

**Considered, rejected for launch.** Magic-link-only (passwordless) auth has real security and usability advantages — no password to leak or forget, no password policy to maintain. However, it means every login requires an email round trip, which is poor UX for frequent users (captains checking their team, referees during tournaments), and it makes the portal unusable if email delivery is disrupted. Worth reconsidering as an option alongside password auth in the future.

### Weaker password policy (Supabase defaults)

**Rejected.** The defaults (6 characters, no complexity requirements, no secure password change) were designed for a generic project and are not appropriate for an application handling personal data for minors and financial records.

### Stricter password policy (14+ characters, symbols required)

**Rejected for launch.** The additional entropy from 14 characters over 10 is meaningful, but the UX cost — particularly on mobile, and particularly for users who are not frequent web-app users — is real. A 10-character policy with layered defences is a better balance for this audience. Can be tightened in a future ADR if circumstances change.

## References

- [NIST SP 800-63B — Digital Identity Guidelines, Authentication and Lifecycle Management](https://pages.nist.gov/800-63-3/sp800-63b.html)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [Supabase Auth documentation](https://supabase.com/docs/guides/auth)
- [ADR-0002: RLS + GRANT Security Model](./0002-rls-plus-grant-security-model.md) — the access control layer that applies once a user is authenticated
