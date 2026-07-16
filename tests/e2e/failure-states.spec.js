import { expect, test } from '@playwright/test'
import { installMockBackend } from './support/mockBackend.js'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const EVENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TEAM_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const event = {
  id: EVENT_ID,
  name: 'Retryable ZLTAC',
  year: 2028,
  status: 'open',
  start_date: '2028-10-01',
  timezone: 'Australia/Sydney',
  reg_close_date: '2028-09-01T00:00:00.000Z',
  event_starts_at: '2028-10-01T00:00:00.000Z',
  require_ref_test: true,
  require_coc: true,
  require_payment: true,
}

const teamRow = {
  id: TEAM_ID,
  event_id: EVENT_ID,
  captain_id: USER_ID,
  name: 'Recovered Team',
  state: 'VIC',
  home_venue: null,
  colour: '#00FF41',
  status: 'draft',
  rejection_reason: null,
  logo_url: null,
}

test('Team Hub replaces a failed readiness load with an explicit retry and recovers', async ({ page }) => {
  let readinessAttempts = 0
  let successfulAttempts = 0
  let allowRecovery = false
  const backend = await installMockBackend(page, {
    restTables: {
      public_zltac_events: event,
      own_zltac_teams: teamRow,
    },
    apiResponses: {
      '/api/captain': () => {
        readinessAttempts += 1
        if (!allowRecovery) {
          return {
            mockStatus: 503,
            mockBody: { error: 'Readiness service is temporarily unavailable' },
          }
        }
        successfulAttempts += 1
        return {
          event: { id: EVENT_ID, year: event.year },
          team: { id: TEAM_ID },
          registrations: [],
          profiles: [],
          readinessByUser: {},
        }
      },
    },
  })

  await backend.signIn('/captain-hub')

  await expect(page.getByRole('heading', { name: 'Could not load Team Hub' })).toBeVisible()
  await expect(page.getByText('Readiness service is temporarily unavailable')).toBeVisible()

  const attemptsBeforeRetry = readinessAttempts
  allowRecovery = true
  await page.getByRole('button', { name: 'Try again' }).click()

  await expect(page.getByRole('heading', { name: teamRow.name })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Could not load Team Hub' })).toHaveCount(0)
  expect(readinessAttempts).toBeGreaterThan(attemptsBeforeRetry)
  expect(successfulAttempts).toBeGreaterThanOrEqual(1)
})
