-- Team uniqueness + theft-fix.
--
-- Previously the "one team per captain per event" rule was UI-only:
-- CaptainRegister hid the create button when a team existed, but a direct
-- INSERT through the anon Supabase client bypassed it. teams_captain_insert
-- only constrained captain_id = auth.uid() plus a global ZLTAC-open flag,
-- so a single captain could create unlimited rows.
--
-- Separately, teams_captain_update had USING (captain_id = auth.uid()) with
-- no WITH CHECK, so a captain could UPDATE captain_id to another user and
-- effectively gift or steal the team.
--
-- This migration:
--   1. Adds partial UNIQUE indexes (one per scope) as the atomic DB-level
--      guarantee. Works for anon writes AND service-role writes; catches
--      future code paths too.
--   2. Replaces teams_captain_insert WITH CHECK so the second INSERT is
--      rejected at the policy layer with a clean message before hitting
--      the unique index.
--   3. Adds the missing WITH CHECK to teams_captain_update to pin
--      captain_id to the caller.
--
-- BACKLOG (P3):
--   - Gate competition team INSERTs on the competition's own registration
--     window. No clean SQL helper exists today (the inline form lives in
--     the public competitions discovery view), so the competition branch
--     below currently has no window gate. Add a SECURITY DEFINER STABLE
--     public.is_competition_reg_open(uuid) and reference it from the policy.
--   - Move ZLTAC team INSERT off the anon client onto a server endpoint
--     similar to /api/superadmin/competition-team. DB constraints remain
--     the safety net but server-side business-rule enforcement is cleaner.


-- 1. Partial UNIQUE indexes ──────────────────────────────────────────────────
-- Production data already has no duplicates, so no cleanup needed before the
-- index build. WHERE clauses scope each index to its event/competition arm
-- (the xor check guarantees only one column is set per row, so each row hits
-- exactly one of the two indexes).

CREATE UNIQUE INDEX IF NOT EXISTS teams_one_per_captain_per_event
  ON public.teams (captain_id, event_id)
  WHERE event_id IS NOT NULL AND captain_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS teams_one_per_captain_per_competition
  ON public.teams (captain_id, competition_id)
  WHERE competition_id IS NOT NULL AND captain_id IS NOT NULL;


-- 2. Replace teams_captain_insert ────────────────────────────────────────────
-- captain_id pinned to self, plus an event arm OR competition arm. Each arm
-- requires the scope column to be set AND that the captain doesn't already
-- own a team in that scope. The event arm additionally keeps the existing
-- is_active_event_open() lifecycle gate. The xor CHECK on teams (Phase 1a)
-- ensures rows that satisfy one arm cannot also satisfy the other.

DROP POLICY IF EXISTS "teams_captain_insert" ON public.teams;

CREATE POLICY "teams_captain_insert" ON public.teams
  FOR INSERT TO authenticated
  WITH CHECK (
    captain_id = auth.uid()
    AND (
      (
        event_id IS NOT NULL
        AND public.is_active_event_open()
        AND NOT EXISTS (
          SELECT 1 FROM public.teams t
          WHERE t.captain_id = auth.uid()
            AND t.event_id   = teams.event_id
        )
      )
      OR
      (
        competition_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.teams t
          WHERE t.captain_id     = auth.uid()
            AND t.competition_id = teams.competition_id
        )
      )
    )
  );


-- 3. Plug teams_captain_update team-theft hole ───────────────────────────────
-- The previous policy had USING (captain_id = auth.uid()) only, so an UPDATE
-- could change captain_id to another user's id. The new WITH CHECK keeps
-- captain_id pinned to the caller across UPDATE. (Committee writes go through
-- teams_committee_write, which is untouched.)

DROP POLICY IF EXISTS "teams_captain_update" ON public.teams;

CREATE POLICY "teams_captain_update" ON public.teams
  FOR UPDATE TO authenticated
  USING (captain_id = auth.uid())
  WITH CHECK (captain_id = auth.uid());
