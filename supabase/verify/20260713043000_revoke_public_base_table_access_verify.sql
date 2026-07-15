-- Read-only verification for anonymous base-table revocation.

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'zltac_events', 'competitions', 'teams', 'legal_documents'
  ] LOOP
    IF has_table_privilege('anon', 'public.' || v_table, 'SELECT') THEN
      RAISE EXCEPTION 'anon still has base-table SELECT on public.%', v_table;
    END IF;
  END LOOP;

  IF has_table_privilege(
    'anon', 'public.public_competition_roster', 'SELECT'
  ) OR has_table_privilege(
    'authenticated', 'public.public_competition_roster', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'browser roles still have access to the legacy PII roster view';
  END IF;

  IF NOT has_table_privilege(
    'anon', 'public.public_zltac_events', 'SELECT'
  ) OR NOT has_table_privilege(
    'anon', 'public.public_competitions', 'SELECT'
  ) OR NOT has_table_privilege(
    'anon', 'public.public_zltac_teams', 'SELECT'
  ) OR NOT has_table_privilege(
    'anon', 'public.public_event_roster', 'SELECT'
  ) OR NOT has_table_privilege(
    'anon', 'public.public_competition_roster_safe', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'one or more masked anonymous views are unavailable';
  END IF;
END;
$$;
