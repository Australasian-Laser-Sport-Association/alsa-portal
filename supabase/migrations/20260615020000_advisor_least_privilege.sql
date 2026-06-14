-- Advisor is a governance designation, not an operational administrator.
-- The current admin interface has no reliable read-only mode, so fail closed:
-- advisors receive no committee RLS capability unless they also hold an
-- explicit committee or superadmin role.

CREATE OR REPLACE FUNCTION public.is_committee()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND suspended = false
      AND roles && ARRAY['superadmin', 'alsa_committee', 'zltac_committee']::text[]
  );
$$;

