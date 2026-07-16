import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it, vi } from 'vitest'
import {
  CHECKED_RELEASE_VARIABLES,
  formatIsolationFingerprintPayload,
} from '../../scripts/check-release-environment.mjs'
import {
  identicalCrossScopeVariables,
  parseIsolationFingerprintOutput,
  parseVercelReleaseArguments,
  rootDotenvOverrides,
  runGuardedVercelEnvironmentCheck,
  sanitizedVercelParentEnvironment,
  vercelProcessInvocation,
} from '../../scripts/run-vercel-release-environment-check.mjs'

const PRODUCTION_REF = 'abcdefghijklmnopqrst'
const STAGING_REF = 'bcdefghijklmnopqrstu'
const FINGERPRINT_KEY = 'release-isolation-test-key-material'

function providerEnvironment(suffix) {
  return {
    SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${suffix}_service_role_material`,
    UPSTASH_REDIS_REST_URL: `https://redis-${suffix}.upstash.io`,
    UPSTASH_REDIS_REST_TOKEN: `upstash-token-${suffix}-with-sufficient-entropy`,
    RESEND_API_KEY: `re_provider_${suffix}_key_material`,
    CRON_SECRET: `cron-${suffix}-${'x'.repeat(40)}`,
    VITE_SENTRY_DSN: `https://browser-${suffix}@o1.ingest.sentry.io/1`,
    SENTRY_DSN: `https://server-${suffix}@o1.ingest.sentry.io/2`,
  }
}

function successfulGuardedSpawn(targetEnvironment, comparisonEnvironment) {
  let call = 0
  return vi.fn(() => {
    call += 1
    if (call === 1) return { status: 0 }
    const environment = call === 2 ? targetEnvironment : comparisonEnvironment
    return {
      status: 0,
      stdout: formatIsolationFingerprintPayload(environment, FINGERPRINT_KEY),
      stderr: '',
    }
  })
}

describe('guarded Vercel release environment runner', () => {
  it('removes every inspected parent value while preserving independent boundaries', () => {
    const parent = Object.fromEntries(CHECKED_RELEASE_VARIABLES.map(name => [name, `local-${name}`]))
    parent.UNRELATED = 'retained'
    parent.ALSA_EXPECTED_SUPABASE_PROJECT_REF = 'stale'
    parent.VERCEL_ORG_ID = 'wrong-org'
    parent.VERCEL_PROJECT_ID = 'wrong-project'

    const sanitized = sanitizedVercelParentEnvironment(parent, {
      expected: PRODUCTION_REF,
      forbidden: [STAGING_REF],
    })

    for (const name of CHECKED_RELEASE_VARIABLES) expect(sanitized[name]).toBeUndefined()
    expect(sanitized.UNRELATED).toBe('retained')
    expect(sanitized.VERCEL_ORG_ID).toBeUndefined()
    expect(sanitized.VERCEL_PROJECT_ID).toBeUndefined()
    expect(sanitized.ALSA_EXPECTED_SUPABASE_PROJECT_REF).toBe(PRODUCTION_REF)
    expect(sanitized.ALSA_FORBIDDEN_SUPABASE_PROJECT_REFS).toBe(STAGING_REF)
  })

  it('runs the checker inside the selected remote scope without putting refs in arguments', () => {
    const spawn = successfulGuardedSpawn(
      providerEnvironment('preview'),
      providerEnvironment('production'),
    )
    const result = runGuardedVercelEnvironmentCheck({
      argv: [
        '--target', 'preview',
        '--git-branch', 'codex/release-check',
        '--expected-supabase-project-ref', STAGING_REF,
        '--forbid-supabase-project-ref', PRODUCTION_REF,
      ],
      environment: { VITE_SUPABASE_URL: 'https://local-override.invalid' },
      dotenvOverrides: [],
      linkedProject: true,
      spawn,
      platform: 'linux',
      fingerprintKey: FINGERPRINT_KEY,
    })

    expect(result).toEqual({ target: 'preview', checked: true })
    const [, args, configuration] = spawn.mock.calls[0]
    expect(args).toEqual([
      'env', 'run', '-e', 'preview',
      '--git-branch', 'codex/release-check',
      '--', 'node', 'scripts/check-release-environment.mjs', '--target', 'preview',
    ])
    expect(args.join(' ')).not.toContain(PRODUCTION_REF)
    expect(args.join(' ')).not.toContain(STAGING_REF)
    expect(configuration.env.VITE_SUPABASE_URL).toBeUndefined()
    expect(configuration.env.ALSA_EXPECTED_SUPABASE_PROJECT_REF).toBe(STAGING_REF)

    const [, previewFingerprintArgs] = spawn.mock.calls[1]
    expect(previewFingerprintArgs).toEqual(expect.arrayContaining([
      'env', 'run', '-e', 'preview', '--git-branch', 'codex/release-check',
      '--emit-isolation-fingerprints',
    ]))
    const [, productionFingerprintArgs] = spawn.mock.calls[2]
    expect(productionFingerprintArgs).toEqual(expect.arrayContaining([
      'env', 'run', '-e', 'production', '--emit-isolation-fingerprints',
    ]))
    expect(productionFingerprintArgs).not.toContain('--git-branch')
  })

  it('fails when provider values overlap across Preview and Production without reporting values', () => {
    const shared = providerEnvironment('shared-sensitive-value')
    const spawn = successfulGuardedSpawn(shared, shared)

    let failure
    try {
      runGuardedVercelEnvironmentCheck({
        argv: [
          '--target', 'production',
          '--expected-supabase-project-ref', PRODUCTION_REF,
          '--forbid-supabase-project-ref', STAGING_REF,
        ],
        environment: {},
        dotenvOverrides: [],
        linkedProject: true,
        spawn,
        platform: 'linux',
        fingerprintKey: FINGERPRINT_KEY,
      })
    } catch (error) {
      failure = error
    }

    expect(failure?.message).toContain('UPSTASH_REDIS_REST_URL')
    expect(failure?.message).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(failure?.message).toContain('UPSTASH_REDIS_REST_TOKEN')
    expect(failure?.message).toContain('RESEND_API_KEY')
    expect(failure?.message).toContain('CRON_SECRET')
    expect(failure?.message).toContain('VITE_SENTRY_DSN/SENTRY_DSN')
    for (const value of Object.values(shared)) {
      expect(failure?.message).not.toContain(value)
    }
  })

  it('detects a Sentry DSN reused under the other server/browser key', () => {
    const target = providerEnvironment('target')
    const comparison = providerEnvironment('comparison')
    comparison.SENTRY_DSN = target.VITE_SENTRY_DSN

    const targetFingerprints = parseIsolationFingerprintOutput(
      formatIsolationFingerprintPayload(target, FINGERPRINT_KEY),
    )
    const comparisonFingerprints = parseIsolationFingerprintOutput(
      formatIsolationFingerprintPayload(comparison, FINGERPRINT_KEY),
    )

    expect(identicalCrossScopeVariables(targetFingerprints, comparisonFingerprints)).toEqual([
      'VITE_SENTRY_DSN/SENTRY_DSN',
    ])
  })

  it('rejects malformed fingerprint evidence without echoing captured output', () => {
    const captured = 'provider-secret-that-must-not-be-reported'
    expect(() => parseIsolationFingerprintOutput(captured)).toThrow(
      'returned no fingerprint evidence',
    )
    try {
      parseIsolationFingerprintOutput(captured)
    } catch (error) {
      expect(error.message).not.toContain(captured)
    }
  })

  it('uses cmd.exe without shell argument concatenation on Windows', () => {
    const invocation = vercelProcessInvocation(['env', 'run', '-e', 'production'], {
      platform: 'win32',
      environment: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    })

    expect(invocation).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      arguments: ['/d', '/s', '/c', 'vercel', 'env', 'run', '-e', 'production'],
    })
  })

  it('refuses local dotenv precedence before invoking Vercel', () => {
    const spawn = vi.fn()
    expect(() => runGuardedVercelEnvironmentCheck({
      argv: [
        '--target', 'production',
        '--expected-supabase-project-ref', PRODUCTION_REF,
        '--forbid-supabase-project-ref', STAGING_REF,
      ],
      dotenvOverrides: ['.env.local'],
      linkedProject: true,
      spawn,
    })).toThrow('Root dotenv overrides are present')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('treats non-file dotenv names as overrides instead of trusting their type', () => {
    const root = mkdtempSync(join(tmpdir(), 'alsa-vercel-env-dir-'))
    try {
      mkdirSync(join(root, '.env.local'))
      expect(rootDotenvOverrides(root)).toEqual(['.env.local'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('rejects a symlinked root dotenv override', () => {
    const root = mkdtempSync(join(tmpdir(), 'alsa-vercel-env-link-'))
    try {
      writeFileSync(join(root, 'source'), 'VITE_SUPABASE_URL=https://override.invalid\n')
      symlinkSync('source', join(root, '.env.local'))
      expect(rootDotenvOverrides(root)).toEqual(['.env.local'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('requires explicit, distinct boundaries and an explicit preview branch', () => {
    expect(() => parseVercelReleaseArguments(['--unexpected'])).toThrow('Unknown')
    expect(() => runGuardedVercelEnvironmentCheck({
      argv: ['--target', 'production'],
      dotenvOverrides: [],
      linkedProject: true,
    })).toThrow('expected Supabase project ref')
    expect(() => runGuardedVercelEnvironmentCheck({
      argv: [
        '--target', 'preview',
        '--expected-supabase-project-ref', STAGING_REF,
        '--forbid-supabase-project-ref', PRODUCTION_REF,
      ],
      dotenvOverrides: [],
      linkedProject: true,
    })).toThrow('requires a safe explicit --git-branch')
  })

  it('refuses to let Vercel infer an unlinked project', () => {
    const spawn = vi.fn()
    expect(() => runGuardedVercelEnvironmentCheck({
      argv: [
        '--target', 'production',
        '--expected-supabase-project-ref', PRODUCTION_REF,
        '--forbid-supabase-project-ref', STAGING_REF,
      ],
      dotenvOverrides: [],
      linkedProject: false,
      spawn,
    })).toThrow('not linked to a Vercel project')
    expect(spawn).not.toHaveBeenCalled()
  })
})
