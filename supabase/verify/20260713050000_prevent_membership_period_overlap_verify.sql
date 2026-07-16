-- Verify the overlap guard and ensure no pre-existing ambiguous periods remain.

DO $$
DECLARE
  overlap_count integer;
BEGIN
  IF to_regprocedure('public.guard_alsa_membership_period_overlap()') IS NULL THEN
    RAISE EXCEPTION 'guard_alsa_membership_period_overlap() is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.alsa_membership_periods'::regclass
      AND tgname = 'alsa_membership_periods_no_overlap'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'alsa_membership_periods_no_overlap trigger is missing';
  END IF;

  IF has_function_privilege('anon',
       'public.guard_alsa_membership_period_overlap()', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.guard_alsa_membership_period_overlap()', 'EXECUTE') THEN
    RAISE EXCEPTION 'internal overlap guard remains directly executable';
  END IF;

  SELECT count(*)
  INTO overlap_count
  FROM public.alsa_membership_periods AS left_period
  JOIN public.alsa_membership_periods AS right_period
    ON left_period.id < right_period.id
   AND left_period.starts_at < right_period.ends_at
   AND left_period.ends_at > right_period.starts_at;

  IF overlap_count > 0 THEN
    RAISE EXCEPTION '% pre-existing ALSA membership-period overlap(s) require remediation',
      overlap_count;
  END IF;
END
$$;
