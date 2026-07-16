import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Outlet, Route, Routes, useOutletContext } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'committee-user' },
    profile: { roles: ['superadmin'] },
    loading: false,
    profileLoading: false,
    profileError: null,
    refreshProfile: vi.fn(),
  }),
}))

import CommitteeRoute from './CommitteeRoute'

function AdminLayoutProbe() {
  return <Outlet context={{ role: 'superadmin', userRoles: ['superadmin'], managedCompetitions: [] }} />
}

function ContextProbe() {
  const context = useOutletContext()
  return <span>{context?.userRoles?.join(',') ?? 'missing-context'}</span>
}

describe('CommitteeRoute', () => {
  it('forwards the parent outlet context to guarded child routes', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/admin/users']}>
        <Routes>
          <Route path="/admin" element={<AdminLayoutProbe />}>
            <Route element={<CommitteeRoute />}>
              <Route path="users" element={<ContextProbe />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(html).toContain('superadmin')
    expect(html).not.toContain('missing-context')
  })
})
