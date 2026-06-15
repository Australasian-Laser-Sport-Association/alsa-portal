import supabaseAdmin from './supabase.js'

// Single source of truth for amount_owing.
// Formula (cents):
//   main_fee
//   + (team_id IS NOT NULL ? team_fee : 0)
//   + sum(prices for slugs in registration.side_events that are enabled and not 'presentation-dinner')
//   + dinner_guests * dinner_guest_price
//   + round(subtotal * processing_fee_pct / 100)

export async function computeAndWriteAmountOwing(registrationId) {
  if (!registrationId) return { error: 'registrationId is required' }

  const { data: reg, error: regErr } = await supabaseAdmin
    .from('zltac_registrations')
    .select('id, year, team_id, side_events, dinner_guests')
    .eq('id', registrationId)
    .maybeSingle()
  if (regErr) return { error: regErr.message }
  if (!reg) return { error: 'Registration not found' }

  const { data: ev, error: evErr } = await supabaseAdmin
    .from('zltac_events')
    .select('main_fee, team_fee, dinner_guest_price, processing_fee_pct, side_events')
    .eq('year', reg.year)
    .maybeSingle()
  if (evErr) return { error: evErr.message }
  if (!ev) return { error: 'Event not found' }

  const sidePrices = new Map(
    (ev.side_events ?? [])
      .filter(se => se.enabled && se.slug !== 'presentation-dinner')
      .map(se => [se.slug, se.price ?? 0])
  )
  const sideTotal = (reg.side_events ?? []).reduce((sum, slug) => sum + (sidePrices.get(slug) ?? 0), 0)

  const mainFee = ev.main_fee ?? 0
  const teamFee = reg.team_id ? (ev.team_fee ?? 0) : 0
  const dinnerTotal = (reg.dinner_guests ?? 0) * (ev.dinner_guest_price ?? 0)
  const processingPct = ev.processing_fee_pct ?? 0

  const subtotal = mainFee + teamFee + sideTotal + dinnerTotal
  const processingFee = Math.round((subtotal * processingPct) / 100)
  const amountOwing = subtotal + processingFee

  const { error: updErr } = await supabaseAdmin
    .from('zltac_registrations')
    .update({ amount_owing: amountOwing })
    .eq('id', registrationId)
  if (updErr) return { error: updErr.message }

  return { amountOwing }
}

export async function computeAndWriteAmountOwingMany(registrationIds) {
  if (!Array.isArray(registrationIds) || registrationIds.length === 0) return []
  return Promise.all(registrationIds.map(id => computeAndWriteAmountOwing(id)))
}
