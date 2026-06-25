import { describe, expect, it } from 'vitest'
import { PASSWORD_REQUIREMENT_TEXT, validatePassword } from './passwordPolicy'

describe('validatePassword', () => {
  it('rejects passwords shorter than the shared minimum', () => {
    expect(validatePassword('short')).toBe(PASSWORD_REQUIREMENT_TEXT)
  })

  it('accepts passwords that meet the shared minimum', () => {
    expect(validatePassword('1234567890')).toBe('')
  })
})
