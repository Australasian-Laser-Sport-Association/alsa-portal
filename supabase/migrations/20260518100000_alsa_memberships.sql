-- ============================================================
-- Migration: ALSA paid membership system
-- Date: 2026-05-18
-- Purpose:
--   Two tables to model paid annual ALSA Inc. memberships (the
--   second member tier described in CLAUDE.md, distinct from the
--   free 'ALSA Portal Member' tier represented by profiles.roles).
--
--   * alsa_membership_periods — the year-aligned membership windows
--     (one row per period, e.g. 2026/27 = 2026-03-01 → 2027-03-01).
--   * alsa_memberships — one row per (profile, period). Granted by
--     committee after payment confirmation. Carries optional
--     payment_reference + notes for ledger trail.
--
--   "Current period" is whichever period covers today's date. The
--   API enforces no overlap between periods, so this is unambiguous.
--
-- RLS / visibility:
--   * Periods are public read (the About page shows the current
--     period label to anyone). Writes via API (committee only).
--   * Memberships hold sensitive fields (payment_reference, notes)
--     so reads are committee-only. The public list of *who* is a
--     current member goes through /api/members which uses
--     supabaseAdmin and projects only first_name/last_name/alias/
--     avatar_url — mirroring the /api/committee pattern.
--   * /api/me/membership uses supabaseAdmin to return the
--     authenticated user's own current + most_recent membership
--     metadata for ProfileCard display.
-- ============================================================


-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------

CREATE TABLE public.alsa_membership_periods (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text NOT NULL,
  starts_at  date NOT NULL,
  ends_at    date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT period_dates_check CHECK (ends_at > starts_at)
);

CREATE TABLE public.alsa_memberships (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period_id         uuid NOT NULL REFERENCES public.alsa_membership_periods(id) ON DELETE RESTRICT,
  payment_reference text,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES public.profiles(id),
  UNIQUE (profile_id, period_id)
);

CREATE INDEX alsa_memberships_profile_idx ON public.alsa_memberships (profile_id);
CREATE INDEX alsa_memberships_period_idx  ON public.alsa_memberships (period_id);


-- -----------------------------------------------------------------------------
-- 2. GRANTs (matches role_grants_baseline.sql pattern)
-- -----------------------------------------------------------------------------

GRANT SELECT ON public.alsa_membership_periods TO anon, authenticated;
GRANT ALL    ON public.alsa_membership_periods TO service_role;

GRANT ALL    ON public.alsa_memberships TO service_role;
-- No anon/authenticated grants on alsa_memberships — committee operations
-- run via service_role through /api/admin/members and /api/admin/membership-periods.


-- -----------------------------------------------------------------------------
-- 3. RLS
-- -----------------------------------------------------------------------------

ALTER TABLE public.alsa_membership_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alsa_memberships        ENABLE ROW LEVEL SECURITY;

-- Periods: anyone (including anon) can read.
CREATE POLICY "alsa_membership_periods_public_read" ON public.alsa_membership_periods
  FOR SELECT TO anon, authenticated
  USING (true);

-- Periods: committee may write/update/delete (committee operations go through
-- service_role in practice; this policy exists as a defence-in-depth backstop).
CREATE POLICY "alsa_membership_periods_committee_write" ON public.alsa_membership_periods
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());

-- Memberships: committee-only for all operations.
CREATE POLICY "alsa_memberships_committee_all" ON public.alsa_memberships
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());
