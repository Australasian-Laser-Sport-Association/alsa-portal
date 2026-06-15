-- Drop the invite-by-code team-join flow.
--
-- The invite-code flow (captain shares a /join/{code} link, player redeems the
-- code) has been removed in favour of captains adding players directly via the
-- Team Hub search-add tool. The flow was also effectively non-functional: the
-- redeem redirect dropped players on player-register, which never read the
-- code, so players always registered unassigned and had to be added via search
-- anyway.
--
-- invite_code and invite_active both belong to that removed flow and are now
-- orphaned. No other table references either column.

ALTER TABLE public.teams
  DROP COLUMN IF EXISTS invite_code,
  DROP COLUMN IF EXISTS invite_active;
