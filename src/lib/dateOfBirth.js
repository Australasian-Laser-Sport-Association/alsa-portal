const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function parseIsoDate(value) {
  if (typeof value !== 'string') return null
  const match = ISO_DATE.exec(value.trim())
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null

  return { year, month, day, iso: `${match[1]}-${match[2]}-${match[3]}` }
}

function compareDateParts(left, right) {
  if (left.year !== right.year) return left.year - right.year
  if (left.month !== right.month) return left.month - right.month
  return left.day - right.day
}

function todayParts(now) {
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate(),
  }
}

function eventDateParts({ eventStartsAt, startDate, timezone }) {
  const plainDate = parseIsoDate(startDate)
  if (plainDate) return plainDate

  if (!eventStartsAt || !timezone) return null
  const timestamp = new Date(eventStartsAt)
  if (Number.isNaN(timestamp.getTime())) return null
  try {
    const parts = new Intl.DateTimeFormat('en-AU', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(timestamp)
    const byType = Object.fromEntries(parts.map(part => [part.type, part.value]))
    return parseIsoDate(`${byType.year}-${byType.month}-${byType.day}`)
  } catch {
    return null
  }
}

export function isValidDateOfBirth(value, now = new Date()) {
  const dob = parseIsoDate(value)
  return !!dob && dob.year >= 1900 && compareDateParts(dob, todayParts(now)) <= 0
}

export function registrationDateOfBirth(registration, profile) {
  // Once a registration exists its snapshot is authoritative. A legacy/null
  // snapshot must fail closed rather than falling back to a mutable profile.
  if (registration) return registration.dob_at_registration ?? null
  return profile?.dob ?? null
}

export function under18Requirement({ dob, eventStartsAt, startDate, timezone }) {
  const birth = parseIsoDate(dob)
  if (!birth || birth.year < 1900) return { status: 'blocked', reason: 'missing_or_invalid_dob' }

  const eventDate = eventDateParts({ eventStartsAt, startDate, timezone })
  if (!eventDate) return { status: 'blocked', reason: 'missing_or_invalid_event_date' }
  if (compareDateParts(birth, eventDate) > 0) {
    return { status: 'blocked', reason: 'dob_after_event' }
  }

  // Date.UTC deliberately normalises a 29 February eighteenth birthday to
  // 1 March in a non-leap year, avoiding local-time and DST drift.
  const eighteenthDate = new Date(Date.UTC(birth.year + 18, birth.month - 1, birth.day))
  const eighteenth = {
    year: eighteenthDate.getUTCFullYear(),
    month: eighteenthDate.getUTCMonth() + 1,
    day: eighteenthDate.getUTCDate(),
  }

  return compareDateParts(eventDate, eighteenth) < 0
    ? { status: 'required' }
    : { status: 'not_required' }
}
