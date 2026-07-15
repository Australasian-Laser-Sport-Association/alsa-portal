-- Verify private payment helpers and secure function defaults.

DO $$
DECLARE
  function_signature text;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.generate_payment_reference(integer,text,uuid)',
    'public.generate_competition_payment_reference(uuid,text,uuid)',
    'public.edit_payment_record(uuid,jsonb,uuid)',
    'public.delete_payment_record(uuid,uuid)'
  ]
  LOOP
    IF to_regprocedure(function_signature) IS NULL THEN
      RAISE EXCEPTION 'Expected function % is missing', function_signature;
    END IF;

    IF has_function_privilege('anon', function_signature, 'EXECUTE')
       OR has_function_privilege('authenticated', function_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Function % remains browser-executable', function_signature;
    END IF;

    IF NOT has_function_privilege('service_role', function_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Function % is unavailable to service_role', function_signature;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_default_acl AS defaults
    WHERE defaults.defaclrole = current_user::regrole
      AND defaults.defaclnamespace = 'public'::regnamespace
      AND defaults.defaclobjtype = 'f'
  ) THEN
    RAISE EXCEPTION 'No secure default function ACL exists for the migration owner';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_default_acl AS defaults
    CROSS JOIN LATERAL aclexplode(defaults.defaclacl) AS acl
    WHERE defaults.defaclrole = current_user::regrole
      AND defaults.defaclnamespace = 'public'::regnamespace
      AND defaults.defaclobjtype = 'f'
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'New public-schema functions still default to PUBLIC EXECUTE';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_default_acl AS defaults
    CROSS JOIN LATERAL aclexplode(defaults.defaclacl) AS acl
    WHERE defaults.defaclrole = current_user::regrole
      AND defaults.defaclnamespace = 'public'::regnamespace
      AND defaults.defaclobjtype = 'f'
      AND acl.grantee = to_regrole('service_role')
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'New public-schema functions do not default to service_role EXECUTE';
  END IF;
END
$$;
