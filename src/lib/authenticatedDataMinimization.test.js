import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function source(relativeUrl) {
  return readFile(new URL(relativeUrl, import.meta.url), 'utf8')
}

describe('authenticated data minimization boundary', () => {
  it('removes broad base-table reads and grants only safe own/legal columns', async () => {
    const migration = await source(
      '../../supabase/migrations/20260713060000_authenticated_data_minimization.sql',
    )
    const verify = await source(
      '../../supabase/verify/20260713060000_authenticated_data_minimization_verify.sql',
    )

    for (const table of ['zltac_events', 'teams', 'legal_documents', 'zltac_registrations']) {
      expect(migration).toMatch(new RegExp(
        `REVOKE SELECT ON TABLE public\\.${table} FROM authenticated`, 'i',
      ))
    }
    expect(migration).toContain('public.own_zltac_teams')
    expect(migration).toMatch(/DROP POLICY IF EXISTS "zltac_registrations_committee_read"/)
    expect(verify).toContain("'bank_bsb', 'bank_account_number', 'bank_account_name', 'payments_override'")
    expect(verify).toContain("'file_path', 'uploaded_by', 'uploaded_at', 'notes', 'created_at', 'updated_at'")
    expect(verify).toContain("'admin_note', 'admin_override_coc'")
  })

  it('routes browser discovery, legal publications, ownership, and bank details through scoped surfaces', async () => {
    const [playerHub, eventPage, captainHub, navBar, playerDashboard] = await Promise.all([
      source('../pages/PlayerHub.jsx'),
      source('../pages/EventPage.jsx'),
      source('../pages/CaptainHub.jsx'),
      source('../components/NavBar.jsx'),
      source('../pages/PlayerDashboard.jsx'),
    ])

    for (const file of [playerHub, eventPage, captainHub, navBar, playerDashboard]) {
      expect(file).not.toContain(".from('zltac_events')")
      expect(file).not.toContain(".from('teams')")
      expect(file).not.toContain(".from('legal_documents')")
    }
    expect(playerHub).toContain(".from('public_zltac_events')")
    expect(playerHub).toContain('/api/public?resource=required-documents')
    expect(playerHub).toContain('/api/player?resource=payment-instructions&year=')
    expect(playerHub).not.toMatch(/registration\?\.admin_note|registration\?\.admin_override/)
    expect(eventPage).toContain(".from('own_zltac_teams')")
    expect(captainHub).toContain(".from('own_zltac_teams')")
    expect(navBar).toContain(".from('own_zltac_teams')")
  })

  it('uses alias-only opaque partner selections and rejects the UUID mutation contract', async () => {
    const [playerApi, playerHub, profilesApi] = await Promise.all([
      source('../../api/player.js'),
      source('../pages/PlayerHub.jsx'),
      source('../../api/profiles.js'),
    ])

    expect(playerApi).toContain('ZLTAC_DOUBLES_PARTNER')
    expect(playerApi).toContain('ZLTAC_TRIPLES_PARTNER')
    expect(playerApi).toContain("scope: partnerScope(eventYear)")
    expect(playerApi).toContain(".ilike('alias', `%${safeTerm}%`)")
    expect(playerApi).not.toMatch(/select\('id, first_name, last_name, alias, state, roles'\)/)
    expect(playerHub).toContain('partnerHandle: profile.handle')
    expect(playerHub).not.toContain('partnerId: pid')
    expect(profilesApi).toContain('const MAX_PROFILE_IDS = 50')
    expect(profilesApi).toContain(".select('id, alias')")
    expect(profilesApi).toContain(".from('doubles_pairs')")
    expect(profilesApi).toContain(".from('triples_teams')")
  })
})
