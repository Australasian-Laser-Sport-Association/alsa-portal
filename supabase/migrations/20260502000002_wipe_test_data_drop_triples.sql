-- Phase B.2 — Wipe test data only.
-- triples_teams DROP deferred to Phase B.4 after code migration in B.3.
-- User confirmed no real data exists yet — only test accounts/teams.

-- Wipe registrations and team data (test only)
TRUNCATE TABLE public.zltac_registrations CASCADE;
TRUNCATE TABLE public.team_members CASCADE;
TRUNCATE TABLE public.teams CASCADE;
TRUNCATE TABLE public.triples_teams CASCADE;
