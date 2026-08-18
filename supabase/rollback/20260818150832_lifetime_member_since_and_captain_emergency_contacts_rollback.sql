BEGIN;

DROP FUNCTION IF EXISTS public.create_zltac_captain_team(
  uuid, integer, text, text, text, text, text, text, text, text
);

ALTER TABLE public.alsa_lifetime_members
  DROP COLUMN IF EXISTS member_since;

COMMIT;
