#!/usr/bin/env node
// ============================================================================
// Backfill zltac_event_history.description (= static `notes`) and
// zltac_event_history.historic_note (= static `historicNote`).
//
// Idempotent: only updates rows where the target column is currently NULL.
// Safe to re-run.
//
// Default behaviour: DRY-RUN (lists what it *would* update).
// With --commit: applies the updates.
//
// Env (only required with --commit):
//   VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// ============================================================================

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const DATA_FILE = resolve(REPO_ROOT, 'src/data/zltacHistory.js')


function parseDotenv(filePath) {
  try {
    const text = readFileSync(filePath, 'utf8')
    const out = {}
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!m) continue
      let value = m[2]
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      out[m[1]] = value
    }
    return out
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


async function main() {
  const isCommit = process.argv.includes('--commit')

  const dataUrl = pathToFileURL(DATA_FILE).href
  const { zltacHistory } = await import(dataUrl)

  // Build the source-of-truth maps.
  const notesByYear = new Map()        // year → notes
  const historicByYear = new Map()     // year → historicNote
  for (const ev of zltacHistory.events) {
    if (typeof ev.notes === 'string' && ev.notes.trim()) {
      notesByYear.set(ev.year, ev.notes.trim())
    }
    if (typeof ev.historicNote === 'string' && ev.historicNote.trim()) {
      historicByYear.set(ev.year, ev.historicNote.trim())
    }
  }
  console.log(`Static source: ${notesByYear.size} notes, ${historicByYear.size} historicNote(s)`)

  const env = loadEnv()
  const url = env.VITE_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const { data: rows, error } = await supabase
    .from('zltac_event_history')
    .select('year, description, historic_note')
    .order('year')
  if (error) throw new Error(`Read failed: ${error.message}`)

  const descPlan = []        // rows we would update (description was NULL)
  const histPlan = []        // rows we would update (historic_note was NULL)
  const descSkipped = []     // already populated
  const histSkipped = []

  for (const row of rows) {
    const expectedNotes = notesByYear.get(row.year)
    if (expectedNotes) {
      if (row.description == null || row.description === '') {
        descPlan.push({ year: row.year, value: expectedNotes })
      } else {
        descSkipped.push({ year: row.year, existing: row.description })
      }
    }
    const expectedHistoric = historicByYear.get(row.year)
    if (expectedHistoric) {
      if (row.historic_note == null || row.historic_note === '') {
        histPlan.push({ year: row.year, value: expectedHistoric })
      } else {
        histSkipped.push({ year: row.year, existing: row.historic_note })
      }
    }
  }

  console.log('')
  console.log(`description: ${descPlan.length} to update, ${descSkipped.length} already populated (skipped)`)
  for (const p of descPlan) console.log(`  ${p.year}: ${p.value.slice(0, 80)}${p.value.length > 80 ? '…' : ''}`)
  if (descSkipped.length > 0) {
    console.log('  (existing values not overwritten:)')
    for (const s of descSkipped) console.log(`  ${s.year}: ${String(s.existing).slice(0, 60)}…`)
  }

  console.log('')
  console.log(`historic_note: ${histPlan.length} to update, ${histSkipped.length} already populated (skipped)`)
  for (const p of histPlan) console.log(`  ${p.year}: ${p.value}`)

  // Sanity: years referenced in the static file but with no DB row
  const dbYears = new Set(rows.map(r => r.year))
  const orphans = []
  for (const y of new Set([...notesByYear.keys(), ...historicByYear.keys()])) {
    if (!dbYears.has(y)) orphans.push(y)
  }
  if (orphans.length > 0) {
    console.log('')
    console.log(`WARNING: static years with no zltac_event_history row: ${orphans.join(', ')}`)
  }

  if (!isCommit) {
    console.log('')
    console.log('Dry-run. Re-run with --commit to apply.')
    return
  }

  // --commit: apply
  console.log('')
  console.log('Applying updates…')
  for (const p of descPlan) {
    const { error } = await supabase
      .from('zltac_event_history')
      .update({ description: p.value })
      .eq('year', p.year)
      .is('description', null)   // belt-and-braces idempotency at the DB level
    if (error) throw new Error(`description update failed for year ${p.year}: ${error.message}`)
  }
  for (const p of histPlan) {
    const { error } = await supabase
      .from('zltac_event_history')
      .update({ historic_note: p.value })
      .eq('year', p.year)
      .is('historic_note', null)
    if (error) throw new Error(`historic_note update failed for year ${p.year}: ${error.message}`)
  }
  console.log(`Done. Updated description for ${descPlan.length} rows, historic_note for ${histPlan.length} rows.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
