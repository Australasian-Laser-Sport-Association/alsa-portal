import supabaseAdmin from '../_lib/supabase.js'
import { verifyCommittee, statusForAuthError } from '../_lib/auth.js'
import { computeAndWriteAmountOwing } from '../_lib/computeAmountOwing.js'

export default async function handler(req, res) {
  const { error } = await verifyCommittee(req)
  if (error) return res.status(statusForAuthError(error)).json({ error })

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
      supabaseAdmin.from('zltac_registrations').select('id, user_id, team_id, year, status, created_at, side_events, dinner_guests, amount_owing, payment_reference').eq('year', year).order('created_at', { ascending: false }),
      supabaseAdmin.from('profiles').select('id, first_name, last_name, alias, state'),
      supabaseAdmin.from('teams').select('id, name, state, status, captain_id, created_at'),
      supabaseAdmin
        .from('legal_acceptances')
        .select('user_id, accepted_at, document:legal_documents!document_id(document_type)')
        .eq('event_year', year),
      supabaseAdmin.from('referee_test_results').select('user_id, passed, score'),
      supabaseAdmin.from('payment_records')
        .select('id, registration_id, amount, recorded_at, recorded_by, bank_reference, notes, zltac_registrations!inner(year)')
        .eq('zltac_registrations.year', year),
      supabaseAdmin.from('doubles_pairs').select('*').eq('event_year', year).order('created_at', { ascending: false }),
      supabaseAdmin.from('triples_teams').select('*').eq('event_year', year).order('created_at', { ascending: false }),
    ])

    const errs = [e1, e2, e3, e4, e5, e7, e8, e9].filter(Boolean)
    if (errs.length) return res.status(500).json({ error: errs.map(e => e.message).join(' | ') })

    // Preserve the response shape AdminRegistrations.jsx consumes:
    // coc_sigs and media_releases are arrays of { user_id, ... } used to build
    // completion Sets keyed by user_id.
    const coc_sigs = (acceptances ?? [])
      .filter(a => a.document?.document_type === 'code_of_conduct')
      .map(a => ({ user_id: a.user_id, signed_at: a.accepted_at }))
    const media_releases = (acceptances ?? [])
      .filter(a => a.document?.document_type === 'media_release')
      .map(a => ({ user_id: a.user_id, submitted_at: a.accepted_at }))

    // Strip the zltac_registrations embed (used only for year-filtering).
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
    // Committee-driven edit of a single registration. Bypasses the phase
    // guard (admin can edit in any phase). Recomputes amount_owing after
    // applying changes and returns the new balance for the success toast.
    //
    // Accepted body:
    //   {
    //     registrationId: uuid (required),
    //     side_events?: string[],           // overwrite slug list
    //     team_id?: uuid | null,            // null = no team
    //     doubles_partner_id?: uuid | null, // null = no doubles partner
    //     triples_partner_ids?: [p2: uuid|null, p3: uuid|null],
    //     admin_note?: string | null,
    //   }
    const body = req.body ?? {}
    const { registrationId } = body
    if (!registrationId) return res.status(400).json({ error: 'registrationId is required' })

    // Load the registration we're editing to get user_id + event_year.
    const { data: reg, error: regErr } = await supabaseAdmin
      .from('zltac_registrations')
      .select('id, user_id, year, side_events, team_id, admin_note')
      .eq('id', registrationId)
      .maybeSingle()
    if (regErr) return res.status(500).json({ error: regErr.message })
    if (!reg) return res.status(404).json({ error: 'Registration not found' })

    const updates = {}
    if (Array.isArray(body.side_events)) updates.side_events = body.side_events
    if ('team_id' in body) updates.team_id = body.team_id || null
    if ('admin_note' in body) updates.admin_note = body.admin_note?.trim() || null

    if (Object.keys(updates).length > 0) {
      const { error: updErr } = await supabaseAdmin
        .from('zltac_registrations')
        .update(updates)
        .eq('id', registrationId)
      if (updErr) return res.status(500).json({ error: updErr.message })
    }

    // Doubles partner sync. Clear-and-replace semantics: any existing pair
    // for this user is removed, plus any pair the new partner is already in
    // (UNIQUE constraint on player1_id and player2_id per event year).
    if ('doubles_partner_id' in body) {
      const newPartnerId = body.doubles_partner_id || null
      const { error: clearErr } = await supabaseAdmin
        .from('doubles_pairs')
        .delete()
        .eq('event_year', reg.year)
        .or(`player1_id.eq.${reg.user_id},player2_id.eq.${reg.user_id}`)
      if (clearErr) return res.status(500).json({ error: `doubles clear: ${clearErr.message}` })

      if (newPartnerId) {
        // Also clear any existing pair the new partner might be part of.
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

    // Triples partner sync. Same clear-and-replace approach. Triples has no
    // UNIQUE constraint so the cleanup is less strict, but we still clear
    // any existing team containing this player before re-inserting.
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

    // Recompute amount_owing now that team_id / side_events may have shifted.
    const { amountOwing, error: recErr } = await computeAndWriteAmountOwing(registrationId)
    if (recErr) return res.status(500).json({ error: `recompute: ${recErr}` })

    // Fresh payment_records sum so the client can render the new balance.
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
    const { resource, id, userId, year } = req.body ?? {}

    if (resource === 'doubles') {
      if (!id) return res.status(400).json({ error: 'id is required' })
      const { error: delErr } = await supabaseAdmin.from('doubles_pairs').delete().eq('id', id)
      if (delErr) return res.status(500).json({ error: delErr.message })
      return res.json({ ok: true })
    }

    if (resource === 'triples') {
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

  return res.status(405).json({ error: 'Method not allowed' })
}
