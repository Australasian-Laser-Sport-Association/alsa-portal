#!/usr/bin/env node
// Lists active SVG objects in public upload buckets. Dry-run by default;
// pass --apply to permanently remove the listed objects through the Storage API.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TARGET_BUCKETS = ['team-logos', 'referee-test-media']

function parseDotenv(filePath) {
  try {
    const values = {}
    for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const match = rawLine.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!match) continue
      let value = match[2]
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      values[match[1]] = value
    }
    return values
  } catch {
    return {}
  }
}

function loadEnv() {
  return {
    ...parseDotenv(resolve(REPO_ROOT, '.env')),
    ...parseDotenv(resolve(REPO_ROOT, '.env.local')),
    ...process.env,
  }
}

function isActiveSvg(item) {
  const mime = item.metadata?.mimetype ?? item.metadata?.contentType ?? ''
  return item.name.toLowerCase().endsWith('.svg') || mime.toLowerCase() === 'image/svg+xml'
}

async function listObjects(storage, bucket, prefix = '') {
  const objects = []
  const limit = 100
  for (let offset = 0; ; offset += limit) {
    const { data, error } = await storage.from(bucket).list(prefix, {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    })
    if (error) throw new Error(`${bucket}/${prefix || '<root>'}: ${error.message}`)
    for (const item of data ?? []) {
      const path = prefix ? `${prefix}/${item.name}` : item.name
      if (item.id == null) objects.push(...await listObjects(storage, bucket, path))
      else objects.push({ ...item, path })
    }
    if ((data ?? []).length < limit) break
  }
  return objects
}

async function main() {
  const apply = process.argv.includes('--apply')
  const env = loadEnv()
  if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
  }

  const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let total = 0
  for (const bucket of TARGET_BUCKETS) {
    const matches = (await listObjects(supabase.storage, bucket)).filter(isActiveSvg)
    total += matches.length
    console.log(`${bucket}: ${matches.length} active SVG object(s)`)
    for (const item of matches) console.log(`  ${item.path}`)

    if (apply && matches.length > 0) {
      for (let index = 0; index < matches.length; index += 100) {
        const paths = matches.slice(index, index + 100).map(item => item.path)
        const { error } = await supabase.storage.from(bucket).remove(paths)
        if (error) throw new Error(`${bucket}: ${error.message}`)
      }
    }
  }

  console.log(apply
    ? `Removed ${total} active SVG object(s).`
    : `Dry run complete. Re-run with --apply to remove ${total} object(s).`)
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})

