-- =============================================================================
-- Configurable committee contact email per event.
-- Shown to players for change requests after registration locks (the locked
-- registration banner). NULL falls back to the app-level default
-- (committee@lasersport.org.au) in the UI via the COMMITTEE_EMAIL constant.
-- =============================================================================

ALTER TABLE public.zltac_events
  ADD COLUMN committee_email text;
