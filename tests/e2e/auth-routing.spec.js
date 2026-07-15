import { expect, test } from '@playwright/test'
import { installMockBackend } from './support/mockBackend.js'

test('an unauthenticated deep link is preserved through sign-in', async ({ page }) => {
  const backend = await installMockBackend(page)
  const target = '/events/2027/player-register?source=e2e'

  await page.goto(target)
  await expect(page).toHaveURL(url => (
    url.pathname === '/login'
    && url.searchParams.get('redirect') === target
  ))

  await page.getByLabel('Email').fill('e2e@example.test')
  await page.getByLabel('Password').fill('CorrectHorseBatteryStaple1!')
  await page.getByRole('button', { name: 'Sign In' }).click()

  await expect(page).toHaveURL(url => url.pathname === '/events/2027/player-register' && url.searchParams.get('source') === 'e2e')
  expect(backend.userId).toBeTruthy()
})

test('a protocol-relative return target is rejected', async ({ page }) => {
  const backend = await installMockBackend(page)
  await backend.signIn('//evil.example.test/phish')
  await expect(page).toHaveURL(/\/dashboard$/)
})

test('an ordinary signed-in session cannot unlock password recovery', async ({ page }) => {
  const backend = await installMockBackend(page)
  await backend.signIn('/reset-password')

  await expect(page).toHaveURL(/\/reset-password$/)
  await expect(page.getByText(/must be opened from the password-reset email link/i)).toBeVisible({ timeout: 5_000 })
  await expect(page.getByLabel('New password')).toHaveCount(0)
})
