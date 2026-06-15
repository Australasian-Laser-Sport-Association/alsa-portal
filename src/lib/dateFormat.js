const PRESETS = {
  long:          { day: 'numeric', month: 'long',  year: 'numeric' },
  short:         { day: 'numeric', month: 'short', year: 'numeric' },
  longWithTime:  { day: 'numeric', month: 'long',  year: 'numeric', hour: '2-digit', minute: '2-digit' },
  shortWithTime: { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' },
  monthYear:     { month: 'long', year: 'numeric' },
  numeric:       undefined,
}

// Parse a value into a Date without the UTC-midnight day-shift. A bare
// calendar date ('YYYY-MM-DD', e.g. a Postgres `date` column) is constructed
// at LOCAL midnight so it never rolls back a day for viewers behind UTC.
// Anything with a time component (a timestamptz like '2026-06-04T00:00:00+00')
// falls through to `new Date()`, preserving viewer-local rendering exactly.
export function toLocalDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  return new Date(value)
}

export function formatDate(value, preset = 'long') {
  if (value == null || value === '') return ''
  const opts = typeof preset === 'string' ? PRESETS[preset] : preset
  return toLocalDate(value).toLocaleDateString('en-AU', opts)
}

// Shared competition/event date-range formatter. Date-safe via formatDate.
// Default preset matches the long-standing inline shape used across the
// competition surfaces: "04 Jun 2026", collapsing to a single date when
// start === end.
const RANGE_PRESET = { day: '2-digit', month: 'short', year: 'numeric' }

export function formatDateRange(start, end, preset = RANGE_PRESET) {
  if (!start || !end) return ''
  const s = formatDate(start, preset)
  const e = formatDate(end, preset)
  return s === e ? s : `${s} to ${e}`
}

// Shared viewer-local date-time formatter for timestamptz values that should
// render in the viewer's zone (e.g. competition registration_open_at /
// registration_close_at — competitions carry no per-event timezone). Not
// date-safe by design: these always carry a time component.
const DATETIME_PRESET = { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }

export function formatDateTime(value) {
  if (value == null || value === '') return ''
  return new Date(value).toLocaleString('en-AU', DATETIME_PRESET)
}
