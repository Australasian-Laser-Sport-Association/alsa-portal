import { describe, expect, it } from 'vitest'
import { COMMITTEE_ROLES, PRIVILEGED_ROLES, isCommittee } from './roles'

describe('role capabilities', () => {
  it('keeps advisor privileged for assignment but grants no committee authority', () => {
    expect(PRIVILEGED_ROLES).toContain('advisor')
    expect(COMMITTEE_ROLES).not.toContain('advisor')
    expect(isCommittee({ roles: ['advisor'] })).toBe(false)
  })
})

