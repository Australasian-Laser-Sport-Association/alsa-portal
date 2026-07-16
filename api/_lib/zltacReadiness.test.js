import { describe, expect, it } from 'vitest'
import {
  calculateZltacReadiness,
  legalAcceptanceReadiness,
  READINESS_STATUS,
} from './zltacReadiness.js'

const activeDocuments = {
  codeOfConduct: { id: 'coc-v2', requires_reacceptance: false, content_sha256: 'coc-hash' },
  mediaRelease: { id: 'media-v2', requires_reacceptance: false, content_sha256: 'media-hash' },
  under18Form: { id: 'u18-v2', requires_reacceptance: false },
}

function readyInput(overrides = {}) {
  return {
    event: {
      requireCodeOfConduct: true,
      requireMediaRelease: true,
      requireRefereeTest: true,
      requirePayment: true,
      requireSideEventConfirmation: true,
      requireExtrasConfirmation: true,
    },
    registration: {
      id: 'registration-1',
      amount_owing: 10_000,
      has_confirmed_side_events: true,
      has_confirmed_extras: true,
    },
    identity: { valid: true },
    team: { id: 'team-1', required: true, status: 'approved' },
    documents: activeDocuments,
    acceptances: {
      codeOfConduct: { document_id: 'coc-v2', content_sha256: 'coc-hash' },
      mediaRelease: { document_id: 'media-v2', content_sha256: 'media-hash' },
    },
    refereeTest: { passed: true },
    sideEvents: { partnerRostersConfirmed: true },
    under18: { requirement: 'not_required', approval: null },
    payment: { amountPaidCents: 10_000 },
    overrides,
  }
}

describe('canonical ZLTAC readiness', () => {
  it('marks a fully satisfied registration event ready', () => {
    const readiness = calculateZltacReadiness(readyInput())
    expect(readiness.overall).toEqual({
      player_actions_complete: true,
      awaiting_committee: false,
      event_ready: true,
      state: 'event_ready',
    })
  })

  it('does not treat a partial payment as ready', () => {
    const input = readyInput()
    input.payment.amountPaidCents = 2_500
    const readiness = calculateZltacReadiness(input)
    expect(readiness.checks.payment).toMatchObject({
      status: READINESS_STATUS.ACTION_REQUIRED,
      source: 'partially_paid',
      detail: { balanceCents: 7_500 },
    })
    expect(readiness.overall.event_ready).toBe(false)
  })

  it('separates a submitted under-18 form from committee approval', () => {
    const input = readyInput()
    input.under18 = { requirement: 'required', approval: { status: 'pending', document_id: 'u18-v2' } }
    const readiness = calculateZltacReadiness(input)
    expect(readiness.checks.under_18.status).toBe(READINESS_STATUS.PENDING_REVIEW)
    expect(readiness.overall).toMatchObject({
      player_actions_complete: true,
      awaiting_committee: true,
      event_ready: false,
    })
  })

  it('fails closed when registration DOB identity is invalid', () => {
    const input = readyInput()
    input.identity = { valid: false, reason: 'invalid_date_of_birth' }
    input.under18 = { requirement: 'blocked', approval: null }
    const readiness = calculateZltacReadiness(input)
    expect(readiness.checks.identity.status).toBe(READINESS_STATUS.ACTION_REQUIRED)
    expect(readiness.checks.under_18.source).toBe('invalid_or_missing_date_of_birth')
    expect(readiness.overall.player_actions_complete).toBe(false)
  })

  it('treats a pending team review as committee work, not event ready', () => {
    const input = readyInput()
    input.team.status = 'pending'
    const readiness = calculateZltacReadiness(input)
    expect(readiness.checks.team.status).toBe(READINESS_STATUS.PENDING_REVIEW)
    expect(readiness.overall.state).toBe('awaiting_committee')
  })

  it('honours audited tri-state committee overrides', () => {
    const satisfiedInput = readyInput({
      refereeTest: { value: true, setAt: '2026-07-13T00:00:00Z', reason: 'Verified result' },
    })
    satisfiedInput.refereeTest.passed = false
    expect(calculateZltacReadiness(satisfiedInput).checks.referee_test)
      .toMatchObject({ status: READINESS_STATUS.SATISFIED, source: 'committee_override' })

    const rejectedInput = readyInput({ mediaRelease: { value: false, reason: 'Withdrawn' } })
    expect(calculateZltacReadiness(rejectedInput).checks.media_release)
      .toMatchObject({ status: READINESS_STATUS.REJECTED, source: 'committee_override' })
  })

  it('requires an approved under-18 form and not merely a submitted one', () => {
    const input = readyInput()
    input.under18 = {
      requirement: 'required',
      approval: { status: 'approved', document_id: 'u18-v2' },
    }
    expect(calculateZltacReadiness(input).overall.event_ready).toBe(true)

    input.under18.approval.status = 'pending'
    expect(calculateZltacReadiness(input).overall).toMatchObject({
      player_actions_complete: true,
      awaiting_committee: true,
      event_ready: false,
    })
  })

  it('fails closed when an under-18 decision has no document evidence', () => {
    const input = readyInput()
    input.under18 = { requirement: 'required', approval: { status: 'approved', document_id: null } }
    expect(calculateZltacReadiness(input).checks.under_18).toEqual({
      status: READINESS_STATUS.ACTION_REQUIRED,
      source: 'approval_document_missing',
    })
  })
})

describe('legal acceptance readiness', () => {
  it('requires reacceptance when the active version says so', () => {
    expect(legalAcceptanceReadiness(
      { id: 'v2', requires_reacceptance: true },
      { document_id: 'v1', document: { requires_reacceptance: false } },
    )).toEqual({ status: READINESS_STATUS.ACTION_REQUIRED, source: 'reacceptance_required' })
  })

  it('rejects evidence whose recorded digest disagrees with the active bytes', () => {
    expect(legalAcceptanceReadiness(
      { id: 'v2', content_sha256: 'expected' },
      { document_id: 'v2', content_sha256: 'different' },
    )).toEqual({ status: READINESS_STATUS.REJECTED, source: 'content_digest_mismatch' })
  })

  it('fails closed when published evidence has no acceptance digest', () => {
    expect(legalAcceptanceReadiness(
      { id: 'v2', content_sha256: 'expected' },
      { document_id: 'v2' },
    )).toEqual({ status: READINESS_STATUS.REJECTED, source: 'acceptance_digest_missing' })
  })

  it('does not carry an old version reacceptance flag into a later non-substantive version', () => {
    expect(legalAcceptanceReadiness(
      { id: 'v3', requires_reacceptance: false },
      { document_id: 'v2', document: { requires_reacceptance: true } },
    )).toEqual({ status: READINESS_STATUS.SATISFIED, source: 'prior_document_still_valid' })
  })
})
