import supabaseAdmin from '../_lib/supabase.js'
import { verifyUser, verifySuperAdmin, statusForAuthError } from '../_lib/auth.js'
import { sendCompetitionRpcError } from '../_lib/competitionLifecycle.js'
import { sendServerError } from '../_lib/apiErrors.js'
import { isUuid } from '../_lib/idValidation.js'
import { enforceRateLimit } from '../_lib/rateLimit.js'
import {
  canonicalAssetReference,
  COMPETITION_ASSET_PURPOSES,
  finalizeSignedAssetUpload,
  issueSignedAssetUpload,
} from '../_lib/adminAssetUpload.js'
import {
  OpaqueProfileHandleError,
  PROFILE_HANDLE_PURPOSES,
  issueOpaqueProfileHandle,
  verifyOpaqueProfileHandle,
} from '../_lib/opaqueProfileHandle.js'
import { TEAM_COLOURS } from '../../src/lib/teamColours.js'
import { COMMITTEE_ROLES } from '../../src/lib/roles.js'

// Catch-all dispatcher for superadmin-mostly endpoints, consolidated into one
// Vercel function to stay under the Hobby plan's 12-function ceiling.
//
// URL surface preserved exactly so existing callers/tests don't need changes:
//   /api/superadmin/competitions               → GET, POST           (superadmin)
//                                              → PATCH               (superadmin OR competition manager of the target row)
//                                              → DELETE              (always 405; archive via PATCH)
//   /api/superadmin/competition-managers       → POST, GET, DELETE   (superadmin)
//   /api/superadmin/profile-search             → GET                 (any auth user)
//   /api/superadmin/my-competitions            → GET                 (any auth user; manager scope)
//   /api/superadmin/my-registrations           → GET                 (any auth user; player scope)
//   /api/superadmin/competition-registration   → POST, GET, DELETE   (any auth user; per-self)
//   /api/superadmin/competition-registrations  → GET                 (superadmin OR competition manager)
//   /api/superadmin/competition-payment-records → POST, GET, PATCH, DELETE (superadmin OR competition manager)
//   /api/superadmin/competition-team           → POST, GET, PATCH, DELETE (any auth user)
//   /api/superadmin/competition-team-member    → POST, GET, DELETE   (any auth user)
//   /api/superadmin/competition-team-invite    → GET, PATCH          (any auth user)
//   /api/superadmin/competition-teams          → GET                 (committee OR competition manager)
//   /api/superadmin/competition-team-approve   → POST                (committee OR competition manager)
//   /api/superadmin/competition-team-unapprove → POST                (committee OR competition manager)
//   /api/superadmin/competition-team-rename    → POST                (committee OR competition manager)
//   /api/superadmin/competition-asset-upload   → POST                (committee OR competition manager)
//
// Vercel maps [resource].js to req.query.resource. Auth is per-branch because
// most resources here serve any authenticated user — only competition-managers
// stays purely superadmin-gated. The "/superadmin/" path segment is a
// directory-naming artefact of the function-count consolidation, not an
// assertion that every resource here is gated by verifySuperAdmin (see Phase
// 1d notes). profile-search was relaxed from superadmin-only to authenticated
// in Phase 3d because the captain invite picker needs it. Phase 2a (Edit
// Details) widens competitions PATCH to managers as well; that handler now
// verifies auth per-method internally rather than relying on the dispatcher.
//
// Response shape mirrors /api/admin/*: bare object, no envelope, errors as
// { error: '<message>' }. Creation responses use 201; everything else 200.

const SLUG_RE = /^[a-z0-9-]+$/
const ABBREV_RE = /^[A-Z0-9]{2,8}$/

// Auto-derives a payment-reference abbreviation from a competition name.
// Algorithm (matches the helper text in the create modal):
//   - Split on whitespace.
//   - For each word: if it starts with an uppercase letter, take that letter.
//     Words that are entirely digits (e.g. year suffixes like "2027") are
//     skipped to avoid duplicating the YEAR the trigger already emits.
//   - Uppercase + truncate to 8 chars.
// Examples:
//   "Victorian Pre Nationals 2027" -> "VPN"
//   "Canberra Pre Nats 1"          -> "CPN"
//   "NSW Pre Nats"                 -> "NPN"
// Returns '' if no useable letters survive — caller decides how to handle.
function deriveAbbreviation(name) {
  const words = (name ?? '').trim().split(/\s+/)
  const letters = []
  for (const w of words) {
    if (/^\d+$/.test(w)) continue
    const first = w[0]
    if (first && /[A-Z]/.test(first)) letters.push(first.toUpperCase())
  }
  return letters.join('').slice(0, 8)
}

// Derives a URL slug from a competition name. Lowercases, replaces any non-
// alphanumeric run with a single hyphen, trims leading/trailing hyphens.
// Example: "Victorian Pre Nationals 2027" -> "victorian-pre-nationals-2027".
// Returns '' if the result is empty (caller decides how to handle).
function slugifyName(name) {
  return (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Returns a slug that is unique in public.competitions, by appending -2, -3,
// ..., -10 on collision. Returns null if all ten variants are taken.
async function findAvailableSlug(baseSlug) {
  // Pull every existing slug that starts with the base. Cheap because the slug
  // pool is small and start-with is index-friendly.
  const { data, error } = await supabaseAdmin
    .from('competitions')
    .select('slug')
    .ilike('slug', `${baseSlug}%`)
  if (error) throw new Error(`slug collision check failed: ${error.message}`)
  const taken = new Set((data ?? []).map(r => r.slug))
  if (!taken.has(baseSlug)) return baseSlug
  for (let n = 2; n <= 10; n++) {
    const candidate = `${baseSlug}-${n}`
    if (!taken.has(candidate)) return candidate
  }
  return null
}

// Whitelist of fields the competitions PATCH endpoint will accept. slug is
// intentionally omitted (URLs may already exist by the time anyone tries to
// rename), and created_by / created_at are immutable. archived_at is in this
// list but is rejected for non-superadmin callers at handler entry.
const COMPETITION_PATCH_FIELDS = [
  'name',
  'start_date',
  'end_date',
  'registration_open_at',
  'registration_close_at',
  'price_per_player',
  'bank_account_name',
  'bank_bsb',
  'bank_account_number',
  'payment_info_visible',
  'archived_at',
  'description',
  'links',
  'banner_url',
]

const MANAGED_COMPETITION_COLUMNS =
  'id, slug, abbreviation, name, start_date, end_date, registration_open_at, registration_close_at, price_per_player, payment_info_visible, bank_account_name, bank_bsb, bank_account_number, description, links, banner_url, archived_at'

// Phase 2a content-field validation. The SQL constraint only enforces
// "description ≤ 10k chars, links is an array of ≤ 20 entries". Per-element
// shape (label non-empty ≤ 80 chars, url http/https ≤ 2048 chars) is
// enforced here so a future migration can extend the schema without forcing
// a constraint rewrite. Returns null on success, or a message on the first
// failure.
function validateContent(body) {
  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    const d = body.description
    if (d !== null && typeof d !== 'string') return 'description must be a string or null'
    if (typeof d === 'string' && d.length > 10000) {
      return 'description must be 10000 characters or fewer'
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'links')) {
    const l = body.links
    if (l === null) return null
    if (!Array.isArray(l)) return 'links must be an array or null'
    if (l.length > 20) return 'links may have at most 20 entries'
    for (let i = 0; i < l.length; i++) {
      const entry = l[i]
      if (!entry || typeof entry !== 'object') return `links[${i}] must be an object`
      const label = entry.label
      const url = entry.url
      if (typeof label !== 'string' || label.trim().length === 0) {
        return `links[${i}].label is required`
      }
      if (label.length > 80) return `links[${i}].label must be 80 characters or fewer`
      if (typeof url !== 'string' || url.trim().length === 0) {
        return `links[${i}].url is required`
      }
      if (!/^https?:\/\//i.test(url)) {
        return `links[${i}].url must start with http:// or https://`
      }
      if (url.length > 2048) return `links[${i}].url must be 2048 characters or fewer`
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'banner_url')) {
    const b = body.banner_url
    if (b !== null && typeof b !== 'string') return 'banner_url must be a string or null'
    if (typeof b === 'string' && b.trim() !== '') {
      if (b.length > 2048) return 'banner_url must be 2048 characters or fewer'
      if (canonicalAssetReference(b, { bucket: 'competition-banners' }).error) {
        return 'banner_url must use the branded competition asset path'
      }
    }
  }
  return null
}

function badRequest(res, message) {
  return res.status(400).json({ error: message })
}

function consumeProfileHandle(res, { handle, purpose, actorId, context }) {
  if (typeof handle !== 'string' || handle.length === 0) {
    badRequest(res, 'profile_handle is required')
    return null
  }

  try {
    return verifyOpaqueProfileHandle({ handle, purpose, actorId })
  } catch (error) {
    if (error instanceof OpaqueProfileHandleError) {
      badRequest(res, 'profile_handle is invalid or expired')
    } else {
      sendServerError(res, error, context)
    }
    return null
  }
}

// Returns null on success, or a string error message describing the first
// validation failure. Called by both POST (full body) and PATCH (subset) on
// the competitions branch.
function validateDates({ start_date, end_date, registration_open_at, registration_close_at }) {
  if (start_date && end_date && new Date(end_date) < new Date(start_date)) {
    return 'end_date must be on or after start_date'
  }
  if (registration_open_at && registration_close_at
      && new Date(registration_close_at) < new Date(registration_open_at)) {
    return 'registration_close_at must be on or after registration_open_at'
  }
  return null
}


// Annotates each competition row with `registrations_count` (integer ≥ 0).
// Used by both the superadmin listing and the manager's my-competitions list
// so the Edit form can disable abbreviation editing pre-flight on the same
// condition the server enforces (existing payment refs must not drift).
async function withRegistrationsCount(rows) {
  if (!rows || rows.length === 0) return rows ?? []
  const ids = rows.map(r => r.id)
  const { data: regs, error } = await supabaseAdmin
    .from('competition_registrations')
    .select('competition_id')
    .in('competition_id', ids)
  if (error) {
    // On failure, still return the rows with count=0 so the UI degrades to
    // "server rejects abbreviation change if regs exist" rather than blanking
    // the whole page.
    return rows.map(r => ({ ...r, registrations_count: 0 }))
  }
  const counts = new Map()
  for (const r of regs ?? []) {
    counts.set(r.competition_id, (counts.get(r.competition_id) ?? 0) + 1)
  }
  return rows.map(r => ({ ...r, registrations_count: counts.get(r.id) ?? 0 }))
}


// ── competitions ──────────────────────────────────────────────────────────────
// Auth model (Phase 2a):
//   GET, POST  -> superadmin
//   PATCH      -> superadmin OR caller is in competition_managers for the target row
//                 (managers cannot set archived_at — that stays superadmin-only)
//   DELETE     -> 405 in all cases (archive via PATCH)
// Verification happens per-method inside this handler rather than in the
// dispatcher because PATCH has a wider audience than the other methods.
async function handleCompetitions(req, res) {
  if (req.method === 'GET') {
    const { error: authErr } = await verifySuperAdmin(req)
    if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

    const includeArchived = req.query.include_archived === '1'
    let q = supabaseAdmin.from('competitions').select(MANAGED_COMPETITION_COLUMNS).order('start_date', { ascending: false })
    if (!includeArchived) q = q.is('archived_at', null)
    const { data, error } = await q
    if (error) return sendServerError(res, error, 'competitions:list')

    return res.json(await withRegistrationsCount(data ?? []))
  }

  if (req.method === 'POST') {
    const { user, error: authErr } = await verifySuperAdmin(req)
    if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

    const body = req.body ?? {}
    const name = (body.name ?? '').trim()
    const { start_date, end_date } = body
    if (!name) return badRequest(res, 'name is required')
    if (!start_date || !end_date) return badRequest(res, 'start_date and end_date are required')
    const dateErr = validateDates(body)
    if (dateErr) return badRequest(res, dateErr)
    const contentErr = validateContent(body)
    if (contentErr) return badRequest(res, contentErr)
    if (typeof body.banner_url === 'string' && body.banner_url.trim()) {
      return badRequest(res, 'Create the competition before uploading its banner.')
    }

    // Slug derivation. Caller may pass body.slug (admin tooling); otherwise
    // we derive from the name. The format regex is enforced post-derivation so
    // weird Unicode in names can't slip a bad slug through.
    const rawSlug = (body.slug ?? '').trim() || slugifyName(name)
    if (!rawSlug) return badRequest(res, 'could not derive a slug from name; please provide a name with letters or numbers')
    if (!SLUG_RE.test(rawSlug)) return badRequest(res, 'derived slug failed validation; use a simpler name')

    let slug
    try {
      slug = await findAvailableSlug(rawSlug)
    } catch (err) {
      return sendServerError(res, err, 'competitions:create-slug')
    }
    if (!slug) {
      return res.status(409).json({ error: 'Could not derive a unique slug for this name. Try a more specific name.' })
    }

    // Abbreviation. Caller may pass body.abbreviation (uppercased + validated);
    // otherwise we auto-derive from name. If the derived value is shorter than
    // 2 chars, the caller has to provide an explicit one. Cross-event
    // uniqueness is NOT enforced — the generator's per-table collision-suffix
    // loop handles that case.
    let abbreviation
    if (typeof body.abbreviation === 'string' && body.abbreviation.trim() !== '') {
      abbreviation = body.abbreviation.trim().toUpperCase()
      if (!ABBREV_RE.test(abbreviation)) {
        return badRequest(res, 'abbreviation must be 2 to 8 uppercase letters or digits')
      }
    } else {
      abbreviation = deriveAbbreviation(name)
      if (abbreviation.length < 2) {
        return badRequest(res, 'could not auto-derive an abbreviation from the name; please provide one explicitly')
      }
    }

    const insertRow = {
      slug,
      name,
      abbreviation,
      start_date,
      end_date,
      registration_open_at: body.registration_open_at ?? null,
      registration_close_at: body.registration_close_at ?? null,
      price_per_player: body.price_per_player ?? null,
      bank_account_name: body.bank_account_name ?? null,
      bank_bsb: body.bank_bsb ?? null,
      bank_account_number: body.bank_account_number ?? null,
      description:
        typeof body.description === 'string' ? body.description.trim() : (body.description ?? null),
      links: Array.isArray(body.links) ? body.links : null,
      banner_url: typeof body.banner_url === 'string' && body.banner_url.trim() !== ''
        ? body.banner_url.trim()
        : null,
      created_by: user.id,
    }
    const { data, error } = await supabaseAdmin
      .from('competitions')
      .insert(insertRow)
      .select()
      .single()
    if (error) {
      // 23505 = unique_violation. findAvailableSlug should have prevented this,
      // but a race between the check and the insert could still hit. Surface
      // it cleanly so the caller can retry.
      if (error.code === '23505') {
        return res.status(409).json({ error: `slug "${slug}" is already in use (concurrent create)` })
      }
      return sendServerError(res, error, 'competitions:create')
    }
    return res.status(201).json(data)
  }

  if (req.method === 'PATCH') {
    const { user, error: authErr } = await verifyUser(req)
    if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

    const id = req.query.id ?? req.body?.id
    if (!id) return badRequest(res, 'competition id is required (?id= or body.id)')

    // The locked RPC establishes superadmin/manager authority against the
    // same row version it edits, including the one-way archive rule.
    const body = req.body ?? {}

    const contentErr = validateContent(body)
    if (contentErr) return badRequest(res, contentErr)

    const updates = {}
    for (const k of COMPETITION_PATCH_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(body, k)) continue
      if (k === 'description' && typeof body[k] === 'string') {
        updates[k] = body[k].trim()
      } else {
        updates[k] = body[k]
      }
    }

    // Normalise the abbreviation before the RPC. The database compares it to
    // the locked row and freezes real changes once registrations exist.
    if (Object.prototype.hasOwnProperty.call(body, 'abbreviation')) {
      const raw = body.abbreviation
      const normalised = (raw === null || (typeof raw === 'string' && raw.trim() === ''))
        ? null
        : String(raw).trim().toUpperCase()
      if (normalised !== null && !ABBREV_RE.test(normalised)) {
        return badRequest(res, 'abbreviation must be 2 to 8 uppercase letters or digits')
      }
      updates.abbreviation = normalised
    }

    // Normalise empty banner values; database comparison handles no-op saves.
    if (Object.prototype.hasOwnProperty.call(updates, 'banner_url')) {
      const raw = updates.banner_url
      const banner = canonicalAssetReference(raw, {
        bucket: 'competition-banners',
        scopeId: id,
      })
      if (banner.error) return badRequest(res, banner.error)
      updates.banner_url = banner.value
    }

    if (Object.keys(updates).length === 0) {
      return badRequest(res, 'no editable fields supplied')
    }

    // The database validates the patch against the locked current row. Keep
    // this cheap check for requests that include both sides of a date range.
    const dateErr = validateDates(updates)
    if (dateErr) return badRequest(res, dateErr)

    const { data, error } = await supabaseAdmin.rpc('update_competition_config', {
      p_actor_id: user.id,
      p_competition_id: id,
      p_changes: updates,
    })
    if (error) return sendCompetitionRpcError(res, error, 'competition-config:update')
    return res.json(data)
  }

  if (req.method === 'DELETE') {
    // Hard delete is intentionally blocked — archive via PATCH { archived_at }.
    return res.status(405).json({ error: 'Use PATCH { archived_at } to archive a competition. Hard delete is not supported.' })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}


// ── competition-managers ──────────────────────────────────────────────────────
async function handleCompetitionManagers(req, res, user) {
  if (req.method === 'GET') {
    const competitionId = req.query.competition_id
    if (!competitionId) return badRequest(res, 'competition_id query param is required')

    // Embed the manager's profile so the caller can render the list without a
    // second round-trip. Email lives on auth.users (not profiles), so we
    // fetch it separately and merge — same pattern other admin routes use.
    const { data: rows, error } = await supabaseAdmin
      .from('competition_managers')
      .select('user_id, granted_at, granted_by, profiles:user_id(alias, first_name, last_name, email)')
      .eq('competition_id', competitionId)
      .order('granted_at', { ascending: true })
    if (error) return sendServerError(res, error, 'competition-managers:list')

    // SECURITY NOTE: response includes email per manager. Caller (superadmin grant UI) needs it to disambiguate users. Do not surface this endpoint to non-superadmin contexts.
    // email comes from the profiles.email mirror (synced from auth.users), so a
    // placeholder profile (no auth row) surfaces email: null — same as the old
    // getUserById-catch-returns-null behaviour, without the per-row fan-out.
    const out = (rows ?? []).map(r => ({
      user_id: r.user_id,
      granted_at: r.granted_at,
      granted_by: r.granted_by,
      profile: {
        alias: r.profiles?.alias ?? null,
        first_name: r.profiles?.first_name ?? null,
        last_name: r.profiles?.last_name ?? null,
        email: r.profiles?.email ?? null,
      },
    }))
    return res.json(out)
  }

  if (req.method === 'POST') {
    const body = req.body ?? {}
    const competitionId = body.competition_id
    if (!competitionId) return badRequest(res, 'competition_id is required')

    const selection = consumeProfileHandle(res, {
      handle: body.profile_handle,
      purpose: PROFILE_HANDLE_PURPOSES.COMPETITION_MANAGER_GRANT,
      actorId: user.id,
      context: 'competition-manager-grant:profile-handle',
    })
    if (!selection) return
    const userId = selection.profileId

    // Validate both refs exist so the caller gets a clearer error than the raw
    // FK-violation surface from Postgres. Placeholders have no auth.users row
    // and therefore can't log in to act as a manager — reject explicitly so
    // the admin notices and waits for the user to claim their account.
    const [{ data: comp, error: cErr }, { data: prof, error: pErr }] = await Promise.all([
      supabaseAdmin.from('competitions').select('id').eq('id', competitionId).maybeSingle(),
      supabaseAdmin.from('profiles').select('id, is_placeholder, suspended').eq('id', userId).maybeSingle(),
    ])
    if (cErr) return sendServerError(res, cErr, 'competition-managers:grant-competition')
    if (pErr) return sendServerError(res, pErr, 'competition-managers:grant-profile')
    if (!comp) return res.status(404).json({ error: 'competition not found' })
    if (!prof) return res.status(404).json({ error: 'user not found' })
    if (prof.is_placeholder) {
      return res.status(400).json({
        error: 'Cannot grant manager access to a placeholder profile. The user must have claimed their account.',
      })
    }
    if (prof.suspended) {
      return res.status(400).json({ error: 'Cannot grant manager access to a suspended account.' })
    }

    const { data, error } = await supabaseAdmin
      .from('competition_managers')
      .insert({
        competition_id: competitionId,
        user_id: userId,
        granted_by: user.id,
      })
      .select()
      .single()
    if (error) {
      // 23505 = unique_violation. The composite PK is the only realistic
      // collision (one grant per (competition, user)).
      if (error.code === '23505') {
        return res.status(409).json({ error: 'this user is already a manager of that competition' })
      }
      return sendServerError(res, error, 'competition-managers:grant')
    }
    return res.status(201).json(data)
  }

  if (req.method === 'DELETE') {
    const competitionId = req.query.competition_id ?? req.body?.competition_id
    const userId = req.query.user_id ?? req.body?.user_id
    if (!competitionId || !userId) return badRequest(res, 'competition_id and user_id are required')

    const { data, error } = await supabaseAdmin
      .from('competition_managers')
      .delete()
      .eq('competition_id', competitionId)
      .eq('user_id', userId)
      .select()
    if (error) return sendServerError(res, error, 'competition-managers:revoke')
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'no such grant' })
    }
    return res.json({ deleted: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}


// ── profile-search ────────────────────────────────────────────────────────────
// Alias-only profile lookup for the manager-grant and captain-invite pickers.
// The stable profile UUID is encrypted into an actor-bound, purpose-bound,
// five-minute handle and never returned as browser-readable data. Suspended
// placeholder, suspended, and permanently revoked profiles fail closed.
// Case-insensitive ilike is capped at 10 rows.
async function handleProfileSearch(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error: authErr } = await verifyUser(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (q.length < 2) return badRequest(res, 'q must be at least 2 characters')
  if (q.length > 80) return badRequest(res, 'q must be 80 characters or fewer')
  const purpose = req.query.purpose
  if (!Object.values(PROFILE_HANDLE_PURPOSES).includes(purpose)) {
    return badRequest(res, 'purpose must identify a supported profile-selection operation')
  }

  // Escape LIKE wildcards so an alias like "a_b" is matched literally.
  const likePattern = `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, alias')
    .eq('is_placeholder', false)
    .eq('suspended', false)
    .is('access_revoked_at', null)
    .ilike('alias', likePattern)
    .limit(10)
  if (error) return sendServerError(res, error, 'profile-search:query')

  try {
    return res.json((data ?? []).map(profile => ({
      alias: profile.alias,
      handle: issueOpaqueProfileHandle({
        profileId: profile.id,
        purpose,
        actorId: user.id,
      }),
    })))
  } catch (handleError) {
    return sendServerError(res, handleError, 'profile-search:issue-handle')
  }
}


// ── my-competitions ──────────────────────────────────────────────────────────
// Auth: any authenticated user (no superadmin gate). Returns the competitions
// where the caller is in competition_managers AND the competition is not
// archived, ordered by start_date ascending. Used by:
//   - the post-login redirect to detect whether the caller is a manager
//   - the Manager Hub page to render the caller's competition list
// Response shape mirrors the superadmin competitions list so render code can
// be shared.
async function handleMyCompetitions(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error: authErr } = await verifyUser(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  // Superadmins implicitly manage every non-archived competition. This
  // avoids forcing a manual competition_managers grant per superadmin per
  // event, which is friction with no security value (superadmin already
  // bypasses the manager-or-superadmin gate on every write path).
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('roles')
    .eq('id', user.id)
    .maybeSingle()
  if (profileErr) return sendServerError(res, profileErr, 'my-competitions:profile')
  const isSuperadmin = Array.isArray(profile?.roles) && profile.roles.includes('superadmin')

  if (isSuperadmin) {
    const { data: allComps, error: allErr } = await supabaseAdmin
      .from('competitions')
      .select(MANAGED_COMPETITION_COLUMNS)
      .is('archived_at', null)
      .order('start_date', { ascending: true })
    if (allErr) return sendServerError(res, allErr, 'my-competitions:superadmin-list')
    return res.json(await withRegistrationsCount(allComps ?? []))
  }

  // Non-superadmin: fetch the manager grants, then the competitions they
  // point at. Two-step keeps the row shape identical to the superadmin list
  // (so the client renders both with the same code path).
  const { data: grants, error: gErr } = await supabaseAdmin
    .from('competition_managers')
    .select('competition_id')
    .eq('user_id', user.id)
  if (gErr) return sendServerError(res, gErr, 'my-competitions:grants')

  const ids = (grants ?? []).map(g => g.competition_id)
  if (ids.length === 0) return res.json([])

  const { data: comps, error: cErr } = await supabaseAdmin
    .from('competitions')
    .select(MANAGED_COMPETITION_COLUMNS)
    .in('id', ids)
    .is('archived_at', null)
    .order('start_date', { ascending: true })
  if (cErr) return sendServerError(res, cErr, 'my-competitions:list')

  return res.json(await withRegistrationsCount(comps ?? []))
}


// ── my-registrations ─────────────────────────────────────────────────────────
// Auth: any authenticated user. Returns the competitions the caller has
// registered for, restricted to non-archived competitions whose registration
// window is still open. Used by the global My Events nav pill so a player
// who only registered for one or more pre-nats events sees a single
// dropdown of their active memberships. Manager view (registrations they
// manage) lives at /api/superadmin/my-competitions — different surface, same
// authenticated-no-superadmin auth scope.
async function handleMyRegistrations(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error: authErr } = await verifyUser(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  // Two-step rather than a PostgREST embed-with-foreign-table filter, because
  // the archived/close predicates apply to competitions but the row scope is
  // by user_id on competition_registrations. Same pattern as my-competitions.
  const { data: regs, error: rErr } = await supabaseAdmin
    .from('competition_registrations')
    .select('competition_id')
    .eq('user_id', user.id)
  if (rErr) return sendServerError(res, rErr, 'my-registrations:registrations')

  const compIds = (regs ?? []).map(r => r.competition_id)
  if (compIds.length === 0) return res.json([])

  const nowIso = new Date().toISOString()
  const { data: comps, error: cErr } = await supabaseAdmin
    .from('competitions')
    .select('id, slug, name, start_date, end_date')
    .in('id', compIds)
    .is('archived_at', null)
    .or(`registration_close_at.is.null,registration_close_at.gt.${nowIso}`)
    .order('start_date', { ascending: true })
  if (cErr) return sendServerError(res, cErr, 'my-registrations:competitions')

  return res.json((comps ?? []).map(c => ({ competition: c })))
}


// ── competition-registration ─────────────────────────────────────────────────
// Player-self registration into a competition. The BEFORE-INSERT triggers
// from Phase 1a populate payment_reference + amount_owing automatically.
//
// Returns the joined competition row alongside the registration so the hub
// can render its header without a second fetch.

// Subset of competition columns the hub needs. Bank details + payment_info_visible
// included so the registered player can see them when the manager toggles
// visibility on.
const HUB_COMPETITION_COLUMNS =
  'id, slug, name, start_date, end_date, registration_open_at, registration_close_at, price_per_player, payment_info_visible, bank_account_name, bank_bsb, bank_account_number, archived_at'

function maskHiddenCompetitionPaymentDetails(registration) {
  if (!registration?.competition || registration.competition.payment_info_visible === true) {
    return registration
  }
  return {
    ...registration,
    competition: {
      ...registration.competition,
      bank_account_name: null,
      bank_bsb: null,
      bank_account_number: null,
    },
  }
}

async function loadCompetitionRegistration(userId, competitionId) {
  const { data, error } = await supabaseAdmin
    .from('competition_registrations')
    .select(`*, competition:competitions(${HUB_COMPETITION_COLUMNS})`)
    .eq('competition_id', competitionId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return { error }
  return { data: maskHiddenCompetitionPaymentDetails(data) }
}

async function handleCompetitionRegistration(req, res) {
  const { user, error: authErr } = await verifyUser(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  // GET — fetch caller's own registration for a competition.
  if (req.method === 'GET') {
    const competitionId = req.query.competition_id
    if (!competitionId) return badRequest(res, 'competition_id query param is required')

    const { data, error } = await loadCompetitionRegistration(user.id, competitionId)
    if (error) return sendCompetitionRpcError(res, error, 'competition-registration:get')
    if (!data) return res.status(404).json({ error: 'not registered for this competition' })
    return res.json(data)
  }

  // POST — register the caller.
  if (req.method === 'POST') {
    const competitionId = req.body?.competition_id
    if (!competitionId) return badRequest(res, 'competition_id is required')

    const { error: rpcError } = await supabaseAdmin.rpc('register_for_competition', {
      p_user_id: user.id,
      p_competition_id: competitionId,
    })
    if (rpcError) {
      return sendCompetitionRpcError(res, rpcError, 'competition-registration:create')
    }

    const { data, error } = await loadCompetitionRegistration(user.id, competitionId)
    if (error) return sendCompetitionRpcError(res, error, 'competition-registration:load-created')
    if (!data) {
      return sendServerError(
        res,
        new Error('Competition registration create returned no registration.'),
        'competition-registration:create-result',
      )
    }
    return res.status(201).json(data)
  }

  // DELETE — cancel caller's registration.
  if (req.method === 'DELETE') {
    const competitionId = req.query.competition_id ?? req.body?.competition_id
    if (!competitionId) return badRequest(res, 'competition_id is required')

    const { data, error } = await supabaseAdmin.rpc('cancel_competition_registration', {
      p_user_id: user.id,
      p_competition_id: competitionId,
    })
    if (error) return sendCompetitionRpcError(res, error, 'competition-registration:cancel')
    return res.json(data ?? { deleted: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}


// ── competition-registrations ────────────────────────────────────────────────
// Manager-facing read of every registration for a competition. Used by the
// Registrations tab on /manage/competitions/:slug. Auth mirrors handleCompetitions
// PATCH (Phase 2a): superadmin OR a competition manager whose grant covers
// the requested competition_id.
//
// Response per row exposes the public profile fields plus email (pulled from
// auth.users — same pattern as handleCompetitionManagers). Payment and
// audit fields are surfaced so managers can chase up unpaid players.
// Pending/declined team_members are excluded from the team field; only
// accepted memberships count.
async function handleCompetitionRegistrations(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error: authErr } = await verifyUser(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  const competitionId = req.query.competition_id
  if (!competitionId) return badRequest(res, 'competition_id query param is required')

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('roles')
    .eq('id', user.id)
    .maybeSingle()
  if (profileErr) return sendServerError(res, profileErr, 'competition-registrations:profile')
  const isSuperadmin = Array.isArray(profile?.roles) && profile.roles.includes('superadmin')

  if (!isSuperadmin) {
    const { count: mgrCount, error: mgrErr } = await supabaseAdmin
      .from('competition_managers')
      .select('user_id', { count: 'exact', head: true })
      .eq('competition_id', competitionId)
      .eq('user_id', user.id)
    if (mgrErr) return sendServerError(res, mgrErr, 'competition-registrations:manager-gate')
    if ((mgrCount ?? 0) === 0) {
      return res.status(403).json({ error: 'Not authorised to view this competition.' })
    }
  }

  const { data: regs, error: regErr } = await supabaseAdmin
    .from('competition_registrations')
    .select(`
      id, user_id, competition_id, payment_status, amount_paid, amount_owing,
      payment_reference, registered_at, team_id,
      profile:profiles!user_id(alias, first_name, last_name, email)
    `)
    .eq('competition_id', competitionId)
  if (regErr) return sendServerError(res, regErr, 'competition-registrations:list')

  const rows = regs ?? []
  const teamIds = [...new Set(rows.map(r => r.team_id).filter(Boolean))]
  const userIds = rows.map(r => r.user_id)

  // Teams (name + colour) for the team_id column.
  const teamMap = new Map()
  if (teamIds.length > 0) {
    const { data: teams, error: tErr } = await supabaseAdmin
      .from('teams')
      .select('id, name, colour')
      .in('id', teamIds)
    if (tErr) return sendServerError(res, tErr, 'competition-registrations:teams')
    for (const t of teams ?? []) teamMap.set(t.id, t)
  }

  // Accepted team_members roles, keyed by (team_id, user_id). The role
  // surfaced to the client is captain > player.
  const roleMap = new Map()
  if (teamIds.length > 0 && userIds.length > 0) {
    const { data: members, error: mErr } = await supabaseAdmin
      .from('team_members')
      .select('team_id, user_id, roles')
      .in('team_id', teamIds)
      .in('user_id', userIds)
      .eq('invite_status', 'accepted')
    if (mErr) return sendServerError(res, mErr, 'competition-registrations:members')
    for (const m of members ?? []) {
      roleMap.set(`${m.team_id}::${m.user_id}`, m.roles ?? [])
    }
  }

  // email comes from the profiles.email mirror (synced from auth.users) via the
  // embed above; placeholder profiles (no auth row) surface email: null — same
  // as the old per-row getUserById-catch-returns-null behaviour.
  const out = rows.map(r => {
    const team = r.team_id ? (teamMap.get(r.team_id) ?? null) : null
    const roles = roleMap.get(`${r.team_id}::${r.user_id}`) ?? []
    return {
      id: r.id,
      user_id: r.user_id,
      competition_id: r.competition_id,
      payment_status: r.payment_status,
      amount_paid: r.amount_paid,
      amount_owing: r.amount_owing,
      payment_reference: r.payment_reference,
      registered_at: r.registered_at,
      profile: {
        alias: r.profile?.alias ?? null,
        first_name: r.profile?.first_name ?? null,
        last_name: r.profile?.last_name ?? null,
        email: r.profile?.email ?? null,
      },
      team: team
        ? {
            id: team.id,
            name: team.name,
            colour: team.colour,
            role: roles.includes('captain') ? 'captain' : 'player',
          }
        : null,
    }
  })

  out.sort((a, b) =>
    (a.profile.alias ?? '').toLowerCase().localeCompare((b.profile.alias ?? '').toLowerCase())
  )

  return res.json(out)
}


// ── competition-payment-records ──────────────────────────────────────────────
// Manager-facing ledger writes for pre-nationals. Mirrors the ZLTAC
// /api/admin/event?resource=payments shape (POST/GET/PATCH/DELETE) so
// RecordPaymentModal can reuse its existing onChange contract; the modal
// branches on apiResource for URL and body shape only.
//
// Auth on every method: superadmin OR competition_managers grant for the
// competition that owns the targeted registration.
//
// UNIT NOTE: payment_records.amount, competition parent totals, and API
// transport are integer cents. The atomic RPC persists the ledger, cached
// summary, and retry receipt together.

const PAYMENT_RECORD_COLUMNS =
  'id, competition_registration_id, amount, recorded_at, recorded_by, bank_reference, notes, recorder:profiles!recorded_by(alias, first_name, last_name)'

// Returns { isSuperadmin } or sends a 403 response. Caller bails out on
// false return.
async function gateCompetitionPaymentRecord(req, res, competitionRegistrationId) {
  const { user, error: authErr } = await verifyUser(req)
  if (authErr) { res.status(statusForAuthError(authErr)).json({ error: authErr }); return null }

  // Locate the parent competition_id.
  const { data: reg, error: regErr } = await supabaseAdmin
    .from('competition_registrations')
    .select('competition_id')
    .eq('id', competitionRegistrationId)
    .maybeSingle()
  if (regErr) { sendServerError(res, regErr, 'competition-payment-records:gate-registration'); return null }
  if (!reg) { res.status(404).json({ error: 'Competition registration not found' }); return null }

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('roles')
    .eq('id', user.id)
    .maybeSingle()
  if (profileErr) { sendServerError(res, profileErr, 'competition-payment-records:gate-profile'); return null }
  const isSuperadmin = Array.isArray(profile?.roles) && profile.roles.includes('superadmin')

  if (!isSuperadmin) {
    const { count: mgrCount, error: mgrErr } = await supabaseAdmin
      .from('competition_managers')
      .select('user_id', { count: 'exact', head: true })
      .eq('competition_id', reg.competition_id)
      .eq('user_id', user.id)
    if (mgrErr) { sendServerError(res, mgrErr, 'competition-payment-records:gate-manager'); return null }
    if ((mgrCount ?? 0) === 0) {
      res.status(403).json({ error: 'Not authorised to record payments for this competition.' })
      return null
    }
  }

  return { user, competitionId: reg.competition_id }
}

async function handleCompetitionPaymentRecords(req, res) {
  if (req.method === 'POST') {
    const body = req.body ?? {}
    const competitionRegistrationId = body.competition_registration_id
    if (!isUuid(competitionRegistrationId)) {
      return badRequest(res, 'competition_registration_id must be a valid UUID')
    }
    if (!isUuid(body.requestId)) {
      return badRequest(res, 'requestId must be a valid UUID')
    }

    const amountCents = body.amountCents
    if (!Number.isSafeInteger(amountCents) || amountCents === 0 || Math.abs(amountCents) > 2147483647) {
      return badRequest(res, 'amountCents must be a non-zero safe integer')
    }

    const { user, error: authErr } = await verifyUser(req)
    if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

    const { data, error } = await supabaseAdmin.rpc('record_competition_payment', {
      p_actor_id: user.id,
      p_registration_id: competitionRegistrationId,
      p_request_id: body.requestId,
      p_amount: amountCents,
      p_recorded_at: body.recorded_at || null,
      p_bank_reference: body.bank_reference?.trim() || null,
      p_notes: body.notes?.trim() || null,
    })
    if (error) {
      return sendCompetitionRpcError(res, error, 'competition-payment-records:create')
    }
    return res.status(201).json(data)
  }

  if (req.method === 'GET') {
    const competitionRegistrationId = req.query.competition_registration_id
    if (!isUuid(competitionRegistrationId)) {
      return badRequest(res, 'competition_registration_id must be a valid UUID')
    }

    const gate = await gateCompetitionPaymentRecord(req, res, competitionRegistrationId)
    if (!gate) return

    const { data: records, error } = await supabaseAdmin
      .from('payment_records')
      .select(PAYMENT_RECORD_COLUMNS)
      .eq('competition_registration_id', competitionRegistrationId)
      .order('recorded_at', { ascending: false })
    if (error) return sendServerError(res, error, 'competition-payment-records:list')

    const out = (records ?? []).map(r => ({
      id: r.id,
      competition_registration_id: r.competition_registration_id,
      amount: r.amount,
      recorded_at: r.recorded_at,
      recorded_by: r.recorded_by,
      recorded_by_profile: r.recorder
        ? { alias: r.recorder.alias, first_name: r.recorder.first_name, last_name: r.recorder.last_name }
        : null,
      bank_reference: r.bank_reference,
      notes: r.notes,
    }))
    return res.json(out)
  }

  if (req.method === 'PATCH') {
    const id = req.query.id ?? req.body?.id
    if (!isUuid(id)) return badRequest(res, 'id must be a valid UUID')

    const body = req.body ?? {}
    if (!isUuid(body.requestId)) return badRequest(res, 'requestId must be a valid UUID')

    const { user, error: authErr } = await verifyUser(req)
    if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

    const updates = {}
    if (Object.prototype.hasOwnProperty.call(body, 'amountCents')) {
      const amountCents = body.amountCents
      if (!Number.isSafeInteger(amountCents) || amountCents === 0 || Math.abs(amountCents) > 2147483647) {
        return badRequest(res, 'amountCents must be a non-zero safe integer')
      }
      updates.amount = amountCents
    }
    if (Object.prototype.hasOwnProperty.call(body, 'bank_reference')) {
      updates.bank_reference = body.bank_reference?.trim() || null
    }
    if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
      updates.notes = body.notes?.trim() || null
    }
    if (Object.prototype.hasOwnProperty.call(body, 'recorded_at')) {
      updates.recorded_at = body.recorded_at || new Date().toISOString()
    }
    if (Object.keys(updates).length === 0) {
      return badRequest(res, 'no editable fields supplied')
    }

    const { data, error } = await supabaseAdmin.rpc('update_competition_payment', {
      p_actor_id: user.id,
      p_payment_id: id,
      p_request_id: body.requestId,
      p_changes: updates, // already in cents; partial keys preserve PATCH semantics
    })
    if (error) {
      return sendCompetitionRpcError(res, error, 'competition-payment-records:update')
    }
    return res.json(data)
  }

  if (req.method === 'DELETE') {
    const id = req.query.id ?? req.body?.id
    if (!isUuid(id)) return badRequest(res, 'id must be a valid UUID')
    if (!isUuid(req.body?.requestId)) return badRequest(res, 'requestId must be a valid UUID')

    const { user, error: authErr } = await verifyUser(req)
    if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

    const { data, error } = await supabaseAdmin.rpc('remove_competition_payment', {
      p_actor_id: user.id,
      p_payment_id: id,
      p_request_id: req.body.requestId,
    })
    if (error) {
      return sendCompetitionRpcError(res, error, 'competition-payment-records:delete')
    }
    return res.json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}


// ── competition-team ─────────────────────────────────────────────────────────
// Player-self team management: create, view, edit, disband. Phase 3d will
// add the invite flow on top of this.

const TEAM_NAME_MAX = 50
const TEAM_MEMBER_COLUMNS = 'id, user_id, roles, invite_status, invited_at, responded_at, invited_by, profile:profiles!user_id(id, alias, first_name, last_name)'

function visibleTeamMembers(team, members, viewerId) {
  const isCaptain = team?.captain_id === viewerId
  return (members ?? []).filter(member =>
    member.invite_status === 'accepted'
      || (isCaptain && member.invite_status === 'pending')
  )
}

async function loadTeamWithMembers(teamId, viewerId) {
  const [{ data: team, error: tErr }, { data: members, error: mErr }] = await Promise.all([
    supabaseAdmin
      .from('teams')
      .select('id, competition_id, name, colour, captain_id, manager_id, status, created_at')
      .eq('id', teamId)
      .maybeSingle(),
    supabaseAdmin
      .from('team_members')
      .select(TEAM_MEMBER_COLUMNS)
      .eq('team_id', teamId),
  ])
  if (tErr) return { error: tErr }
  if (mErr) return { error: mErr }
  if (!team) return { error: 'team not found', notFound: true }
  return { team: { ...team, members: visibleTeamMembers(team, members, viewerId) } }
}

async function loadCompetitionTeamMember(membershipId) {
  const { data, error } = await supabaseAdmin
    .from('team_members')
    .select(TEAM_MEMBER_COLUMNS)
    .eq('id', membershipId)
    .maybeSingle()
  if (error) return { error }
  if (!data) return { error: 'membership not found', notFound: true }
  return { membership: data }
}

async function handleCompetitionTeam(req, res) {
  const { user, error: authErr } = await verifyUser(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  // GET — caller's team for a competition.
  if (req.method === 'GET') {
    const competitionId = req.query.competition_id
    if (!competitionId) return badRequest(res, 'competition_id query param is required')

    // Filter to accepted memberships so pending invitees do NOT see the team
    // they have been invited to via this endpoint — they fetch from
    // competition-team-invite until they accept.
    const { data: membership, error: memErr } = await supabaseAdmin
      .from('team_members')
      .select('team_id, teams!inner(id, competition_id)')
      .eq('user_id', user.id)
      .eq('invite_status', 'accepted')
      .eq('teams.competition_id', competitionId)
      .maybeSingle()
    if (memErr) return sendServerError(res, memErr, 'competition-team:get-membership')
    if (!membership) return res.status(404).json({ error: 'not on a team for this competition' })

    const result = await loadTeamWithMembers(membership.team_id, user.id)
    if (result.error) {
      if (result.notFound) return res.status(404).json({ error: result.error })
      return sendServerError(res, result.error, 'competition-team:get-result')
    }
    return res.json(result.team)
  }

  // POST — create a team for a competition the caller is registered for.
  if (req.method === 'POST') {
    const body = req.body ?? {}
    const competitionId = body.competition_id
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const colour = body.colour

    if (!competitionId) return badRequest(res, 'competition_id is required')
    if (!name) return badRequest(res, 'name is required')
    if (name.length > TEAM_NAME_MAX) return badRequest(res, `name must be ${TEAM_NAME_MAX} characters or fewer`)
    if (!TEAM_COLOURS.includes(colour)) return badRequest(res, 'colour must be one of the team palette values')

    const { data: created, error: createError } = await supabaseAdmin.rpc(
      'create_competition_team',
      {
        p_actor_id: user.id,
        p_competition_id: competitionId,
        p_name: name,
        p_colour: colour,
      },
    )
    if (createError) {
      return sendCompetitionRpcError(res, createError, 'competition-team:create')
    }

    const result = await loadTeamWithMembers(created?.team_id, user.id)
    if (result.error) return sendServerError(res, result.error, 'competition-team:create-result')
    return res.status(201).json(result.team)
  }

  // PATCH — caller must be captain.
  if (req.method === 'PATCH') {
    const teamId = req.query.team_id ?? req.body?.team_id
    if (!teamId) return badRequest(res, 'team_id is required')

    const body = req.body ?? {}
    const updates = {}
    if ('name' in body) {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name) return badRequest(res, 'name is required')
      if (name.length > TEAM_NAME_MAX) return badRequest(res, `name must be ${TEAM_NAME_MAX} characters or fewer`)
      updates.name = name
    }
    if ('colour' in body) {
      if (!TEAM_COLOURS.includes(body.colour)) return badRequest(res, 'colour must be one of the team palette values')
      updates.colour = body.colour
    }
    if (Object.keys(updates).length === 0) {
      return badRequest(res, 'no editable fields supplied')
    }

    const { error: updErr } = await supabaseAdmin.rpc('update_competition_team', {
      p_actor_id: user.id,
      p_team_id: teamId,
      p_name: updates.name ?? null,
      p_colour: updates.colour ?? null,
    })
    if (updErr) return sendCompetitionRpcError(res, updErr, 'competition-team:update')

    const result = await loadTeamWithMembers(teamId, user.id)
    if (result.error) return sendServerError(res, result.error, 'competition-team:update-result')
    return res.json(result.team)
  }

  // DELETE — disband. Only the captain, only when no other members remain.
  if (req.method === 'DELETE') {
    const teamId = req.query.team_id ?? req.body?.team_id
    if (!teamId) return badRequest(res, 'team_id is required')

    const { data, error } = await supabaseAdmin.rpc('disband_competition_team', {
      p_actor_id: user.id,
      p_team_id: teamId,
    })
    if (error) return sendCompetitionRpcError(res, error, 'competition-team:disband')
    return res.json(data ?? { deleted: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}


// ── competition-team-member ──────────────────────────────────────────────────
// Phase 3d: captain-driven invite / revoke / remove + member self-leave. Plan
// term -> column mapping is recorded in the Phase 3d migration header
// (20260527020000_team_members_invite_flow.sql). Summary:
//   POST   { team_id, profile_handle }   -> captain invites a player (pending row)
//   GET    ?team_id=...                  -> roster (accepted + pending), sorted
//   DELETE ?id=...                       -> captain revokes/removes OR member leaves
//
// Pending invitees use competition-team-invite PATCH (accept/decline), not
// this DELETE, so the audit trail keeps the declined row.

async function handleCompetitionTeamMember(req, res) {
  const { user, error: authErr } = await verifyUser(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  if (req.method === 'POST') {
    const body = req.body ?? {}
    const teamId = body.team_id
    if (!teamId) return badRequest(res, 'team_id is required')

    const selection = consumeProfileHandle(res, {
      handle: body.profile_handle,
      purpose: PROFILE_HANDLE_PURPOSES.COMPETITION_TEAM_INVITE,
      actorId: user.id,
      context: 'competition-team-member:profile-handle',
    })
    if (!selection) return
    const inviteeId = selection.profileId

    const { data: invited, error: inviteError } = await supabaseAdmin.rpc(
      'invite_competition_team_member',
      {
        p_actor_id: user.id,
        p_team_id: teamId,
        p_invitee_id: inviteeId,
      },
    )
    if (inviteError) {
      return sendCompetitionRpcError(res, inviteError, 'competition-team-member:invite')
    }

    const result = await loadCompetitionTeamMember(invited?.membership_id)
    if (result.error) {
      if (result.notFound) return res.status(404).json({ error: result.error })
      return sendServerError(res, result.error, 'competition-team-member:invite-result')
    }
    return res.status(201).json(result.membership)
  }

  if (req.method === 'GET') {
    const teamId = req.query.team_id
    if (!teamId) return badRequest(res, 'team_id query param is required')

    // Pending invitees use competition-team-invite and declined invite rows
    // remain only as audit history. Only accepted members may read a roster.
    const { data: callerRow, error: cErr } = await supabaseAdmin
      .from('team_members')
      .select('invite_status, roles')
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (cErr) return sendServerError(res, cErr, 'competition-team-member:membership')
    if (!callerRow || callerRow.invite_status !== 'accepted') {
      return res.status(403).json({ error: 'Not an accepted member of this team.' })
    }

    const { data: members, error: mErr } = await supabaseAdmin
      .from('team_members')
      .select(TEAM_MEMBER_COLUMNS)
      .eq('team_id', teamId)
    if (mErr) return sendServerError(res, mErr, 'competition-team-member:list')

    // Sort in JS: captain first, then accepted alphabetically by alias, then
    // pending by invited_at desc.
    const isCaptain = (callerRow.roles ?? []).includes('captain')
    const visibleMembers = (members ?? []).filter(member =>
      member.invite_status === 'accepted'
        || (isCaptain && member.invite_status === 'pending')
    )
    const sorted = visibleMembers.slice().sort((a, b) => {
      const aCap = (a.roles ?? []).includes('captain')
      const bCap = (b.roles ?? []).includes('captain')
      if (aCap !== bCap) return aCap ? -1 : 1
      const aPending = a.invite_status === 'pending'
      const bPending = b.invite_status === 'pending'
      if (aPending !== bPending) return aPending ? 1 : -1
      if (aPending) {
        return new Date(b.invited_at).getTime() - new Date(a.invited_at).getTime()
      }
      const aAlias = (a.profile?.alias ?? '').toLowerCase()
      const bAlias = (b.profile?.alias ?? '').toLowerCase()
      return aAlias.localeCompare(bAlias)
    })

    return res.json(sorted)
  }

  if (req.method === 'DELETE') {
    const rowId = req.query.id
    if (!rowId) return badRequest(res, 'id query param is required')

    const { data, error } = await supabaseAdmin.rpc(
      'remove_competition_team_member',
      {
        p_actor_id: user.id,
        p_membership_id: rowId,
      },
    )
    if (error) {
      return sendCompetitionRpcError(res, error, 'competition-team-member:remove')
    }
    return res.json(data ?? { deleted: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}


// ── competition-team-invite ──────────────────────────────────────────────────
// Phase 3d: invitee-facing accept / decline. Separate resource from
// competition-team-member because the caller here is pending (not yet on the
// team for permission purposes).
//
//   GET   ?competition_id=...                       -> caller's pending invites
//   PATCH ?id=... body: { action: 'accept'|'decline' }
//
// Accepting auto-declines sibling pending invites for the same competition,
// since a player can only be on one team per competition.

async function handleCompetitionTeamInvite(req, res) {
  const { user, error: authErr } = await verifyUser(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  if (req.method === 'GET') {
    const competitionId = req.query.competition_id
    if (!competitionId) return badRequest(res, 'competition_id query param is required')

    const { data, error } = await supabaseAdmin
      .from('team_members')
      .select(`
        id, team_id, invite_status, invited_at, invited_by,
        team:teams!inner(id, name, colour, captain_id, competition_id),
        inviter:profiles!invited_by(id, alias, first_name, last_name)
      `)
      .eq('user_id', user.id)
      .eq('invite_status', 'pending')
      .eq('team.competition_id', competitionId)
      .order('invited_at', { ascending: false })
    if (error) return sendServerError(res, error, 'competition-team-invite:list')
    return res.json(data ?? [])
  }

  if (req.method === 'PATCH') {
    const rowId = req.query.id
    const action = req.body?.action
    if (!rowId) return badRequest(res, 'id query param is required')
    if (action !== 'accept' && action !== 'decline') {
      return badRequest(res, 'action must be "accept" or "decline"')
    }

    const { data: responseResult, error: responseError } = await supabaseAdmin.rpc(
      'respond_competition_team_invite',
      {
        p_actor_id: user.id,
        p_membership_id: rowId,
        p_action: action,
      },
    )
    if (responseError) {
      return sendCompetitionRpcError(res, responseError, 'competition-team-invite:respond')
    }

    const result = await loadCompetitionTeamMember(responseResult?.membership_id)
    if (result.error) {
      if (result.notFound) return res.status(404).json({ error: result.error })
      return sendServerError(res, result.error, 'competition-team-invite:respond-result')
    }
    return res.json(result.membership)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}


// ── competition team moderation ───────────────────────────────────────────────
// Backs the manager Teams tab. Auth differs per resource:
//   competition-teams (GET)            -> committee OR this competition's manager
//   competition-team-approve (POST)    -> committee OR this competition's manager
//   competition-team-unapprove (POST)  -> committee OR this competition's manager
//   competition-team-rename (POST)     -> committee OR this competition's manager
// Competition teams bypass the ZLTAC team-lock trigger (it early-returns when
// event_id IS NULL), so status writes here are safe via the service role.

// Resolves whether `user` may manage teams in `competitionId`: true for any
// committee member, otherwise checks for a competition_managers grant. Returns
// { ok: true }, a deliberate authorisation failure, or an internal error so
// callers can short-circuit without exposing database details.
async function authoriseCompetitionManage(user, competitionId) {
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('roles')
    .eq('id', user.id)
    .maybeSingle()
  if (profileErr) {
    return {
      ok: false,
      internalError: profileErr,
      context: 'competition-manage:profile',
    }
  }
  const roles = Array.isArray(profile?.roles) ? profile.roles : []
  if (roles.some(r => COMMITTEE_ROLES.includes(r))) return { ok: true }

  const { count, error: mgrErr } = await supabaseAdmin
    .from('competition_managers')
    .select('user_id', { count: 'exact', head: true })
    .eq('competition_id', competitionId)
    .eq('user_id', user.id)
  if (mgrErr) {
    return {
      ok: false,
      internalError: mgrErr,
      context: 'competition-manage:manager-gate',
    }
  }
  if ((count ?? 0) === 0) {
    return { ok: false, status: 403, error: 'Not authorised to manage this competition.' }
  }
  return { ok: true }
}

// Auth gate for a single team moderation action. Verifies the caller, loads
// the team, confirms it is a competition team (not a ZLTAC event team), and
// checks committee-or-manager authorisation. Returns { team } or null (a
// response has already been sent).
async function gateCompetitionTeam(req, res, teamId) {
  const { user, error: authErr } = await verifyUser(req)
  if (authErr) { res.status(statusForAuthError(authErr)).json({ error: authErr }); return null }
  if (!teamId) { badRequest(res, 'team_id is required'); return null }

  const { data: team, error: teamErr } = await supabaseAdmin
    .from('teams')
    .select('id, competition_id, name, status')
    .eq('id', teamId)
    .maybeSingle()
  if (teamErr) {
    sendServerError(res, teamErr, 'competition-team:gate-team')
    return null
  }
  if (!team) { res.status(404).json({ error: 'team not found' }); return null }
  if (!team.competition_id) { res.status(400).json({ error: 'not a competition team' }); return null }

  const auth = await authoriseCompetitionManage(user, team.competition_id)
  if (auth.internalError) {
    sendServerError(res, auth.internalError, auth.context)
    return null
  }
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return null }
  return { team, user }
}

async function handleCompetitionAssetUpload(req, res) {
  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { user, error: authErr } = await verifyUser(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  const action = req.body?.action ?? 'issue'
  if (!['issue', 'finalize'].includes(action)) {
    return badRequest(res, 'Asset upload action is invalid.')
  }

  const competitionId = req.body?.scopeId
  if (!isUuid(competitionId)) return badRequest(res, 'A valid competition upload scope is required.')

  const { data: competition, error: competitionErr } = await supabaseAdmin
    .from('competitions')
    .select('id, archived_at')
    .eq('id', competitionId)
    .maybeSingle()
  if (competitionErr) {
    return sendServerError(res, competitionErr, 'competition-asset-upload:competition')
  }
  if (!competition) return res.status(404).json({ error: 'competition not found' })
  if (competition.archived_at) {
    return res.status(409).json({ error: 'Archived competitions cannot accept new uploads.' })
  }

  const authorisation = await authoriseCompetitionManage(user, competitionId)
  if (authorisation.internalError) {
    return sendServerError(res, authorisation.internalError, authorisation.context)
  }
  if (!authorisation.ok) {
    return res.status(authorisation.status).json({ error: authorisation.error })
  }

  if (!await enforceRateLimit(req, res, {
    identifier: user.id,
    limit: 20,
    window: '1 m',
    prefix: 'competition-asset-upload',
    requireDistributed: true,
  })) return

  const operation = action === 'finalize'
    ? finalizeSignedAssetUpload
    : issueSignedAssetUpload
  const result = await operation({
    supabase: supabaseAdmin,
    input: req.body,
    allowedPurposes: COMPETITION_ASSET_PURPOSES,
    actorId: user.id,
  })
  if (result.error) return res.status(400).json({ error: result.error })
  if (result.serviceError) {
    return sendServerError(res, result.serviceError, 'competition-asset-upload:authorise')
  }

  res.setHeader?.('Cache-Control', 'no-store')
  return res.status(201).json(result.data)
}

async function loadCompetitionTeamSummary(teamId) {
  const { data, error } = await supabaseAdmin
    .from('teams')
    .select('id, competition_id, name, status')
    .eq('id', teamId)
    .maybeSingle()
  if (error) return { error }
  if (!data) return { error: 'team not found', notFound: true }
  return { team: data }
}

async function handleCompetitionTeamsList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error: authErr } = await verifyUser(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  const competitionId = req.query.competition_id
  if (!competitionId) return badRequest(res, 'competition_id query param is required')

  const auth = await authoriseCompetitionManage(user, competitionId)
  if (auth.internalError) return sendServerError(res, auth.internalError, auth.context)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error })

  const { data: teams, error: teamsErr } = await supabaseAdmin
    .from('teams')
    .select('id, name, colour, status, captain_id, created_at')
    .eq('competition_id', competitionId)
    .order('created_at', { ascending: true })
  if (teamsErr) return sendServerError(res, teamsErr, 'competition-teams:list')

  const teamIds = (teams ?? []).map(t => t.id)
  const membersByTeam = new Map()
  if (teamIds.length > 0) {
    const { data: members, error: mErr } = await supabaseAdmin
      .from('team_members')
      .select('team_id, user_id, roles, profile:profiles!user_id(id, alias, first_name, last_name)')
      .in('team_id', teamIds)
      .eq('invite_status', 'accepted')
    if (mErr) return sendServerError(res, mErr, 'competition-teams:members')
    for (const m of members ?? []) {
      if (!membersByTeam.has(m.team_id)) membersByTeam.set(m.team_id, [])
      membersByTeam.get(m.team_id).push({
        user_id: m.user_id,
        roles: Array.isArray(m.roles) ? m.roles : [],
        alias: m.profile?.alias ?? null,
        first_name: m.profile?.first_name ?? null,
        last_name: m.profile?.last_name ?? null,
      })
    }
  }

  const out = (teams ?? []).map(t => ({
    id: t.id,
    name: t.name,
    colour: t.colour,
    status: t.status,
    captain_id: t.captain_id,
    members: membersByTeam.get(t.id) ?? [],
  }))
  return res.json(out)
}

async function handleCompetitionTeamStatus(req, res, nextStatus) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const teamId = req.body?.team_id ?? req.query.team_id
  const gate = await gateCompetitionTeam(req, res, teamId)
  if (!gate) return

  const { error } = await supabaseAdmin.rpc('moderate_competition_team', {
    p_actor_id: gate.user.id,
    p_team_id: gate.team.id,
    p_status: nextStatus,
    p_name: null,
  })
  if (error) return sendCompetitionRpcError(res, error, 'competition-team:moderate-status')

  const result = await loadCompetitionTeamSummary(gate.team.id)
  if (result.error) {
    if (result.notFound) return res.status(404).json({ error: result.error })
    return sendServerError(res, result.error, 'competition-team:moderate-status-result')
  }
  return res.json(result.team)
}

async function handleCompetitionTeamRename(req, res) {
  if (req.method !== 'POST' && req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const teamId = req.body?.team_id ?? req.query.team_id
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const gate = await gateCompetitionTeam(req, res, teamId)
  if (!gate) return
  if (!name) return badRequest(res, 'name is required')
  if (name.length > TEAM_NAME_MAX) return badRequest(res, `name must be ${TEAM_NAME_MAX} characters or fewer`)

  const { error } = await supabaseAdmin.rpc('moderate_competition_team', {
    p_actor_id: gate.user.id,
    p_team_id: gate.team.id,
    p_status: null,
    p_name: name,
  })
  if (error) return sendCompetitionRpcError(res, error, 'competition-team:moderate-name')

  const result = await loadCompetitionTeamSummary(gate.team.id)
  if (result.error) {
    if (result.notFound) return res.status(404).json({ error: result.error })
    return sendServerError(res, result.error, 'competition-team:moderate-name-result')
  }
  return res.json(result.team)
}

// ── Dispatch ──────────────────────────────────────────────────────────────────
// competition-managers stays purely superadmin-gated. Every other resource
// verifies auth internally because the audience differs per method (e.g.
// competitions PATCH admits competition managers, GET/POST do not). See the
// header comment block for the full per-method auth matrix.
export default async function handler(req, res) {
  const resource = req.query.resource

  if (resource === 'profile-search')             return handleProfileSearch(req, res)
  if (resource === 'my-competitions')            return handleMyCompetitions(req, res)
  if (resource === 'my-registrations')           return handleMyRegistrations(req, res)
  if (resource === 'competition-registration')   return handleCompetitionRegistration(req, res)
  if (resource === 'competition-registrations')  return handleCompetitionRegistrations(req, res)
  if (resource === 'competition-payment-records') return handleCompetitionPaymentRecords(req, res)
  if (resource === 'competition-team')           return handleCompetitionTeam(req, res)
  if (resource === 'competition-team-member')    return handleCompetitionTeamMember(req, res)
  if (resource === 'competition-team-invite')    return handleCompetitionTeamInvite(req, res)
  if (resource === 'competition-teams')          return handleCompetitionTeamsList(req, res)
  if (resource === 'competition-team-approve')   return handleCompetitionTeamStatus(req, res, 'approved')
  if (resource === 'competition-team-unapprove') return handleCompetitionTeamStatus(req, res, 'pending')
  if (resource === 'competition-team-rename')    return handleCompetitionTeamRename(req, res)
  if (resource === 'competition-asset-upload')   return handleCompetitionAssetUpload(req, res)
  if (resource === 'competitions')               return handleCompetitions(req, res)

  // competition-managers is the one remaining purely-superadmin resource.
  const { user, error: authErr } = await verifySuperAdmin(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  if (resource === 'competition-managers') return handleCompetitionManagers(req, res, user)
  return res.status(404).json({ error: 'unknown resource' })
}
