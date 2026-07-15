#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOST = '127.0.0.1'
const PORT = 4173
const BASE_URL = `http://${HOST}:${PORT}`
const VITE_CLI = resolve(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
const PLAYWRIGHT_CLI = resolve(
  REPO_ROOT,
  'node_modules',
  '@playwright',
  'test',
  'cli.js',
)
const IS_WINDOWS = process.platform === 'win32'
const CHILD_OPTIONS = {
  cwd: REPO_ROOT,
  detached: !IS_WINDOWS,
  stdio: ['ignore', 'inherit', 'inherit'],
}

const viteEnvironment = {
  ...process.env,
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
  // Browser requests are intercepted by the E2E harness. A JWT-shaped
  // placeholder keeps client initialization realistic without using a key.
  VITE_SUPABASE_ANON_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.e2e',
}

const childExitPromises = new WeakMap()

function childExit(child) {
  const existing = childExitPromises.get(child)
  if (existing) return existing

  const exit = new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit)
    child.once('exit', (code, signal) => resolveExit({ code, signal }))
  })
  childExitPromises.set(child, exit)
  return exit
}

async function waitForServer() {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE_URL, {
        signal: AbortSignal.timeout(1_000),
      })
      if (response.ok) return
    } catch {
      // Vite may still be starting. Retry until the bounded deadline.
    }
    await delay(250)
  }
  throw new Error(`Vite did not become ready at ${BASE_URL} within 120 seconds.`)
}

async function waitForChildExit(child, timeoutMs) {
  if (!child?.pid) return true
  const exitObserved = childExit(child).then(() => true, () => true)
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return true
    try {
      process.kill(child.pid, 0)
    } catch (error) {
      if (error?.code === 'ESRCH') return true
      if (error?.code !== 'EPERM') throw error
    }
    if (await Promise.race([exitObserved, delay(100).then(() => false)])) {
      return true
    }
  }

  return false
}

async function killWindowsProcessTree(pid) {
  const taskkillPath = process.env.SystemRoot
    ? resolve(process.env.SystemRoot, 'System32', 'taskkill.exe')
    : 'taskkill.exe'
  const taskkill = spawn(
    taskkillPath,
    ['/PID', String(pid), '/T', '/F'],
    {
      cwd: REPO_ROOT,
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    },
  )
  const outcome = await Promise.race([
    childExit(taskkill).then(exit => ({ finished: true, exit })),
    delay(5_000).then(() => ({ finished: false })),
  ])
  if (!outcome.finished) {
    taskkill.kill()
    throw new Error(`Timed out while stopping child process tree ${pid}.`)
  }
  return outcome.exit
}

function signalPosixProcessGroup(child, signal) {
  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

async function stopChild(child, { forceTree = false } = {}) {
  if (
    !child
    || !child.pid
    || child.exitCode !== null
    || child.signalCode !== null
  ) return

  if (IS_WINDOWS) {
    if (!forceTree) {
      child.kill()
      if (await waitForChildExit(child, 5_000)) return
    }

    const taskkillExit = await killWindowsProcessTree(child.pid)
    if (taskkillExit.code === 0) {
      // taskkill has synchronously confirmed termination of the whole tree.
      // Node can be slow to publish the child's exit event on Windows.
      child.unref()
      return
    }

    const signalDelivered = child.kill()
    if (!signalDelivered) {
      child.unref()
      return
    }
    if (!await waitForChildExit(child, 5_000)) {
      throw new Error(`Child process tree ${child.pid} did not stop.`)
    }
    return
  }

  signalPosixProcessGroup(child, 'SIGTERM')
  const stopped = await waitForChildExit(child, 5_000)

  if (!stopped && child.exitCode === null && child.signalCode === null) {
    signalPosixProcessGroup(child, 'SIGKILL')
    if (!await waitForChildExit(child, 5_000)) {
      throw new Error(`Child process group ${child.pid} did not stop.`)
    }
  }
}

const vite = spawn(
  process.execPath,
  [VITE_CLI, '--host', HOST, '--port', String(PORT), '--strictPort'],
  {
    ...CHILD_OPTIONS,
    env: viteEnvironment,
  },
)
const viteExit = childExit(vite)
let playwright
let interruptedSignal
let resolveInterruption
const interruption = new Promise(resolveInterrupt => {
  resolveInterruption = resolveInterrupt
})

const handleSignal = signal => {
  if (interruptedSignal) return
  interruptedSignal = signal
  resolveInterruption({ source: 'interrupt' })
}
const handleSigint = () => handleSignal('SIGINT')
const handleSigterm = () => handleSignal('SIGTERM')

process.once('SIGINT', handleSigint)
process.once('SIGTERM', handleSigterm)

try {
  const startup = await Promise.race([
    waitForServer().then(() => ({ source: 'ready' })),
    viteExit.then(exit => ({ source: 'vite', exit })),
    interruption,
  ])
  if (startup.source === 'interrupt') {
    process.exitCode = interruptedSignal === 'SIGINT' ? 130 : 143
  } else if (startup.source === 'vite') {
    const { code, signal } = startup.exit
    throw new Error(
      `Vite exited before it became ready (code ${code ?? 'none'}, signal ${signal ?? 'none'}).`,
    )
  } else {
    playwright = spawn(
      process.execPath,
      [PLAYWRIGHT_CLI, 'test', '--project=chromium', ...process.argv.slice(2)],
      {
        ...CHILD_OPTIONS,
        env: {
          ...process.env,
          PLAYWRIGHT_SKIP_WEBSERVER: '1',
        },
      },
    )

    const outcome = await Promise.race([
      childExit(playwright).then(exit => ({ source: 'playwright', exit })),
      viteExit.then(exit => ({ source: 'vite', exit })),
      interruption,
    ])
    if (outcome.source === 'interrupt') {
      process.exitCode = interruptedSignal === 'SIGINT' ? 130 : 143
    } else if (outcome.source === 'vite') {
      await stopChild(playwright, { forceTree: true })
      const { code, signal } = outcome.exit
      throw new Error(
        `Vite exited during the browser suite (code ${code ?? 'none'}, signal ${signal ?? 'none'}).`,
      )
    } else {
      const { code, signal } = outcome.exit
      if (signal) {
        throw new Error(`Playwright exited from signal ${signal}.`)
      }
      process.exitCode = code ?? 1
    }
  }

} finally {
  process.removeListener('SIGINT', handleSigint)
  process.removeListener('SIGTERM', handleSigterm)
  const forceTree = Boolean(interruptedSignal)
  await stopChild(playwright, { forceTree })
  await stopChild(vite, { forceTree })
}
