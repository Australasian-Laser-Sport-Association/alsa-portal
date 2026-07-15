#!/usr/bin/env node

import { existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CHECKED_RELEASE_VARIABLES } from './check-release-environment.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

function takeOptionValue(argv, index, option) {
  const argument = argv[index]
  if (argument === option) {
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}.`)
    return { value, consumed: 2 }
  }
  if (argument.startsWith(`${option}=`)) {
    const value = argument.slice(option.length + 1)
    if (!value) throw new Error(`Missing value for ${option}.`)
    return { value, consumed: 1 }
  }
  return null
}

export function parseVercelReleaseArguments(argv) {
  const options = { forbiddenSupabaseProjectRefs: [] }
  for (let index = 0; index < argv.length;) {
    const candidates = [
      ['--target', 'target'],
      ['--git-branch', 'gitBranch'],
      ['--expected-supabase-project-ref', 'expectedSupabaseProjectRef'],
      ['--forbid-supabase-project-ref', 'forbiddenSupabaseProjectRefs'],
    ]
    let matched = false
    for (const [option, property] of candidates) {
      const parsed = takeOptionValue(argv, index, option)
      if (!parsed) continue
      if (property === 'forbiddenSupabaseProjectRefs') options[property].push(parsed.value)
      else options[property] = parsed.value
      index += parsed.consumed
      matched = true
      break
    }
    if (!matched) throw new Error('Unknown guarded Vercel environment-check option.')
  }
  return options
}

export function rootDotenvOverrides(root = REPO_ROOT) {
  return readdirSync(root, { withFileTypes: true })
    .map(entry => entry.name)
    .filter(name => name === '.env' || (name.startsWith('.env.') && name !== '.env.example'))
    .sort()
}

export function hasLinkedVercelProject(root = REPO_ROOT) {
  return existsSync(resolve(root, '.vercel', 'project.json'))
    || existsSync(resolve(root, '.vercel', 'repo.json'))
}

export function vercelProcessInvocation(vercelArguments, {
  platform = process.platform,
  environment = process.env,
} = {}) {
  if (platform === 'win32') {
    return {
      command: environment.ComSpec || environment.COMSPEC || 'cmd.exe',
      arguments: ['/d', '/s', '/c', 'vercel', ...vercelArguments],
    }
  }
  return { command: 'vercel', arguments: vercelArguments }
}

function validatedOptions(options) {
  if (!['production', 'preview'].includes(options.target)) {
    throw new Error('Target must be production or preview.')
  }

  const expected = String(options.expectedSupabaseProjectRef ?? '').trim().toLowerCase()
  const forbidden = (options.forbiddenSupabaseProjectRefs ?? [])
    .map(value => String(value).trim().toLowerCase())
    .filter(Boolean)
  if (!PROJECT_REF_PATTERN.test(expected)) {
    throw new Error('A valid independently recorded expected Supabase project ref is required.')
  }
  if (forbidden.length === 0 || forbidden.some(ref => !PROJECT_REF_PATTERN.test(ref))) {
    throw new Error('At least one valid independently recorded forbidden Supabase project ref is required.')
  }
  if (forbidden.some(ref => ref === expected)) {
    throw new Error('Expected and forbidden Supabase project refs must be different.')
  }

  const gitBranch = String(options.gitBranch ?? '').trim()
  if (options.target === 'preview' && !BRANCH_PATTERN.test(gitBranch)) {
    throw new Error('Preview validation requires a safe explicit --git-branch value.')
  }
  if (options.target === 'production' && gitBranch) {
    throw new Error('--git-branch is only valid for preview checks.')
  }

  return { ...options, expected, forbidden, gitBranch }
}

export function sanitizedVercelParentEnvironment(environment, { expected, forbidden }) {
  const sanitized = { ...environment }
  for (const name of CHECKED_RELEASE_VARIABLES) delete sanitized[name]
  delete sanitized.ALSA_EXPECTED_SUPABASE_PROJECT_REF
  delete sanitized.ALSA_FORBIDDEN_SUPABASE_PROJECT_REFS
  // These variables override the repository's linked Vercel project. Keeping
  // them would let an unrelated exported shell setting select a different
  // project than the one the maintainer just inspected.
  delete sanitized.VERCEL_ORG_ID
  delete sanitized.VERCEL_PROJECT_ID

  // These two values are intentionally independent local release evidence.
  // Vercel's process-environment precedence keeps them authoritative while all
  // variables under inspection have been removed from the parent environment.
  sanitized.ALSA_EXPECTED_SUPABASE_PROJECT_REF = expected
  sanitized.ALSA_FORBIDDEN_SUPABASE_PROJECT_REFS = forbidden.join(',')
  return sanitized
}

export function runGuardedVercelEnvironmentCheck({
  argv = process.argv.slice(2),
  environment = process.env,
  dotenvOverrides = rootDotenvOverrides(),
  linkedProject = hasLinkedVercelProject(),
  spawn = spawnSync,
  platform = process.platform,
} = {}) {
  const options = validatedOptions(parseVercelReleaseArguments(argv))
  if (dotenvOverrides.length > 0) {
    throw new Error(
      'Root dotenv overrides are present. Move them outside the repository before validating a remote Vercel scope.',
    )
  }
  if (!linkedProject) {
    throw new Error('This checkout is not linked to a Vercel project. Link and independently verify the intended project first.')
  }

  const vercelArguments = ['env', 'run', '-e', options.target]
  if (options.target === 'preview') {
    vercelArguments.push('--git-branch', options.gitBranch)
  }
  vercelArguments.push(
    '--',
    'node',
    'scripts/check-release-environment.mjs',
    '--target',
    options.target,
  )

  const invocation = vercelProcessInvocation(vercelArguments, { platform, environment })
  const result = spawn(invocation.command, invocation.arguments, {
    cwd: REPO_ROOT,
    env: sanitizedVercelParentEnvironment(environment, options),
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error('Vercel CLI was not found. Install and authenticate it before release validation.')
    }
    throw new Error('The guarded Vercel environment check could not start.')
  }
  if (result.status !== 0) {
    throw new Error('The guarded Vercel environment check failed.')
  }
  return { target: options.target, checked: true }
}

function isDirectInvocation() {
  return Boolean(process.argv[1])
    && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
}

if (isDirectInvocation()) {
  try {
    runGuardedVercelEnvironmentCheck()
  } catch (error) {
    console.error(`Guarded Vercel environment check failed: ${error.message}`)
    process.exitCode = 1
  }
}
