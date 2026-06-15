-- =============================================================================
-- Placeholder profiles (Chunk 1)
-- =============================================================================
-- Lets the committee create a profile for a player who registered for an event
-- without making a portal account. A placeholder profile is a normal
-- public.profiles row flagged is_placeholder = true with NO matching
-- auth.users entry. Once created it behaves like any other profile: it gets a
-- generated payment reference, appears in partner pickers, and shows on the
-- public roster. The post-signup claim flow (linking a placeholder to a real
-- auth user) lands in Chunk 2 and is intentionally NOT implemented here.
--
-- What changes here and why:
--   1. Two new columns on profiles (is_placeholder, created_by_admin_id) plus
--      placeholder_email so a placeholder can be matched to a real account at
--      claim time in Chunk 2.
--   2. The profiles.id -> auth.users(id) foreign key is dropped. Placeholder
--      rows have no auth.users row, so the FK would block their insert.
--      profiles.id stays the PRIMARY KEY, so uniqueness is preserved.
--   3. A replacement AFTER DELETE trigger on auth.users keeps the old cascade
--      behaviour for REAL users only: deleting an auth user deletes its profile
--      unless that profile is a placeholder. (Placeholders have no auth row, so
--      they are never affected by an auth.users delete anyway; the is_placeholder
--      = false guard is belt-and-braces and documents intent.)
--   4. A partial index to make "list placeholders" / placeholder filters cheap.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. New columns
-- -----------------------------------------------------------------------------
-- placeholder_email is nullable and is only meaningful for placeholder rows.
-- It exists so Chunk 2 can offer "claim this registration" matching. It is a
-- deliberate, minimal addition beyond the two flagged columns; it may later be
-- generalised to hold every user's email if profiles ever syncs auth emails.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_placeholder      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by_admin_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS placeholder_email   text;


-- -----------------------------------------------------------------------------
-- 2. Drop the profiles.id -> auth.users(id) foreign key
-- -----------------------------------------------------------------------------
-- The FK was created inline on the column in 20260422000000_initial_schema.sql
-- (line 34: `id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE`).
-- An inline FK gets Postgres's default name (profiles_id_fkey), but rather than
-- hard-code that we look the constraint up dynamically: find the FOREIGN KEY on
-- public.profiles whose referenced table is auth.users and drop whatever it is
-- actually called. This is robust even if the constraint was renamed.

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT con.conname
    INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_class      rel  ON rel.oid  = con.conrelid
  JOIN pg_namespace  nsp  ON nsp.oid  = rel.relnamespace
  JOIN pg_class      frel ON frel.oid = con.confrelid
  JOIN pg_namespace  fnsp ON fnsp.oid = frel.relnamespace
  WHERE con.contype = 'f'
    AND nsp.nspname  = 'public'
    AND rel.relname  = 'profiles'
    AND fnsp.nspname = 'auth'
    AND frel.relname = 'users';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', v_constraint_name);
    RAISE NOTICE 'Dropped FK % on public.profiles -> auth.users', v_constraint_name;
  ELSE
    RAISE NOTICE 'No FK from public.profiles -> auth.users found; nothing to drop';
  END IF;
END;
$$;


-- -----------------------------------------------------------------------------
-- 3. Replacement cascade-delete trigger for real users only
-- -----------------------------------------------------------------------------
-- With the FK gone, deleting an auth.users row no longer cascades to profiles.
-- This trigger restores that behaviour for real accounts while leaving
-- placeholders untouched. SECURITY DEFINER so it runs with the owner's rights
-- (auth.users deletes happen outside the public schema's RLS context).
-- search_path is pinned to public, matching public.handle_new_user(), so the
-- unqualified-name lookups inside a SECURITY DEFINER function can't be hijacked.

CREATE OR REPLACE FUNCTION public.cleanup_profile_on_auth_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.profiles WHERE id = OLD.id AND is_placeholder = false;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
CREATE TRIGGER on_auth_user_deleted
  AFTER DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_profile_on_auth_delete();


-- -----------------------------------------------------------------------------
-- 4. Partial index for placeholder filtering
-- -----------------------------------------------------------------------------
-- Placeholders are a small minority of rows; a partial index keeps "show only
-- placeholders" admin queries cheap without bloating the index for the common
-- (non-placeholder) case.

CREATE INDEX IF NOT EXISTS profiles_placeholder_idx
  ON public.profiles (is_placeholder)
  WHERE is_placeholder = true;
