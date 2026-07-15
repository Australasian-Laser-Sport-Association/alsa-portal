import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function source(relativeUrl) {
  return readFile(new URL(relativeUrl, import.meta.url), 'utf8')
}

describe('admin content browser boundaries', () => {
  it('moves privileged content reads and writes behind the committee API', async () => {
    const [documents, results, hallOfFame, referee, event, competition, siteSettings] = await Promise.all([
      source('../pages/admin/AdminDocuments.jsx'),
      source('../pages/admin/AdminZLTACResults.jsx'),
      source('../pages/admin/AdminZLTACHallOfFame.jsx'),
      source('../pages/admin/AdminRefereeTest.jsx'),
      source('../pages/admin/AdminEvent.jsx'),
      source('../components/competition/CompetitionEditForm.jsx'),
      source('./siteSettings.js'),
    ])
    const adminSources = [documents, results, hallOfFame, referee, event, competition, siteSettings].join('\n')

    for (const resource of ['document-content', 'history-content', 'referee-content', 'site-banner']) {
      expect(adminSources).toContain(`resource=${resource}`)
    }
    for (const table of ['document_categories', 'documents', 'cms_global']) {
      expect(adminSources).not.toMatch(
        new RegExp(`\\.from\\(['"]${table}['"]\\)\\s*\\.(insert|update|upsert|delete)`),
      )
    }
    for (const table of [
      'referee_questions', 'referee_test_settings', 'zltac_event_history',
      'zltac_event_placings', 'zltac_legends', 'zltac_dynasties',
      'zltac_hall_of_fame',
    ]) {
      expect(adminSources).not.toMatch(new RegExp(`\\.from\\(['"]${table}['"]\\)`))
    }

    const assetEditors = [results, referee, event, competition]
    for (const editor of assetEditors) {
      expect(editor).toContain('uploadAuthorizedAsset')
      expect(editor).not.toContain('supabase.storage')
    }
  })

  it('keeps public history, visible editorial content, and test settings on safe views', async () => {
    const [landing, yearDetail, hallOfFame, legends, refereeTest, playerHub] = await Promise.all([
      source('../pages/ZLTACLanding.jsx'),
      source('../pages/ZLTACYearDetail.jsx'),
      source('../components/zltac/HallOfFame.jsx'),
      source('../components/zltac/LegendsAndDynasties.jsx'),
      source('../pages/RefereeTest.jsx'),
      source('../pages/PlayerHub.jsx'),
    ])

    expect(`${landing}\n${yearDetail}`).toContain(".from('public_zltac_event_history')")
    expect(hallOfFame).toContain(".from('public_zltac_hall_of_fame')")
    expect(legends).toContain(".from('public_zltac_legends')")
    expect(legends).toContain(".from('public_zltac_dynasties')")
    expect(refereeTest).toContain(".from('public_referee_test_settings')")
    expect(playerHub).toContain(".from('public_referee_test_settings')")
    expect(`${refereeTest}\n${playerHub}`).not.toContain(".from('referee_test_settings')")
  })

  it('defines database-edge masking and denies browser writes', async () => {
    const [expandMigration, contractMigration] = await Promise.all([
      source('../../supabase/migrations/20260713065000_admin_content_write_cutover.sql'),
      source('../../supabase/migrations/20260713066000_admin_content_browser_contract.sql'),
    ])
    const historyView = expandMigration.split('CREATE OR REPLACE VIEW public.public_zltac_event_history')[1]
      .split('CREATE OR REPLACE VIEW public.public_zltac_legends')[0]

    expect(historyView).not.toContain('history.internal_notes')
    expect(expandMigration).toMatch(/public_zltac_legends[\s\S]*WHERE legend\.is_visible/)
    expect(expandMigration).toMatch(/public_zltac_dynasties[\s\S]*WHERE dynasty\.is_visible/)
    expect(expandMigration).toMatch(/public_zltac_hall_of_fame[\s\S]*WHERE inductee\.is_visible/)
    expect(expandMigration).toContain('public.public_referee_test_settings')
    expect(expandMigration).toContain('CREATE TABLE public.admin_asset_upload_audit')
    expect(expandMigration).toContain('admin_asset_upload_audit_immutable')
    expect(expandMigration).not.toMatch(/REVOKE INSERT, UPDATE, DELETE ON[\s\S]*public\.cms_global/)
    expect(contractMigration).toContain('ADMIN_ASSET_CONTRACT_BLOCKED')
    expect(contractMigration).toMatch(/count\(DISTINCT purpose\)[\s\S]*<> 8/)
    expect(contractMigration).toMatch(/REVOKE INSERT, UPDATE, DELETE ON[\s\S]*public\.cms_global[\s\S]*FROM anon, authenticated/)
    expect(contractMigration).toMatch(/REVOKE SELECT ON[\s\S]*public\.referee_questions[\s\S]*public\.referee_test_settings[\s\S]*FROM anon, authenticated/)
    for (const policy of [
      'event_logos_committee',
      'event_photos_committee',
      'event_covers_committee',
      'referee_test_media_committee',
      'competition_banners_write',
    ]) {
      expect(contractMigration).toContain(`DROP POLICY IF EXISTS ${policy} ON storage.objects`)
    }
  })
})
