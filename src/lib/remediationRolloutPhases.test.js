import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import {
  EXPECTED_PROJECT_REF_ENV,
  EXPECTED_RELEASE_COMMIT_ENV,
  FORBIDDEN_PROJECT_REF_ENV,
  REMEDIATION_ROLLOUT_PHASES,
  migrationNamesThroughPhase,
  rolloutConfirmation,
  runRemediationRolloutPhase,
  validateProjectRefPair,
  validateReviewedReleaseState,
} from '../../scripts/run-remediation-rollout-phase.mjs'

describe('remediation rollout phases', () => {
  it('defines explicit legal, application, and final contract endpoints', () => {
    expect(REMEDIATION_ROLLOUT_PHASES.map(phase => [phase.id, phase.endpoint])).toEqual([
      ['legal-expand', '20260713041000'],
      ['application-cutover', '20260713065500'],
      ['admin-content-contract', '20260713066000'],
    ])
  })

  it('builds isolated manifests that cannot cross the selected checkpoint', () => {
    const legal = migrationNamesThroughPhase('legal-expand')
    const application = migrationNamesThroughPhase('application-cutover')
    const contract = migrationNamesThroughPhase('admin-content-contract')

    expect(basename(legal.at(-1))).toBe('20260713041000_add_masked_public_views.sql')
    expect(legal).not.toContain('20260713042000_make_legal_storage_private.sql')
    expect(basename(application.at(-1))).toBe('20260713065500_backup_run_concurrency_guard.sql')
    expect(application).not.toContain('20260713066000_admin_content_browser_contract.sql')
    expect(basename(contract.at(-1))).toBe('20260713066000_admin_content_browser_contract.sql')
    expect(legal.length).toBeLessThan(application.length)
    expect(application.length).toBeLessThan(contract.length)
  })

  it('keeps a phase request local unless dry-run or apply is explicit', () => {
    const messages = []
    const result = runRemediationRolloutPhase({
      argv: ['--phase', 'application-cutover'],
      environment: {},
      log: message => messages.push(message),
    })

    expect(result.planned).toBe(true)
    expect(messages.join('\n')).toContain('Local plan only')
  })

  it('requires an independently supplied project ref before a remote dry-run', () => {
    expect(() => runRemediationRolloutPhase({
      argv: ['--phase', 'legal-expand', '--environment', 'staging', '--dry-run'],
      environment: {},
      log: () => {},
    })).toThrow(`Set ${EXPECTED_PROJECT_REF_ENV}`)
  })

  it('uses unmistakable environment- and phase-specific apply confirmations', () => {
    expect(rolloutConfirmation('staging', 'legal-expand'))
      .toBe('APPLY-STAGING-LEGAL-EXPAND')
    expect(rolloutConfirmation('production', 'admin-content-contract'))
      .toBe('APPLY-PRODUCTION-ADMIN-CONTENT-CONTRACT')
  })

  it('requires independently supplied target and other-environment project refs', () => {
    expect(validateProjectRefPair(
      'abcdefghijklmnopqrst',
      '12345678901234567890',
    )).toEqual({
      expected: 'abcdefghijklmnopqrst',
      forbidden: '12345678901234567890',
    })
    expect(() => validateProjectRefPair(
      'abcdefghijklmnopqrst',
      'abcdefghijklmnopqrst',
    )).toThrow('must be different')
    expect(() => validateProjectRefPair(
      'abcdefghijklmnopqrst',
      '',
    )).toThrow(`Set ${FORBIDDEN_PROJECT_REF_ENV}`)
  })

  it('allows apply only from the exact reviewed commit and a clean tree', () => {
    const commit = 'a'.repeat(40)
    expect(() => validateReviewedReleaseState({
      expectedCommit: commit,
      headCommit: commit,
      statusPorcelain: '',
    })).not.toThrow()
    expect(() => validateReviewedReleaseState({
      expectedCommit: '',
      headCommit: commit,
      statusPorcelain: '',
    })).toThrow(`Set ${EXPECTED_RELEASE_COMMIT_ENV}`)
    expect(() => validateReviewedReleaseState({
      expectedCommit: commit,
      headCommit: 'b'.repeat(40),
      statusPorcelain: '',
    })).toThrow('HEAD does not match')
    expect(() => validateReviewedReleaseState({
      expectedCommit: commit,
      headCommit: commit,
      statusPorcelain: ' M migration.sql',
    })).toThrow('working tree must be clean')
  })

  it('makes populated-database legal and admin contracts fail closed', () => {
    const root = process.cwd()
    const legalContract = readFileSync(resolve(
      root,
      'supabase/migrations/20260713042000_make_legal_storage_private.sql',
    ), 'utf8')
    const adminContract = readFileSync(resolve(
      root,
      'supabase/migrations/20260713066000_admin_content_browser_contract.sql',
    ), 'utf8')

    expect(legalContract).toContain('LEGAL_STORAGE_CONTRACT_BLOCKED')
    expect(legalContract).toContain("object.bucket_id = 'legal-documents'")
    expect(adminContract).toContain('ADMIN_CONTENT_CONTRACT_BLOCKED')
    expect(adminContract).toContain('public.admin_content_mutation_audit')
  })

  it('keeps the deployed phase-one legal route dependencies inside legal expansion', () => {
    const root = process.cwd()
    const profileGuardExpansion = readFileSync(resolve(
      root,
      'supabase/migrations/20260713012000_team_profile_write_guards.sql',
    ), 'utf8')
    const legalExpansion = readFileSync(resolve(
      root,
      'supabase/migrations/20260713040000_add_legal_document_integrity.sql',
    ), 'utf8')
    const adminEventRoute = readFileSync(resolve(root, 'api/admin/event.js'), 'utf8')
    const serverAuth = readFileSync(resolve(root, 'api/_lib/auth.js'), 'utf8')

    expect(adminEventRoute).toContain("'reconcile_legal_document_publication'")
    expect(legalExpansion).toContain(
      'CREATE OR REPLACE FUNCTION public.reconcile_legal_document_publication',
    )
    expect(serverAuth).toContain(".select('roles, suspended, access_revoked_at')")
    expect(profileGuardExpansion).toContain(
      'ADD COLUMN IF NOT EXISTS access_revoked_at timestamptz',
    )
    expect(profileGuardExpansion).toContain(
      'BEFORE UPDATE OF email, dob, access_revoked_at, access_revoked_by',
    )
  })

  it('preflights every known migration-stopping legacy data condition', () => {
    const inventory = readFileSync(resolve(
      process.cwd(),
      'supabase/verify/20260713_pre_remediation_inventory.sql',
    ), 'utf8')

    for (const check of [
      'duplicate_legal_document_file_paths',
      'competition_duplicate_accepted_memberships',
      'competition_membership_registration_mismatch',
      'duplicate_doubles_participant_years',
      'duplicate_triples_participant_years',
      'confirmed_doubles_missing_participant',
      'incoherent_triples_confirmation',
      'legal_acceptances_orphan_event_year',
      'legal_acceptances_missing_profile',
      'under_18_approvals_orphan_event_year',
      'under_18_approvals_missing_profile',
      'profiles_with_unknown_roles',
      'suspended_profiles_with_superadmin',
      'documents_with_cross_scope_category',
      'dynasties_with_invalid_category_years',
      'excess_running_backup_runs',
    ]) {
      expect(inventory, check).toContain(`'${check}'`)
    }
  })
})
