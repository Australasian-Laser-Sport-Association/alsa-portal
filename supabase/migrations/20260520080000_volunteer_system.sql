-- =============================================================================
-- Volunteer system — Phase 1: schema + seed + RLS.
--
-- Players self-nominate to volunteer at ZLTAC events; the committee selects from
-- the pool (not all volunteers are utilised). This phase is schema only — no UI.
--   Phase 2: volunteer admin page   Phase 3: rego-form volunteer section
--
-- Naming note: the spec referenced generic `events` / `registrations` tables;
-- this project's equivalents are `zltac_events` and `zltac_registrations`, so the
-- foreign keys target those.
--
-- Security model (ADR-0002): RLS + table GRANTs. service_role bypasses RLS and
-- needs no grant. Committee-managed config tables (volunteer_roles,
-- event_volunteer_settings) grant SELECT to authenticated and keep a committee
-- write policy, but writes flow through service-role admin routes (matching
-- event_pricing / event_settings). Player-managed tables (volunteer_signups,
-- volunteer_signup_roles) grant full CRUD to authenticated, constrained to the
-- caller's own rows by RLS (matching doubles_pairs / triples_teams).
-- Lock-date enforcement is deferred to the app layer (later phase), NOT RLS.
-- =============================================================================

-- ── 1. volunteer_roles — global role library (committee-managed) ─────────────
CREATE TABLE public.volunteer_roles (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text NOT NULL UNIQUE,
  name                 text NOT NULL,
  short_description    text NOT NULL,
  target_count         integer,
  min_count            integer,
  requires_experience  boolean NOT NULL DEFAULT false,
  experience_notes     text,
  is_default           boolean NOT NULL DEFAULT false,
  sort_order           integer NOT NULL DEFAULT 0,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ── 2. event_volunteer_settings — per-event config (one row per event) ───────
CREATE TABLE public.event_volunteer_settings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid NOT NULL UNIQUE REFERENCES public.zltac_events(id) ON DELETE CASCADE,
  required_per_team boolean NOT NULL DEFAULT false,
  count_per_team    integer,
  enforcement       text NOT NULL DEFAULT 'soft' CHECK (enforcement IN ('soft', 'hard')),
  caveat_message    text NOT NULL DEFAULT 'Note: Not all volunteers will be utilised. Selection is based on the operational capacity of the ZLTAC event.',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ── 3. volunteer_signups — one row per registration that opted to volunteer ──
-- Deleting the row = opted out. created_at is used by the app layer for lock logic.
CREATE TABLE public.volunteer_signups (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id  uuid NOT NULL UNIQUE REFERENCES public.zltac_registrations(id) ON DELETE CASCADE,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ── 4. volunteer_signup_roles — which roles a signup is offering for (M:N) ────
CREATE TABLE public.volunteer_signup_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signup_id   uuid NOT NULL REFERENCES public.volunteer_signups(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES public.volunteer_roles(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signup_id, role_id)
);

-- ── 5. Indices ───────────────────────────────────────────────────────────────
-- (registration_id / event_id / code lookups are covered by their UNIQUE indexes.)
CREATE INDEX volunteer_signup_roles_signup_idx ON public.volunteer_signup_roles (signup_id);
CREATE INDEX volunteer_signup_roles_role_idx   ON public.volunteer_signup_roles (role_id);

-- ── 6. updated_at triggers (reuse existing public.touch_updated_at) ──────────
CREATE TRIGGER volunteer_roles_touch_updated_at
  BEFORE UPDATE ON public.volunteer_roles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER event_volunteer_settings_touch_updated_at
  BEFORE UPDATE ON public.event_volunteer_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER volunteer_signups_touch_updated_at
  BEFORE UPDATE ON public.volunteer_signups
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── 7. Row Level Security ────────────────────────────────────────────────────
ALTER TABLE public.volunteer_roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_volunteer_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.volunteer_signups          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.volunteer_signup_roles     ENABLE ROW LEVEL SECURITY;

-- volunteer_roles: any authenticated reads; committee writes.
CREATE POLICY "volunteer_roles_authenticated_read" ON public.volunteer_roles
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "volunteer_roles_committee_write" ON public.volunteer_roles
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());

-- event_volunteer_settings: any authenticated reads; committee writes.
CREATE POLICY "event_volunteer_settings_authenticated_read" ON public.event_volunteer_settings
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "event_volunteer_settings_committee_write" ON public.event_volunteer_settings
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());

-- volunteer_signups: owner manages own row (SELECT/INSERT/UPDATE/DELETE) where
-- the referenced registration belongs to the caller; committee may read and
-- delete (remove) any.
CREATE POLICY "volunteer_signups_own" ON public.volunteer_signups
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.zltac_registrations r
    WHERE r.id = registration_id AND r.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.zltac_registrations r
    WHERE r.id = registration_id AND r.user_id = auth.uid()
  ));

CREATE POLICY "volunteer_signups_committee_read" ON public.volunteer_signups
  FOR SELECT TO authenticated
  USING (public.is_committee());

CREATE POLICY "volunteer_signups_committee_delete" ON public.volunteer_signups
  FOR DELETE TO authenticated
  USING (public.is_committee());

-- volunteer_signup_roles: same access as the parent signup (owner manages own;
-- committee reads + deletes), resolved via the signup → registration join.
CREATE POLICY "volunteer_signup_roles_own" ON public.volunteer_signup_roles
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.volunteer_signups s
    JOIN public.zltac_registrations r ON r.id = s.registration_id
    WHERE s.id = signup_id AND r.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.volunteer_signups s
    JOIN public.zltac_registrations r ON r.id = s.registration_id
    WHERE s.id = signup_id AND r.user_id = auth.uid()
  ));

CREATE POLICY "volunteer_signup_roles_committee_read" ON public.volunteer_signup_roles
  FOR SELECT TO authenticated
  USING (public.is_committee());

CREATE POLICY "volunteer_signup_roles_committee_delete" ON public.volunteer_signup_roles
  FOR DELETE TO authenticated
  USING (public.is_committee());

-- ── 8. Table GRANTs (RLS + GRANT model) ──────────────────────────────────────
-- Config tables: read-only for authenticated; committee writes via service role.
GRANT SELECT ON public.volunteer_roles          TO authenticated;
GRANT SELECT ON public.event_volunteer_settings TO authenticated;

-- Player-managed tables: full CRUD, constrained to own rows by RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.volunteer_signups      TO authenticated;
GRANT SELECT, INSERT, DELETE         ON public.volunteer_signup_roles TO authenticated;

-- ── 9. Seed volunteer_roles (11 default roles; idempotent on code) ───────────
INSERT INTO public.volunteer_roles
  (code, name, short_description, target_count, min_count, requires_experience, experience_notes, is_default, sort_order)
VALUES
  ('TC',  'Tournament Coordinator',       'Senior oversight of tournament functions: officials, scheduling, rule decisions, data', 7,  4,    true,  'Min 3 yrs as Event Coordinator + 2 yrs as Backup TC, or 2 written recommendations from previous ZLTAC TCs/ECs.', false, 1),
  ('EC',  'Event Coordinator',            'Manages AECs and game flow on the day; schedules finals; event-level rule calls',      5,  3,    true,  'Min 3 yrs as Master Referee + 2 yrs as AEC, or 2 written recommendations from previous ZLTAC TCs/ECs.',          false, 2),
  ('AEC', 'Assistant Event Coordinator',  'Entry-level event support: calls games, checks refs, welcomes players, assists EC',    10, 8,    false, NULL,                                                                                                            true,  3),
  ('MR',  'Master Referee',               'Qualifies, coaches, and reviews referees; ensures consistent rule interpretation',     12, 9,    true,  'Min 3 yrs as a Referee at ZLTAC, or 2 written recommendations from previous ZLTAC TCs/ECs.',                     false, 4),
  ('MTD', 'Media Team Director',          'Oversees the Media Team: live stream, commentary scheduling, post-production',         2,  1,    true,  'Min 3 yrs as Production Assistant or Master Commentator at ZLTAC, or 2 written recommendations from previous Media Directors/TCs.', false, 5),
  ('COM', 'Commentator',                  'Live stream commentary: calls games, discusses results, stats, predictions',           25, NULL, false, NULL,                                                                                                            false, 6),
  ('GC',  'Guest Commentator',            'Entry-level commentary role for first-year players only; on-the-job training provided',10, NULL, false, NULL,                                                                                                            false, 7),
  ('PA',  'Production Assistant',         'OBS/streaming production: scoreboard, cameras, transitions, content creation',          6,  NULL, true,  'Previous experience with Twitch, OBS Management, video editing, or photography.',                                false, 8),
  ('TTM', 'Technical Team Manager',       'Manages game server, membership systems, stats sites, and data integrity',             2,  1,    true,  'Min 3 yrs as Tech Assistant at ZLTAC, or written recommendation from previous Tech Manager / Host Site Operator.', false, 9),
  ('TA',  'Technical Assistant',          'Supports the Tech Team Manager; liaises with pack room on faulty equipment',           2,  1,    true,  'Previous experience repairing PNC Laser Tag equipment + recommendation from home Region Site Operator.',          false, 10),
  ('TRN', 'TORN Assistant',               'Post-game data: penalties, ladders, pyramids, fixtures',                               2,  1,    false, NULL,                                                                                                            false, 11)
ON CONFLICT (code) DO NOTHING;
