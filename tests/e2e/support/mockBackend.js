import { expect } from '@playwright/test'
import { Buffer } from 'node:buffer'

const SUPABASE_ORIGIN = 'http://127.0.0.1:54321'
const USER_ID = '11111111-1111-4111-8111-111111111111'

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function accessToken() {
  const now = Math.floor(Date.now() / 1000)
  return [
    base64Url({ alg: 'HS256', typ: 'JWT' }),
    base64Url({
      aud: 'authenticated',
      exp: now + 3600,
      iat: now,
      role: 'authenticated',
      sub: USER_ID,
      email: 'e2e@example.test',
    }),
    'e2e-signature',
  ].join('.')
}

function authUser() {
  const now = new Date().toISOString()
  return {
    id: USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'e2e@example.test',
    email_confirmed_at: now,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: now,
    updated_at: now,
  }
}

function sessionPayload() {
  return {
    access_token: accessToken(),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'e2e-refresh-token',
    user: authUser(),
  }
}

async function json(route, value, status = 200, headers = {}) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(value),
    headers,
  })
}

function defaultCompetition() {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'demo',
    name: 'Demo Competition',
    start_date: '2027-03-01',
    end_date: '2027-03-02',
    registration_open_at: '2026-01-01T00:00:00.000Z',
    registration_close_at: '2028-01-01T00:00:00.000Z',
    price_per_player: 4500,
    description: 'A safe public competition.',
    links: [],
    banner_url: null,
  }
}

/**
 * Install deterministic Supabase and API mocks before the first navigation.
 * The auth session starts signed out. Calling signIn() exercises the real
 * Login component and Supabase client's password flow.
 */
export async function installMockBackend(page, options = {}) {
  const roles = options.roles ?? ['player']
  const managedCompetitions = options.managedCompetitions ?? []
  const failures = new Set(options.failures ?? [])
  const restTables = options.restTables ?? {}
  const apiResponses = options.apiResponses ?? {}
  const competition = { ...defaultCompetition(), ...(options.competition ?? {}) }
  const roster = options.roster ?? { competition, teams: [], unteamed_players: [] }
  const requests = { rest: [], api: [] }

  const profile = {
    id: USER_ID,
    first_name: 'E2E',
    last_name: 'User',
    alias: 'RouteTester',
    dob: '1990-01-01',
    phone: null,
    state: 'NSW',
    home_arena: null,
    emergency_contact_name: null,
    emergency_contact_phone: null,
    avatar_url: null,
    roles,
    suspended: false,
    created_at: '2026-01-01T00:00:00.000Z',
  }

  await page.route(`${SUPABASE_ORIGIN}/**`, async route => {
    const request = route.request()
    const url = new URL(request.url())

    if (url.pathname === '/auth/v1/token') {
      return json(route, sessionPayload())
    }
    if (url.pathname === '/auth/v1/user') {
      return json(route, authUser())
    }
    if (url.pathname === '/auth/v1/logout') {
      return route.fulfill({ status: 204, body: '' })
    }

    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.split('/').pop()
      const accept = request.headers().accept ?? ''
      const wantsObject = accept.includes('application/vnd.pgrst.object+json')

      requests.rest.push({
        method: request.method(),
        table,
        url: `${url.pathname}${url.search}`,
      })

      if (request.method() === 'HEAD') {
        return route.fulfill({ status: 200, headers: { 'content-range': '*/0' }, body: '' })
      }
      if (table === 'profiles') {
        if (options.profileDelayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, options.profileDelayMs))
        }
        return json(route, wantsObject ? profile : [profile], 200, { 'content-range': '0-0/1' })
      }
      if (table === 'cms_global') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: wantsObject ? 'null' : '[]' })
      }
      if (Object.hasOwn(restTables, table)) {
        const configured = typeof restTables[table] === 'function'
          ? await restTables[table]({ request, url, wantsObject })
          : restTables[table]
        const value = wantsObject
          ? (Array.isArray(configured) ? (configured[0] ?? null) : configured)
          : (Array.isArray(configured) ? configured : configured == null ? [] : [configured])
        const count = Array.isArray(value) ? value.length : value == null ? 0 : 1
        return json(route, value, 200, { 'content-range': count > 0 ? `0-${count - 1}/${count}` : '*/0' })
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: wantsObject ? 'null' : '[]',
        headers: { 'content-range': '*/0' },
      })
    }

    return json(route, { message: 'not found' }, 404)
  })

  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const key = `${url.pathname}${url.search}`
    let body = null
    try {
      body = request.postData() ? request.postDataJSON() : null
    } catch {
      body = request.postData()
    }
    requests.api.push({ method: request.method(), url: key, body })

    const pathFailure = failures.has(url.pathname)
    const exactFailure = failures.has(key)
    if (pathFailure || exactFailure) {
      return json(route, { error: 'Simulated upstream failure' }, 503)
    }

    const responseKey = Object.hasOwn(apiResponses, key)
      ? key
      : Object.hasOwn(apiResponses, url.pathname) ? url.pathname : null
    if (responseKey) {
      const configured = typeof apiResponses[responseKey] === 'function'
        ? await apiResponses[responseKey]({ request, url, body })
        : apiResponses[responseKey]
      if (configured?.mockStatus) {
        return json(route, configured.mockBody ?? {}, configured.mockStatus)
      }
      return json(route, configured ?? {})
    }

    if (url.pathname === '/api/superadmin/my-competitions') {
      return json(route, managedCompetitions)
    }
    if (url.pathname === '/api/public' && url.searchParams.get('resource') === 'competitions') {
      if (url.searchParams.get('slug')) return json(route, competition)
      return json(route, { main_events: [], competitions: [competition] })
    }
    if (url.pathname === '/api/public' && url.searchParams.get('resource') === 'roster') {
      return json(route, roster)
    }
    if (url.pathname === '/api/profiles') {
      return json(route, {
        profiles: [{
          id: USER_ID,
          alias: profile.alias,
          first_name: profile.first_name,
          last_name: profile.last_name,
          alsa_membership: { current: null, most_recent: null },
        }],
      })
    }

    return json(route, {})
  })

  return {
    userId: USER_ID,
    profile,
    competition,
    requests,
    async signIn(target = '/dashboard') {
      await page.goto(`/login?redirect=${encodeURIComponent(target)}`)
      await page.getByLabel('Email').fill('e2e@example.test')
      await page.getByLabel('Password').fill('CorrectHorseBatteryStaple1!')
      await Promise.all([
        page.waitForURL(url => !url.pathname.endsWith('/login')),
        page.getByRole('button', { name: 'Sign In' }).click(),
      ])
    },
    async expectSignedIn() {
      await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible()
    },
  }
}
