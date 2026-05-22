// Event-local timezone helpers.
//
// Every datetime field on a zltac_events row (reg_open_date, reg_close_date,
// event_starts_at) is stored as a UTC timestamptz but entered, edited, and
// displayed in the event's IANA timezone (zltac_events.timezone). These pure
// helpers are the single conversion layer between the two.
//
// Display uses the browser-native Intl.DateTimeFormat (the IANA database ships
// with every engine). Input parsing hand-rolls the UTC offset via Intl so we
// avoid pulling in a date library.
//
//   formatInEventTz(utcValue, timezone, preset) -> display string. Time-bearing
//       presets append the short zone abbreviation ("22 May 2026, 7:00 PM
//       AEST"); date-only presets return just the date, computed in the event
//       timezone (fixes day-boundary errors), with no abbreviation.
//   parseFromEventTz(localString, timezone)     -> UTC ISO string for storage.
//       Treats "YYYY-MM-DDTHH:mm" as wall-clock in the timezone.
//   toInputValue(utcValue, timezone)            -> "YYYY-MM-DDTHH:mm" for the
//       value attribute of <input type="datetime-local">.
//   getTzAbbr(timezone, date)                   -> "AEST" / "NZDT" / etc for the
//       given instant in the given zone.
//
// All functions are defensive: null / '' / unparseable input returns '' (or
// null for parseFromEventTz) rather than throwing.

const DEFAULT_TZ = 'Australia/Melbourne'

// Hand-maintained abbreviation map for the supported zones. std / dst are the
// short labels; stdOffsetMin is the standard-time offset from UTC in minutes.
// When an instant's live offset exceeds stdOffsetMin the zone is on daylight
// saving and we return the dst label. Zones without DST keep dst === std.
// Any zone not listed falls back to Intl (defensive; should not fire for the
// curated selector list).
const TZ_ABBR = {
  'Australia/Melbourne': { std: 'AEST', dst: 'AEDT', stdOffsetMin: 600 },
  'Australia/Sydney':    { std: 'AEST', dst: 'AEDT', stdOffsetMin: 600 },
  'Australia/Hobart':    { std: 'AEST', dst: 'AEDT', stdOffsetMin: 600 },
  'Australia/Brisbane':  { std: 'AEST', dst: 'AEST', stdOffsetMin: 600 },
  'Australia/Adelaide':  { std: 'ACST', dst: 'ACDT', stdOffsetMin: 570 },
  'Australia/Darwin':    { std: 'ACST', dst: 'ACST', stdOffsetMin: 570 },
  'Australia/Perth':     { std: 'AWST', dst: 'AWST', stdOffsetMin: 480 },
  'Pacific/Auckland':    { std: 'NZST', dst: 'NZDT', stdOffsetMin: 720 },
}

const PRESETS = {
  long:          { day: 'numeric', month: 'long',  year: 'numeric' },
  short:         { day: 'numeric', month: 'short', year: 'numeric' },
  longWithTime:  { day: 'numeric', month: 'long',  year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true },
  shortWithTime: { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true },
}

const HAS_TIME = { longWithTime: true, shortWithTime: true }

function toDate(value) {
  if (value == null || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

// Offset (in minutes) of `timeZone` from UTC at the given instant. Positive for
// zones ahead of UTC (e.g. +600 for AEST, +660 for AEDT). Works by rendering the
// instant's wall-clock in the zone, reading it back as if it were UTC, and
// diffing against the real instant.
function tzOffsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date)
  const m = {}
  for (const p of parts) if (p.type !== 'literal') m[p.type] = p.value
  const asUTC = Date.UTC(
    Number(m.year), Number(m.month) - 1, Number(m.day),
    Number(m.hour), Number(m.minute), Number(m.second),
  )
  return Math.round((asUTC - date.getTime()) / 60000)
}

export function getTzAbbr(timezone, date = new Date()) {
  const d = toDate(date)
  if (!d) return ''
  const tz = timezone || DEFAULT_TZ
  const entry = TZ_ABBR[tz]
  if (entry) {
    return tzOffsetMinutes(d, tz) > entry.stdOffsetMin ? entry.dst : entry.std
  }
  // Fallback for any zone outside the curated map.
  try {
    const part = new Intl.DateTimeFormat('en-AU', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(d)
      .find(p => p.type === 'timeZoneName')
    return part ? part.value : ''
  } catch {
    return ''
  }
}

export function formatInEventTz(utcValue, timezone, preset = 'long') {
  const d = toDate(utcValue)
  if (!d) return ''
  const tz = timezone || DEFAULT_TZ
  const opts = typeof preset === 'string' ? (PRESETS[preset] || PRESETS.long) : preset
  const withTime = typeof preset === 'string'
    ? !!HAS_TIME[preset]
    : !!(opts.hour || opts.minute)
  // en-AU renders day-month-year and a lowercase meridiem; uppercase am/pm to
  // match the "7:00 PM AEST" house style.
  const base = new Intl.DateTimeFormat('en-AU', { timeZone: tz, ...opts })
    .format(d)
    .replace(/\b([ap])m\b/gi, (s) => s.toUpperCase())
  if (!withTime) return base
  const abbr = getTzAbbr(tz, d)
  return abbr ? `${base} ${abbr}` : base
}

export function toInputValue(utcValue, timezone) {
  const d = toDate(utcValue)
  if (!d) return ''
  const tz = timezone || DEFAULT_TZ
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(d)
  const m = {}
  for (const p of parts) if (p.type !== 'literal') m[p.type] = p.value
  return `${m.year}-${m.month}-${m.day}T${m.hour}:${m.minute}`
}

export function parseFromEventTz(localString, timezone) {
  if (!localString) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(localString)
  if (!match) return null
  const [, y, mo, d, h, mi] = match.map(Number)
  const tz = timezone || DEFAULT_TZ
  // Treat the wall-clock as if it were UTC, then subtract the zone offset to
  // recover the true instant. Re-check the offset at the corrected instant so
  // values near a DST transition resolve to the right side.
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  const off1 = tzOffsetMinutes(new Date(guess), tz)
  let utc = guess - off1 * 60000
  const off2 = tzOffsetMinutes(new Date(utc), tz)
  if (off2 !== off1) utc = guess - off2 * 60000
  return new Date(utc).toISOString()
}
