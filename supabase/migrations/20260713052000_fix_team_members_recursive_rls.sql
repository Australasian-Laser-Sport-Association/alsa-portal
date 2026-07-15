-- Replace the self-referential team_members SELECT policy. Querying the same
-- RLS-protected table from its policy can recurse indefinitely. This pinned,
-- parameter-minimal helper reads membership as the function owner while the
-- policy always evaluates access for auth.uid().

CREATE OR REPLACE FUNCTION public.can_read_team_members(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.team_members AS own_membership
       WHERE own_membership.team_id = p_team_id
         AND own_membership.user_id = auth.uid()
         AND own_membership.invite_status = 'accepted'
     );
$$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.can_read_team_members(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE
  ON FUNCTION public.can_read_team_members(uuid)
  TO authenticated, service_role;

DROP POLICY IF EXISTS team_members_team_read ON public.team_members;

CREATE POLICY team_members_team_read
ON public.team_members
FOR SELECT
TO authenticated
USING (public.can_read_team_members(team_id));

COMMENT ON FUNCTION public.can_read_team_members(uuid) IS
  'RLS helper: true only when auth.uid() is an accepted member of the requested team.';
