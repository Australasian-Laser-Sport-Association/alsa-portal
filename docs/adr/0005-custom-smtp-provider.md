# ADR-0005: Custom SMTP Provider (Resend)

## Status

Accepted — 2026-04-26.

## Context

Supabase Auth's default email sender (`noreply@mail.supabase.io`) has three limitations that block production launch:

1. **Hard rate limit of 4 emails/hour** on the shared sender address. Adequate for development, would break under any real signup load.
2. **Unbranded sender address.** Members receiving auth emails from `mail.supabase.io` is unprofessional and reduces trust.
3. **Deliverability.** Shared sender domains have variable reputation across mail providers; some recipients see auth emails go to spam.

The portal also needs a contact-form endpoint (`/api/contact`) that delivers messages to the committee inbox. That requires a transactional email provider regardless of how Supabase auth emails are sent.

The two needs (auth email + contact form) can be served by the same provider with separate API keys, which simplifies operational footprint.

## Decision

Use **Resend** as the transactional email provider for both Supabase auth emails and the `/api/contact` endpoint, with the `lasersport.org.au` domain verified for sending.

### Provider choice: Resend

Considered providers: Resend, Postmark, AWS SES, SendGrid, Mailgun.

Resend chosen for:

- **Free tier** of 3,000 emails/month and 100/day, which covers expected portal volume by an order of magnitude
- **Modern developer experience** — straightforward API, good logs and observability dashboard, clear domain-verification flow
- **Reasonable upgrade path** if volume ever exceeds the free tier
- **Australian deliverability** has been adequate in testing — no special routing required

### Domain configuration

`lasersport.org.au` verified in Resend with three DNS records:

- **SPF** — authorises Resend's sending IPs to send on behalf of the domain
- **DKIM** — cryptographically signs outbound mail, allowing recipients to verify authenticity
- **DMARC** — tells recipient mail servers what to do with mail that fails SPF or DKIM checks

All three are required for production-grade deliverability and to avoid being flagged as spam by major mail providers (Gmail, Outlook, iCloud).

### Two-key separation

Two separate Resend API keys are provisioned, both with "Sending access" permission only:

| Key name | Used by | Stored in |
|---|---|---|
| `Supabase SMTP` | Supabase Auth (password reset, email confirmation, magic links) | Supabase dashboard → Project Settings → Auth → SMTP |
| `Vercel Contact Form` | `/api/contact` Vercel API route | Vercel env var `RESEND_API_KEY`, scoped to Production + Preview + Development |

The keys are separated to:

1. **Limit blast radius of compromise** — rotating one key does not affect the other system
2. **Aid audit** — Resend's logs label sends by API key, making it easy to distinguish auth emails from contact-form messages
3. **Decouple lifecycles** — if either provider is changed in the future, only one key needs to move

### Supabase Auth rate-limit tuning

With custom SMTP in place, the per-project rate limits in Supabase Auth (Authentication → Rate Limits) are tuned for expected portal traffic:

| Limit | Value | Rationale |
|---|---|---|
| Sending emails | 50/hour | Raised from the default 30/hour. Resend has its own 100/day cap on the free tier; this Supabase-side limit is the upstream throttle before requests hit Resend at all. |
| Token refreshes | 150 per 5 min | Default. Adequate for normal session-refresh patterns. |
| Token verifications | 30 per 5 min | Default. Defends against OTP brute-force. |
| Sign-ups and sign-ins | 30 per 5 min | Default. Per-IP throttle; legitimate users will not hit this, automated abuse will. |

These are Supabase Auth limits, separate from the 4/hour cap on the default `noreply@mail.supabase.io` sender (which no longer applies under custom SMTP) and separate from any Resend-side limits.

### Inbound routing

The public-facing committee address is `committee@lasersport.org.au`. Inbound mail to that address is forwarded by the domain registrar to the committee's existing Gmail mailbox (`committee.alsa@gmail.com`). This avoids running an MX-hosted mailbox while keeping the public-facing address branded.

The forwarder is one-way: the committee receives mail at the branded address but currently replies from the Gmail address. Configuring Gmail's "Send As" to use `committee@lasersport.org.au` as the From: address is tracked as an operational task (blocked by a Gmail security delay related to a recent phone number change).

## Consequences

### Positive

- **Production-grade deliverability** for both auth emails and contact-form messages.
- **Branded sender address** (`noreply@lasersport.org.au` for auth, contact-form replies tagged with the user's email via `reply_to`).
- **Headroom on volume** — 3,000/month free tier comfortably exceeds expected portal usage.
- **Operational simplicity** — one provider for both flows reduces vendor count.
- **Separation of concerns** — two API keys mean either system can be rotated, audited, or replaced independently.

### Negative

- **External dependency.** If Resend has an outage, both auth emails and the contact form fail. Mitigated by the fact that auth emails (password reset, etc.) are infrequent and a temporary outage is recoverable.
- **DNS records must be maintained.** SPF/DKIM/DMARC records on `lasersport.org.au` need to remain accurate. If the domain is ever moved or the DNS provider changes, these must be re-applied or auth/contact emails will fail silently.
- **Contact form endpoint is unauthenticated and thus rate-limit-exposed.** Tracked as a P2 backlog item — needs Upstash Redis or Vercel KV-based per-IP throttling before public launch traffic ramps up.

### Neutral

- **Migration to a different provider is straightforward.** Both consumers (Supabase Auth + the Vercel API route) treat the provider as an opaque sending API. Switching from Resend to Postmark, SES, or similar is a configuration change, not a code change for Supabase, and a small code change for the Vercel route.

## Alternatives considered

### Stay on default Supabase sender

**Rejected.** 4/hour rate limit and unbranded sender address are both blockers for production launch.

### Postmark

**Considered, rejected for now.** Postmark has excellent deliverability and is the gold standard for transactional email, but its free tier is significantly smaller (100 emails/month) and pricing scales faster than Resend. Worth reconsidering if Resend's deliverability ever becomes inadequate.

### AWS SES

**Considered, rejected.** Cheapest option at scale, but the setup overhead (sandbox-removal request, IAM policies, sending-identity verification, bounce/complaint handling via SNS) is significantly heavier than Resend's. Not appropriate for a volunteer-maintained project at this volume.

### SendGrid / Mailgun

**Considered, rejected.** Both are mature transactional providers, but their developer experience is dated and their free tiers and dashboards lag behind Resend's. No specific advantage at our volume.

### Self-hosted SMTP (Postfix etc.)

**Rejected.** Operating a sending mail server requires ongoing reputation management, IP warm-up, abuse-handling, and security patching — all out of scope for a volunteer committee.

## References

- [Resend documentation](https://resend.com/docs)
- [Supabase custom SMTP configuration](https://supabase.com/docs/guides/auth/auth-smtp)
- [SPF, DKIM, and DMARC explained](https://www.cloudflare.com/learning/email-security/dmarc-dkim-spf/)
- [BACKLOG.md](../BACKLOG.md) — tracks the rate-limit followup for `/api/contact`
