-- ============================================================
-- Migration: Add alsa_position to profiles
-- Date: 2026-05-18
-- Purpose:
--   Capture committee positions (President, Vice President,
--   Secretary, Treasurer, Committee Member, etc.) for members of
--   the ALSA committee. Free-text, nullable.
--
--   Renders on the public About page next to each ALSA committee
--   member. Falls back to "Committee Member" when null.
--
--   Only meaningful when 'alsa_committee' is present in
--   profiles.roles. There is no zltac_position column yet — the
--   ZLTAC committee display stays generic for now.
--
-- RLS note:
--   No new policies needed. Reads from the public About page go
--   through /api/committee, which uses supabaseAdmin and bypasses
--   RLS. Writes go through /api/admin/users (already committee-
--   gated). Users can read their own row via existing self-read
--   policy on profiles.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN alsa_position text;
