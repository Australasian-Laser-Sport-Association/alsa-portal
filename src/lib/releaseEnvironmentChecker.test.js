import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  formatReleaseEnvironmentReport,
  parseArguments,
  runCli,
  supabaseProjectRef,
  validateReleaseEnvironment,
} from '../../scripts/check-release-environment.mjs'

const PRODUCTION_REF = 'abcdefghijklmnopqrst'
const STAGING_REF = 'bcdefghijklmnopqrstu'

function jwtForRole(role) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, ref: PRODUCTION_REF })}.signature-material-long-enough`
}

function validEnvironment(overrides = {}) {
  return {
    VITE_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
    VITE_SUPABASE_ANON_KEY: jwtForRole('anon'),
    SUPABASE_SERVICE_ROLE_KEY: jwtForRole('service_role'),
    RESEND_API_KEY: 're_release_environment_test_key',
    CRON_SECRET: 'c'.repeat(64),
    VITE_SENTRY_DSN: 'https://public-key@o123.ingest.sentry.io/456',
    SENTRY_DSN: 'https://server-key@o123.ingest.sentry.io/789',
    UPSTASH_REDIS_REST_URL: 'https://careful-mammal-12345.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'upstash-token-for-release-tests',
    SENTRY_UPLOAD_SOURCEMAPS: 'false',
    ...overrides,
  }
}

describe('release environment checker', () => {
  it('accepts a complete production environment bound to its expected project', () => {
    const result = validateReleaseEnvironment(validEnvironment(), {
      target: 'production',
      expectedSupabaseProjectRef: PRODUCTION_REF,
      forbiddenSupabaseProjectRefs: [STAGING_REF],
    })

    expect(result.passed).toBe(true)
    expect(result.failures).toEqual([])
  })

  it('accepts current publishable and secret Supabase key formats for preview', () => {
    const result = validateReleaseEnvironment(validEnvironment({
      VITE_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
      VITE_SUPABASE_ANON_KEY: 'sb_publishable_preview_key_material',
      SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_preview_key_material',
    }), {
      target: 'preview',
      expectedSupabaseProjectRef: STAGING_REF,
      forbiddenSupabaseProjectRefs: [PRODUCTION_REF],
    })

    expect(result.passed).toBe(true)
  })

  it('fails closed for missing, local, malformed, or swapped credentials', () => {
    const result = validateReleaseEnvironment(validEnvironment({
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: jwtForRole('service_role'),
      SUPABASE_SERVICE_ROLE_KEY: jwtForRole('anon'),
      RESEND_API_KEY: 'wrong-provider-key',
      CRON_SECRET: 'too-short',
      UPSTASH_REDIS_REST_URL: 'http://localhost:8079',
      UPSTASH_REDIS_REST_TOKEN: 'short',
      SENTRY_DSN: '',
    }), {
      target: 'production',
      expectedSupabaseProjectRef: PRODUCTION_REF,
    })

    expect(result.passed).toBe(false)
    expect(result.failures.map(check => check.name)).toEqual(expect.arrayContaining([
      'SENTRY_DSN is configured',
      'VITE_SUPABASE_URL is a remote HTTPS URL without credentials',
      'VITE_SUPABASE_ANON_KEY is an anon or publishable Supabase key',
      'SUPABASE_SERVICE_ROLE_KEY is a service-role or secret Supabase key',
      'CRON_SECRET is a single-line secret of at least 32 characters',
      'UPSTASH_REDIS_REST_URL is a remote HTTPS URL without credentials',
    ]))
  })

  it('requires a source-map auth token and rejects a contradictory disable switch', () => {
    const result = validateReleaseEnvironment(validEnvironment({
      SENTRY_UPLOAD_SOURCEMAPS: 'true',
      SENTRY_AUTH_TOKEN: '',
      SENTRY_DISABLE_UPLOAD: 'true',
    }), { target: 'production' })

    expect(result.failures.map(check => check.name)).toEqual(expect.arrayContaining([
      'SENTRY_AUTH_TOKEN is configured when source-map upload is enabled',
      'SENTRY_DISABLE_UPLOAD does not disable an enabled source-map upload',
    ]))
  })

  it('rejects a legacy Supabase key issued for a different project', () => {
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
    const stagingAnon = `${encode({ alg: 'HS256' })}.${encode({ role: 'anon', ref: STAGING_REF })}.signature-material-long-enough`
    const result = validateReleaseEnvironment(validEnvironment({
      VITE_SUPABASE_ANON_KEY: stagingAnon,
    }), { target: 'production' })

    expect(result.failures.map(check => check.name)).toContain(
      'VITE_SUPABASE_ANON_KEY belongs to the VITE_SUPABASE_URL project',
    )
  })

  it('detects expected and forbidden project-reference mistakes without reporting values', () => {
    const secret = 'service-key-that-must-never-appear-in-output'
    const environment = validEnvironment({ SUPABASE_SERVICE_ROLE_KEY: secret })
    const result = validateReleaseEnvironment(environment, {
      target: 'preview',
      expectedSupabaseProjectRef: STAGING_REF,
      forbiddenSupabaseProjectRefs: [PRODUCTION_REF],
    })
    const report = formatReleaseEnvironmentReport(result)

    expect(result.passed).toBe(false)
    expect(report).not.toContain(secret)
    expect(report).not.toContain(PRODUCTION_REF)
    expect(report).not.toContain(STAGING_REF)
    expect(report).toContain('FAIL VITE_SUPABASE_URL matches the expected preview Supabase project')
    expect(report).toContain('FAIL VITE_SUPABASE_URL is isolated from a forbidden production project')
  })

  it('fails closed when independently recorded project boundaries are omitted', () => {
    const environment = validEnvironment()
    const output = []
    const status = runCli({
      argv: ['--target', 'production'],
      environment,
      log: value => output.push(value),
      error: value => output.push(value),
    })
    const report = output.join('\n')

    expect(status).toBe(1)
    expect(report).toContain(
      'FAIL Expected Supabase project reference is configured and has a valid format',
    )
    expect(report).toContain(
      'FAIL At least one forbidden preview Supabase project reference is configured',
    )
    expect(report).not.toContain(environment.VITE_SUPABASE_URL)
    expect(report).not.toContain(environment.VITE_SUPABASE_ANON_KEY)
    expect(report).not.toContain(environment.SUPABASE_SERVICE_ROLE_KEY)
  })

  it('parses repeatable project-isolation arguments', () => {
    expect(parseArguments([
      '--target=preview',
      '--expected-supabase-project-ref', STAGING_REF,
      `--forbid-supabase-project-ref=${PRODUCTION_REF}`,
      '--forbid-supabase-project-ref', 'cdefghijklmnopqrstuv',
    ])).toEqual({
      target: 'preview',
      expectedSupabaseProjectRef: STAGING_REF,
      forbiddenSupabaseProjectRefs: [PRODUCTION_REF, 'cdefghijklmnopqrstuv'],
    })
  })

  it('supports environment-provided project boundaries and returns a process status', () => {
    const output = []
    const status = runCli({
      argv: ['--target', 'production'],
      environment: {
        ...validEnvironment(),
        ALSA_EXPECTED_SUPABASE_PROJECT_REF: PRODUCTION_REF,
        ALSA_FORBIDDEN_SUPABASE_PROJECT_REFS: STAGING_REF,
      },
      log: value => output.push(value),
      error: value => output.push(value),
    })

    expect(status).toBe(0)
    expect(output.join('\n')).not.toContain(PRODUCTION_REF)
    expect(output.join('\n')).not.toContain(STAGING_REF)
  })

  it('extracts only canonical hosted Supabase project references', () => {
    expect(supabaseProjectRef(`https://${PRODUCTION_REF}.supabase.co`)).toBe(PRODUCTION_REF)
    expect(supabaseProjectRef('https://database.example.org')).toBeNull()
    expect(supabaseProjectRef('http://abcdefghijklmnopqrst.supabase.co')).toBeNull()
  })
})
