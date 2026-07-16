#!/usr/bin/env node

import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_MIGRATION_DIRECTORY = resolve(REPO_ROOT, 'supabase', 'migrations')
const DEFAULT_VERIFICATION_DIRECTORY = resolve(REPO_ROOT, 'supabase', 'verify')

export const DATABASE_URL_ENVIRONMENT_VARIABLE = 'REMEDIATION_VERIFY_DATABASE_URL'
export const REMEDIATION_MIGRATION_PATTERN = /^20260713\d{6}_.+\.sql$/
export const REMEDIATION_VERIFICATION_PATTERN = /^20260713\d{6}_.+_verify\.sql$/

function sortedMatchingFileNames(directory, pattern) {
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && pattern.test(entry.name))
    .map(entry => entry.name)
    .sort()
}

export function validateRemediationVerificationCoverage(
  migrationNames,
  verificationNames,
) {
  if (migrationNames.length === 0) {
    throw new Error('No 20260713 remediation migrations were found.')
  }

  const expectedVerificationNames = migrationNames.map(name =>
    `${name.slice(0, -'.sql'.length)}_verify.sql`)
  const expected = new Set(expectedVerificationNames)
  const actual = new Set(verificationNames)
  const missing = expectedVerificationNames.filter(name => !actual.has(name))
  const orphaned = verificationNames.filter(name => !expected.has(name))

  if (missing.length > 0 || orphaned.length > 0) {
    const details = []
    if (missing.length > 0) details.push(`missing: ${missing.join(', ')}`)
    if (orphaned.length > 0) details.push(`orphaned: ${orphaned.join(', ')}`)
    throw new Error(`Remediation verification coverage mismatch (${details.join('; ')}).`)
  }

  return expectedVerificationNames
}

export function discoverRemediationVerificationFiles({
  migrationDirectory = DEFAULT_MIGRATION_DIRECTORY,
  verificationDirectory = DEFAULT_VERIFICATION_DIRECTORY,
} = {}) {
  const migrationNames = sortedMatchingFileNames(
    migrationDirectory,
    REMEDIATION_MIGRATION_PATTERN,
  )
  const verificationNames = sortedMatchingFileNames(
    verificationDirectory,
    REMEDIATION_VERIFICATION_PATTERN,
  )
  const orderedNames = validateRemediationVerificationCoverage(
    migrationNames,
    verificationNames,
  )

  return orderedNames.map(name => resolve(verificationDirectory, name))
}

function decodedConnectionValue(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error('The local database URL contains invalid percent encoding.')
  }
}

export function buildLocalPostgresEnvironment(
  databaseUrl,
  baseEnvironment = process.env,
) {
  if (!databaseUrl) {
    throw new Error(
      `Set ${DATABASE_URL_ENVIRONMENT_VARIABLE} to the disposable local PostgreSQL URL.`,
    )
  }

  let parsed
  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new Error('The supplied local database URL is invalid.')
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('The supplied local database URL must use PostgreSQL.')
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw new Error('Refusing to run remediation verification against a non-loopback database host.')
  }

  const database = decodedConnectionValue(parsed.pathname.replace(/^\//, ''))
  if (!database || database.includes('/')) {
    throw new Error('The supplied local database URL must name one database.')
  }

  const environment = {
    ...baseEnvironment,
    PGHOST: host,
    PGPORT: parsed.port || '5432',
    PGDATABASE: database,
    PGUSER: decodedConnectionValue(parsed.username),
    PGPASSWORD: decodedConnectionValue(parsed.password),
    PGSSLMODE: parsed.searchParams.get('sslmode') || 'disable',
    PGCONNECT_TIMEOUT: parsed.searchParams.get('connect_timeout') || '10',
    PGAPPNAME: 'alsa-remediation-verification',
  }

  // Do not forward the credential-bearing URL or connection indirection that
  // could override the explicitly parsed loopback target.
  delete environment[DATABASE_URL_ENVIRONMENT_VARIABLE]
  delete environment.PGSERVICE
  delete environment.PGSERVICEFILE
  delete environment.PGPASSFILE

  return environment
}

export function runRemediationVerifications({
  databaseUrl = process.env[DATABASE_URL_ENVIRONMENT_VARIABLE],
  environment = process.env,
  migrationDirectory = DEFAULT_MIGRATION_DIRECTORY,
  verificationDirectory = DEFAULT_VERIFICATION_DIRECTORY,
  psqlBinary = environment.PSQL_BIN || 'psql',
  spawn = spawnSync,
  log = message => console.log(message),
} = {}) {
  const postgresEnvironment = buildLocalPostgresEnvironment(databaseUrl, environment)
  const files = discoverRemediationVerificationFiles({
    migrationDirectory,
    verificationDirectory,
  })

  log(`Running ${files.length} remediation verification SQL files.`)
  const failures = []
  for (const [index, file] of files.entries()) {
    const name = basename(file)
    log(`[${index + 1}/${files.length}] ${name}`)

    const result = spawn(
      psqlBinary,
      ['--no-psqlrc', '--set=ON_ERROR_STOP=1', '--file', file],
      {
        env: postgresEnvironment,
        shell: false,
        stdio: 'inherit',
        windowsHide: true,
      },
    )

    if (result.error) {
      if (result.error.code === 'ENOENT') {
        throw new Error('psql was not found. Install the PostgreSQL client and retry.')
      }
      throw new Error(`Unable to start psql for ${name}.`)
    }
    if (result.status !== 0) {
      const outcome = result.signal ? `signal ${result.signal}` : `exit code ${result.status}`
      failures.push(`${name} (${outcome})`)
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} remediation verification SQL file(s) failed: ${failures.join(', ')}.`,
    )
  }

  log(`Passed ${files.length} remediation verification SQL files.`)
  return files
}

function isDirectInvocation() {
  return Boolean(process.argv[1])
    && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
}

if (isDirectInvocation()) {
  try {
    runRemediationVerifications()
  } catch (error) {
    console.error(`Remediation verification failed: ${error.message}`)
    process.exitCode = 1
  }
}
