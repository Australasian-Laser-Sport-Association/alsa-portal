-- Drop the legacy create_zltac_captain_team RPC overload that predates
-- teams.entry_type.
--
-- The API now requires p_entry_type and calls the eight-argument overload:
--   create_zltac_captain_team(uuid, integer, text, text, text, text, text, text)
--
-- Keeping this older seven-argument SECURITY DEFINER overload around creates a
-- stale privileged write path that can create teams without entry_type.

DROP FUNCTION IF EXISTS public.create_zltac_captain_team(
  uuid,
  integer,
  text,
  text,
  text,
  text,
  text
);
