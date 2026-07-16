-- Replace the ambiguous placeholder-claim service contract with an
-- actor-explicit, mode-specific workflow.
--
-- The legacy two-argument function relied on auth.uid() and is_committee().
-- Service-role PostgREST calls do not carry the end-user JWT, so both values
-- describe the service context rather than the already-verified API actor.
-- That made the player and committee paths impossible to distinguish safely.

BEGIN;

-- Alias is a public display identifier, never account ownership evidence. Keep
-- one canonical stored representation so case/edge-space variants cannot
-- bypass uniqueness or recreate an ambiguous identity boundary.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.profiles AS profile
     WHERE profile.alias IS NOT NULL
       AND (
         profile.alias IS DISTINCT FROM btrim(profile.alias)
         OR btrim(profile.alias) = ''
       )
  ) THEN
    RAISE EXCEPTION
      'Alias normalization preflight failed: blank or edge-space aliases exist. Reconcile them before applying 64000.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT lower(btrim(profile.alias))
      FROM public.profiles AS profile
     WHERE profile.alias IS NOT NULL
     GROUP BY lower(btrim(profile.alias))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Alias normalization preflight failed: normalized aliases are duplicated. Reconcile them before applying 64000.'
      USING ERRCODE = '23505';
  END IF;
END;
$$;

DROP INDEX public.profiles_alias_lower_unique;
CREATE UNIQUE INDEX profiles_alias_lower_unique
  ON public.profiles (lower(btrim(alias)))
  WHERE alias IS NOT NULL;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_alias_trimmed_nonempty
  CHECK (alias IS NULL OR (alias = btrim(alias) AND alias <> ''));

-- Successful merges destroy the source profile, so retain a minimal durable
-- security audit in the same transaction. UUIDs are deliberately not foreign
-- keys: later retention workflows must not erase or be blocked by this record.
CREATE TABLE public.placeholder_merge_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid NOT NULL,
  source_placeholder_id uuid NOT NULL,
  target_profile_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('self', 'admin')),
  merged_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT placeholder_merge_audit_distinct_profiles_check
    CHECK (source_placeholder_id <> target_profile_id)
);

CREATE UNIQUE INDEX placeholder_merge_audit_source_unique
  ON public.placeholder_merge_audit (source_placeholder_id);
CREATE INDEX placeholder_merge_audit_target_time_idx
  ON public.placeholder_merge_audit (target_profile_id, merged_at DESC);

ALTER TABLE public.placeholder_merge_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.placeholder_merge_audit
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.placeholder_merge_audit TO service_role;
REVOKE ALL ON SEQUENCE public.placeholder_merge_audit_id_seq
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prevent_placeholder_merge_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'Placeholder merge audit records are immutable.'
    USING ERRCODE = '55000';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_placeholder_merge_audit_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER placeholder_merge_audit_immutable_rows
  BEFORE UPDATE OR DELETE ON public.placeholder_merge_audit
  FOR EACH ROW EXECUTE FUNCTION public.prevent_placeholder_merge_audit_mutation();
CREATE TRIGGER placeholder_merge_audit_immutable_truncate
  BEFORE TRUNCATE ON public.placeholder_merge_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_placeholder_merge_audit_mutation();

CREATE OR REPLACE FUNCTION public.merge_placeholder_profile(
  p_actor_id uuid,
  p_placeholder_id uuid,
  p_real_id uuid,
  p_mode text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor public.profiles%ROWTYPE;
  v_placeholder public.profiles%ROWTYPE;
  v_real public.profiles%ROWTYPE;
  v_actor_email text;
  v_year_conflict integer;
BEGIN
  IF p_actor_id IS NULL OR p_placeholder_id IS NULL OR p_real_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor, placeholder, and real profile are required');
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('self', 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid claim mode');
  END IF;
  IF p_placeholder_id = p_real_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'source and target profiles must differ');
  END IF;

  -- Lock every participating identity in a deterministic order. The actor can
  -- also be the target in self mode, so DISTINCT avoids redundant row locks.
  PERFORM profile.id
    FROM public.profiles AS profile
   WHERE profile.id IN (p_actor_id, p_placeholder_id, p_real_id)
   ORDER BY profile.id
   FOR UPDATE;

  SELECT profile.*
    INTO v_actor
    FROM public.profiles AS profile
   WHERE profile.id = p_actor_id;
  IF NOT FOUND
     OR coalesce(v_actor.suspended, false)
     OR v_actor.access_revoked_at IS NOT NULL
     OR coalesce(v_actor.is_placeholder, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not authorised');
  END IF;

  SELECT profile.*
    INTO v_placeholder
    FROM public.profiles AS profile
   WHERE profile.id = p_placeholder_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'placeholder profile not found');
  END IF;
  IF NOT coalesce(v_placeholder.is_placeholder, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'source profile is not a placeholder');
  END IF;

  SELECT profile.*
    INTO v_real
    FROM public.profiles AS profile
   WHERE profile.id = p_real_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'real profile not found');
  END IF;
  IF coalesce(v_real.is_placeholder, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'target profile is also a placeholder');
  END IF;
  IF coalesce(v_real.suspended, false)
     OR v_real.access_revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'target profile is not active');
  END IF;

  IF p_mode = 'self' THEN
    IF p_actor_id IS DISTINCT FROM p_real_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not authorised');
    END IF;

    SELECT auth_user.email
      INTO v_actor_email
      FROM auth.users AS auth_user
     WHERE auth_user.id = p_actor_id
       AND auth_user.email_confirmed_at IS NOT NULL;

    IF nullif(btrim(v_actor_email), '') IS NULL
       OR nullif(btrim(v_placeholder.placeholder_email), '') IS NULL
       OR lower(btrim(v_actor_email))
          IS DISTINCT FROM lower(btrim(v_placeholder.placeholder_email)) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'placeholder does not belong to caller');
    END IF;
  ELSE
    IF NOT (
      coalesce(v_actor.roles, ARRAY[]::text[])
      && ARRAY['superadmin', 'alsa_committee', 'zltac_committee', 'advisor']::text[]
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not authorised');
    END IF;
  END IF;

  -- Preserve the established conflict contract. A committee member reconciles
  -- duplicate annual registrations explicitly rather than allowing the merge
  -- to choose which financial and legal record wins.
  SELECT count(*)
    INTO v_year_conflict
    FROM public.zltac_registrations AS placeholder_registration
    JOIN public.zltac_registrations AS real_registration
      ON real_registration.year = placeholder_registration.year
   WHERE placeholder_registration.user_id = p_placeholder_id
     AND real_registration.user_id = p_real_id;
  IF v_year_conflict > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'both profiles have registrations for the same year; reconcile manually before claiming'
    );
  END IF;

  -- Every move and the source deletion occur in this function's transaction.
  -- The normalized side-event membership trigger follows the legacy roster
  -- updates. team_members is also moved because current placeholder creation
  -- can immediately place the player on a ZLTAC team.
  UPDATE public.zltac_registrations
     SET user_id = p_real_id
   WHERE user_id = p_placeholder_id;

  UPDATE public.doubles_pairs
     SET player1_id = p_real_id
   WHERE player1_id = p_placeholder_id;
  UPDATE public.doubles_pairs
     SET player2_id = p_real_id
   WHERE player2_id = p_placeholder_id;

  UPDATE public.triples_teams
     SET player1_id = p_real_id
   WHERE player1_id = p_placeholder_id;
  UPDATE public.triples_teams
     SET player2_id = p_real_id
   WHERE player2_id = p_placeholder_id;
  UPDATE public.triples_teams
     SET player3_id = p_real_id
   WHERE player3_id = p_placeholder_id;

  UPDATE public.team_members
     SET user_id = p_real_id
   WHERE user_id = p_placeholder_id;

  -- Legacy payments remain part of the established merge contract. Current
  -- payment_records follow their registration and do not need a profile-key
  -- rewrite.
  UPDATE public.payments
     SET user_id = p_real_id
   WHERE user_id = p_placeholder_id;

  -- 61000's catalog-driven delete guard refuses this delete if any newer
  -- identity/evidence reference was not deliberately moved above. That keeps
  -- future schema additions fail closed instead of silently cascading data.
  DELETE FROM public.profiles
   WHERE id = p_placeholder_id;

  INSERT INTO public.placeholder_merge_audit (
    actor_id,
    source_placeholder_id,
    target_profile_id,
    mode
  ) VALUES (
    p_actor_id,
    p_placeholder_id,
    p_real_id,
    p_mode
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_placeholder_profile(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.merge_placeholder_profile(uuid, uuid, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.merge_placeholder_profile(uuid, uuid, uuid, text) IS
  'Service-only atomic placeholder merge with an explicit verified actor and self/admin authorization mode.';

-- Retire the old service contract in depth. Keeping the signature as a
-- fail-closed shim gives stale application code a deterministic response while
-- removing every non-owner execution grant.
CREATE OR REPLACE FUNCTION public.claim_placeholder_profile(
  placeholder_id uuid,
  real_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'ok', false,
    'error', 'legacy placeholder claim contract is retired'
  )
$$;

REVOKE ALL ON FUNCTION public.claim_placeholder_profile(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.claim_placeholder_profile(uuid, uuid) IS
  'Retired fail-closed shim. Use merge_placeholder_profile with explicit actor and mode.';

COMMIT;
