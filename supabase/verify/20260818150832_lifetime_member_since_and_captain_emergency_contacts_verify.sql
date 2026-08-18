DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'alsa_lifetime_members'
       AND column_name = 'member_since'
       AND data_type = 'date'
       AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'alsa_lifetime_members.member_since is missing or nullable';
  END IF;

  IF to_regprocedure(
    'public.create_zltac_captain_team(uuid,integer,text,text,text,text,text,text,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Event-specific captain emergency-contact overload is missing';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.create_zltac_captain_team(uuid,integer,text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated can execute the service-only captain registration overload';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.create_zltac_captain_team(uuid,integer,text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role cannot execute the captain registration overload';
  END IF;
END;
$$;
