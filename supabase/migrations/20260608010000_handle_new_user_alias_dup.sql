-- =============================================================================
-- handle_new_user(): graceful duplicate-alias handling at signup
-- Date: 2026-06-08
-- =============================================================================
-- Prepares the signup trigger for the lower(alias) partial unique index added
-- in 20260608020000_alias_lower_unique.sql. APPLY THIS MIGRATION FIRST, then the
-- index, so a colliding alias at signup degrades gracefully instead of wiping
-- the new profile down to id + roles.
--
-- Behaviour:
--   1. Try the full metadata insert (unchanged from the prior version).
--   2. On unique_violation (the only unique a handle_new_user insert can trip is
--      the lower(alias) index — id conflicts are absorbed by ON CONFLICT (id),
--      and alsa_member_id is never inserted here): retry the SAME insert with
--      alias = NULL. This PRESERVES first/last name, dob, phone, state,
--      home_arena and emergency contacts; only the alias is dropped (NULL is
--      allowed by the partial index). The player can set a unique alias later.
--   3. WHEN OTHERS (any other failure): the original last-resort basic insert
--      (id + roles only) so the trigger never blocks auth.users creation.
--
-- The function stays SECURITY DEFINER with search_path = public. Because every
-- failure path is caught and a row is always inserted (or already exists),
-- RETURN new always runs and auth-user creation never fails.
-- =============================================================================

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
        INSERT INTO public.profiles (id, roles)
        VALUES (new.id, ARRAY['player']::text[])
        ON CONFLICT (id) DO NOTHING;
      END;
    WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user metadata insert failed for user %, falling back to basic profile. SQLERRM: %', new.id, SQLERRM;
      INSERT INTO public.profiles (id, roles)
      VALUES (new.id, ARRAY['player']::text[])
      ON CONFLICT (id) DO NOTHING;
  END;
  RETURN new;
END;
$$;


-- =============================================================================
-- ROLLBACK — restores the EXACT prior body from
-- 20260428000000_handle_new_user_metadata.sql verbatim:
-- -----------------------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION public.handle_new_user()
-- RETURNS trigger
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public
-- AS $$
-- BEGIN
--   BEGIN
--     INSERT INTO public.profiles (
--       id,
--       first_name,
--       last_name,
--       alias,
--       dob,
--       phone,
--       state,
--       home_arena,
--       emergency_contact_name,
--       emergency_contact_phone,
--       roles
--     )
--     VALUES (
--       new.id,
--       new.raw_user_meta_data->>'first_name',
--       new.raw_user_meta_data->>'last_name',
--       new.raw_user_meta_data->>'alias',
--       NULLIF(new.raw_user_meta_data->>'dob', '')::date,
--       new.raw_user_meta_data->>'phone',
--       new.raw_user_meta_data->>'state',
--       new.raw_user_meta_data->>'home_arena',
--       new.raw_user_meta_data->>'emergency_contact_name',
--       new.raw_user_meta_data->>'emergency_contact_phone',
--       ARRAY['player']::text[]
--     )
--     ON CONFLICT (id) DO NOTHING;
--   EXCEPTION WHEN OTHERS THEN
--     RAISE WARNING 'handle_new_user metadata insert failed for user %, falling back to basic profile. SQLERRM: %', new.id, SQLERRM;
--     INSERT INTO public.profiles (id, roles)
--     VALUES (new.id, ARRAY['player']::text[])
--     ON CONFLICT (id) DO NOTHING;
--   END;
--   RETURN new;
-- END;
-- $$;
-- =============================================================================
