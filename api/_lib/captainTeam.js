const EXPECTED_ERRORS = [
  'Maximum number of teams',
  'Registration cap of',
  'Team is full',
  'Registration is closed',
  'This team is locked',
]

export function captainTeamErrorResponse(error) {
  const message = error?.message || 'Could not create team.'
  if (error?.code === '23505') {
    return { status: 409, error: 'You already have a team for this event.' }
  }
  if (error?.code === '22023' || error?.code === '22001') {
    return { status: 400, error: message }
  }
  if (error?.code === 'P0002') {
    return { status: 404, error: message }
  }
  if (error?.code === 'P0001' && message.includes('Only the team captain')) {
    return { status: 403, error: message }
  }
  if (error?.code === 'P0001' && EXPECTED_ERRORS.some(prefix => message.includes(prefix))) {
    return { status: 409, error: message }
  }
  return { status: 500, error: message }
}

export function isAllowedTeamLogoUrl(value, supabaseUrl) {
  if (value == null || value === '') return true
  try {
    const logo = new URL(value)
    const base = new URL(supabaseUrl)
    return logo.origin === base.origin
      && logo.pathname.startsWith('/storage/v1/object/public/team-logos/')
  } catch {
    return false
  }
}
