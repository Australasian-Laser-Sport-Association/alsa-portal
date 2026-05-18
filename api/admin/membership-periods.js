import supabaseAdmin from '../_lib/supabase.js'
import { verifyCommittee, statusForAuthError } from '../_lib/auth.js'

// Committee-gated CRUD for alsa_membership_periods.
//   GET                 → list all periods, newest first
//   POST                → create { label, starts_at, ends_at }
//   PATCH ?id=<id>      → update { label?, starts_at?, ends_at? }
//   DELETE ?id=<id>     → delete (FK ON DELETE RESTRICT prevents removing
//                         periods with memberships attached)
//
// Overlap rule: on POST/PATCH, reject if the new [starts_at, ends_at) range
// overlaps any *other* period. This keeps "current period" unambiguous.

async function findOverlap(starts_at, ends_at, excludeId = null) {
  let q = supabaseAdmin
    .from('alsa_membership_periods')
    .select('id, label, starts_at, ends_at')
    .lt('starts_at', ends_at)
    .gt('ends_at', starts_at)
  if (excludeId) q = q.neq('id', excludeId)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

function validDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
}

export default async function handler(req, res) {
  const { error: authErr } = await verifyCommittee(req)
  if (authErr) return res.status(statusForAuthError(authErr)).json({ error: authErr })

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('alsa_membership_periods')
      .select('id, label, starts_at, ends_at, created_at')
      .order('starts_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ periods: data ?? [] })
  }

  if (req.method === 'POST') {
    const { label, starts_at, ends_at } = req.body ?? {}
    if (!label || typeof label !== 'string' || !label.trim()) {
      return res.status(400).json({ error: 'label is required' })
    }
    if (!validDate(starts_at) || !validDate(ends_at)) {
      return res.status(400).json({ error: 'starts_at and ends_at must be YYYY-MM-DD' })
    }
    if (ends_at <= starts_at) {
      return res.status(400).json({ error: 'ends_at must be after starts_at' })
    }

    try {
      const overlaps = await findOverlap(starts_at, ends_at)
      if (overlaps.length > 0) {
        return res.status(409).json({
          error: `Overlaps with existing period "${overlaps[0].label}" (${overlaps[0].starts_at} → ${overlaps[0].ends_at})`,
          overlaps,
        })
      }
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }

    const { data, error } = await supabaseAdmin
      .from('alsa_membership_periods')
      .insert({ label: label.trim(), starts_at, ends_at })
      .select('id, label, starts_at, ends_at, created_at')
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ period: data })
  }

  if (req.method === 'PATCH') {
    const id = req.query.id
    if (!id) return res.status(400).json({ error: 'id is required' })

    const { label, starts_at, ends_at } = req.body ?? {}
    const update = {}
    if (label !== undefined) {
      if (typeof label !== 'string' || !label.trim()) {
        return res.status(400).json({ error: 'label cannot be empty' })
      }
      update.label = label.trim()
    }
    if (starts_at !== undefined) {
      if (!validDate(starts_at)) return res.status(400).json({ error: 'starts_at must be YYYY-MM-DD' })
      update.starts_at = starts_at
    }
    if (ends_at !== undefined) {
      if (!validDate(ends_at)) return res.status(400).json({ error: 'ends_at must be YYYY-MM-DD' })
      update.ends_at = ends_at
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'no fields to update' })
    }

    // If dates are changing, resolve effective range and check overlap.
    if (update.starts_at !== undefined || update.ends_at !== undefined) {
      const { data: existing, error: exErr } = await supabaseAdmin
        .from('alsa_membership_periods')
        .select('starts_at, ends_at')
        .eq('id', id)
        .maybeSingle()
      if (exErr) return res.status(500).json({ error: exErr.message })
      if (!existing) return res.status(404).json({ error: 'Period not found' })

      const effStart = update.starts_at ?? existing.starts_at
      const effEnd   = update.ends_at   ?? existing.ends_at
      if (effEnd <= effStart) {
        return res.status(400).json({ error: 'ends_at must be after starts_at' })
      }
      try {
        const overlaps = await findOverlap(effStart, effEnd, id)
        if (overlaps.length > 0) {
          return res.status(409).json({
            error: `Overlaps with existing period "${overlaps[0].label}" (${overlaps[0].starts_at} → ${overlaps[0].ends_at})`,
            overlaps,
          })
        }
      } catch (e) {
        return res.status(500).json({ error: e.message })
      }
    }

    const { data, error } = await supabaseAdmin
      .from('alsa_membership_periods')
      .update(update)
      .eq('id', id)
      .select('id, label, starts_at, ends_at, created_at')
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ period: data })
  }

  if (req.method === 'DELETE') {
    const id = req.query.id
    if (!id) return res.status(400).json({ error: 'id is required' })
    const { error } = await supabaseAdmin
      .from('alsa_membership_periods')
      .delete()
      .eq('id', id)
    if (error) {
      if (error.code === '23503') {
        return res.status(409).json({ error: 'Cannot delete a period that has memberships. Remove the memberships first.' })
      }
      return res.status(500).json({ error: error.message })
    }
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
