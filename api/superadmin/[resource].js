import supabaseAdmin from '../_lib/supabase.js'
import { verifyUser, verifySuperAdmin, statusForAuthError } from '../_lib/auth.js'
import { computeCompetitionAmountPaid } from '../_lib/computeCompetitionAmountPaid.js'
import { TEAM_COLOURS } from '../../src/lib/teamColours.js'

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
      if (!/^https:\/\//i.test(b)) return 'banner_url must start with https://'
      if (b.length > 2048) return 'banner_url must be 2048 characters or fewer'
    }
  }
  return null
}

function badRequest(res, message) {
  return res.status(400).json({ error: message })
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
    let q = supabaseAdmin.from('competitions').select('*').order('start_date', { ascending: false })
    if (!includeArchived) q = q.is('archived_at', null)
    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })

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
      return res.status(500).json({ error: err.message })
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
      return res.status(500).json({ error: error.message })
    }
    return res.status(201).json(data)
  }

  if (req.method === 'PATCH') {
    const { user, error: authErr } = await verifyUser(req)
    if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

    const id = req.query.id ?? req.body?.id
    if (!id) return badRequest(res, 'competition id is required (?id= or body.id)')

    // Determine the caller's authority: superadmin can edit anything,
    // including archive; a competition manager can edit only their own row
    // and cannot set archived_at.
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('roles')
      .eq('id', user.id)
      .maybeSingle()
    if (profileErr) return res.status(500).json({ error: profileErr.message })
    const isSuperadmin = Array.isArray(profile?.roles) && profile.roles.includes('superadmin')

    if (!isSuperadmin) {
      const { count: mgrCount, error: mgrErr } = await supabaseAdmin
        .from('competition_managers')
        .select('user_id', { count: 'exact', head: true })
        .eq('competition_id', id)
        .eq('user_id', user.id)
      if (mgrErr) return res.status(500).json({ error: mgrErr.message })
      if ((mgrCount ?? 0) === 0) {
        return res.status(403).json({ error: 'Not authorised to edit this competition.' })
      }
    }

    const body = req.body ?? {}

    // Managers may not archive — only superadmins.
    if (!isSuperadmin && Object.prototype.hasOwnProperty.call(body, 'archived_at')) {
      return res.status(403).json({ error: 'Only superadmins can archive a competition.' })
    }

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

    // Abbreviation gets its own handling: uppercase + validate, then refuse
    // the change if any registrations already exist (their payment refs were
    // generated against the old prefix and we don't rewrite history).
    //
    // Change-detection: if the normalised incoming value equals the stored
    // value, this is a no-op. Regex validation and the registrations lock
    // check are both skipped so a client re-sending the full payload with
    // the unchanged abbreviation does not trip the 409 — relevant for the
    // manager Edit Details form, which always sends every field.
    if (Object.prototype.hasOwnProperty.call(body, 'abbreviation')) {
      const raw = body.abbreviation
      const normalised = (raw === null || (typeof raw === 'string' && raw.trim() === ''))
        ? null
        : String(raw).trim().toUpperCase()

      const { data: current, error: curErr } = await supabaseAdmin
        .from('competitions')
        .select('abbreviation')
        .eq('id', id)
        .maybeSingle()
      if (curErr) return res.status(500).json({ error: curErr.message })
      if (!current) return res.status(404).json({ error: 'competition not found' })

      if (normalised !== current.abbreviation) {
        if (normalised !== null && !ABBREV_RE.test(normalised)) {
          return badRequest(res, 'abbreviation must be 2 to 8 uppercase letters or digits')
        }

        const { count, error: cntErr } = await supabaseAdmin
          .from('competition_registrations')
          .select('id', { count: 'exact', head: true })
          .eq('competition_id', id)
        if (cntErr) return res.status(500).json({ error: cntErr.message })
        if ((count ?? 0) > 0) {
          return res.status(409).json({
            error: 'Cannot change abbreviation while registrations exist. Existing payment references would become inconsistent.',
          })
        }

        updates.abbreviation = normalised
      }
    }

    // Banner URL no-op detection: if the incoming value matches the stored
    // value (treating empty string as null), skip writing it so an unchanged
    // form save does not churn the row. Same shape as the abbreviation
    // dirty-check above. Validation already ran in validateContent.
    if (Object.prototype.hasOwnProperty.call(updates, 'banner_url')) {
      const raw = updates.banner_url
      const normalised = (raw === null || (typeof raw === 'string' && raw.trim() === ''))
        ? null
        : String(raw).trim()

      const { data: currentBanner, error: bErr } = await supabaseAdmin
        .from('competitions')
        .select('banner_url')
        .eq('id', id)
        .maybeSingle()
      if (bErr) return res.status(500).json({ error: bErr.message })
      if (!currentBanner) return res.status(404).json({ error: 'competition not found' })

      if (normalised === currentBanner.banner_url) {
        delete updates.banner_url
      } else {
        updates.banner_url = normalised
      }
    }

    if (Object.keys(updates).length === 0) {
      return badRequest(res, 'no editable fields supplied')
    }

    // Re-validate dates against the merged view: pull the current row, layer
    // the patch on top, and run the same validator the POST path uses. This
    // catches "lower end_date below the existing start_date" without needing
    // to ask the caller to send both.
    const { data: existing, error: getErr } = await supabaseAdmin
      .from('competitions')
      .select('start_date, end_date, registration_open_at, registration_close_at')
      .eq('id', id)
      .maybeSingle()
    if (getErr) return res.status(500).json({ error: getErr.message })
    if (!existing) return res.status(404).json({ error: 'competition not found' })

    const merged = { ...existing, ...updates }
    const dateErr = validateDates(merged)
    if (dateErr) return badRequest(res, dateErr)

    const { data, error } = await supabaseAdmin
      .from('competitions')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
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
      .select('user_id, granted_at, granted_by, profiles:user_id(alias, first_name, last_name)')
      .eq('competition_id', competitionId)
      .order('granted_at', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })

    // SECURITY NOTE: response includes email per manager. Caller (superadmin grant UI) needs it to disambiguate users. Do not surface this endpoint to non-superadmin contexts.
    // Pull emails for the granted users from auth.users via the admin API.
    // Cheap because manager grants per competition are a tiny set.
    const out = []
    for (const r of (rows ?? [])) {
      let email = null
      try {
        const { data: au } = await supabaseAdmin.auth.admin.getUserById(r.user_id)
        email = au?.user?.email ?? null
      } catch {
        // Placeholder profiles have no auth.users row — leave email null.
      }
      out.push({
        user_id: r.user_id,
        granted_at: r.granted_at,
        granted_by: r.granted_by,
        profile: {
          alias: r.profiles?.alias ?? null,
          first_name: r.profiles?.first_name ?? null,
          last_name: r.profiles?.last_name ?? null,
          email,
        },
      })
    }
    return res.json(out)
  }

  if (req.method === 'POST') {
    const body = req.body ?? {}
    const competitionId = body.competition_id
    const userId = body.user_id
    if (!competitionId || !userId) return badRequest(res, 'competition_id and user_id are required')

    // Validate both refs exist so the caller gets a clearer error than the raw
    // FK-violation surface from Postgres. Placeholders have no auth.users row
    // and therefore can't log in to act as a manager — reject explicitly so
    // the admin notices and waits for the user to claim their account.
    const [{ data: comp, error: cErr }, { data: prof, error: pErr }] = await Promise.all([
      supabaseAdmin.from('competitions').select('id').eq('id', competitionId).maybeSingle(),
      supabaseAdmin.from('profiles').select('id, is_placeholder').eq('id', userId).maybeSingle(),
    ])
    if (cErr) return res.status(500).json({ error: cErr.message })
    if (pErr) return res.status(500).json({ error: pErr.message })
    if (!comp) return res.status(404).json({ error: 'competition not found' })
    if (!prof) return res.status(404).json({ error: 'user not found' })
    if (prof.is_placeholder) {
      return res.status(400).json({
        error: 'Cannot grant manager access to a placeholder profile. The user must have claimed their account.',
      })
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
      return res.status(500).json({ error: error.message })
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
    if (error) return res.status(500).json({ error: error.message })
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'no such grant' })
    }
    return res.json({ deleted: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}


// ── profile-search ────────────────────────────────────────────────────────────
// Lightweight alias-only profile lookup. Two callers today: the superadmin
// manager-grant UI and the Phase 3d captain invite picker. Auth was relaxed
// to authenticated in Phase 3d (captain isn't a superadmin). Only
// non-placeholder profiles are returned; no email is exposed (that surfaces
// on the manager-list response). Case-insensitive ilike on alias, capped at
// 10 rows.
async function handleProfileSearch(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { error: authErr } = await verifyUser(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  const q = (req.query.q ?? '').trim()
  if (q.length < 2) return badRequest(res, 'q must be at least 2 characters')

  // Escape LIKE wildcards so an alias like "a_b" is matched literally.
  const likePattern = `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, alias, first_name, last_name, is_placeholder')
    .eq('is_placeholder', false)
    .ilike('alias', likePattern)
    .limit(10)
  if (error) return res.status(500).json({ error: error.message })

  const out = (data ?? []).map(p => ({
    id: p.id,
    alias: p.alias,
    first_name: p.first_name,
    last_name: p.last_name,
    // ALSA ID short — first segment of the UUID, matches how PlayerHub renders it.
    alsa_id_short: p.id.split('-')[0].toUpperCase(),
  }))
  return res.json(out)
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

  // Fetch the manager grants, then the competitions they point at. Could be a
  // join via PostgREST embed; doing it in two steps keeps the row shape
  // identical to the superadmin list (so the client renders both with the same
  // code path).
  const { data: grants, error: gErr } = await supabaseAdmin
    .from('competition_managers')
    .select('competition_id')
    .eq('user_id', user.id)
  if (gErr) return res.status(500).json({ error: gErr.message })

  const ids = (grants ?? []).map(g => g.competition_id)
  if (ids.length === 0) return res.json([])

  const { data: comps, error: cErr } = await supabaseAdmin
    .from('competitions')
    .select('*')
    .in('id', ids)
    .is('archived_at', null)
    .order('start_date', { ascending: true })
  if (cErr) return res.status(500).json({ error: cErr.message })

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
  if (rErr) return res.status(500).json({ error: rErr.message })

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
  if (cErr) return res.status(500).json({ error: cErr.message })

  return res.json((comps ?? []).map(c => ({ competition: c })))
}


// ── competition-registration ─────────────────────────────────────────────────
// Player-self registration into a competition. The BEFORE-INSERT triggers
// from Phase 1a populate payment_reference + amount_owing automatically.
//
// Returns the joined competition row alongside the registration so the hub
// can render its header without a second fetch.

const PAID_STATUSES = new Set(['paid', 'partial', 'overpaid'])

// Subset of competition columns the hub needs. Bank details + payment_info_visible
// included so the registered player can see them when the manager toggles
// visibility on.
const HUB_COMPETITION_COLUMNS =
  'id, slug, name, start_date, end_date, registration_open_at, registration_close_at, price_per_player, payment_info_visible, bank_account_name, bank_bsb, bank_account_number, archived_at'

async function handleCompetitionRegistration(req, res) {
  const { user, error: authErr } = await verifyUser(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  // GET — fetch caller's own registration for a competition.
  if (req.method === 'GET') {
    const competitionId = req.query.competition_id
    if (!competitionId) return badRequest(res, 'competition_id query param is required')

    const { data, error } = await supabaseAdmin
      .from('competition_registrations')
      .select(`*, competition:competitions(${HUB_COMPETITION_COLUMNS})`)
      .eq('competition_id', competitionId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (error) return res.status(500).json({ error: error.message })
    if (!data) return res.status(404).json({ error: 'not registered for this competition' })
    return res.json(data)
  }

  // POST — register the caller.
  if (req.method === 'POST') {
    const competitionId = req.body?.competition_id
    if (!competitionId) return badRequest(res, 'competition_id is required')

    const { data: comp, error: compErr } = await supabaseAdmin
      .from('competitions')
      .select('id, archived_at, registration_open_at, registration_close_at')
      .eq('id', competitionId)
      .maybeSingle()
    if (compErr) return res.status(500).json({ error: compErr.message })
    if (!comp) return res.status(404).json({ error: 'competition not found' })
    if (comp.archived_at) return res.status(400).json({ error: 'This competition has been archived.' })

    const now = new Date()
    if (comp.registration_close_at && new Date(comp.registration_close_at) < now) {
      return res.status(400).json({ error: 'Registration has closed for this competition.' })
    }
    if (comp.registration_open_at && new Date(comp.registration_open_at) > now) {
      return res.status(400).json({ error: 'Registration is not yet open for this competition.' })
    }

    const { data: existing, error: exErr } = await supabaseAdmin
      .from('competition_registrations')
      .select('id')
      .eq('competition_id', competitionId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (exErr) return res.status(500).json({ error: exErr.message })
    if (existing) return res.status(409).json({ error: 'You are already registered for this competition.' })

    const { data, error } = await supabaseAdmin
      .from('competition_registrations')
      .insert({ competition_id: competitionId, user_id: user.id })
      .select(`*, competition:competitions(${HUB_COMPETITION_COLUMNS})`)
      .single()
    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'You are already registered for this competition.' })
      }
      return res.status(500).json({ error: error.message })
    }
    return res.status(201).json(data)
  }

  // DELETE — cancel caller's registration.
  if (req.method === 'DELETE') {
    const competitionId = req.query.competition_id ?? req.body?.competition_id
    if (!competitionId) return badRequest(res, 'competition_id is required')

    const { data: reg, error: regErr } = await supabaseAdmin
      .from('competition_registrations')
      .select('id, payment_status, team_id')
      .eq('competition_id', competitionId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (regErr) return res.status(500).json({ error: regErr.message })
    if (!reg) return res.status(404).json({ error: 'You are not registered for this competition.' })

    if (PAID_STATUSES.has(reg.payment_status)) {
      return res.status(409).json({
        error: 'You have already made a payment for this event. Contact the event organiser to arrange a refund.',
      })
    }

    // Team-membership tidy-up. Three cases:
    //   - not on a team             → nothing to do
    //   - on a team, not captain    → delete only the caller's team_members row
    //   - on a team, captain        → if team has other members, refuse (captain
    //                                 must transfer or remove members first); if
    //                                 caller is the only member, cascade-delete
    //                                 the team itself.
    if (reg.team_id) {
      const { data: members, error: memErr } = await supabaseAdmin
        .from('team_members')
        .select('user_id, roles')
        .eq('team_id', reg.team_id)
      if (memErr) return res.status(500).json({ error: memErr.message })

      const callerRow = (members ?? []).find(m => m.user_id === user.id)
      const isCaptain = !!callerRow && Array.isArray(callerRow.roles) && callerRow.roles.includes('captain')
      const otherCount = (members ?? []).length - (callerRow ? 1 : 0)

      if (isCaptain && otherCount > 0) {
        return res.status(409).json({
          error: 'Transfer captaincy or remove all team members before cancelling registration.',
        })
      }

      if (isCaptain && otherCount === 0) {
        // Disband: clear any registrations pointing at this team, delete
        // members, then delete the team. competition_registrations.team_id is
        // ON DELETE SET NULL but we null it explicitly first for clarity.
        const { error: nullErr } = await supabaseAdmin
          .from('competition_registrations')
          .update({ team_id: null })
          .eq('team_id', reg.team_id)
        if (nullErr) return res.status(500).json({ error: `team unlink: ${nullErr.message}` })

        const { error: memDelErr } = await supabaseAdmin
          .from('team_members')
          .delete()
          .eq('team_id', reg.team_id)
        if (memDelErr) return res.status(500).json({ error: `team members delete: ${memDelErr.message}` })

        const { error: teamDelErr } = await supabaseAdmin
          .from('teams')
          .delete()
          .eq('id', reg.team_id)
        if (teamDelErr) return res.status(500).json({ error: `team delete: ${teamDelErr.message}` })
      } else if (callerRow) {
        // Plain member departure (Phase 3d invite flow path; included here
        // for completeness — Phase 3c can't actually reach this branch).
        const { error: leaveErr } = await supabaseAdmin
          .from('team_members')
          .delete()
          .eq('team_id', reg.team_id)
          .eq('user_id', user.id)
        if (leaveErr) return res.status(500).json({ error: `team leave: ${leaveErr.message}` })
      }
    }

    // Pending invites for this competition are abandoned alongside the
    // registration so the user can cleanly re-register later. PostgREST does
    // not accept a subquery in DELETE, so fetch the competition's team ids
    // first then DELETE WHERE team_id IN (...).
    const { data: compTeams, error: compTeamsErr } = await supabaseAdmin
      .from('teams')
      .select('id')
      .eq('competition_id', competitionId)
    if (compTeamsErr) return res.status(500).json({ error: `pending invite cleanup (teams lookup): ${compTeamsErr.message}` })
    const compTeamIds = (compTeams ?? []).map(t => t.id)
    if (compTeamIds.length > 0) {
      const { error: pendingErr } = await supabaseAdmin
        .from('team_members')
        .delete()
        .eq('user_id', user.id)
        .eq('invite_status', 'pending')
        .in('team_id', compTeamIds)
      if (pendingErr) return res.status(500).json({ error: `pending invite cleanup: ${pendingErr.message}` })
    }

    const { error: delErr } = await supabaseAdmin
      .from('competition_registrations')
      .delete()
      .eq('id', reg.id)
    if (delErr) return res.status(500).json({ error: delErr.message })

    return res.json({ deleted: true })
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
  if (profileErr) return res.status(500).json({ error: profileErr.message })
  const isSuperadmin = Array.isArray(profile?.roles) && profile.roles.includes('superadmin')

  if (!isSuperadmin) {
    const { count: mgrCount, error: mgrErr } = await supabaseAdmin
      .from('competition_managers')
      .select('user_id', { count: 'exact', head: true })
      .eq('competition_id', competitionId)
      .eq('user_id', user.id)
    if (mgrErr) return res.status(500).json({ error: mgrErr.message })
    if ((mgrCount ?? 0) === 0) {
      return res.status(403).json({ error: 'Not authorised to view this competition.' })
    }
  }

  const { data: regs, error: regErr } = await supabaseAdmin
    .from('competition_registrations')
    .select(`
      id, user_id, competition_id, payment_status, amount_paid, amount_owing,
      payment_reference, registered_at, team_id,
      profile:profiles!user_id(alias, first_name, last_name)
    `)
    .eq('competition_id', competitionId)
  if (regErr) return res.status(500).json({ error: regErr.message })

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
    if (tErr) return res.status(500).json({ error: tErr.message })
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
    if (mErr) return res.status(500).json({ error: mErr.message })
    for (const m of members ?? []) {
      roleMap.set(`${m.team_id}::${m.user_id}`, m.roles ?? [])
    }
  }

  // Emails via auth.admin.getUserById in parallel. Placeholder profiles
  // (no auth.users row) surface as null. Fan-out is bounded by the
  // registration count, which is small for typical pre-nats.
  const emailMap = new Map()
  await Promise.all(userIds.map(async uid => {
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(uid)
      if (data?.user?.email) emailMap.set(uid, data.user.email)
    } catch {
      // No auth row — leave email null.
    }
  }))

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
        email: emailMap.get(r.user_id) ?? null,
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
// UNIT NOTE: payment_records.amount is integer cents. Pre-nats parents
// store dollars. Each POST/PATCH converts amount_dollars (signed) to cents
// on the way in; computeCompetitionAmountPaid converts the ledger sum back
// to dollars when it writes the parent.

const PAYMENT_RECORD_COLUMNS =
  'id, competition_registration_id, amount, recorded_at, recorded_by, bank_reference, notes, recorder:profiles!recorded_by(alias, first_name, last_name)'

// Returns { records, summary } shaped for the modal's onChange. Records are
// flattened so the recorder profile is at top level (matches the ZLTAC
// response style without forcing the consumer to know the join column name).
async function buildCompetitionPaymentResponse(competitionRegistrationId) {
  const recompute = await computeCompetitionAmountPaid(competitionRegistrationId)
  if (recompute.error) return { error: recompute.error }

  const { data: records, error } = await supabaseAdmin
    .from('payment_records')
    .select(PAYMENT_RECORD_COLUMNS)
    .eq('competition_registration_id', competitionRegistrationId)
    .order('recorded_at', { ascending: false })
  if (error) return { error: error.message }

  const flatRecords = (records ?? []).map(r => ({
    id: r.id,
    competition_registration_id: r.competition_registration_id,
    amount: r.amount,
    amount_dollars: (r.amount ?? 0) / 100,
    recorded_at: r.recorded_at,
    recorded_by: r.recorded_by,
    recorded_by_profile: r.recorder
      ? { alias: r.recorder.alias, first_name: r.recorder.first_name, last_name: r.recorder.last_name }
      : null,
    bank_reference: r.bank_reference,
    notes: r.notes,
  }))

  return {
    records: flatRecords,
    summary: {
      // registrationId field name preserves parity with the ZLTAC modal
      // consumer (RecordPaymentModal -> onChange(records, summary)).
      registrationId: competitionRegistrationId,
      competition_registration_id: competitionRegistrationId,
      amount_paid: recompute.amount_paid,
      payment_status: recompute.payment_status,
    },
  }
}

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
  if (regErr) { res.status(500).json({ error: regErr.message }); return null }
  if (!reg) { res.status(404).json({ error: 'Competition registration not found' }); return null }

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('roles')
    .eq('id', user.id)
    .maybeSingle()
  if (profileErr) { res.status(500).json({ error: profileErr.message }); return null }
  const isSuperadmin = Array.isArray(profile?.roles) && profile.roles.includes('superadmin')

  if (!isSuperadmin) {
    const { count: mgrCount, error: mgrErr } = await supabaseAdmin
      .from('competition_managers')
      .select('user_id', { count: 'exact', head: true })
      .eq('competition_id', reg.competition_id)
      .eq('user_id', user.id)
    if (mgrErr) { res.status(500).json({ error: mgrErr.message }); return null }
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
    if (!competitionRegistrationId) {
      return badRequest(res, 'competition_registration_id is required')
    }

    const amountDollars = body.amount_dollars
    if (typeof amountDollars !== 'number' || !Number.isFinite(amountDollars)) {
      return badRequest(res, 'amount_dollars must be a finite number')
    }
    const amountCents = Math.round(amountDollars * 100)
    if (amountCents === 0) {
      return badRequest(res, 'amount_dollars must be non-zero')
    }

    const gate = await gateCompetitionPaymentRecord(req, res, competitionRegistrationId)
    if (!gate) return

    const { error: insErr } = await supabaseAdmin
      .from('payment_records')
      .insert({
        competition_registration_id: competitionRegistrationId,
        amount: amountCents,
        recorded_at: body.recorded_at || new Date().toISOString(),
        recorded_by: gate.user.id,
        bank_reference: body.bank_reference?.trim() || null,
        notes: body.notes?.trim() || null,
      })
    if (insErr) return res.status(500).json({ error: insErr.message })

    const result = await buildCompetitionPaymentResponse(competitionRegistrationId)
    if (result.error) return res.status(500).json({ error: result.error })
    return res.status(201).json(result)
  }

  if (req.method === 'GET') {
    const competitionRegistrationId = req.query.competition_registration_id
    if (!competitionRegistrationId) {
      return badRequest(res, 'competition_registration_id query param is required')
    }

    const gate = await gateCompetitionPaymentRecord(req, res, competitionRegistrationId)
    if (!gate) return

    const { data: records, error } = await supabaseAdmin
      .from('payment_records')
      .select(PAYMENT_RECORD_COLUMNS)
      .eq('competition_registration_id', competitionRegistrationId)
      .order('recorded_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })

    const out = (records ?? []).map(r => ({
      id: r.id,
      competition_registration_id: r.competition_registration_id,
      amount: r.amount,
      amount_dollars: (r.amount ?? 0) / 100,
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
    if (!id) return badRequest(res, 'id is required')

    const body = req.body ?? {}

    // Look up the parent so we can auth-gate AND know which registration to
    // recompute after the update.
    const { data: existing, error: exErr } = await supabaseAdmin
      .from('payment_records')
      .select('id, competition_registration_id')
      .eq('id', id)
      .maybeSingle()
    if (exErr) return res.status(500).json({ error: exErr.message })
    if (!existing || !existing.competition_registration_id) {
      return res.status(404).json({ error: 'Competition payment record not found' })
    }

    const gate = await gateCompetitionPaymentRecord(req, res, existing.competition_registration_id)
    if (!gate) return

    const updates = {}
    if (Object.prototype.hasOwnProperty.call(body, 'amount_dollars')) {
      if (typeof body.amount_dollars !== 'number' || !Number.isFinite(body.amount_dollars)) {
        return badRequest(res, 'amount_dollars must be a finite number')
      }
      const amountCents = Math.round(body.amount_dollars * 100)
      if (amountCents === 0) return badRequest(res, 'amount_dollars must be non-zero')
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

    const { error: updErr } = await supabaseAdmin
      .from('payment_records')
      .update(updates)
      .eq('id', id)
    if (updErr) return res.status(500).json({ error: updErr.message })

    const result = await buildCompetitionPaymentResponse(existing.competition_registration_id)
    if (result.error) return res.status(500).json({ error: result.error })
    return res.json(result)
  }

  if (req.method === 'DELETE') {
    const id = req.query.id ?? req.body?.id
    if (!id) return badRequest(res, 'id is required')

    const { data: existing, error: exErr } = await supabaseAdmin
      .from('payment_records')
      .select('id, competition_registration_id')
      .eq('id', id)
      .maybeSingle()
    if (exErr) return res.status(500).json({ error: exErr.message })
    if (!existing || !existing.competition_registration_id) {
      return res.status(404).json({ error: 'Competition payment record not found' })
    }

    const gate = await gateCompetitionPaymentRecord(req, res, existing.competition_registration_id)
    if (!gate) return

    const { error: delErr } = await supabaseAdmin
      .from('payment_records')
      .delete()
      .eq('id', id)
    if (delErr) return res.status(500).json({ error: delErr.message })

    const result = await buildCompetitionPaymentResponse(existing.competition_registration_id)
    if (result.error) return res.status(500).json({ error: result.error })
    return res.json(result)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}


// ── competition-team ─────────────────────────────────────────────────────────
// Player-self team management: create, view, edit, disband. Phase 3d will
// add the invite flow on top of this.

const TEAM_NAME_MAX = 50
const TEAM_MEMBER_COLUMNS = 'id, user_id, roles, invite_status, invited_at, responded_at, invited_by, profile:profiles!user_id(id, alias, first_name, last_name)'

async function loadTeamWithMembers(teamId) {
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
  if (tErr) return { error: tErr.message }
  if (mErr) return { error: mErr.message }
  if (!team) return { error: 'team not found', notFound: true }
  return { team: { ...team, members: members ?? [] } }
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
    if (memErr) return res.status(500).json({ error: memErr.message })
    if (!membership) return res.status(404).json({ error: 'not on a team for this competition' })

    const result = await loadTeamWithMembers(membership.team_id)
    if (result.error) {
      return res.status(result.notFound ? 404 : 500).json({ error: result.error })
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

    // Caller must be registered for this competition.
    const { data: reg, error: regErr } = await supabaseAdmin
      .from('competition_registrations')
      .select('id, team_id')
      .eq('competition_id', competitionId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (regErr) return res.status(500).json({ error: regErr.message })
    if (!reg) return res.status(400).json({ error: 'You must register for the competition before creating a team.' })
    if (reg.team_id) return res.status(409).json({ error: 'You are already on a team for this competition.' })

    // Three-step write (service role bypasses RLS so no rollback needed at the
    // policy layer; we do best-effort cleanup on partial failure). teams.event_id
    // stays NULL to satisfy the xor check from Phase 1a. status='approved' —
    // pre-nats has no committee approval gate.
    const { data: team, error: teamErr } = await supabaseAdmin
      .from('teams')
      .insert({
        competition_id: competitionId,
        name,
        colour,
        captain_id: user.id,
        manager_id: user.id,
        status: 'approved',
        format: 'team',
      })
      .select('id, competition_id, name, colour, captain_id, manager_id, status, created_at')
      .single()
    if (teamErr) return res.status(500).json({ error: `team insert: ${teamErr.message}` })

    const { error: memErr } = await supabaseAdmin
      .from('team_members')
      .insert({
        team_id: team.id,
        user_id: user.id,
        roles: ['captain'],
        invite_status: 'accepted',
        responded_at: new Date().toISOString(),
      })
    if (memErr) {
      await supabaseAdmin.from('teams').delete().eq('id', team.id)
      return res.status(500).json({ error: `team_members insert: ${memErr.message}` })
    }

    const { error: regUpdErr } = await supabaseAdmin
      .from('competition_registrations')
      .update({ team_id: team.id })
      .eq('id', reg.id)
    if (regUpdErr) {
      await supabaseAdmin.from('team_members').delete().eq('team_id', team.id)
      await supabaseAdmin.from('teams').delete().eq('id', team.id)
      return res.status(500).json({ error: `registration update: ${regUpdErr.message}` })
    }

    const result = await loadTeamWithMembers(team.id)
    if (result.error) return res.status(500).json({ error: result.error })
    return res.status(201).json(result.team)
  }

  // PATCH — caller must be captain.
  if (req.method === 'PATCH') {
    const teamId = req.query.team_id ?? req.body?.team_id
    if (!teamId) return badRequest(res, 'team_id is required')

    const { data: callerRow, error: cErr } = await supabaseAdmin
      .from('team_members')
      .select('roles')
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (cErr) return res.status(500).json({ error: cErr.message })
    if (!callerRow || !Array.isArray(callerRow.roles) || !callerRow.roles.includes('captain')) {
      return res.status(403).json({ error: 'Only the team captain can edit team details.' })
    }

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

    const { error: updErr } = await supabaseAdmin
      .from('teams')
      .update(updates)
      .eq('id', teamId)
    if (updErr) return res.status(500).json({ error: updErr.message })

    const result = await loadTeamWithMembers(teamId)
    if (result.error) return res.status(500).json({ error: result.error })
    return res.json(result.team)
  }

  // DELETE — disband. Only the captain, only when no other members remain.
  if (req.method === 'DELETE') {
    const teamId = req.query.team_id ?? req.body?.team_id
    if (!teamId) return badRequest(res, 'team_id is required')

    const { data: members, error: memErr } = await supabaseAdmin
      .from('team_members')
      .select('user_id, roles, invite_status')
      .eq('team_id', teamId)
    if (memErr) return res.status(500).json({ error: memErr.message })

    const callerRow = (members ?? []).find(m => m.user_id === user.id && m.invite_status === 'accepted')
    const isCaptain = !!callerRow && Array.isArray(callerRow.roles) && callerRow.roles.includes('captain')
    if (!isCaptain) {
      return res.status(403).json({ error: 'Only the team captain can disband the team.' })
    }
    // Count only accepted members. Pending invitees do not block disbandment
    // (the team_members ON DELETE CASCADE on the teams delete cleans them up).
    const acceptedOthers = (members ?? []).filter(
      m => m.invite_status === 'accepted' && m.user_id !== user.id
    )
    if (acceptedOthers.length > 0) {
      return res.status(409).json({ error: 'Remove all team members before disbanding.' })
    }

    const { error: nullErr } = await supabaseAdmin
      .from('competition_registrations')
      .update({ team_id: null })
      .eq('team_id', teamId)
    if (nullErr) return res.status(500).json({ error: `team unlink: ${nullErr.message}` })

    const { error: memDelErr } = await supabaseAdmin
      .from('team_members')
      .delete()
      .eq('team_id', teamId)
    if (memDelErr) return res.status(500).json({ error: `team members delete: ${memDelErr.message}` })

    const { error: teamDelErr } = await supabaseAdmin
      .from('teams')
      .delete()
      .eq('id', teamId)
    if (teamDelErr) return res.status(500).json({ error: `team delete: ${teamDelErr.message}` })

    return res.json({ deleted: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}


// ── competition-team-member ──────────────────────────────────────────────────
// Phase 3d: captain-driven invite / revoke / remove + member self-leave. Plan
// term -> column mapping is recorded in the Phase 3d migration header
// (20260527020000_team_members_invite_flow.sql). Summary:
//   POST   { team_id, invitee_user_id }  -> captain invites a player (pending row)
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
    const inviteeId = body.invitee_user_id
    if (!teamId) return badRequest(res, 'team_id is required')
    if (!inviteeId) return badRequest(res, 'invitee_user_id is required')

    // Caller must be an accepted captain of the team.
    const { data: callerRow, error: cErr } = await supabaseAdmin
      .from('team_members')
      .select('roles, invite_status')
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (cErr) return res.status(500).json({ error: cErr.message })
    if (
      !callerRow ||
      callerRow.invite_status !== 'accepted' ||
      !Array.isArray(callerRow.roles) ||
      !callerRow.roles.includes('captain')
    ) {
      return res.status(403).json({ error: 'Only the team captain can invite players.' })
    }

    // Team must exist and its competition must still be open for registration.
    const { data: team, error: tErr } = await supabaseAdmin
      .from('teams')
      .select('id, competition_id, competition:competitions!inner(id, archived_at, registration_close_at)')
      .eq('id', teamId)
      .maybeSingle()
    if (tErr) return res.status(500).json({ error: tErr.message })
    if (!team) return res.status(404).json({ error: 'team not found' })
    const comp = team.competition
    if (comp.archived_at) return res.status(400).json({ error: 'This competition has been archived.' })
    if (comp.registration_close_at && new Date(comp.registration_close_at) < new Date()) {
      return res.status(400).json({ error: 'Registration has closed for this competition.' })
    }

    // Invitee must be registered for the competition.
    const { data: reg, error: regErr } = await supabaseAdmin
      .from('competition_registrations')
      .select('id')
      .eq('competition_id', team.competition_id)
      .eq('user_id', inviteeId)
      .maybeSingle()
    if (regErr) return res.status(500).json({ error: regErr.message })
    if (!reg) {
      return res.status(400).json({ error: 'Player must register for this competition before they can be invited.' })
    }

    // Invitee must not already be on another team in this competition
    // (accepted OR pending). One team per player per competition.
    const { data: existing, error: exErr } = await supabaseAdmin
      .from('team_members')
      .select('id, teams!inner(competition_id)')
      .eq('user_id', inviteeId)
      .in('invite_status', ['accepted', 'pending'])
      .eq('teams.competition_id', team.competition_id)
    if (exErr) return res.status(500).json({ error: exErr.message })
    if ((existing ?? []).length > 0) {
      return res.status(409).json({ error: 'Player is already on a team in this competition.' })
    }

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('team_members')
      .insert({
        team_id: teamId,
        user_id: inviteeId,
        roles: ['player'],
        invite_status: 'pending',
        invited_at: new Date().toISOString(),
        invited_by: user.id,
      })
      .select(TEAM_MEMBER_COLUMNS)
      .single()
    if (insErr) return res.status(500).json({ error: `team_members insert: ${insErr.message}` })

    return res.status(201).json(inserted)
  }

  if (req.method === 'GET') {
    const teamId = req.query.team_id
    if (!teamId) return badRequest(res, 'team_id query param is required')

    // Caller must be on the team with any invite_status.
    const { data: callerRow, error: cErr } = await supabaseAdmin
      .from('team_members')
      .select('invite_status')
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (cErr) return res.status(500).json({ error: cErr.message })
    if (!callerRow) return res.status(403).json({ error: 'Not on this team.' })

    const { data: members, error: mErr } = await supabaseAdmin
      .from('team_members')
      .select(TEAM_MEMBER_COLUMNS)
      .eq('team_id', teamId)
    if (mErr) return res.status(500).json({ error: mErr.message })

    // Sort in JS: captain first, then accepted alphabetically by alias, then
    // pending by invited_at desc.
    const sorted = (members ?? []).slice().sort((a, b) => {
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

    const { data: target, error: tErr } = await supabaseAdmin
      .from('team_members')
      .select('id, team_id, user_id, roles, invite_status')
      .eq('id', rowId)
      .maybeSingle()
    if (tErr) return res.status(500).json({ error: tErr.message })
    if (!target) return res.status(404).json({ error: 'membership not found' })

    const { data: members, error: mErr } = await supabaseAdmin
      .from('team_members')
      .select('id, user_id, roles, invite_status')
      .eq('team_id', target.team_id)
    if (mErr) return res.status(500).json({ error: mErr.message })

    const callerRow = (members ?? []).find(
      m => m.user_id === user.id && m.invite_status === 'accepted'
    )
    const callerIsCaptain = !!callerRow && Array.isArray(callerRow.roles) && callerRow.roles.includes('captain')
    const callerIsSelf = target.user_id === user.id

    // Captain self-remove is rejected — they must disband instead.
    if (callerIsCaptain && callerIsSelf) {
      return res.status(400).json({ error: 'Captains cannot remove themselves. Disband the team instead.' })
    }
    // Non-captain caller may only remove their own accepted row. Pending
    // invitees decline via competition-team-invite PATCH.
    if (!callerIsCaptain) {
      if (!callerIsSelf || target.invite_status !== 'accepted') {
        return res.status(403).json({ error: 'You do not have permission to remove this membership.' })
      }
    }

    // Orphan guard: if the target is the only accepted captain and other
    // accepted members remain, refuse.
    if (target.invite_status === 'accepted' && (target.roles ?? []).includes('captain')) {
      const otherCaptains = (members ?? []).filter(
        m => m.id !== target.id && m.invite_status === 'accepted' && (m.roles ?? []).includes('captain')
      )
      const otherAccepted = (members ?? []).filter(
        m => m.id !== target.id && m.invite_status === 'accepted'
      )
      if (otherCaptains.length === 0 && otherAccepted.length > 0) {
        return res.status(409).json({ error: 'You are the only captain. Transfer captaincy or remove other members first.' })
      }
    }

    const { error: delErr } = await supabaseAdmin
      .from('team_members')
      .delete()
      .eq('id', rowId)
    if (delErr) return res.status(500).json({ error: `membership delete: ${delErr.message}` })

    const remainingAccepted = (members ?? []).filter(
      m => m.id !== target.id && m.invite_status === 'accepted'
    )

    if (remainingAccepted.length === 0) {
      // Disband cascade: clear all linked registrations + delete the team.
      // teams.team_id FK is ON DELETE CASCADE on team_members, so pending
      // rows that remain on the team are wiped automatically.
      const { error: nullErr } = await supabaseAdmin
        .from('competition_registrations')
        .update({ team_id: null })
        .eq('team_id', target.team_id)
      if (nullErr) return res.status(500).json({ error: `team unlink: ${nullErr.message}` })

      const { error: teamDelErr } = await supabaseAdmin
        .from('teams')
        .delete()
        .eq('id', target.team_id)
      if (teamDelErr) return res.status(500).json({ error: `team delete: ${teamDelErr.message}` })
    } else if (target.invite_status === 'accepted') {
      // Departing accepted member (not last): unlink their registration from
      // this team so the registration is free to join elsewhere.
      const { error: regUpdErr } = await supabaseAdmin
        .from('competition_registrations')
        .update({ team_id: null })
        .eq('team_id', target.team_id)
        .eq('user_id', target.user_id)
      if (regUpdErr) return res.status(500).json({ error: `registration unlink: ${regUpdErr.message}` })
    }

    return res.json({ deleted: true })
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
    if (error) return res.status(500).json({ error: error.message })
    return res.json(data ?? [])
  }

  if (req.method === 'PATCH') {
    const rowId = req.query.id
    const action = req.body?.action
    if (!rowId) return badRequest(res, 'id query param is required')
    if (action !== 'accept' && action !== 'decline') {
      return badRequest(res, 'action must be "accept" or "decline"')
    }

    const { data: target, error: tErr } = await supabaseAdmin
      .from('team_members')
      .select('id, team_id, user_id, invite_status, team:teams!inner(id, competition_id)')
      .eq('id', rowId)
      .maybeSingle()
    if (tErr) return res.status(500).json({ error: tErr.message })
    if (!target) return res.status(404).json({ error: 'invite not found' })
    if (target.user_id !== user.id) return res.status(403).json({ error: 'This invite is not addressed to you.' })
    if (target.invite_status !== 'pending') {
      return res.status(409).json({ error: 'This invite has already been resolved.' })
    }

    const competitionId = target.team.competition_id
    const nowIso = new Date().toISOString()

    if (action === 'decline') {
      const { data: updated, error: uErr } = await supabaseAdmin
        .from('team_members')
        .update({ invite_status: 'declined', responded_at: nowIso })
        .eq('id', rowId)
        .select(TEAM_MEMBER_COLUMNS)
        .single()
      if (uErr) return res.status(500).json({ error: uErr.message })
      return res.json(updated)
    }

    // action === 'accept'. Guard against the caller already being on a team
    // in this competition (race: another invite was just accepted, or a team
    // was created in parallel).
    const { data: existing, error: exErr } = await supabaseAdmin
      .from('team_members')
      .select('id, teams!inner(competition_id)')
      .eq('user_id', user.id)
      .eq('invite_status', 'accepted')
      .eq('teams.competition_id', competitionId)
    if (exErr) return res.status(500).json({ error: exErr.message })
    if ((existing ?? []).length > 0) {
      return res.status(409).json({ error: 'You are already on a team in this competition.' })
    }

    // 1. Flip the row to accepted.
    const { error: acceptErr } = await supabaseAdmin
      .from('team_members')
      .update({ invite_status: 'accepted', responded_at: nowIso })
      .eq('id', rowId)
    if (acceptErr) return res.status(500).json({ error: `invite accept: ${acceptErr.message}` })

    // 2. Link the caller's competition_registrations row to the team.
    const { error: regErr } = await supabaseAdmin
      .from('competition_registrations')
      .update({ team_id: target.team_id })
      .eq('user_id', user.id)
      .eq('competition_id', competitionId)
    if (regErr) return res.status(500).json({ error: `registration link: ${regErr.message}` })

    // 3. Auto-decline sibling pending invites in the same competition.
    // PostgREST does not support UPDATE ... FROM, so fetch ids then UPDATE.
    const { data: siblings, error: sibErr } = await supabaseAdmin
      .from('team_members')
      .select('id, teams!inner(competition_id)')
      .eq('user_id', user.id)
      .eq('invite_status', 'pending')
      .eq('teams.competition_id', competitionId)
      .neq('id', rowId)
    if (sibErr) return res.status(500).json({ error: `sibling lookup: ${sibErr.message}` })
    const siblingIds = (siblings ?? []).map(s => s.id)
    if (siblingIds.length > 0) {
      const { error: sibUpdErr } = await supabaseAdmin
        .from('team_members')
        .update({ invite_status: 'declined', responded_at: nowIso })
        .in('id', siblingIds)
      if (sibUpdErr) return res.status(500).json({ error: `sibling auto-decline: ${sibUpdErr.message}` })
    }

    const { data: updated, error: fetchErr } = await supabaseAdmin
      .from('team_members')
      .select(TEAM_MEMBER_COLUMNS)
      .eq('id', rowId)
      .single()
    if (fetchErr) return res.status(500).json({ error: fetchErr.message })
    return res.json(updated)
  }

  return res.status(405).json({ error: 'Method not allowed' })
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
  if (resource === 'competitions')               return handleCompetitions(req, res)

  // competition-managers is the one remaining purely-superadmin resource.
  const { user, error: authErr } = await verifySuperAdmin(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  if (resource === 'competition-managers') return handleCompetitionManagers(req, res, user)
  return res.status(404).json({ error: 'unknown resource' })
}
