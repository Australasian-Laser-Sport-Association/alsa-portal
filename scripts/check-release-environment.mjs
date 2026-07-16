#!/usr/bin/env node
// This CLI is also imported by Vitest; .gitattributes keeps its shebang LF-safe.

import { createHmac } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const VALID_TARGETS = new Set(['production', 'preview'])
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/
const REQUIRED_VARIABLES = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'RESEND_API_KEY',
  'CRON_SECRET',
  'VITE_SENTRY_DSN',
  'SENTRY_DSN',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
]

export const CROSS_SCOPE_ISOLATION_VARIABLES = Object.freeze([
  'SUPABASE_SERVICE_ROLE_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'RESEND_API_KEY',
  'CRON_SECRET',
  'VITE_SENTRY_DSN',
  'SENTRY_DSN',
])

export const ISOLATION_FINGERPRINT_PREFIX = 'ALSA_ISOLATION_FINGERPRINTS '

// The guarded Vercel runner removes every value this checker can consume from
// its parent process before the CLI injects the selected remote scope. Keep the
// list exported so a new check cannot accidentally reintroduce local override
// precedence.
export const CHECKED_RELEASE_VARIABLES = Object.freeze([
  ...REQUIRED_VARIABLES,
  'SENTRY_AUTH_TOKEN',
  'SENTRY_UPLOAD_SOURCEMAPS',
  'SENTRY_DISABLE_UPLOAD',
  'VITE_PUBLIC_ASSET_BASE_URL',
  'VERCEL_ENV',
  'VERCEL_TARGET_ENV',
])

function normalized(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function isolationFingerprints(environment, fingerprintKey) {
  if (typeof fingerprintKey !== 'string' || fingerprintKey.length < 32) {
    throw new Error('A sufficiently long internal isolation fingerprint key is required.')
  }

  return Object.fromEntries(CROSS_SCOPE_ISOLATION_VARIABLES.map(name => {
    const value = normalized(environment[name])
    if (!value) return [name, null]
    return [name, createHmac('sha256', fingerprintKey).update(value).digest('base64url')]
  }))
}

export function formatIsolationFingerprintPayload(environment, fingerprintKey) {
  return `${ISOLATION_FINGERPRINT_PREFIX}${JSON.stringify({
    version: 1,
    fingerprints: isolationFingerprints(environment, fingerprintKey),
  })}`
}

function isPlaceholder(value) {
  const candidate = normalized(value).toLowerCase()
  return candidate === ''
    || candidate.startsWith('your_')
    || candidate.startsWith('your-')
    || ['changeme', 'change_me', 'replace_me', 'replace-this', 'todo'].includes(candidate)
}

function isConfigured(value) {
  return !isPlaceholder(value)
}

function isSingleLineTrimmed(value) {
  return typeof value === 'string'
    && value === value.trim()
    && !/[\r\n]/.test(value)
}

function isLocalOrPrivateHostname(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true

  const private172 = /^172\.(\d{1,3})\./.exec(host)
  return private172 ? Number(private172[1]) >= 16 && Number(private172[1]) <= 31 : false
}

function parseRemoteHttpsUrl(value, { allowCredentials = false } = {}) {
  if (!isConfigured(value)) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' || !parsed.hostname || isLocalOrPrivateHostname(parsed.hostname)) {
      return null
    }
    if (!allowCredentials && (parsed.username || parsed.password)) return null
    return parsed
  } catch {
    return null
  }
}

function decodeJwtPayload(value) {
  const parts = normalized(value).split('.')
  if (parts.length !== 3) return null
  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8')
    return JSON.parse(payload)
  } catch {
    return null
  }
}

function supabaseKeyKind(value) {
  const candidate = normalized(value)
  if (/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(candidate)) return 'anon'
  if (/^sb_secret_[A-Za-z0-9_-]{16,}$/.test(candidate)) return 'service_role'
  const parts = candidate.split('.')
  if (parts.length !== 3 || parts.some(part => !part) || parts[2].length < 16) return 'unknown'
  const payload = decodeJwtPayload(candidate)
  return payload?.role === 'anon' || payload?.role === 'service_role'
    ? payload.role
    : 'unknown'
}

function supabaseJwtProjectRef(value) {
  const payload = decodeJwtPayload(value)
  const ref = normalized(payload?.ref).toLowerCase()
  return PROJECT_REF_PATTERN.test(ref) ? ref : null
}

export function supabaseProjectRef(value) {
  const parsed = parseRemoteHttpsUrl(value)
  if (!parsed) return null
  const match = /^([a-z0-9]{20})\.supabase\.co$/i.exec(parsed.hostname)
  return match?.[1]?.toLowerCase() ?? null
}

function addCheck(checks, name, passed) {
  checks.push({ name, passed: Boolean(passed) })
}

function normalizedRef(value) {
  return normalized(value).toLowerCase()
}

export function validateReleaseEnvironment(environment, {
  target,
  expectedSupabaseProjectRef,
  forbiddenSupabaseProjectRefs = [],
} = {}) {
  if (!VALID_TARGETS.has(target)) {
    throw new Error('Target must be production or preview.')
  }

  const checks = []
  for (const key of REQUIRED_VARIABLES) {
    addCheck(checks, `${key} is configured`, isConfigured(environment[key]))
  }

  const supabaseUrl = parseRemoteHttpsUrl(environment.VITE_SUPABASE_URL)
  addCheck(
    checks,
    'VITE_SUPABASE_URL is a remote HTTPS URL without credentials',
    supabaseUrl && supabaseUrl.pathname === '/' && !supabaseUrl.search && !supabaseUrl.hash,
  )

  if (isConfigured(environment.VITE_SUPABASE_ANON_KEY)) {
    addCheck(
      checks,
      'VITE_SUPABASE_ANON_KEY is an anon or publishable Supabase key',
      supabaseKeyKind(environment.VITE_SUPABASE_ANON_KEY) === 'anon',
    )
    addCheck(
      checks,
      'VITE_SUPABASE_ANON_KEY is single-line and has no surrounding whitespace',
      isSingleLineTrimmed(environment.VITE_SUPABASE_ANON_KEY),
    )
  }

  if (isConfigured(environment.SUPABASE_SERVICE_ROLE_KEY)) {
    addCheck(
      checks,
      'SUPABASE_SERVICE_ROLE_KEY is a service-role or secret Supabase key',
      supabaseKeyKind(environment.SUPABASE_SERVICE_ROLE_KEY) === 'service_role',
    )
    addCheck(
      checks,
      'SUPABASE_SERVICE_ROLE_KEY is single-line and has no surrounding whitespace',
      isSingleLineTrimmed(environment.SUPABASE_SERVICE_ROLE_KEY),
    )
  }

  if (
    isConfigured(environment.VITE_SUPABASE_ANON_KEY)
    && isConfigured(environment.SUPABASE_SERVICE_ROLE_KEY)
  ) {
    addCheck(
      checks,
      'Supabase anon and service-role keys are different',
      environment.VITE_SUPABASE_ANON_KEY !== environment.SUPABASE_SERVICE_ROLE_KEY,
    )
  }

  const expectedRef = normalizedRef(expectedSupabaseProjectRef)
  const forbiddenRefs = forbiddenSupabaseProjectRefs
    .map(normalizedRef)
    .filter(Boolean)
  const actualRef = supabaseProjectRef(environment.VITE_SUPABASE_URL)

  for (const key of ['VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    const keyRef = supabaseJwtProjectRef(environment[key])
    if (decodeJwtPayload(environment[key])) {
      addCheck(
        checks,
        `${key} belongs to the VITE_SUPABASE_URL project`,
        Boolean(actualRef) && keyRef === actualRef,
      )
    }
  }

  addCheck(
    checks,
    'Expected Supabase project reference is configured and has a valid format',
    PROJECT_REF_PATTERN.test(expectedRef),
  )
  addCheck(
    checks,
    `VITE_SUPABASE_URL matches the expected ${target} Supabase project`,
    PROJECT_REF_PATTERN.test(expectedRef) && actualRef === expectedRef,
  )

  addCheck(
    checks,
    `At least one forbidden ${target === 'production' ? 'preview' : 'production'} Supabase project reference is configured`,
    forbiddenRefs.length > 0,
  )

  for (const forbiddenRef of forbiddenRefs) {
    addCheck(
      checks,
      'Forbidden Supabase project reference has a valid format',
      PROJECT_REF_PATTERN.test(forbiddenRef),
    )
    addCheck(
      checks,
      `VITE_SUPABASE_URL is isolated from a forbidden ${target === 'production' ? 'preview' : 'production'} project`,
      PROJECT_REF_PATTERN.test(forbiddenRef) && actualRef !== forbiddenRef,
    )
  }

  addCheck(
    checks,
    'Expected and forbidden Supabase project references are valid and different',
    PROJECT_REF_PATTERN.test(expectedRef)
      && forbiddenRefs.length > 0
      && forbiddenRefs.every(ref => PROJECT_REF_PATTERN.test(ref) && ref !== expectedRef),
  )

  const upstashUrl = parseRemoteHttpsUrl(environment.UPSTASH_REDIS_REST_URL)
  addCheck(
    checks,
    'UPSTASH_REDIS_REST_URL is a remote HTTPS URL without credentials',
    upstashUrl && upstashUrl.pathname === '/' && !upstashUrl.search && !upstashUrl.hash,
  )
  if (isConfigured(environment.UPSTASH_REDIS_REST_TOKEN)) {
    addCheck(
      checks,
      'UPSTASH_REDIS_REST_TOKEN is a single-line token of sufficient length',
      isSingleLineTrimmed(environment.UPSTASH_REDIS_REST_TOKEN)
        && !/\s/.test(environment.UPSTASH_REDIS_REST_TOKEN)
        && environment.UPSTASH_REDIS_REST_TOKEN.length >= 20,
    )
  }

  if (isConfigured(environment.CRON_SECRET)) {
    addCheck(
      checks,
      'CRON_SECRET is a single-line secret of at least 32 characters',
      isSingleLineTrimmed(environment.CRON_SECRET)
        && !/\s/.test(environment.CRON_SECRET)
        && environment.CRON_SECRET.length >= 32,
    )
  }

  if (isConfigured(environment.RESEND_API_KEY)) {
    addCheck(
      checks,
      'RESEND_API_KEY has the expected single-line provider-key format',
      isSingleLineTrimmed(environment.RESEND_API_KEY)
        && /^re_[A-Za-z0-9_-]{12,}$/.test(environment.RESEND_API_KEY),
    )
  }

  for (const key of ['VITE_SENTRY_DSN', 'SENTRY_DSN']) {
    const dsn = parseRemoteHttpsUrl(environment[key], { allowCredentials: true })
    addCheck(
      checks,
      `${key} is a remote HTTPS DSN with a public key and project path`,
      dsn && Boolean(dsn.username) && dsn.pathname.length > 1,
    )
  }

  const uploadSetting = normalized(environment.SENTRY_UPLOAD_SOURCEMAPS).toLowerCase()
  const disableSetting = normalized(environment.SENTRY_DISABLE_UPLOAD).toLowerCase()
  addCheck(
    checks,
    'SENTRY_UPLOAD_SOURCEMAPS is true, false, or unset',
    ['', 'true', 'false'].includes(uploadSetting),
  )
  addCheck(
    checks,
    'SENTRY_DISABLE_UPLOAD is true, false, or unset',
    ['', 'true', 'false'].includes(disableSetting),
  )
  if (uploadSetting === 'true') {
    addCheck(
      checks,
      'SENTRY_AUTH_TOKEN is configured when source-map upload is enabled',
      isConfigured(environment.SENTRY_AUTH_TOKEN)
        && isSingleLineTrimmed(environment.SENTRY_AUTH_TOKEN)
        && !/\s/.test(environment.SENTRY_AUTH_TOKEN),
    )
    addCheck(
      checks,
      'SENTRY_DISABLE_UPLOAD does not disable an enabled source-map upload',
      disableSetting !== 'true',
    )
  }

  if (isConfigured(environment.VITE_PUBLIC_ASSET_BASE_URL)) {
    const assetUrl = parseRemoteHttpsUrl(environment.VITE_PUBLIC_ASSET_BASE_URL)
    addCheck(
      checks,
      'VITE_PUBLIC_ASSET_BASE_URL is a remote HTTPS URL without credentials',
      assetUrl && !assetUrl.search && !assetUrl.hash,
    )
  }

  for (const key of ['VERCEL_ENV', 'VERCEL_TARGET_ENV']) {
    if (isConfigured(environment[key])) {
      addCheck(checks, `${key} agrees with the requested release target`, environment[key] === target)
    }
  }

  const failures = checks.filter(check => !check.passed)
  return {
    target,
    checks,
    failures,
    passed: failures.length === 0,
  }
}

export function formatReleaseEnvironmentReport(result) {
  const lines = [`Release environment check: ${result.target}`]
  for (const check of result.checks) {
    lines.push(`${check.passed ? 'PASS' : 'FAIL'} ${check.name}`)
  }
  lines.push(
    result.passed
      ? `Passed ${result.checks.length} release environment checks.`
      : `Failed ${result.failures.length} of ${result.checks.length} release environment checks.`,
  )
  return lines.join('\n')
}

function takeOptionValue(argv, index, option) {
  const argument = argv[index]
  if (argument === option) {
    if (!argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error(`Missing value for ${option}.`)
    }
    return { value: argv[index + 1], consumed: 2 }
  }
  if (argument.startsWith(`${option}=`)) {
    const value = argument.slice(option.length + 1)
    if (!value) throw new Error(`Missing value for ${option}.`)
    return { value, consumed: 1 }
  }
  return null
}

export function parseArguments(argv) {
  const options = { forbiddenSupabaseProjectRefs: [] }
  for (let index = 0; index < argv.length;) {
    if (argv[index] === '--emit-isolation-fingerprints') {
      options.emitIsolationFingerprints = true
      index += 1
      continue
    }

    const fingerprintKey = takeOptionValue(argv, index, '--fingerprint-key')
    if (fingerprintKey) {
      options.fingerprintKey = fingerprintKey.value
      index += fingerprintKey.consumed
      continue
    }

    const target = takeOptionValue(argv, index, '--target')
    if (target) {
      options.target = target.value
      index += target.consumed
      continue
    }

    const expected = takeOptionValue(argv, index, '--expected-supabase-project-ref')
    if (expected) {
      options.expectedSupabaseProjectRef = expected.value
      index += expected.consumed
      continue
    }

    const forbidden = takeOptionValue(argv, index, '--forbid-supabase-project-ref')
    if (forbidden) {
      options.forbiddenSupabaseProjectRefs.push(forbidden.value)
      index += forbidden.consumed
      continue
    }

    throw new Error('Unknown release-environment checker option.')
  }
  return options
}

function optionsWithEnvironmentFallbacks(options, environment) {
  const expectedSupabaseProjectRef = options.expectedSupabaseProjectRef
    || environment.ALSA_EXPECTED_SUPABASE_PROJECT_REF
  const environmentForbidden = normalized(environment.ALSA_FORBIDDEN_SUPABASE_PROJECT_REFS)
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)

  return {
    ...options,
    expectedSupabaseProjectRef,
    forbiddenSupabaseProjectRefs: [
      ...(options.forbiddenSupabaseProjectRefs ?? []),
      ...environmentForbidden,
    ],
  }
}

export function runCli({
  argv = process.argv.slice(2),
  environment = process.env,
  log = message => console.log(message),
  error = message => console.error(message),
} = {}) {
  try {
    const parsed = parseArguments(argv)
    if (parsed.emitIsolationFingerprints) {
      log(formatIsolationFingerprintPayload(environment, parsed.fingerprintKey))
      return 0
    }
    if (parsed.fingerprintKey) {
      throw new Error('--fingerprint-key is only valid with --emit-isolation-fingerprints.')
    }

    const options = optionsWithEnvironmentFallbacks(parsed, environment)
    const result = validateReleaseEnvironment(environment, options)
    log(formatReleaseEnvironmentReport(result))
    return result.passed ? 0 : 1
  } catch (caught) {
    error(`Release environment check could not run: ${caught.message}`)
    return 1
  }
}

function isDirectInvocation() {
  return Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url
}

if (isDirectInvocation()) {
  process.exitCode = runCli()
}
