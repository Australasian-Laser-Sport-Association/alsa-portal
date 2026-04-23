# ADR-0004: CMS Removed in Favour of Static Content

**Status:** Draft — for committee review
**Date:** 2026-04-22
**Supersedes:** None
**Related:** [ADR-0001: Supabase Over Custom Backend](./0001-supabase-over-custom-backend.md), [ADR-0002: RLS + GRANT Security Model](./0002-rls-plus-grant-security-model.md)

---

## Context

An early version of the ALSA Portal included a database-backed content management system: three tables (`cms_global`, `cms_pages`, `cms_sections`) with an admin UI for editing page copy, section headings, and global strings (site name, tagline, committee contact details, etc.). The intent was that committee members could update wording without needing a developer.

As the portal matured, several realities became clear:

1. **Content changes are rare.** Page copy has been edited perhaps a dozen times across the project's life, almost always by the same developer who would otherwise be writing code.
2. **The only plausible editor is the committee member already making code changes.** There is no separate "content team." A non-technical committee member has never edited CMS content and is unlikely to.
3. **The CMS added real surface area.** Three tables with their own RLS policies, their own GRANT statements, their own admin UI, their own loading/caching logic on every page, and their own potential for 42501 errors when policies drift.
4. **The CMS had to be correct for every page to render.** A content row with a typo in a key, or a missing row entirely, produced broken pages. Static content cannot fail this way.
5. **Claude Code plus GitHub already gives us a content editor.** The developer edits strings in code, commits, and Vercel redeploys in under two minutes. This is faster than logging into an admin panel.

In the course of finalising the role GRANT baseline and data access matrix (see [ADR-0002](./0002-rls-plus-grant-security-model.md)), the CMS tables were identified as carrying security and operational cost with no corresponding user benefit, and were dropped.

## Decision

The CMS is **removed**. All user-visible content — page copy, section headings, global strings, committee contact details, event descriptions that are not event records themselves — is managed as **static values in the frontend source code**.

### What was removed

| Component | Action |
|---|---|
| `cms_global` table | Dropped |
| `cms_pages` table | Dropped |
| `cms_sections` table | Dropped |
| Associated RLS policies and GRANTs | Dropped with the tables |
| Admin UI routes for editing CMS content | Removed from the app |
| Frontend loading code that fetched CMS content on page load | Replaced with static imports |

### What replaces it

Content lives in the frontend source tree alongside the components that render it. Typically:

- **Page-specific copy** lives in the page component itself or in an adjacent `content.js` / `content.ts` file
- **Shared strings** (site name, tagline, committee email) live in a single `src/config/content.js` module imported where needed
- **Long-form content** (policy descriptions, about pages) can live as `.md` or `.mdx` files rendered at build time

### How content gets edited

1. A committee member identifies a change (a typo, new wording, updated contact detail).
2. They raise it with the developer, or open an issue, or edit the file directly if they are technical.
3. The developer edits the string in code, often with Claude Code's assistance.
4. The change is committed, pushed, and deployed by Vercel within ~2 minutes.
5. Git history provides a full audit trail of what changed, when, and by whom.

### What is explicitly not affected

Data that is genuinely **data** — events, registrations, profiles, policy versions, referee test questions, registration pricing — remains in the database. This ADR is about *content* (the words on the page) not *data* (the records the application manages). The distinction is:

- **Data:** something with a lifecycle, ownership, or relationships. Belongs in Postgres.
- **Content:** static prose that describes the application to users. Belongs in code.

Policy PDFs, media releases, and guardian forms remain in Supabase Storage (they are documents, not content in the CMS sense).

## Consequences

### Positive

- **Smaller attack surface.** Three fewer tables means three fewer sets of RLS policies to keep correct, three fewer places a permission drift could expose data, and no admin UI route that required role checking.

- **Content changes are atomic with code changes.** A feature that introduces new copy ships the copy in the same commit as the feature. There is no window where the code expects a CMS key that does not yet exist.

- **Git history is the audit log.** Every word of copy has a commit, an author, a timestamp, and a diff. This is better audit than the CMS ever had (it had no revision history).

- **No runtime CMS fetch on every page load.** Content is bundled into the JavaScript at build time. Pages are faster and cannot fail to render due to a missing content row.

- **Lower cognitive load.** A developer reading the portal no longer has to wonder whether a given string lives in a `cms_sections` row or in the component. It is always in the component.

- **Aligns with our actual editing pattern.** The portal is edited by one person with Claude Code. Matching the tooling to the workflow, rather than imagining a workflow we do not have, is a healthier steady state.

### Negative

- **Content changes require a code deploy.** A committee member who spots a typo cannot fix it themselves through a web UI. They must raise it with the developer. Mitigated by the fact that deploys are fast (~2 minutes), Claude Code makes the edit trivial, and the volume of such requests is very low.

- **If the maintainer is unavailable, copy cannot be changed.** A scenario where, say, the site name needs to change urgently while the developer is on holiday is harder to resolve. Mitigated by the fact that any committee member with GitHub access and basic comfort can edit a string and open a pull request; the operation is not developer-only in principle.

- **Non-developer committee members have less visible ownership of content.** The CMS gave a notional sense that the committee "owned" the content. That ownership was never exercised, but its removal should be called out rather than hidden.

### Neutral

- **Reversible if circumstances change.** If ALSA one day has a non-technical content editor who wants to update copy regularly, a CMS can be re-introduced — either a new internal build or a third-party headless CMS (Sanity, Contentful, Strapi). That future decision would merit its own ADR and would benefit from knowing the actual editing workflow that had emerged.

- **Does not change the database security story.** The dropped tables were already covered by the same RLS + GRANT model applied to the rest of the schema ([ADR-0002](./0002-rls-plus-grant-security-model.md)). Removing them simplifies the model rather than changing its principles.

## Alternatives considered

### Keep the CMS, improve its ergonomics

**Rejected.** Improving the CMS (richer editor, revision history, preview mode, role-based editing permissions) would have required significant additional build work to solve a problem no-one has: there is no content editor who wants better CMS ergonomics. Investing engineering effort where there is no corresponding user value is the wrong prioritisation for a volunteer committee.

### Replace with a third-party headless CMS (Sanity, Contentful, Strapi)

**Rejected for now.** A hosted headless CMS solves the "non-developer wants to edit copy" problem cleanly, but it introduces another vendor, another account, another set of credentials, and typically a recurring subscription for anything above minimal use. The problem being solved is not one we actually have. If that changes, this option should be reconsidered.

### Keep the tables but stop using them

**Rejected.** Orphan tables with RLS policies and GRANTs are a liability — future contributors have to understand why they exist, and they still consume schema review effort when migrations touch adjacent objects. Dropping them removes ambiguity.

### Move content into Markdown files in the repo

**Considered, partially adopted.** Long-form content (policy descriptions, multi-paragraph about pages) is a reasonable fit for `.md` / `.mdx` files rendered at build time. Short strings (headings, labels, committee email) are a better fit for JavaScript modules, because they are interpolated into components and benefit from the code tooling (find-in-files, refactor rename). Both are "static content in the repo" — this ADR permits both without mandating one.

## References

- [ADR-0001: Supabase Over Custom Backend](./0001-supabase-over-custom-backend.md) — the backend we simplified by removing these tables
- [ADR-0002: RLS + GRANT Security Model](./0002-rls-plus-grant-security-model.md) — the security model the dropped tables lived under
- [Data Access Matrix](../security/data-access-matrix.md) — updated to reflect the removed tables
- Backlog item (2026-04-22): CMS tables dropped
