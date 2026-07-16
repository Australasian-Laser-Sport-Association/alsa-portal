import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function source(relativeUrl) {
  return (await readFile(new URL(relativeUrl, import.meta.url), 'utf8'))
    .replace(/\r\n?/g, '\n')
}

describe('masked public database surfaces', () => {
  it('defines explicit safe discovery, team, and roster views', async () => {
    const migration = await source(
      '../../supabase/migrations/20260713041000_add_masked_public_views.sql',
    )

    expect(migration).toContain('public.public_zltac_events')
    expect(migration).toContain('public.public_competitions')
    expect(migration).toContain('public.public_zltac_teams')
    expect(migration).toContain('public.public_event_roster')
    expect(migration).toContain('public.public_competition_roster_safe')
    expect(migration).toMatch(/security_barrier\s*=\s*true/gi)

    const competitionView = migration.split(
      'CREATE OR REPLACE VIEW public.public_competitions',
    )[1].split('CREATE OR REPLACE VIEW public.public_zltac_teams')[0]
    expect(competitionView).not.toMatch(/c\.bank_|c\.created_by|c\.abbreviation/)

    const rosterView = migration.split(
      'CREATE OR REPLACE VIEW public.public_competition_roster_safe',
    )[1]
    const rosterProjection = rosterView.split(
      'FROM public.competition_registrations AS r',
    )[0]
    expect(rosterProjection).not.toMatch(
      /\bp\.id\b|\bp\.first_name\b|\bp\.last_name\b|\br\.user_id\b/,
    )
    expect(rosterView).toMatch(/p\.alias/)
    expect(rosterView).toMatch(/t\.status\s*=\s*'approved'/)
    expect(rosterView).toMatch(/tm\.invite_status\s*=\s*'accepted'/)

    const compatibilityView = migration.split(
      'CREATE OR REPLACE VIEW public.public_competition_roster\n',
    )[1]
    expect(compatibilityView).toMatch(/NULL::uuid AS user_id/)
    expect(compatibilityView).toMatch(/NULL::text AS first_name/)
    expect(compatibilityView).toMatch(/NULL::text AS last_name/)
  })

  it('revokes anonymous base-table reads and the legacy PII roster', async () => {
    const migration = await source(
      '../../supabase/migrations/20260713043000_revoke_public_base_table_access.sql',
    )

    for (const table of ['zltac_events', 'competitions', 'teams', 'legal_documents']) {
      expect(migration).toMatch(
        new RegExp(`REVOKE SELECT ON public\\.${table} FROM anon`, 'i'),
      )
    }
    expect(migration).toMatch(
      /REVOKE ALL ON public\.public_competition_roster FROM anon, authenticated/i,
    )
  })

  it('ships matching verification and fail-closed rollback boundaries', async () => {
    const [viewVerify, viewRollback, revokeVerify, revokeRollback] = await Promise.all([
      source('../../supabase/verify/20260713041000_add_masked_public_views_verify.sql'),
      source('../../supabase/rollback/20260713041000_add_masked_public_views_rollback.sql'),
      source('../../supabase/verify/20260713043000_revoke_public_base_table_access_verify.sql'),
      source('../../supabase/rollback/20260713043000_revoke_public_base_table_access_rollback.sql'),
    ])

    expect(viewVerify).toContain('public_competition_roster_safe')
    expect(viewRollback).toContain('ROLL_FORWARD_ONLY_SECURITY_BOUNDARY')
    expect(viewRollback).toMatch(/RAISE EXCEPTION/)
    expect(viewRollback).not.toMatch(/DROP VIEW|CREATE VIEW|GRANT\s+SELECT/i)
    expect(revokeVerify).toContain("has_table_privilege('anon'")
    expect(revokeRollback).toContain('ROLL_FORWARD_ONLY_SECURITY_BOUNDARY')
    expect(revokeRollback).toMatch(/RAISE EXCEPTION/)
    expect(revokeRollback).not.toMatch(/GRANT\s+SELECT|CREATE\s+POLICY/i)
  })
})

describe('public-page consumers', () => {
  it('reads event discovery and display data through masked views', async () => {
    const [home, currentEvent, eventPage] = await Promise.all([
      source('../pages/Home.jsx'),
      source('../hooks/useCurrentEvent.js'),
      source('../pages/EventPage.jsx'),
    ])

    expect(home).toContain(".from('public_zltac_events')")
    expect(currentEvent).toContain(".from('public_zltac_events')")
    expect(eventPage).toContain(".from('public_zltac_events')")
    expect(eventPage).toContain(".from('public_zltac_teams')")
    expect(eventPage).not.toContain(".from('zltac_events')")

    expect(eventPage).toContain(".from('own_zltac_teams')")
    expect(eventPage).not.toContain(".from('teams')")
  })

  it('renders the public competition roster using aliases only', async () => {
    const [detail, publicApi] = await Promise.all([
      source('../pages/public/CompetitionDetail.jsx'),
      source('../../api/public.js'),
    ])
    expect(detail).not.toMatch(/player\.first_name|player\.last_name|fullName\(/)
    expect(detail).toMatch(/player\.alias/)
    expect(publicApi).toContain(".from('public_competition_roster_safe')")
    expect(publicApi).toContain(".from('public_competitions')")
    expect(publicApi).toContain(".from('public_zltac_events')")
    expect(publicApi).toMatch(/player1_alias/)
  })

  it('projects only display fields from public document tables', async () => {
    const [resources, adminDocuments] = await Promise.all([
      source('../pages/Resources.jsx'),
      source('../pages/admin/AdminDocuments.jsx'),
    ])

    for (const consumer of [resources, adminDocuments]) {
      expect(consumer).toContain(
        ".from('document_categories').select('id, scope, name, sort_order')",
      )
      expect(consumer).toContain(
        ".from('documents').select('id, scope, category_id, name, url, description, sort_order')",
      )
      expect(consumer).not.toContain(".select('*')")
    }
  })
})
