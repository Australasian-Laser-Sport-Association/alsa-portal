// Human-friendly relative time formatter shared across the admin, manage,
// and player surfaces. Extracted from three byte-identical copies that
// previously lived in:
//   - src/pages/admin/AdminCompetitions.jsx
//   - src/pages/manage/ManagerCompetitionDetail.jsx
//   - src/pages/competition/CompetitionHub.jsx
// Behaviour preserved exactly; no caller required code changes.

/**
 * Format a timestamp as a short relative-time string.
 *
 * @param {string|Date|null|undefined} iso - ISO 8601 timestamp string
 *   (or anything else accepted by `new Date(...)`). Falsy values return ''.
 * @returns {string} One of: '', 'just now', 'N min ago', 'N hr ago',
 *   'N day(s) ago', 'N mo ago'.
 *
 * Buckets:
 *   < 60s  → 'just now'
 *   < 60m  → 'N min ago'
 *   < 24h  → 'N hr ago'
 *   < 30d  → 'N day(s) ago'   (singular when N === 1)
 *   ≥ 30d  → 'N mo ago'
 *
 * Note: future timestamps are not handled explicitly — they fall into the
 * `< 60s` bucket and return 'just now' regardless of how far in the future.
 * Existing callers do not pass future times; preserving this for behavioural
 * parity with the original inline copies.
 */
export function relativeTime(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.round(ms / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`
  const mo = Math.round(d / 30)
  return `${mo} mo ago`
}
