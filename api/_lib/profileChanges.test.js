import { describe, expect, it, vi } from 'vitest'
import { changeProfileAlias, normaliseAlias } from './profileChanges.js'

describe('profile alias changes', () => {
  it('normalises blank aliases to null', () => {
    expect(normaliseAlias('  Callsign  ')).toBe('Callsign')
    expect(normaliseAlias('   ')).toBeNull()
  })

  it('requires an audit reason before calling the database', async () => {
    const rpc = vi.fn()
    const result = await changeProfileAlias({
      supabase: { rpc }, targetProfileId: 'target-1', newAlias: 'Callsign',
      reason: 'no', changedBy: 'admin-1', source: 'admin-users',
    })

    expect(result.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('uses the transactional database function with actor and source', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { changed: true, alias: 'Callsign' }, error: null })
    const result = await changeProfileAlias({
      supabase: { rpc }, targetProfileId: 'target-1', newAlias: ' Callsign ',
      reason: 'Correcting event identity', changedBy: 'admin-1', source: 'registration-editor',
    })

    expect(result.error).toBeNull()
    expect(rpc).toHaveBeenCalledWith('change_profile_alias', {
      p_target_profile_id: 'target-1', p_new_alias: 'Callsign',
      p_reason: 'Correcting event identity', p_changed_by: 'admin-1',
      p_source: 'registration-editor',
    })
  })

  it('maps unique-index races to a conflict response', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate' } })
    const result = await changeProfileAlias({
      supabase: { rpc }, targetProfileId: 'target-1', newAlias: 'Taken',
      reason: 'Requested correction', changedBy: 'admin-1', source: 'admin-users',
    })

    expect(result.status).toBe(409)
  })
})
