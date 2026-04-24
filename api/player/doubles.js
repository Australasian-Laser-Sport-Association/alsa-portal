import supabaseAdmin from '../_lib/supabase.js'
import { verifyUser } from '../_lib/auth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { user, error } = await verifyUser(req)
  if (error) return res.status(401).json({ error })

  const body = req.body ?? {}
  const { action } = body

  // ── Search available doubles partners ──────────────────────────────────────
  if (action === 'search') {
    const { eventYear, term } = body
    if (!eventYear || !term) return res.status(400).json({ error: 'eventYear and term are required' })

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
      .select('id, first_name, last_name, alias, state')
      .in('id', availableIds)
      .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,alias.ilike.%${term}%`)

    if (profsErr) return res.status(500).json({ error: profsErr.message })
    if (!profs?.length) return res.json({ results: [] })

    const profIds = profs.map(p => p.id)
    const { data: teamRegs, error: teamRegsErr } = await supabaseAdmin
      .from('zltac_registrations')
      .select('user_id, teams(name)')
      .eq('year', eventYear)
      .in('user_id', profIds)

    if (teamRegsErr) return res.status(500).json({ error: teamRegsErr.message })

    const teamMap = Object.fromEntries((teamRegs ?? []).map(r => [r.user_id, r.teams?.name ?? null]))
    return res.json({ results: profs.map(p => ({ ...p, teamName: teamMap[p.id] ?? null })) })
  }

  // ── Create doubles pair (invite partner) ───────────────────────────────────
  if (action === 'create') {
    const { eventYear, partnerId } = body
    if (!eventYear || !partnerId) return res.status(400).json({ error: 'eventYear and partnerId are required' })

    const { data: record, error: insertErr } = await supabaseAdmin
      .from('doubles_pairs')
      .insert({ event_year: eventYear, player1_id: user.id, player2_id: partnerId, confirmed: false })
      .select()
      .single()

    if (insertErr) return res.status(500).json({ error: insertErr.message })

    // Add 'doubles' to partner's side_events
    const { data: partnerReg, error: partnerRegErr } = await supabaseAdmin
      .from('zltac_registrations')
      .select('side_events')
      .eq('user_id', partnerId)
      .eq('year', eventYear)
      .maybeSingle()

    if (partnerRegErr) return res.status(500).json({ error: partnerRegErr.message })

    if (partnerReg) {
      const newSlugs = [...new Set([...(partnerReg.side_events ?? []), 'doubles'])]
      const { error: sideErr } = await supabaseAdmin
        .from('zltac_registrations')
        .update({ side_events: newSlugs })
        .eq('user_id', partnerId)
        .eq('year', eventYear)
      if (sideErr) return res.status(500).json({ error: sideErr.message })
    }

    return res.json({ record })
  }

  // ── Confirm doubles pair (accept invitation) ───────────────────────────────
  if (action === 'confirm') {
    const { id } = body
    if (!id) return res.status(400).json({ error: 'id is required' })

    const { data: pair, error: pairErr } = await supabaseAdmin.from('doubles_pairs').select('*').eq('id', id).maybeSingle()
    if (pairErr) return res.status(500).json({ error: pairErr.message })
    if (!pair) return res.status(404).json({ error: 'Pair not found' })
    if (pair.player2_id !== user.id) return res.status(403).json({ error: 'Not a party to this pair' })

    const { data: record, error: updateErr } = await supabaseAdmin
      .from('doubles_pairs')
      .update({ confirmed: true })
      .eq('id', id)
      .select()
      .single()

    if (updateErr) return res.status(500).json({ error: updateErr.message })
    return res.json({ record })
  }

  // ── Delete doubles pair ────────────────────────────────────────────────────
  if (action === 'delete') {
    const { id } = body
    if (!id) return res.status(400).json({ error: 'id is required' })

    const { data: pair, error: pairErr } = await supabaseAdmin.from('doubles_pairs').select('player1_id, player2_id').eq('id', id).maybeSingle()
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
