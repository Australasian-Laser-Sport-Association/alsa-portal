-- Phase B.1: Unified teams data model — schema additions only.
-- Adds columns to teams + creates team_members table.
-- No data migration in this file (see Phase B.2).
-- No drops in this file.

-- 1. Extend teams table
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS manager_id uuid,
  ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'team',
  ADD COLUMN IF NOT EXISTS event_id uuid;

-- Constrain format values
ALTER TABLE public.teams
  DROP CONSTRAINT IF EXISTS teams_format_check;
ALTER TABLE public.teams
  ADD CONSTRAINT teams_format_check
  CHECK (format IN ('team', 'doubles', 'triples'));

-- FK on event_id → zltac_events
ALTER TABLE public.teams
  DROP CONSTRAINT IF EXISTS teams_event_id_fkey;
ALTER TABLE public.teams
  ADD CONSTRAINT teams_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES public.zltac_events(id) ON DELETE CASCADE;

-- FK on manager_id → public.profiles(id), mirroring captain_id.
ALTER TABLE public.teams
  DROP CONSTRAINT IF EXISTS teams_manager_id_fkey;
ALTER TABLE public.teams
  ADD CONSTRAINT teams_manager_id_fkey
  FOREIGN KEY (manager_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 2. Create team_members table
CREATE TABLE IF NOT EXISTS public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  roles text[] NOT NULL DEFAULT ARRAY['player'],
  invite_status text NOT NULL DEFAULT 'accepted',
  invited_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  UNIQUE (team_id, user_id),
  CONSTRAINT team_members_invite_status_check
    CHECK (invite_status IN ('pending', 'accepted', 'declined'))
);

CREATE INDEX IF NOT EXISTS team_members_team_id_idx ON public.team_members(team_id);
CREATE INDEX IF NOT EXISTS team_members_user_id_idx ON public.team_members(user_id);

-- 3. RLS for team_members
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

-- Members can read their own memberships
CREATE POLICY team_members_self_read ON public.team_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Members can read all members of any team they belong to
CREATE POLICY team_members_team_read ON public.team_members
  FOR SELECT TO authenticated
  USING (team_id IN (
    SELECT team_id FROM public.team_members WHERE user_id = auth.uid()
  ));

-- Committee can read/write all
CREATE POLICY team_members_committee_all ON public.team_members
  FOR ALL TO authenticated
  USING (is_committee())
  WITH CHECK (is_committee());

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members TO authenticated;
