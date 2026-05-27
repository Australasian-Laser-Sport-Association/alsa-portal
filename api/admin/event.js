import { randomUUID } from 'crypto'
import supabaseAdmin from '../_lib/supabase.js'
import { verifyCommittee, statusForAuthError } from '../_lib/auth.js'
import { computeAndWriteAmountOwing } from '../_lib/computeAmountOwing.js'

// Committee-gated event operations. Dispatches by ?resource=:
//   ?resource=event         → archive / delete the event (POST + body.action)
//   ?resource=registrations → registrations admin (GET&year / PATCH / DELETE)
//   ?resource=payments      → payment records (POST / PATCH / DELETE)
//
// Consolidated from api/admin/event.js + registrations.js + payments.js to stay
// under the Vercel Hobby function cap. All three share verifyCommittee +
// service-role (ADR-0002). Note the registrations DELETE uses a body field
// `kind` ('doubles'/'triples') — distinct from the top-level ?resource query.

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

    const [
      { data: registrations, error: e1 },
      { data: profiles, error: e2 },
      { data: teams, error: e3 },
      { data: acceptances, error: e4 },
      { data: ref_results, error: e5 },
      { data: payment_records_raw, error: e7 },
      { data: doubles, error: e8 },
      { data: triples, error: e9 },
    ] = await Promise.all([
      supabaseAdmin.from('zltac_registrations').select('id, user_id, team_id, year, status, created_at, side_events, dinner_guests, amount_owing, payment_reference, emergency_contact_name, emergency_contact_phone, has_confirmed_side_events, has_confirmed_extras, admin_note, admin_override_coc, admin_override_coc_set_by, admin_override_coc_set_at, admin_override_coc_reason, admin_override_media, admin_override_media_set_by, admin_override_media_set_at, admin_override_media_reason, admin_override_ref_test, admin_override_ref_test_set_by, admin_override_ref_test_set_at, admin_override_ref_test_reason, admin_override_u18, admin_override_u18_set_by, admin_override_u18_set_at, admin_override_u18_reason').eq('year', year).order('created_at', { ascending: false }),
      supabaseAdmin.from('profiles').select('id, first_name, last_name, alias, state, is_placeholder'),
      supabaseAdmin.from('teams').select('id, name, state, status, captain_id, created_at'),
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
    ])

    const errs = [e1, e2, e3, e4, e5, e7, e8, e9].filter(Boolean)
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

    return res.json({ registrations, profiles, teams, coc_sigs, ref_results, media_releases, payment_records, doubles, triples })
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
    // Override transition logic. For each of the four overrides, branch
    // on what the body is asking for and the current stored state:
    //   off -> on: validate _reason (>= 5 chars), write _set_by / _set_at
    //   on  -> on: update _reason (admin may edit it in place), preserve
    //              _set_by / _set_at (audit records who first granted)
    //   on  -> off: clear _reason, _set_by, _set_at
    //   off -> off: no-op
    // The reason is required whenever the override is being set to true,
    // including same-true edits, because we always write _reason in that
    // branch. The client mirrors this validation.
    const OVERRIDES = ['admin_override_coc', 'admin_override_media', 'admin_override_ref_test', 'admin_override_u18']
    for (const key of OVERRIDES) {
      if (!(key in body)) continue
      const newValue = !!body[key]
      const reasonKey = `${key}_reason`
      const setByKey  = `${key}_set_by`
      const setAtKey  = `${key}_set_at`
      const wasOn = !!reg[key]

      if (newValue) {
        const reason = typeof body[reasonKey] === 'string' ? body[reasonKey].trim() : ''
        if (reason.length < 5) {
          return res.status(400).json({ error: `${reasonKey} must be at least 5 characters when ${key} is on` })
        }
        updates[key] = true
        updates[reasonKey] = reason
        if (!wasOn) {
          updates[setByKey] = user.id
          updates[setAtKey] = new Date().toISOString()
        }
      } else {
        updates[key] = false
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

    const profileUpdates = {}
    if ('alias' in body) profileUpdates.alias = body.alias?.trim() || null
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
      const { error: clearErr } = await supabaseAdmin
        .from('doubles_pairs')
        .delete()
        .eq('event_year', reg.year)
        .or(`player1_id.eq.${reg.user_id},player2_id.eq.${reg.user_id}`)
      if (clearErr) return res.status(500).json({ error: `doubles clear: ${clearErr.message}` })

      if (newPartnerId) {
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
      }
    }

    if ('triples_partner_ids' in body) {
      const partnerIds = Array.isArray(body.triples_partner_ids) ? body.triples_partner_ids : []
      const [p2, p3] = [partnerIds[0] || null, partnerIds[1] || null]

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

    const { error: updErr } = await supabaseAdmin.from('payment_records').update({
      amount: amountCents,
      recorded_at: datePaid || new Date().toISOString(),
      bank_reference: bankReference?.trim() || null,
      notes: notes?.trim() || null,
    }).eq('id', id)
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

    const { error: delErr } = await supabaseAdmin.from('payment_records').delete().eq('id', id)
    if (delErr) return res.status(500).json({ error: delErr.message })

    const result = await buildPaymentResponse(existing.registration_id)
    if (result.error) return res.status(500).json({ error: result.error })
    return res.json(result)
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// ── Dispatch ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const { user, error: authErr } = await verifyCommittee(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  const resource = req.query.resource
  if (resource === 'event')         return handleEvent(req, res)
  if (resource === 'registrations') return handleRegistrations(req, res, user)
  if (resource === 'payments')      return handlePayments(req, res, user)
  return res.status(400).json({ error: 'resource query param must be "event", "registrations", or "payments"' })
}
