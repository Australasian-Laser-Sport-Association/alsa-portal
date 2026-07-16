import { expect, test } from '@playwright/test'
import { installMockBackend } from './support/mockBackend.js'

const managedCompetition = {
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'demo',
  name: 'Demo Competition',
  start_date: '2027-03-01',
  end_date: '2027-03-02',
  registration_open_at: null,
  registration_close_at: null,
}

test('committee can enter a guarded admin route', async ({ page }) => {
  const backend = await installMockBackend(page, { roles: ['player', 'alsa_committee'] })
  await backend.signIn('/admin/event')

  await expect(page).toHaveURL(/\/admin\/event$/)
  await expect(page.getByText('Admin Panel', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Event Settings' })).toBeVisible()
})

test('committee deep links wait for a delayed role profile after sign-in', async ({ page }) => {
  const backend = await installMockBackend(page, {
    roles: ['player', 'alsa_committee'],
    profileDelayMs: 400,
  })
  await backend.signIn('/admin/event')

  await expect(page).toHaveURL(/\/admin\/event$/)
  await expect(page.getByText('Admin Panel', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/event$/)
})

test('a regular player is rejected from committee routes', async ({ page }) => {
  const backend = await installMockBackend(page, { roles: ['player'] })
  await backend.signIn('/admin/event')

  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByText('Admin Panel', { exact: true })).toHaveCount(0)
})

test('an assigned manager can enter the manager hub', async ({ page }) => {
  const backend = await installMockBackend(page, {
    roles: ['player'],
    managedCompetitions: [managedCompetition],
  })
  await backend.signIn('/manage')

  await expect(page).toHaveURL(/\/manage$/)
  await expect(page.getByRole('heading', { name: 'Manager Hub' })).toBeVisible()
  await expect(page.locator('a[href="/manage/competitions/demo"]')).toBeVisible()
})

test('manager access-check failure is explicit and retryable', async ({ page }) => {
  const backend = await installMockBackend(page, {
    roles: ['player'],
    failures: ['/api/superadmin/my-competitions'],
  })
  await backend.signIn('/manage/competitions/demo')

  await expect(page).toHaveURL(/\/manage\/competitions\/demo$/)
  await expect(page.getByText('Could not verify manager access')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
})
