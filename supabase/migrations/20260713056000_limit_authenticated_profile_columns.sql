-- Replace the ineffective profiles.email column REVOKE with a fail-closed
-- column allow-list. A table-level SELECT grant implies SELECT on every
-- column, so it must be removed before column grants can protect identity and
-- placeholder fields.
--
-- Browser inventory (2026-07-14): AuthContext reads the SELECT columns granted
-- below, EventPage reads roles, PlayerHub embeds captain first_name/last_name,
-- and profile forms update only the mutable identity/contact columns granted
-- below. Backup, committee, manager, and placeholder searches use service-role
-- APIs.

BEGIN;

REVOKE SELECT ON TABLE public.profiles
  FROM PUBLIC, anon, authenticated;

-- Clear any historical column-level grant drift before installing the exact
-- allow-list. Future profile columns remain unreadable until deliberately
-- added by a later reviewed migration.
DO $$
DECLARE
  v_columns text;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
    INTO v_columns
    FROM pg_attribute AS a
   WHERE a.attrelid = 'public.profiles'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped;

  IF v_columns IS NOT NULL THEN
    EXECUTE format(
      'REVOKE SELECT (%s) ON TABLE public.profiles FROM PUBLIC, anon, authenticated',
      v_columns
    );
  END IF;
END;
$$;

GRANT SELECT (
  id,
  first_name,
  last_name,
  alias,
  dob,
  phone,
  state,
  home_arena,
  emergency_contact_name,
  emergency_contact_phone,
  avatar_url,
  roles,
  suspended,
  created_at
) ON TABLE public.profiles TO authenticated;

-- The old table-level UPDATE grant required RLS policies to compare every
-- protected field with subqueries against profiles. Once SELECT is a column
-- allow-list those policy subqueries correctly fail permission checks, which
-- would also break legitimate own-profile saves. Enforce immutability with a
-- column UPDATE allow-list instead; it is simpler and cannot be bypassed by a
-- crafted replacement row.
REVOKE UPDATE ON TABLE public.profiles FROM authenticated;

DO $$
DECLARE
  v_columns text;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
    INTO v_columns
    FROM pg_attribute AS a
   WHERE a.attrelid = 'public.profiles'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped;

  IF v_columns IS NOT NULL THEN
    EXECUTE format(
      'REVOKE UPDATE (%s) ON TABLE public.profiles FROM authenticated',
      v_columns
    );
  END IF;
END;
$$;

GRANT UPDATE (
  first_name,
  last_name,
  alias,
  dob,
  phone,
  state,
  home_arena,
  emergency_contact_name,
  emergency_contact_phone
) ON TABLE public.profiles TO authenticated;

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Committee and superadmin profile mutations are server-authoritative. The
-- service role bypasses RLS and retains its table privileges.
DROP POLICY IF EXISTS profiles_update_committee ON public.profiles;
DROP POLICY IF EXISTS profiles_update_superadmin ON public.profiles;

COMMENT ON COLUMN public.profiles.email IS
  'Authentication-service mirror. Browser roles have no SELECT privilege; use the verified auth session or a vetted server API.';

COMMIT;
