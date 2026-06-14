DO $$
DECLARE
  function_definition text;
BEGIN
  SELECT pg_get_functiondef('public.is_committee()'::regprocedure)
  INTO function_definition;

  IF function_definition ILIKE '%advisor%' THEN
    RAISE EXCEPTION 'is_committee still grants authority to advisor';
  END IF;

  IF function_definition NOT ILIKE '%suspended = false%' THEN
    RAISE EXCEPTION 'is_committee lost suspension enforcement';
  END IF;

  RAISE NOTICE 'PASS: advisor has no committee RLS authority';
END $$;

