-- =============================================================================
-- ALSA Portal — Initial schema
-- =============================================================================
-- Consolidated baseline migration for the Australasian Laser Sport Association
-- member registration and event management platform.
--
-- Scope:
--   - All public.* tables required by the application
--   - Row Level Security policies (consistent, secure)
--   - Foreign keys to auth.users
--   - Triggers for profile auto-creation on signup
--
-- Conventions:
--   - profiles.roles (text[]) is the single source of truth for authorisation.
--     No legacy profiles.role column.
--   - All committee/admin checks use the roles array against a canonical set.
--   - No policies reference auth.jwt() user_metadata (user-editable = insecure).
--   - Monetary values stored in cents (integer).
--   - Timestamps are timestamptz, defaulting to now().
-- =============================================================================


-- =============================================================================
-- TABLES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
-- Extends auth.users with ALSA-specific profile data.
-- Auto-populated via trigger on auth.users insert (see bottom of file).

CREATE TABLE public.profiles (
  id                       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name               text,
  last_name                text,
  alias                    text,
  dob                      date,
  phone                    text,
  state                    text,
  home_arena               text,
  emergency_contact_name   text,
  emergency_contact_phone  text,
  alsa_member_id           text UNIQUE,
  avatar_url               text,
  roles                    text[] NOT NULL DEFAULT ARRAY['player']::text[],
  suspended                boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX profiles_roles_idx ON public.profiles USING gin (roles);
CREATE INDEX profiles_state_idx ON public.profiles (state);


-- -----------------------------------------------------------------------------
-- Helper: canonical committee/admin role check
-- -----------------------------------------------------------------------------
-- Defined after profiles because it references that table.
-- Centralised so RLS policies call one function instead of duplicating the
-- role list. Any change to admin roles happens here, nowhere else.

CREATE OR REPLACE FUNCTION public.is_committee()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND roles && ARRAY['superadmin', 'alsa_committee', 'zltac_committee', 'advisor']::text[]
  );
$$;


-- -----------------------------------------------------------------------------
-- zltac_events
-- -----------------------------------------------------------------------------
-- Active / upcoming / draft events. Historical events live in zltac_event_history.

CREATE TABLE public.zltac_events (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL,
  year                    integer NOT NULL UNIQUE,
  location                text,
  venue                   text,
  start_date              date,
  end_date                date,
  status                  text NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'open', 'closed', 'archived')),
  description             text,
  logo_url                text,
  main_fee                integer NOT NULL DEFAULT 0,
  team_fee                integer NOT NULL DEFAULT 0,
  dinner_guest_price      integer NOT NULL DEFAULT 6500,
  processing_fee_pct      numeric NOT NULL DEFAULT 2.5,
  side_events             jsonb,
  reg_open_date           timestamptz,
  reg_close_date          timestamptz,
  require_coc             boolean NOT NULL DEFAULT true,
  require_ref_test        boolean NOT NULL DEFAULT true,
  require_payment         boolean NOT NULL DEFAULT true,
  max_teams               integer,
  max_players             integer,
  max_players_per_team    integer,
  allow_side_events_only  boolean NOT NULL DEFAULT false,
  enable_waitlist         boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX zltac_events_status_idx ON public.zltac_events (status);


-- -----------------------------------------------------------------------------
-- zltac_event_history
-- -----------------------------------------------------------------------------
-- Results and records from past events. Public-readable.

CREATE TABLE public.zltac_event_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year                integer NOT NULL UNIQUE,
  name                text NOT NULL,
  location_city       text,
  location_state      text,
  location_venue      text,
  start_date          date,
  end_date            date,
  description         text,
  logo_url            text,
  champion_team       text,
  champion_state      text,
  runner_up_team      text,
  runner_up_state     text,
  third_place_team    text,
  third_place_state   text,
  mvp_name            text,
  mvp_alias           text,
  side_event_results  jsonb,
  full_results_text   text,
  photo_urls          text[],
  internal_notes      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);


-- -----------------------------------------------------------------------------
-- teams
-- -----------------------------------------------------------------------------

CREATE TABLE public.teams (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  captain_id        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  invite_code       text UNIQUE,
  invite_active     boolean NOT NULL DEFAULT true,
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason  text,
  state             text,
  home_venue        text,
  colour            text,
  logo_url          text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX teams_captain_idx ON public.teams (captain_id);
CREATE INDEX teams_status_idx ON public.teams (status);


-- -----------------------------------------------------------------------------
-- zltac_registrations
-- -----------------------------------------------------------------------------
-- One row per user per event year.

CREATE TABLE public.zltac_registrations (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  team_id                     uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  year                        integer NOT NULL,
  side_events                 text[],
  dinner_guests               integer NOT NULL DEFAULT 0,
  emergency_contact_name      text,
  emergency_contact_phone     text,
  status                      text NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  has_confirmed_side_events   boolean NOT NULL DEFAULT false,
  has_confirmed_extras        boolean NOT NULL DEFAULT false,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, year)
);

CREATE INDEX zltac_registrations_year_idx ON public.zltac_registrations (year);
CREATE INDEX zltac_registrations_team_idx ON public.zltac_registrations (team_id);


-- -----------------------------------------------------------------------------
-- event_pricing / event_settings / event_side_events
-- -----------------------------------------------------------------------------
-- Per-event configuration. Denormalised from zltac_events for historical
-- snapshots and flexible per-event overrides.

CREATE TABLE public.event_pricing (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid NOT NULL REFERENCES public.zltac_events(id) ON DELETE CASCADE,
  main_fee            integer NOT NULL DEFAULT 0,
  dinner_guest_price  integer NOT NULL DEFAULT 6500,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.event_settings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid NOT NULL REFERENCES public.zltac_events(id) ON DELETE CASCADE,
  reg_open_date     timestamptz,
  reg_close_date    timestamptz,
  require_coc       boolean NOT NULL DEFAULT true,
  require_ref_test  boolean NOT NULL DEFAULT true,
  require_payment   boolean NOT NULL DEFAULT true,
  max_teams         integer,
  max_players       integer,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.event_side_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid NOT NULL REFERENCES public.zltac_events(id) ON DELETE CASCADE,
  slug              text NOT NULL,
  name              text NOT NULL,
  enabled           boolean NOT NULL DEFAULT true,
  price             integer NOT NULL DEFAULT 0,
  max_participants  integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, slug)
);


-- -----------------------------------------------------------------------------
-- event_registrations
-- -----------------------------------------------------------------------------
-- Generic event registration (distinct from zltac_registrations which is
-- ZLTAC-specific). Used for side events and non-ZLTAC events.

CREATE TABLE public.event_registrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_id        uuid REFERENCES public.zltac_events(id) ON DELETE CASCADE,
  team_id         uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  side_events     text[],
  dinner_guests   integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_registrations_user_idx ON public.event_registrations (user_id);
CREATE INDEX event_registrations_event_idx ON public.event_registrations (event_id);


-- -----------------------------------------------------------------------------
-- doubles_pairs / triples_teams
-- -----------------------------------------------------------------------------
-- Side-event team structures.

CREATE TABLE public.doubles_pairs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_year   integer NOT NULL,
  player1_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  player2_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  confirmed    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_year, player1_id),
  UNIQUE (event_year, player2_id)
);

CREATE TABLE public.triples_teams (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_year         integer NOT NULL,
  player1_id         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  player2_id         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  player3_id         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  player2_confirmed  boolean NOT NULL DEFAULT false,
  player3_confirmed  boolean NOT NULL DEFAULT false,
  confirmed          boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);


-- -----------------------------------------------------------------------------
-- payments
-- -----------------------------------------------------------------------------

CREATE TABLE public.payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount      integer NOT NULL,
  status      text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'paid', 'refunded')),
  reference   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payments_user_idx ON public.payments (user_id);
CREATE INDEX payments_status_idx ON public.payments (status);


-- -----------------------------------------------------------------------------
-- referee_questions / referee_test_results / referee_test_settings
-- -----------------------------------------------------------------------------

CREATE TABLE public.referee_questions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question        text NOT NULL,
  option_a        text NOT NULL,
  option_b        text NOT NULL,
  option_c        text NOT NULL,
  option_d        text NOT NULL,
  correct_answer  text NOT NULL CHECK (correct_answer IN ('a', 'b', 'c', 'd')),
  category        text NOT NULL DEFAULT 'General',
  difficulty      text NOT NULL DEFAULT 'medium'
                    CHECK (difficulty IN ('easy', 'medium', 'hard')),
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.referee_test_results (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  score       integer NOT NULL,
  passed      boolean NOT NULL,
  taken_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX referee_test_results_user_idx ON public.referee_test_results (user_id);

CREATE TABLE public.referee_test_settings (
  id                  integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pass_score          integer NOT NULL DEFAULT 70,
  time_limit_minutes  integer NOT NULL DEFAULT 30,
  questions_per_test  integer NOT NULL DEFAULT 20,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.referee_test_settings (id) VALUES (1) ON CONFLICT DO NOTHING;


-- -----------------------------------------------------------------------------
-- code_of_conduct_versions / code_of_conduct_signatures
-- -----------------------------------------------------------------------------

CREATE TABLE public.code_of_conduct_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content       text NOT NULL,
  is_published  boolean NOT NULL DEFAULT false,
  version_note  text,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.code_of_conduct_signatures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  version_id  uuid REFERENCES public.code_of_conduct_versions(id) ON DELETE SET NULL,
  event_year  integer,
  ip_address  text,
  signed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_year)
);


-- -----------------------------------------------------------------------------
-- media_release_versions / media_release_submissions
-- -----------------------------------------------------------------------------

CREATE TABLE public.media_release_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content       text NOT NULL,
  is_published  boolean NOT NULL DEFAULT false,
  version_note  text,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.media_release_submissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_year    integer NOT NULL,
  consents      boolean NOT NULL,
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_year)
);


-- -----------------------------------------------------------------------------
-- under18_form_versions / under18_submissions
-- -----------------------------------------------------------------------------

CREATE TABLE public.under18_form_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content       text NOT NULL,
  is_published  boolean NOT NULL DEFAULT false,
  version_note  text,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.under18_submissions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_year     integer NOT NULL,
  parent_name    text NOT NULL,
  relationship   text NOT NULL,
  parent_phone   text NOT NULL,
  parent_email   text,
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_year)
);


-- -----------------------------------------------------------------------------
-- cms_global / cms_pages / cms_sections
-- -----------------------------------------------------------------------------
-- Lightweight CMS for public-site content (home, about, contact, etc).

CREATE TABLE public.cms_global (
  key              text PRIMARY KEY,
  value            jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cms_pages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text UNIQUE NOT NULL,
  title            text NOT NULL,
  is_system        boolean NOT NULL DEFAULT true,
  last_updated_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cms_sections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_slug        text NOT NULL,
  section_key      text NOT NULL,
  section_name     text NOT NULL,
  content          jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order       integer NOT NULL DEFAULT 0,
  is_visible       boolean NOT NULL DEFAULT true,
  last_updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_slug, section_key)
);


-- =============================================================================
-- TRIGGER: auto-create profile on auth.users insert
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, roles)
  VALUES (new.id, ARRAY['player']::text[])
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- =============================================================================
-- TRIGGER: update updated_at on profile changes
-- =============================================================================

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$;

CREATE TRIGGER profiles_touch_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER zltac_events_touch_updated_at
  BEFORE UPDATE ON public.zltac_events
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER zltac_event_history_touch_updated_at
  BEFORE UPDATE ON public.zltac_event_history
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
-- All tables have RLS enabled. Client-side queries (anon + authenticated)
-- must pass policy checks. Cross-user queries run via the service role
-- client (supabaseAdmin) which bypasses RLS entirely.

ALTER TABLE public.profiles                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zltac_events                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zltac_event_history         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zltac_registrations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_pricing               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_settings              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_side_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_registrations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doubles_pairs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triples_teams               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referee_questions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referee_test_results        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referee_test_settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_of_conduct_versions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_of_conduct_signatures  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_release_versions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_release_submissions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.under18_form_versions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.under18_submissions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_global                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_pages                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_sections                ENABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------

CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "profiles_select_committee" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.is_committee());

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND roles = (SELECT roles FROM public.profiles WHERE id = auth.uid()));
  -- ^ prevents a user from escalating their own roles

CREATE POLICY "profiles_update_committee" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_committee());


-- -----------------------------------------------------------------------------
-- zltac_events / zltac_event_history
-- -----------------------------------------------------------------------------

CREATE POLICY "zltac_events_public_read" ON public.zltac_events
  FOR SELECT
  USING (status IN ('open', 'closed', 'archived'));

CREATE POLICY "zltac_events_committee_read_all" ON public.zltac_events
  FOR SELECT TO authenticated
  USING (public.is_committee());

CREATE POLICY "zltac_events_committee_write" ON public.zltac_events
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());

CREATE POLICY "zltac_event_history_public_read" ON public.zltac_event_history
  FOR SELECT
  USING (true);

CREATE POLICY "zltac_event_history_committee_write" ON public.zltac_event_history
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());


-- -----------------------------------------------------------------------------
-- teams
-- -----------------------------------------------------------------------------

CREATE POLICY "teams_public_read" ON public.teams
  FOR SELECT
  USING (true);

CREATE POLICY "teams_captain_update" ON public.teams
  FOR UPDATE TO authenticated
  USING (captain_id = auth.uid());

CREATE POLICY "teams_captain_insert" ON public.teams
  FOR INSERT TO authenticated
  WITH CHECK (captain_id = auth.uid());

CREATE POLICY "teams_committee_write" ON public.teams
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());


-- -----------------------------------------------------------------------------
-- zltac_registrations
-- -----------------------------------------------------------------------------

CREATE POLICY "zltac_registrations_own" ON public.zltac_registrations
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "zltac_registrations_committee_read" ON public.zltac_registrations
  FOR SELECT TO authenticated
  USING (public.is_committee());


-- -----------------------------------------------------------------------------
-- event_pricing / event_settings / event_side_events
-- -----------------------------------------------------------------------------

CREATE POLICY "event_pricing_public_read" ON public.event_pricing
  FOR SELECT USING (true);

CREATE POLICY "event_pricing_committee_write" ON public.event_pricing
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());

CREATE POLICY "event_settings_public_read" ON public.event_settings
  FOR SELECT USING (true);

CREATE POLICY "event_settings_committee_write" ON public.event_settings
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());

CREATE POLICY "event_side_events_public_read" ON public.event_side_events
  FOR SELECT USING (true);

CREATE POLICY "event_side_events_committee_write" ON public.event_side_events
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());


-- -----------------------------------------------------------------------------
-- event_registrations
-- -----------------------------------------------------------------------------

CREATE POLICY "event_registrations_own" ON public.event_registrations
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "event_registrations_committee_read" ON public.event_registrations
  FOR SELECT TO authenticated
  USING (public.is_committee());


-- -----------------------------------------------------------------------------
-- doubles_pairs / triples_teams
-- -----------------------------------------------------------------------------

CREATE POLICY "doubles_pairs_own" ON public.doubles_pairs
  FOR ALL TO authenticated
  USING (player1_id = auth.uid() OR player2_id = auth.uid())
  WITH CHECK (player1_id = auth.uid() OR player2_id = auth.uid());

CREATE POLICY "doubles_pairs_committee_read" ON public.doubles_pairs
  FOR SELECT TO authenticated
  USING (public.is_committee());

CREATE POLICY "triples_teams_own" ON public.triples_teams
  FOR ALL TO authenticated
  USING (player1_id = auth.uid() OR player2_id = auth.uid() OR player3_id = auth.uid())
  WITH CHECK (player1_id = auth.uid() OR player2_id = auth.uid() OR player3_id = auth.uid());

CREATE POLICY "triples_teams_committee_read" ON public.triples_teams
  FOR SELECT TO authenticated
  USING (public.is_committee());


-- -----------------------------------------------------------------------------
-- payments
-- -----------------------------------------------------------------------------

CREATE POLICY "payments_own_read" ON public.payments
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "payments_committee_all" ON public.payments
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());


-- -----------------------------------------------------------------------------
-- referee tables
-- -----------------------------------------------------------------------------

CREATE POLICY "referee_questions_read" ON public.referee_questions
  FOR SELECT TO authenticated
  USING (active = true);

CREATE POLICY "referee_questions_committee_write" ON public.referee_questions
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());

CREATE POLICY "referee_test_settings_read" ON public.referee_test_settings
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "referee_test_settings_committee_write" ON public.referee_test_settings
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());

CREATE POLICY "referee_test_results_own" ON public.referee_test_results
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "referee_test_results_committee_read" ON public.referee_test_results
  FOR SELECT TO authenticated
  USING (public.is_committee());


-- -----------------------------------------------------------------------------
-- code_of_conduct
-- -----------------------------------------------------------------------------

CREATE POLICY "coc_versions_public_read_published" ON public.code_of_conduct_versions
  FOR SELECT USING (is_published = true);

CREATE POLICY "coc_versions_committee_write" ON public.code_of_conduct_versions
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());

CREATE POLICY "coc_signatures_own" ON public.code_of_conduct_signatures
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "coc_signatures_committee_read" ON public.code_of_conduct_signatures
  FOR SELECT TO authenticated
  USING (public.is_committee());


-- -----------------------------------------------------------------------------
-- media_release
-- -----------------------------------------------------------------------------

CREATE POLICY "media_release_versions_public_read_published" ON public.media_release_versions
  FOR SELECT USING (is_published = true);

CREATE POLICY "media_release_versions_committee_write" ON public.media_release_versions
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());

CREATE POLICY "media_release_submissions_own" ON public.media_release_submissions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "media_release_submissions_committee_read" ON public.media_release_submissions
  FOR SELECT TO authenticated
  USING (public.is_committee());


-- -----------------------------------------------------------------------------
-- under18
-- -----------------------------------------------------------------------------

CREATE POLICY "under18_form_versions_public_read_published" ON public.under18_form_versions
  FOR SELECT USING (is_published = true);

CREATE POLICY "under18_form_versions_committee_write" ON public.under18_form_versions
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());

CREATE POLICY "under18_submissions_own" ON public.under18_submissions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "under18_submissions_committee_read" ON public.under18_submissions
  FOR SELECT TO authenticated
  USING (public.is_committee());


-- -----------------------------------------------------------------------------
-- cms
-- -----------------------------------------------------------------------------

CREATE POLICY "cms_global_public_read" ON public.cms_global
  FOR SELECT USING (true);

CREATE POLICY "cms_global_committee_write" ON public.cms_global
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());

CREATE POLICY "cms_pages_public_read" ON public.cms_pages
  FOR SELECT USING (true);

CREATE POLICY "cms_pages_committee_write" ON public.cms_pages
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());

CREATE POLICY "cms_sections_public_read" ON public.cms_sections
  FOR SELECT USING (is_visible = true);

CREATE POLICY "cms_sections_committee_read_all" ON public.cms_sections
  FOR SELECT TO authenticated
  USING (public.is_committee());

CREATE POLICY "cms_sections_committee_write" ON public.cms_sections
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());


-- =============================================================================
-- End of migration
-- =============================================================================
