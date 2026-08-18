-- Permit a deliberate superadmin correction to an event's dates after the
-- normal configuration freeze has taken effect. The regular committee save
-- path remains unchanged, so pricing, requirements, capacity, and side-event
-- protections cannot be bypassed through this override.

BEGIN;

CREATE OR REPLACE FUNCTION public.superadmin_save_zltac_event_with_date_override(
  p_actor_id uuid,
  p_event_id uuid,
  p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event public.zltac_events%ROWTYPE;
  v_candidate public.zltac_events%ROWTYPE;
  v_saved public.zltac_events%ROWTYPE;
  v_non_date_changes jsonb;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1
      FROM public.profiles profile
     WHERE profile.id = p_actor_id
       AND NOT coalesce(profile.suspended, false)
       AND 'superadmin' = ANY(profile.roles)
  ) THEN
    RAISE EXCEPTION 'Only an active superadmin can override event dates.'
      USING ERRCODE = '42501';
  END IF;

  IF p_event_id IS NULL
     OR p_changes IS NULL
     OR jsonb_typeof(p_changes) <> 'object'
     OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'An event id and non-empty changes are required.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (p_changes ?| ARRAY[
    'start_date', 'end_date', 'reg_open_date', 'reg_close_date',
    'event_starts_at'
  ]::text[]) THEN
    RAISE EXCEPTION 'A date change is required for the date override.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_event
    FROM public.zltac_events
   WHERE id = p_event_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_event.status = 'archived' THEN
    RAISE EXCEPTION 'Archived events are immutable.' USING ERRCODE = '55000';
  END IF;

  -- Send every non-date field through the existing locked save function. It
  -- retains all current allowlists and immutability checks, and the surrounding
  -- function keeps the regular save plus the date correction atomic.
  v_non_date_changes := p_changes - ARRAY[
    'start_date', 'end_date', 'reg_open_date', 'reg_close_date',
    'event_starts_at'
  ]::text[];
  IF v_non_date_changes <> '{}'::jsonb THEN
    PERFORM public.committee_save_zltac_event(
      p_actor_id,
      p_event_id,
      v_non_date_changes
    );
  END IF;

  v_candidate := jsonb_populate_record(v_event, p_changes);

  IF v_candidate.start_date IS NOT NULL
     AND v_candidate.end_date IS NOT NULL
     AND v_candidate.end_date < v_candidate.start_date THEN
    RAISE EXCEPTION 'Event end date must be on or after its start date.'
      USING ERRCODE = '22023';
  END IF;
  IF v_candidate.reg_open_date IS NOT NULL
     AND v_candidate.reg_close_date IS NOT NULL
     AND v_candidate.reg_close_date < v_candidate.reg_open_date THEN
    RAISE EXCEPTION 'Registration lock must be on or after registration open.'
      USING ERRCODE = '22023';
  END IF;
  IF v_candidate.reg_close_date IS NOT NULL
     AND v_candidate.event_starts_at IS NOT NULL
     AND v_candidate.event_starts_at < v_candidate.reg_close_date THEN
    RAISE EXCEPTION 'Registration close must be on or after registration lock.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.zltac_events SET
    start_date = v_candidate.start_date,
    end_date = v_candidate.end_date,
    reg_open_date = v_candidate.reg_open_date,
    reg_close_date = v_candidate.reg_close_date,
    event_starts_at = v_candidate.event_starts_at,
    updated_at = clock_timestamp()
  WHERE id = p_event_id
  RETURNING * INTO v_saved;

  RETURN to_jsonb(v_saved);
END;
$$;

REVOKE ALL ON FUNCTION public.superadmin_save_zltac_event_with_date_override(
  uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.superadmin_save_zltac_event_with_date_override(
  uuid, uuid, jsonb
) TO service_role;

COMMIT;

-- =============================================================================
-- ROLLBACK (commented out)
-- =============================================================================
-- DROP FUNCTION public.superadmin_save_zltac_event_with_date_override(
--   uuid, uuid, jsonb
-- );
