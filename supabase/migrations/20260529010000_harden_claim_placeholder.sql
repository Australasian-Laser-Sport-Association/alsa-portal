-- 20260529010000_harden_claim_placeholder.sql
-- Placeholder-claim authorisation hardening.
--
-- Tightens the claim_placeholder_profile RPC so a logged-in user can no longer
-- absorb an arbitrary placeholder's data merely by being authenticated. In
-- addition to the existing auth.uid() = real_id check, the function now
-- requires that the placeholder actually BELONG to the caller — i.e. its
-- alias matches the caller's alias case-insensitively, OR its placeholder_email
-- matches the caller's auth email. Committee (is_committee()) may still
-- bypass, because the admin manual-link path (api/admin/event.js?resource=
-- registrations action=link-placeholder) deliberately uses this RPC to pair a
-- stuck placeholder with whatever real user the committee picks.
--
-- The function body otherwise mirrors 20260526000000_claim_placeholder.sql.
-- See that migration's header for SECURITY DEFINER rationale, year-conflict
-- policy, and notes on payment_records / legacy public.payments.

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
  v_caller_alias text;
  v_caller_email text;
  v_placeholder_alias text;
  v_placeholder_email text;
  v_owns_placeholder boolean := false;
BEGIN
  -- Authorisation step 1: caller is either claiming for themselves, or is
  -- committee. Unchanged from the original function.
  IF auth.uid() != real_id AND NOT public.is_committee() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not authorised');
  END IF;

  -- Authorisation step 2 (new): non-committee callers must additionally own
-- the placeholder by alias or email.
  IF NOT public.is_committee() THEN
    SELECT alias, placeholder_email
      INTO v_placeholder_alias, v_placeholder_email
      FROM public.profiles WHERE id = placeholder_id;

    SELECT alias INTO v_caller_alias
      FROM public.profiles WHERE id = real_id;

    SELECT email INTO v_caller_email
      FROM auth.users WHERE id = real_id;

    IF v_caller_alias IS NOT NULL
       AND v_placeholder_alias IS NOT NULL
       AND lower(v_caller_alias) = lower(v_placeholder_alias) THEN
      v_owns_placeholder := true;
    END IF;

    IF NOT v_owns_placeholder
       AND v_caller_email IS NOT NULL
       AND v_placeholder_email IS NOT NULL
       AND lower(v_caller_email) = lower(v_placeholder_email) THEN
      v_owns_placeholder := true;
    END IF;

    IF NOT v_owns_placeholder THEN
      RETURN jsonb_build_object('ok', false, 'error', 'placeholder does not belong to caller');
    END IF;
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
  -- same year. Admin manually reconciles (delete one) then retries.
  SELECT COUNT(*) INTO v_year_conflict
  FROM public.zltac_registrations p_reg
  JOIN public.zltac_registrations r_reg ON p_reg.year = r_reg.year
  WHERE p_reg.user_id = placeholder_id AND r_reg.user_id = real_id;
  IF v_year_conflict > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'both profiles have registrations for the same year; reconcile manually before claiming');
  END IF;

  -- Move every FK reference from the placeholder to the real profile.
  -- payment_records rides along via zltac_registrations.id.
  UPDATE public.zltac_registrations SET user_id = real_id WHERE user_id = placeholder_id;
  UPDATE public.doubles_pairs       SET player1_id = real_id WHERE player1_id = placeholder_id;
  UPDATE public.doubles_pairs       SET player2_id = real_id WHERE player2_id = placeholder_id;
  UPDATE public.triples_teams       SET player1_id = real_id WHERE player1_id = placeholder_id;
  UPDATE public.triples_teams       SET player2_id = real_id WHERE player2_id = placeholder_id;
  UPDATE public.triples_teams       SET player3_id = real_id WHERE player3_id = placeholder_id;

  -- Legacy payments table — defensive against historic rows.
  UPDATE public.payments            SET user_id = real_id WHERE user_id = placeholder_id;

  -- Source profile is now orphaned of FKs. Delete it.
  DELETE FROM public.profiles WHERE id = placeholder_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_placeholder_profile(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run manually if a flow breaks):
--   Re-run 20260526000000_claim_placeholder.sql to restore the prior function
--   body (which only checked auth.uid() = real_id).
-- ---------------------------------------------------------------------------
