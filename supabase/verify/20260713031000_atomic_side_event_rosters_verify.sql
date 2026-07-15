-- Verify Wave B atomic doubles/triples roster workflows.

DO $$
DECLARE
  v_trigger_count integer;
  v_unique_source text;
  v_sync_source text;
  v_context_source text;
  v_doubles_source text;
  v_triples_source text;
BEGIN
  IF to_regprocedure(
    'public.mutate_zltac_doubles_roster(uuid,text,integer,uuid,uuid)'
  ) IS NULL OR to_regprocedure(
    'public.mutate_zltac_triples_roster(uuid,text,integer,uuid,integer,uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION 'A side-event roster RPC is missing';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.mutate_zltac_doubles_roster(uuid,text,integer,uuid,uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.mutate_zltac_triples_roster(uuid,text,integer,uuid,integer,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role cannot execute both side-event roster RPCs';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.mutate_zltac_doubles_roster(uuid,text,integer,uuid,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.mutate_zltac_doubles_roster(uuid,text,integer,uuid,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.mutate_zltac_triples_roster(uuid,text,integer,uuid,integer,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.mutate_zltac_triples_roster(uuid,text,integer,uuid,integer,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'A browser role can execute a service-only side-event RPC';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public._lock_zltac_side_event_context(integer,text,uuid[])',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public._set_zltac_side_event_membership(uuid,integer,text,boolean)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.enforce_side_event_roster_unique_member()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'An internal side-event function is browser-executable';
  END IF;

  SELECT count(*)
    INTO v_trigger_count
    FROM pg_trigger trigger_row
   WHERE NOT trigger_row.tgisinternal
     AND trigger_row.tgenabled <> 'D'
     AND trigger_row.tgname IN (
       'doubles_pairs_unique_member_all_positions',
       'triples_teams_unique_member_all_positions'
     );
  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION 'Expected 2 enabled cross-position uniqueness triggers, found %', v_trigger_count;
  END IF;

  SELECT count(*)
    INTO v_trigger_count
    FROM pg_trigger trigger_row
   WHERE NOT trigger_row.tgisinternal
     AND trigger_row.tgenabled <> 'D'
     AND trigger_row.tgname IN (
       'doubles_pairs_sync_normalized_members',
       'triples_teams_sync_normalized_members'
     );
  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION 'Expected 2 enabled normalized-membership triggers, found %', v_trigger_count;
  END IF;

  IF to_regclass('public.zltac_side_event_roster_members') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_class table_row
       WHERE table_row.oid = 'public.zltac_side_event_roster_members'::regclass
         AND table_row.relrowsecurity
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conrelid = 'public.zltac_side_event_roster_members'::regclass
         AND contype = 'p'
         AND convalidated
     ) THEN
    RAISE EXCEPTION 'The normalized side-event membership invariant is missing or not RLS-protected';
  END IF;

  IF has_table_privilege(
    'authenticated', 'public.zltac_side_event_roster_members', 'SELECT'
  ) OR has_table_privilege(
    'authenticated', 'public.zltac_side_event_roster_members', 'INSERT'
  ) OR has_table_privilege(
    'authenticated', 'public.zltac_side_event_roster_members', 'UPDATE'
  ) OR has_table_privilege(
    'authenticated', 'public.zltac_side_event_roster_members', 'DELETE'
  ) OR NOT has_table_privilege(
    'service_role', 'public.zltac_side_event_roster_members', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'Normalized side-event membership table grants are unsafe';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.doubles_pairs'::regclass
      AND conname = 'doubles_pairs_confirmation_coherent'
      AND contype = 'c'
      AND convalidated
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.triples_teams'::regclass
      AND conname = 'triples_teams_confirmation_coherent'
      AND contype = 'c'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'A validated side-event confirmation invariant is missing';
  END IF;

  SELECT prosrc INTO v_unique_source
  FROM pg_proc
  WHERE oid = 'public.enforce_side_event_roster_unique_member()'::regprocedure;
  SELECT prosrc INTO v_sync_source
  FROM pg_proc
  WHERE oid = 'public.sync_zltac_side_event_roster_members()'::regprocedure;
  SELECT prosrc INTO v_context_source
  FROM pg_proc
  WHERE oid = 'public._lock_zltac_side_event_context(integer,text,uuid[])'::regprocedure;
  SELECT prosrc INTO v_doubles_source
  FROM pg_proc
  WHERE oid = 'public.mutate_zltac_doubles_roster(uuid,text,integer,uuid,uuid)'::regprocedure;
  SELECT prosrc INTO v_triples_source
  FROM pg_proc
  WHERE oid = 'public.mutate_zltac_triples_roster(uuid,text,integer,uuid,integer,uuid)'::regprocedure;

  -- Concurrency-oriented assertions: every write is serialized by per-member
  -- transaction locks, and the workflow locks shared rows before mutation.
  IF position('pg_advisory_xact_lock' IN v_unique_source) = 0
     OR position('zltac_side_event_roster_members' IN v_sync_source) = 0
     OR position('FOR UPDATE' IN upper(v_context_source)) = 0
     OR position('_lock_zltac_side_event_context' IN v_doubles_source) = 0
     OR position('_set_zltac_side_event_membership' IN v_doubles_source) = 0
     OR position('_lock_zltac_side_event_context' IN v_triples_source) = 0
     OR position('_set_zltac_side_event_membership' IN v_triples_source) = 0 THEN
    RAISE EXCEPTION 'A side-event workflow lost its row-lock or atomic membership guard';
  END IF;

  IF EXISTS (
    WITH expected AS (
      SELECT 'doubles'::text AS format, pair.event_year, members.member_id, pair.id AS roster_id, members.slot
      FROM public.doubles_pairs pair
      CROSS JOIN LATERAL (
        VALUES (pair.player1_id, 1::smallint), (pair.player2_id, 2::smallint)
      ) AS members(member_id, slot)
      WHERE members.member_id IS NOT NULL
      UNION ALL
      SELECT 'triples', team.event_year, members.member_id, team.id, members.slot
      FROM public.triples_teams team
      CROSS JOIN LATERAL (
        VALUES
          (team.player1_id, 1::smallint),
          (team.player2_id, 2::smallint),
          (team.player3_id, 3::smallint)
      ) AS members(member_id, slot)
      WHERE members.member_id IS NOT NULL
    ), drift AS (
      (SELECT * FROM expected
       EXCEPT
       SELECT format, event_year, member_id, roster_id, slot
       FROM public.zltac_side_event_roster_members)
      UNION ALL
      (SELECT format, event_year, member_id, roster_id, slot
       FROM public.zltac_side_event_roster_members
       EXCEPT
       SELECT * FROM expected)
    )
    SELECT 1 FROM drift
  ) THEN
    RAISE EXCEPTION 'Normalized side-event membership rows have drifted from rosters';
  END IF;

  IF has_table_privilege('authenticated', 'public.doubles_pairs', 'INSERT')
     OR has_table_privilege('authenticated', 'public.doubles_pairs', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.doubles_pairs', 'DELETE')
     OR has_table_privilege('authenticated', 'public.triples_teams', 'INSERT')
     OR has_table_privilege('authenticated', 'public.triples_teams', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.triples_teams', 'DELETE') THEN
    RAISE EXCEPTION 'Authenticated direct side-event roster writes are enabled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT event_year, member_id
      FROM (
        SELECT event_year, player1_id AS member_id FROM public.doubles_pairs
        UNION ALL
        SELECT event_year, player2_id AS member_id FROM public.doubles_pairs
      ) members
      WHERE member_id IS NOT NULL
      GROUP BY event_year, member_id
      HAVING count(*) > 1
    ) duplicates
  ) OR EXISTS (
    SELECT 1
    FROM (
      SELECT event_year, member_id
      FROM (
        SELECT event_year, player1_id AS member_id FROM public.triples_teams
        UNION ALL
        SELECT event_year, player2_id AS member_id FROM public.triples_teams
        UNION ALL
        SELECT event_year, player3_id AS member_id FROM public.triples_teams
      ) members
      WHERE member_id IS NOT NULL
      GROUP BY event_year, member_id
      HAVING count(*) > 1
    ) duplicates
  ) THEN
    RAISE EXCEPTION 'A player appears in multiple positions for one format/year';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.doubles_pairs
    WHERE confirmed AND (player1_id IS NULL OR player2_id IS NULL)
  ) OR EXISTS (
    SELECT 1
    FROM public.triples_teams
    WHERE (player2_confirmed AND player2_id IS NULL)
       OR (player3_confirmed AND player3_id IS NULL)
       OR (
         confirmed
         AND (
           player1_id IS NULL
           OR player2_id IS NULL
           OR player3_id IS NULL
           OR NOT player2_confirmed
           OR NOT player3_confirmed
         )
       )
  ) THEN
    RAISE EXCEPTION 'A roster has incoherent confirmation state';
  END IF;

  RAISE NOTICE 'PASS: side-event rosters are service-only, transactional, serialized, and coherent';
END;
$$;

-- Adversarial inventory. Every row_count must remain zero. These queries cover
-- cancelled/wrong-year participant references that old API prechecks missed.
SELECT 'doubles_missing_or_cancelled_registration' AS check_name, count(*) AS row_count
FROM (
  SELECT pair.event_year, member_id
  FROM public.doubles_pairs pair
  CROSS JOIN LATERAL unnest(
    ARRAY[pair.player1_id, pair.player2_id]::uuid[]
  ) AS members(member_id)
  WHERE member_id IS NOT NULL
) roster
LEFT JOIN public.zltac_registrations registration
  ON registration.year = roster.event_year
 AND registration.user_id = roster.member_id
 AND registration.status IN ('pending', 'confirmed')
WHERE registration.id IS NULL
UNION ALL
SELECT 'triples_missing_or_cancelled_registration', count(*)
FROM (
  SELECT team.event_year, member_id
  FROM public.triples_teams team
  CROSS JOIN LATERAL unnest(
    ARRAY[team.player1_id, team.player2_id, team.player3_id]::uuid[]
  ) AS members(member_id)
  WHERE member_id IS NOT NULL
) roster
LEFT JOIN public.zltac_registrations registration
  ON registration.year = roster.event_year
 AND registration.user_id = roster.member_id
 AND registration.status IN ('pending', 'confirmed')
WHERE registration.id IS NULL
UNION ALL
SELECT 'doubles_disabled_for_event', count(*)
FROM public.doubles_pairs roster
JOIN public.zltac_events event ON event.year = roster.event_year
WHERE NOT EXISTS (
  SELECT 1
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(coalesce(event.side_events, '[]'::jsonb)) = 'array'
        THEN coalesce(event.side_events, '[]'::jsonb)
      ELSE '[]'::jsonb
    END
  ) side_event(item)
  WHERE side_event.item->>'slug' = 'doubles'
    AND coalesce((side_event.item->>'enabled')::boolean, false)
)
UNION ALL
SELECT 'triples_disabled_for_event', count(*)
FROM public.triples_teams roster
JOIN public.zltac_events event ON event.year = roster.event_year
WHERE NOT EXISTS (
  SELECT 1
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(coalesce(event.side_events, '[]'::jsonb)) = 'array'
        THEN coalesce(event.side_events, '[]'::jsonb)
      ELSE '[]'::jsonb
    END
  ) side_event(item)
  WHERE side_event.item->>'slug' = 'triples'
    AND coalesce((side_event.item->>'enabled')::boolean, false)
);
