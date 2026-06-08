-- 20260609010000_profiles_email_sync.sql
-- Track A item 2 (core): add profiles.email, mirrored from auth.users and kept
-- in sync, so server reads can join/select the email column instead of fanning
-- out one auth.admin.getUserById per row (managers / registrations / volunteer
-- lists). auth.users remains the system of record for email + uniqueness.
--
-- Design:
--   - email is nullable with NO UNIQUE constraint. auth.users owns email
--     identity/uniqueness; this column is a read-optimisation mirror.
--     Placeholder profiles (no auth.users row) legitimately keep email = NULL,
--     matching today's getUserById-catch-returns-null behaviour.
--   - Populated three ways: backfill (existing rows), handle_new_user (signup
--     insert), and an AFTER UPDATE OF email trigger (email changes).
--   - NO REVOKE / column read-guard here. Restricting who may SELECT the column
--     is a separate part; this migration only adds + syncs the data.

-- ---------------------------------------------------------------------------
-- 1. Column: nullable, no UNIQUE.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN email text;

-- ---------------------------------------------------------------------------
-- 2. Backfill from auth.users (placeholders, which have no auth row, stay NULL).
-- ---------------------------------------------------------------------------
UPDATE public.profiles p
   SET email = u.email
  FROM auth.users u
 WHERE u.id = p.id;

-- ---------------------------------------------------------------------------
-- 3. handle_new_user(): recreated from 20260608010000 byte-for-byte, with
--    `email` / `new.email` added to every profile-creating INSERT (primary,
--    alias-NULL retry, and both basic fallbacks) so the column is populated on
--    signup regardless of which branch runs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.profiles (
      id,
      email,
      first_name,
      last_name,
      alias,
      dob,
      phone,
      state,
      home_arena,
      emergency_contact_name,
      emergency_contact_phone,
      roles
    )
    VALUES (
      new.id,
      new.email,
      new.raw_user_meta_data->>'first_name',
      new.raw_user_meta_data->>'last_name',
      new.raw_user_meta_data->>'alias',
      NULLIF(new.raw_user_meta_data->>'dob', '')::date,
      new.raw_user_meta_data->>'phone',
      new.raw_user_meta_data->>'state',
      new.raw_user_meta_data->>'home_arena',
      new.raw_user_meta_data->>'emergency_contact_name',
      new.raw_user_meta_data->>'emergency_contact_phone',
      ARRAY['player']::text[]
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION
    WHEN unique_violation THEN
      -- Alias collides with the lower(alias) unique index. Preserve all other
      -- metadata; only drop the alias (NULL is allowed by the partial index).
      RAISE WARNING 'handle_new_user: alias conflict for user %, inserting profile with alias = NULL. SQLERRM: %', new.id, SQLERRM;
      BEGIN
        INSERT INTO public.profiles (
          id,
          email,
          first_name,
          last_name,
          alias,
          dob,
          phone,
          state,
          home_arena,
          emergency_contact_name,
          emergency_contact_phone,
          roles
        )
        VALUES (
          new.id,
          new.email,
          new.raw_user_meta_data->>'first_name',
          new.raw_user_meta_data->>'last_name',
          NULL,
          NULLIF(new.raw_user_meta_data->>'dob', '')::date,
          new.raw_user_meta_data->>'phone',
          new.raw_user_meta_data->>'state',
          new.raw_user_meta_data->>'home_arena',
          new.raw_user_meta_data->>'emergency_contact_name',
          new.raw_user_meta_data->>'emergency_contact_phone',
          ARRAY['player']::text[]
        )
        ON CONFLICT (id) DO NOTHING;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'handle_new_user alias-NULL retry failed for user %, falling back to basic profile. SQLERRM: %', new.id, SQLERRM;
        INSERT INTO public.profiles (id, email, roles)
        VALUES (new.id, new.email, ARRAY['player']::text[])
        ON CONFLICT (id) DO NOTHING;
      END;
    WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user metadata insert failed for user %, falling back to basic profile. SQLERRM: %', new.id, SQLERRM;
      INSERT INTO public.profiles (id, email, roles)
      VALUES (new.id, new.email, ARRAY['player']::text[])
      ON CONFLICT (id) DO NOTHING;
  END;
  RETURN new;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Keep profiles.email in sync when a user changes their auth email.
--    AFTER UPDATE OF email so it fires only on email changes. Matches the
--    SECURITY DEFINER / search_path = public convention of handle_new_user
--    and cleanup_profile_on_auth_delete.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_profile_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles SET email = new.email WHERE id = new.id;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_email();

-- ---------------------------------------------------------------------------
-- ROLLBACK (run manually to revert):
--   DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
--   DROP FUNCTION IF EXISTS public.sync_profile_email();
--
--   -- Restore handle_new_user to its prior (no-email) body from
--   -- 20260608010000_handle_new_user_alias_dup.sql:
--   CREATE OR REPLACE FUNCTION public.handle_new_user()
--   RETURNS trigger
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   SET search_path = public
--   AS $$
--   BEGIN
--     BEGIN
--       INSERT INTO public.profiles (
--         id, first_name, last_name, alias, dob, phone, state, home_arena,
--         emergency_contact_name, emergency_contact_phone, roles
--       )
--       VALUES (
--         new.id,
--         new.raw_user_meta_data->>'first_name',
--         new.raw_user_meta_data->>'last_name',
--         new.raw_user_meta_data->>'alias',
--         NULLIF(new.raw_user_meta_data->>'dob', '')::date,
--         new.raw_user_meta_data->>'phone',
--         new.raw_user_meta_data->>'state',
--         new.raw_user_meta_data->>'home_arena',
--         new.raw_user_meta_data->>'emergency_contact_name',
--         new.raw_user_meta_data->>'emergency_contact_phone',
--         ARRAY['player']::text[]
--       )
--       ON CONFLICT (id) DO NOTHING;
--     EXCEPTION
--       WHEN unique_violation THEN
--         RAISE WARNING 'handle_new_user: alias conflict for user %, inserting profile with alias = NULL. SQLERRM: %', new.id, SQLERRM;
--         BEGIN
--           INSERT INTO public.profiles (
--             id, first_name, last_name, alias, dob, phone, state, home_arena,
--             emergency_contact_name, emergency_contact_phone, roles
--           )
--           VALUES (
--             new.id,
--             new.raw_user_meta_data->>'first_name',
--             new.raw_user_meta_data->>'last_name',
--             NULL,
--             NULLIF(new.raw_user_meta_data->>'dob', '')::date,
--             new.raw_user_meta_data->>'phone',
--             new.raw_user_meta_data->>'state',
--             new.raw_user_meta_data->>'home_arena',
--             new.raw_user_meta_data->>'emergency_contact_name',
--             new.raw_user_meta_data->>'emergency_contact_phone',
--             ARRAY['player']::text[]
--           )
--           ON CONFLICT (id) DO NOTHING;
--         EXCEPTION WHEN OTHERS THEN
--           RAISE WARNING 'handle_new_user alias-NULL retry failed for user %, falling back to basic profile. SQLERRM: %', new.id, SQLERRM;
--           INSERT INTO public.profiles (id, roles)
--           VALUES (new.id, ARRAY['player']::text[])
--           ON CONFLICT (id) DO NOTHING;
--         END;
--       WHEN OTHERS THEN
--         RAISE WARNING 'handle_new_user metadata insert failed for user %, falling back to basic profile. SQLERRM: %', new.id, SQLERRM;
--         INSERT INTO public.profiles (id, roles)
--         VALUES (new.id, ARRAY['player']::text[])
--         ON CONFLICT (id) DO NOTHING;
--     END;
--     RETURN new;
--   END;
--   $$;
--
--   ALTER TABLE public.profiles DROP COLUMN email;
-- ---------------------------------------------------------------------------
