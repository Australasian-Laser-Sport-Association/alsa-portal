import { expect, test } from '@playwright/test'
import { installMockBackend } from './support/mockBackend.js'

const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const event = {
  id: EVENT_ID,
  name: 'Safeguarding Championship',
  year: 2027,
  status: 'open',
  start_date: '2027-10-01',
  end_date: '2027-10-03',
  timezone: 'Australia/Sydney',
  reg_open_date: '2027-01-01T00:00:00.000Z',
  reg_close_date: '2027-09-01T00:00:00.000Z',
  event_starts_at: '2027-10-01T00:00:00.000Z',
  side_events: [],
  photo_urls: [],
  main_fee: 5000,
  team_fee: 1000,
  dinner_guest_price: 6500,
  processing_fee_pct: 2.5,
}

const impactUrl = `/api/admin/event?resource=event-delete-impact&eventId=${EVENT_ID}`

function adminOptions(overrides = {}) {
  const eventEndpoint = '/api/admin/event?resource=event'
  const overriddenEventResponse = overrides.apiResponses?.[eventEndpoint]
  return {
    roles: ['player', 'zltac_committee'],
    restTables: { public_zltac_events: event },
    ...overrides,
    apiResponses: {
      ...(overrides.apiResponses ?? {}),
      [eventEndpoint]: async context => {
        if (context.request.method() === 'GET') return { event }
        if (typeof overriddenEventResponse === 'function') {
          return overriddenEventResponse(context)
        }
        return overriddenEventResponse ?? {}
      },
    },
  }
}

test('archive failure stays in the confirmation workflow and sends only the locked event id', async ({ page }) => {
  const backend = await installMockBackend(page, adminOptions({
    apiResponses: {
      '/api/admin/event?resource=event': {
        mockStatus: 503,
        mockBody: { error: 'Archive transaction unavailable' },
      },
    },
  }))
  await backend.signIn('/admin/event')

  await page.getByRole('button', { name: 'Archive Event', exact: true }).click()
  await expect(page.getByText(`Archive ${event.name} ${event.year}?`)).toBeVisible()
  await page.getByRole('button', { name: 'Archive event', exact: true }).click()

  await expect(page.getByText('Archive transaction unavailable')).toBeVisible()
  await expect(page.getByText(`Archive ${event.name} ${event.year}?`)).toBeVisible()

  const archiveCall = backend.requests.api.find(request => request.body?.action === 'archive')
  expect(archiveCall?.body).toEqual({ action: 'archive', eventId: EVENT_ID })
})

test('hard deletion is disabled when retained legal or under-18 evidence exists', async ({ page }) => {
  const backend = await installMockBackend(page, adminOptions({
    apiResponses: {
      [impactUrl]: {
        registrations: 12,
        teams: 3,
        legalAcceptances: 7,
        under18Approvals: 2,
        blockedByEvidence: true,
      },
    },
  }))
  await backend.signIn('/admin/event')

  await page.getByRole('button', { name: 'Delete Event', exact: true }).click()

  await expect(page.getByText(/Hard deletion is disabled because this event has 7 legal acceptances and 2 under-18 decisions/i)).toBeVisible()
  await expect(page.getByPlaceholder(`Type ${event.year}`)).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Delete event permanently' })).toBeDisabled()
  expect(backend.requests.api.some(request => request.body?.action === 'delete')).toBe(false)
})

test('confirmed deletion uses the dedicated event-id operation without a client-supplied year', async ({ page }) => {
  const backend = await installMockBackend(page, adminOptions({
    apiResponses: {
      [impactUrl]: {
        registrations: 0,
        teams: 0,
        legalAcceptances: 0,
        under18Approvals: 0,
        blockedByEvidence: false,
      },
      '/api/admin/event?resource=event': {},
    },
  }))
  await backend.signIn('/admin/event')

  await page.getByRole('button', { name: 'Delete Event', exact: true }).click()
  await page.getByPlaceholder(`Type ${event.year}`).fill(String(event.year))
  await page.getByRole('button', { name: 'Delete event permanently' }).click()

  await expect(page.getByText('Event deleted.')).toBeVisible()
  const deleteCall = backend.requests.api.find(request => request.body?.action === 'delete')
  expect(deleteCall?.body).toEqual({ action: 'delete', eventId: EVENT_ID })
})
