BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

-- Exercise privileges as the same database role used by an authenticated JWT.
SET LOCAL ROLE authenticated;

SELECT throws_matching(
  $$
    INSERT INTO public.zltac_registrations (user_id, year)
    VALUES ('10000000-0000-4000-8000-000000000001', 2097)
  $$,
  'permission denied for table zltac_registrations',
  'a browser cannot forge a ZLTAC registration'
);

SELECT throws_matching(
  $$
    INSERT INTO public.teams (name)
    VALUES ('Forged browser team')
  $$,
  'permission denied for table teams',
  'a browser cannot create or self-approve a team directly'
);

SELECT throws_matching(
  $$
    INSERT INTO public.under_18_approvals (user_id, event_year)
    VALUES ('10000000-0000-4000-8000-000000000001', 2097)
  $$,
  'permission denied for table under_18_approvals',
  'a browser cannot self-approve or rewrite under-18 evidence'
);

SELECT throws_matching(
  $$
    INSERT INTO public.competition_registrations (competition_id, user_id)
    VALUES (
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001'
    )
  $$,
  'permission denied for table competition_registrations',
  'a browser cannot bypass the locked competition registration workflow'
);

SELECT throws_matching(
  $$
    INSERT INTO public.team_members (team_id, user_id)
    VALUES (
      '30000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001'
    )
  $$,
  'permission denied for table team_members',
  'a browser cannot forge a team invitation or accepted membership'
);

SELECT throws_matching(
  $$
    INSERT INTO public.volunteer_signups (registration_id)
    VALUES ('40000000-0000-4000-8000-000000000001')
  $$,
  'permission denied for table volunteer_signups',
  'a browser cannot bypass the volunteer signup endpoint'
);

RESET ROLE;

-- Isolated fixture identities. auth.users insertion exercises the real signup
-- trigger rather than constructing a profile that cannot exist in production.
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  'release-gate@example.test',
  jsonb_build_object(
    'first_name', 'Release',
    'last_name', 'Gate',
    'alias', 'ReleaseGate',
    'dob', '1990-01-01',
    'state', 'NSW'
  )
);

SELECT is(
  (
    SELECT email
    FROM public.profiles
    WHERE id = '10000000-0000-4000-8000-000000000001'
  ),
  'release-gate@example.test'::text,
  'fixture signup produced the canonical profile mirror'
);

INSERT INTO public.zltac_events (
  id, name, year, status, start_date, end_date, event_starts_at, timezone
) VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    'Release Gate Open Event',
    2097,
    'open',
    DATE '2097-07-01',
    DATE '2097-07-03',
    TIMESTAMPTZ '2097-06-30 22:00:00+00',
    'Australia/Sydney'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'Release Gate Closed Event',
    2098,
    'closed',
    DATE '2098-07-01',
    DATE '2098-07-03',
    TIMESTAMPTZ '2098-06-30 22:00:00+00',
    'Australia/Sydney'
  );

INSERT INTO public.teams (
  id, name, captain_id, manager_id, event_id, format, status, entry_type, state
) VALUES (
  '30000000-0000-4000-8000-000000000001',
  'Release Gate Team',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'team',
  'approved',
  'direct_entry',
  'NSW'
);

INSERT INTO public.zltac_registrations (
  id, user_id, team_id, year, status
) VALUES (
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  2097,
  'pending'
);

INSERT INTO public.team_members (
  id, team_id, user_id, roles, invite_status, responded_at
) VALUES (
  '50000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  ARRAY['manager', 'captain', 'player']::text[],
  'accepted',
  clock_timestamp()
);

INSERT INTO public.competitions (
  id, slug, name, start_date, end_date,
  registration_open_at, registration_close_at,
  price_per_player, created_by
) VALUES (
  '60000000-0000-4000-8000-000000000001',
  'release-gate-closed',
  'Release Gate Closed Competition',
  current_date + 30,
  current_date + 31,
  clock_timestamp() - interval '2 days',
  clock_timestamp() - interval '1 day',
  2500,
  '10000000-0000-4000-8000-000000000001'
);

SELECT throws_ok(
  $$
    SELECT public.register_for_competition(
      '10000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000001'
    )
  $$,
  '55000',
  'Registration has closed for this competition.',
  'closed competitions reject registration mutations atomically'
);

INSERT INTO public.alsa_membership_periods (
  id, label, starts_at, ends_at
) VALUES (
  '70000000-0000-4000-8000-000000000001',
  'Release Gate A',
  DATE '2090-01-01',
  DATE '2091-01-01'
);

SELECT lives_ok(
  $$
    INSERT INTO public.alsa_membership_periods (
      id, label, starts_at, ends_at
    ) VALUES (
      '70000000-0000-4000-8000-000000000002',
      'Release Gate Adjacent',
      DATE '2091-01-01',
      DATE '2092-01-01'
    )
  $$,
  'adjacent half-open membership periods remain valid'
);

SELECT throws_ok(
  $$
    INSERT INTO public.alsa_membership_periods (
      id, label, starts_at, ends_at
    ) VALUES (
      '70000000-0000-4000-8000-000000000003',
      'Release Gate Overlap',
      DATE '2090-12-31',
      DATE '2091-06-01'
    )
  $$,
  '23P01',
  'ALSA membership periods must not overlap',
  'overlapping membership periods fail closed'
);

INSERT INTO public.legal_documents (
  id, document_type, version, file_path, original_filename,
  effective_date, uploaded_by, is_active, requires_reacceptance,
  content_sha256, object_size, published_at
) VALUES
  (
    '80000000-0000-4000-8000-000000000001',
    'code_of_conduct',
    9001,
    'legal/code_of_conduct/80000000-0000-4000-8000-000000000001.pdf',
    'release-gate-code.pdf',
    current_date,
    '10000000-0000-4000-8000-000000000001',
    true,
    true,
    repeat('a', 64),
    1024,
    clock_timestamp()
  ),
  (
    '80000000-0000-4000-8000-000000000002',
    'under_18_form',
    9001,
    'legal/under_18_form/80000000-0000-4000-8000-000000000002.pdf',
    'release-gate-under-18.pdf',
    current_date,
    '10000000-0000-4000-8000-000000000001',
    true,
    true,
    repeat('b', 64),
    1024,
    clock_timestamp()
  );

INSERT INTO public.legal_acceptances (
  id, user_id, document_id, event_year, ip_address, user_agent
) VALUES (
  '90000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',
  2097,
  '192.0.2.1',
  'ALSA release gate'
);

SELECT throws_matching(
  $$
    UPDATE public.legal_documents
    SET original_filename = 'rewritten.pdf'
    WHERE id = '80000000-0000-4000-8000-000000000001'
  $$,
  'legal document evidence is immutable',
  'published legal object metadata cannot be overwritten'
);

SELECT throws_matching(
  $$
    DELETE FROM public.legal_documents
    WHERE id = '80000000-0000-4000-8000-000000000001'
  $$,
  'published legal documents are immutable',
  'published legal document records cannot be deleted'
);

SELECT throws_matching(
  $$
    DELETE FROM public.legal_acceptances
    WHERE id = '90000000-0000-4000-8000-000000000001'
  $$,
  'Retained legal acceptance evidence cannot be deleted',
  'accepted legal evidence remains append-only even for privileged writers'
);

-- From this point on, run trigger checks with the real authenticated subject.
SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);

SELECT throws_ok(
  $$
    UPDATE public.profiles
    SET email = 'poisoned@example.test'
    WHERE id = '10000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'Profile email is managed by the authentication service.',
  'a session cannot poison its mirrored profile email'
);

SELECT throws_ok(
  $$
    UPDATE public.profiles
    SET dob = DATE '1991-01-01'
    WHERE id = '10000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'Date of birth is locked after event registration. Contact the committee to correct it.',
  'date of birth is locked after any event registration'
);

SELECT throws_ok(
  $$
    INSERT INTO public.zltac_registrations (
      user_id, year, status, payment_reference, amount_owing
    ) VALUES (
      '10000000-0000-4000-8000-000000000001',
      2098,
      'confirmed',
      'FORGED',
      1
    )
  $$,
  '42501',
  'Protected registration fields must be set by the server.',
  'registration financial and committee fields fail closed even if a grant drifts'
);

SELECT throws_ok(
  $$
    UPDATE public.zltac_registrations
    SET dob_at_registration = DATE '1991-01-01'
    WHERE id = '40000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'Date of birth at registration is an immutable server snapshot.',
  'registration DOB snapshots cannot be rewritten by a player session'
);

SELECT throws_matching(
  $$
    UPDATE public.teams
    SET status = 'rejected'
    WHERE id = '30000000-0000-4000-8000-000000000001'
  $$,
  '(Team status, scope, ownership, format, and entry type are server-managed|ZLTAC team status can only be changed by the committee)',
  'captains cannot approve, reject, or rescope their own team'
);

SELECT throws_ok(
  $$
    INSERT INTO public.under_18_approvals (
      user_id, event_year, document_id, status,
      submitted_at, approved_at, approved_by
    ) VALUES (
      '10000000-0000-4000-8000-000000000001',
      2097,
      '80000000-0000-4000-8000-000000000002',
      'approved',
      clock_timestamp(),
      clock_timestamp(),
      '10000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'Players may only create their own pending under-18 submission.',
  'a player cannot self-approve an under-18 decision even if a grant drifts'
);

SET LOCAL ROLE authenticated;

SELECT is(
  (
    SELECT count(*)
    FROM public.team_members
    WHERE team_id = '30000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'team-member RLS reads complete without recursive-policy failure'
);

RESET ROLE;

UPDATE public.profiles
SET suspended = true
WHERE id = '10000000-0000-4000-8000-000000000001';

SELECT is(
  public.is_active_user(),
  false,
  'suspended subjects fail the canonical active-user helper'
);

SET LOCAL ROLE authenticated;

SELECT is_empty(
  $$
    UPDATE public.profiles
    SET alias = 'SuspendedWrite'
    WHERE id = '10000000-0000-4000-8000-000000000001'
    RETURNING id
  $$,
  'a suspended session cannot mutate its own profile through RLS'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
