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
  if (error?.code === '42501') {
    return { status: 403, error: message }
  }
  if (['23503', '23514', '40001', '40P01', '55000'].includes(error?.code)) {
    return { status: 409, error: message }
  }
  if (error?.code === 'P0001' && message.includes('Only the team captain')) {
    return { status: 403, error: message }
  }
  if (error?.code === 'P0001' && EXPECTED_ERRORS.some(prefix => message.includes(prefix))) {
    return { status: 409, error: message }
  }
  return { status: 500, error: message }
}

export function isAllowedTeamLogoUrl(value, supabaseUrl, allowedFolderIds = null) {
  if (value == null || value === '') return true
  try {
    const logo = new URL(value)
    const base = new URL(supabaseUrl)
    const prefix = '/storage/v1/object/public/team-logos/'
    if (
      logo.origin !== base.origin
      || logo.username
      || logo.password
      || logo.search
      || logo.hash
      || !logo.pathname.startsWith(prefix)
    ) return false

    if (allowedFolderIds == null) return true
    const folders = Array.isArray(allowedFolderIds)
      ? allowedFolderIds
      : [allowedFolderIds]
    return folders.some(folderId => (
      typeof folderId === 'string'
      && folderId.length > 0
      && logo.pathname.startsWith(`${prefix}${folderId}/`)
    ))
  } catch {
    return false
  }
}
