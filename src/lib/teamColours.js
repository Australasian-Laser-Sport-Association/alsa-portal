// Canonical team-colour palette. Imported by every page that lets a captain
// pick or change a team colour (CaptainRegister, CaptainHub, and the
// pre-nationals competition hub). Server-side validators import this same
// list via the SHARED_HEX_SET re-export.
//
// Add new entries here and they propagate everywhere; do not duplicate this
// array in page files.
export const TEAM_COLOURS = [
  '#00E6FF',
  '#FF3B30',
  '#0A84FF',
  '#FF9F0A',
  '#BF5AF2',
  '#FF375F',
  '#30D158',
  '#64D2FF',
]

export function isValidTeamColour(hex) {
  return typeof hex === 'string' && TEAM_COLOURS.includes(hex)
}
