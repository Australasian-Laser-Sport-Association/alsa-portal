import { expect, test } from '@playwright/test'
import { installMockBackend } from './support/mockBackend.js'

test('public competition roster renders aliases but not supplied identity or bank fields', async ({ page }) => {
  const leakedProfileId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  await installMockBackend(page, {
    competition: {
      bank_account_name: 'Should Never Render',
      bank_bsb: '123-456',
      bank_account_number: '987654321',
    },
    roster: {
      teams: [{
        id: 'team-public-1',
        name: 'Green Team',
        colour: '#00ff41',
        captain: {
          alias: 'Alpha',
          first_name: 'Alice',
          last_name: 'Sensitive',
          user_id: leakedProfileId,
        },
        members: [],
      }],
      unteamed_players: [],
    },
  })

  await page.goto('/competitions/demo')

  await expect(page.getByText('Green Team')).toBeVisible()
  await expect(page.getByText('"Alpha"')).toBeVisible()
  await expect(page.getByText('Alice')).toHaveCount(0)
  await expect(page.getByText('Sensitive')).toHaveCount(0)
  await expect(page.getByText(leakedProfileId)).toHaveCount(0)
  await expect(page.getByText('987654321')).toHaveCount(0)
})

test('public roster failure shows a retry control instead of an endless loader', async ({ page }) => {
  await installMockBackend(page, {
    failures: ['/api/public?resource=roster&slug=demo'],
  })

  await page.goto('/competitions/demo')

  await expect(page.getByText('Could not load the roster right now. Please try again.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
})
