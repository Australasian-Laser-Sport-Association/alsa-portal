import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const computeAndWriteAmountOwingMany = vi.fn()

vi.mock('./supabase.js', () => ({
  default: { from },
}))

vi.mock('./computeAmountOwing.js', () => ({
  computeAndWriteAmountOwing: vi.fn(),
  computeAndWriteAmountOwingMany,
}))

const { cleanupFormerSideEventMembers } = await import('./sideEventCleanup.js')

function memberQuery(rows) {
  return {
    select: vi.fn(col => ({
      eq: vi.fn((field, value) => ({
        in: vi.fn((inField, ids) => Promise.resolve({
          data: rows[col] ?? [],
          error: null,
          meta: { field, value, inField, ids },
        })),
      })),
    })),
  }
}

function registrationsQuery(rows, updates) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn(() => Promise.resolve({ data: rows, error: null })),
      })),
    })),
    update: vi.fn(payload => ({
      eq: vi.fn((field, id) => {
        updates.push({ field, id, payload })
        return Promise.resolve({ error: null })
      }),
    })),
  }
}

describe('cleanupFormerSideEventMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    computeAndWriteAmountOwingMany.mockResolvedValue([])
  })

  it('batch-cleans only former members with no remaining side-event row', async () => {
    const updates = []
    const membershipRows = {
      player1_id: [{ player1_id: 'member-still-present' }],
      player2_id: [],
    }
    const registrationRows = [
      { id: 'reg-clean', user_id: 'member-clean', side_events: ['doubles', 'solos'] },
      { id: 'reg-untouched', user_id: 'member-no-slug', side_events: ['solos'] },
    ]

    from.mockImplementation(table => {
      if (table === 'doubles_pairs') return memberQuery(membershipRows)
      if (table === 'zltac_registrations') return registrationsQuery(registrationRows, updates)
      throw new Error(`unexpected table ${table}`)
    })

    const changed = await cleanupFormerSideEventMembers({
      table: 'doubles_pairs',
      slug: 'doubles',
      playerCols: ['player1_id', 'player2_id'],
      memberIds: ['member-clean', 'member-still-present', 'member-no-slug', 'member-clean'],
      eventYear: 2026,
    })

    expect(changed).toEqual(['reg-clean'])
    expect(updates).toEqual([
      { field: 'id', id: 'reg-clean', payload: { side_events: ['solos'] } },
    ])
    expect(computeAndWriteAmountOwingMany).toHaveBeenCalledWith(['reg-clean'])
  })

  it('does nothing for an empty member list', async () => {
    const changed = await cleanupFormerSideEventMembers({
      table: 'doubles_pairs',
      slug: 'doubles',
      playerCols: ['player1_id', 'player2_id'],
      memberIds: [],
      eventYear: 2026,
    })

    expect(changed).toEqual([])
    expect(from).not.toHaveBeenCalled()
    expect(computeAndWriteAmountOwingMany).not.toHaveBeenCalled()
  })
})
