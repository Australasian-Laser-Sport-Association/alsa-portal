-- Enforce teams SELECT visibility at the database level: approved teams are
-- readable by everyone; non-approved teams (draft/pending/rejected) are readable
-- only by the team owner (captain or manager) or committee. The owner clause is
-- status-agnostic so owners still see their own pending/rejected team; committee
-- access comes from the existing teams_committee_write (FOR ALL, is_committee()).
BEGIN;

DROP POLICY IF EXISTS teams_public_read ON public.teams;

CREATE POLICY teams_public_read ON public.teams
  FOR SELECT
  USING (status = 'approved');

CREATE POLICY teams_owner_read ON public.teams
  FOR SELECT TO authenticated
  USING (captain_id = auth.uid() OR manager_id = auth.uid());

COMMIT;

-- ROLLBACK (manual):
-- BEGIN;
-- DROP POLICY IF EXISTS teams_owner_read ON public.teams;
-- DROP POLICY IF EXISTS teams_public_read ON public.teams;
-- CREATE POLICY teams_public_read ON public.teams
--   FOR SELECT
--   USING (true);
-- COMMIT;
