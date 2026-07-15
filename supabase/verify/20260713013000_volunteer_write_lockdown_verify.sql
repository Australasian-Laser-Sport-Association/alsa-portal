-- Verify Wave A volunteer write lockdown.

DO $$
DECLARE
  v_table text;
  v_contract_marker constant text :=
    'ADMIN_CONTENT_BROWSER_CONTRACT_660_APPLIED: actor-explicit, service-only committee content mutation; legacy browser grants are revoked.';
  v_contract_applied boolean := coalesce(
    obj_description(
      to_regprocedure('public.admin_mutate_content(uuid,text,text,uuid,jsonb,jsonb)'),
      'pg_proc'
    ) = v_contract_marker,
    false
  );
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'volunteer_roles',
    'event_volunteer_settings',
    'volunteer_signups',
    'volunteer_signup_roles'
  ] LOOP
    IF has_table_privilege(
      'authenticated', format('public.%I', v_table), 'INSERT'
    ) OR has_table_privilege(
      'authenticated', format('public.%I', v_table), 'UPDATE'
    ) OR has_table_privilege(
      'authenticated', format('public.%I', v_table), 'DELETE'
    ) THEN
      RAISE EXCEPTION 'authenticated still has a write privilege on public.%', v_table;
    END IF;

    IF v_contract_applied
       AND v_table IN ('volunteer_signups', 'volunteer_signup_roles') THEN
      IF has_any_column_privilege(
        'authenticated', format('public.%I', v_table), 'SELECT'
      ) THEN
        RAISE EXCEPTION 'server-only volunteer data remains browser-readable on public.%', v_table;
      END IF;
    ELSIF NOT has_table_privilege(
      'authenticated', format('public.%I', v_table), 'SELECT'
    ) THEN
      RAISE EXCEPTION 'authenticated SELECT was removed from public.%', v_table;
    END IF;

    IF NOT has_table_privilege(
      'service_role', format('public.%I', v_table), 'INSERT'
    ) OR NOT has_table_privilege(
      'service_role', format('public.%I', v_table), 'UPDATE'
    ) OR NOT has_table_privilege(
      'service_role', format('public.%I', v_table), 'DELETE'
    ) THEN
      RAISE EXCEPTION 'service_role volunteer writes were removed from public.%', v_table;
    END IF;
  END LOOP;
END;
$$;
