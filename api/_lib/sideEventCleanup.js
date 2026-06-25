import supabaseAdmin from './supabase.js'
import { computeAndWriteAmountOwing, computeAndWriteAmountOwingMany } from './computeAmountOwing.js'

// When a doubles pair / triples team is dissolved, a former member who is no
// longer in ANY pair/team row (confirmed or pending) for that event_year must
// lose the side event slug and have their amount_owing recomputed — otherwise
// they stay billed for an event they can no longer take part in. The member's
// row must already be removed (deleted, or the slot nulled) before calling
// this, so the "still a member?" check reflects the post-dissolution state.
//
//   table      'doubles_pairs' | 'triples_teams'
//   slug       'doubles'       | 'triples'
//   playerCols the player id columns to scan on `table`
//   memberId   the former member to (maybe) clean up
//   eventYear  the event year scope
export async function cleanupFormerSideEventMember({ table, slug, playerCols, memberId, eventYear }) {
  if (!memberId) return

  // Still in any pair/team row for this year (via any player column),
  // confirmed or pending? If so, they keep the slug — nothing to clean up.
  for (const col of playerCols) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select('id')
      .eq('event_year', eventYear)
      .eq(col, memberId)
      .limit(1)
    if (error) return
    if (data && data.length > 0) return
  }

  const { data: reg, error: regErr } = await supabaseAdmin
    .from('zltac_registrations')
    .select('id, side_events')
    .eq('user_id', memberId)
    .eq('year', eventYear)
    .maybeSingle()
  if (regErr || !reg) return
  if (!(reg.side_events ?? []).includes(slug)) return

  const newSlugs = (reg.side_events ?? []).filter(s => s !== slug)
  const { error: updErr } = await supabaseAdmin
    .from('zltac_registrations')
    .update({ side_events: newSlugs })
    .eq('id', reg.id)
  if (updErr) return
  await computeAndWriteAmountOwing(reg.id)
}

export async function cleanupFormerSideEventMembers({ table, slug, playerCols, memberIds, eventYear }) {
  const uniqueIds = [...new Set((memberIds ?? []).filter(Boolean))]
  if (uniqueIds.length === 0) return []

  const stillPresent = new Set()
  const membershipResults = await Promise.all(playerCols.map(col =>
    supabaseAdmin
      .from(table)
      .select(col)
      .eq('event_year', eventYear)
      .in(col, uniqueIds)
  ))
  if (membershipResults.some(result => result.error)) return []

  for (const result of membershipResults) {
    for (const row of (result.data ?? [])) {
      for (const col of playerCols) {
        if (uniqueIds.includes(row[col])) stillPresent.add(row[col])
      }
    }
  }

  const candidateIds = uniqueIds.filter(id => !stillPresent.has(id))
  if (candidateIds.length === 0) return []

  const { data: regs, error: regErr } = await supabaseAdmin
    .from('zltac_registrations')
    .select('id, user_id, side_events')
    .eq('year', eventYear)
    .in('user_id', candidateIds)
  if (regErr) return []

  const changedRegistrationIds = []
  await Promise.all((regs ?? []).map(async reg => {
    const sideEvents = reg.side_events ?? []
    if (!sideEvents.includes(slug)) return

    const { error: updErr } = await supabaseAdmin
      .from('zltac_registrations')
      .update({ side_events: sideEvents.filter(s => s !== slug) })
      .eq('id', reg.id)
    if (!updErr) changedRegistrationIds.push(reg.id)
  }))

  await computeAndWriteAmountOwingMany(changedRegistrationIds)
  return changedRegistrationIds
}

// The mirror of cleanupFormerSideEventMember: when a player commits to a
// pairing (creates or accepts one), make sure the side event slug is on their
// registration and their amount_owing reflects it. Idempotent — a no-op when
// the slug is already present — and fail-safe on any query error.
//
//   slug      'doubles' | 'triples'
//   memberId  the committing member to add the slug for
//   eventYear the event year scope
export async function ensureSideEventMember({ slug, memberId, eventYear }) {
  if (!memberId) return

  const { data: reg, error: regErr } = await supabaseAdmin
    .from('zltac_registrations')
    .select('id, side_events')
    .eq('user_id', memberId)
    .eq('year', eventYear)
    .maybeSingle()
  if (regErr || !reg) return
  if ((reg.side_events ?? []).includes(slug)) return

  const newSlugs = [...(reg.side_events ?? []), slug]
  const { error: updErr } = await supabaseAdmin
    .from('zltac_registrations')
    .update({ side_events: newSlugs })
    .eq('id', reg.id)
  if (updErr) return
  await computeAndWriteAmountOwing(reg.id)
}
