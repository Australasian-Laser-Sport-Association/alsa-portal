// Roles that can enter committee tooling and exercise privileged API/RLS paths.
// `advisor` is intentionally excluded: the current admin UI is mutation-heavy
// and does not provide a trustworthy read-only mode.
export const COMMITTEE_ROLES = ['superadmin', 'alsa_committee', 'zltac_committee']

// Roles only a superadmin may assign or remove. Advisor is non-operational but
// still a privileged governance designation.
export const PRIVILEGED_ROLES = [...COMMITTEE_ROLES, 'advisor']

// Roles safe to disclose to other users (e.g. CommitteeBadge). Deliberately
// excludes superadmin/advisor, which must never leak via /api/profiles.
export const PUBLIC_ROLE_BADGE_ROLES = ['alsa_committee', 'zltac_committee']

export const ROLE_ORDER = ['superadmin', 'alsa_committee', 'zltac_committee', 'advisor', 'captain', 'player']

export function isCommittee(profile) {
  const roles = profile?.roles ?? []
  return roles.some(r => COMMITTEE_ROLES.includes(r))
}

export function isSuperAdmin(profile) {
  const roles = profile?.roles ?? []
  return roles.includes('superadmin')
}
