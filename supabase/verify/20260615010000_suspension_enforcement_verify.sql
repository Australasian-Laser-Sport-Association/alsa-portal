-- Run after 20260615010000_suspension_enforcement.sql.

DO $$
DECLARE
  missing_count integer;
  unnecessary_count integer;
BEGIN
  IF has_function_privilege('authenticated', 'public.claim_placeholder_profile(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can still execute claim_placeholder_profile directly';
  END IF;

  SELECT count(*) INTO missing_count
  FROM (
    VALUES
      ('INSERT', 'active_user_insert'),
      ('UPDATE', 'active_user_update'),
      ('DELETE', 'active_user_delete')
  ) AS operation(privilege_name, policy_name)
  CROSS JOIN pg_policies writable
  WHERE writable.schemaname = 'public'
    AND writable.permissive = 'PERMISSIVE'
    AND writable.cmd IN (operation.privilege_name, 'ALL')
    AND writable.roles && ARRAY['public', 'authenticated']::name[]
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = writable.schemaname
        AND p.tablename = writable.tablename
        AND p.policyname = operation.policy_name
        AND p.cmd = operation.privilege_name
        AND p.permissive = 'RESTRICTIVE'
    );

  IF missing_count > 0 THEN
    RAISE EXCEPTION '% authenticated write paths lack suspension policies', missing_count;
  END IF;

  SELECT count(*) INTO unnecessary_count
  FROM pg_policies restrictive
  WHERE restrictive.schemaname = 'public'
    AND restrictive.policyname IN ('active_user_insert', 'active_user_update', 'active_user_delete')
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies writable
      WHERE writable.schemaname = restrictive.schemaname
        AND writable.tablename = restrictive.tablename
        AND writable.permissive = 'PERMISSIVE'
        AND writable.cmd IN (restrictive.cmd, 'ALL')
        AND writable.roles && ARRAY['public', 'authenticated']::name[]
    );

  IF unnecessary_count > 0 THEN
    RAISE EXCEPTION '% suspension policies exist without an authenticated write path', unnecessary_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'active_user_update'
      AND permissive = 'RESTRICTIVE'
  ) THEN
    RAISE EXCEPTION 'storage.objects lacks suspension enforcement';
  END IF;

  RAISE NOTICE 'PASS: suspension enforcement invariants hold';
END $$;

-- Exercise representative browser-side writes in a transaction that is always
-- rolled back: signup profile creation, player registration, captain team
-- management, advisor committee CRUD, and suspended-user denial.
BEGIN;

INSERT INTO auth.users (
  id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at
) VALUES
  (
    '10000000-0000-0000-0000-000000000001',
    'active-verify@example.test',
    '{"first_name":"Active","last_name":"User","alias":"ActiveVerify"}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    'advisor-verify@example.test',
    '{"first_name":"Advisor","last_name":"User","alias":"AdvisorVerify"}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = '10000000-0000-0000-0000-000000000001'
      AND roles = ARRAY['player']::text[]
      AND suspended = false
  ) THEN
    RAISE EXCEPTION 'signup did not create an active player profile';
  END IF;
END $$;

UPDATE public.profiles
SET roles = ARRAY['advisor']::text[]
WHERE id = '10000000-0000-0000-0000-000000000002';

INSERT INTO public.zltac_events (
  id, name, year, status, reg_open_date, reg_close_date,
  max_teams, max_players, max_players_per_team
) VALUES (
  '20000000-0000-0000-0000-000000000001',
  'Verification Event',
  2099,
  'closed',
  now() - interval '1 day',
  now() + interval '1 day',
  10,
  100,
  8
);

SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

UPDATE public.profiles
SET phone = '0400000000'
WHERE id = '10000000-0000-0000-0000-000000000001';

INSERT INTO public.zltac_registrations (user_id, year, status)
VALUES ('10000000-0000-0000-0000-000000000001', 2099, 'pending');

UPDATE public.zltac_registrations
SET side_events = ARRAY['solos']::text[],
    has_confirmed_side_events = true
WHERE user_id = '10000000-0000-0000-0000-000000000001'
  AND year = 2099;

INSERT INTO public.teams (
  id, name, captain_id, manager_id, event_id, format, status, state
) VALUES (
  '30000000-0000-0000-0000-000000000001',
  'Verification Team',
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'team',
  'draft',
  'VIC'
);

UPDATE public.teams
SET home_venue = 'Verification Arena'
WHERE id = '30000000-0000-0000-0000-000000000001';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND phone = '0400000000'
  ) THEN
    RAISE EXCEPTION 'active signup user could not update their profile';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.zltac_registrations
    WHERE user_id = auth.uid()
      AND year = 2099
      AND has_confirmed_side_events
  ) THEN
    RAISE EXCEPTION 'active player registration insert/update failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.teams
    WHERE captain_id = auth.uid()
      AND home_venue = 'Verification Arena'
  ) THEN
    RAISE EXCEPTION 'active captain team insert/update failed';
  END IF;
END $$;

RESET ROLE;
SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000002',
  true
);
SET LOCAL ROLE authenticated;

INSERT INTO public.document_categories (id, scope, name)
VALUES (
  '40000000-0000-0000-0000-000000000001',
  'alsa',
  'Advisor Verification'
);
UPDATE public.document_categories
SET sort_order = 1
WHERE id = '40000000-0000-0000-0000-000000000001';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.document_categories
    WHERE id = '40000000-0000-0000-0000-000000000001'
      AND sort_order = 1
  ) THEN
    RAISE EXCEPTION 'active advisor could not perform committee writes';
  END IF;
END $$;

DELETE FROM public.document_categories
WHERE id = '40000000-0000-0000-0000-000000000001';

RESET ROLE;
UPDATE public.profiles
SET suspended = true
WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.profiles
  SET phone = '0499999999'
  WHERE id = auth.uid();
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'suspended user updated their profile';
  END IF;
END $$;

RESET ROLE;
ROLLBACK;

DO $$
BEGIN
  RAISE NOTICE 'PASS: active signup/player/captain/advisor writes succeed and suspended writes fail';
END $$;
