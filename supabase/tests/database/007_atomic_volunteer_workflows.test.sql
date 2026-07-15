BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (
    '63000000-0000-4000-8000-000000000001',
    'volunteer-committee@example.test',
    '{"first_name":"Volunteer","last_name":"Committee","alias":"VolunteerCommittee"}'::jsonb
  ),
  (
    '63000000-0000-4000-8000-000000000002',
    'volunteer-player@example.test',
    '{"first_name":"Volunteer","last_name":"Player","alias":"VolunteerPlayer"}'::jsonb
  ),
  (
    '63000000-0000-4000-8000-000000000003',
    'volunteer-manual@example.test',
    '{"first_name":"Manual","last_name":"Player","alias":"VolunteerManual"}'::jsonb
  );

UPDATE public.profiles
   SET roles = ARRAY['zltac_committee', 'player']::text[]
 WHERE id = '63000000-0000-4000-8000-000000000001';

UPDATE public.profiles
   SET dob = CASE id
     WHEN '63000000-0000-4000-8000-000000000002'::uuid THEN DATE '1990-01-01'
     WHEN '63000000-0000-4000-8000-000000000003'::uuid THEN DATE '1991-01-01'
     ELSE dob
   END
 WHERE id IN (
   '63000000-0000-4000-8000-000000000002',
   '63000000-0000-4000-8000-000000000003'
 );

INSERT INTO public.zltac_events (
  id, name, year, status, reg_open_date, reg_close_date,
  event_starts_at, timezone
)
VALUES (
  '63000000-0000-4000-8000-000000000010',
  'Atomic Volunteer Event',
  2197,
  'open',
  statement_timestamp() - interval '1 day',
  statement_timestamp() + interval '10 days',
  statement_timestamp() + interval '20 days',
  'Australia/Sydney'
);

INSERT INTO public.zltac_registrations (
  id, user_id, year, status, dob_at_registration
)
VALUES
  (
    '63000000-0000-4000-8000-000000000020',
    '63000000-0000-4000-8000-000000000002',
    2197,
    'pending',
    DATE '1990-01-01'
  ),
  (
    '63000000-0000-4000-8000-000000000021',
    '63000000-0000-4000-8000-000000000003',
    2197,
    'pending',
    DATE '1991-01-01'
  );

INSERT INTO public.volunteer_roles (
  id, code, name, short_description, is_active, sort_order
)
VALUES
  (
    '63000000-0000-4000-8000-000000000030',
    'V63A', 'Volunteer test A', 'Atomic volunteer role A', true, 630
  ),
  (
    '63000000-0000-4000-8000-000000000031',
    'V63B', 'Volunteer test B', 'Atomic volunteer role B', true, 631
  ),
  (
    '63000000-0000-4000-8000-000000000032',
    'V63C', 'Volunteer test C', 'Atomic volunteer role C', true, 632
  );

UPDATE public.volunteer_roles
   SET is_default = true
 WHERE id = '63000000-0000-4000-8000-000000000030';

CREATE FUNCTION public.test_63000_fail_default_clear()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.id = '63000000-0000-4000-8000-000000000030'::uuid
     AND OLD.is_default
     AND NOT NEW.is_default THEN
    RAISE EXCEPTION 'forced default clear failure' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER test_63000_fail_default_clear
BEFORE UPDATE ON public.volunteer_roles
FOR EACH ROW EXECUTE FUNCTION public.test_63000_fail_default_clear();

SELECT throws_ok(
  $$
    SELECT public.admin_upsert_volunteer_role(
      '63000000-0000-4000-8000-000000000001',
      NULL,
      jsonb_build_object(
        'code', 'V63D',
        'name', 'Volunteer test D',
        'short_description', 'Atomic volunteer role D',
        'is_default', true,
        'is_active', true
      )
    )
  $$,
  'P0001',
  'forced default clear failure',
  'a failure clearing the old default aborts the new role insert'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.volunteer_roles WHERE code = 'V63D'
  ) AND (
    SELECT is_default
    FROM public.volunteer_roles
    WHERE id = '63000000-0000-4000-8000-000000000030'
  ),
  'the failed default switch retains the old default and no partial new role'
);

DROP TRIGGER test_63000_fail_default_clear ON public.volunteer_roles;
DROP FUNCTION public.test_63000_fail_default_clear();

SELECT lives_ok(
  $$
    SELECT public.admin_upsert_volunteer_role(
      '63000000-0000-4000-8000-000000000001',
      NULL,
      jsonb_build_object(
        'code', 'V63D',
        'name', 'Volunteer test D',
        'short_description', 'Atomic volunteer role D',
        'is_default', true,
        'is_active', true
      )
    )
  $$,
  'the default role switch succeeds as one transaction'
);

SELECT is(
  (
    SELECT count(*) FROM public.volunteer_roles WHERE is_default
  ),
  1::bigint,
  'the successful switch leaves exactly one default volunteer role'
);

SELECT ok(
  (
    SELECT is_default FROM public.volunteer_roles WHERE code = 'V63D'
  ),
  'the newly selected role is the surviving default'
);

SELECT lives_ok(
  $$
    SELECT public.mutate_own_volunteer_signup(
      '63000000-0000-4000-8000-000000000002',
      '63000000-0000-4000-8000-000000000020',
      'upsert',
      ARRAY['63000000-0000-4000-8000-000000000030'::uuid],
      'first note'
    )
  $$,
  'a player can create an owned volunteer signup through the atomic RPC'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.volunteer_signups AS signup
    JOIN public.volunteer_signup_roles AS signup_role
      ON signup_role.signup_id = signup.id
    WHERE signup.registration_id = '63000000-0000-4000-8000-000000000020'
      AND signup_role.role_id = '63000000-0000-4000-8000-000000000030'
      AND signup_role.status = 'pending'
  ),
  1::bigint,
  'the parent and initial pending role commit together'
);

UPDATE public.volunteer_signup_roles AS signup_role
   SET status = 'approved',
       decided_by = '63000000-0000-4000-8000-000000000001',
       decided_at = statement_timestamp()
  FROM public.volunteer_signups AS signup
 WHERE signup.id = signup_role.signup_id
   AND signup.registration_id = '63000000-0000-4000-8000-000000000020'
   AND signup_role.role_id = '63000000-0000-4000-8000-000000000030';

SELECT lives_ok(
  $$
    SELECT public.mutate_own_volunteer_signup(
      '63000000-0000-4000-8000-000000000002',
      '63000000-0000-4000-8000-000000000020',
      'upsert',
      ARRAY['63000000-0000-4000-8000-000000000031'::uuid],
      'second note'
    )
  $$,
  'a player can replace pending choices without deleting decided evidence'
);

SELECT ok(
  (
    SELECT signup.notes = 'second note'
       AND count(*) FILTER (WHERE signup_role.role_id = '63000000-0000-4000-8000-000000000030' AND signup_role.status = 'approved') = 1
       AND count(*) FILTER (WHERE signup_role.role_id = '63000000-0000-4000-8000-000000000031' AND signup_role.status = 'pending') = 1
    FROM public.volunteer_signups AS signup
    JOIN public.volunteer_signup_roles AS signup_role
      ON signup_role.signup_id = signup.id
    WHERE signup.registration_id = '63000000-0000-4000-8000-000000000020'
    GROUP BY signup.notes
  ),
  'decided evidence is retained while notes and pending choices change'
);

CREATE FUNCTION public.test_63000_fail_child_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.role_id = '63000000-0000-4000-8000-000000000032'::uuid THEN
    RAISE EXCEPTION 'forced volunteer child failure' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER test_63000_fail_child_insert
BEFORE INSERT ON public.volunteer_signup_roles
FOR EACH ROW EXECUTE FUNCTION public.test_63000_fail_child_insert();

SELECT throws_ok(
  $$
    SELECT public.mutate_own_volunteer_signup(
      '63000000-0000-4000-8000-000000000002',
      '63000000-0000-4000-8000-000000000020',
      'upsert',
      ARRAY['63000000-0000-4000-8000-000000000032'::uuid],
      'must roll back'
    )
  $$,
  'P0001',
  'forced volunteer child failure',
  'a late child insert failure aborts the player mutation'
);

SELECT ok(
  (
    SELECT signup.notes = 'second note'
       AND count(*) FILTER (WHERE signup_role.role_id = '63000000-0000-4000-8000-000000000031') = 1
       AND count(*) FILTER (WHERE signup_role.role_id = '63000000-0000-4000-8000-000000000032') = 0
    FROM public.volunteer_signups AS signup
    JOIN public.volunteer_signup_roles AS signup_role
      ON signup_role.signup_id = signup.id
    WHERE signup.registration_id = '63000000-0000-4000-8000-000000000020'
    GROUP BY signup.notes
  ),
  'the failed child insert rolls back the earlier note update and pending-role delete'
);

DROP TRIGGER test_63000_fail_child_insert ON public.volunteer_signup_roles;
DROP FUNCTION public.test_63000_fail_child_insert();

SELECT throws_ok(
  $$
    SELECT public.mutate_own_volunteer_signup(
      '63000000-0000-4000-8000-000000000002',
      '63000000-0000-4000-8000-000000000020',
      'delete', NULL, NULL
    )
  $$,
  '55000',
  'Contact committee to withdraw because you have an approved role.',
  'player deletion cannot erase an approved-role decision'
);

SELECT lives_ok(
  $$
    SELECT public.admin_set_volunteer_role_decisions(
      '63000000-0000-4000-8000-000000000001',
      (
        SELECT id FROM public.volunteer_signups
        WHERE registration_id = '63000000-0000-4000-8000-000000000020'
      ),
      jsonb_build_array(
        jsonb_build_object('role_id', '63000000-0000-4000-8000-000000000030', 'status', 'pending'),
        jsonb_build_object('role_id', '63000000-0000-4000-8000-000000000031', 'status', 'pending')
      )
    )
  $$,
  'committee decisions can reset both fixture roles to pending atomically'
);

CREATE FUNCTION public.test_63000_fail_batch_decision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.role_id = '63000000-0000-4000-8000-000000000031'::uuid
     AND NEW.status = 'approved' THEN
    RAISE EXCEPTION 'forced decision batch failure' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER test_63000_fail_batch_decision
BEFORE UPDATE ON public.volunteer_signup_roles
FOR EACH ROW EXECUTE FUNCTION public.test_63000_fail_batch_decision();

SELECT throws_ok(
  $$
    SELECT public.admin_set_volunteer_role_decisions(
      '63000000-0000-4000-8000-000000000001',
      (
        SELECT id FROM public.volunteer_signups
        WHERE registration_id = '63000000-0000-4000-8000-000000000020'
      ),
      jsonb_build_array(
        jsonb_build_object('role_id', '63000000-0000-4000-8000-000000000030', 'status', 'approved'),
        jsonb_build_object('role_id', '63000000-0000-4000-8000-000000000031', 'status', 'approved')
      )
    )
  $$,
  'P0001',
  'forced decision batch failure',
  'a failure in one decision aborts the whole committee batch'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.volunteer_signups AS signup
    JOIN public.volunteer_signup_roles AS signup_role
      ON signup_role.signup_id = signup.id
    WHERE signup.registration_id = '63000000-0000-4000-8000-000000000020'
      AND signup_role.status = 'pending'
  ),
  2::bigint,
  'the failed batch leaves every earlier role decision unchanged'
);

DROP TRIGGER test_63000_fail_batch_decision ON public.volunteer_signup_roles;
DROP FUNCTION public.test_63000_fail_batch_decision();

CREATE FUNCTION public.test_63000_fail_manual_child()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.role_id = '63000000-0000-4000-8000-000000000032'::uuid THEN
    RAISE EXCEPTION 'forced manual child failure' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER test_63000_fail_manual_child
BEFORE INSERT ON public.volunteer_signup_roles
FOR EACH ROW EXECUTE FUNCTION public.test_63000_fail_manual_child();

SELECT throws_ok(
  $$
    SELECT public.admin_create_volunteer_signup(
      '63000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000021',
      ARRAY['63000000-0000-4000-8000-000000000032'::uuid],
      'manual failure'
    )
  $$,
  'P0001',
  'forced manual child failure',
  'a late manual child failure aborts the parent insert'
);

SELECT is(
  (
    SELECT count(*) FROM public.volunteer_signups
    WHERE registration_id = '63000000-0000-4000-8000-000000000021'
  ),
  0::bigint,
  'manual child failure leaves no empty parent that blocks retry'
);

DROP TRIGGER test_63000_fail_manual_child ON public.volunteer_signup_roles;
DROP FUNCTION public.test_63000_fail_manual_child();

SELECT lives_ok(
  $$
    SELECT public.admin_create_volunteer_signup(
      '63000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000021',
      ARRAY[
        '63000000-0000-4000-8000-000000000030'::uuid,
        '63000000-0000-4000-8000-000000000032'::uuid
      ],
      'manual success'
    )
  $$,
  'manual signup succeeds after the forced child failure is removed'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.volunteer_signups AS signup
    JOIN public.volunteer_signup_roles AS signup_role
      ON signup_role.signup_id = signup.id
    WHERE signup.registration_id = '63000000-0000-4000-8000-000000000021'
      AND signup_role.status = 'approved'
      AND signup_role.decided_by = '63000000-0000-4000-8000-000000000001'
  ),
  2::bigint,
  'manual parent and all approved child rows commit together'
);

UPDATE public.profiles
   SET suspended = true
 WHERE id = '63000000-0000-4000-8000-000000000002';

SELECT throws_ok(
  $$
    SELECT public.mutate_own_volunteer_signup(
      '63000000-0000-4000-8000-000000000002',
      '63000000-0000-4000-8000-000000000020',
      'upsert',
      ARRAY['63000000-0000-4000-8000-000000000031'::uuid],
      'suspended mutation'
    )
  $$,
  '42501',
  'An active portal account is required.',
  'a suspended player cannot mutate a volunteer signup through service role'
);

SELECT * FROM finish();
ROLLBACK;
