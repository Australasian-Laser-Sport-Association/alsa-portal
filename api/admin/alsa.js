import supabaseAdmin from '../_lib/supabase.js'
import { verifyCommittee, statusForAuthError } from '../_lib/auth.js'
import { sendServerError } from '../_lib/apiErrors.js'

// Committee-gated CRUD for ALSA membership data. Destructive deletes require
// superadmin. Dispatches by ?resource=:
//   ?resource=members          → memberships    (GET grouped / POST grant / DELETE by id)
//   ?resource=lifetime-members → lifetime member status (GET / POST grant / DELETE by profile_id)
//   ?resource=periods          → period windows (GET list / POST create / PATCH update / DELETE by id)
//
// Consolidated from api/admin/members.js + api/admin/membership-periods.js
// to stay under the Vercel Hobby function cap.

// ── Helpers ─────────────────────────────────────────────────────────────────

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

function sortProfiles(a, b) {
  return (a.profiles?.alias ?? a.profiles?.first_name ?? '')
    .localeCompare(b.profiles?.alias ?? b.profiles?.first_name ?? '')
}

// ── Members handler ─────────────────────────────────────────────────────────

async function handleMembers(req, res, user) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('alsa_memberships')
      .select(`
        id, profile_id, period_id, payment_reference, notes, created_at, created_by,
        profiles:profile_id (id, first_name, last_name, alias, avatar_url),
        period:alsa_membership_periods!inner (id, label, starts_at, ends_at)
      `)
      .order('created_at', { ascending: false })

    if (error) return sendServerError(res, error, 'admin-alsa:members-list')

    const today = new Date().toISOString().slice(0, 10)
    const threeMoAgo = new Date()
    threeMoAgo.setMonth(threeMoAgo.getMonth() - 3)
    const cutoff = threeMoAgo.toISOString().slice(0, 10)

    const active = []
    const recently_expired = []
    const long_expired = []

    for (const row of (data ?? [])) {
      const startsAt = row.period?.starts_at
      const endsAt = row.period?.ends_at
      if (!startsAt || !endsAt) continue
      if (startsAt <= today && endsAt > today) active.push(row)
      else if (endsAt <= today && endsAt > cutoff) recently_expired.push(row)
      else if (endsAt <= cutoff) long_expired.push(row)
      // Periods starting in the future (startsAt > today) fall through —
      // they're not yet active, not expired. Not currently surfaced in any bucket.
    }

    return res.json({ active, recently_expired, long_expired })
  }

  if (req.method === 'POST') {
    const { profile_id, period_id, payment_reference, notes } = req.body ?? {}
    if (!profile_id || !period_id) {
      return res.status(400).json({ error: 'profile_id and period_id are required' })
    }

    const insertRow = {
      profile_id,
      period_id,
      payment_reference: typeof payment_reference === 'string' && payment_reference.trim() ? payment_reference.trim() : null,
      notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
      created_by: user.id,
    }

    const { data, error } = await supabaseAdmin
      .from('alsa_memberships')
      .insert(insertRow)
      .select(`
        id, profile_id, period_id, payment_reference, notes, created_at, created_by,
        profiles:profile_id (id, first_name, last_name, alias, avatar_url),
        period:alsa_membership_periods!inner (id, label, starts_at, ends_at)
      `)
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'This member already has a membership for that period.' })
      }
      return sendServerError(res, error, 'admin-alsa:member-create')
    }
    return res.json({ membership: data })
  }

  if (req.method === 'DELETE') {
    const id = req.query.id
    if (!id) return res.status(400).json({ error: 'id is required' })

    const { error } = await supabaseAdmin.from('alsa_memberships').delete().eq('id', id)
    if (error) {
      if (error.code === '23503') {
        return res.status(409).json({ error: 'Cannot remove this membership because it is referenced by other records.' })
      }
      return sendServerError(res, error, 'admin-alsa:member-delete')
    }
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// ── Lifetime members handler ────────────────────────────────────────────────

async function handleLifetimeMembers(req, res, user) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('alsa_lifetime_members')
      .select(`
        profile_id, granted_at, granted_by, notes,
        profiles:profile_id (id, first_name, last_name, alias, avatar_url)
      `)
      .order('granted_at', { ascending: false })

    if (error) return sendServerError(res, error, 'admin-alsa:lifetime-list')
    return res.json({ lifetime_members: (data ?? []).slice().sort(sortProfiles) })
  }

  if (req.method === 'POST') {
    const { profile_id, notes } = req.body ?? {}
    if (!profile_id) return res.status(400).json({ error: 'profile_id is required' })

    const { data, error } = await supabaseAdmin
      .from('alsa_lifetime_members')
      .upsert({
        profile_id,
        granted_by: user.id,
        notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
      }, { onConflict: 'profile_id' })
      .select(`
        profile_id, granted_at, granted_by, notes,
        profiles:profile_id (id, first_name, last_name, alias, avatar_url)
      `)
      .single()

    if (error) return sendServerError(res, error, 'admin-alsa:lifetime-grant')
    return res.json({ lifetime_member: data })
  }

  if (req.method === 'DELETE') {
    const profileId = req.query.profile_id
    if (!profileId) return res.status(400).json({ error: 'profile_id is required' })

    const { error } = await supabaseAdmin
      .from('alsa_lifetime_members')
      .delete()
      .eq('profile_id', profileId)
    if (error) {
      if (error.code === '23503') {
        return res.status(409).json({ error: 'Cannot remove this lifetime membership because it is referenced by other records.' })
      }
      return sendServerError(res, error, 'admin-alsa:lifetime-delete')
    }
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// ── Periods handler ─────────────────────────────────────────────────────────

async function handlePeriods(req, res) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('alsa_membership_periods')
      .select('id, label, starts_at, ends_at, created_at')
      .order('starts_at', { ascending: false })
    if (error) return sendServerError(res, error, 'admin-alsa:period-list')
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
    } catch (error) {
      return sendServerError(res, error, 'admin-alsa:period-overlap-check')
    }

    const { data, error } = await supabaseAdmin
      .from('alsa_membership_periods')
      .insert({ label: label.trim(), starts_at, ends_at })
      .select('id, label, starts_at, ends_at, created_at')
      .single()

    if (error) return sendServerError(res, error, 'admin-alsa:period-create')
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

    if (update.starts_at !== undefined || update.ends_at !== undefined) {
      const { data: existing, error: exErr } = await supabaseAdmin
        .from('alsa_membership_periods')
        .select('starts_at, ends_at')
        .eq('id', id)
        .maybeSingle()
      if (exErr) return sendServerError(res, exErr, 'admin-alsa:period-load')
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
      } catch (error) {
        return sendServerError(res, error, 'admin-alsa:period-overlap-check')
      }
    }

    const { data, error } = await supabaseAdmin
      .from('alsa_membership_periods')
      .update(update)
      .eq('id', id)
      .select('id, label, starts_at, ends_at, created_at')
      .single()
    if (error) return sendServerError(res, error, 'admin-alsa:period-update')
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
      return sendServerError(res, error, 'admin-alsa:period-delete')
    }
    return res.json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

// ── Dispatch ────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  try {
    const { user, roles, error: authErr } = await verifyCommittee(req)
    if (authErr) {
      const status = statusForAuthError(authErr)
      if (status === 500) return sendServerError(res, new Error(authErr), 'admin-alsa:auth')
      return res.status(status).json({ error: authErr })
    }

    const resource = req.query.resource
    if (!['members', 'lifetime-members', 'periods'].includes(resource)) {
      return res.status(400).json({ error: 'resource query param must be "members", "lifetime-members", or "periods"' })
    }
    if (req.method === 'DELETE' && !roles?.includes('superadmin')) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    if (resource === 'members') return await handleMembers(req, res, user)
    if (resource === 'lifetime-members') return await handleLifetimeMembers(req, res, user)
    return await handlePeriods(req, res, user)
  } catch (error) {
    return sendServerError(res, error, 'admin-alsa')
  }
}
