import { isIP } from 'node:net'
import { enforceRateLimit } from './_lib/rateLimit.js'
import supabaseAdmin from './_lib/supabase.js'
import { verifyUser } from './_lib/auth.js'
import { COMMITTEE_ROLES } from '../src/lib/roles.js'
import { computeAndWriteAmountOwing } from './_lib/computeAmountOwing.js'
import { cleanupFormerSideEventMember, cleanupFormerSideEventMembers, ensureSideEventMember } from './_lib/sideEventCleanup.js'
import { requireOpenPhase, getEventPhase } from './_lib/eventPhase.js'
import { anyPlaceholder } from './_lib/placeholders.js'

const DOUBLES_PAIR_COLUMNS = 'id, event_year, player1_id, player2_id, confirmed, created_at'
const TRIPLES_TEAM_COLUMNS = 'id, event_year, player1_id, player2_id, player3_id, player2_confirmed, player3_confirmed, confirmed, created_at'

// Helper: returns true and writes a 403 to res when the event for the
// given year is not in 'open' phase. Used only by price-bearing player
// mutations (registration cancel). Partner-pairing actions (doubles/triples)
// are intentionally NOT guarded — shuffling partners within already-committed
// side events doesn't change anyone's amount_owing, so it stays editable
// after lock. The price-bearing writes (side_events array, extras, team
// membership) remain frozen: side_events/extras via the client confirm
// buttons + locked state, team membership via api/captain.js.
async function denyIfLocked(res, year) {
  const guard = await requireOpenPhase(year)
  if (guard.ok) return false
  res.status(guard.status).json({ error: guard.error, phase: guard.phase })
  return true
}

// Partner invites/confirms auto-add the relevant side event ('doubles' /
// 'triples') to the target player's side_events when they don't already
// have it. In 'open' phase that's fine. After lock it would silently raise
// that player's amount_owing, breaking price stability — so block it.
// Returns true (and writes a 400) when, in a non-open phase, the target
// player doesn't yet have `slug` selected. In 'open' phase always returns
// false (auto-add behaviour unchanged).
async function denyIfWouldAddSideEventAfterLock(res, year, targetUserId, slug) {
  const { phase } = await getEventPhase(year)
  if (phase === 'open') return false

  const { data: reg } = await supabaseAdmin
    .from('zltac_registrations')
    .select('side_events')
    .eq('user_id', targetUserId)
    .eq('year', year)
    .maybeSingle()

  if ((reg?.side_events ?? []).includes(slug)) return false

  const label = slug === 'doubles' ? 'Doubles' : slug === 'triples' ? 'Triples' : slug
  res.status(400).json({
    error: `This player isn't registered for ${label}. They need to add it themselves before the lock, or contact committee.`,
    phase,
  })
  return true
}

// Consolidated player-action endpoint. Dispatches by ?resource=:
//   ?resource=doubles      → doubles partner flow (POST + action)
//   ?resource=triples      → triples team flow    (POST + action)
//   ?resource=registration → own-registration ops (POST + action)
//
// All resources are POST, all require an authenticated user, and all
// use an `action` field on the JSON body to choose the operation —
// matching the pre-consolidation API surface exactly.

// ── doubles ─────────────────────────────────────────────────────────────────

async function handleDoubles(req, res, user) {
  const body = req.body ?? {}
  const { action } = body

  if (action === 'search') {
    const { eventYear, term } = body
    const safeTerm = typeof term === 'string' ? term.trim() : ''
    if (!eventYear || !safeTerm) return res.status(400).json({ error: 'eventYear and term are required' })
    if (safeTerm.length > 100) return res.status(400).json({ error: 'Search term too long' })
    if (/[,()*.:\\]/.test(safeTerm)) return res.status(400).json({ error: 'Search term contains invalid characters' })

    const { data: eligible, error: eligErr } = await supabaseAdmin
      .from('zltac_registrations')
      .select('user_id')
      .eq('year', eventYear)
      .neq('user_id', user.id)

    if (eligErr) return res.status(500).json({ error: eligErr.message })

    const eligibleIds = (eligible ?? []).map(r => r.user_id)
    if (!eligibleIds.length) return res.json({ results: [] })

    const { data: existingPairs, error: pairsErr } = await supabaseAdmin
      .from('doubles_pairs')
      .select('player1_id, player2_id')
      .eq('event_year', eventYear)

    if (pairsErr) return res.status(500).json({ error: pairsErr.message })

    const takenIds = new Set()
    existingPairs?.forEach(p => {
      if (p.player1_id) takenIds.add(p.player1_id)
      if (p.player2_id) takenIds.add(p.player2_id)
    })

    const availableIds = eligibleIds.filter(id => !takenIds.has(id))
    if (!availableIds.length) return res.json({ results: [] })

    const { data: profs, error: profsErr } = await supabaseAdmin
      .from('profiles')
      .select('id, first_name, last_name, alias, state, roles')
      .in('id', availableIds)
      .or(`first_name.ilike.%${safeTerm}%,last_name.ilike.%${safeTerm}%,alias.ilike.%${safeTerm}%`)

    if (profsErr) return res.status(500).json({ error: profsErr.message })
    if (!profs?.length) return res.json({ results: [] })

    const profIds = profs.map(p => p.id)
    const { data: teamRegs, error: teamRegsErr } = await supabaseAdmin
      .from('zltac_registrations')
      .select('user_id, side_events, teams(name)')
      .eq('year', eventYear)
      .in('user_id', profIds)

    if (teamRegsErr) return res.status(500).json({ error: teamRegsErr.message })

    const teamMap = Object.fromEntries((teamRegs ?? []).map(r => [r.user_id, r.teams?.name ?? null]))
    // sideEvents lets the client grey out players who haven't selected
    // 'doubles' once registration is locked (price-stability guard mirror).
    const sideMap = Object.fromEntries((teamRegs ?? []).map(r => [r.user_id, r.side_events ?? []]))
    return res.json({ results: profs.map(p => ({ ...p, teamName: teamMap[p.id] ?? null, sideEvents: sideMap[p.id] ?? [] })) })
  }

  if (action === 'create') {
    const { eventYear, partnerId } = body
    if (!eventYear || !partnerId) return res.status(400).json({ error: 'eventYear and partnerId are required' })

    // Auto-confirm when the partner is a placeholder: a placeholder has no login
    // to confirm from, so the pairing is confirmed on creation.
    const confirmed = await anyPlaceholder([partnerId])

    const { data: record, error: insertErr } = await supabaseAdmin
      .from('doubles_pairs')
      .insert({ event_year: eventYear, player1_id: user.id, player2_id: partnerId, confirmed })
      .select()
      .single()

    if (insertErr) return res.status(500).json({ error: insertErr.message })

    // Creator commits on create — auto-add 'doubles' (no manual save needed).
    await ensureSideEventMember({ slug: 'doubles', memberId: user.id, eventYear })

    return res.json({ record })
  }

  if (action === 'confirm') {
    const { id } = body
    if (!id) return res.status(400).json({ error: 'id is required' })

    const { data: pair, error: pairErr } = await supabaseAdmin.from('doubles_pairs').select(DOUBLES_PAIR_COLUMNS).eq('id', id).maybeSingle()
    if (pairErr) return res.status(500).json({ error: pairErr.message })
    if (!pair) return res.status(404).json({ error: 'Pair not found' })
    if (pair.player2_id !== user.id) return res.status(403).json({ error: 'Not a party to this pair' })
    if (await denyIfWouldAddSideEventAfterLock(res, pair.event_year, user.id, 'doubles')) return

    const { data: record, error: updateErr } = await supabaseAdmin
      .from('doubles_pairs')
      .update({ confirmed: true })
      .eq('id', id)
      .select()
      .single()

    if (updateErr) return res.status(500).json({ error: updateErr.message })

    // Accepter commits on confirm — auto-add 'doubles' for them.
    await ensureSideEventMember({ slug: 'doubles', memberId: user.id, eventYear: pair.event_year })

    return res.json({ record })
  }

  if (action === 'delete') {
    const { id } = body
    if (!id) return res.status(400).json({ error: 'id is required' })

    const { data: pair, error: pairErr } = await supabaseAdmin.from('doubles_pairs').select('player1_id, player2_id, event_year').eq('id', id).maybeSingle()
    if (pairErr) return res.status(500).json({ error: pairErr.message })
    if (!pair) return res.status(404).json({ error: 'Pair not found' })
    if (pair.player1_id !== user.id && pair.player2_id !== user.id) {
      return res.status(403).json({ error: 'Not a party to this pair' })
    }

    const { error: delErr } = await supabaseAdmin.from('doubles_pairs').delete().eq('id', id)
    if (delErr) return res.status(500).json({ error: delErr.message })

    // The other former member keeps 'doubles' billed unless cleaned up.
    const partnerId = pair.player1_id === user.id ? pair.player2_id : pair.player1_id
    await cleanupFormerSideEventMember({ table: 'doubles_pairs', slug: 'doubles', playerCols: ['player1_id', 'player2_id'], memberId: partnerId, eventYear: pair.event_year })

    return res.json({ ok: true })
  }

  return res.status(400).json({ error: `Unknown action: ${action}` })
}

// ── triples ─────────────────────────────────────────────────────────────────

async function handleTriples(req, res, user) {
  const body = req.body ?? {}
  const { action } = body

  if (action === 'search') {
    const { eventYear, term, existingPlayer2Id, existingPlayer3Id } = body
    const safeTerm = typeof term === 'string' ? term.trim() : ''
    if (!eventYear || !safeTerm) return res.status(400).json({ error: 'eventYear and term are required' })
    if (safeTerm.length > 100) return res.status(400).json({ error: 'Search term too long' })
    if (/[,()*.:\\]/.test(safeTerm)) return res.status(400).json({ error: 'Search term contains invalid characters' })

    const { data: eligible, error: eligErr } = await supabaseAdmin
      .from('zltac_registrations')
      .select('user_id')
      .eq('year', eventYear)
      .neq('user_id', user.id)

    if (eligErr) return res.status(500).json({ error: eligErr.message })

    let eligibleIds = (eligible ?? []).map(r => r.user_id)
      .filter(id => id !== existingPlayer2Id && id !== existingPlayer3Id)

    if (!eligibleIds.length) return res.json({ results: [] })

    const { data: existingTriples, error: triplesErr } = await supabaseAdmin
      .from('triples_teams')
      .select('player1_id, player2_id, player3_id')
      .eq('event_year', eventYear)

    if (triplesErr) return res.status(500).json({ error: triplesErr.message })

    const takenIds = new Set()
    existingTriples?.forEach(t => {
      if (t.player1_id) takenIds.add(t.player1_id)
      if (t.player2_id) takenIds.add(t.player2_id)
      if (t.player3_id) takenIds.add(t.player3_id)
    })

    const availableIds = eligibleIds.filter(id => !takenIds.has(id))
    if (!availableIds.length) return res.json({ results: [] })

    const { data: profs, error: profsErr } = await supabaseAdmin
      .from('profiles')
      .select('id, first_name, last_name, alias, state, roles')
      .in('id', availableIds)
      .or(`first_name.ilike.%${safeTerm}%,last_name.ilike.%${safeTerm}%,alias.ilike.%${safeTerm}%`)

    if (profsErr) return res.status(500).json({ error: profsErr.message })
    if (!profs?.length) return res.json({ results: [] })

    const profIds = profs.map(p => p.id)
    const { data: teamRegs, error: teamRegsErr } = await supabaseAdmin
      .from('zltac_registrations')
      .select('user_id, side_events, teams(name)')
      .eq('year', eventYear)
      .in('user_id', profIds)

    if (teamRegsErr) return res.status(500).json({ error: teamRegsErr.message })

    const teamMap = Object.fromEntries((teamRegs ?? []).map(r => [r.user_id, r.teams?.name ?? null]))
    // sideEvents lets the client grey out players who haven't selected
    // 'triples' once registration is locked (price-stability guard mirror).
    const sideMap = Object.fromEntries((teamRegs ?? []).map(r => [r.user_id, r.side_events ?? []]))
    return res.json({ results: profs.map(p => ({ ...p, teamName: teamMap[p.id] ?? null, sideEvents: sideMap[p.id] ?? [] })) })
  }

  if (action === 'create') {
    const { eventYear, slot, partnerId } = body
    if (!eventYear || !slot || !partnerId) return res.status(400).json({ error: 'eventYear, slot and partnerId are required' })

    // Auto-confirm the partner's slot when the partner is a placeholder (no
    // login to confirm from). The team stays unconfirmed until both partner
    // slots are filled and confirmed.
    const slotConfirmed = await anyPlaceholder([partnerId])

    const { data: record, error: insertErr } = await supabaseAdmin
      .from('triples_teams')
      .insert({
        event_year: eventYear,
        player1_id: user.id,
        [`player${slot}_id`]: partnerId,
        confirmed: false,
        player2_confirmed: false,
        player3_confirmed: false,
        [`player${slot}_confirmed`]: slotConfirmed,
      })
      .select()
      .single()

    if (insertErr) return res.status(500).json({ error: insertErr.message })

    // Creator commits on create — auto-add 'triples' (no manual save needed).
    await ensureSideEventMember({ slug: 'triples', memberId: user.id, eventYear })

    return res.json({ record })
  }

  if (action === 'add-slot') {
    const { id, slot, partnerId } = body
    if (slot !== 2 && slot !== 3) return res.status(400).json({ error: 'slot must be 2 or 3' })
    if (!id || !slot || !partnerId) return res.status(400).json({ error: 'id, slot and partnerId are required' })

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from('triples_teams')
      .select('player1_id, event_year, player2_confirmed, player3_confirmed')
      .eq('id', id)
      .maybeSingle()
    if (existingErr) return res.status(500).json({ error: existingErr.message })
    if (!existing || existing.player1_id !== user.id) return res.status(403).json({ error: 'Only the team creator can add players' })

    // Auto-confirm this slot when the added partner is a placeholder. The whole
    // team is confirmed once both partner slots are confirmed.
    const slotConfirmed = await anyPlaceholder([partnerId])
    const otherField = slot === 2 ? 'player3_confirmed' : 'player2_confirmed'
    const teamConfirmed = slotConfirmed && existing[otherField] === true

    const { data: record, error: updateErr } = await supabaseAdmin
      .from('triples_teams')
      .update({ [`player${slot}_id`]: partnerId, [`player${slot}_confirmed`]: slotConfirmed, confirmed: teamConfirmed })
      .eq('id', id)
      .select()
      .single()

    if (updateErr) return res.status(500).json({ error: updateErr.message })
    return res.json({ record })
  }

  if (action === 'confirm') {
    const { id, mySlot } = body
    if (!id || !mySlot) return res.status(400).json({ error: 'id and mySlot are required' })

    const { data: existing, error: existingErr } = await supabaseAdmin.from('triples_teams').select(TRIPLES_TEAM_COLUMNS).eq('id', id).maybeSingle()
    if (existingErr) return res.status(500).json({ error: existingErr.message })
    if (!existing) return res.status(404).json({ error: 'Team not found' })
    if (mySlot !== 2 && mySlot !== 3) return res.status(400).json({ error: 'mySlot must be 2 or 3' })
    if (existing[`player${mySlot}_id`] !== user.id) return res.status(403).json({ error: 'You are not the player at this slot' })
    if (await denyIfWouldAddSideEventAfterLock(res, existing.event_year, user.id, 'triples')) return

    const myField = `player${mySlot}_confirmed`
    const otherSlot = mySlot === 2 ? 3 : 2
    const otherField = `player${otherSlot}_confirmed`
    const otherConfirmed = existing[otherField] === true

    const updates = {
      [myField]: true,
      ...(otherConfirmed ? { confirmed: true } : {}),
    }

    const { data: record, error: updateErr } = await supabaseAdmin
      .from('triples_teams')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (updateErr) return res.status(500).json({ error: updateErr.message })

    // Accepter commits on confirm — auto-add 'triples' for them.
    await ensureSideEventMember({ slug: 'triples', memberId: user.id, eventYear: existing.event_year })

    return res.json({ record })
  }

  if (action === 'clear-slot') {
    const { id, slot } = body
    if (slot !== 2 && slot !== 3) return res.status(400).json({ error: 'slot must be 2 or 3' })
    if (!id || !slot) return res.status(400).json({ error: 'id and slot are required' })

    const { data: existing, error: existingErr } = await supabaseAdmin.from('triples_teams').select('player1_id, player2_id, player3_id, event_year').eq('id', id).maybeSingle()
    if (existingErr) return res.status(500).json({ error: existingErr.message })
    if (!existing || existing.player1_id !== user.id) return res.status(403).json({ error: 'Only the team creator can clear slots' })

    const droppedId = existing[`player${slot}_id`]

    const { data: record, error: updateErr } = await supabaseAdmin
      .from('triples_teams')
      .update({ [`player${slot}_id`]: null, [`player${slot}_confirmed`]: false, confirmed: false })
      .eq('id', id)
      .select()
      .single()

    if (updateErr) return res.status(500).json({ error: updateErr.message })

    // Only the dropped slot's player loses 'triples'; the remaining members
    // stay in this (now unconfirmed) team row, so the guard keeps their slug.
    await cleanupFormerSideEventMember({ table: 'triples_teams', slug: 'triples', playerCols: ['player1_id', 'player2_id', 'player3_id'], memberId: droppedId, eventYear: existing.event_year })

    return res.json({ record })
  }

  if (action === 'disband') {
    const { id } = body
    if (!id) return res.status(400).json({ error: 'id is required' })

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from('triples_teams')
      .select('player1_id, player2_id, player3_id, event_year')
      .eq('id', id)
      .maybeSingle()

    if (existingErr) return res.status(500).json({ error: existingErr.message })
    if (!existing) return res.status(404).json({ error: 'Team not found' })

    const isParty = [existing.player1_id, existing.player2_id, existing.player3_id].includes(user.id)
    if (!isParty) return res.status(403).json({ error: 'Not a party to this team' })

    const { error: delErr } = await supabaseAdmin.from('triples_teams').delete().eq('id', id)
    if (delErr) return res.status(500).json({ error: delErr.message })

    // Every other former member keeps 'triples' billed unless cleaned up.
    const formerMembers = [existing.player1_id, existing.player2_id, existing.player3_id].filter(pid => pid && pid !== user.id)
    for (const memberId of formerMembers) {
      await cleanupFormerSideEventMember({ table: 'triples_teams', slug: 'triples', playerCols: ['player1_id', 'player2_id', 'player3_id'], memberId, eventYear: existing.event_year })
    }

    return res.json({ ok: true })
  }

  return res.status(400).json({ error: `Unknown action: ${action}` })
}

// ── registration ────────────────────────────────────────────────────────────

async function handleRegistration(req, res, user) {
  const body = req.body ?? {}
  const { action } = body

  if (action === 'sign-legal') {
    // Player (re)signs CoC / Media Release. Routed through the service role so
    // the clear_force_incomplete_on_resign AFTER-trigger updates
    // zltac_registrations with auth.uid() IS NULL — the system path the
    // protect_registration_admin_fields guard allows — instead of failing
    // under the player's own auth context.
    const { documentId } = body
    const eventYear = Number.parseInt(body.eventYear, 10)
    if (!documentId) return res.status(400).json({ error: 'documentId is required' })
    if (!Number.isInteger(eventYear)) return res.status(400).json({ error: 'eventYear is required' })

    // Defensive: only an active legal document may be signed. Never trust a
    // client-supplied document_id for an arbitrary or retired row.
    const { data: doc, error: docErr } = await supabaseAdmin
      .from('legal_documents')
      .select('id, is_active, document_type')
      .eq('id', documentId)
      .maybeSingle()
    if (docErr) return res.status(500).json({ error: docErr.message })
    const signableTypes = ['code_of_conduct', 'media_release']
    if (!doc || !doc.is_active || !signableTypes.includes(doc.document_type)) {
      return res.status(400).json({ error: 'Document is not available for signing.' })
    }

    const { data: registration, error: registrationErr } = await supabaseAdmin
      .from('zltac_registrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('year', eventYear)
      .maybeSingle()
    if (registrationErr) return res.status(500).json({ error: registrationErr.message })
    if (!registration) return res.status(403).json({ error: 'Register for this event before signing its documents.' })

    // user_id is taken from the authenticated session, never the request body.
    const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null
    const forwardedFor = typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : null
    const rawIpAddress = forwardedFor || (typeof req.headers['x-real-ip'] === 'string' ? req.headers['x-real-ip'].trim() : null)
    const ipAddress = rawIpAddress && isIP(rawIpAddress) ? rawIpAddress : null
    const { error: insertErr } = await supabaseAdmin
      .from('legal_acceptances')
      .insert({
        user_id: user.id,
        document_id: documentId,
        event_year: eventYear,
        accepted_at: new Date().toISOString(),
        ip_address: ipAddress,
        user_agent: userAgent,
      })
    if (insertErr) return res.status(500).json({ error: insertErr.message })

    return res.json({ ok: true })
  }

  if (action === 'precheck-register') {
    // Cap-check used by PlayerRegister / CaptainRegister before inserting
    // a new registration row. Returns 400 with a user-facing message when
    // the event would exceed max_players. Null cap = no limit. Already
    // registered = no-op for cap purposes (upsert is idempotent count-wise).
    const { year } = body
    if (!year) return res.status(400).json({ error: 'year is required' })
    // Block new registrations once the event locks. RLS also blocks the
    // client-direct insert; this returns a clean message before the attempt.
    if (await denyIfLocked(res, year)) return

    // Chunk 2: detect the placeholder-alias conflict that would otherwise hit
    // the zltac_registrations.payment_reference UNIQUE constraint at insert
    // time. We compare the caller's profile.alias (already populated by the
    // signup metadata trigger) against the alias of any placeholder profile
    // that has a registration for this year. The caller's own row is skipped
    // (they're not a placeholder, but belt-and-braces). Returns ok:true with a
    // placeholder_id so PlayerRegister can surface the claim flow directly.
    const { data: callerProfile, error: callerErr } = await supabaseAdmin
      .from('profiles')
      .select('alias')
      .eq('id', user.id)
      .maybeSingle()
    if (callerErr) return res.status(500).json({ error: callerErr.message })

    const callerAlias = (callerProfile?.alias ?? '').trim()
    if (callerAlias) {
      const { data: phReg, error: phErr } = await supabaseAdmin
        .from('zltac_registrations')
        .select('user_id, profiles!zltac_registrations_user_id_fkey!inner(id, alias, is_placeholder)')
        .eq('year', year)
        .eq('profiles.is_placeholder', true)
      if (phErr) return res.status(500).json({ error: phErr.message })

      const lowerCaller = callerAlias.toLowerCase()
      const conflict = (phReg ?? []).find(r => (r.profiles?.alias ?? '').toLowerCase() === lowerCaller)
      if (conflict) {
        // 200 with ok:false so apiFetch resolves with the body; the caller
        // inspects the structured payload to drive the claim modal directly.
        // Other ok:false branches in this codebase (claim_placeholder_profile,
        // RPC wrappers) follow the same pattern.
        return res.json({
          ok: false,
          error: 'placeholder_exists',
          placeholder_id: conflict.user_id,
          message: 'There is already a placeholder registration with this alias for this event. Claim it instead.',
        })
      }
    }

    const { data: ev, error: evErr } = await supabaseAdmin
      .from('zltac_events')
      .select('max_players')
      .eq('year', year)
      .maybeSingle()
    if (evErr) return res.status(500).json({ error: evErr.message })

    const cap = ev?.max_players
    if (!cap) return res.json({ ok: true })

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from('zltac_registrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('year', year)
      .maybeSingle()
    if (existingErr) return res.status(500).json({ error: existingErr.message })
    if (existing) return res.json({ ok: true })

    const { count, error: countErr } = await supabaseAdmin
      .from('zltac_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('year', year)
    if (countErr) return res.status(500).json({ error: countErr.message })

    if ((count ?? 0) >= cap) {
      return res.status(400).json({ error: `Registration cap of ${cap} reached. Contact the committee.` })
    }
    return res.json({ ok: true })
  }

  if (action === 'register') {
    const eventYear = Number.parseInt(body.year, 10)
    if (!Number.isInteger(eventYear)) return res.status(400).json({ error: 'year is required' })
    if (await denyIfLocked(res, eventYear)) return

    const emergencyContactName = typeof body.emergency_contact_name === 'string'
      ? body.emergency_contact_name.trim() || null
      : null
    const emergencyContactPhone = typeof body.emergency_contact_phone === 'string'
      ? body.emergency_contact_phone.trim() || null
      : null

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from('zltac_registrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('year', eventYear)
      .maybeSingle()
    if (existingErr) return res.status(500).json({ error: existingErr.message })
    if (existing) return res.json({ ok: true, id: existing.id, existing: true })

    const { data: callerProfile, error: callerErr } = await supabaseAdmin
      .from('profiles')
      .select('alias')
      .eq('id', user.id)
      .maybeSingle()
    if (callerErr) return res.status(500).json({ error: callerErr.message })

    const callerAlias = (callerProfile?.alias ?? '').trim()
    if (callerAlias) {
      const { data: phReg, error: phErr } = await supabaseAdmin
        .from('zltac_registrations')
        .select('user_id, profiles!zltac_registrations_user_id_fkey!inner(id, alias, is_placeholder)')
        .eq('year', eventYear)
        .eq('profiles.is_placeholder', true)
      if (phErr) return res.status(500).json({ error: phErr.message })

      const lowerCaller = callerAlias.toLowerCase()
      const conflict = (phReg ?? []).find(r => (r.profiles?.alias ?? '').toLowerCase() === lowerCaller)
      if (conflict) {
        return res.json({
          ok: false,
          error: 'placeholder_exists',
          placeholder_id: conflict.user_id,
          message: 'There is already a placeholder registration with this alias for this event. Claim it instead.',
        })
      }
    }

    const { data: ev, error: evErr } = await supabaseAdmin
      .from('zltac_events')
      .select('max_players')
      .eq('year', eventYear)
      .maybeSingle()
    if (evErr) return res.status(500).json({ error: evErr.message })

    const cap = ev?.max_players
    if (cap) {
      const { count, error: countErr } = await supabaseAdmin
        .from('zltac_registrations')
        .select('id', { count: 'exact', head: true })
        .eq('year', eventYear)
      if (countErr) return res.status(500).json({ error: countErr.message })
      if ((count ?? 0) >= cap) {
        return res.status(400).json({ error: `Registration cap of ${cap} reached. Contact the committee.` })
      }
    }

    const { data: regRow, error: regError } = await supabaseAdmin
      .from('zltac_registrations')
      .insert({
        user_id: user.id,
        year: eventYear,
        team_id: null,
        side_events: null,
        dinner_guests: 0,
        emergency_contact_name: emergencyContactName,
        emergency_contact_phone: emergencyContactPhone,
        status: 'pending',
      })
      .select('id')
      .single()

    if (regError) {
      const msg = regError.message ?? ''
      if (regError.code === '23505' || msg.includes('zltac_registrations_payment_reference_key')) {
        return res.status(409).json({ error: 'A registration with this alias already exists for this event. If that is you, claim it via the banner above or check your Player Hub.' })
      }
      return res.status(500).json({ error: regError.message })
    }

    const result = await computeAndWriteAmountOwing(regRow.id)
    if (result.error) return res.status(500).json({ error: result.error })

    return res.status(201).json({ ok: true, id: regRow.id, amountOwing: result.amountOwing })
  }

  if (action === 'cancel') {
    const { year } = body
    if (!year) return res.status(400).json({ error: 'year is required' })
    if (await denyIfLocked(res, year)) return

    const { data: reg, error: regErr } = await supabaseAdmin
      .from('zltac_registrations')
      .select('id, team_id')
      .eq('user_id', user.id)
      .eq('year', year)
      .maybeSingle()
    if (regErr) return res.status(500).json({ error: regErr.message })
    if (!reg) return res.status(404).json({ error: 'No registration found for that year' })

    if (reg.team_id) {
      const { data: team, error: teamErr } = await supabaseAdmin
        .from('teams')
        .select('captain_id')
        .eq('id', reg.team_id)
        .maybeSingle()
      if (teamErr) return res.status(500).json({ error: teamErr.message })
      if (team?.captain_id === user.id) {
        return res.status(409).json({
          error: 'You are the captain. Disband your team first.',
          teamId: reg.team_id,
          code: 'CAPTAIN_BLOCKED',
        })
      }

      try {
        const { error: memberErr } = await supabaseAdmin
          .from('team_members')
          .delete()
          .eq('team_id', reg.team_id)
          .eq('user_id', user.id)
        if (memberErr) console.error('[api/player registration cancel] dual-write team_members delete failed:', memberErr.message)
      } catch (err) {
        console.error('[api/player registration cancel] dual-write threw:', err)
      }
    }

    const { error: delErr } = await supabaseAdmin
      .from('zltac_registrations')
      .delete()
      .eq('id', reg.id)
    if (delErr) return res.status(500).json({ error: delErr.message })

    // Cascade: dissolve any doubles/triples this user was in for the year and
    // clean up the remaining partners (their slug + amount_owing). The user's
    // own registration is already gone, so only the partners need fixing.
    const { data: myPairs } = await supabaseAdmin
      .from('doubles_pairs')
      .select('id, player1_id, player2_id')
      .eq('event_year', year)
      .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
    const { data: myTeams } = await supabaseAdmin
      .from('triples_teams')
      .select('id, player1_id, player2_id, player3_id')
      .eq('event_year', year)
      .or(`player1_id.eq.${user.id},player2_id.eq.${user.id},player3_id.eq.${user.id}`)

    const doublesPartners = new Set((myPairs ?? []).flatMap(p => [p.player1_id, p.player2_id]).filter(pid => pid && pid !== user.id))
    const triplesPartners = new Set((myTeams ?? []).flatMap(t => [t.player1_id, t.player2_id, t.player3_id]).filter(pid => pid && pid !== user.id))

    if (myPairs?.length) await supabaseAdmin.from('doubles_pairs').delete().in('id', myPairs.map(p => p.id))
    if (myTeams?.length) await supabaseAdmin.from('triples_teams').delete().in('id', myTeams.map(t => t.id))

    await Promise.all([
      cleanupFormerSideEventMembers({ table: 'doubles_pairs', slug: 'doubles', playerCols: ['player1_id', 'player2_id'], memberIds: [...doublesPartners], eventYear: year }),
      cleanupFormerSideEventMembers({ table: 'triples_teams', slug: 'triples', playerCols: ['player1_id', 'player2_id', 'player3_id'], memberIds: [...triplesPartners], eventYear: year }),
    ])

    return res.json({ ok: true })
  }

  if (action === 'recompute-owing') {
    const { registrationId } = body
    if (!registrationId) return res.status(400).json({ error: 'registrationId is required' })

    const { data: reg, error: regErr } = await supabaseAdmin
      .from('zltac_registrations')
      .select('user_id')
      .eq('id', registrationId)
      .maybeSingle()
    if (regErr) return res.status(500).json({ error: regErr.message })
    if (!reg) return res.status(404).json({ error: 'Registration not found' })

    if (reg.user_id !== user.id) {
      const { data: profile } = await supabaseAdmin.from('profiles').select('roles').eq('id', user.id).maybeSingle()
      const roles = profile?.roles ?? []
      if (!roles.some(r => COMMITTEE_ROLES.includes(r))) return res.status(403).json({ error: 'Forbidden' })
    }

    const result = await computeAndWriteAmountOwing(registrationId)
    if (result.error) return res.status(500).json({ error: result.error })

    return res.json({ amountOwing: result.amountOwing })
  }

  return res.status(400).json({ error: `Unknown action: ${action}` })
}

// ── claimable / claim ───────────────────────────────────────────────────────
// Chunk 2 placeholder-claim flow. Two endpoints:
//   GET  ?resource=claimable → list placeholders that match the caller by
//                              alias or auth.users email (case-insensitive).
//   POST ?resource=claim     → merge a chosen placeholder into the caller via
//                              the claim_placeholder_profile RPC.
// The RPC has its own auth.uid() == real_id guard, so even a direct
// supabase.rpc() call from the browser is safe — but the API layer still
// uses supabaseAdmin so that cross-user reads work under RLS.

async function handleClaimable(req, res, user) {
  // Resolve the caller's alias (from profiles) and email (from auth.users) so
  // we can match against placeholders.alias and placeholders.placeholder_email.
  const { data: prof, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('alias')
    .eq('id', user.id)
    .maybeSingle()
  if (profErr) return res.status(500).json({ error: profErr.message })

  const callerAlias = (prof?.alias ?? '').trim()
  const callerEmail = (user.email ?? '').trim()
  if (!callerAlias && !callerEmail) return res.json({ matches: [] })

  // Pull every placeholder (small table) and match in JS — keeps the case-
  // insensitive comparison cheap and avoids two separate filtered queries.
  const { data: placeholders, error: phErr } = await supabaseAdmin
    .from('profiles')
    .select('id, alias, first_name, last_name, placeholder_email')
    .eq('is_placeholder', true)
  if (phErr) return res.status(500).json({ error: phErr.message })

  const lowerAlias = callerAlias.toLowerCase()
  const lowerEmail = callerEmail.toLowerCase()
  const matched = (placeholders ?? []).filter(p => {
    const a = (p.alias ?? '').toLowerCase()
    const e = (p.placeholder_email ?? '').toLowerCase()
    return (lowerAlias && a && a === lowerAlias) || (lowerEmail && e && e === lowerEmail)
  })
  if (!matched.length) return res.json({ matches: [] })

  // Hydrate each match with its registrations so the modal can show year +
  // payment ref + side events the caller is being asked to absorb.
  const matchedIds = matched.map(p => p.id)
  const { data: regs, error: regsErr } = await supabaseAdmin
    .from('zltac_registrations')
    .select('user_id, year, payment_reference, side_events')
    .in('user_id', matchedIds)
    .order('year', { ascending: false })
  if (regsErr) return res.status(500).json({ error: regsErr.message })

  const regsByUser = {}
  for (const r of (regs ?? [])) {
    ;(regsByUser[r.user_id] ??= []).push({
      year: r.year,
      payment_reference: r.payment_reference,
      side_events: r.side_events ?? [],
    })
  }

  const matches = matched.map(p => ({
    placeholder: {
      id: p.id,
      alias: p.alias,
      first_name: p.first_name,
      last_name: p.last_name,
      placeholder_email: p.placeholder_email,
    },
    registrations: regsByUser[p.id] ?? [],
  }))

  return res.json({ matches })
}

async function handleClaim(req, res, user) {
  const { placeholder_id } = req.body ?? {}
  if (!placeholder_id) return res.status(400).json({ error: 'placeholder_id is required' })

  // Verify the placeholder actually belongs to this caller before invoking the
  // RPC — mirrors the in-function ownership check so the rejection surfaces as
  // a clean 403 here rather than relying solely on the DB-layer guard.
  // Committee may bypass (matches the function's is_committee() bypass for the
  // admin manual-link flow).
  const { data: prof, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('alias, roles')
    .eq('id', user.id)
    .maybeSingle()
  if (profErr) return res.status(500).json({ error: profErr.message })

  const callerIsCommittee = (prof?.roles ?? []).some(r => COMMITTEE_ROLES.includes(r))

  if (!callerIsCommittee) {
    const { data: placeholder, error: phErr } = await supabaseAdmin
      .from('profiles')
      .select('alias, placeholder_email, is_placeholder')
      .eq('id', placeholder_id)
      .maybeSingle()
    if (phErr) return res.status(500).json({ error: phErr.message })
    if (!placeholder) return res.status(404).json({ error: 'placeholder not found' })
    if (!placeholder.is_placeholder) {
      return res.status(400).json({ error: 'profile is not a placeholder' })
    }

    const callerAlias = (prof?.alias ?? '').trim().toLowerCase()
    const callerEmail = (user.email ?? '').trim().toLowerCase()
    const phAlias = (placeholder.alias ?? '').trim().toLowerCase()
    const phEmail = (placeholder.placeholder_email ?? '').trim().toLowerCase()

    const aliasMatch = callerAlias && phAlias && callerAlias === phAlias
    const emailMatch = callerEmail && phEmail && callerEmail === phEmail
    if (!aliasMatch && !emailMatch) {
      return res.status(403).json({ error: 'placeholder does not belong to you' })
    }
  }

  const { data, error } = await supabaseAdmin.rpc('claim_placeholder_profile', {
    placeholder_id,
    real_id: user.id,
  })
  if (error) return res.status(500).json({ error: error.message })

  if (data && data.ok === false) {
    return res.status(400).json(data)
  }
  return res.json(data ?? { ok: true })
}

// ── Dispatch ────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const { user, error } = await verifyUser(req)
  if (error) return res.status(401).json({ error })

  const resource = req.query.resource

  const action = req.body?.action
  const rateConfig = resource === 'claim'
    ? { limit: 5, window: '10 m', prefix: 'placeholder-claim' }
    : resource === 'claimable'
      ? { limit: 30, window: '1 m', prefix: 'placeholder-discovery' }
      : (resource === 'doubles' || resource === 'triples') && action === 'search'
        ? { limit: 30, window: '1 m', prefix: 'partner-search' }
        : null
  if (rateConfig && !await enforceRateLimit(req, res, {
    identifier: user.id,
    requireDistributed: true,
    ...rateConfig,
  })) return

  // GET endpoints
  if (req.method === 'GET') {
    if (resource === 'claimable') return handleClaimable(req, res, user)
    return res.status(400).json({ error: 'resource query param must be "claimable" for GET' })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (resource === 'doubles')      return handleDoubles(req, res, user)
  if (resource === 'triples')      return handleTriples(req, res, user)
  if (resource === 'registration') return handleRegistration(req, res, user)
  if (resource === 'claim')        return handleClaim(req, res, user)
  return res.status(400).json({ error: 'resource query param must be "doubles", "triples", "registration", or "claim"' })
}
