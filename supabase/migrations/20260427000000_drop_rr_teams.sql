-- Drop the rr_teams table and any associated objects.
-- This table was used for an admin-only tournament team seeding feature
-- that is no longer in scope.
DROP TABLE IF EXISTS public.rr_teams CASCADE;
