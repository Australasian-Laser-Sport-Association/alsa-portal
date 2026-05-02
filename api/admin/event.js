import supabaseAdmin from '../_lib/supabase.js'
import { verifyCommittee, statusForAuthError } from '../_lib/auth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { error: authErr } = await verifyCommittee(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  const { action, eventId, year } = req.body ?? {}
  if (!action || !eventId || !year) {
    return res.status(400).json({ error: 'action, eventId, and year are required' })
  }

  if (action === 'archive') {
    // Fetch source event
    const { data: ev, error: evErr } = await supabaseAdmin
      .from('zltac_events')
      .select('id, year, name, start_date, end_date, description, logo_url, location, venue, status')
      .eq('id', eventId)
      .maybeSingle()
    if (evErr) return res.status(500).json({ error: evErr.message })
    if (!ev) return res.status(404).json({ error: 'Event not found' })

    // Skip history insert if a row already exists for this year
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

    // If this update fails after a fresh history insert, the history row
    // becomes a temporary orphan. Acceptable for now — admin can edit or
    // delete via the Event History page. No rollback wrapper for now.
    const { error: updErr } = await supabaseAdmin
      .from('zltac_events')
      .update({ status: 'archived' })
      .eq('id', eventId)
    if (updErr) return res.status(500).json({ error: updErr.message })

    return res.json({ ok: true, historySkipped, historyId })
  }

  if (action === 'delete') {
    // Wipe year-keyed satellite data first (no FK to zltac_events.year).
    // Order matters only for foreign-key chains; year-keyed deletes are independent.
    const yearScopedTables = [
      'code_of_conduct_signatures',
      'payments',
      'under18_submissions',
      'media_release_submissions',
      'doubles_pairs',
      'triples_teams',
    ]
    for (const table of yearScopedTables) {
      const { error: delErr } = await supabaseAdmin.from(table).delete().eq('event_year', year)
      if (delErr) return res.status(500).json({ error: `${table}: ${delErr.message}` })
    }

    // Delete registrations next.
    const { error: regDelErr } = await supabaseAdmin
      .from('zltac_registrations')
      .delete()
      .eq('year', year)
    if (regDelErr) return res.status(500).json({ error: regDelErr.message })

    // Delete the event itself — cascades to teams (event_id), which cascades to team_members.
    const { error: evDelErr } = await supabaseAdmin
      .from('zltac_events')
      .delete()
      .eq('id', eventId)
    if (evDelErr) return res.status(500).json({ error: evDelErr.message })

    return res.json({ ok: true })
  }

  return res.status(400).json({ error: `Unknown action: ${action}` })
}
