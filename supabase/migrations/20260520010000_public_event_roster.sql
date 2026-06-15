-- ============================================================
-- Migration: public.public_event_roster — masked anon-readable view
-- Date: 2026-05-20
-- Purpose:
--   Surface a minimal, column-masked view of registered players so the
--   Current Event page can render team rosters and side-event entries
--   for users who are NOT logged in.
--
--   Exposes only: team_id, year, side_events, alias, state.
--   Hides:        user_id, status, dinner_guests, amount_owing,
--                 payment_reference, emergency_contact_*,
--                 has_confirmed_*, first/last name, email, dob,
--                 payment/completion data, partner pairings.
--
--   Filtered to events with status IN ('open','closed','archived') —
--   matches the existing zltac_events_public_read policy. Draft events
--   are not exposed.
--
--   Underlying tables stay locked. The view runs in definer mode (the
--   default), so the SELECT against the underlying tables happens with
--   the view owner's privileges and bypasses zltac_registrations RLS.
--   The view definition itself is the public surface — adding columns
--   in future requires another migration.
--
--   user_id is intentionally OMITTED so anonymous viewers cannot
--   correlate this roster with doubles_pairs / triples_teams (partner
--   pairings, which the spec explicitly hides). DoublesEntriesSection
--   and TriplesEntriesSection on the page are also gated to logged-in
--   users client-side.
-- ============================================================

CREATE OR REPLACE VIEW public.public_event_roster AS
SELECT
  r.team_id,
  r.year,
  r.side_events,
  p.alias,
  p.state
FROM public.zltac_registrations r
JOIN public.profiles p          ON p.id = r.user_id
JOIN public.zltac_events e      ON e.year = r.year
WHERE e.status IN ('open', 'closed', 'archived');

GRANT SELECT ON public.public_event_roster TO anon, authenticated;
