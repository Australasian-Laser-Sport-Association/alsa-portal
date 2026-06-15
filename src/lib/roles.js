// Roles that can enter committee tooling and exercise privileged API/RLS paths.
// Advisor is intentionally hidden from public committee rosters, but retains
// full committee authority inside authenticated tooling.
export const COMMITTEE_ROLES = ['superadmin', 'alsa_committee', 'zltac_committee', 'advisor']

// Roles only a superadmin may assign or remove.
export const PRIVILEGED_ROLES = [...COMMITTEE_ROLES]

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
