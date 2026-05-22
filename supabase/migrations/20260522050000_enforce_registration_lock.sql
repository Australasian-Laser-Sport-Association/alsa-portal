-- =============================================================================
-- Enforce the registration lock at the data layer.
--
-- Intent (long present in copy, never enforced): once an event passes its
-- reg_close_date, players can no longer self-service register or edit their
-- registration choices. The boundary is reg_close_date for ALL purposes here
-- (covers both the 'locked' and 'closed' phases). Compliance signings (CoC,
-- media, U18, rules test) live on OTHER tables and are deliberately left open.
-- Payments are unaffected (separate tables + service-role writes). Committee
-- writes go via the service role (which bypasses RLS) or is_committee() policies
-- (which do not carry this gate), so admins remain the manual override.
--
-- Player writes to zltac_registrations and teams are client-direct, gated only
-- by RLS, so the gate must live in RLS. Doubles/triples partner flows are
-- service-role API writes (bypass RLS) and are intentionally NOT frozen here:
-- partner shuffles within already-paid side events stay editable, and the API
-- already blocks any partner action that would raise amount_owing.
-- =============================================================================

-- ── Phase helpers ────────────────────────────────────────────────────────────
-- "Open" means now is before the lock boundary. A null reg_close_date means no
-- boundary (open indefinitely), matching src/lib/eventPhase.js. SECURITY DEFINER
-- so the policy can read the events row regardless of the caller's grants;
-- STABLE because now() is fixed within a statement.

CREATE OR REPLACE FUNCTION public.is_reg_open_for_year(p_year integer)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    (SELECT (reg_close_date IS NULL OR now() < reg_close_date)
       FROM public.zltac_events
      WHERE year = p_year
      LIMIT 1),
    false
  );
$$;

-- Team creation has no year/event_id on the row at INSERT time, so it gates on
-- the current open event instead.
CREATE OR REPLACE FUNCTION public.is_active_event_open()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    (SELECT (reg_close_date IS NULL OR now() < reg_close_date)
       FROM public.zltac_events
      WHERE status = 'open'
      ORDER BY year DESC
      LIMIT 1),
    false
  );
$$;

-- ── zltac_registrations: atomic policy swap ──────────────────────────────────
-- The old single FOR ALL policy is dropped and replaced by four per-command
-- policies in the same migration (one transaction) so there is no window where
-- a write falls through to deny. SELECT stays ungated for own rows; INSERT /
-- UPDATE / DELETE additionally require the event to be unlocked. The committee
-- read policy is untouched; committee/admin writes use the service role.

DROP POLICY IF EXISTS "zltac_registrations_own" ON public.zltac_registrations;

CREATE POLICY "zltac_registrations_select_own" ON public.zltac_registrations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "zltac_registrations_insert_own" ON public.zltac_registrations
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_reg_open_for_year(year));

CREATE POLICY "zltac_registrations_update_own" ON public.zltac_registrations
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.is_reg_open_for_year(year));

CREATE POLICY "zltac_registrations_delete_own" ON public.zltac_registrations
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND public.is_reg_open_for_year(year));

-- ── teams: gate captain INSERT (new team creation) ───────────────────────────
-- Cosmetic team edits (name/logo/venue via teams_captain_update) stay editable
-- post-lock by design, so only the INSERT policy is replaced.

DROP POLICY IF EXISTS "teams_captain_insert" ON public.teams;

CREATE POLICY "teams_captain_insert" ON public.teams
  FOR INSERT TO authenticated
  WITH CHECK (captain_id = auth.uid() AND public.is_active_event_open());
