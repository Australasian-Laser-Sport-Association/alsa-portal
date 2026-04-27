export const COMMITTEE_ROLES = ['superadmin', 'alsa_committee', 'zltac_committee', 'advisor']

export const ROLE_ORDER = ['superadmin', 'alsa_committee', 'zltac_committee', 'advisor', 'captain', 'player']

export function isCommittee(profile) {
  const roles = profile?.roles ?? []
  return roles.some(r => COMMITTEE_ROLES.includes(r))
}
