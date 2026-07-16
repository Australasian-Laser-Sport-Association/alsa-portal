-- Read-only verification for database-enforced profile governance and
-- acknowledgement lifecycle cleanup.

DO $$
DECLARE
  v_definition text;
  v_count integer;
  v_state integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.profiles'::regclass
       AND conname = 'profiles_roles_canonical_check'
       AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'canonical profile-role constraint is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.profiles'::regclass
       AND conname = 'profiles_access_revocation_pair_check'
       AND contype = 'c'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.profiles'::regclass
       AND conname = 'profiles_access_revocation_state_check'
       AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'profile access-revocation constraints are missing';
  END IF;

  IF has_function_privilege(
       'anon', 'public.profile_roles_are_canonical(text[])', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated', 'public.profile_roles_are_canonical(text[])', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role', 'public.profile_roles_are_canonical(text[])', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'profile role CHECK predicate has unusable or over-broad execute privileges';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.profile_governance_state'::regclass
       AND conname = 'profile_governance_active_superadmin_check'
       AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'active-superadmin state constraint is missing';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.profiles AS profile
     WHERE NOT public.profile_roles_are_canonical(profile.roles)
        OR (profile.suspended AND 'superadmin' = ANY (profile.roles))
        OR ((profile.access_revoked_at IS NULL) <> (profile.access_revoked_by IS NULL))
        OR (
          profile.access_revoked_at IS NOT NULL
          AND (
            NOT profile.suspended
            OR profile.roles <> ARRAY['player']::text[]
            OR profile.first_name IS NOT NULL
            OR profile.last_name IS NOT NULL
            OR profile.alias IS NOT NULL
            OR profile.email IS NOT NULL
            OR profile.alsa_position IS NOT NULL
          )
        )
  ) THEN
    RAISE EXCEPTION 'a profile violates canonical role, superadmin, or revocation rules';
  END IF;

  IF has_column_privilege('service_role', 'public.profiles', 'roles', 'UPDATE')
     OR has_column_privilege('service_role', 'public.profiles', 'suspended', 'UPDATE')
     OR has_column_privilege('service_role', 'public.profiles', 'alsa_position', 'UPDATE')
     OR has_column_privilege('service_role', 'public.profiles', 'access_revoked_at', 'UPDATE')
     OR has_column_privilege('service_role', 'public.profiles', 'access_revoked_by', 'UPDATE')
     OR has_table_privilege('service_role', 'public.profiles', 'INSERT')
     OR has_table_privilege('service_role', 'public.profiles', 'TRUNCATE')
     OR NOT has_column_privilege('service_role', 'public.profiles', 'alias', 'UPDATE') THEN
    RAISE EXCEPTION 'service role can bypass profile governance or cannot update safe fields';
  END IF;

  IF has_column_privilege('anon', 'public.profiles', 'access_revoked_at', 'SELECT')
     OR has_column_privilege('anon', 'public.profiles', 'access_revoked_by', 'SELECT')
     OR has_column_privilege('authenticated', 'public.profiles', 'access_revoked_at', 'SELECT')
     OR has_column_privilege('authenticated', 'public.profiles', 'access_revoked_by', 'SELECT') THEN
    RAISE EXCEPTION 'profile access-revocation evidence is exposed to a browser role';
  END IF;

  SELECT count(*)::integer
    INTO v_count
    FROM public.profiles AS profile
   WHERE NOT profile.suspended
     AND 'superadmin' = ANY (profile.roles);
  SELECT active_superadmin_count
    INTO v_state
    FROM public.profile_governance_state
   WHERE singleton;
  IF v_state IS DISTINCT FROM v_count THEN
    RAISE EXCEPTION 'active-superadmin counter is out of sync';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.profiles'::regclass
       AND tgname = 'profile_governance_guard'
       AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.profiles'::regclass
       AND tgname = 'profile_governance_state_sync'
       AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.profiles'::regclass
       AND tgname = 'profile_access_audit_trigger'
       AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.profiles'::regclass
       AND tgname = 'zz_profile_access_revocation_guard'
       AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.profiles'::regclass
       AND tgname = 'profile_evidence_delete_guard'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'one or more profile governance triggers are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_class AS relation
     WHERE relation.oid = 'public.profile_access_audit'::regclass
       AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'profile access audit RLS is not enabled';
  END IF;

  IF has_table_privilege('anon', 'public.profile_access_audit', 'SELECT')
     OR has_table_privilege('authenticated', 'public.profile_access_audit', 'SELECT')
     OR has_table_privilege('service_role', 'public.profile_access_audit', 'INSERT')
     OR has_table_privilege('service_role', 'public.profile_access_audit', 'UPDATE')
     OR has_table_privilege('service_role', 'public.profile_access_audit', 'DELETE')
     OR has_table_privilege('service_role', 'public.profile_access_audit', 'TRUNCATE')
     OR NOT has_table_privilege('service_role', 'public.profile_access_audit', 'SELECT') THEN
    RAISE EXCEPTION 'profile access audit has unsafe table privileges';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgrelid = 'public.profile_access_audit'::regclass
       AND tgname = 'profile_access_audit_immutable'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'profile access audit immutability trigger is missing';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.admin_mutate_profile_access(uuid,uuid,text,jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.admin_mutate_profile_access(uuid,uuid,text,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.admin_mutate_profile_access(uuid,uuid,text,jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'profile access RPC execute privileges are unsafe';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc
     WHERE oid = 'public.admin_mutate_profile_access(uuid,uuid,text,jsonb)'::regprocedure
       AND prosecdef
       AND proconfig @> ARRAY['search_path=pg_catalog, public']::text[]
  ) THEN
    RAISE EXCEPTION 'profile access RPC is not a pinned SECURITY DEFINER function';
  END IF;

  v_definition := pg_get_functiondef(
    'public.guard_profile_governance()'::regprocedure
  );
  IF v_definition NOT ILIKE '%pg_advisory_xact_lock(61000, 1)%'
     OR v_definition NOT ILIKE '%Remove the superadmin role before suspending%' THEN
    RAISE EXCEPTION 'profile governance validation trigger lacks required guards';
  END IF;

  v_definition := pg_get_functiondef(
    'public.guard_profile_access_revocation()'::regprocedure
  );
  IF v_definition NOT ILIKE '%OLD.access_revoked_at IS NOT NULL%'
     OR v_definition NOT ILIKE '%NEW IS DISTINCT FROM OLD%'
     OR v_definition NOT ILIKE '%permanently revoked%'
     OR v_definition NOT ILIKE '%remove-access%'
     OR v_definition NOT ILIKE '%auth-user-delete%' THEN
    RAISE EXCEPTION 'profile access-revocation trigger lacks immutable attributed guards';
  END IF;

  v_definition := pg_get_functiondef(
    'public.admin_mutate_profile_access(uuid,uuid,text,jsonb)'::regprocedure
  );
  IF v_definition NOT ILIKE '%v_target.access_revoked_at IS NOT NULL%'
     OR v_definition NOT ILIKE '%access_revoked_at = clock_timestamp()%'
     OR v_definition NOT ILIKE '%access_revoked_by = p_actor_id%'
     OR v_definition NOT ILIKE '%DELETE FROM public.legal_acceptances%user_id = p_target_id%'
     OR v_definition NOT ILIKE '%DELETE FROM public.under_18_approvals%user_id = p_target_id%'
     OR v_definition NOT ILIKE '%UPDATE public.under_18_approvals%approved_by = NULL%approved_by = p_target_id%' THEN
    RAISE EXCEPTION 'profile access RPC lacks revocation or acknowledgement cleanup';
  END IF;

  v_definition := pg_get_functiondef(
    'public.update_profile_governance_state()'::regprocedure
  );
  IF v_definition NOT ILIKE '%pg_advisory_xact_lock(61000, 1)%'
     OR v_definition NOT ILIKE '%WHEN check_violation%'
     OR v_definition NOT ILIKE '%At least one active superadmin must remain%' THEN
    RAISE EXCEPTION 'profile governance state trigger lacks active-superadmin guards';
  END IF;

  v_definition := pg_get_functiondef(
    'public.prevent_profile_evidence_deletion()'::regprocedure
  );
  IF v_definition NOT ILIKE '%pg_constraint%'
     OR v_definition NOT ILIKE '%cannot be hard-deleted%' THEN
    RAISE EXCEPTION 'profile delete guard is not catalog-driven and fail closed';
  END IF;

  v_definition := pg_get_functiondef(
    'public.cleanup_profile_on_auth_delete()'::regprocedure
  );
  IF v_definition ILIKE '%DELETE FROM public.profiles%'
     OR v_definition NOT ILIKE '%suspended = true%'
     OR v_definition NOT ILIKE '%roles = ARRAY[''player'']%'
     OR v_definition NOT ILIKE '%access_revoked_at = clock_timestamp()%'
     OR v_definition NOT ILIKE '%access_revoked_by = OLD.id%'
     OR v_definition NOT ILIKE '%access_revoked_at IS NULL%'
     OR v_definition NOT ILIKE '%FROM public.profiles%FOR UPDATE%'
     OR v_definition NOT ILIKE '%DELETE FROM public.legal_acceptances%user_id = OLD.id%'
     OR v_definition NOT ILIKE '%DELETE FROM public.under_18_approvals%user_id = OLD.id%'
     OR v_definition NOT ILIKE '%UPDATE public.under_18_approvals%approved_by = NULL%approved_by = OLD.id%' THEN
    RAISE EXCEPTION 'Auth deletion lacks tombstoning or acknowledgement cleanup';
  END IF;
END;
$$;
