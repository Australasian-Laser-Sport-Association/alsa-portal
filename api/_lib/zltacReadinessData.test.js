import { describe, expect, it, vi } from 'vitest'
import { READINESS_STATUS } from './zltacReadiness.js'

vi.mock('./supabase.js', () => ({ default: {} }))

const { assembleZltacReadiness } = await import('./zltacReadinessData.js')

const USER_ID = '123e4567-e89b-42d3-a456-426614174000'
const TEAM_ID = '223e4567-e89b-42d3-a456-426614174000'

function fixture(overrides = {}) {
  const event = {
    id: 'event-current',
    year: 2027,
    status: 'open',
    start_date: '2027-06-15',
    event_starts_at: null,
    timezone: 'Australia/Sydney',
    require_coc: true,
    require_ref_test: true,
    require_payment: true,
    allow_side_events_only: false,
  }
  const registration = {
    id: 'registration-current',
    user_id: USER_ID,
    team_id: TEAM_ID,
    year: 2027,
    status: 'pending',
    side_events: ['doubles'],
    has_confirmed_side_events: true,
    has_confirmed_extras: true,
    amount_owing: 10_000,
    dob_at_registration: '2000-01-01',
    teams: { id: TEAM_ID, event_id: event.id, status: 'approved' },
  }
  return {
    event,
    userIds: [USER_ID],
    registrations: [registration],
    documents: [
      { id: 'coc-v2', document_type: 'code_of_conduct', version: 2, is_active: true, requires_reacceptance: true, published_at: '2027-01-01T00:00:00Z', content_sha256: 'coc-hash', object_size: 100 },
      { id: 'media-v2', document_type: 'media_release', version: 2, is_active: true, requires_reacceptance: false, published_at: '2027-01-01T00:00:00Z', content_sha256: 'media-hash', object_size: 100 },
      { id: 'u18-v2', document_type: 'under_18_form', version: 2, is_active: true, requires_reacceptance: false, published_at: '2027-01-01T00:00:00Z', content_sha256: 'u18-hash', object_size: 100 },
    ],
    acceptances: [
      { user_id: USER_ID, event_year: 2027, document_id: 'coc-v2', accepted_at: '2027-01-02T00:00:00Z', content_sha256: 'coc-hash', document: { id: 'coc-v2', document_type: 'code_of_conduct', content_sha256: 'coc-hash' } },
      { user_id: USER_ID, event_year: 2027, document_id: 'media-v2', accepted_at: '2027-01-02T00:00:00Z', content_sha256: 'media-hash', document: { id: 'media-v2', document_type: 'media_release', content_sha256: 'media-hash' } },
    ],
    refereeResults: [{ user_id: USER_ID, passed: true, score: 90 }],
    under18Approvals: [],
    paymentRecords: [{ registration_id: registration.id, amount: 10_000 }],
    doubles: [{ player1_id: USER_ID, player2_id: 'other', confirmed: true }],
    triples: [],
    profiles: [{ id: USER_ID, suspended: false }],
    ...overrides,
  }
}

describe('ZLTAC readiness data adapter', () => {
  it('assembles an event-ready result from current-event evidence', () => {
    const result = assembleZltacReadiness(fixture())[USER_ID]
    expect(result.overall).toEqual({
      player_actions_complete: true,
      awaiting_committee: false,
      event_ready: true,
      state: 'event_ready',
    })
  })

  it('never lets a historic registration populate the current event', () => {
    const input = fixture()
    input.registrations = [{ ...input.registrations[0], id: 'historic', year: 2026 }]

    const result = assembleZltacReadiness(input)[USER_ID]
    expect(result.checks.identity).toEqual({
      status: READINESS_STATUS.ACTION_REQUIRED,
      source: 'registration_missing',
    })
    expect(result.overall.event_ready).toBe(false)
  })

  it('uses the payment ledger and rejects partial payment', () => {
    const input = fixture({ paymentRecords: [{ registration_id: 'registration-current', amount: 2_500 }] })
    const result = assembleZltacReadiness(input)[USER_ID]
    expect(result.checks.payment).toMatchObject({
      status: READINESS_STATUS.ACTION_REQUIRED,
      source: 'partially_paid',
      detail: { balanceCents: 7_500 },
    })
  })

  it('requires the current legal version when it is marked for reacceptance', () => {
    const input = fixture()
    input.acceptances[0] = {
      user_id: USER_ID,
      event_year: 2027,
      document_id: 'coc-v1',
      accepted_at: '2027-01-01T00:00:00Z',
      document: { id: 'coc-v1', document_type: 'code_of_conduct' },
    }

    const result = assembleZltacReadiness(input)[USER_ID]
    expect(result.checks.code_of_conduct).toEqual({
      status: READINESS_STATUS.ACTION_REQUIRED,
      source: 'reacceptance_required',
    })
  })

  it('marks an under-18 submission as committee pending, not ready', () => {
    const input = fixture()
    input.registrations[0].dob_at_registration = '2012-01-01'
    input.under18Approvals = [{
      user_id: USER_ID,
      event_year: 2027,
      status: 'pending',
      document_id: 'u18-v2',
    }]

    const result = assembleZltacReadiness(input)[USER_ID]
    expect(result.checks.under_18.status).toBe(READINESS_STATUS.PENDING_REVIEW)
    expect(result.overall).toMatchObject({
      player_actions_complete: true,
      awaiting_committee: true,
      event_ready: false,
    })
  })

  it('preserves tri-state override audit evidence', () => {
    const input = fixture()
    input.refereeResults = [{ user_id: USER_ID, passed: false }]
    Object.assign(input.registrations[0], {
      admin_override_ref_test: true,
      admin_override_ref_test_set_by: 'committee-user',
      admin_override_ref_test_set_at: '2027-02-03T00:00:00Z',
      admin_override_ref_test_reason: 'Verified external result',
    })

    const result = assembleZltacReadiness(input)[USER_ID]
    expect(result.checks.referee_test).toEqual({
      status: READINESS_STATUS.SATISFIED,
      source: 'committee_override',
      detail: {
        setBy: 'committee-user',
        setAt: '2027-02-03T00:00:00Z',
        reason: 'Verified external result',
      },
    })
  })

  it('never reports a suspended registrant as event ready', () => {
    const input = fixture({ profiles: [{ id: USER_ID, suspended: true }] })

    const result = assembleZltacReadiness(input)[USER_ID]

    expect(result.checks.identity).toEqual({
      status: READINESS_STATUS.ACTION_REQUIRED,
      source: 'account_suspended',
    })
    expect(result.overall.event_ready).toBe(false)
  })
})
