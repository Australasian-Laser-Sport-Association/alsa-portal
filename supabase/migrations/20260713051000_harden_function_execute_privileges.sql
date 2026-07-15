-- Remove direct Data API access to internal payment-reference helpers and make
-- newly created functions private by default. Client-callable RPCs and RLS
-- helpers must receive an explicit grant in the migration that creates them.

REVOKE ALL PRIVILEGES
  ON FUNCTION public.generate_payment_reference(integer, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.generate_payment_reference(integer, text, uuid)
  TO service_role;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.generate_competition_payment_reference(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.generate_competition_payment_reference(uuid, text, uuid)
  TO service_role;

-- These service RPCs were already removed from PUBLIC. Remove any accidental
-- direct grants as well, then retain the API's explicit service-role access.
REVOKE ALL PRIVILEGES
  ON FUNCTION public.edit_payment_record(uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.edit_payment_record(uuid, jsonb, uuid)
  TO service_role;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.delete_payment_record(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.delete_payment_record(uuid, uuid)
  TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;
