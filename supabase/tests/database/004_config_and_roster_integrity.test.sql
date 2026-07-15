BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

UPDATE public.zltac_events SET status = 'draft' WHERE status = 'open';

INSERT INTO public.profiles (id, first_name, alias, dob, roles, suspended)
VALUES
  ('b1000000-0000-4000-8000-000000000001', 'Committee', 'ConfigCommittee', DATE '1980-01-01', ARRAY['zltac_committee','player']::text[], false),
  ('b1000000-0000-4000-8000-000000000002', 'Super', 'ConfigSuper', DATE '1980-01-02', ARRAY['superadmin','player']::text[], false),
  ('b1000000-0000-4000-8000-000000000003', 'Old Captain', 'ConfigOldCaptain', DATE '1990-01-01', ARRAY['player']::text[], false),
  ('b1000000-0000-4000-8000-000000000004', 'New Captain', 'ConfigNewCaptain', DATE '1990-01-02', ARRAY['player']::text[], false),
  ('b1000000-0000-4000-8000-000000000005', 'Player Three', 'ConfigPlayerThree', DATE '1990-01-03', ARRAY['player']::text[], false),
  ('b1000000-0000-4000-8000-000000000006', 'Player Four', 'ConfigPlayerFour', DATE '1990-01-04', ARRAY['player']::text[], false),
  ('b1000000-0000-4000-8000-000000000007', 'Player Five', 'ConfigPlayerFive', DATE '1990-01-05', ARRAY['player']::text[], false),
  ('b1000000-0000-4000-8000-000000000008', 'Suspended', 'ConfigSuspended', DATE '1990-01-06', ARRAY['player']::text[], true);

SELECT lives_ok(
  $$
    SELECT public.committee_save_zltac_event(
      'b1000000-0000-4000-8000-000000000001',
      NULL,
      '{"name":"Atomic create probe","year":2035,"status":"draft"}'::jsonb
    )
  $$,
  'event creation uses the same allowlisted configuration transaction'
);

INSERT INTO public.zltac_events (
  id, name, year, status, start_date, end_date, reg_open_date,
  reg_close_date, event_starts_at, main_fee, team_fee, side_events
) VALUES (
  'b2000000-0000-4000-8000-000000000001', 'Config fixture', 2197,
  'open', DATE '2197-07-01', DATE '2197-07-03',
  clock_timestamp() - interval '1 day', clock_timestamp() + interval '30 days',
  clock_timestamp() + interval '31 days', 1000, 500, '[]'::jsonb
);

INSERT INTO public.teams (
  id, name, captain_id, manager_id, event_id, status, state, format
) VALUES (
  'b3000000-0000-4000-8000-000000000001', 'Config Team',
  'b1000000-0000-4000-8000-000000000003',
  'b1000000-0000-4000-8000-000000000003',
  'b2000000-0000-4000-8000-000000000001', 'draft', 'NSW', 'team'
);

INSERT INTO public.zltac_registrations (id, user_id, year, team_id, status)
VALUES
  ('b4000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000003', 2197, 'b3000000-0000-4000-8000-000000000001', 'pending'),
  ('b4000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000004', 2197, 'b3000000-0000-4000-8000-000000000001', 'pending'),
  ('b4000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000005', 2197, 'b3000000-0000-4000-8000-000000000001', 'pending'),
  ('b4000000-0000-4000-8000-000000000006', 'b1000000-0000-4000-8000-000000000006', 2197, 'b3000000-0000-4000-8000-000000000001', 'pending'),
  ('b4000000-0000-4000-8000-000000000007', 'b1000000-0000-4000-8000-000000000007', 2197, 'b3000000-0000-4000-8000-000000000001', 'pending'),
  ('b4000000-0000-4000-8000-000000000008', 'b1000000-0000-4000-8000-000000000008', 2197, NULL, 'pending');

INSERT INTO public.team_members (
  team_id, user_id, roles, invite_status, responded_at
)
VALUES
  ('b3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000003', ARRAY['manager','captain','player']::text[], 'accepted', now()),
  ('b3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000004', ARRAY['player']::text[], 'accepted', now()),
  ('b3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000005', ARRAY['player']::text[], 'accepted', now()),
  ('b3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000006', ARRAY['player']::text[], 'accepted', now()),
  ('b3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000007', ARRAY['player']::text[], 'accepted', now());

SELECT throws_ok(
  $$
    SELECT public.committee_save_zltac_event(
      'b1000000-0000-4000-8000-000000000001',
      'b2000000-0000-4000-8000-000000000001',
      '{"main_fee":2500}'::jsonb
    )
  $$,
  '55000',
  'Pricing, requirements, capacity, side events, and registration windows are frozen once registrations exist or the event closes.',
  'event prices cannot race existing registrations'
);
SELECT is(
  (SELECT main_fee::bigint FROM public.zltac_events WHERE year = 2197),
  1000::bigint,
  'a rejected price update rolls back without repricing registrations'
);

SELECT lives_ok(
  $$
    SELECT public.committee_update_zltac_team(
      'b1000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001',
      '{"captain_id":"b1000000-0000-4000-8000-000000000004"}'::jsonb,
      'settings'
    )
  $$,
  'captain transfer and membership reconciliation are atomic'
);
SELECT is(
  (SELECT captain_id::text FROM public.teams WHERE id = 'b3000000-0000-4000-8000-000000000001'),
  'b1000000-0000-4000-8000-000000000004'::text,
  'the team owns the transferred captain'
);
SELECT ok(
  (SELECT 'captain' = ANY(roles) AND 'player' = ANY(roles)
     FROM public.team_members
    WHERE team_id = 'b3000000-0000-4000-8000-000000000001'
      AND user_id = 'b1000000-0000-4000-8000-000000000004'),
  'new captain has accepted captain/player membership'
);
SELECT ok(
  (SELECT NOT ('captain' = ANY(roles))
     FROM public.team_members
    WHERE team_id = 'b3000000-0000-4000-8000-000000000001'
      AND user_id = 'b1000000-0000-4000-8000-000000000003'),
  'old captain cannot retain stale captain authority'
);

UPDATE public.zltac_registrations SET team_id = NULL
 WHERE user_id = 'b1000000-0000-4000-8000-000000000007' AND year = 2197;
DELETE FROM public.team_members
 WHERE team_id = 'b3000000-0000-4000-8000-000000000001'
   AND user_id = 'b1000000-0000-4000-8000-000000000007';
SELECT throws_ok(
  $$
    SELECT public.captain_mutate_zltac_team(
      'b1000000-0000-4000-8000-000000000004',
      'b3000000-0000-4000-8000-000000000001',
      'b2000000-0000-4000-8000-000000000001',
      'submit',
      '{}'::jsonb
    )
  $$,
  '22023',
  'A team needs at least 5 eligible players to submit (currently 4).',
  'minimum eligible roster is checked inside the submission transaction'
);
UPDATE public.zltac_registrations
   SET team_id = 'b3000000-0000-4000-8000-000000000001'
 WHERE user_id = 'b1000000-0000-4000-8000-000000000007' AND year = 2197;
INSERT INTO public.team_members (team_id, user_id, roles, invite_status, responded_at)
VALUES (
  'b3000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000007',
  ARRAY['player']::text[], 'accepted', now()
);

SELECT lives_ok(
  $$
    SELECT public.captain_mutate_zltac_team(
      'b1000000-0000-4000-8000-000000000004',
      'b3000000-0000-4000-8000-000000000001',
      'b2000000-0000-4000-8000-000000000001',
      'submit',
      '{}'::jsonb
    )
  $$,
  'an eligible five-player roster submits atomically'
);
SELECT is(
  (SELECT status FROM public.teams WHERE id = 'b3000000-0000-4000-8000-000000000001'),
  'pending'::text,
  'successful submit changes status exactly once'
);

UPDATE public.teams SET status = 'draft'
 WHERE id = 'b3000000-0000-4000-8000-000000000001';
UPDATE public.zltac_registrations
   SET team_id = 'b3000000-0000-4000-8000-000000000001'
 WHERE user_id = 'b1000000-0000-4000-8000-000000000008' AND year = 2197;
INSERT INTO public.team_members (team_id, user_id, roles, invite_status, responded_at)
VALUES (
  'b3000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000008',
  ARRAY['player']::text[], 'accepted', now()
);

SELECT throws_ok(
  $$
    SELECT public.captain_mutate_zltac_team(
      'b1000000-0000-4000-8000-000000000004',
      'b3000000-0000-4000-8000-000000000001',
      'b2000000-0000-4000-8000-000000000001',
      'submit',
      '{}'::jsonb
    )
  $$,
  '23514',
  'The team roster contains an ineligible or inactive player.',
  'a suspended roster member prevents submission'
);
SELECT is(
  (SELECT status FROM public.teams WHERE id = 'b3000000-0000-4000-8000-000000000001'),
  'draft'::text,
  'failed submit cannot partially change team status'
);

SELECT throws_ok(
  $$
    SELECT public.committee_update_zltac_team(
      'b1000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001',
      '{"captain_id":"b1000000-0000-4000-8000-000000000008"}'::jsonb,
      'settings'
    )
  $$,
  '42501',
  'The captain must have an active player profile.',
  'invalid captain transfer rolls back all team/member changes'
);
SELECT is(
  (SELECT captain_id::text FROM public.teams WHERE id = 'b3000000-0000-4000-8000-000000000001'),
  'b1000000-0000-4000-8000-000000000004'::text,
  'failed captain transfer preserves prior ownership'
);

UPDATE public.teams SET status = 'approved'
 WHERE id = 'b3000000-0000-4000-8000-000000000001';
SELECT is(
  (SELECT count(*) FROM public.public_event_roster
    WHERE year = 2197 AND alias = 'ConfigSuspended'),
  0::bigint,
  'public ZLTAC roster excludes suspended profiles'
);

UPDATE public.zltac_events SET status = 'closed' WHERE year = 2197;
SELECT throws_ok(
  $$
    SELECT public.committee_update_zltac_team(
      'b1000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001',
      '{"format":"doubles"}'::jsonb,
      'settings'
    )
  $$,
  '55000',
  'Roster, status, and format changes require an open event.',
  'closed events deny roster/format mutations'
);
UPDATE public.zltac_events SET status = 'archived' WHERE year = 2197;
SELECT throws_ok(
  $$
    SELECT public.committee_update_zltac_team(
      'b1000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001',
      '{"name":"Late Name"}'::jsonb,
      'settings'
    )
  $$,
  '55000',
  'Archived event teams are immutable.',
  'archived event teams reject even cosmetic updates'
);

INSERT INTO public.competitions (
  id, slug, abbreviation, name, start_date, end_date,
  registration_open_at, registration_close_at, price_per_player,
  bank_account_name, bank_bsb, bank_account_number, payment_info_visible,
  created_by
) VALUES (
  'b5000000-0000-4000-8000-000000000001', 'config-competition', 'CFG',
  'Config Competition', DATE '2198-01-01', DATE '2198-01-02',
  clock_timestamp() - interval '1 day', clock_timestamp() + interval '30 days',
  2000, 'Private Account', '123-456', '987654', false,
  'b1000000-0000-4000-8000-000000000002'
), (
  'b5000000-0000-4000-8000-000000000002', 'config-public-suspended', 'CPS',
  'Suspended Competition', DATE '2198-02-01', DATE '2198-02-02',
  clock_timestamp() - interval '1 day', clock_timestamp() + interval '30 days',
  1000, 'Private Account', '123-456', '123123', false,
  'b1000000-0000-4000-8000-000000000002'
);

SELECT lives_ok(
  $$
    SELECT public.update_competition_config(
      'b1000000-0000-4000-8000-000000000002',
      'b5000000-0000-4000-8000-000000000001',
      '{"price_per_player":2500}'::jsonb
    )
  $$,
  'competition price can change before registration under the row lock'
);
INSERT INTO public.competition_registrations (competition_id, user_id)
VALUES
  ('b5000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000003'),
  ('b5000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000008');

SELECT throws_ok(
  $$
    SELECT public.update_competition_config(
      'b1000000-0000-4000-8000-000000000002',
      'b5000000-0000-4000-8000-000000000001',
      '{"price_per_player":3000}'::jsonb
    )
  $$,
  '55000',
  'Registration windows, price, payment settings, and abbreviation are frozen once registrations exist or registration closes.',
  'competition price cannot drift after a registration exists'
);
SELECT is(
  (SELECT price_per_player::bigint FROM public.competitions
    WHERE id = 'b5000000-0000-4000-8000-000000000001'),
  2500::bigint,
  'failed competition repricing preserves the billed price'
);
SELECT is(
  (SELECT count(*) FROM public.public_competition_roster_safe
    WHERE competition_id = 'b5000000-0000-4000-8000-000000000002'),
  0::bigint,
  'public competition roster excludes suspended profiles'
);

SELECT lives_ok(
  $$
    SELECT public.update_competition_config(
      'b1000000-0000-4000-8000-000000000002',
      'b5000000-0000-4000-8000-000000000001',
      '{"archived_at":"2199-01-01T00:00:00Z"}'::jsonb
    )
  $$,
  'superadmin can perform the one-way archive transition'
);
SELECT throws_ok(
  $$
    SELECT public.update_competition_config(
      'b1000000-0000-4000-8000-000000000002',
      'b5000000-0000-4000-8000-000000000001',
      '{"name":"Archived Edit"}'::jsonb
    )
  $$,
  '55000',
  'Archived competitions are immutable.',
  'archived competition configuration is immutable'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.competitions', 'SELECT'),
  'authenticated cannot select the competitions base table or its bank fields'
);
SELECT ok(
  has_table_privilege('authenticated', 'public.public_competitions', 'SELECT'),
  'authenticated retains masked competition discovery'
);
SELECT is(
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'public_competitions'
      AND column_name IN ('bank_account_name', 'bank_bsb', 'bank_account_number')),
  0::bigint,
  'masked competition discovery has no bank columns'
);
SELECT ok(
  pg_get_functiondef(
    'public.update_competition_config(uuid,uuid,jsonb)'::regprocedure
  ) ILIKE '%FOR UPDATE%',
  'competition config serializes concurrent edits under a row lock'
);
SELECT ok(
  pg_get_functiondef(
    'public.captain_mutate_zltac_team(uuid,uuid,uuid,text,jsonb)'::regprocedure
  ) ILIKE '%FOR UPDATE%',
  'captain submit serializes concurrent roster changes under event-first locks'
);

SELECT * FROM finish();
ROLLBACK;
