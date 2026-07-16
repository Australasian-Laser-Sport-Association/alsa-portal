import { isUuid } from './idValidation.js'
import { sendServerError } from './apiErrors.js'
import { canonicalAssetReference } from './adminAssetUpload.js'

const HISTORY_ENTITIES = new Set(['event', 'legend', 'dynasty', 'hall-of-fame'])
const DOCUMENT_ENTITIES = new Set(['category', 'document'])
const REFEREE_ENTITIES = new Set(['question', 'question-bulk', 'settings'])
const DIVISIONS = new Set(['team', 'solos', 'doubles', 'triples', 'masters', 'womens', 'juniors', 'lotr'])
const DYNASTY_CATEGORIES = new Set(['three_peat', 'back_to_back'])
const QUESTION_SECTIONS = new Set(['safety', 'general'])
const QUESTION_DIFFICULTIES = new Set(['easy', 'medium', 'hard'])
const ANSWERS = new Set(['a', 'b', 'c', 'd'])
const SCOPES = new Set(['alsa', 'zltac'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function rejectUnknownKeys(value, allowed, label = 'data') {
  if (!isObject(value)) return `${label} must be an object.`
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  return unknown.length > 0 ? `${label} contains unsupported fields.` : null
}

function cleanText(value, { name, max, required = false, nullable = true } = {}) {
  if (value == null) {
    if (required) return { error: `${name} is required.` }
    return { value: null }
  }
  if (typeof value !== 'string') return { error: `${name} must be text.` }
  const text = value.trim()
  if (!text && required) return { error: `${name} is required.` }
  if (!text && nullable) return { value: null }
  if (text.length > max) return { error: `${name} is too long.` }
  return { value: text }
}

function cleanInteger(value, { name, min, max, required = false, nullable = false } = {}) {
  if ((value == null || value === '') && !required) return { value: nullable ? null : undefined }
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return { error: `${name} must be an integer from ${min} to ${max}.` }
  }
  return { value: parsed }
}

function cleanDate(value, name) {
  if (value == null || value === '') return { value: null }
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    return { error: `${name} must be a valid date.` }
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return { error: `${name} must be a valid date.` }
  }
  return { value }
}

function hasUnsafeUrlCharacters(value) {
  return value.includes('\\') || Array.from(value).some(character => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

function cleanPublicDocumentUrl(value, { name, required = false, max = 2048 } = {}) {
  const text = cleanText(value, { name, max, required })
  if (text.error || text.value == null) return text
  if (hasUnsafeUrlCharacters(text.value)) {
    return { error: `${name} contains invalid characters.` }
  }
  if (text.value.startsWith('/')) {
    if (text.value.startsWith('//')) return { error: `${name} cannot be protocol-relative.` }
    const pathname = text.value.split(/[?#]/, 1)[0]
    const segments = pathname.split('/')
    if (!['/assets/', '/documents/'].some(prefix => pathname.startsWith(prefix))
        || segments.some(segment => segment === '.' || segment === '..')) {
      return { error: `${name} must use a branded asset or document path.` }
    }
    return text
  }
  try {
    const parsed = new URL(text.value)
    if (parsed.protocol !== 'https:') return { error: `${name} must use HTTPS.` }
    if (parsed.pathname.includes('/storage/v1/')) {
      return { error: `${name} must use the branded public asset path.` }
    }
    return text
  } catch {
    return { error: `${name} must be a valid URL.` }
  }
}

function cleanOptionalAssetUrl(value, name, expectedBucket = null) {
  if (value == null || value === '') return { value: null }
  const text = cleanText(value, { name, max: 2048 })
  if (text.error) return text
  if (hasUnsafeUrlCharacters(text.value)) {
    return { error: `${name} contains invalid characters.` }
  }
  if (expectedBucket) {
    const canonical = canonicalAssetReference(text.value, { bucket: expectedBucket })
    if (canonical.error) return { error: `${name} points to the wrong asset bucket.` }
    return { value: canonical.value }
  }
  if (text.value.startsWith('/assets/')) {
    const pathname = text.value.split(/[?#]/, 1)[0]
    if (pathname.split('/').some(segment => segment === '.' || segment === '..')) {
      return { error: `${name} must use a valid asset path.` }
    }
    return text
  }
  try {
    const parsed = new URL(text.value)
    if (parsed.protocol !== 'https:') return { error: `${name} must use HTTPS.` }
    return text
  } catch {
    return { error: `${name} must be a valid asset URL.` }
  }
}

function sanitizeCategory(input, create) {
  const allowed = ['scope', 'name', 'sort_order']
  const unknown = rejectUnknownKeys(input, allowed)
  if (unknown) return { error: unknown }
  const out = {}
  if (create || Object.hasOwn(input, 'scope')) {
    if (!SCOPES.has(input.scope)) return { error: 'scope must be alsa or zltac.' }
    out.scope = input.scope
  }
  if (create || Object.hasOwn(input, 'name')) {
    const name = cleanText(input.name, { name: 'name', max: 100, required: true })
    if (name.error) return name
    out.name = name.value
  }
  if (Object.hasOwn(input, 'sort_order')) {
    const order = cleanInteger(input.sort_order, { name: 'sort_order', min: -10000, max: 10000 })
    if (order.error) return order
    out.sort_order = order.value
  }
  return { data: out }
}

function sanitizeDocument(input, create) {
  const allowed = ['scope', 'category_id', 'name', 'url', 'description', 'sort_order']
  const unknown = rejectUnknownKeys(input, allowed)
  if (unknown) return { error: unknown }
  const out = {}
  if (create || Object.hasOwn(input, 'scope')) {
    if (!SCOPES.has(input.scope)) return { error: 'scope must be alsa or zltac.' }
    out.scope = input.scope
  }
  if (Object.hasOwn(input, 'category_id')) {
    if (input.category_id != null && input.category_id !== '' && !isUuid(input.category_id)) {
      return { error: 'category_id must be a valid UUID.' }
    }
    out.category_id = input.category_id || null
  }
  for (const [key, max, required] of [['name', 200, true], ['description', 2000, false]]) {
    if (create && required || Object.hasOwn(input, key)) {
      const cleaned = cleanText(input[key], { name: key, max, required })
      if (cleaned.error) return cleaned
      out[key] = cleaned.value
    }
  }
  if (create || Object.hasOwn(input, 'url')) {
    const url = cleanPublicDocumentUrl(input.url, { name: 'url', required: true })
    if (url.error) return url
    out.url = url.value
  }
  if (Object.hasOwn(input, 'sort_order')) {
    const order = cleanInteger(input.sort_order, { name: 'sort_order', min: -10000, max: 10000 })
    if (order.error) return order
    out.sort_order = order.value
  }
  return { data: out }
}

function sanitizeEvent(input, create) {
  const allowed = [
    'year', 'name', 'location_venue', 'location_city', 'location_state',
    'location_country', 'start_date', 'end_date', 'description', 'historic_note',
    'team_count', 'is_cancelled', 'is_upcoming', 'mvp_name', 'mvp_alias',
    'logo_url', 'full_results_text', 'photo_urls', 'internal_notes',
  ]
  const unknown = rejectUnknownKeys(input, allowed)
  if (unknown) return { error: unknown }
  const out = {}
  if (create || Object.hasOwn(input, 'year')) {
    const year = cleanInteger(input.year, { name: 'year', min: 1900, max: 2200, required: true })
    if (year.error) return year
    out.year = year.value
  }
  if (create || Object.hasOwn(input, 'name')) {
    const name = cleanText(input.name, { name: 'name', max: 200, required: true })
    if (name.error) return name
    out.name = name.value
  }
  for (const [key, max] of [
    ['location_venue', 200], ['location_city', 120], ['location_state', 120],
    ['location_country', 120], ['description', 10000], ['historic_note', 5000],
    ['mvp_name', 200], ['mvp_alias', 100], ['full_results_text', 50000],
    ['internal_notes', 10000],
  ]) {
    if (!Object.hasOwn(input, key)) continue
    const cleaned = cleanText(input[key], { name: key, max })
    if (cleaned.error) return cleaned
    out[key] = cleaned.value
  }
  for (const key of ['start_date', 'end_date']) {
    if (!Object.hasOwn(input, key)) continue
    const cleaned = cleanDate(input[key], key)
    if (cleaned.error) return cleaned
    out[key] = cleaned.value
  }
  if (out.start_date && out.end_date && out.end_date < out.start_date) {
    return { error: 'end_date must be on or after start_date.' }
  }
  if (Object.hasOwn(input, 'team_count')) {
    const count = cleanInteger(input.team_count, { name: 'team_count', min: 0, max: 1000, nullable: true })
    if (count.error) return count
    out.team_count = count.value
  }
  for (const key of ['is_cancelled', 'is_upcoming']) {
    if (!Object.hasOwn(input, key)) continue
    if (typeof input[key] !== 'boolean') return { error: `${key} must be true or false.` }
    out[key] = input[key]
  }
  if ((out.is_cancelled ?? input.is_cancelled) && (out.is_upcoming ?? input.is_upcoming)) {
    return { error: 'An event cannot be both cancelled and upcoming.' }
  }
  if (Object.hasOwn(input, 'logo_url')) {
    const url = cleanOptionalAssetUrl(input.logo_url, 'logo_url', 'event-logos')
    if (url.error) return url
    out.logo_url = url.value
  }
  if (Object.hasOwn(input, 'photo_urls')) {
    if (input.photo_urls == null) out.photo_urls = null
    else if (!Array.isArray(input.photo_urls) || input.photo_urls.length > 50) {
      return { error: 'photo_urls must be an array of at most 50 URLs.' }
    } else {
      out.photo_urls = []
      for (const value of input.photo_urls) {
        const url = cleanOptionalAssetUrl(value, 'photo_urls entry', 'event-photos')
        if (url.error) return url
        if (url.value) out.photo_urls.push(url.value)
      }
    }
  }
  return { data: out }
}

function sanitizePlacings(value) {
  if (value == null) return { data: null }
  if (!Array.isArray(value) || value.length > 500) {
    return { error: 'placings must be an array of at most 500 rows.' }
  }
  const rows = []
  const unique = new Set()
  for (const input of value) {
    const unknown = rejectUnknownKeys(input, ['division', 'rank', 'name', 'subtitle'], 'placing')
    if (unknown) return { error: unknown }
    if (!DIVISIONS.has(input.division)) return { error: 'placing division is invalid.' }
    const rank = cleanInteger(input.rank, { name: 'placing rank', min: 1, max: 1000, required: true })
    if (rank.error) return rank
    const name = cleanText(input.name, { name: 'placing name', max: 200, required: true })
    if (name.error) return name
    const subtitle = cleanText(input.subtitle, { name: 'placing subtitle', max: 500 })
    if (subtitle.error) return subtitle
    const key = `${input.division}:${rank.value}`
    if (unique.has(key)) return { error: 'placings contain a duplicate division and rank.' }
    unique.add(key)
    rows.push({ division: input.division, rank: rank.value, name: name.value, subtitle: subtitle.value })
  }
  return { data: rows }
}

function sanitizeLegend(input, create) {
  const unknown = rejectUnknownKeys(input, ['alias', 'titles', 'summary', 'display_order', 'is_visible'])
  if (unknown) return { error: unknown }
  const out = {}
  if (create || Object.hasOwn(input, 'alias')) {
    const alias = cleanText(input.alias, { name: 'alias', max: 100, required: true })
    if (alias.error) return alias
    out.alias = alias.value
  }
  for (const [key, max] of [['titles', 1000], ['summary', 10000]]) {
    if (!Object.hasOwn(input, key)) continue
    const cleaned = cleanText(input[key], { name: key, max })
    if (cleaned.error) return cleaned
    out[key] = cleaned.value
  }
  return sanitizeOrderAndVisibility(input, out)
}

function sanitizeDynasty(input, create) {
  const unknown = rejectUnknownKeys(input, ['team_name', 'category', 'years', 'note', 'display_order', 'is_visible'])
  if (unknown) return { error: unknown }
  const out = {}
  if (create || Object.hasOwn(input, 'team_name')) {
    const name = cleanText(input.team_name, { name: 'team_name', max: 200, required: true })
    if (name.error) return name
    out.team_name = name.value
  }
  if (create || Object.hasOwn(input, 'category')) {
    if (!DYNASTY_CATEGORIES.has(input.category)) return { error: 'dynasty category is invalid.' }
    out.category = input.category
  }
  if (create || Object.hasOwn(input, 'years')) {
    if (!Array.isArray(input.years) || input.years.length < 2 || input.years.length > 20) {
      return { error: 'years must contain from 2 to 20 event years.' }
    }
    const years = [...new Set(input.years.map(Number))]
    if (years.length !== input.years.length || years.some(year => !Number.isInteger(year) || year < 1900 || year > 2200)) {
      return { error: 'years must contain unique valid event years.' }
    }
    out.years = years.sort((a, b) => a - b)
  }
  if (Object.hasOwn(input, 'note')) {
    const note = cleanText(input.note, { name: 'note', max: 5000 })
    if (note.error) return note
    out.note = note.value
  }
  if (out.category && out.years) {
    const expectedCount = out.category === 'three_peat' ? 3 : 2
    const consecutive = out.years.every((year, index) => index === 0 || year === out.years[index - 1] + 1)
    if (out.years.length !== expectedCount || !consecutive) {
      return {
        error: out.category === 'three_peat'
          ? 'three_peat requires exactly 3 consecutive years.'
          : 'back_to_back requires exactly 2 consecutive years.',
      }
    }
  }
  return sanitizeOrderAndVisibility(input, out)
}

function sanitizeHallOfFame(input, create) {
  const unknown = rejectUnknownKeys(input, ['real_name', 'alias', 'induction_year', 'contribution', 'photo_url', 'display_order', 'is_visible'])
  if (unknown) return { error: unknown }
  const out = {}
  if (create || Object.hasOwn(input, 'real_name')) {
    const name = cleanText(input.real_name, { name: 'real_name', max: 200, required: true })
    if (name.error) return name
    out.real_name = name.value
  }
  if (create || Object.hasOwn(input, 'induction_year')) {
    const year = cleanInteger(input.induction_year, { name: 'induction_year', min: 1900, max: 2200, required: true })
    if (year.error) return year
    out.induction_year = year.value
  }
  for (const [key, max] of [['alias', 100], ['contribution', 10000]]) {
    if (!Object.hasOwn(input, key)) continue
    const cleaned = cleanText(input[key], { name: key, max })
    if (cleaned.error) return cleaned
    out[key] = cleaned.value
  }
  if (Object.hasOwn(input, 'photo_url')) {
    const url = cleanOptionalAssetUrl(input.photo_url, 'photo_url')
    if (url.error) return url
    out.photo_url = url.value
  }
  return sanitizeOrderAndVisibility(input, out)
}

function sanitizeOrderAndVisibility(input, out) {
  if (Object.hasOwn(input, 'display_order')) {
    const order = cleanInteger(input.display_order, { name: 'display_order', min: -10000, max: 10000 })
    if (order.error) return order
    out.display_order = order.value
  }
  if (Object.hasOwn(input, 'is_visible')) {
    if (typeof input.is_visible !== 'boolean') return { error: 'is_visible must be true or false.' }
    out.is_visible = input.is_visible
  }
  return { data: out }
}

function sanitizeQuestion(input, create) {
  const allowed = [
    'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer',
    'category', 'difficulty', 'active', 'section', 'image_url', 'video_url',
  ]
  const unknown = rejectUnknownKeys(input, allowed, 'question')
  if (unknown) return { error: unknown }
  const out = {}
  for (const key of ['question', 'option_a', 'option_b', 'option_c', 'option_d']) {
    if (!create && !Object.hasOwn(input, key)) continue
    const cleaned = cleanText(input[key], { name: key, max: key === 'question' ? 2000 : 1000, required: true })
    if (cleaned.error) return cleaned
    out[key] = cleaned.value
  }
  if (create || Object.hasOwn(input, 'correct_answer')) {
    if (!ANSWERS.has(input.correct_answer)) return { error: 'correct_answer must be a, b, c, or d.' }
    out.correct_answer = input.correct_answer
  }
  if (create || Object.hasOwn(input, 'section')) {
    if (!QUESTION_SECTIONS.has(input.section)) return { error: 'section must be safety or general.' }
    out.section = input.section
  }
  if (create || Object.hasOwn(input, 'difficulty')) {
    if (!QUESTION_DIFFICULTIES.has(input.difficulty)) return { error: 'difficulty is invalid.' }
    out.difficulty = input.difficulty
  }
  if (Object.hasOwn(input, 'category')) {
    const category = cleanText(input.category, { name: 'category', max: 100, required: true })
    if (category.error) return category
    out.category = category.value
  }
  if (Object.hasOwn(input, 'active')) {
    if (typeof input.active !== 'boolean') return { error: 'active must be true or false.' }
    out.active = input.active
  }
  for (const [key, bucket] of [['image_url', 'referee-test-media'], ['video_url', 'referee-test-media']]) {
    if (!Object.hasOwn(input, key)) continue
    const url = cleanOptionalAssetUrl(input[key], key, bucket)
    if (url.error) return url
    out[key] = url.value
  }
  return { data: out }
}

function sanitizeSettings(input) {
  const keys = [
    'safety_questions_per_test', 'safety_pass_score',
    'general_questions_per_test', 'general_pass_score',
  ]
  const unknown = rejectUnknownKeys(input, keys)
  if (unknown) return { error: unknown }
  const out = {}
  for (const key of keys) {
    if (!Object.hasOwn(input, key)) continue
    const max = key.endsWith('pass_score') ? 100 : 100
    const min = 1
    const value = cleanInteger(input[key], { name: key, min, max, required: true })
    if (value.error) return value
    out[key] = value.value
  }
  if (Object.keys(out).length !== keys.length) return { error: 'All Rules Test settings are required.' }
  return { data: out }
}

function sanitizeBanner(input) {
  const unknown = rejectUnknownKeys(input, ['enabled', 'message'])
  if (unknown) return { error: unknown }
  if (typeof input.enabled !== 'boolean') return { error: 'enabled must be true or false.' }
  const message = cleanText(input.message, { name: 'message', max: 1000, required: true })
  if (message.error) return message
  return { data: { enabled: input.enabled, message: message.value } }
}

function mutationFor(resource, method, body) {
  if (!isObject(body)) return { error: 'A JSON object body is required.' }
  const topLevelError = rejectUnknownKeys(body, ['entity', 'id', 'data', 'placings'], 'request')
  if (topLevelError) return { error: topLevelError }
  const entity = body.entity
  const data = body.data ?? {}
  let action = method === 'POST' ? 'create' : method === 'PATCH' ? 'update' : method === 'DELETE' ? 'delete' : null
  if (!action) return { error: 'Method not allowed.', status: 405 }

  if (resource === 'document-content') {
    if (!DOCUMENT_ENTITIES.has(entity)) return { error: 'Invalid document content entity.' }
  } else if (resource === 'history-content') {
    if (!HISTORY_ENTITIES.has(entity)) return { error: 'Invalid history content entity.' }
  } else if (resource === 'referee-content') {
    if (!REFEREE_ENTITIES.has(entity)) return { error: 'Invalid Rules Test content entity.' }
    if (entity === 'settings') {
      if (method !== 'POST') return { error: 'Method not allowed.', status: 405 }
      action = 'upsert'
    }
    if (entity === 'question-bulk') {
      if (method !== 'POST') return { error: 'Method not allowed.', status: 405 }
      action = 'bulk-create'
    }
  } else if (resource === 'site-banner') {
    if (entity !== 'banner') return { error: 'Invalid site banner entity.' }
    if (method !== 'POST') return { error: 'Method not allowed.', status: 405 }
    action = 'upsert'
  } else {
    return { error: 'Unknown admin content resource.' }
  }

  if (entity !== 'event' && Object.hasOwn(body, 'placings')) {
    return { error: 'placings are only valid for event content.' }
  }
  if (action === 'delete' && (!isObject(data) || Object.keys(data).length > 0)) {
    return { error: 'DELETE data must be an empty object.' }
  }

  const needsId = action === 'update' || action === 'delete'
  if (needsId && !isUuid(body.id)) return { error: 'A valid id is required.' }
  if (!needsId && body.id != null) return { error: 'id is not valid for this action.' }

  let sanitized
  const create = action === 'create'
  if (entity === 'category') sanitized = sanitizeCategory(data, create)
  else if (entity === 'document') sanitized = sanitizeDocument(data, create)
  else if (entity === 'event') sanitized = sanitizeEvent(data, create)
  else if (entity === 'legend') sanitized = sanitizeLegend(data, create)
  else if (entity === 'dynasty') sanitized = sanitizeDynasty(data, create)
  else if (entity === 'hall-of-fame') sanitized = sanitizeHallOfFame(data, create)
  else if (entity === 'question') sanitized = sanitizeQuestion(data, create)
  else if (entity === 'settings') sanitized = sanitizeSettings(data)
  else if (entity === 'banner') sanitized = sanitizeBanner(data)
  else if (entity === 'question-bulk') {
    if (!Array.isArray(data.rows) || data.rows.length < 1 || data.rows.length > 500 || Object.keys(data).some(key => key !== 'rows')) {
      return { error: 'rows must contain from 1 to 500 questions.' }
    }
    const rows = []
    for (const row of data.rows) {
      const checked = sanitizeQuestion(row, true)
      if (checked.error) return checked
      rows.push(checked.data)
    }
    sanitized = { data: { rows } }
  }
  if (sanitized?.error) return sanitized
  if (action === 'update' && Object.keys(sanitized.data).length === 0) return { error: 'No editable fields supplied.' }

  let placings = null
  if (entity === 'event' && Object.hasOwn(body, 'placings')) {
    if (!['create', 'update'].includes(action)) return { error: 'placings are only valid when saving an event.' }
    const checked = sanitizePlacings(body.placings)
    if (checked.error) return checked
    placings = checked.data
  }

  return {
    value: {
      p_entity: entity,
      p_action: action,
      p_record_id: body.id ?? null,
      p_data: sanitized?.data ?? {},
      p_placings: placings,
    },
  }
}

async function getHistoryContent(req, res, supabase) {
  const entity = req.query.entity
  if (!HISTORY_ENTITIES.has(entity)) return res.status(400).json({ error: 'Invalid history content entity.' })
  const id = req.query.id
  if (id != null && !isUuid(id)) return res.status(400).json({ error: 'id must be a valid UUID.' })

  const table = entity === 'event'
    ? 'zltac_event_history'
    : entity === 'legend'
      ? 'zltac_legends'
      : entity === 'dynasty'
        ? 'zltac_dynasties'
        : 'zltac_hall_of_fame'

  if (id) {
    const { data: record, error } = await supabase.from(table).select('*').eq('id', id).maybeSingle()
    if (error) return sendServerError(res, error, `admin:${entity}:read`)
    if (!record) return res.status(404).json({ error: 'Content record not found.' })
    if (entity !== 'event') return res.json({ record })
    const { data: placings, error: placingsError } = await supabase
      .from('zltac_event_placings')
      .select('*')
      .eq('tournament_year', record.year)
      .order('display_order', { ascending: true })
    if (placingsError) return sendServerError(res, placingsError, 'admin:event-history:placings')
    return res.json({ record, placings: placings ?? [] })
  }

  const orderColumn = entity === 'event' ? 'year' : 'display_order'
  const { data, error } = await supabase.from(table).select('*').order(orderColumn, { ascending: entity !== 'event' })
  if (error) return sendServerError(res, error, `admin:${entity}:list`)
  if (entity !== 'event') return res.json({ records: data ?? [] })

  const years = (data ?? []).map(record => record.year)
  let counts = new Map()
  if (years.length > 0) {
    const { data: placings, error: placingsError } = await supabase
      .from('zltac_event_placings')
      .select('tournament_year')
      .in('tournament_year', years)
    if (placingsError) return sendServerError(res, placingsError, 'admin:event-history:placing-counts')
    counts = (placings ?? []).reduce((map, row) => map.set(row.tournament_year, (map.get(row.tournament_year) ?? 0) + 1), new Map())
  }
  return res.json({ records: (data ?? []).map(record => ({ ...record, placing_count: counts.get(record.year) ?? 0 })) })
}

async function getRefereeContent(res, supabase) {
  const [{ data: questions, error: questionError }, { data: settings, error: settingsError }] = await Promise.all([
    supabase.from('referee_questions').select('*').order('created_at', { ascending: false }),
    supabase.from('referee_test_settings').select('*').eq('id', 1).maybeSingle(),
  ])
  if (questionError) return sendServerError(res, questionError, 'admin:referee-questions:list')
  if (settingsError) return sendServerError(res, settingsError, 'admin:referee-settings:get')
  return res.json({ questions: questions ?? [], settings })
}

function sendMutationError(res, error, resource) {
  if (error?.code === '42501') return res.status(403).json({ error: 'Forbidden.' })
  if (error?.code === 'P0002') return res.status(404).json({ error: 'Content record not found.' })
  if (error?.code === '23505') return res.status(409).json({ error: 'A conflicting content record already exists.' })
  if (error?.code === '55000' && /active Rules Test attempt/i.test(String(error?.message ?? ''))) {
    return res.status(409).json({ error: 'This question is in an active Rules Test attempt. Try again after it expires.' })
  }
  if (['22001', '22007', '22008', '22023', '22P02'].includes(error?.code)) {
    return res.status(400).json({ error: 'The content request is invalid.' })
  }
  if (['23503', '23514', '40001', '40P01', '55000'].includes(error?.code)) {
    return res.status(409).json({ error: 'The content changed or references an unavailable record. Refresh and try again.' })
  }
  return sendServerError(res, error, `admin:${resource}:mutate`)
}

export async function handleAdminContent(req, res, { user, supabase, resource }) {
  if (req.method === 'GET') {
    if (resource === 'history-content') return getHistoryContent(req, res, supabase)
    if (resource === 'referee-content') return getRefereeContent(res, supabase)
    return res.status(405).json({ error: 'Method not allowed.' })
  }

  const checked = mutationFor(resource, req.method, req.body)
  if (checked.error) return res.status(checked.status ?? 400).json({ error: checked.error })
  const { data, error } = await supabase.rpc('admin_mutate_content', {
    p_actor_id: user.id,
    ...checked.value,
  })
  if (error) return sendMutationError(res, error, resource)
  return res.status(req.method === 'POST' ? 201 : 200).json(data ?? { ok: true })
}

export const __test = {
  mutationFor,
  sanitizeQuestion,
  sanitizeEvent,
}
