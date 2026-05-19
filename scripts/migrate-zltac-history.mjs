#!/usr/bin/env node
// ============================================================================
// ZLTAC history → Supabase migration script (Phase 1)
//
// Default behaviour: DRY-RUN.
//   * Reads src/data/zltacHistory.js
//   * Validates everything (Hall of Fame, events/placings, legends, dynasties)
//   * Writes a markdown report to scripts/zltac-migration-report.md
//   * Exits 0 if no errors, 1 if errors (warnings/info don't block)
//
// With --commit:
//   * Re-runs validation
//   * Refuses to commit if any errors are present
//   * Otherwise inserts the four datasets into Supabase
//     (zltac_hall_of_fame, zltac_event_placings, zltac_legends, zltac_dynasties)
//     and patches zltac_event_history rows with year-level fields
//     (is_cancelled / is_upcoming / team_count / location_country) where
//     they're missing.
//
// Env (only required with --commit):
//   VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Run:
//   node scripts/migrate-zltac-history.mjs            # dry-run
//   node scripts/migrate-zltac-history.mjs --commit   # writes to Supabase
// ============================================================================

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const DATA_FILE = resolve(REPO_ROOT, 'src/data/zltacHistory.js')
const REPORT_FILE = resolve(__dirname, 'zltac-migration-report.md')

const VALID_DIVISIONS = ['team', 'solos', 'doubles', 'triples', 'masters', 'womens', 'juniors', 'lotr']
const CURRENT_YEAR = new Date().getFullYear()

const PLACEHOLDER_CONTRIBUTION_RE = /^\s*(tba|tbd|to be added|placeholder|n\/?a|-)\s*$/i


// ---------------------------------------------------------------------------
// Findings collector
// ---------------------------------------------------------------------------

class Findings {
  constructor() {
    this.sections = {
      hallOfFame: [],
      events: [],
      legends: [],
      dynasties: [],
      crossRef: [],
    }
  }

  add(section, severity, location, message) {
    this.sections[section].push({ severity, location, message })
  }

  counts() {
    const out = {}
    for (const [name, items] of Object.entries(this.sections)) {
      out[name] = {
        error: items.filter(i => i.severity === 'error').length,
        warn:  items.filter(i => i.severity === 'warn').length,
        info:  items.filter(i => i.severity === 'info').length,
        total: items.length,
      }
    }
    out.total = {
      error: Object.values(out).reduce((s, c) => s + (c.error ?? 0), 0),
      warn:  Object.values(out).reduce((s, c) => s + (c.warn  ?? 0), 0),
      info:  Object.values(out).reduce((s, c) => s + (c.info  ?? 0), 0),
    }
    return out
  }

  hasErrors() {
    return Object.values(this.sections).some(items => items.some(i => i.severity === 'error'))
  }
}


// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

function validateHallOfFame(hof, findings) {
  if (!Array.isArray(hof)) {
    findings.add('hallOfFame', 'error', '<root>', 'hallOfFame is not an array')
    return
  }

  const aliasIndex = new Map()      // alias (lower) → [indices]
  const realNameIndex = new Map()   // realName (lower) → [indices]

  hof.forEach((entry, i) => {
    const loc = `index ${i} (${entry?.realName ?? '?'} / ${entry?.alias ?? '?'})`

    if (!entry || typeof entry !== 'object') {
      findings.add('hallOfFame', 'error', `index ${i}`, 'entry is not an object')
      return
    }

    const { realName, alias, inductionYear, contribution } = entry

    if (typeof realName !== 'string' || realName.trim() === '') {
      findings.add('hallOfFame', 'error', loc, 'realName is empty or missing')
    } else {
      const key = realName.trim().toLowerCase()
      const arr = realNameIndex.get(key) ?? []
      arr.push(i)
      realNameIndex.set(key, arr)
    }

    if (typeof alias !== 'string' || alias.trim() === '') {
      findings.add('hallOfFame', 'warn', loc, 'alias is empty')
    } else {
      const key = alias.trim().toLowerCase()
      const arr = aliasIndex.get(key) ?? []
      arr.push(i)
      aliasIndex.set(key, arr)
    }

    if (!Number.isInteger(inductionYear)) {
      findings.add('hallOfFame', 'error', loc, `inductionYear is not an integer (got: ${JSON.stringify(inductionYear)})`)
    } else if (inductionYear < 1999 || inductionYear > CURRENT_YEAR + 1) {
      findings.add('hallOfFame', 'error', loc, `inductionYear out of plausible range: ${inductionYear} (allowed 1999..${CURRENT_YEAR + 1})`)
    }

    if (typeof contribution !== 'string' || contribution.trim() === '') {
      findings.add('hallOfFame', 'warn', loc, 'contribution is empty')
    } else if (PLACEHOLDER_CONTRIBUTION_RE.test(contribution)) {
      findings.add('hallOfFame', 'warn', loc, `contribution looks like a placeholder: "${contribution.trim()}"`)
    }
  })

  for (const [key, indices] of aliasIndex) {
    if (indices.length > 1) {
      findings.add('hallOfFame', 'error', `indices ${indices.join(', ')}`, `duplicate alias "${key}"`)
    }
  }
  for (const [key, indices] of realNameIndex) {
    if (indices.length > 1) {
      findings.add('hallOfFame', 'error', `indices ${indices.join(', ')}`, `duplicate realName "${key}"`)
    }
  }
}


function validateEvents(events, findings) {
  if (!Array.isArray(events)) {
    findings.add('events', 'error', '<root>', 'events is not an array')
    return
  }

  const yearIndex = new Map()

  events.forEach((event, i) => {
    const year = event?.year
    const loc = `events[${i}] (year ${year ?? '?'})`

    if (!Number.isInteger(year)) {
      findings.add('events', 'error', loc, 'year is missing or not an integer')
      return
    }
    const yearArr = yearIndex.get(year) ?? []
    yearArr.push(i)
    yearIndex.set(year, yearArr)

    const isCancelled = !!event.cancelled
    const isUpcoming  = !!event.upcoming

    if (!event.divisions && !isCancelled && !isUpcoming) {
      findings.add('events', 'error', loc, 'missing divisions object (and not flagged cancelled/upcoming)')
      return
    }

    if (event.divisions && typeof event.divisions === 'object') {
      for (const [div, list] of Object.entries(event.divisions)) {
        const divLoc = `${loc} → divisions.${div}`

        if (!VALID_DIVISIONS.includes(div)) {
          findings.add('events', 'error', divLoc, `division key "${div}" not in enum [${VALID_DIVISIONS.join(', ')}]`)
          continue
        }

        if (!Array.isArray(list)) {
          findings.add('events', 'error', divLoc, 'expected array, got ' + typeof list)
          continue
        }

        // Per-entry checks
        const rankSeen = new Map() // rank → indices
        list.forEach((entry, j) => {
          const entryLoc = `${divLoc}[${j}]`
          if (!entry || typeof entry !== 'object') {
            findings.add('events', 'error', entryLoc, 'entry is not an object')
            return
          }
          if (!Number.isInteger(entry.rank)) {
            findings.add('events', 'error', entryLoc, 'rank is missing or not an integer')
          } else {
            const arr = rankSeen.get(entry.rank) ?? []
            arr.push(j)
            rankSeen.set(entry.rank, arr)
          }
          if (typeof entry.name !== 'string' || entry.name.trim() === '') {
            findings.add('events', 'error', entryLoc, 'name is empty or not a string')
          }
        })

        // Duplicate ranks
        for (const [rank, indices] of rankSeen) {
          if (indices.length > 1) {
            findings.add('events', 'error', divLoc, `duplicate rank ${rank} at entry indices ${indices.join(', ')}`)
          }
        }

        // Rank gaps (only warn — sometimes there's a legit reason)
        if (rankSeen.size > 0) {
          const ranks = Array.from(rankSeen.keys()).sort((a, b) => a - b)
          const min = ranks[0]
          const max = ranks[ranks.length - 1]
          if (min !== 1) {
            findings.add('events', 'warn', divLoc, `ranks do not start at 1 (lowest is ${min})`)
          }
          for (let r = min; r <= max; r++) {
            if (!rankSeen.has(r)) {
              findings.add('events', 'warn', divLoc, `gap: rank ${r} is missing (ranks present: ${ranks.join(', ')})`)
            }
          }
        }
      }
    }
  })

  for (const [year, indices] of yearIndex) {
    if (indices.length > 1) {
      findings.add('events', 'error', `years ${year}`, `duplicate event entries at indices ${indices.join(', ')}`)
    }
  }
}


function validateLegends(legends, findings) {
  if (!Array.isArray(legends)) {
    findings.add('legends', 'error', '<root>', 'legends is not an array')
    return
  }

  legends.forEach((entry, i) => {
    const loc = `legends[${i}] (${entry?.alias ?? '?'})`
    if (!entry || typeof entry !== 'object') {
      findings.add('legends', 'error', `legends[${i}]`, 'entry is not an object')
      return
    }
    if (typeof entry.alias !== 'string' || entry.alias.trim() === '') {
      findings.add('legends', 'error', loc, 'alias is missing or empty')
    }
    if (typeof entry.titles === 'string' && entry.titles.length > 0) {
      const t = entry.titles
      if (/^\s*·/.test(t)) findings.add('legends', 'warn', loc, 'titles has a leading " · " separator')
      if (/·\s*$/.test(t)) findings.add('legends', 'warn', loc, 'titles has a trailing " · " separator')
      if (/·\s*·/.test(t)) findings.add('legends', 'warn', loc, 'titles has consecutive " · " separators')
      const segments = t.split(' · ')
      segments.forEach((seg, k) => {
        if (seg.trim() === '') {
          findings.add('legends', 'warn', loc, `titles segment #${k} is empty`)
        }
      })
    }
  })
}


function validateDynasties(dynasties, findings) {
  if (!dynasties || typeof dynasties !== 'object') {
    findings.add('dynasties', 'error', '<root>', 'dynasties is missing or not an object')
    return
  }

  function isConsecutive(years, expectedLength) {
    if (!Array.isArray(years) || years.length !== expectedLength) return false
    for (let i = 0; i < years.length; i++) {
      if (!Number.isInteger(years[i])) return false
      if (i > 0 && years[i] !== years[i - 1] + 1) return false
    }
    return true
  }

  const threePeats = Array.isArray(dynasties.threePeats) ? dynasties.threePeats : []
  threePeats.forEach((d, i) => {
    const loc = `threePeats[${i}] (${d?.team ?? '?'})`
    if (!isConsecutive(d?.years, 3)) {
      findings.add('dynasties', 'error', loc, `three-peat requires 3 consecutive years; got ${JSON.stringify(d?.years)}`)
    }
  })

  const backToBack = Array.isArray(dynasties.backToBack) ? dynasties.backToBack : []
  backToBack.forEach((d, i) => {
    const loc = `backToBack[${i}] (${d?.team ?? '?'})`
    if (!isConsecutive(d?.years, 2)) {
      findings.add('dynasties', 'error', loc, `back-to-back requires 2 consecutive years; got ${JSON.stringify(d?.years)}`)
    }
  })
}


function validateCrossRefs(zltacHistory, findings) {
  const placingNames = new Set()
  const events = Array.isArray(zltacHistory.events) ? zltacHistory.events : []
  for (const event of events) {
    if (!event.divisions) continue
    for (const list of Object.values(event.divisions)) {
      if (!Array.isArray(list)) continue
      for (const entry of list) {
        if (typeof entry?.name === 'string') {
          placingNames.add(entry.name.toLowerCase())
        }
        if (typeof entry?.subtitle === 'string' && entry.subtitle) {
          placingNames.add(entry.subtitle.toLowerCase())
        }
      }
    }
  }

  // Helper: does any placing name *contain* the alias (case-insensitive)?
  function aliasAppearsInPlacings(alias) {
    if (!alias) return false
    const a = alias.toLowerCase()
    for (const n of placingNames) {
      if (n.includes(a)) return true
    }
    return false
  }

  const legendAliases = new Set(
    (Array.isArray(zltacHistory.legends) ? zltacHistory.legends : [])
      .map(l => l?.alias?.toLowerCase())
      .filter(Boolean)
  )

  for (const inductee of (zltacHistory.hallOfFame ?? [])) {
    const alias = inductee?.alias
    if (!alias) continue
    const a = alias.toLowerCase()
    const inPlacing = aliasAppearsInPlacings(alias)
    const inLegend = legendAliases.has(a)
    if (!inPlacing && !inLegend) {
      findings.add(
        'crossRef',
        'info',
        `Hall of Fame: ${inductee.realName} (${alias})`,
        'alias does not appear in any placing or legend — may indicate a name spelling drift'
      )
    }
  }

  for (const legend of (zltacHistory.legends ?? [])) {
    const alias = legend?.alias
    if (!alias) continue
    if (!aliasAppearsInPlacings(alias)) {
      // For legends, the alias might be a compound like "CV (CaptainVegetable)" or
      // "Sinclair / Gwai Lo / Belfast" — check each token too.
      const tokens = alias
        .split(/[\/(),]| & /)
        .map(t => t.trim())
        .filter(Boolean)
      const anyTokenInPlacing = tokens.some(t => aliasAppearsInPlacings(t))
      if (!anyTokenInPlacing) {
        findings.add(
          'crossRef',
          'info',
          `Legend: ${alias}`,
          'alias (and its tokens) do not appear in any placing'
        )
      }
    }
  }
}


// ---------------------------------------------------------------------------
// Report writer
// ---------------------------------------------------------------------------

function severityIcon(s) {
  return s === 'error' ? '[ERROR]' : s === 'warn' ? '[warn]' : '[info]'
}

function buildReport(zltacHistory, findings, mode) {
  const counts = findings.counts()
  const hofCount = Array.isArray(zltacHistory.hallOfFame) ? zltacHistory.hallOfFame.length : 0
  const eventsCount = Array.isArray(zltacHistory.events) ? zltacHistory.events.length : 0
  const legendsCount = Array.isArray(zltacHistory.legends) ? zltacHistory.legends.length : 0
  const threePeats = zltacHistory.dynasties?.threePeats?.length ?? 0
  const backToBack = zltacHistory.dynasties?.backToBack?.length ?? 0

  // Count rows that would be inserted into zltac_event_placings.
  let placingRowCount = 0
  for (const ev of (zltacHistory.events ?? [])) {
    if (!ev.divisions) continue
    for (const list of Object.values(ev.divisions)) {
      if (Array.isArray(list)) placingRowCount += list.length
    }
  }

  const lines = []
  lines.push('# ZLTAC history migration — dry-run report')
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push(`Mode: ${mode}`)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push('### Source rows discovered')
  lines.push('')
  lines.push(`- Hall of Fame inductees: **${hofCount}**`)
  lines.push(`- Event years: **${eventsCount}** (would produce **${placingRowCount}** rows in \`zltac_event_placings\`)`)
  lines.push(`- Legends: **${legendsCount}**`)
  lines.push(`- Dynasties: **${threePeats + backToBack}** (three-peats: ${threePeats}, back-to-back: ${backToBack})`)
  lines.push('')
  lines.push('### Findings by category')
  lines.push('')
  lines.push('| Section | Errors | Warnings | Info |')
  lines.push('|---|---:|---:|---:|')
  lines.push(`| Hall of Fame | ${counts.hallOfFame.error} | ${counts.hallOfFame.warn} | ${counts.hallOfFame.info} |`)
  lines.push(`| Events       | ${counts.events.error}     | ${counts.events.warn}     | ${counts.events.info} |`)
  lines.push(`| Legends      | ${counts.legends.error}    | ${counts.legends.warn}    | ${counts.legends.info} |`)
  lines.push(`| Dynasties    | ${counts.dynasties.error}  | ${counts.dynasties.warn}  | ${counts.dynasties.info} |`)
  lines.push(`| Cross-ref    | ${counts.crossRef.error}   | ${counts.crossRef.warn}   | ${counts.crossRef.info} |`)
  lines.push(`| **Total**    | **${counts.total.error}** | **${counts.total.warn}** | **${counts.total.info}** |`)
  lines.push('')
  lines.push(findings.hasErrors()
    ? '> **Result:** errors present — `--commit` will refuse to run until they are resolved in `src/data/zltacHistory.js`.'
    : '> **Result:** no errors — safe to re-run with `--commit` after reviewing warnings.')
  lines.push('')

  function section(title, key) {
    lines.push(`## ${title}`)
    lines.push('')
    const items = findings.sections[key]
    if (items.length === 0) {
      lines.push('_No findings._')
      lines.push('')
      return
    }
    // Sort: errors first, then warnings, then info
    const order = { error: 0, warn: 1, info: 2 }
    const sorted = items.slice().sort((a, b) => order[a.severity] - order[b.severity])
    for (const it of sorted) {
      lines.push(`- ${severityIcon(it.severity)} \`${it.location}\` — ${it.message}`)
    }
    lines.push('')
  }

  section('Hall of Fame', 'hallOfFame')
  section('Events / placings', 'events')
  section('Legends', 'legends')
  section('Dynasties', 'dynasties')
  section('Cross-reference (informational)', 'crossRef')

  return lines.join('\n')
}


// ---------------------------------------------------------------------------
// Commit mode (Supabase inserts)
// ---------------------------------------------------------------------------

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
      // Strip surrounding quotes if present
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
  const merged = {
    ...parseDotenv(resolve(REPO_ROOT, '.env')),
    ...parseDotenv(resolve(REPO_ROOT, '.env.local')),
    ...process.env,
  }
  return merged
}

async function commit(zltacHistory) {
  const env = loadEnv()
  const url = env.VITE_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Cannot commit: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env or the environment.')
    process.exit(1)
  }

  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  // 0. Pre-flight: refuse if any of the four target tables already has data.
  //    Prevents a re-run from double-inserting (the four tables have no
  //    natural unique key beyond the surrogate id, so duplicates can't be
  //    caught at the DB level for HoF/legends/dynasties).
  const preflightTables = [
    'zltac_hall_of_fame',
    'zltac_event_placings',
    'zltac_legends',
    'zltac_dynasties',
  ]
  for (const t of preflightTables) {
    const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true })
    if (error) throw new Error(`Pre-flight check failed for ${t}: ${error.message}`)
    if ((count ?? 0) > 0) {
      throw new Error(`Pre-flight check failed: ${t} already has ${count} row(s). Refusing to commit to avoid duplicate inserts. Truncate the table manually if you intended to re-run.`)
    }
  }
  console.log('  pre-flight: all four target tables are empty — proceeding')

  // 1. Hall of Fame
  const hofRows = zltacHistory.hallOfFame.map((h, i) => ({
    real_name: h.realName,
    alias: h.alias || null,
    induction_year: h.inductionYear,
    contribution: h.contribution || null,
    display_order: i,
  }))
  if (hofRows.length > 0) {
    const { error } = await supabase.from('zltac_hall_of_fame').insert(hofRows)
    if (error) throw new Error(`Hall of Fame insert failed: ${error.message}`)
    console.log(`  inserted ${hofRows.length} hall of fame rows`)
  }

  // 2. Event placings
  const placingRows = []
  for (const event of zltacHistory.events) {
    if (!event.divisions) continue
    for (const [division, list] of Object.entries(event.divisions)) {
      if (!Array.isArray(list)) continue
      list.forEach((entry, i) => {
        placingRows.push({
          tournament_year: event.year,
          division,
          rank: entry.rank,
          name: entry.name,
          subtitle: entry.subtitle || null,
          display_order: i,
        })
      })
    }
  }
  if (placingRows.length > 0) {
    // Insert in chunks to stay polite.
    const CHUNK = 200
    for (let i = 0; i < placingRows.length; i += CHUNK) {
      const slice = placingRows.slice(i, i + CHUNK)
      const { error } = await supabase.from('zltac_event_placings').insert(slice)
      if (error) throw new Error(`Placings insert failed (chunk ${i}): ${error.message}`)
    }
    console.log(`  inserted ${placingRows.length} placing rows`)
  }

  // 3. Legends
  const legendRows = zltacHistory.legends.map((l, i) => ({
    alias: l.alias,
    titles: l.titles || null,
    summary: l.summary || null,
    display_order: i,
  }))
  if (legendRows.length > 0) {
    const { error } = await supabase.from('zltac_legends').insert(legendRows)
    if (error) throw new Error(`Legends insert failed: ${error.message}`)
    console.log(`  inserted ${legendRows.length} legend rows`)
  }

  // 4. Dynasties
  const dynastyRows = []
  ;(zltacHistory.dynasties?.threePeats ?? []).forEach((d, i) => {
    dynastyRows.push({
      team_name: d.team,
      category: 'three_peat',
      years: d.years,
      note: d.note || null,
      display_order: i,
    })
  })
  ;(zltacHistory.dynasties?.backToBack ?? []).forEach((d, i) => {
    dynastyRows.push({
      team_name: d.team,
      category: 'back_to_back',
      years: d.years,
      note: d.note || null,
      display_order: 1000 + i,
    })
  })
  if (dynastyRows.length > 0) {
    const { error } = await supabase.from('zltac_dynasties').insert(dynastyRows)
    if (error) throw new Error(`Dynasties insert failed: ${error.message}`)
    console.log(`  inserted ${dynastyRows.length} dynasty rows`)
  }

  // 5. Sync zltac_event_history with the static file.
  //    * Existing rows (matched by year) get the four new fields patched —
  //      location/podium/MVP/photos already there are preserved.
  //    * Missing years get a minimal row inserted: year + name + location_*
  //      + flags + team_count. Podium/MVP/photo fields stay NULL — those are
  //      richer than what the static file carries and can be filled in later.
  const { data: existingRows, error: existingErr } = await supabase
    .from('zltac_event_history')
    .select('year')
  if (existingErr) throw new Error(`zltac_event_history read failed: ${existingErr.message}`)
  const existingYears = new Set((existingRows ?? []).map(r => r.year))

  let ehPatched = 0
  let ehInserted = 0
  for (const event of zltacHistory.events) {
    const common = {
      is_cancelled: !!event.cancelled,
      is_upcoming: !!event.upcoming,
      team_count: Number.isInteger(event.teamCount) ? event.teamCount : null,
      location_country: event.country || null,
    }

    if (existingYears.has(event.year)) {
      const { error } = await supabase
        .from('zltac_event_history')
        .update(common)
        .eq('year', event.year)
      if (error) throw new Error(`zltac_event_history patch failed for year ${event.year}: ${error.message}`)
      ehPatched++
    } else {
      const insertRow = {
        year: event.year,
        name: `ZLTAC ${event.year}`,
        location_city: event.city || null,
        location_state: event.state || null,
        location_venue: event.location || null,
        ...common,
      }
      const { error } = await supabase
        .from('zltac_event_history')
        .insert(insertRow)
      if (error) throw new Error(`zltac_event_history insert failed for year ${event.year}: ${error.message}`)
      ehInserted++
    }
  }
  console.log(`  zltac_event_history: ${ehPatched} patched, ${ehInserted} inserted`)
}


// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const isCommit = process.argv.includes('--commit')

  // Dynamic-import the ESM data file.
  const dataUrl = pathToFileURL(DATA_FILE).href
  const { zltacHistory } = await import(dataUrl)

  const findings = new Findings()
  validateHallOfFame(zltacHistory.hallOfFame ?? [], findings)
  validateEvents(zltacHistory.events ?? [], findings)
  validateLegends(zltacHistory.legends ?? [], findings)
  validateDynasties(zltacHistory.dynasties ?? {}, findings)
  validateCrossRefs(zltacHistory, findings)

  const report = buildReport(zltacHistory, findings, isCommit ? 'commit' : 'dry-run')
  writeFileSync(REPORT_FILE, report, 'utf8')

  const counts = findings.counts()
  console.log(`Report written: ${REPORT_FILE}`)
  console.log(`  errors:   ${counts.total.error}`)
  console.log(`  warnings: ${counts.total.warn}`)
  console.log(`  info:     ${counts.total.info}`)

  if (!isCommit) {
    if (findings.hasErrors()) {
      console.log('\nDry-run completed with errors. Fix them in src/data/zltacHistory.js before --commit.')
      process.exit(1)
    }
    console.log('\nDry-run completed successfully. Re-run with --commit to write to Supabase.')
    return
  }

  // --commit path
  if (findings.hasErrors()) {
    console.error('\nRefusing to commit: validation errors present. See the report.')
    process.exit(1)
  }
  console.log('\nValidation passed. Writing to Supabase…')
  await commit(zltacHistory)
  console.log('\nDone.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
