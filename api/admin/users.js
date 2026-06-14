import supabaseAdmin from '../_lib/supabase.js'
import { verifyCommittee, verifySuperAdmin, statusForAuthError } from '../_lib/auth.js'
import { PERMANENT_BAN, setUserSuspension } from '../_lib/suspension.js'
import { changeProfileAlias } from '../_lib/profileChanges.js'

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

export default async function handler(req, res) {
  const { id } = req.query

  // Single-user operations when ?id is present
  if (id) {
    if (req.method === 'GET') {
      // Impact preview for the hard delete: counts of the rows a delete would
      // destroy via the profiles cascade. Superadmin only, like DELETE itself.
      if (req.query.action === 'deletion-impact') {
        const { error: superErr } = await verifySuperAdmin(req)
        if (superErr) return res.status(statusForAuthError(superErr)).json({ error: superErr })

        const countOf = (table, col) =>
          supabaseAdmin.from(table).select('*', { count: 'exact', head: true }).eq(col, id)

        // payment_records hang off the user's ZLTAC registrations, not the
        // user directly, so fetch the registration ids first.
        const { data: regRows, error: regErr } = await supabaseAdmin
          .from('zltac_registrations').select('id').eq('user_id', id)
        if (regErr) return res.status(500).json({ error: regErr.message })
        const regIds = (regRows ?? []).map(r => r.id)

        const results = {}
        const queries = [
          ['event_registrations',       countOf('event_registrations', 'user_id')],
          ['competition_registrations', countOf('competition_registrations', 'user_id')],
          ['payments',                  countOf('payments', 'user_id')],
          ['payment_records',           regIds.length
            ? supabaseAdmin.from('payment_records').select('*', { count: 'exact', head: true }).in('registration_id', regIds)
            : Promise.resolve({ count: 0, error: null })],
          ['legal_acceptances',         countOf('legal_acceptances', 'user_id')],
          ['referee_test_results',      countOf('referee_test_results', 'user_id')],
          ['under_18_approvals',        countOf('under_18_approvals', 'user_id')],
          ['team_members',              countOf('team_members', 'user_id')],
          ['alsa_memberships',          countOf('alsa_memberships', 'profile_id')],
        ]
        const settled = await Promise.all(queries.map(([, q]) => q))
        const countErrs = settled.map(r => r.error).filter(Boolean)
        if (countErrs.length) return res.status(500).json({ error: countErrs.map(e => e.message).join(' | ') })

        results.zltac_registrations = regIds.length
        queries.forEach(([key], i) => { results[key] = settled[i].count ?? 0 })
        return res.json(results)
      }

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
          .select('roles, suspended, is_placeholder')
          .eq('id', id)
          .maybeSingle()
        if (targetErr) return res.status(500).json({ error: targetErr.message })
        if ((target?.roles ?? []).includes('superadmin')) {
          const { error: superErr } = await verifySuperAdmin(req)
          if (superErr) return res.status(statusForAuthError(superErr)).json({ error: superErr })
        }
        if (!target) return res.status(404).json({ error: 'User not found' })
        const result = await setUserSuspension({
          supabase: supabaseAdmin,
          userId: id,
          suspended: body.suspended,
          previousSuspended: target.suspended,
          isPlaceholder: target.is_placeholder,
        })
        if (result.error) return res.status(500).json({ error: result.error })
        return res.json({ ok: true })
      } else if (Object.prototype.hasOwnProperty.call(body, 'alias')) {
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

        const result = await changeProfileAlias({
          supabase: supabaseAdmin,
          targetProfileId: id,
          newAlias: body.alias,
          reason: body.alias_change_reason,
          changedBy: caller.id,
          source: 'admin-users',
        })
        if (result.error) return res.status(result.status).json({ error: result.error })
        return res.json({ ok: true, alias: result.data?.alias ?? null })
      } else {
        return res.status(400).json({ error: 'roles, suspended, or action is required' })
      }
      const { error: patchErr } = await supabaseAdmin.from('profiles').update(update).eq('id', id)
      if (patchErr) return res.status(500).json({ error: patchErr.message })
      return res.json({ ok: true })
    }

    if (req.method === 'DELETE') {
      // Hard delete. Real users go through auth.admin.deleteUser: the
      // on_auth_user_deleted trigger removes the profiles row, and the child
      // FKs cascade from there (registrations, acceptances, payments, ...).
      // Placeholders have no auth.users row, so their profiles row is deleted
      // directly with the same cascade. NO ACTION FKs (the committee audit
      // columns: admin_override_*_set_by, competitions.created_by, etc.)
      // abort the whole transaction; that surfaces as the 409 below.
      const { user: caller, error: superErr } = await verifySuperAdmin(req)
      if (superErr) return res.status(statusForAuthError(superErr)).json({ error: superErr })
      if (caller.id === id) {
        return res.status(403).json({ error: 'Cannot delete your own account' })
      }

      const { data: target, error: targetErr } = await supabaseAdmin
        .from('profiles')
        .select('is_placeholder')
        .eq('id', id)
        .maybeSingle()
      if (targetErr) return res.status(500).json({ error: targetErr.message })
      if (!target) return res.status(404).json({ error: 'User not found' })

      const FK_BLOCK_MESSAGE = 'This account is referenced by committee audit records and cannot be hard-deleted. Use Remove access instead.'
      const isFkViolation = (e) =>
        e?.code === '23503' || /foreign key|violates.*constraint/i.test(e?.message ?? '')

      try {
        if (target.is_placeholder) {
          const { error: delErr } = await supabaseAdmin.from('profiles').delete().eq('id', id)
          if (delErr) {
            if (isFkViolation(delErr)) return res.status(409).json({ error: FK_BLOCK_MESSAGE })
            return res.status(500).json({ error: delErr.message })
          }
        } else {
          const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(id)
          if (authErr) {
            if (isFkViolation(authErr)) return res.status(409).json({ error: FK_BLOCK_MESSAGE })
            return res.status(500).json({ error: authErr.message || 'Failed to delete account' })
          }
        }
      } catch (err) {
        if (isFkViolation(err)) return res.status(409).json({ error: FK_BLOCK_MESSAGE })
        return res.status(500).json({ error: err?.message || 'Failed to delete account' })
      }
      return res.json({ deleted: true })
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
