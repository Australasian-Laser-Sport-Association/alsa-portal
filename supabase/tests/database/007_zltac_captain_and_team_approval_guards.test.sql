BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

UPDATE public.zltac_events SET status = 'draft' WHERE status = 'open';

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT
  format('62000000-0000-4000-8000-%s', lpad(number::text, 12, '0'))::uuid,
  format('captain-guard-%s@example.test', number),
  jsonb_build_object(
    'first_name', 'Guard',
    'last_name', number::text,
    'alias', format('CaptainGuard%s', number)
  )
FROM generate_series(1, 13) AS fixture(number);

UPDATE public.profiles
   SET dob = DATE '1990-01-01' + (substring(id::text FROM 25)::integer * interval '1 day'),
       roles = CASE
         WHEN id = '62000000-0000-4000-8000-000000000001'::uuid
           THEN ARRAY['zltac_committee', 'player']::text[]
         ELSE ARRAY['player']::text[]
       END
 WHERE id::text LIKE '62000000-0000-4000-8000-%';

UPDATE public.profiles
   SET suspended = true
 WHERE id = '62000000-0000-4000-8000-000000000010';

INSERT INTO public.zltac_events (
  id, name, year, status, reg_open_date, reg_close_date, event_starts_at,
  timezone, main_fee, team_fee
) VALUES (
  '62000000-0000-4000-8000-000000000020',
  'Pre-open captain guard', 2192, 'open',
  clock_timestamp() + interval '1 day',
  clock_timestamp() + interval '10 days',
  clock_timestamp() + interval '20 days',
  'Australia/Sydney', 1000, 500
);

SELECT throws_ok(
  $$
    SELECT public.create_zltac_captain_team(
      '62000000-0000-4000-8000-000000000002', 2192,
      'Too Early', 'direct_entry', 'NSW', NULL, NULL, NULL
    )
  $$,
  '55000',
  'The event is not open for roster changes.',
  'captain team creation rejects the pre-registration window'
);

UPDATE public.zltac_events SET status = 'draft' WHERE year = 2192;

INSERT INTO public.zltac_events (
  id, name, year, status, reg_open_date, reg_close_date, event_starts_at,
  timezone, main_fee, team_fee, processing_fee_pct, side_events
) VALUES (
  '62000000-0000-4000-8000-000000000021',
  'Captain and approval guard', 2193, 'open',
  clock_timestamp() - interval '1 day',
  clock_timestamp() + interval '10 days',
  clock_timestamp() + interval '20 days',
  'Australia/Sydney', 1000, 500, 0,
  '[{"slug":"doubles","name":"Doubles","enabled":true,"price":200}]'::jsonb
);

INSERT INTO public.teams (
  id, name, captain_id, manager_id, event_id, status, state, format
) VALUES
  (
    '62000000-0000-4000-8000-000000000100', 'Occupied Team',
    '62000000-0000-4000-8000-000000000004',
    '62000000-0000-4000-8000-000000000004',
    '62000000-0000-4000-8000-000000000021', 'pending', 'NSW', 'team'
  ),
  (
    '62000000-0000-4000-8000-000000000101', 'Target Team',
    '62000000-0000-4000-8000-000000000005',
    '62000000-0000-4000-8000-000000000005',
    '62000000-0000-4000-8000-000000000021', 'draft', 'VIC', 'team'
  ),
  (
    '62000000-0000-4000-8000-000000000102', 'Approval Team',
    '62000000-0000-4000-8000-000000000007',
    '62000000-0000-4000-8000-000000000007',
    '62000000-0000-4000-8000-000000000021', 'pending', 'QLD', 'team'
  );

INSERT INTO public.zltac_registrations (
  id, user_id, year, team_id, side_events, status,
  has_confirmed_side_events, has_confirmed_extras
) VALUES
  ('62000000-0000-4000-8000-000000000202', '62000000-0000-4000-8000-000000000002', 2193, NULL, ARRAY['doubles']::text[], 'confirmed', true, true),
  ('62000000-0000-4000-8000-000000000203', '62000000-0000-4000-8000-000000000003', 2193, NULL, ARRAY['doubles']::text[], 'confirmed', true, true),
  ('62000000-0000-4000-8000-000000000204', '62000000-0000-4000-8000-000000000004', 2193, '62000000-0000-4000-8000-000000000100', NULL, 'pending', false, false),
  ('62000000-0000-4000-8000-000000000205', '62000000-0000-4000-8000-000000000005', 2193, '62000000-0000-4000-8000-000000000101', NULL, 'pending', false, false),
  ('62000000-0000-4000-8000-000000000206', '62000000-0000-4000-8000-000000000006', 2193, '62000000-0000-4000-8000-000000000100', NULL, 'pending', false, false),
  ('62000000-0000-4000-8000-000000000207', '62000000-0000-4000-8000-000000000007', 2193, '62000000-0000-4000-8000-000000000102', NULL, 'pending', false, false),
  ('62000000-0000-4000-8000-000000000208', '62000000-0000-4000-8000-000000000008', 2193, '62000000-0000-4000-8000-000000000102', NULL, 'pending', false, false),
  ('62000000-0000-4000-8000-000000000209', '62000000-0000-4000-8000-000000000009', 2193, '62000000-0000-4000-8000-000000000102', NULL, 'pending', false, false),
  ('62000000-0000-4000-8000-000000000210', '62000000-0000-4000-8000-000000000010', 2193, NULL, NULL, 'pending', false, false),
  ('62000000-0000-4000-8000-000000000211', '62000000-0000-4000-8000-000000000011', 2193, NULL, NULL, 'cancelled', false, false),
  ('62000000-0000-4000-8000-000000000212', '62000000-0000-4000-8000-000000000012', 2193, '62000000-0000-4000-8000-000000000102', NULL, 'pending', false, false),
  ('62000000-0000-4000-8000-000000000213', '62000000-0000-4000-8000-000000000013', 2193, NULL, NULL, 'pending', false, false);

INSERT INTO public.team_members (team_id, user_id, roles, invite_status, responded_at)
VALUES
  ('62000000-0000-4000-8000-000000000100', '62000000-0000-4000-8000-000000000004', ARRAY['manager','captain','player']::text[], 'accepted', now()),
  ('62000000-0000-4000-8000-000000000100', '62000000-0000-4000-8000-000000000006', ARRAY['player']::text[], 'accepted', now()),
  ('62000000-0000-4000-8000-000000000101', '62000000-0000-4000-8000-000000000005', ARRAY['manager','captain','player']::text[], 'accepted', now()),
  ('62000000-0000-4000-8000-000000000102', '62000000-0000-4000-8000-000000000007', ARRAY['manager','captain','player']::text[], 'accepted', now()),
  ('62000000-0000-4000-8000-000000000102', '62000000-0000-4000-8000-000000000008', ARRAY['player']::text[], 'accepted', now()),
  ('62000000-0000-4000-8000-000000000102', '62000000-0000-4000-8000-000000000009', ARRAY['player']::text[], 'accepted', now()),
  ('62000000-0000-4000-8000-000000000102', '62000000-0000-4000-8000-000000000012', ARRAY['player']::text[], 'accepted', now());

INSERT INTO public.doubles_pairs (
  id, event_year, player1_id, player2_id, confirmed
) VALUES (
  '62000000-0000-4000-8000-000000000300', 2193,
  '62000000-0000-4000-8000-000000000002',
  '62000000-0000-4000-8000-000000000003', true
);

SELECT lives_ok(
  $$
    SELECT public.create_zltac_captain_team(
      '62000000-0000-4000-8000-000000000002', 2193,
      'Preserved Team', 'direct_entry', 'NSW', 'Home', '#00FF41', NULL
    )
  $$,
  'captain team creation accepts an existing unassigned registration'
);
SELECT is(
  (SELECT status || ':' || array_to_string(side_events, ',') || ':'
          || has_confirmed_side_events || ':' || has_confirmed_extras
     FROM public.zltac_registrations
    WHERE id = '62000000-0000-4000-8000-000000000202'),
  'confirmed:doubles:true:true'::text,
  'team creation preserves registration status, selections, and confirmations'
);
SELECT is(
  (SELECT amount_owing::bigint FROM public.zltac_registrations
    WHERE id = '62000000-0000-4000-8000-000000000202'),
  1700::bigint,
  'team creation recalculates owing without discarding selected side events'
);
SELECT is(
  (SELECT count(*) FROM public.doubles_pairs
    WHERE id = '62000000-0000-4000-8000-000000000300'),
  1::bigint,
  'team creation preserves the normalized doubles roster'
);

UPDATE public.teams
   SET status = 'pending'
 WHERE id = (
   SELECT team_id FROM public.zltac_registrations
    WHERE id = '62000000-0000-4000-8000-000000000202'
 );
SELECT throws_ok(
  $$
    SELECT public.create_zltac_captain_team(
      '62000000-0000-4000-8000-000000000002', 2193,
      'Second Team', 'direct_entry', 'NSW', NULL, NULL, NULL
    )
  $$,
  '23514',
  'This registration already belongs to a team.',
  'captain creation cannot move a registration out of a locked team'
);
SELECT is(
  (SELECT count(*) FROM public.teams WHERE event_id = '62000000-0000-4000-8000-000000000021'),
  4::bigint,
  'failed duplicate creation cannot leave an extra team'
);

SELECT throws_ok(
  $$
    SELECT public.add_zltac_team_player(
      '62000000-0000-4000-8000-000000000005',
      '62000000-0000-4000-8000-000000000006',
      '62000000-0000-4000-8000-000000000101', 2193
    )
  $$,
  '23514',
  'This player already belongs to a team.',
  'add-player cannot steal a registration from another pending team'
);
SELECT is(
  (SELECT team_id::text FROM public.zltac_registrations
    WHERE id = '62000000-0000-4000-8000-000000000206'),
  '62000000-0000-4000-8000-000000000100'::text,
  'rejected cross-team move preserves the original team'
);

SELECT throws_ok(
  $$
    SELECT public.add_zltac_team_player(
      '62000000-0000-4000-8000-000000000005',
      '62000000-0000-4000-8000-000000000010',
      '62000000-0000-4000-8000-000000000101', 2193
    )
  $$,
  '42501',
  'The player must have an active portal profile.',
  'add-player rejects suspended profiles'
);
SELECT throws_ok(
  $$
    SELECT public.add_zltac_team_player(
      '62000000-0000-4000-8000-000000000005',
      '62000000-0000-4000-8000-000000000011',
      '62000000-0000-4000-8000-000000000101', 2193
    )
  $$,
  '23514',
  'Only an active event registration can join a team.',
  'add-player rejects cancelled registrations'
);

SELECT throws_ok(
  $$
    SELECT public.committee_update_zltac_team(
      '62000000-0000-4000-8000-000000000001',
      '62000000-0000-4000-8000-000000000102',
      '{"status":"approved"}'::jsonb, 'settings'
    )
  $$,
  '22023',
  'Team status is changed only through the dedicated review action.',
  'generic team settings cannot approve a team'
);
SELECT throws_ok(
  $$
    SELECT public.committee_update_zltac_team(
      '62000000-0000-4000-8000-000000000001',
      '62000000-0000-4000-8000-000000000102',
      '{"status":"approved"}'::jsonb, 'review'
    )
  $$,
  '23514',
  'A team needs at least 5 eligible players for approval (currently 4).',
  'committee approval rechecks the minimum eligible roster'
);

UPDATE public.zltac_registrations
   SET team_id = '62000000-0000-4000-8000-000000000102'
 WHERE id = '62000000-0000-4000-8000-000000000210';
INSERT INTO public.team_members (team_id, user_id, roles, invite_status, responded_at)
VALUES (
  '62000000-0000-4000-8000-000000000102',
  '62000000-0000-4000-8000-000000000010',
  ARRAY['player']::text[], 'accepted', now()
);
SELECT throws_ok(
  $$
    SELECT public.committee_update_zltac_team(
      '62000000-0000-4000-8000-000000000001',
      '62000000-0000-4000-8000-000000000102',
      '{"status":"approved"}'::jsonb, 'review'
    )
  $$,
  '23514',
  'The team roster contains an ineligible or inactive player.',
  'committee approval rejects a suspended roster member'
);

DELETE FROM public.team_members
 WHERE team_id = '62000000-0000-4000-8000-000000000102'
   AND user_id = '62000000-0000-4000-8000-000000000010';
UPDATE public.zltac_registrations SET team_id = NULL
 WHERE id = '62000000-0000-4000-8000-000000000210';
UPDATE public.zltac_registrations
   SET team_id = '62000000-0000-4000-8000-000000000102'
 WHERE id = '62000000-0000-4000-8000-000000000213';
INSERT INTO public.team_members (team_id, user_id, roles, invite_status, responded_at)
VALUES (
  '62000000-0000-4000-8000-000000000102',
  '62000000-0000-4000-8000-000000000013',
  ARRAY['player']::text[], 'accepted', now()
);

SELECT lives_ok(
  $$
    SELECT public.committee_update_zltac_team(
      '62000000-0000-4000-8000-000000000001',
      '62000000-0000-4000-8000-000000000102',
      '{"status":"approved"}'::jsonb, 'review'
    )
  $$,
  'committee can approve an eligible five-player pending roster'
);
SELECT is(
  (SELECT status FROM public.teams
    WHERE id = '62000000-0000-4000-8000-000000000102'),
  'approved'::text,
  'successful dedicated review stores approved status'
);

SELECT * FROM finish();
ROLLBACK;
