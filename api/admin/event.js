import { randomUUID, timingSafeEqual } from 'crypto'
import { Resend } from 'resend'
import supabaseAdmin from '../_lib/supabase.js'
import { verifyCommittee, verifySuperAdmin, statusForAuthError } from '../_lib/auth.js'
import { computeAndWriteAmountOwing } from '../_lib/computeAmountOwing.js'
import { cleanupFormerSideEventMember, ensureSideEventMember } from '../_lib/sideEventCleanup.js'
import { changeProfileAlias } from '../_lib/profileChanges.js'
import { buildBackupFiles } from '../_lib/backupStorage.js'
import { enforceRateLimit } from '../_lib/rateLimit.js'
import { generateBackupCsvs } from '../../src/lib/backup/generateBackupCsvs.js'
import { dollars } from '../../src/lib/pricing.js'
import { isRefTestRequired, isCocRequired, isPaymentRequired } from '../../src/lib/eventSettings.js'

// Committee-gated event operations. Dispatches by ?resource=:
//   ?resource=event            → archive / delete the event (POST + body.action)
//   ?resource=registrations    → registrations admin (GET&year / PATCH / DELETE)
//   ?resource=payments         → payment records (POST / PATCH / DELETE)
//   ?resource=backup-settings  → GET / PATCH the single backup_settings row
//   ?resource=backup-run       → POST runs a backup. Dual auth: cron secret
//                                bearer OR committee session. Cron path
//                                honours frequency/weekly_day; committee
//                                path always sends (manual ad-hoc).
//
// Consolidated from api/admin/event.js + registrations.js + payments.js to stay
// under the Vercel Hobby function cap. All three share verifyCommittee +
// service-role (ADR-0002). Note the registrations DELETE uses a body field
// `kind` ('doubles'/'triples') — distinct from the top-level ?resource query.

// Vercel's recommended cron-protection pattern: set CRON_SECRET in the env,
// Vercel auto-injects `Authorization: Bearer ${CRON_SECRET}` on cron-fire.
// Returns true only for the cron path; the admin session takes a different
// branch in the dispatcher.
function isCronRequest(req) {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const header = req.headers.authorization
  if (typeof header !== 'string' || header.length === 0) return false
  // Constant-time comparison so a forged header can't be tuned byte-by-byte
  // from response timing. timingSafeEqual throws on unequal buffer lengths,
  // so bail on a length mismatch first (the length is not itself secret).
  const provided = Buffer.from(header)
  const wanted = Buffer.from(`Bearer ${expected}`)
  if (provided.length !== wanted.length) return false
  return timingSafeEqual(provided, wanted)
}

// "Day of week" + "today's date" both resolved in Australia/Sydney — the
// project pattern (see src/lib/eventTimezone.js) uses Intl.DateTimeFormat
// with timeZone:, mirrored here so we don't introduce a second TZ approach.
// Returns 0=Sun .. 6=Sat plus YYYY-MM-DD in Sydney local time.
function sydneyDateInfo(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(date)
  const m = {}
  for (const p of parts) if (p.type !== 'literal') m[p.type] = p.value
  const dateStr = `${m.year}-${m.month}-${m.day}`
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { dateStr, dayOfWeek: weekdayMap[m.weekday] ?? 0 }
}

// ── event ─────────────────────────────────────────────────────────────────────
async function handleEvent(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { action, eventId, year } = req.body ?? {}
  if (!action || !eventId || !year) {
    return res.status(400).json({ error: 'action, eventId, and year are required' })
  }

  if (action === 'archive') {
    const { data: ev, error: evErr } = await supabaseAdmin
      .from('zltac_events')
      .select('id, year, name, start_date, end_date, description, logo_url, location, venue, status')
      .eq('id', eventId)
      .maybeSingle()
    if (evErr) return res.status(500).json({ error: evErr.message })
    if (!ev) return res.status(404).json({ error: 'Event not found' })

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from('zltac_event_history')
      .select('id')
      .eq('year', ev.year)
      .maybeSingle()
    if (existingErr) return res.status(500).json({ error: existingErr.message })

    let historySkipped = false
    let historyId = null

    if (existing) {
      historySkipped = true
      historyId = existing.id
    } else {
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from('zltac_event_history')
        .insert({
          year: ev.year,
          name: ev.name,
          start_date: ev.start_date,
          end_date: ev.end_date,
          description: ev.description,
          logo_url: ev.logo_url,
          location_city: ev.location,
          location_state: null,
          location_venue: ev.venue,
        })
        .select('id')
        .single()
      if (insErr) return res.status(500).json({ error: insErr.message })
      historyId = inserted.id
    }

    const { error: updErr } = await supabaseAdmin
      .from('zltac_events')
      .update({ status: 'archived' })
      .eq('id', eventId)
    if (updErr) return res.status(500).json({ error: updErr.message })

    return res.json({ ok: true, historySkipped, historyId })
  }

  if (action === 'delete') {
    // Destructive cascade — superadmin only. The dispatcher already
    // verifyCommittee'd the request; deletes raise the bar to superadmin.
    const { error: err } = await verifySuperAdmin(req)
    if (err) return res.status(statusForAuthError(err)).json({ error: err })

    const yearScopedTables = [
      'legal_acceptances',
      'under_18_approvals',
      'payments',
      'doubles_pairs',
      'triples_teams',
    ]
    for (const table of yearScopedTables) {
      const { error: delErr } = await supabaseAdmin.from(table).delete().eq('event_year', year)
      if (delErr) return res.status(500).json({ error: `${table}: ${delErr.message}` })
    }

    const { error: regDelErr } = await supabaseAdmin
      .from('zltac_registrations')
      .delete()
      .eq('year', year)
    if (regDelErr) return res.status(500).json({ error: regDelErr.message })

    const { error: evDelErr } = await supabaseAdmin
      .from('zltac_events')
      .delete()
      .eq('id', eventId)
    if (evDelErr) return res.status(500).json({ error: evDelErr.message })

    return res.json({ ok: true })
  }

  return res.status(400).json({ error: `Unknown action: ${action}` })
}

// ── registrations ─────────────────────────────────────────────────────────────
async function handleRegistrations(req, res, user) {
  if (req.method === 'GET') {
    const year = parseInt(req.query.year)
    if (!year) return res.status(400).json({ error: 'year is required' })

    // Resolve the ZLTAC event id for this year so the teams query can be
    // scoped to it. teams.event_id is NULL for competition (pre-nats) teams,
    // so filtering on a concrete event id drops both competition teams and
    // teams from other years. If no event exists for the year, there are no
    // ZLTAC teams to show — return an empty teams set rather than an
    // unfiltered (.eq event_id NULL would otherwise match competition teams).
    const { data: ev, error: evLookupErr } = await supabaseAdmin
      .from('zltac_events')
      .select('id')
      .eq('year', year)
      .maybeSingle()
    if (evLookupErr) return res.status(500).json({ error: evLookupErr.message })
    const eventId = ev?.id ?? null
    const teamsQuery = eventId
      ? supabaseAdmin.from('teams').select('id, name, entry_type, state, status, captain_id, created_at, event_id').eq('event_id', eventId)
      : Promise.resolve({ data: [], error: null })

    const [
      { data: registrations, error: e1 },
      { data: profiles, error: e2 },
      { data: teams, error: e3 },
      { data: acceptances, error: e4 },
      { data: ref_results, error: e5 },
      { data: payment_records_raw, error: e7 },
      { data: doubles, error: e8 },
      { data: triples, error: e9 },
      { data: u18_approvals, error: e10 },
    ] = await Promise.all([
      supabaseAdmin.from('zltac_registrations').select('id, user_id, team_id, year, status, created_at, side_events, dinner_guests, amount_owing, payment_reference, emergency_contact_name, emergency_contact_phone, has_confirmed_side_events, has_confirmed_extras, admin_note, admin_override_coc, admin_override_coc_set_by, admin_override_coc_set_at, admin_override_coc_reason, admin_override_media, admin_override_media_set_by, admin_override_media_set_at, admin_override_media_reason, admin_override_ref_test, admin_override_ref_test_set_by, admin_override_ref_test_set_at, admin_override_ref_test_reason, admin_override_u18, admin_override_u18_set_by, admin_override_u18_set_at, admin_override_u18_reason').eq('year', year).order('created_at', { ascending: false }),
      supabaseAdmin.from('profiles').select('id, first_name, last_name, alias, state, is_placeholder'),
      teamsQuery,
      supabaseAdmin
        .from('legal_acceptances')
        .select('user_id, accepted_at, document:legal_documents!document_id(document_type)')
        .eq('event_year', year),
      supabaseAdmin.from('referee_test_results').select('user_id, passed, score, safety_correct, safety_total, general_correct, general_total'),
      supabaseAdmin.from('payment_records')
        .select('id, registration_id, amount, recorded_at, recorded_by, bank_reference, notes, zltac_registrations!inner(year)')
        .eq('zltac_registrations.year', year),
      supabaseAdmin.from('doubles_pairs').select('*').eq('event_year', year).order('created_at', { ascending: false }),
      supabaseAdmin.from('triples_teams').select('*').eq('event_year', year).order('created_at', { ascending: false }),
      supabaseAdmin.from('under_18_approvals').select('user_id, status').eq('event_year', year).eq('status', 'approved'),
    ])

    const errs = [e1, e2, e3, e4, e5, e7, e8, e9, e10].filter(Boolean)
    if (errs.length) return res.status(500).json({ error: errs.map(e => e.message).join(' | ') })

    const coc_sigs = (acceptances ?? [])
      .filter(a => a.document?.document_type === 'code_of_conduct')
      .map(a => ({ user_id: a.user_id, signed_at: a.accepted_at }))
    const media_releases = (acceptances ?? [])
      .filter(a => a.document?.document_type === 'media_release')
      .map(a => ({ user_id: a.user_id, submitted_at: a.accepted_at }))

    const payment_records = (payment_records_raw ?? []).map(r => ({
      id: r.id,
      registration_id: r.registration_id,
      amount: r.amount,
      recorded_at: r.recorded_at,
      recorded_by: r.recorded_by,
      bank_reference: r.bank_reference,
      notes: r.notes,
    }))

    return res.json({ registrations, profiles, teams, coc_sigs, ref_results, media_releases, payment_records, doubles, triples, u18_approvals })
  }

  if (req.method === 'PATCH') {
    // Committee-driven edit of a single registration. Bypasses the phase guard.
    const body = req.body ?? {}
    const { registrationId } = body
    if (!registrationId) return res.status(400).json({ error: 'registrationId is required' })

    const { data: reg, error: regErr } = await supabaseAdmin
      .from('zltac_registrations')
      .select('id, user_id, year, side_events, team_id, admin_note, admin_override_coc, admin_override_media, admin_override_ref_test, admin_override_u18')
      .eq('id', registrationId)
      .maybeSingle()
    if (regErr) return res.status(500).json({ error: regErr.message })
    if (!reg) return res.status(404).json({ error: 'Registration not found' })

    if ('status' in body && !['pending', 'confirmed', 'cancelled'].includes(body.status)) {
      return res.status(400).json({ error: 'Invalid status' })
    }

    const updates = {}
    if (Array.isArray(body.side_events)) updates.side_events = body.side_events
    if ('team_id' in body) updates.team_id = body.team_id || null
    if ('admin_note' in body) updates.admin_note = body.admin_note?.trim() || null
    if ('dinner_guests' in body) updates.dinner_guests = Math.max(0, parseInt(body.dinner_guests) || 0)
    if ('status' in body) updates.status = body.status
    if ('has_confirmed_side_events' in body) updates.has_confirmed_side_events = !!body.has_confirmed_side_events
    if ('has_confirmed_extras' in body) updates.has_confirmed_extras = !!body.has_confirmed_extras
    if ('emergency_contact_name' in body) updates.emergency_contact_name = body.emergency_contact_name?.trim() || null
    if ('emergency_contact_phone' in body) updates.emergency_contact_phone = body.emergency_contact_phone?.trim() || null
    // Override transition logic. Each override is tri-state: null = follow the
    // player's real completion, true = force complete, false = force incomplete.
    // Do NOT coerce with !! — a deliberate false must survive. Branches:
    //   null    -> non-null: validate _reason (>= 5 chars), stamp _set_by/_set_at
    //   non-null-> non-null: update value + _reason, preserve _set_by/_set_at
    //                        (audit records who first set the override)
    //   *       -> null:     clear value, _reason, _set_by, _set_at
    // A reason is required whenever the override is non-null (true or false),
    // because the value diverges from reality. The client mirrors this.
    const OVERRIDES = ['admin_override_coc', 'admin_override_media', 'admin_override_ref_test', 'admin_override_u18']
    for (const key of OVERRIDES) {
      if (!(key in body)) continue
      const raw = body[key]
      const newValue = raw === true ? true : raw === false ? false : null
      const reasonKey = `${key}_reason`
      const setByKey  = `${key}_set_by`
      const setAtKey  = `${key}_set_at`
      const wasSet = reg[key] !== null && reg[key] !== undefined

      if (newValue !== null) {
        const reason = typeof body[reasonKey] === 'string' ? body[reasonKey].trim() : ''
        if (reason.length < 5) {
          return res.status(400).json({ error: `${reasonKey} must be at least 5 characters when ${key} is set` })
        }
        updates[key] = newValue
        updates[reasonKey] = reason
        if (!wasSet) {
          updates[setByKey] = user.id
          updates[setAtKey] = new Date().toISOString()
        }
      } else {
        updates[key] = null
        updates[reasonKey] = null
        updates[setByKey]  = null
        updates[setAtKey]  = null
      }
    }

    if (Object.keys(updates).length > 0) {
      const { error: updErr } = await supabaseAdmin
        .from('zltac_registrations')
        .update(updates)
        .eq('id', registrationId)
      if (updErr) return res.status(500).json({ error: updErr.message })
    }

    if ('alias' in body) {
      const { data: target, error: targetErr } = await supabaseAdmin
        .from('profiles')
        .select('roles')
        .eq('id', reg.user_id)
        .maybeSingle()
      if (targetErr) return res.status(500).json({ error: targetErr.message })
      if (!target) return res.status(404).json({ error: 'Profile not found' })
      if ((target.roles ?? []).includes('superadmin')) {
        const { error: superErr } = await verifySuperAdmin(req)
        if (superErr) return res.status(statusForAuthError(superErr)).json({ error: superErr })
      }

      const aliasResult = await changeProfileAlias({
        supabase: supabaseAdmin,
        targetProfileId: reg.user_id,
        newAlias: body.alias,
        reason: body.alias_change_reason,
        changedBy: user.id,
        source: 'registration-editor',
      })
      if (aliasResult.error) return res.status(aliasResult.status).json({ error: aliasResult.error })
    }

    const profileUpdates = {}
    if ('state' in body) profileUpdates.state = body.state || null
    if (Object.keys(profileUpdates).length > 0) {
      const { error: profErr } = await supabaseAdmin
        .from('profiles')
        .update(profileUpdates)
        .eq('id', reg.user_id)
      if (profErr) return res.status(500).json({ error: `profile: ${profErr.message}` })
    }

    if ('doubles_partner_id' in body) {
      const newPartnerId = body.doubles_partner_id || null

      // Capture everyone paired with the user (and, when replacing, with the
      // new partner) BEFORE deleting their rows, so members dropped by this
      // reshuffle can be cleaned up afterwards.
      const droppedDoubles = new Set()
      const { data: oldUserPairs } = await supabaseAdmin
        .from('doubles_pairs')
        .select('player1_id, player2_id')
        .eq('event_year', reg.year)
        .or(`player1_id.eq.${reg.user_id},player2_id.eq.${reg.user_id}`)
      for (const p of oldUserPairs ?? []) for (const pid of [p.player1_id, p.player2_id]) if (pid) droppedDoubles.add(pid)

      const { error: clearErr } = await supabaseAdmin
        .from('doubles_pairs')
        .delete()
        .eq('event_year', reg.year)
        .or(`player1_id.eq.${reg.user_id},player2_id.eq.${reg.user_id}`)
      if (clearErr) return res.status(500).json({ error: `doubles clear: ${clearErr.message}` })

      if (newPartnerId) {
        const { data: oldPartnerPairs } = await supabaseAdmin
          .from('doubles_pairs')
          .select('player1_id, player2_id')
          .eq('event_year', reg.year)
          .or(`player1_id.eq.${newPartnerId},player2_id.eq.${newPartnerId}`)
        for (const p of oldPartnerPairs ?? []) for (const pid of [p.player1_id, p.player2_id]) if (pid) droppedDoubles.add(pid)

        const { error: clearPartnerErr } = await supabaseAdmin
          .from('doubles_pairs')
          .delete()
          .eq('event_year', reg.year)
          .or(`player1_id.eq.${newPartnerId},player2_id.eq.${newPartnerId}`)
        if (clearPartnerErr) return res.status(500).json({ error: `doubles clear partner: ${clearPartnerErr.message}` })

        const { error: insErr } = await supabaseAdmin
          .from('doubles_pairs')
          .insert({ event_year: reg.year, player1_id: reg.user_id, player2_id: newPartnerId, confirmed: true })
        if (insErr) return res.status(500).json({ error: `doubles insert: ${insErr.message}` })

        // Both inserted members are confirmed — auto-add 'doubles' for each.
        await ensureSideEventMember({ slug: 'doubles', memberId: reg.user_id, eventYear: reg.year })
        await ensureSideEventMember({ slug: 'doubles', memberId: newPartnerId, eventYear: reg.year })
      }

      // Clean up any former member dropped by the reshuffle (not those in the
      // new pairing — the user is recomputed below, the new partner stays in).
      droppedDoubles.delete(reg.user_id)
      if (newPartnerId) droppedDoubles.delete(newPartnerId)
      for (const memberId of droppedDoubles) {
        await cleanupFormerSideEventMember({ table: 'doubles_pairs', slug: 'doubles', playerCols: ['player1_id', 'player2_id'], memberId, eventYear: reg.year })
      }
    }

    if ('triples_partner_ids' in body) {
      const partnerIds = Array.isArray(body.triples_partner_ids) ? body.triples_partner_ids : []
      const [p2, p3] = [partnerIds[0] || null, partnerIds[1] || null]

      // Capture the user's current team members BEFORE deleting, so members
      // dropped by this reshuffle can be cleaned up afterwards.
      const droppedTriples = new Set()
      const { data: oldTeams } = await supabaseAdmin
        .from('triples_teams')
        .select('player1_id, player2_id, player3_id')
        .eq('event_year', reg.year)
        .or(`player1_id.eq.${reg.user_id},player2_id.eq.${reg.user_id},player3_id.eq.${reg.user_id}`)
      for (const t of oldTeams ?? []) for (const pid of [t.player1_id, t.player2_id, t.player3_id]) if (pid) droppedTriples.add(pid)

      const { error: clearErr } = await supabaseAdmin
        .from('triples_teams')
        .delete()
        .eq('event_year', reg.year)
        .or(`player1_id.eq.${reg.user_id},player2_id.eq.${reg.user_id},player3_id.eq.${reg.user_id}`)
      if (clearErr) return res.status(500).json({ error: `triples clear: ${clearErr.message}` })

      if (p2 || p3) {
        const { error: insErr } = await supabaseAdmin
          .from('triples_teams')
          .insert({
            event_year: reg.year,
            player1_id: reg.user_id,
            player2_id: p2,
            player3_id: p3,
            player2_confirmed: !!p2,
            player3_confirmed: !!p3,
            confirmed: !!(p2 && p3),
          })
        if (insErr) return res.status(500).json({ error: `triples insert: ${insErr.message}` })

        // Auto-add 'triples' for every inserted member (null ids no-op).
        await ensureSideEventMember({ slug: 'triples', memberId: reg.user_id, eventYear: reg.year })
        await ensureSideEventMember({ slug: 'triples', memberId: p2, eventYear: reg.year })
        await ensureSideEventMember({ slug: 'triples', memberId: p3, eventYear: reg.year })
      }

      // Clean up any former member dropped by the reshuffle (not those in the
      // new team — the user is recomputed below, p2/p3 stay in).
      droppedTriples.delete(reg.user_id)
      if (p2) droppedTriples.delete(p2)
      if (p3) droppedTriples.delete(p3)
      for (const memberId of droppedTriples) {
        await cleanupFormerSideEventMember({ table: 'triples_teams', slug: 'triples', playerCols: ['player1_id', 'player2_id', 'player3_id'], memberId, eventYear: reg.year })
      }
    }

    const { amountOwing, error: recErr } = await computeAndWriteAmountOwing(registrationId)
    if (recErr) return res.status(500).json({ error: `recompute: ${recErr}` })

    const { data: records } = await supabaseAdmin
      .from('payment_records')
      .select('amount')
      .eq('registration_id', registrationId)
    const amountPaid = (records ?? []).reduce((s, r) => s + r.amount, 0)
    const balance = (amountOwing ?? 0) - amountPaid

    return res.json({
      registrationId,
      amountOwing: amountOwing ?? 0,
      amountPaid,
      balance,
    })
  }

  if (req.method === 'DELETE') {
    // `kind` distinguishes the satellite resources from the registration itself
    // (was `resource` before the event/registrations/payments consolidation —
    // renamed to avoid clashing with the top-level ?resource dispatch).
    const { kind, id, userId, year } = req.body ?? {}

    if (kind === 'doubles') {
      if (!id) return res.status(400).json({ error: 'id is required' })
      const { error: delErr } = await supabaseAdmin.from('doubles_pairs').delete().eq('id', id)
      if (delErr) return res.status(500).json({ error: delErr.message })
      return res.json({ ok: true })
    }

    if (kind === 'triples') {
      if (!id) return res.status(400).json({ error: 'id is required' })
      const { error: delErr } = await supabaseAdmin.from('triples_teams').delete().eq('id', id)
      if (delErr) return res.status(500).json({ error: delErr.message })
      return res.json({ ok: true })
    }

    if (!userId || !year) return res.status(400).json({ error: 'userId and year are required' })

    const { error: delErr } = await supabaseAdmin
      .from('zltac_registrations')
      .delete()
      .eq('user_id', userId)
      .eq('year', year)

    if (delErr) return res.status(500).json({ error: delErr.message })
    return res.json({ ok: true })
  }

  if (req.method === 'POST') {
    const body = req.body ?? {}

    // link-placeholder — Chunk 2 manual fallback. Committee picks any real
    // user to absorb a stuck placeholder (alias/email auto-match failed or the
    // real user prefers not to use the banner). Invokes the same
    // claim_placeholder_profile RPC the player-side claim uses, so the merge
    // logic (year-conflict check, FK moves, delete) stays one place. Caller
    // is already verifyCommittee()-gated by the top-level dispatch, which is
    // sufficient for the committee branch of the RPC's internal guard.
    if (body.action === 'link-placeholder') {
      const { placeholder_id, real_user_id } = body
      if (!placeholder_id || !real_user_id) {
        return res.status(400).json({ error: 'placeholder_id and real_user_id are required' })
      }
      const { data, error } = await supabaseAdmin.rpc('claim_placeholder_profile', {
        placeholder_id,
        real_id: real_user_id,
      })
      if (error) return res.status(500).json({ error: error.message })
      if (data && data.ok === false) return res.status(400).json(data)
      return res.json(data ?? { ok: true })
    }

    // create-placeholder-registration — committee creates a profile + registration
    // for a player who has no portal account (a "placeholder", is_placeholder=true).
    // See migration 20260524000000_placeholder_profiles.sql.
    if (body.action !== 'create-placeholder-registration') {
      return res.status(400).json({ error: `Unknown action: ${body.action}` })
    }

    const eventYear = parseInt(body.event_year)
    const firstName = (body.first_name ?? '').trim()
    const alias     = (body.alias ?? '').trim()

    if (!eventYear) return res.status(400).json({ error: 'Event year is required' })
    if (!firstName) return res.status(400).json({ error: 'First name is required' })
    if (!alias)     return res.status(400).json({ error: 'Alias is required' })

    // Collision check: reject if any existing profile already uses this alias
    // (case-insensitive). ilike does the case-insensitive match; we escape LIKE
    // wildcards in the alias so an alias like "a_b" is matched literally, then
    // confirm an exact lower() match in JS as the source of truth. The colliding
    // profile is named in the error so the admin can decide to link instead
    // (linking is Chunk 2).
    const likePattern = alias.replace(/[\\%_]/g, m => `\\${m}`)
    const { data: clashes, error: clashErr } = await supabaseAdmin
      .from('profiles')
      .select('id, first_name, last_name, alias, is_placeholder')
      .ilike('alias', likePattern)
    if (clashErr) return res.status(500).json({ error: clashErr.message })

    const clash = (clashes ?? []).find(p => (p.alias ?? '').toLowerCase() === alias.toLowerCase())
    if (clash) {
      const who = [clash.first_name, clash.last_name].filter(Boolean).join(' ') || clash.alias || 'an existing profile'
      const kind = clash.is_placeholder ? ' (placeholder)' : ''
      return res.status(409).json({
        error: `Alias "${alias}" is already used by ${who}${kind}. Choose a different alias, or link to that profile instead.`,
        colliding_profile_id: clash.id,
      })
    }

    // a. Insert the placeholder profile. profiles.id has no DB default (it used
    //    to mirror auth.users.id), so we generate the UUID here.
    const newId = randomUUID()
    const { data: prof, error: profErr } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: newId,
        is_placeholder: true,
        created_by_admin_id: user.id,
        first_name: firstName,
        last_name: (body.last_name ?? '').trim() || null,
        alias,
        placeholder_email: (body.email ?? '').trim() || null,
        phone: (body.phone ?? '').trim() || null,
        state: body.state || null,
        dob: body.dob || null,
        emergency_contact_name: (body.emergency_contact_name ?? '').trim() || null,
        emergency_contact_phone: (body.emergency_contact_phone ?? '').trim() || null,
      })
      .select('id, first_name, last_name, alias, is_placeholder')
      .single()
    if (profErr) return res.status(500).json({ error: `profile insert: ${profErr.message}` })

    // Effective side events: mirror the player self-service set, plus ensure the
    // partner-bearing slugs are present when a partner is assigned so the
    // placeholder is priced and rostered consistently with its pairing. Only the
    // placeholder's own registration is touched (partners are separate rows).
    const sideEvents = new Set(Array.isArray(body.side_events) ? body.side_events : [])
    if (body.doubles_partner_id) sideEvents.add('doubles')
    if (Array.isArray(body.triples_partner_ids) && body.triples_partner_ids.some(Boolean)) sideEvents.add('triples')

    // b. Insert the registration. The BEFORE INSERT trigger generates
    //    payment_reference ({YYYY}{SANITIZED_ALIAS}) from the alias we just saved.
    const { data: reg, error: regErr } = await supabaseAdmin
      .from('zltac_registrations')
      .insert({
        user_id: newId,
        year: eventYear,
        team_id: body.team_id || null,
        side_events: sideEvents.size ? [...sideEvents] : null,
        dinner_guests: Math.max(0, parseInt(body.dinner_guests) || 0),
        emergency_contact_name: (body.emergency_contact_name ?? '').trim() || null,
        emergency_contact_phone: (body.emergency_contact_phone ?? '').trim() || null,
        status: 'pending',
      })
      .select('id, user_id, year, side_events, status, payment_reference, amount_owing')
      .single()
    if (regErr) {
      // Compensating cleanup. supabase-js gives us no multi-statement
      // transaction, so on a failed registration insert we delete the orphan
      // placeholder profile we just created rather than leave it dangling.
      // (v1; convert profile + registration + partners into a single Postgres
      // RPC for true atomicity if this proves fragile.)
      await supabaseAdmin.from('profiles').delete().eq('id', newId)
      return res.status(500).json({ error: `registration insert: ${regErr.message}` })
    }

    // c. Doubles partner — clear-and-replace, mirroring the PATCH path. The
    //    placeholder is player1. doubles_pairs has UNIQUE(event_year, playerN_id)
    //    so any existing pair for either player must be cleared first. confirmed
    //    is true: a placeholder cannot self-confirm and the admin acts for it.
    if (body.doubles_partner_id) {
      const partnerId = body.doubles_partner_id
      const { error: clearSelfErr } = await supabaseAdmin
        .from('doubles_pairs').delete().eq('event_year', eventYear)
        .or(`player1_id.eq.${newId},player2_id.eq.${newId}`)
      if (clearSelfErr) return res.status(500).json({ error: `doubles clear: ${clearSelfErr.message}` })

      const { error: clearPartnerErr } = await supabaseAdmin
        .from('doubles_pairs').delete().eq('event_year', eventYear)
        .or(`player1_id.eq.${partnerId},player2_id.eq.${partnerId}`)
      if (clearPartnerErr) return res.status(500).json({ error: `doubles clear partner: ${clearPartnerErr.message}` })

      const { error: dErr } = await supabaseAdmin
        .from('doubles_pairs')
        .insert({ event_year: eventYear, player1_id: newId, player2_id: partnerId, confirmed: true })
      if (dErr) return res.status(500).json({ error: `doubles insert: ${dErr.message}` })
    }

    // d. Triples partners — clear-and-replace, mirroring the PATCH path. The
    //    placeholder is player1; partners fill slots 2/3. Slot-confirmed flags
    //    follow whether the slot is filled, and the team is confirmed once both
    //    partner slots are present (same semantics as the PATCH handler).
    if (Array.isArray(body.triples_partner_ids) && body.triples_partner_ids.some(Boolean)) {
      const [p2, p3] = [body.triples_partner_ids[0] || null, body.triples_partner_ids[1] || null]
      const { error: clearErr } = await supabaseAdmin
        .from('triples_teams').delete().eq('event_year', eventYear)
        .or(`player1_id.eq.${newId},player2_id.eq.${newId},player3_id.eq.${newId}`)
      if (clearErr) return res.status(500).json({ error: `triples clear: ${clearErr.message}` })

      const { error: tErr } = await supabaseAdmin
        .from('triples_teams')
        .insert({
          event_year: eventYear,
          player1_id: newId,
          player2_id: p2,
          player3_id: p3,
          player2_confirmed: !!p2,
          player3_confirmed: !!p3,
          confirmed: !!(p2 && p3),
        })
      if (tErr) return res.status(500).json({ error: `triples insert: ${tErr.message}` })
    }

    // Price the registration now that side events are final.
    const { amountOwing, error: owErr } = await computeAndWriteAmountOwing(reg.id)
    if (owErr) return res.status(500).json({ error: `recompute: ${owErr}` })

    return res.json({
      registration: { ...reg, amount_owing: amountOwing ?? reg.amount_owing },
      profile: prof,
      payment_reference: reg.payment_reference,
    })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// ── payments ──────────────────────────────────────────────────────────────────
async function buildPaymentResponse(registrationId) {
  const [{ data: reg, error: regErr }, { data: records, error: recErr }] = await Promise.all([
    supabaseAdmin.from('zltac_registrations').select('id, amount_owing').eq('id', registrationId).maybeSingle(),
    supabaseAdmin.from('payment_records')
      .select('id, registration_id, amount, recorded_at, recorded_by, bank_reference, notes')
      .eq('registration_id', registrationId)
      .order('recorded_at', { ascending: false }),
  ])
  if (regErr) return { error: regErr.message }
  if (recErr) return { error: recErr.message }
  if (!reg) return { error: 'Registration not found' }

  const amountOwing = reg.amount_owing ?? 0
  const amountPaid = (records ?? []).reduce((s, r) => s + r.amount, 0)
  const balance = amountOwing - amountPaid
  const status =
    balance < 0 ? 'overpaid'
    : balance === 0 ? 'paid'
    : amountPaid > 0 ? 'partial'
    : 'unpaid'

  return {
    summary: { registrationId, amountOwing, amountPaid, balance, status },
    records: records ?? [],
  }
}

function validAmount(v) {
  return Number.isInteger(v) && v !== 0
}

function validPositiveAmount(v) {
  return Number.isInteger(v) && v > 0
}

async function handlePayments(req, res, user) {
  if (req.method === 'POST') {
    const { registrationId, amountCents, datePaid, bankReference, notes, type, reason } = req.body ?? {}
    if (!registrationId) return res.status(400).json({ error: 'registrationId is required' })

    const recordType = type ?? 'payment'
    if (recordType !== 'payment' && recordType !== 'refund') {
      return res.status(400).json({ error: "type must be 'payment' or 'refund'" })
    }
    if (!validPositiveAmount(amountCents)) {
      return res.status(400).json({ error: 'amountCents must be a positive integer' })
    }

    let storedNotes = notes?.trim() || null
    if (recordType === 'refund') {
      const trimmedReason = reason?.trim() ?? ''
      if (!trimmedReason) return res.status(400).json({ error: 'reason is required for refunds' })
      storedNotes = storedNotes
        ? `Refund — ${trimmedReason} · ${storedNotes}`
        : `Refund — ${trimmedReason}`
    }

    const signedAmount = recordType === 'refund' ? -amountCents : amountCents

    const { error: insErr } = await supabaseAdmin.from('payment_records').insert({
      registration_id: registrationId,
      amount: signedAmount,
      recorded_at: datePaid || new Date().toISOString(),
      recorded_by: user.id,
      bank_reference: bankReference?.trim() || null,
      notes: storedNotes,
    })
    if (insErr) return res.status(500).json({ error: insErr.message })

    const result = await buildPaymentResponse(registrationId)
    if (result.error) return res.status(500).json({ error: result.error })
    return res.json(result)
  }

  if (req.method === 'PATCH') {
    const { id, amountCents, datePaid, bankReference, notes } = req.body ?? {}
    if (!id) return res.status(400).json({ error: 'id is required' })
    if (!validAmount(amountCents)) return res.status(400).json({ error: 'amountCents must be a non-zero integer' })

    const { data: existing, error: exErr } = await supabaseAdmin
      .from('payment_records').select('registration_id').eq('id', id).maybeSingle()
    if (exErr) return res.status(500).json({ error: exErr.message })
    if (!existing) return res.status(404).json({ error: 'Payment record not found' })

    // recorded_at is only sent when datePaid was provided — the key-present RPC
    // semantics preserve the stored date when it's omitted, so editing an
    // unrelated field (e.g. a note) no longer silently resets the payment date.
    const p_changes = {
      amount: amountCents,
      bank_reference: bankReference?.trim() || null,
      notes: notes?.trim() || null,
    }
    if (datePaid) p_changes.recorded_at = datePaid

    const { error: updErr } = await supabaseAdmin.rpc('edit_payment_record', {
      p_id: id,
      p_changes,
      p_changed_by: user.id,
    })
    if (updErr) return res.status(500).json({ error: updErr.message })

    const result = await buildPaymentResponse(existing.registration_id)
    if (result.error) return res.status(500).json({ error: result.error })
    return res.json(result)
  }

  if (req.method === 'DELETE') {
    const { id } = req.body ?? {}
    if (!id) return res.status(400).json({ error: 'id is required' })

    const { data: existing, error: exErr } = await supabaseAdmin
      .from('payment_records').select('registration_id').eq('id', id).maybeSingle()
    if (exErr) return res.status(500).json({ error: exErr.message })
    if (!existing) return res.status(404).json({ error: 'Payment record not found' })

    const { error: delErr } = await supabaseAdmin.rpc('delete_payment_record', {
      p_id: id,
      p_changed_by: user.id,
    })
    if (delErr) return res.status(500).json({ error: delErr.message })

    const result = await buildPaymentResponse(existing.registration_id)
    if (result.error) return res.status(500).json({ error: result.error })
    return res.json(result)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// ── backup-settings ───────────────────────────────────────────────────────────
// Committee may read; superadmin may update (enforced by RLS on the table).
// Service-role here bypasses RLS, so the API gates writes explicitly: only
// the caller's profile.roles ∋ 'superadmin' may PATCH. Reads admit any
// committee role (the dispatcher already verifyCommittee'd the request).
async function handleBackupSettings(req, res, user) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('backup_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
    if (error) return res.status(500).json({ error: error.message })
    return res.json(data)
  }

  if (req.method === 'PATCH') {
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('roles')
      .eq('id', user.id)
      .maybeSingle()
    if (profileErr) return res.status(500).json({ error: profileErr.message })
    const isSuperadmin = Array.isArray(profile?.roles) && profile.roles.includes('superadmin')
    if (!isSuperadmin) {
      return res.status(403).json({ error: 'Only superadmins can change the backup schedule.' })
    }

    const body = req.body ?? {}
    const updates = {}
    if ('frequency' in body) {
      if (!['daily', 'weekly', 'off'].includes(body.frequency)) {
        return res.status(400).json({ error: "frequency must be 'daily', 'weekly', or 'off'" })
      }
      updates.frequency = body.frequency
    }
    if ('weekly_day' in body) {
      const n = Number(body.weekly_day)
      if (!Number.isInteger(n) || n < 0 || n > 6) {
        return res.status(400).json({ error: 'weekly_day must be an integer 0-6' })
      }
      updates.weekly_day = n
    }
    if ('recipient_emails' in body) {
      if (!Array.isArray(body.recipient_emails)) {
        return res.status(400).json({ error: 'recipient_emails must be an array' })
      }
      const cleaned = []
      for (const e of body.recipient_emails) {
        if (typeof e !== 'string') return res.status(400).json({ error: 'each recipient email must be a string' })
        const trimmed = e.trim()
        if (!trimmed) continue
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
          return res.status(400).json({ error: `invalid email address: ${trimmed}` })
        }
        cleaned.push(trimmed)
      }
      updates.recipient_emails = cleaned
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'no editable fields supplied' })
    }

    const { data, error } = await supabaseAdmin
      .from('backup_settings')
      .update(updates)
      .eq('id', 1)
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json(data)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}


// ── backup-run ────────────────────────────────────────────────────────────────
// Generates the backup CSVs, stores them privately, sends an optional
// summary-only notification, and updates last_backup_at/status.
//
// Two auth contexts converge here:
//   - Cron: enforces frequency + weekly_day in Australia/Sydney
//   - Admin manual: always stores, bypasses frequency/weekly_day
async function handleBackupRun(req, res, { enforceSchedule, triggeredBy }) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Helper to write the outcome back to backup_settings. Best-effort; an
  // error here is logged but never bubbles up.
  async function recordOutcome(status, sentAt) {
    const { error } = await supabaseAdmin
      .from('backup_settings')
      .update({ last_backup_at: sentAt ?? new Date().toISOString(), last_backup_status: status })
      .eq('id', 1)
    if (error) console.error('[backup-run] failed to record outcome:', error.message)
  }

  const { data: settings, error: settingsErr } = await supabaseAdmin
    .from('backup_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle()
  if (settingsErr) return res.status(500).json({ error: settingsErr.message })
  if (!settings) return res.status(500).json({ error: 'backup_settings row missing' })

  const { dateStr, dayOfWeek } = sydneyDateInfo()

  // Schedule gate — cron only. Manual admin runs always proceed.
  if (enforceSchedule) {
    if (settings.frequency === 'off') {
      await recordOutcome(`Skipped on ${dateStr}: frequency is off`)
      return res.json({ ok: true, skipped: 'disabled' })
    }
    if (settings.frequency === 'weekly' && dayOfWeek !== settings.weekly_day) {
      // Don't update last_backup_status for "wrong day" — that would
      // overwrite the real last-run status every day in between. Only the
      // active-day runs touch the row.
      return res.json({ ok: true, skipped: 'not_weekly_day' })
    }
  }

  const runId = randomUUID()
  const objectPrefix = `${dateStr}/${new Date().toISOString().replace(/[:.]/g, '-')}-${runId}`
  const { error: runInsertErr } = await supabaseAdmin.from('backup_runs').insert({
    id: runId,
    status: 'running',
    object_prefix: objectPrefix,
    triggered_by: triggeredBy,
  })
  if (runInsertErr) return res.status(500).json({ error: `Could not start backup run: ${runInsertErr.message}` })

  const failRun = async message => {
    await supabaseAdmin.from('backup_runs').update({
      status: 'failed',
      failure_message: message,
      completed_at: new Date().toISOString(),
    }).eq('id', runId)
    await recordOutcome(`Failed: ${message}`)
  }

  // Generate the three CSVs.
  let csvs
  try {
    csvs = await generateBackupCsvs(supabaseAdmin)
  } catch (err) {
    const msg = err?.message || 'CSV generation failed'
    await failRun(`Generation failed: ${msg}`)
    return res.status(500).json({ error: msg })
  }

  const { manifest, files: storedFiles } = buildBackupFiles(csvs)
  const objectPaths = storedFiles.map(file => `${objectPrefix}/${file.name}`)
  const uploadResults = await Promise.all(storedFiles.map((file, index) =>
    supabaseAdmin.storage.from('portal-backups').upload(objectPaths[index], Buffer.from(file.content, 'utf8'), {
      contentType: file.contentType,
      upsert: false,
    })
  ))
  const uploadError = uploadResults.find(result => result.error)?.error
  if (uploadError) {
    await supabaseAdmin.storage.from('portal-backups').remove(objectPaths)
    await failRun(`Storage failed: ${uploadError.message}`)
    return res.status(500).json({ error: uploadError.message })
  }

  const completedAt = new Date().toISOString()
  const { error: completeErr } = await supabaseAdmin.from('backup_runs').update({
    status: 'complete',
    object_paths: objectPaths,
    manifest,
    completed_at: completedAt,
  }).eq('id', runId)
  if (completeErr) {
    await supabaseAdmin.storage.from('portal-backups').remove(objectPaths)
    await failRun(`Metadata failed: ${completeErr.message}`)
    return res.status(500).json({ error: completeErr.message })
  }

  // Optional email contains summary counts only. PII remains in private storage.
  const breakdownLines = csvs.eventBreakdown.map(
    e => `  - ${e.name || 'Unnamed event'} ${e.year}: ${e.registrationCount} registration${e.registrationCount === 1 ? '' : 's'}`,
  )
  const triggerNote = triggeredBy ? 'Triggered manually by an administrator.' : 'Triggered by the scheduled backup.'
  const bodyText = [
    `ALSA Portal backup stored successfully for ${dateStr} (Australia/Sydney).`,
    '',
    `Registrations: ${csvs.registrationsCount}`,
    `Payment records: ${csvs.paymentsCount}`,
    `Events: ${csvs.eventsCount}`,
    '',
    csvs.eventBreakdown.length > 0 ? 'Per event:' : 'No event registrations yet.',
    ...breakdownLines,
    '',
    'The files are in the private portal-backups storage bucket. No personal data is attached to this email.',
    '',
    triggerNote,
  ].join('\n')

  const subject = `ALSA Portal backup for ${dateStr} (${csvs.registrationsCount} registrations, ${csvs.eventsCount} events)`

  const recipients = Array.isArray(settings.recipient_emails) ? settings.recipient_emails : []
  let sendError = recipients.length > 0 && !process.env.RESEND_API_KEY
    ? 'RESEND_API_KEY is not configured'
    : null
  if (recipients.length > 0 && process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY)
      const { error } = await resend.emails.send({
        from: 'ALSA Portal Backup <noreply@lasersport.org.au>',
        to: recipients,
        subject,
        text: bodyText,
      })
      if (error) sendError = error?.message || 'Resend returned an error'
    } catch (err) {
      sendError = err?.message || 'Resend threw'
    }
  }

  if (sendError) {
    console.error('[backup-run] notification email failed:', sendError)
  }

  const retentionCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const { data: expiredRuns } = await supabaseAdmin
    .from('backup_runs')
    .select('id, object_paths')
    .eq('status', 'complete')
    .lt('started_at', retentionCutoff)
  for (const expired of expiredRuns ?? []) {
    if (expired.object_paths?.length) {
      const { error: removeErr } = await supabaseAdmin.storage.from('portal-backups').remove(expired.object_paths)
      if (removeErr) continue
    }
    await supabaseAdmin.from('backup_runs').delete().eq('id', expired.id)
  }

  const notificationStatus = recipients.length === 0
    ? 'no notification recipients configured'
    : sendError
      ? `notification failed: ${sendError}`
      : `notified ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`
  await recordOutcome(`Stored privately; ${notificationStatus}`, completedAt)
  return res.json({
    ok: true,
    stored: true,
    notified: recipients.length > 0 && !sendError,
    date: dateStr,
    objectPrefix,
    registrations: csvs.registrationsCount,
    payments: csvs.paymentsCount,
    events: csvs.eventsCount,
    recipients: recipients.length,
    notificationError: sendError,
  })
}


// ── zltac-dashboard ───────────────────────────────────────────────────────────
// Aggregate for AdminZltacDashboard. Collapses the client's resolve-event-then-
// fan-out waterfall (one serial edge + eight queries) into a single committee-
// gated call: it resolves the open event, runs the year/event-scoped counts and
// recent-activity reads in parallel, computes the stat tiles, and returns the
// ready-to-render payload. Only rendered values are returned (counts, ratio
// strings, dollar strings, labels) plus raw activity timestamps the client
// formats viewer-local — no raw registration / payment / override rows ship.
// Committee auth is enforced by the verifyCommittee gate in the dispatcher.
async function handleZltacDashboard(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // "X / N (Y%)" — guards divide-by-zero. Mirrors the old client helper.
  const ratioLabel = (x, n) => {
    const num = x ?? 0
    const denom = n ?? 0
    if (denom <= 0) return `${num} / 0`
    return `${num} / ${denom} (${Math.round((num / denom) * 100)}%)`
  }

  // 1. Resolve the active (open) event — the one genuine serial dependency.
  const { data: activeEvent, error: evErr } = await supabaseAdmin
    .from('zltac_events')
    .select('id, name, year, require_ref_test, require_coc, require_payment')
    .eq('status', 'open')
    .limit(1).maybeSingle()
  if (evErr) return res.status(500).json({ error: evErr.message })

  const activeYear = activeEvent?.year ?? null
  const activeEventId = activeEvent?.id ?? null
  const eventLabel = activeEvent ? `${activeEvent.name} ${activeEvent.year}` : '—'
  const eventScope = activeEvent ? `${activeEvent.name} ${activeEvent.year}` : 'No active event'

  // 2. Year/event-scoped counts + recent-activity rows, all in parallel.
  const [
    teamsRes,
    { data: regsForYear, error: e2 },
    { data: payRecsForYear, error: e3 },
    { data: refResults, error: e4 },
    { data: cocMediaAccs, error: e5 },
    { data: recentRegs, error: e6 },
    { data: recentPayRecs, error: e7 },
    { data: recentCoc, error: e8 },
  ] = await Promise.all([
    activeEventId
      ? supabaseAdmin.from('teams').select('*', { count: 'exact', head: true }).eq('event_id', activeEventId)
      : Promise.resolve({ count: 0 }),
    activeYear
      ? supabaseAdmin.from('zltac_registrations').select('id, user_id, amount_owing, admin_override_coc, admin_override_media, admin_override_ref_test').eq('year', activeYear)
      : Promise.resolve({ data: [] }),
    activeYear
      ? supabaseAdmin.from('payment_records')
          .select('registration_id, amount, zltac_registrations!inner(year)')
          .eq('zltac_registrations.year', activeYear)
      : Promise.resolve({ data: [] }),
    supabaseAdmin.from('referee_test_results').select('user_id, passed'),
    activeYear
      ? supabaseAdmin.from('legal_acceptances')
          .select('user_id, document:legal_documents!document_id(document_type)')
          .eq('event_year', activeYear)
      : Promise.resolve({ data: [] }),
    supabaseAdmin.from('zltac_registrations')
      .select('id, created_at, year, profiles!zltac_registrations_user_id_fkey(first_name, alias)')
      .order('created_at', { ascending: false }).limit(5),
    supabaseAdmin.from('payment_records')
      .select('amount, recorded_at, registration:zltac_registrations!inner(profiles!zltac_registrations_user_id_fkey(first_name, alias))')
      .order('recorded_at', { ascending: false }).limit(5),
    supabaseAdmin.from('legal_acceptances')
      .select('accepted_at, profiles!user_id(first_name, alias), document:legal_documents!document_id(document_type)')
      .order('accepted_at', { ascending: false }).limit(20),
  ])

  const errs = [teamsRes?.error, e2, e3, e4, e5, e6, e7, e8].filter(Boolean)
  if (errs.length) return res.status(500).json({ error: errs.map(e => e.message).join(' | ') })

  const teamsForEvent = teamsRes?.count ?? 0
  const playersForEvent = (regsForYear ?? []).length

  // Payment totals: sum payment_records by registration, then per-reg balance.
  const paidByReg = {}
  let paymentsReceivedCents = 0
  for (const rec of (payRecsForYear ?? [])) {
    paidByReg[rec.registration_id] = (paidByReg[rec.registration_id] ?? 0) + (rec.amount ?? 0)
    paymentsReceivedCents += rec.amount ?? 0
  }
  let amountOwingCents = 0
  for (const reg of (regsForYear ?? [])) {
    const balance = (reg.amount_owing ?? 0) - (paidByReg[reg.id] ?? 0)
    if (balance > 0) amountOwingCents += balance
  }

  // Ratios honour the tri-state override: a user counts satisfied iff the
  // override is true, or the override is null/absent and the real record
  // satisfies it. An override of false (force incomplete) excludes the user.
  const registeredUserIds = new Set((regsForYear ?? []).map(r => r.user_id))
  const overrideCoc   = new Map((regsForYear ?? []).map(r => [r.user_id, r.admin_override_coc]))
  const overrideMedia = new Map((regsForYear ?? []).map(r => [r.user_id, r.admin_override_media]))
  const overrideRef   = new Map((regsForYear ?? []).map(r => [r.user_id, r.admin_override_ref_test]))
  const effective = (ov, real) => (ov == null ? real : ov === true)

  const refPassedUserIds = new Set((refResults ?? []).filter(r => r.passed).map(r => r.user_id))
  const refPassedRegistered = [...registeredUserIds].filter(uid => effective(overrideRef.get(uid), refPassedUserIds.has(uid))).length

  const cocSignedUserIds = new Set((cocMediaAccs ?? []).filter(a => a.document?.document_type === 'code_of_conduct').map(a => a.user_id))
  const mediaSignedUserIds = new Set((cocMediaAccs ?? []).filter(a => a.document?.document_type === 'media_release').map(a => a.user_id))
  const cocSignedRegistered   = [...registeredUserIds].filter(uid => effective(overrideCoc.get(uid),   cocSignedUserIds.has(uid))).length
  const mediaSignedRegistered = [...registeredUserIds].filter(uid => effective(overrideMedia.get(uid), mediaSignedUserIds.has(uid))).length

  const refRequired = isRefTestRequired(activeEvent)
  const cocRequired = isCocRequired(activeEvent)
  const paymentRequired = isPaymentRequired(activeEvent)

  const stats = {
    teamsForEvent,
    playersForEvent,
    paymentRequired,
    paymentsReceivedDisplay: paymentRequired ? dollars(paymentsReceivedCents ?? 0) : 'N/A',
    amountOwingDisplay:      paymentRequired ? dollars(amountOwingCents ?? 0)     : 'N/A',
    amountOwingCents,
    refRequired,
    refRatio:   refRequired ? ratioLabel(refPassedRegistered, playersForEvent) : 'N/A',
    cocRequired,
    cocRatio:   cocRequired ? ratioLabel(cocSignedRegistered, playersForEvent) : 'N/A',
    mediaRatio: ratioLabel(mediaSignedRegistered, playersForEvent),
    eventLabel,
    eventScope,
    eventName: activeEvent?.name ?? null,
    eventYear: activeYear,
    eventOpen: !!activeEvent,
  }

  // Activity feed. Timestamps stay raw (ts); the client formats them
  // viewer-local via its existing fmt(), preserving the prior render exactly.
  const displayName = profiles => {
    if (!profiles) return 'A player'
    return profiles.alias || profiles.first_name || 'A player'
  }
  const feed = []
  for (const r of recentRegs ?? []) {
    feed.push({ icon: '📋', text: `${displayName(r.profiles)} registered for ZLTAC ${r.year ?? activeYear ?? ''}`, ts: r.created_at })
  }
  for (const p of recentPayRecs ?? []) {
    const prof = p.registration?.profiles
    const isRefund = (p.amount ?? 0) < 0
    feed.push({
      icon: isRefund ? '↩️' : '💳',
      text: isRefund
        ? `${displayName(prof)} refunded ${dollars(Math.abs(p.amount))}`
        : `${displayName(prof)} paid ${dollars(p.amount)}`,
      ts: p.recorded_at,
    })
  }
  const cocAcceptances = (recentCoc ?? []).filter(a => a.document?.document_type === 'code_of_conduct').slice(0, 5)
  for (const c of cocAcceptances) {
    feed.push({ icon: '✍️', text: `${displayName(c.profiles)} signed the Code of Conduct`, ts: c.accepted_at })
  }
  feed.sort((a, b) => new Date(b.ts) - new Date(a.ts))

  return res.json({ stats, activity: feed.slice(0, 12) })
}


// ── profile-search ────────────────────────────────────────────────────────────
// Committee-gated typeahead backing the LinkPlaceholderModal merge picker
// (AdminRegistrations). Replaces a whole-profiles client fetch + client filter.
// Mirrors the modal's old client semantics: case-insensitive contains-match on
// the same fields (alias OR first/last name), non-placeholder profiles only.
// Returns just the columns the picker renders + needs for the link; no
// sensitive columns. Bounded by limit(25); a query under 2 chars returns [] so
// the endpoint never runs an unfiltered scan. Committee auth is enforced by the
// verifyCommittee gate in the dispatcher below.
async function handleProfileSearch(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const q = (req.query.q ?? '').trim()
  if (q.length < 2) return res.json([])

  // Escape LIKE wildcards so a query like "a_b" matches literally, then wrap
  // the value in double quotes for the PostgREST .or() filter so embedded
  // commas/parens in the query aren't parsed as logic-tree separators (the
  // inner " and \ are backslash-escaped for the quoted form).
  const likeEscaped = q.replace(/[\\%_]/g, m => `\\${m}`)
  const orValue = `"%${likeEscaped.replace(/["\\]/g, m => `\\${m}`)}%"`

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, first_name, last_name, alias, state, is_placeholder')
    .eq('is_placeholder', false)
    .or(`alias.ilike.${orValue},first_name.ilike.${orValue},last_name.ilike.${orValue}`)
    .limit(25)
  if (error) return res.status(500).json({ error: error.message })
  return res.json(data ?? [])
}


// ── Dispatch ──────────────────────────────────────────────────────────────────
// ── team-review ────────────────────────────────────────────────────────────
// Committee approve/reject of a ZLTAC team's submission. Replaces the old
// client-side direct teams.update({status}). Runs on the service role so it
// bypasses the Batch-1 status trigger; the dispatcher already verifyCommittee'd
// the request. Only a ZLTAC team (event_id) that is currently 'pending' can be
// reviewed; reject requires a non-empty reason, stored in rejection_reason.
async function handleTeamReview(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = req.body ?? {}
  const { teamId, action } = body
  if (!teamId) return res.status(400).json({ error: 'teamId is required' })
  if (action !== 'approve' && action !== 'reject') {
    return res.status(400).json({ error: "action must be 'approve' or 'reject'" })
  }

  const { data: team, error: teamErr } = await supabaseAdmin
    .from('teams')
    .select('id, event_id, status')
    .eq('id', teamId)
    .maybeSingle()
  if (teamErr) return res.status(500).json({ error: teamErr.message })
  if (!team) return res.status(404).json({ error: 'Team not found' })

  // ZLTAC teams only — competition teams are managed elsewhere.
  if (!team.event_id) {
    return res.status(400).json({ error: 'Only ZLTAC teams can be reviewed here' })
  }
  // Review applies to any submitted team (pending/approved/rejected) so the
  // committee can revoke an approval or re-approve a rejected team. Only a
  // draft (not yet submitted) is off-limits.
  if (team.status === 'draft') {
    return res.status(409).json({ error: 'Team has not been submitted for approval yet.' })
  }

  let update
  if (action === 'approve') {
    update = { status: 'approved', rejection_reason: null }
  } else {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason) return res.status(400).json({ error: 'A reason is required to reject a team.' })
    update = { status: 'rejected', rejection_reason: reason }
  }

  const { error: updErr } = await supabaseAdmin.from('teams').update(update).eq('id', teamId)
  if (updErr) return res.status(500).json({ error: updErr.message })

  return res.json({ ok: true, status: update.status })
}

export default async function handler(req, res) {
  const resource = req.query.resource

  // Cron path runs without a user session. Handle it before the
  // verifyCommittee gate so the cron secret can authenticate.
  if (resource === 'backup-run' && isCronRequest(req)) {
    return handleBackupRun(req, res, { enforceSchedule: true, triggeredBy: null })
  }

  const { user, error: authErr } = await verifyCommittee(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  const limit = resource === 'profile-search' ? 60 : 120
  if (!await enforceRateLimit(req, res, {
    identifier: user.id,
    limit,
    window: '1 m',
    prefix: resource === 'profile-search' ? 'admin-profile-search' : 'admin-event',
  })) return

  if (resource === 'event')            return handleEvent(req, res)
  if (resource === 'registrations')    return handleRegistrations(req, res, user)
  if (resource === 'payments')         return handlePayments(req, res, user)
  if (resource === 'backup-settings')  return handleBackupSettings(req, res, user)
  if (resource === 'backup-run')       return handleBackupRun(req, res, { enforceSchedule: false, triggeredBy: user.id })
  if (resource === 'profile-search')   return handleProfileSearch(req, res)
  if (resource === 'zltac-dashboard')  return handleZltacDashboard(req, res)
  if (resource === 'team-review')      return handleTeamReview(req, res)
  return res.status(400).json({ error: 'resource query param must be "event", "registrations", "payments", "backup-settings", "backup-run", "profile-search", "zltac-dashboard", or "team-review"' })
}
