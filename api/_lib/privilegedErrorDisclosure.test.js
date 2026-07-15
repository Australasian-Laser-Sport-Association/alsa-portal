import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const ROUTES = [
  ['admin event', new URL('../admin/event.js', import.meta.url)],
  ['consolidated competition', new URL('../superadmin/[resource].js', import.meta.url)],
]

describe('privileged API unexpected-error boundaries', () => {
  it.each(ROUTES)('%s route has no direct 500 response that can expose internals', async (_name, url) => {
    const source = await readFile(url, 'utf8')

    // Unexpected failures must pass through sendServerError so database,
    // storage, and auth-provider details remain server-side. Known domain
    // failures may still use explicit 4xx mappings elsewhere in these files.
    expect(source).not.toMatch(/\.status\s*\([^)]*\b500\b[^)]*\)\s*\.json\s*\(/)
    expect(source).not.toMatch(/\bstatus\s*:\s*500\b/)
    expect(source).not.toMatch(/error\s*:\s*\w+\.map\s*\([^)]*\.message[^)]*\)\.join\s*\(/)
    expect(source).toMatch(/sendServerError\s*\(/)
  })
})
