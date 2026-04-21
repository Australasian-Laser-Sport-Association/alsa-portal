# Contributing

## Branches

| Type | Prefix | Example |
|------|--------|---------|
| New feature | `feature/` | `feature/player-hub-stats` |
| Bug fix | `fix/` | `fix/registration-email-crash` |
| Docs | `docs/` | `docs/update-readme` |

Branch from `main`. Do not commit directly to `main`.

## Commit Messages

Use concise imperative phrasing:

```
Add captain invite link expiry
Fix mobile sidebar overflow
Update ZLTAC registration close date
```

No ticket numbers required. Keep the subject line under 72 characters.

## Pull Requests

1. Open a PR against `main`
2. Write a short description of what changed and why
3. Request a review from the committee lead before merging
4. Vercel will create a preview deployment automatically — include the preview URL if the change is visual

## Code Style

Follow the existing ESLint config (`eslint.config.js`). Run `npm run lint` before opening a PR. No new dependencies without discussion.
