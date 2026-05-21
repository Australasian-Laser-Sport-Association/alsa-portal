import supabaseAdmin from './_lib/supabase.js'
import { verifyUser } from './_lib/auth.js'
import { COMMITTEE_ROLES } from '../src/lib/roles.js'
import { computeAndWriteAmountOwing } from './_lib/computeAmountOwing.js'
import { requireOpenPhase, getEventPhase } from './_lib/eventPhase.js'

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

// ── helpers ─────────────────────────────────────────────────────────────────

async function addPartnerSideEventForTriples(partnerId, eventYear) {
  const { data: reg, error: regErr } = await supabaseAdmin
    .from('zltac_registrations')
    .select('id, side_events')
    .eq('user_id', partnerId)
    .eq('year', eventYear)
    .maybeSingle()
  if (regErr) return { error: regErr }
  if (reg) {
    const newSlugs = [...new Set([...(reg.side_events ?? []), 'triples'])]
    const { error: updErr } = await supabaseAdmin
      .from('zltac_registrations')
      .update({ side_events: newSlugs })
      .eq('id', reg.id)
    if (updErr) return { error: updErr }
    await computeAndWriteAmountOwing(reg.id)
  }
  return { error: null }
}

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

    const { data: record, error: insertErr } = await supabaseAdmin
      .from('doubles_pairs')
      .insert({ event_year: eventYear, player1_id: user.id, player2_id: partnerId, confirmed: false })
      .select()
      .single()

    if (insertErr) return res.status(500).json({ error: insertErr.message })

    return res.json({ record })
  }

  if (action === 'confirm') {
    const { id } = body
    if (!id) return res.status(400).json({ error: 'id is required' })

    const { data: pair, error: pairErr } = await supabaseAdmin.from('doubles_pairs').select('*').eq('id', id).maybeSingle()
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

    const { data: myReg, error: myRegErr } = await supabaseAdmin
      .from('zltac_registrations')
      .select('id, side_events')
      .eq('user_id', user.id)
      .eq('year', pair.event_year)
      .maybeSingle()
    if (myRegErr) return res.status(500).json({ error: myRegErr.message })
    if (myReg) {
      const newSlugs = [...new Set([...(myReg.side_events ?? []), 'doubles'])]
      const { error: sideErr } = await supabaseAdmin
        .from('zltac_registrations')
        .update({ side_events: newSlugs })
        .eq('id', myReg.id)
      if (sideErr) return res.status(500).json({ error: sideErr.message })
      await computeAndWriteAmountOwing(myReg.id)
    }

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

    const { data: record, error: insertErr } = await supabaseAdmin
      .from('triples_teams')
      .insert({
        event_year: eventYear,
        player1_id: user.id,
        [`player${slot}_id`]: partnerId,
        confirmed: false,
        player2_confirmed: false,
        player3_confirmed: false,
      })
      .select()
      .single()

    if (insertErr) return res.status(500).json({ error: insertErr.message })
    return res.json({ record })
  }

  if (action === 'add-slot') {
    const { id, slot, partnerId } = body
    if (slot !== 2 && slot !== 3) return res.status(400).json({ error: 'slot must be 2 or 3' })
    if (!id || !slot || !partnerId) return res.status(400).json({ error: 'id, slot and partnerId are required' })

    const { data: existing, error: existingErr } = await supabaseAdmin.from('triples_teams').select('player1_id, event_year').eq('id', id).maybeSingle()
    if (existingErr) return res.status(500).json({ error: existingErr.message })
    if (!existing || existing.player1_id !== user.id) return res.status(403).json({ error: 'Only the team creator can add players' })

    const { data: record, error: updateErr } = await supabaseAdmin
      .from('triples_teams')
      .update({ [`player${slot}_id`]: partnerId, [`player${slot}_confirmed`]: false, confirmed: false })
      .eq('id', id)
      .select()
      .single()

    if (updateErr) return res.status(500).json({ error: updateErr.message })
    return res.json({ record })
  }

  if (action === 'confirm') {
    const { id, mySlot } = body
    if (!id || !mySlot) return res.status(400).json({ error: 'id and mySlot are required' })

    const { data: existing, error: existingErr } = await supabaseAdmin.from('triples_teams').select('*').eq('id', id).maybeSingle()
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

    const { data: myReg, error: myRegErr } = await supabaseAdmin
      .from('zltac_registrations')
      .select('id, side_events')
      .eq('user_id', user.id)
      .eq('year', existing.event_year)
      .maybeSingle()
    if (myRegErr) return res.status(500).json({ error: myRegErr.message })
    if (myReg) {
      const newSlugs = [...new Set([...(myReg.side_events ?? []), 'triples'])]
      const { error: sideErr } = await supabaseAdmin
        .from('zltac_registrations')
        .update({ side_events: newSlugs })
        .eq('id', myReg.id)
      if (sideErr) return res.status(500).json({ error: sideErr.message })
      await computeAndWriteAmountOwing(myReg.id)
    }

    return res.json({ record })
  }

  if (action === 'clear-slot') {
    const { id, slot } = body
    if (slot !== 2 && slot !== 3) return res.status(400).json({ error: 'slot must be 2 or 3' })
    if (!id || !slot) return res.status(400).json({ error: 'id and slot are required' })

    const { data: existing, error: existingErr } = await supabaseAdmin.from('triples_teams').select('player1_id, event_year').eq('id', id).maybeSingle()
    if (existingErr) return res.status(500).json({ error: existingErr.message })
    if (!existing || existing.player1_id !== user.id) return res.status(403).json({ error: 'Only the team creator can clear slots' })

    const { data: record, error: updateErr } = await supabaseAdmin
      .from('triples_teams')
      .update({ [`player${slot}_id`]: null, [`player${slot}_confirmed`]: false, confirmed: false })
      .eq('id', id)
      .select()
      .single()

    if (updateErr) return res.status(500).json({ error: updateErr.message })
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
    return res.json({ ok: true })
  }

  return res.status(400).json({ error: `Unknown action: ${action}` })
}

// ── registration ────────────────────────────────────────────────────────────

async function handleRegistration(req, res, user) {
  const body = req.body ?? {}
  const { action } = body

  if (action === 'precheck-register') {
    // Cap-check used by PlayerRegister / CaptainRegister before inserting
    // a new registration row. Returns 400 with a user-facing message when
    // the event would exceed max_players. Null cap = no limit. Already
    // registered = no-op for cap purposes (upsert is idempotent count-wise).
    const { year } = body
    if (!year) return res.status(400).json({ error: 'year is required' })

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

// ── Dispatch ────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error } = await verifyUser(req)
  if (error) return res.status(401).json({ error })

  const resource = req.query.resource
  if (resource === 'doubles')      return handleDoubles(req, res, user)
  if (resource === 'triples')      return handleTriples(req, res, user)
  if (resource === 'registration') return handleRegistration(req, res, user)
  return res.status(400).json({ error: 'resource query param must be "doubles", "triples", or "registration"' })
}
