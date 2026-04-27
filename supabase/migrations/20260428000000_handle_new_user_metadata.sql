-- Replace handle_new_user() to populate profile fields from auth metadata.
-- Phase 2A: profile creation becomes atomic with auth.users insert.
-- See ADR-0003 for the auth flow rationale.
--
-- Defensive: if the metadata-driven insert fails for any reason, fall back to
-- a basic insert (id + roles) so the trigger never blocks auth.users insert.
-- The fallback raises a warning so failures are visible in Postgres logs.

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
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user metadata insert failed for user %, falling back to basic profile. SQLERRM: %', new.id, SQLERRM;
    INSERT INTO public.profiles (id, roles)
    VALUES (new.id, ARRAY['player']::text[])
    ON CONFLICT (id) DO NOTHING;
  END;
  RETURN new;
END;
$$;
