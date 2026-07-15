import { expect, test } from '@playwright/test'
import { installMockBackend } from './support/mockBackend.js'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const EVENT_ID = '33333333-3333-4333-8333-333333333333'

const event = {
  id: EVENT_ID,
  name: 'ZLTAC Safeguarding Test',
  year: 2027,
  status: 'open',
  start_date: '2027-10-01',
  timezone: 'Australia/Sydney',
  reg_close_date: '2027-09-01T00:00:00.000Z',
  event_starts_at: '2027-10-01T00:00:00.000Z',
  side_events: [],
  main_fee: 0,
  team_fee: 0,
  dinner_guest_price: 0,
  processing_fee_pct: 0,
  require_ref_test: false,
  require_coc: false,
  require_payment: false,
  committee_email: 'committee@example.test',
}

const registration = {
  id: '44444444-4444-4444-8444-444444444444',
  user_id: USER_ID,
  year: event.year,
  event_id: EVENT_ID,
  team_id: null,
  status: 'pending',
  dob_at_registration: '2012-04-20',
  side_events: [],
  dinner_guests: 0,
  has_confirmed_side_events: true,
  has_confirmed_extras: true,
  amount_owing: 0,
  payment_reference: 'SAFE-REF',
  teams: null,
}

function checks(under18Status) {
  return {
    identity: { status: 'satisfied' },
    team: { status: 'not_required' },
    code_of_conduct: { status: 'not_required' },
    referee_test: { status: 'not_required' },
    media_release: { status: 'not_required' },
    side_events: { status: 'not_required' },
    extras: { status: 'not_required' },
    under_18: { status: under18Status },
    payment: { status: 'not_required' },
  }
}

function backendOptions({ approval, readiness }) {
  return {
    restTables: {
      public_zltac_events: event,
      zltac_registrations: registration,
      legal_documents: [],
      legal_acceptances: [],
      referee_test_results: null,
      under_18_approvals: approval,
      referee_test_settings: null,
      payment_records: [],
      doubles_pairs: null,
      triples_teams: null,
    },
    apiResponses: {
      '/api/player?resource=readiness': {
        event: { id: EVENT_ID, year: event.year },
        readiness,
      },
    },
  }
}

test('a submitted under-18 form completes player actions but still awaits committee', async ({ page }) => {
  const approval = {
    id: '55555555-5555-4555-8555-555555555555',
    status: 'pending',
    submitted_at: '2027-04-20T00:00:00.000Z',
    approved_at: null,
    notes: null,
  }
  const readiness = {
    checks: checks('pending_review'),
    overall: {
      state: 'awaiting_committee',
      player_actions_complete: true,
      awaiting_committee: true,
      event_ready: false,
    },
  }

  const backend = await installMockBackend(page, backendOptions({ approval, readiness }))
  await backend.signIn('/player-hub')

  await expect(page.getByRole('heading', { name: 'Your actions are complete. Committee review is pending.' })).toBeVisible()
  await expect(page.getByText(/Under 18 Parental Consent.*submitted.*awaiting committee/i)).toBeVisible()
  await expect(page.getByRole('heading', { name: /You're all set for/i })).toHaveCount(0)
})

test('committee approval is visibly distinct from pending review and marks the event ready', async ({ page }) => {
  const approval = {
    id: '55555555-5555-4555-8555-555555555555',
    status: 'approved',
    submitted_at: '2027-04-20T00:00:00.000Z',
    approved_at: '2027-04-22T00:00:00.000Z',
    notes: null,
  }
  const readiness = {
    checks: checks('satisfied'),
    overall: {
      state: 'event_ready',
      player_actions_complete: true,
      awaiting_committee: false,
      event_ready: true,
    },
  }

  const backend = await installMockBackend(page, backendOptions({ approval, readiness }))
  await backend.signIn('/player-hub')

  await expect(page.getByRole('heading', { name: `You're all set for ${event.name}` })).toBeVisible()
  await expect(page.getByText(/Under 18 Parental Consent.*approved/i)).toBeVisible()
  await expect(page.getByText('Your actions are complete. Committee review is pending.')).toHaveCount(0)
})
