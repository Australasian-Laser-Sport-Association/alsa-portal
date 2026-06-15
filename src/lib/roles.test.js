import { describe, expect, it } from 'vitest'
import {
  COMMITTEE_ROLES,
  PRIVILEGED_ROLES,
  PUBLIC_ROLE_BADGE_ROLES,
  isCommittee,
} from './roles'

describe('role capabilities', () => {
  it('grants advisor committee authority without making it publicly disclosable', () => {
    expect(PRIVILEGED_ROLES).toContain('advisor')
    expect(COMMITTEE_ROLES).toContain('advisor')
    expect(PUBLIC_ROLE_BADGE_ROLES).not.toContain('advisor')
    expect(isCommittee({ roles: ['advisor'] })).toBe(true)
  })
})
