-- Read-only verification for masked public discovery and roster views.

DO $$
DECLARE
  v_view text;
  v_definition text;
  v_forbidden_column text;
BEGIN
  FOREACH v_view IN ARRAY ARRAY[
    'public_zltac_events',
    'public_competitions',
    'public_zltac_teams',
    'public_event_roster',
    'public_competition_roster_safe'
  ] LOOP
    IF to_regclass('public.' || v_view) IS NULL THEN
      RAISE EXCEPTION 'required public view %.% is missing', 'public', v_view;
    END IF;

    IF NOT has_table_privilege('anon', 'public.' || v_view, 'SELECT')
      OR NOT has_table_privilege('authenticated', 'public.' || v_view, 'SELECT')
      OR NOT has_table_privilege('service_role', 'public.' || v_view, 'SELECT') THEN
      RAISE EXCEPTION 'public view % is not readable by browser roles', v_view;
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = v_view
         AND 'security_barrier=true' = ANY(COALESCE(c.reloptions, ARRAY[]::text[]))
    ) THEN
      RAISE EXCEPTION 'public view % is missing security_barrier=true', v_view;
    END IF;
  END LOOP;

  FOREACH v_forbidden_column IN ARRAY ARRAY[
    'bank_account_name', 'bank_bsb', 'bank_account_number',
    'created_by', 'archived_at', 'abbreviation'
  ] LOOP
    IF EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'public_competitions'
         AND column_name = v_forbidden_column
    ) THEN
      RAISE EXCEPTION 'public_competitions exposes forbidden column %', v_forbidden_column;
    END IF;
  END LOOP;

  FOREACH v_forbidden_column IN ARRAY ARRAY[
    'user_id', 'first_name', 'last_name', 'email', 'dob',
    'payment_reference', 'amount_paid', 'amount_owing', 'invite_status'
  ] LOOP
    IF EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('public_event_roster', 'public_competition_roster_safe')
         AND column_name = v_forbidden_column
    ) THEN
      RAISE EXCEPTION 'a public roster exposes forbidden column %', v_forbidden_column;
    END IF;
  END LOOP;

  v_definition := pg_get_viewdef('public.public_zltac_events'::regclass, true);
  IF v_definition NOT ILIKE '%status%open%closed%archived%'
    OR v_definition NOT ILIKE '%is_committee%' THEN
    RAISE EXCEPTION 'public_zltac_events visibility predicate is incomplete';
  END IF;

  v_definition := pg_get_viewdef('public.public_competitions'::regclass, true);
  IF v_definition NOT ILIKE '%archived_at IS NULL%'
    OR v_definition NOT ILIKE '%registration_close_at%now()%'
  THEN
    RAISE EXCEPTION 'public_competitions visibility predicate is incomplete';
  END IF;

  v_definition := pg_get_viewdef('public.public_event_roster'::regclass, true);
  IF v_definition NOT ILIKE '%cancelled%'
    OR v_definition NOT ILIKE '%approved%'
  THEN
    RAISE EXCEPTION 'public_event_roster lifecycle filters are incomplete';
  END IF;

  v_definition := pg_get_viewdef(
    'public.public_competition_roster_safe'::regclass, true
  );
  IF v_definition NOT ILIKE '%invite_status%accepted%'
    OR v_definition NOT ILIKE '%status%approved%'
    OR v_definition NOT ILIKE '%archived_at IS NULL%'
  THEN
    RAISE EXCEPTION 'public_competition_roster_safe filters are incomplete';
  END IF;

  v_definition := pg_get_viewdef(
    'public.public_competition_roster'::regclass, true
  );
  IF v_definition ILIKE '%JOIN%profiles%'
    OR v_definition NOT ILIKE '%NULL::uuid%user_id%'
    OR v_definition NOT ILIKE '%NULL::text%first_name%'
    OR v_definition NOT ILIKE '%NULL::text%last_name%'
  THEN
    RAISE EXCEPTION 'legacy competition roster compatibility view is not masked';
  END IF;
END;
$$;
