import { describe, expect, it } from 'vitest'
import { PASSWORD_REQUIREMENT_TEXT, validatePassword } from './passwordPolicy'

describe('validatePassword', () => {
  it('rejects passwords shorter than the shared minimum', () => {
    expect(validatePassword('short')).toBe(PASSWORD_REQUIREMENT_TEXT)
  })

  it.each([
    'alllowercase1',
    'ALLUPPERCASE1',
    'MixedLettersOnly',
  ])('rejects a password missing a hosted Auth character class: %s', password => {
    expect(validatePassword(password)).toBe(PASSWORD_REQUIREMENT_TEXT)
  })

  it('accepts passwords that meet the shared hosted Auth policy', () => {
    expect(validatePassword('PortalTest1')).toBe('')
  })
})
