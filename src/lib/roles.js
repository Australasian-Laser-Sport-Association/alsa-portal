export const COMMITTEE_ROLES = ['superadmin', 'alsa_committee', 'zltac_committee', 'advisor']

// Roles safe to disclose to other users (e.g. CommitteeBadge). Deliberately
// excludes superadmin/advisor, which must never leak via /api/profiles. Do NOT
// substitute COMMITTEE_ROLES here — it includes superadmin.
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
