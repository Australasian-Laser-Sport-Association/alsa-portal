import supabaseAdmin from '../_lib/supabase.js'
import { verifyCommittee, verifySuperAdmin, statusForAuthError } from '../_lib/auth.js'

// Shared by the 'reset' and 'remove-access' actions: blank all PII and drop
// back to the base role. The profiles row itself is kept, so nothing cascades.
// Registrations, acceptances, payments, and audit rows all survive.
const ANONYMISE_UPDATE = {
  first_name: null,
  last_name: null,
  alias: null,
  dob: null,
  state: null,
  home_arena: null,
  phone: null,
  emergency_contact_name: null,
  emergency_contact_phone: null,
  alsa_member_id: null,
  avatar_url: null,
  roles: ['player'],
}

// auth.admin ban_duration is a Go-style duration with no "permanent" option;
// ~100 years is effectively permanent.
const PERMANENT_BAN = '876600h'

export default async function handler(req, res) {
  const { id } = req.query

  // Single-user operations when ?id is present
  if (id) {
    if (req.method === 'GET') {
      const { error } = await verifyCommittee(req)
      if (error) return res.status(statusForAuthError(error)).json({ error })

      const [
        { data: registrations, error: e1 },
        { data: payments, error: e2 },
      ] = await Promise.all([
        supabaseAdmin.from('zltac_registrations').select('*, teams(name)').eq('user_id', id).order('year', { ascending: false }),
        supabaseAdmin.from('payments').select('*').eq('user_id', id).order('created_at', { ascending: false }),
      ])

      const errs = [e1, e2].filter(Boolean)
      if (errs.length) return res.status(500).json({ error: errs.map(e => e.message).join(' | ') })
      return res.json({ registrations, payments })
    }

    if (req.method === 'PATCH') {
      const { user: caller, error } = await verifyCommittee(req)
      if (error) return res.status(statusForAuthError(error)).json({ error })
      const body = req.body ?? {}

      // Block self-action — caller must not edit their own roles or suspended
      // state via this endpoint. Covers self-promotion, self-demotion lockout,
      // self-suspend lockout, and self-reset (reset rewrites roles too).
      if (caller.id === id) {
        return res.status(403).json({ error: 'Cannot edit your own account via this endpoint' })
      }

      let update
      if (body.action === 'reset') {
        const { error: superErr } = await verifySuperAdmin(req)
        if (superErr) return res.status(statusForAuthError(superErr)).json({ error: superErr })
        update = { ...ANONYMISE_UPDATE }
      } else if (body.action === 'remove-access') {
        // Anonymise AND revoke login. The non-destructive alternative to a
        // hard delete: the profiles row survives, so no FK cascade fires and
        // the member's records are kept.
        const { error: superErr } = await verifySuperAdmin(req)
        if (superErr) return res.status(statusForAuthError(superErr)).json({ error: superErr })

        const { data: target, error: targetErr } = await supabaseAdmin
          .from('profiles')
          .select('is_placeholder')
          .eq('id', id)
          .maybeSingle()
        if (targetErr) return res.status(500).json({ error: targetErr.message })
        if (!target) return res.status(404).json({ error: 'User not found' })

        // Placeholders have no auth.users row, so there is no login to
        // revoke. A 404 from the auth API (real profile whose auth user is
        // already gone) is treated the same way: nothing to ban, still
        // anonymise. Any other auth error aborts before touching the profile.
        if (!target.is_placeholder) {
          const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(id, {
            ban_duration: PERMANENT_BAN,
          })
          if (banErr && banErr.status !== 404) {
            return res.status(500).json({ error: `Could not disable login: ${banErr.message}` })
          }
        }
        update = { ...ANONYMISE_UPDATE }
      } else if (Array.isArray(body.roles)) {
        // Any change to roles requires superadmin (committee alone cannot
        // promote/demote other users, nor grant 'superadmin' to anyone).
        // This subsumes the explicit "reject roles containing 'superadmin'
        // unless caller is superadmin" rule.
        const { error: superErr } = await verifySuperAdmin(req)
        if (superErr) return res.status(statusForAuthError(superErr)).json({ error: superErr })
        update = { roles: body.roles }
        if (Object.prototype.hasOwnProperty.call(body, 'alsa_position')) {
          const pos = typeof body.alsa_position === 'string' ? body.alsa_position.trim() : ''
          update.alsa_position = pos || null
        }
      } else if (typeof body.suspended === 'boolean') {
        // Suspending a profile whose current roles include 'superadmin'
        // requires superadmin — prevents committee locking out a superadmin.
        const { data: target, error: targetErr } = await supabaseAdmin
          .from('profiles')
          .select('roles')
          .eq('id', id)
          .maybeSingle()
        if (targetErr) return res.status(500).json({ error: targetErr.message })
        if ((target?.roles ?? []).includes('superadmin')) {
          const { error: superErr } = await verifySuperAdmin(req)
          if (superErr) return res.status(statusForAuthError(superErr)).json({ error: superErr })
        }
        update = { suspended: body.suspended }
      } else if (Object.prototype.hasOwnProperty.call(body, 'alias')) {
        // Committee alias edit. Normalise: trim, empty -> null. Length cap 30,
        // no charset rules (mirrors the trim-only handling at signup; format
        // validation is intentionally out of scope here).
        const raw = typeof body.alias === 'string' ? body.alias.trim() : ''
        const alias = raw || null
        if (alias && alias.length > 30) {
          return res.status(400).json({ error: 'Alias must be 30 characters or fewer.' })
        }

        // Authority: editing the alias of a target whose roles include
        // 'superadmin' requires superadmin (mirrors the suspend guard). The
        // whole-endpoint self-block above already prevents editing your own row.
        const { data: target, error: targetErr } = await supabaseAdmin
          .from('profiles')
          .select('roles')
          .eq('id', id)
          .maybeSingle()
        if (targetErr) return res.status(500).json({ error: targetErr.message })
        if (!target) return res.status(404).json({ error: 'User not found' })
        if ((target.roles ?? []).includes('superadmin')) {
          const { error: superErr } = await verifySuperAdmin(req)
          if (superErr) return res.status(statusForAuthError(superErr)).json({ error: superErr })
        }

        // Soft uniqueness guard — committee curation path only. There is NO DB
        // unique constraint on alias (deliberate; the hard constraint is a
        // separate task). Compare case-insensitively in JS to match
        // claim_placeholder's lower() semantics exactly and sidestep ilike
        // wildcard edge cases (% _ * in an alias). Exclude the target's own row
        // so re-saving an unchanged alias is a no-op, not a false collision.
        if (alias) {
          const { data: others, error: clashErr } = await supabaseAdmin
            .from('profiles')
            .select('id, first_name, last_name, alias')
            .neq('id', id)
            .not('alias', 'is', null)
          if (clashErr) return res.status(500).json({ error: clashErr.message })
          const lc = alias.toLowerCase()
          const clash = (others ?? []).find(o => (o.alias ?? '').toLowerCase() === lc)
          if (clash) {
            const who = [clash.first_name, clash.last_name].filter(Boolean).join(' ') || 'another member'
            return res.status(409).json({
              error: `Alias "${clash.alias}" is already used by ${who}. Choose a different alias.`,
            })
          }
        }

        // Update profiles.alias ONLY. Do NOT cascade to existing
        // payments / zltac_registrations payment_reference values — those are
        // frozen at insert by design (see 20260514000000_payment_tracking.sql).
        update = { alias }
      } else {
        return res.status(400).json({ error: 'roles, suspended, or action is required' })
      }
      const { error: patchErr } = await supabaseAdmin.from('profiles').update(update).eq('id', id)
      if (patchErr) {
        // Race backstop to the alias soft-check above: the lower(alias) unique
        // index (23505) can still fire if a concurrent write took the alias
        // between the soft-check and this update. The soft-check returns a more
        // specific message; this is the generic fallback for the race.
        if (patchErr.code === '23505') {
          return res.status(409).json({ error: 'That alias is already taken, please choose another.' })
        }
        return res.status(500).json({ error: patchErr.message })
      }
      return res.json({ ok: true })
    }

    if (req.method === 'DELETE') {
      // Permanent account deletion is not yet implemented. The previous
      // handler deleted the profiles row only, leaving an orphaned auth.users
      // entry — broken state since AuthContext no longer re-seeds on sign-in.
      // The safe partial action ("Reset member data") now lives on PATCH
      // { action: 'reset' }. A real DELETE that also removes the auth user
      // via supabase.auth.admin.deleteUser will land in a follow-up.
      return res.status(405).json({ error: 'Method not allowed' })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Bulk GET — no ?id
  const { error } = await verifyCommittee(req)
  if (error) return res.status(statusForAuthError(error)).json({ error })

  if (req.method === 'GET') {
    const [
      { data: profiles, error: e1 },
      { data: registrations, error: e2 },
      { data: teams, error: e3 },
    ] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('id, first_name, last_name, alias, state, roles, suspended, created_at, home_arena, alsa_position')
        .order('created_at', { ascending: false }),
      supabaseAdmin.from('zltac_registrations').select('user_id, year'),
      supabaseAdmin.from('teams').select('id, name, captain_id'),
    ])

    const errs = [e1, e2, e3].filter(Boolean)
    if (errs.length) return res.status(500).json({ error: errs.map(e => e.message).join(' | ') })
    return res.json({ profiles, registrations, teams })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
