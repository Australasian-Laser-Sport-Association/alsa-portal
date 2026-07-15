import { describe, expect, it } from 'vitest'
import { safeInternalRedirect } from './safeRedirect.js'

describe('post-login redirect validation', () => {
  it('keeps normal application paths, queries, and fragments', () => {
    expect(safeInternalRedirect('/events/2027?tab=teams#registered')).toBe(
      '/events/2027?tab=teams#registered',
    )
  })

  it('rejects external, protocol-relative, backslash, and control-character targets', () => {
    for (const value of [
      'https://attacker.example',
      '//attacker.example',
      '/\\attacker.example',
      '/%5cattacker.example',
      '/safe\n//attacker.example',
      'dashboard',
    ]) {
      expect(safeInternalRedirect(value)).toBeNull()
    }
  })
})
