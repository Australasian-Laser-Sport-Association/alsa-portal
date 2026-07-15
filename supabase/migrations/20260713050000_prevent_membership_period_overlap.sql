-- Prevent ambiguous ALSA annual membership periods.
--
-- Membership periods use half-open date intervals: [starts_at, ends_at).
-- Adjacent periods are therefore valid, but any shared day is not.
-- An advisory transaction lock serializes writers so concurrent inserts cannot
-- both pass the overlap check before either row becomes visible.

CREATE OR REPLACE FUNCTION public.guard_alsa_membership_period_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('public.alsa_membership_periods:no-overlap')
  );

  IF EXISTS (
    SELECT 1
    FROM public.alsa_membership_periods AS existing
    WHERE existing.id IS DISTINCT FROM NEW.id
      AND NEW.starts_at < existing.ends_at
      AND NEW.ends_at > existing.starts_at
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23P01',
      MESSAGE = 'ALSA membership periods must not overlap';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_alsa_membership_period_overlap()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS alsa_membership_periods_no_overlap
  ON public.alsa_membership_periods;

CREATE TRIGGER alsa_membership_periods_no_overlap
BEFORE INSERT OR UPDATE OF starts_at, ends_at
ON public.alsa_membership_periods
FOR EACH ROW
EXECUTE FUNCTION public.guard_alsa_membership_period_overlap();

COMMENT ON FUNCTION public.guard_alsa_membership_period_overlap() IS
  'Serializes ALSA membership-period writes and rejects overlapping half-open date intervals.';
