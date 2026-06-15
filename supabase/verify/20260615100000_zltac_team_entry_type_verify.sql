-- Run after 20260615100000_zltac_team_entry_type.sql.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'teams'
      AND column_name = 'entry_type'
  ) THEN
    RAISE EXCEPTION 'FAIL: public.teams.entry_type is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'create_zltac_captain_team'
      AND pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid, p_year integer, p_name text, p_entry_type text, p_state text, p_home_venue text, p_colour text, p_logo_url text'
  ) THEN
    RAISE EXCEPTION 'FAIL: create_zltac_captain_team with p_entry_type is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.teams
    WHERE entry_type IS NOT NULL
      AND entry_type NOT IN ('state_association', 'direct_entry')
  ) THEN
    RAISE EXCEPTION 'FAIL: invalid teams.entry_type value exists';
  END IF;

  RAISE NOTICE 'PASS: ZLTAC team entry type schema is ready';
END $$;
