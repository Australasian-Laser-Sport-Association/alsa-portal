import { expect, test } from '@playwright/test'
import { installMockBackend } from './support/mockBackend.js'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const CURRENT_EVENT_ID = '66666666-6666-4666-8666-666666666666'
const HISTORIC_EVENT_ID = '77777777-7777-4777-8777-777777777777'

const currentEvent = {
  id: CURRENT_EVENT_ID,
  name: 'ZLTAC 2028',
  year: 2028,
  status: 'open',
  start_date: '2028-10-01',
  timezone: 'Australia/Sydney',
  reg_close_date: '2028-09-01T00:00:00.000Z',
  event_starts_at: '2028-10-01T00:00:00.000Z',
  require_ref_test: true,
  require_coc: true,
  require_payment: true,
  committee_email: 'committee@example.test',
}

const currentTeam = {
  id: '88888888-8888-4888-8888-888888888888',
  event_id: CURRENT_EVENT_ID,
  captain_id: USER_ID,
  name: 'Current Event Team',
  state: 'NSW',
  home_venue: 'Current Arena',
  colour: '#00FF41',
  status: 'draft',
  rejection_reason: null,
  logo_url: null,
}

const historicTeam = {
  id: '99999999-9999-4999-8999-999999999999',
  event_id: HISTORIC_EVENT_ID,
  captain_id: USER_ID,
  name: 'Historic Team That Must Not Leak',
  status: 'approved',
}

function requestedEventId(url) {
  return url.searchParams.get('event_id')
}

test('Team Hub resolves the active event first and loads only its team', async ({ page }) => {
  const backend = await installMockBackend(page, {
    restTables: {
      public_zltac_events: currentEvent,
      own_zltac_teams: ({ url }) => requestedEventId(url) === `eq.${CURRENT_EVENT_ID}`
        ? currentTeam
        : historicTeam,
    },
    apiResponses: {
      '/api/captain': {
        event: { id: CURRENT_EVENT_ID, year: currentEvent.year },
        team: { id: currentTeam.id },
        registrations: [],
        profiles: [],
        readinessByUser: {},
      },
    },
  })

  await backend.signIn('/captain-hub')

  await expect(page.getByRole('heading', { name: currentTeam.name })).toBeVisible()
  await expect(page.getByText(historicTeam.name)).toHaveCount(0)

  const teamQuery = backend.requests.rest.find(request => (
    request.table === 'own_zltac_teams'
    && request.url.includes(`event_id=eq.${CURRENT_EVENT_ID}`)
  ))
  expect(teamQuery?.url).toContain(`event_id=eq.${CURRENT_EVENT_ID}`)
})

test('a historic captain team does not block registration for the requested event year', async ({ page }) => {
  const backend = await installMockBackend(page, {
    restTables: {
      public_zltac_events: currentEvent,
      own_zltac_teams: ({ url }) => requestedEventId(url) === `eq.${CURRENT_EVENT_ID}`
        ? null
        : historicTeam,
    },
  })

  await backend.signIn('/events/2028/captain-register')

  await expect(page).toHaveURL(/\/events\/2028\/captain-register$/)
  await expect(page.getByRole('heading', { name: 'Captain Registration' })).toBeVisible()

  const teamQuery = backend.requests.rest.find(request => (
    request.table === 'own_zltac_teams'
    && request.url.includes(`event_id=eq.${CURRENT_EVENT_ID}`)
  ))
  expect(teamQuery?.url).toContain(`event_id=eq.${CURRENT_EVENT_ID}`)
})
