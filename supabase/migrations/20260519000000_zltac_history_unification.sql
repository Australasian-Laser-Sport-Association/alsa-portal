-- ============================================================
-- Migration: ZLTAC history data unification (Phase 1, schema only)
-- Date: 2026-05-19
-- Purpose:
--   Move the static ZLTAC history content currently in
--   src/data/zltacHistory.js into Supabase so a future admin UI can
--   manage it. This migration is schema-only; data backfill happens
--   from scripts/migrate-zltac-history.mjs --commit after the dry-run
--   report is reviewed.
--
--   Phase 1 (this migration) — schema and policies only.
--   Phase 2 (later) — frontend reads from Supabase instead of the
--   static file. The static file remains the source of truth until
--   Phase 2 ships.
--
-- Content moved here:
--   * Per-year placings (Team + side events)  → zltac_event_placings
--   * Hall of Fame inductees                  → zltac_hall_of_fame
--   * Stand-out legends (editorial)           → zltac_legends
--   * Team dynasties (three-peats / B2B)      → zltac_dynasties
--
--   Year-level metadata (location, MVP, photos, etc.) continues to
--   live on the existing zltac_event_history table, which is extended
--   here with cancelled / upcoming flags + team count + country so
--   every year row in the static file has a home.
--
-- RLS / visibility:
--   All four new tables are public-readable (the ZLTAC landing page
--   is unauthenticated) and committee-writable. Pattern mirrors the
--   existing zltac_event_history policies.
-- ============================================================


-- -----------------------------------------------------------------------------
-- 1. Extend zltac_event_history
-- -----------------------------------------------------------------------------
-- Cancelled (2021) and upcoming (2027) years have no podium / placings but
-- still need to render in the year grid. team_count surfaces the existing
-- "X teams" stat for each year. location_country lets us flag NZ-hosted
-- years separately from Australian states.

ALTER TABLE public.zltac_event_history
  ADD COLUMN is_cancelled    boolean NOT NULL DEFAULT false,
  ADD COLUMN is_upcoming     boolean NOT NULL DEFAULT false,
  ADD COLUMN team_count      integer,
  ADD COLUMN location_country text,
  ADD CONSTRAINT zltac_event_history_status_flags_check
    CHECK (NOT (is_cancelled AND is_upcoming));


-- -----------------------------------------------------------------------------
-- 2. New tables
-- -----------------------------------------------------------------------------

-- Hall of Fame inductees (flat list, sorted client-side).
CREATE TABLE public.zltac_hall_of_fame (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  real_name       text NOT NULL,
  alias           text,
  induction_year  integer NOT NULL,
  contribution    text,
  photo_url       text,
  display_order   integer NOT NULL DEFAULT 0,
  is_visible      boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX zltac_hall_of_fame_induction_year_idx
  ON public.zltac_hall_of_fame (induction_year);


-- Per-year per-division placings (1..N for each division).
-- tournament_year is a plain int (not an FK to zltac_event_history) to keep
-- this migration self-contained and to allow placings rows to exist for
-- years that aren't yet represented in zltac_event_history.
CREATE TABLE public.zltac_event_placings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_year integer NOT NULL,
  division        text NOT NULL
                    CHECK (division IN
                      ('team','solos','doubles','triples','masters','womens','juniors','lotr')),
  rank            integer NOT NULL,
  name            text NOT NULL,
  subtitle        text,
  display_order   integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_year, division, rank)
);

CREATE INDEX zltac_event_placings_year_idx
  ON public.zltac_event_placings (tournament_year);


-- Stand-out players (editorial). Free-text titles + summary.
CREATE TABLE public.zltac_legends (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias          text NOT NULL,
  titles         text,
  summary        text,
  display_order  integer NOT NULL DEFAULT 0,
  is_visible     boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);


-- Team dynasties (three-peats and back-to-backs).
CREATE TABLE public.zltac_dynasties (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_name      text NOT NULL,
  category       text NOT NULL
                   CHECK (category IN ('three_peat','back_to_back')),
  years          integer[] NOT NULL,
  note           text,
  display_order  integer NOT NULL DEFAULT 0,
  is_visible     boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);


-- -----------------------------------------------------------------------------
-- 3. updated_at triggers (reuses public.touch_updated_at from initial schema)
-- -----------------------------------------------------------------------------

CREATE TRIGGER zltac_hall_of_fame_touch_updated_at
  BEFORE UPDATE ON public.zltac_hall_of_fame
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER zltac_event_placings_touch_updated_at
  BEFORE UPDATE ON public.zltac_event_placings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER zltac_legends_touch_updated_at
  BEFORE UPDATE ON public.zltac_legends
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER zltac_dynasties_touch_updated_at
  BEFORE UPDATE ON public.zltac_dynasties
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- -----------------------------------------------------------------------------
-- 4. GRANTs (mirrors role_grants_baseline.sql pattern)
-- -----------------------------------------------------------------------------
-- Public read on all four. No anon/authenticated write grants — committee
-- writes flow through service_role via API routes (same model as
-- zltac_event_history).

GRANT SELECT ON public.zltac_hall_of_fame      TO anon, authenticated;
GRANT SELECT ON public.zltac_event_placings    TO anon, authenticated;
GRANT SELECT ON public.zltac_legends           TO anon, authenticated;
GRANT SELECT ON public.zltac_dynasties         TO anon, authenticated;

GRANT ALL    ON public.zltac_hall_of_fame      TO service_role;
GRANT ALL    ON public.zltac_event_placings    TO service_role;
GRANT ALL    ON public.zltac_legends           TO service_role;
GRANT ALL    ON public.zltac_dynasties         TO service_role;


-- -----------------------------------------------------------------------------
-- 5. RLS
-- -----------------------------------------------------------------------------
-- Pattern matches zltac_event_history (initial schema) and
-- alsa_membership_periods (paid-membership migration):
--   * public SELECT for everyone
--   * FOR ALL committee policy as a defence-in-depth backstop for any
--     authenticated committee user who isn't going through service_role

ALTER TABLE public.zltac_hall_of_fame      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zltac_event_placings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zltac_legends           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zltac_dynasties         ENABLE ROW LEVEL SECURITY;


CREATE POLICY "zltac_hall_of_fame_public_read" ON public.zltac_hall_of_fame
  FOR SELECT
  USING (true);

CREATE POLICY "zltac_hall_of_fame_committee_write" ON public.zltac_hall_of_fame
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());


CREATE POLICY "zltac_event_placings_public_read" ON public.zltac_event_placings
  FOR SELECT
  USING (true);

CREATE POLICY "zltac_event_placings_committee_write" ON public.zltac_event_placings
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());


CREATE POLICY "zltac_legends_public_read" ON public.zltac_legends
  FOR SELECT
  USING (true);

CREATE POLICY "zltac_legends_committee_write" ON public.zltac_legends
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());


CREATE POLICY "zltac_dynasties_public_read" ON public.zltac_dynasties
  FOR SELECT
  USING (true);

CREATE POLICY "zltac_dynasties_committee_write" ON public.zltac_dynasties
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());
