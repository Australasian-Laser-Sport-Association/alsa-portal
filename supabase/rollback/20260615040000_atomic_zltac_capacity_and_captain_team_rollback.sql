-- Rollback for 20260615040000_atomic_zltac_capacity_and_captain_team.sql.
-- Roll application code back first; new captain endpoints call these RPCs.

BEGIN;

DROP TRIGGER IF EXISTS teams_enforce_zltac_capacity ON public.teams;
DROP TRIGGER IF EXISTS zltac_registrations_enforce_event_capacity ON public.zltac_registrations;
DROP TRIGGER IF EXISTS zltac_registrations_enforce_roster_capacity_insert ON public.zltac_registrations;
DROP TRIGGER IF EXISTS zltac_registrations_enforce_roster_capacity_update ON public.zltac_registrations;

DROP FUNCTION IF EXISTS public.enforce_zltac_team_capacity();
DROP FUNCTION IF EXISTS public.enforce_zltac_registration_capacity();
DROP FUNCTION IF EXISTS public.enforce_zltac_roster_capacity();
DROP FUNCTION IF EXISTS public.recalculate_zltac_amount_owing(uuid);
DROP FUNCTION IF EXISTS public.create_zltac_captain_team(uuid, integer, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.add_zltac_team_player(uuid, uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.disband_zltac_team(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.remove_zltac_team_player(uuid, uuid, uuid, integer);

COMMIT;
