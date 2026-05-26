-- =============================================================================
-- claim_placeholder_profile RPC (Chunk 2)
-- =============================================================================
-- Merges a placeholder profile (is_placeholder = true, no auth.users row) into
-- a real profile by moving every FK reference from the placeholder to the real
-- profile and then deleting the placeholder row. Two entry points call this:
--   * player-side claim: a logged-in user matches a placeholder by alias or
--     email (api/player.js?resource=claim) and confirms it's them.
--   * admin manual link: committee picks any real user for a stuck placeholder
--     (api/admin/event.js?resource=registrations action=link-placeholder).
-- Both code paths invoke the same function so the merge logic stays one place.
--
-- SECURITY DEFINER:
--   We update across multiple tables (zltac_registrations, doubles_pairs,
--   triples_teams, payments) and finally delete the source profile. The
--   anon caller (the player) has no UPDATE rights on most of those under RLS,
--   and we deliberately want to run the merge as a single privileged unit so
--   it either completes or fails as a whole. SECURITY DEFINER runs the body
--   as the function owner (postgres / service role). search_path is pinned to
--   public so unqualified name lookups in the body can't be hijacked by a
--   caller setting their own search_path (same pattern as
--   handle_new_user / cleanup_profile_on_auth_delete in earlier migrations).
--
-- Authorisation guard:
--   EXECUTE is granted to `authenticated`, but SECURITY DEFINER means the body
--   runs with the function owner's rights — so without an explicit check, any
--   logged-in user could call this RPC directly from the browser console with
--   arbitrary (placeholder_id, real_id) and absorb another user's placeholder.
--   The /api layer guards we add in Chunk 2 don't cover direct supabase.rpc()
--   calls. So we gate inside the function: caller must either be claiming for
--   themselves (auth.uid() = real_id) or be a committee member.
--
-- Year-conflict policy:
--   If both profiles already have a registration in the same year, the merge
--   fails with a clear error and the admin reconciles manually (delete one
--   side and retry). The alternatives — auto-delete the placeholder reg, or
--   auto-delete the real reg — both risk silently dropping payments, side
--   events, partner pairings, or admin-recorded data. Failing loudly is the
--   safer default; the manual reconciliation step is cheap.
--
-- Payment-related tables (see pre-work investigation):
--   * payment_records is keyed on zltac_registrations.id, so its rows ride
--     along when we update zltac_registrations.user_id below. No explicit
--     UPDATE needed.
--   * The legacy public.payments table FKs user_id -> profiles(id) ON DELETE
--     CASCADE. New code does not insert into it, but historic rows could
--     exist; we UPDATE defensively so they're never cascade-deleted when the
--     placeholder profile is removed.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.claim_placeholder_profile(
  placeholder_id uuid,
  real_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_placeholder_is_placeholder boolean;
  v_real_is_placeholder boolean;
  v_year_conflict integer;
BEGIN
  -- Authorisation: caller is either claiming for themselves, or is committee.
  -- Without this guard, GRANT EXECUTE TO authenticated would let any user call
  -- the RPC with someone else's real_id and steal placeholder data.
  IF auth.uid() != real_id AND NOT public.is_committee() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not authorised');
  END IF;

  -- Source must exist and be a placeholder.
  SELECT is_placeholder INTO v_placeholder_is_placeholder
  FROM public.profiles WHERE id = placeholder_id;
  IF v_placeholder_is_placeholder IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'placeholder profile not found');
  END IF;
  IF NOT v_placeholder_is_placeholder THEN
    RETURN jsonb_build_object('ok', false, 'error', 'source profile is not a placeholder');
  END IF;

  -- Target must exist and be a real (non-placeholder) profile.
  SELECT is_placeholder INTO v_real_is_placeholder
  FROM public.profiles WHERE id = real_id;
  IF v_real_is_placeholder IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'real profile not found');
  END IF;
  IF v_real_is_placeholder THEN
    RETURN jsonb_build_object('ok', false, 'error', 'target profile is also a placeholder');
  END IF;

  -- Year-conflict policy: fail if both profiles have a registration for the
  -- same year. Admin manually reconciles (delete one) then retries. Safer
  -- than auto-deleting either side.
  SELECT COUNT(*) INTO v_year_conflict
  FROM public.zltac_registrations p_reg
  JOIN public.zltac_registrations r_reg ON p_reg.year = r_reg.year
  WHERE p_reg.user_id = placeholder_id AND r_reg.user_id = real_id;
  IF v_year_conflict > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'both profiles have registrations for the same year; reconcile manually before claiming');
  END IF;

  -- Move every FK reference from the placeholder to the real profile.
  -- payment_records rides along via zltac_registrations.id (see header).
  UPDATE public.zltac_registrations SET user_id = real_id WHERE user_id = placeholder_id;
  UPDATE public.doubles_pairs       SET player1_id = real_id WHERE player1_id = placeholder_id;
  UPDATE public.doubles_pairs       SET player2_id = real_id WHERE player2_id = placeholder_id;
  UPDATE public.triples_teams       SET player1_id = real_id WHERE player1_id = placeholder_id;
  UPDATE public.triples_teams       SET player2_id = real_id WHERE player2_id = placeholder_id;
  UPDATE public.triples_teams       SET player3_id = real_id WHERE player3_id = placeholder_id;

  -- Legacy payments table — defensive; see header note. Without this, any
  -- historic rows for the placeholder would cascade-delete with it below.
  UPDATE public.payments            SET user_id = real_id WHERE user_id = placeholder_id;

  -- Source profile is now orphaned of FKs. Delete it.
  DELETE FROM public.profiles WHERE id = placeholder_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_placeholder_profile(uuid, uuid) TO authenticated;
