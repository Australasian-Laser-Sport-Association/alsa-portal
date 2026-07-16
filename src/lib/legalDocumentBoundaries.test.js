import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function source(relativeUrl) {
  return readFile(new URL(relativeUrl, import.meta.url), 'utf8')
}

describe('required-document trust boundaries', () => {
  it('keeps committee publication out of the browser Supabase client', async () => {
    const page = await source('../pages/admin/AdminRequiredDocuments.jsx')

    expect(page).toContain('/api/admin/event?resource=required-documents&action=publish')
    expect(page).not.toMatch(/\.from\(['"]legal_documents['"]\)/)
    expect(page).not.toMatch(/supabase\.storage/)
    expect(page).not.toMatch(/\.update\(|\.insert\(|\.remove\(/)
  })

  it('uses the public catalogue API from the ZLTAC resources page', async () => {
    const page = await source('../pages/Resources.jsx')
    expect(page).toContain('/api/public?resource=required-documents')
    expect(page).not.toContain('legal-documents')
  })

  it('uses an acknowledgement URL while preserving the legacy admin bookmark', async () => {
    const [app, layout, hub] = await Promise.all([
      source('../App.jsx'),
      source('../components/AdminLayout.jsx'),
      source('../pages/admin/AdminHub.jsx'),
    ])

    expect(app).toContain('path="player-acknowledgements"')
    expect(app).toContain('path="signed-documents" element={<Navigate to="/admin/player-acknowledgements" replace />}')
    expect(layout).toContain("to: '/admin/player-acknowledgements'")
    expect(hub).toContain("to: '/admin/player-acknowledgements'")
  })

  it('authorizes private asset delivery against active publication metadata', async () => {
    const publicApi = await source('../../api/public.js')
    expect(publicApi).toContain(".eq('file_path', path)")
    expect(publicApi).toContain(".eq('is_active', true)")
    expect(publicApi).toContain(".not('published_at', 'is', null)")
    expect(publicApi).toContain(".not('content_sha256', 'is', null)")
    expect(publicApi).toContain('.createSignedUrl(path, 60)')
  })

  it('publishes required documents through one service-only RPC', async () => {
    const [api, migration] = await Promise.all([
      source('../../api/admin/event.js'),
      source('../../supabase/migrations/20260713040000_add_legal_document_integrity.sql'),
    ])
    expect(api).toContain("'publish_legal_document'")
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.publish_legal_document[\s\S]*FROM PUBLIC, anon, authenticated/i)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.publish_legal_document[\s\S]*TO service_role/i)
  })

  it('does not retain a separate under-18 evidence UI after account deletion', async () => {
    const page = await source('../pages/admin/AdminUnder18Approvals.jsx')

    expect(page).not.toContain('selected.user_id == null')
    expect(page).not.toContain('<RetainedApprovalEvidence')
    expect(page).not.toContain('Retained anonymised evidence')
    expect(page).toContain('<ApprovalEditor')
  })
})
