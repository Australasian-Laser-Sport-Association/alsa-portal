-- Wave A: close the browser registration-insert bypass immediately.
--
-- Registration creation already runs through api/player.js with the service
-- role. Removing authenticated INSERT therefore does not affect the supported
-- flow. The trigger remains as defence in depth if a later migration
-- accidentally restores INSERT or grants it at column level.

BEGIN;

REVOKE INSERT ON TABLE public.zltac_registrations FROM authenticated;

CREATE OR REPLACE FUNCTION public.guard_zltac_registration_privileged_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service-role and other trusted server writes have no end-user auth.uid().
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'A registration can only be created for the signed-in user.'
      USING ERRCODE = '42501';
  END IF;

  -- These fields are calculated or decided by trusted server/committee paths.
  -- The override values are tri-state; NULL means no committee decision.
  IF NEW.status IS DISTINCT FROM 'pending'
     OR NEW.payment_reference IS NOT NULL
     OR NEW.amount_owing IS DISTINCT FROM 0
     OR NEW.admin_note IS NOT NULL
     OR NEW.admin_override_coc IS NOT NULL
     OR NEW.admin_override_media IS NOT NULL
     OR NEW.admin_override_ref_test IS NOT NULL
     OR NEW.admin_override_u18 IS NOT NULL
     OR NEW.admin_override_coc_set_by IS NOT NULL
     OR NEW.admin_override_coc_set_at IS NOT NULL
     OR NEW.admin_override_coc_reason IS NOT NULL
     OR NEW.admin_override_media_set_by IS NOT NULL
     OR NEW.admin_override_media_set_at IS NOT NULL
     OR NEW.admin_override_media_reason IS NOT NULL
     OR NEW.admin_override_ref_test_set_by IS NOT NULL
     OR NEW.admin_override_ref_test_set_at IS NOT NULL
     OR NEW.admin_override_ref_test_reason IS NOT NULL
     OR NEW.admin_override_u18_set_by IS NOT NULL
     OR NEW.admin_override_u18_set_at IS NOT NULL
     OR NEW.admin_override_u18_reason IS NOT NULL THEN
    RAISE EXCEPTION 'Protected registration fields must be set by the server.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.guard_zltac_registration_privileged_insert()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.guard_zltac_registration_privileged_insert()
  TO service_role;

DROP TRIGGER IF EXISTS zltac_registrations_guard_privileged_insert
  ON public.zltac_registrations;
CREATE TRIGGER zltac_registrations_guard_privileged_insert
  BEFORE INSERT ON public.zltac_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_zltac_registration_privileged_insert();

COMMIT;
