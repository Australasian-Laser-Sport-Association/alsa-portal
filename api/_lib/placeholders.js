import supabaseAdmin from './supabase.js'

// Returns true if any of the given profile ids belongs to a placeholder
// profile (is_placeholder = true).
//
// Used to auto-confirm partnerships: a placeholder has no auth.users login, so
// there is no second human who can click "confirm". When a real player pairs
// with a placeholder we therefore treat the pairing as confirmed on write.
//
// Fail-safe: on a read error we return false (do NOT force-confirm), so a
// transient DB hiccup falls back to the normal pending-confirmation flow rather
// than silently confirming a pairing that no human agreed to.
export async function anyPlaceholder(ids) {
  const clean = [...new Set((ids ?? []).filter(Boolean))]
  if (clean.length === 0) return false

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, is_placeholder')
    .in('id', clean)

  if (error) return false
  return (data ?? []).some(p => p.is_placeholder === true)
}
