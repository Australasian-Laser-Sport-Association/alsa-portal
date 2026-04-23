import supabaseAdmin from '../_lib/supabase.js'
import { verifyUser } from '../_lib/auth.js'

async function addPartnerSideEvent(partnerId, eventYear) {
  const { data: reg } = await supabaseAdmin
    .from('zltac_registrations')
    .select('side_events')
    .eq('user_id', partnerId)
    .eq('year', eventYear)
    .single()
  if (reg) {
    const newSlugs = [...new Set([...(reg.side_events ?? []), 'triples'])]
    await supabaseAdmin
      .from('zltac_registrations')
      .update({ side_events: newSlugs })
      .eq('user_id', partnerId)
      .eq('year', eventYear)
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error } = await verifyUser(req)
  if (error) return res.status(401).json({ error })

  const body = req.body ?? {}
  const { action } = body

  // ── Search available triples players ───────────────────────────────────────
  if (action === 'search') {
    const { eventYear, term, existingPlayer2Id, existingPlayer3Id } = body
    if (!eventYear || !term) return res.status(400).json({ error: 'eventYear and term are required' })

    const { data: eligible } = await supabaseAdmin
      .from('zltac_registrations')
      .select('user_id')
      .eq('year', eventYear)
      .neq('user_id', user.id)

    let eligibleIds = (eligible ?? []).map(r => r.user_id)
      .filter(id => id !== existingPlayer2Id && id !== existingPlayer3Id)

    if (!eligibleIds.length) return res.json({ results: [] })

    const { data: existingTriples } = await supabaseAdmin
      .from('triples_teams')
      .select('player1_id, player2_id, player3_id')
      .eq('event_year', eventYear)

    const takenIds = new Set()
    existingTriples?.forEach(t => {
      if (t.player1_id) takenIds.add(t.player1_id)
      if (t.player2_id) takenIds.add(t.player2_id)
      if (t.player3_id) takenIds.add(t.player3_id)
    })

    const availableIds = eligibleIds.filter(id => !takenIds.has(id))
    if (!availableIds.length) return res.json({ results: [] })

    const { data: profs } = await supabaseAdmin
      .from('profiles')
      .select('id, first_name, last_name, alias, state')
      .in('id', availableIds)
      .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,alias.ilike.%${term}%`)

    if (!profs?.length) return res.json({ results: [] })

    const profIds = profs.map(p => p.id)
    const { data: teamRegs } = await supabaseAdmin
      .from('zltac_registrations')
      .select('user_id, teams(name)')
      .eq('year', eventYear)
      .in('user_id', profIds)

    const teamMap = Object.fromEntries((teamRegs ?? []).map(r => [r.user_id, r.teams?.name ?? null]))
    return res.json({ results: profs.map(p => ({ ...p, teamName: teamMap[p.id] ?? null })) })
  }

  // ── Create triples team ────────────────────────────────────────────────────
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
    await addPartnerSideEvent(partnerId, eventYear)
    return res.json({ record })
  }

  // ── Add player to an existing slot ────────────────────────────────────────
  if (action === 'add-slot') {
    const { id, slot, partnerId, eventYear } = body
    if (!id || !slot || !partnerId) return res.status(400).json({ error: 'id, slot and partnerId are required' })

    const { data: existing } = await supabaseAdmin.from('triples_teams').select('player1_id').eq('id', id).single()
    if (!existing || existing.player1_id !== user.id) return res.status(403).json({ error: 'Only the team creator can add players' })

    const { data: record, error: updateErr } = await supabaseAdmin
      .from('triples_teams')
      .update({ [`player${slot}_id`]: partnerId, [`player${slot}_confirmed`]: false, confirmed: false })
      .eq('id', id)
      .select()
      .single()

    if (updateErr) return res.status(500).json({ error: updateErr.message })
    await addPartnerSideEvent(partnerId, eventYear)
    return res.json({ record })
  }

  // ── Confirm participation ─────────────────────────────────────────────────
  if (action === 'confirm') {
    const { id, mySlot } = body
    if (!id || !mySlot) return res.status(400).json({ error: 'id and mySlot are required' })

    const { data: existing } = await supabaseAdmin.from('triples_teams').select('*').eq('id', id).single()
    if (!existing) return res.status(404).json({ error: 'Team not found' })

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
    return res.json({ record })
  }

  // ── Clear a slot ──────────────────────────────────────────────────────────
  if (action === 'clear-slot') {
    const { id, slot } = body
    if (!id || !slot) return res.status(400).json({ error: 'id and slot are required' })

    const { data: existing } = await supabaseAdmin.from('triples_teams').select('player1_id').eq('id', id).single()
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

  // ── Disband triples team ──────────────────────────────────────────────────
  if (action === 'disband') {
    const { id } = body
    if (!id) return res.status(400).json({ error: 'id is required' })

    const { data: existing } = await supabaseAdmin
      .from('triples_teams')
      .select('player1_id, player2_id, player3_id')
      .eq('id', id)
      .single()

    if (!existing) return res.status(404).json({ error: 'Team not found' })

    const isParty = [existing.player1_id, existing.player2_id, existing.player3_id].includes(user.id)
    if (!isParty) return res.status(403).json({ error: 'Not a party to this team' })

    const { error: delErr } = await supabaseAdmin.from('triples_teams').delete().eq('id', id)
    if (delErr) return res.status(500).json({ error: delErr.message })
    return res.json({ ok: true })
  }

  return res.status(400).json({ error: `Unknown action: ${action}` })
}
