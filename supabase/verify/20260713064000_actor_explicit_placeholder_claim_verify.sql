DO $$
DECLARE
  v_merge regprocedure := to_regprocedure(
    'public.merge_placeholder_profile(uuid,uuid,uuid,text)'
  );
  v_legacy regprocedure := to_regprocedure(
    'public.claim_placeholder_profile(uuid,uuid)'
  );
  v_audit_guard regprocedure := to_regprocedure(
    'public.prevent_placeholder_merge_audit_mutation()'
  );
  v_definition text;
  v_index_definition text;
  v_constraint_definition text;
BEGIN
  IF v_merge IS NULL OR v_legacy IS NULL OR v_audit_guard IS NULL THEN
    RAISE EXCEPTION 'Placeholder merge contracts are missing.';
  END IF;

  IF has_function_privilege('anon', v_merge, 'EXECUTE')
     OR has_function_privilege('authenticated', v_merge, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_merge, 'EXECUTE') THEN
    RAISE EXCEPTION 'Actor-explicit placeholder merge has unsafe execute grants.';
  END IF;

  IF has_function_privilege('anon', v_legacy, 'EXECUTE')
     OR has_function_privilege('authenticated', v_legacy, 'EXECUTE')
     OR has_function_privilege('service_role', v_legacy, 'EXECUTE') THEN
    RAISE EXCEPTION 'Legacy placeholder claim contract remains executable.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc AS procedure
     WHERE procedure.oid = v_merge
       AND procedure.prosecdef
       AND procedure.proconfig @> ARRAY['search_path=pg_catalog, public']::text[]
  ) THEN
    RAISE EXCEPTION 'Actor-explicit placeholder merge is not hardened.';
  END IF;

  SELECT pg_get_indexdef(index_class.oid)
    INTO v_index_definition
    FROM pg_class AS index_class
    JOIN pg_namespace AS namespace
      ON namespace.oid = index_class.relnamespace
   WHERE namespace.nspname = 'public'
     AND index_class.relname = 'profiles_alias_lower_unique';
  IF v_index_definition IS NULL
     OR v_index_definition NOT ILIKE '%UNIQUE INDEX%'
     OR v_index_definition NOT ILIKE '%lower(btrim(alias))%'
     OR v_index_definition NOT ILIKE '%WHERE (alias IS NOT NULL)%' THEN
    RAISE EXCEPTION 'Profile aliases do not have the normalized unique boundary.';
  END IF;

  SELECT pg_get_constraintdef(constraint_record.oid)
    INTO v_constraint_definition
    FROM pg_constraint AS constraint_record
    JOIN pg_class AS relation
      ON relation.oid = constraint_record.conrelid
    JOIN pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
   WHERE namespace.nspname = 'public'
     AND relation.relname = 'profiles'
     AND constraint_record.conname = 'profiles_alias_trimmed_nonempty'
     AND constraint_record.contype = 'c'
     AND constraint_record.convalidated;
  IF v_constraint_definition IS NULL
     OR v_constraint_definition NOT ILIKE '%alias = btrim(alias)%'
     OR v_constraint_definition NOT ILIKE '%alias <>%''%''%' THEN
    RAISE EXCEPTION 'Profile aliases do not have a validated trimmed-value constraint.';
  END IF;

  IF to_regclass('public.placeholder_merge_audit') IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM pg_class AS relation
        WHERE relation.oid = 'public.placeholder_merge_audit'::regclass
          AND relation.relrowsecurity
     ) THEN
    RAISE EXCEPTION 'Placeholder merge audit table is missing RLS.';
  END IF;

  IF (
    SELECT array_agg(column_name::text ORDER BY ordinal_position)
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'placeholder_merge_audit'
  ) IS DISTINCT FROM ARRAY[
    'id', 'actor_id', 'source_placeholder_id', 'target_profile_id', 'mode', 'merged_at'
  ]::text[] THEN
    RAISE EXCEPTION 'Placeholder merge audit contains unexpected or missing columns.';
  END IF;

  IF has_table_privilege('anon', 'public.placeholder_merge_audit', 'SELECT')
     OR has_table_privilege('authenticated', 'public.placeholder_merge_audit', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.placeholder_merge_audit', 'SELECT')
     OR has_table_privilege('service_role', 'public.placeholder_merge_audit', 'INSERT')
     OR has_table_privilege('service_role', 'public.placeholder_merge_audit', 'UPDATE')
     OR has_table_privilege('service_role', 'public.placeholder_merge_audit', 'DELETE')
     OR has_table_privilege('service_role', 'public.placeholder_merge_audit', 'TRUNCATE')
     OR has_table_privilege('service_role', 'public.placeholder_merge_audit', 'REFERENCES')
     OR has_table_privilege('service_role', 'public.placeholder_merge_audit', 'TRIGGER')
     OR has_sequence_privilege('service_role', 'public.placeholder_merge_audit_id_seq', 'USAGE')
     OR has_sequence_privilege('service_role', 'public.placeholder_merge_audit_id_seq', 'UPDATE') THEN
    RAISE EXCEPTION 'Placeholder merge audit has unsafe direct privileges.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger AS trigger
     WHERE trigger.tgrelid = 'public.placeholder_merge_audit'::regclass
       AND trigger.tgname = 'placeholder_merge_audit_immutable_rows'
       AND NOT trigger.tgisinternal
       AND (trigger.tgtype & 1) <> 0
       AND (trigger.tgtype & 2) <> 0
       AND (trigger.tgtype & 8) <> 0
       AND (trigger.tgtype & 16) <> 0
       AND trigger.tgenabled <> 'D'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_trigger AS trigger
     WHERE trigger.tgrelid = 'public.placeholder_merge_audit'::regclass
       AND trigger.tgname = 'placeholder_merge_audit_immutable_truncate'
       AND NOT trigger.tgisinternal
       AND (trigger.tgtype & 1) = 0
       AND (trigger.tgtype & 2) <> 0
       AND (trigger.tgtype & 32) <> 0
       AND trigger.tgenabled <> 'D'
  ) OR pg_get_functiondef(v_audit_guard)
       NOT ILIKE '%RAISE EXCEPTION%Placeholder merge audit records are immutable%55000%' THEN
    RAISE EXCEPTION 'Placeholder merge audit is not immutable for row changes and truncate.';
  END IF;

  v_definition := pg_get_functiondef(v_merge);
  IF v_definition NOT ILIKE '%p_actor_id IS DISTINCT FROM p_real_id%'
     OR v_definition NOT ILIKE '%p_mode = ''self''%'
     OR v_definition NOT ILIKE '%p_mode NOT IN (''self'', ''admin'')%'
     OR v_definition NOT ILIKE '%FROM auth.users%'
     OR v_definition NOT ILIKE '%email_confirmed_at IS NOT NULL%'
     OR v_definition NOT ILIKE '%v_placeholder.placeholder_email%'
     OR v_definition ILIKE '%v_actor.alias%'
     OR v_definition ILIKE '%v_placeholder.alias%'
     OR v_definition NOT ILIKE '%v_actor.access_revoked_at IS NOT NULL%'
     OR v_definition NOT ILIKE '%v_real.access_revoked_at IS NOT NULL%'
     OR v_definition NOT ILIKE '%coalesce(v_real.suspended, false)%'
     OR v_definition NOT ILIKE '%INSERT INTO public.placeholder_merge_audit%'
     OR v_definition NOT ILIKE '%superadmin%'
     OR v_definition NOT ILIKE '%alsa_committee%'
     OR v_definition NOT ILIKE '%zltac_committee%'
     OR v_definition NOT ILIKE '%advisor%'
     OR v_definition NOT ILIKE '%suspended%'
     OR v_definition NOT ILIKE '%is_placeholder%'
     OR v_definition NOT ILIKE '%ORDER BY profile.id%FOR UPDATE%'
     OR v_definition NOT ILIKE '%both profiles have registrations for the same year%'
     OR v_definition NOT ILIKE '%UPDATE public.zltac_registrations%'
     OR v_definition NOT ILIKE '%UPDATE public.team_members%'
     OR v_definition NOT ILIKE '%DELETE FROM public.profiles%'
  THEN
    RAISE EXCEPTION 'Actor-explicit placeholder merge lost an authorization or atomicity guard.';
  END IF;

  v_definition := pg_get_functiondef(v_legacy);
  IF v_definition NOT ILIKE '%legacy placeholder claim contract is retired%' THEN
    RAISE EXCEPTION 'Legacy placeholder claim is not a fail-closed shim.';
  END IF;
END;
$$;
