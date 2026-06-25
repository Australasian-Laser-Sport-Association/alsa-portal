import { describe, expect, it } from 'vitest'
import { isUuid, validateUuidList } from './idValidation.js'

const UUID_A = '123e4567-e89b-42d3-a456-426614174000'
const UUID_B = '123e4567-e89b-42d3-a456-426614174001'

describe('id validation helpers', () => {
  it('accepts canonical UUID strings only', () => {
    expect(isUuid(UUID_A)).toBe(true)
    expect(isUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid(`${UUID_A}),player1_id.not.is.null`)).toBe(false)
    expect(isUuid(null)).toBe(false)
  })

  it('validates UUID arrays and caps their size', () => {
    expect(validateUuidList([UUID_A, UUID_B])).toEqual({ ids: [UUID_A, UUID_B] })
    expect(validateUuidList('nope', { name: 'playerIds' })).toEqual({ error: 'playerIds must be an array' })
    expect(validateUuidList([UUID_A, 'bad'], { name: 'playerIds' })).toEqual({ error: 'playerIds contains an invalid id' })
    expect(validateUuidList([UUID_A, UUID_B], { name: 'playerIds', max: 1 })).toEqual({ error: 'playerIds must contain 1 or fewer ids' })
  })
})
