#!/usr/bin/env node
// This CLI is also imported by Vitest; .gitattributes keeps its shebang LF-safe.

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SUPABASE_ROOT = resolve(REPO_ROOT, 'supabase')
const MIGRATION_ROOT = resolve(SUPABASE_ROOT, 'migrations')
const LINKED_PROJECT_REF = resolve(SUPABASE_ROOT, '.temp', 'project-ref')
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/

export const EXPECTED_PROJECT_REF_ENV = 'EXPECTED_SUPABASE_PROJECT_REF'
export const FORBIDDEN_PROJECT_REF_ENV = 'FORBIDDEN_SUPABASE_PROJECT_REF'
export const EXPECTED_RELEASE_COMMIT_ENV = 'EXPECTED_RELEASE_COMMIT'

export const REMEDIATION_ROLLOUT_PHASES = Object.freeze([
  Object.freeze({
    id: 'acknowledgement-expand',
    predecessor: '20260703010000',
    endpoint: '20260713041000',
    description: 'Security/API foundations, required-document publication, and masked-view expansion.',
  }),
  Object.freeze({
    id: 'application-cutover',
    predecessor: '20260713041000',
    endpoint: '20260713065500',
    description: 'Private required-document storage, application, admin-content expansion, and backup lease cutover, stopping before browser contraction.',
  }),
  Object.freeze({
    id: 'admin-content-contract',
    predecessor: '20260713065500',
    endpoint: '20260713066000',
    description: 'Final admin-content browser privilege contraction after audited smoke proof.',
  }),
  Object.freeze({
    id: 'final-release-hardening',
    predecessor: '20260713066000',
    endpoint: '20260713067000',
    description: 'Final account-state, referee-test question-bank, function search-path, and audit-ledger privilege hardening.',
  }),
])

function migrationVersion(name) {
  return /^([0-9]{14})_.+\.sql$/.exec(name)?.[1] ?? null
}

export function remediationRolloutPhase(id) {
  const phase = REMEDIATION_ROLLOUT_PHASES.find(candidate => candidate.id === id)
  if (!phase) {
    throw new Error(
      `Unknown rollout phase "${id}". Choose: ${REMEDIATION_ROLLOUT_PHASES.map(item => item.id).join(', ')}.`,
    )
  }
  return phase
}

export function migrationNamesThroughPhase(
  phaseId,
  migrationDirectory = MIGRATION_ROOT,
) {
  const phase = remediationRolloutPhase(phaseId)
  const names = readdirSync(migrationDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile() && migrationVersion(entry.name))
    .map(entry => entry.name)
    .sort()
    .filter(name => migrationVersion(name) <= phase.endpoint)

  const endpointMatches = names.filter(name => migrationVersion(name) === phase.endpoint)
  if (endpointMatches.length !== 1) {
    throw new Error(
      `Phase ${phase.id} must resolve to exactly one ${phase.endpoint} migration; found ${endpointMatches.length}.`,
    )
  }
  return names
}

function repositoryMigrationVersions(migrationDirectory = MIGRATION_ROOT) {
  const versions = readdirSync(migrationDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile() && migrationVersion(entry.name))
    .map(entry => migrationVersion(entry.name))
    .sort()

  const duplicate = versions.find((version, index) => version === versions[index - 1])
  if (duplicate) {
    throw new Error(`Repository migration version ${duplicate} is duplicated.`)
  }
  return versions
}

export function parseLinkedMigrationHistory(output) {
  if (typeof output !== 'string') {
    throw new Error('Unable to read linked remote migration history.')
  }

  const versions = output
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .map(line => line.split('|').map(column => column.trim()))
    .filter(columns => columns.length >= 2 && /^[0-9]{14}$/.test(columns[1]))
    .map(columns => columns[1])

  if (versions.length === 0) {
    throw new Error('Linked remote migration history is empty or could not be parsed.')
  }
  return versions
}

export function validateLinkedMigrationHistory({
  phaseId,
  remoteVersions,
  migrationDirectory = MIGRATION_ROOT,
}) {
  const phase = remediationRolloutPhase(phaseId)
  if (!Array.isArray(remoteVersions)
      || remoteVersions.length === 0
      || remoteVersions.some(version => !/^[0-9]{14}$/.test(version))) {
    throw new Error('Linked remote migration history is empty or invalid.')
  }

  const repositoryVersions = repositoryMigrationVersions(migrationDirectory)
  for (const boundary of [phase.predecessor, phase.endpoint]) {
    if (!repositoryVersions.includes(boundary)) {
      throw new Error(`Phase ${phase.id} boundary ${boundary} is missing from repository migrations.`)
    }
  }

  const remoteTip = remoteVersions.at(-1)
  if (remoteTip !== phase.predecessor && remoteTip !== phase.endpoint) {
    throw new Error(
      `Phase ${phase.id} requires linked remote history to end exactly at predecessor ${phase.predecessor} or endpoint ${phase.endpoint}; found ${remoteTip}.`,
    )
  }

  const expectedPrefix = repositoryVersions.filter(version => version <= remoteTip)
  const mismatchIndex = Math.max(expectedPrefix.length, remoteVersions.length) === 0
    ? -1
    : Array.from(
        { length: Math.max(expectedPrefix.length, remoteVersions.length) },
        (_, index) => index,
      ).find(index => expectedPrefix[index] !== remoteVersions[index])

  if (mismatchIndex !== undefined && mismatchIndex !== -1) {
    const expected = expectedPrefix[mismatchIndex] ?? 'no additional migration'
    const found = remoteVersions[mismatchIndex] ?? 'missing'
    throw new Error(
      `Linked remote migration history is not the contiguous repository prefix at ${remoteTip}: expected ${expected}, found ${found}.`,
    )
  }

  return {
    remoteTip,
    idempotentVerification: remoteTip === phase.endpoint,
  }
}

export function rolloutConfirmation(environment, phaseId) {
  if (!['staging', 'production'].includes(environment)) {
    throw new Error('Rollout environment must be staging or production.')
  }
  remediationRolloutPhase(phaseId)
  return `APPLY-${environment.toUpperCase()}-${phaseId.toUpperCase()}`
}

function parseArguments(argv) {
  const options = {
    list: false,
    phase: '',
    environment: '',
    dryRun: false,
    apply: false,
    confirmation: '',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--list') options.list = true
    else if (argument === '--dry-run') options.dryRun = true
    else if (argument === '--apply') options.apply = true
    else if (argument === '--phase') options.phase = argv[++index] ?? ''
    else if (argument === '--environment') options.environment = argv[++index] ?? ''
    else if (argument === '--confirm') options.confirmation = argv[++index] ?? ''
    else throw new Error(`Unknown argument: ${argument}`)
  }

  if (options.dryRun && options.apply) {
    throw new Error('Choose either --dry-run or --apply, not both.')
  }
  return options
}

export function validateProjectRefPair(expected, forbidden) {
  if (!PROJECT_REF_PATTERN.test(expected)) {
    throw new Error(
      `Set ${EXPECTED_PROJECT_REF_ENV} to the independently verified 20-character target project ref.`,
    )
  }
  if (!PROJECT_REF_PATTERN.test(forbidden)) {
    throw new Error(
      `Set ${FORBIDDEN_PROJECT_REF_ENV} to the independently verified other-environment project ref.`,
    )
  }
  if (expected === forbidden) {
    throw new Error('The expected and forbidden Supabase project refs must be different.')
  }
  return { expected, forbidden }
}

function readProjectRefs(environment = process.env) {
  const expected = String(environment[EXPECTED_PROJECT_REF_ENV] ?? '').trim()
  const forbidden = String(environment[FORBIDDEN_PROJECT_REF_ENV] ?? '').trim()
  return validateProjectRefPair(expected, forbidden)
}

function assertLinkedProject(expectedProjectRef, forbiddenProjectRef) {
  if (!existsSync(LINKED_PROJECT_REF)) {
    throw new Error('No linked Supabase project was found. Link and independently verify the intended project first.')
  }
  const linked = readFileSync(LINKED_PROJECT_REF, 'utf8').trim()
  if (linked === forbiddenProjectRef) {
    throw new Error('Refusing to use the explicitly forbidden other-environment Supabase project.')
  }
  if (linked !== expectedProjectRef) {
    throw new Error('The linked Supabase project does not match the independently verified expected project ref.')
  }
}

export function validateReviewedReleaseState({ expectedCommit, headCommit, statusPorcelain }) {
  if (!/^[0-9a-f]{40}$/i.test(expectedCommit)) {
    throw new Error(
      `Set ${EXPECTED_RELEASE_COMMIT_ENV} to the full reviewed 40-character release commit.`,
    )
  }
  if (headCommit !== expectedCommit) {
    throw new Error('HEAD does not match the independently approved release commit.')
  }
  if (statusPorcelain.trim()) {
    throw new Error('The working tree must be clean before applying a database rollout phase.')
  }
}

function gitOutput(args, spawn = spawnSync, environment = process.env) {
  const result = spawn('git', args, {
    cwd: REPO_ROOT,
    env: environment,
    shell: false,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error || result.status !== 0) {
    throw new Error('Unable to verify the reviewed Git release state.')
  }
  return String(result.stdout ?? '').trim()
}

function assertReviewedRelease(environment, spawn = spawnSync) {
  validateReviewedReleaseState({
    expectedCommit: String(environment[EXPECTED_RELEASE_COMMIT_ENV] ?? '').trim(),
    headCommit: gitOutput(['rev-parse', 'HEAD'], spawn, environment),
    statusPorcelain: gitOutput(
      ['status', '--porcelain=v1', '--untracked-files=all'],
      spawn,
      environment,
    ),
  })
}

function createIsolatedPhaseWorkspace(phaseId) {
  const phaseRoot = mkdtempSync(join(tmpdir(), 'alsa-remediation-phase-'))
  try {
    const isolatedSupabase = resolve(phaseRoot, 'supabase')
    const isolatedMigrations = resolve(isolatedSupabase, 'migrations')
    mkdirSync(isolatedMigrations, { recursive: true })

    copyFileSync(resolve(SUPABASE_ROOT, 'config.toml'), resolve(isolatedSupabase, 'config.toml'))
    cpSync(resolve(SUPABASE_ROOT, '.temp'), resolve(isolatedSupabase, '.temp'), {
      recursive: true,
      force: true,
    })

    const migrationNames = migrationNamesThroughPhase(phaseId)
    for (const name of migrationNames) {
      copyFileSync(resolve(MIGRATION_ROOT, name), resolve(isolatedMigrations, name))
    }

    return { phaseRoot, migrationNames }
  } catch (error) {
    removeIsolatedPhaseWorkspace(phaseRoot)
    throw error
  }
}

function removeIsolatedPhaseWorkspace(phaseRoot) {
  const resolvedRoot = resolve(phaseRoot)
  const relativeToTemp = relative(resolve(tmpdir()), resolvedRoot)
  if (
    !relativeToTemp
    || relativeToTemp.startsWith('..')
    || isAbsolute(relativeToTemp)
    || !basename(resolvedRoot).startsWith('alsa-remediation-phase-')
  ) {
    throw new Error('Refusing to remove an unexpected rollout workspace path.')
  }
  rmSync(resolvedRoot, { recursive: true, force: true })
}

function runSupabase(args, spawn = spawnSync, environment = process.env) {
  const childEnvironment = { ...environment }
  delete childEnvironment[EXPECTED_PROJECT_REF_ENV]
  delete childEnvironment[FORBIDDEN_PROJECT_REF_ENV]
  delete childEnvironment[EXPECTED_RELEASE_COMMIT_ENV]
  const result = spawn('supabase', args, {
    cwd: REPO_ROOT,
    env: childEnvironment,
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error('Supabase CLI was not found.')
    }
    throw new Error('Unable to start the Supabase CLI.')
  }
  if (result.status !== 0) {
    const outcome = result.signal ? `signal ${result.signal}` : `exit code ${result.status}`
    throw new Error(`Supabase CLI failed with ${outcome}.`)
  }
}

function linkedMigrationHistory(spawn = spawnSync, environment = process.env) {
  const childEnvironment = { ...environment }
  delete childEnvironment[EXPECTED_PROJECT_REF_ENV]
  delete childEnvironment[FORBIDDEN_PROJECT_REF_ENV]
  delete childEnvironment[EXPECTED_RELEASE_COMMIT_ENV]
  const result = spawn('supabase', ['migration', 'list', '--linked'], {
    cwd: REPO_ROOT,
    env: childEnvironment,
    shell: false,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error('Supabase CLI was not found.')
    }
    throw new Error('Unable to start the Supabase CLI.')
  }
  if (result.status !== 0) {
    throw new Error('Unable to verify linked remote migration history.')
  }
  return parseLinkedMigrationHistory(String(result.stdout ?? ''))
}

function printPhaseList(log = console.log) {
  for (const phase of REMEDIATION_ROLLOUT_PHASES) {
    log(`${phase.id} -> ${phase.endpoint}: ${phase.description}`)
  }
}

export function runRemediationRolloutPhase({
  argv = process.argv.slice(2),
  environment = process.env,
  spawn = spawnSync,
  log = console.log,
} = {}) {
  const options = parseArguments(argv)
  if (options.list) {
    printPhaseList(log)
    return { listed: true }
  }
  if (!options.phase) {
    throw new Error('Select an explicit rollout phase with --phase.')
  }

  const phase = remediationRolloutPhase(options.phase)
  const migrationNames = migrationNamesThroughPhase(phase.id)
  log(`Phase: ${phase.id}`)
  log(`Endpoint: ${phase.endpoint}`)
  log(`Isolated migration manifest: ${migrationNames.length} files, ending at ${basename(migrationNames.at(-1))}`)

  if (!options.dryRun && !options.apply) {
    log('Local plan only. Add --dry-run after verifying the target environment and linked project.')
    return { phase, migrationNames, planned: true }
  }

  if (!['staging', 'production'].includes(options.environment)) {
    throw new Error('Remote dry-run/apply requires --environment staging or --environment production.')
  }
  const { expected, forbidden } = readProjectRefs(environment)
  assertLinkedProject(expected, forbidden)

  if (options.apply) {
    const requiredConfirmation = rolloutConfirmation(options.environment, phase.id)
    if (options.confirmation !== requiredConfirmation) {
      throw new Error(`Applying this phase requires --confirm ${requiredConfirmation}.`)
    }
    assertReviewedRelease(environment, spawn)
  }

  const history = validateLinkedMigrationHistory({
    phaseId: phase.id,
    remoteVersions: linkedMigrationHistory(spawn, environment),
  })
  log(
    history.idempotentVerification
      ? `Linked migration history is already at ${history.remoteTip}; running idempotent verification only.`
      : `Linked migration history is at required predecessor ${history.remoteTip}.`,
  )

  let phaseRoot
  try {
    const isolated = createIsolatedPhaseWorkspace(phase.id)
    phaseRoot = isolated.phaseRoot
    const baseArguments = ['db', 'push', '--linked', '--workdir', phaseRoot]

    // An apply always performs the native Supabase dry-run first using the
    // exact same isolated migration manifest. No psql or manual history writes
    // are used, so successful changes retain normal migration-history records.
    runSupabase([...baseArguments, '--dry-run'], spawn, environment)
    if (options.dryRun) {
      log(`Approved apply requires: --confirm ${rolloutConfirmation(options.environment, phase.id)}`)
    }
    if (options.apply) {
      runSupabase(baseArguments, spawn, environment)
      runSupabase(['migration', 'list', '--linked', '--workdir', phaseRoot], spawn, environment)
    }
  } finally {
    if (phaseRoot) removeIsolatedPhaseWorkspace(phaseRoot)
  }

  return {
    phase,
    migrationNames,
    dryRun: options.dryRun,
    applied: options.apply,
  }
}

function isDirectInvocation() {
  return Boolean(process.argv[1])
    && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
}

if (isDirectInvocation()) {
  try {
    runRemediationRolloutPhase()
  } catch (error) {
    console.error(`Remediation rollout phase failed: ${error.message}`)
    process.exitCode = 1
  }
}
