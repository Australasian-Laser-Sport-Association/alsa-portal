-- Drop unused parallel registration/event tables.
-- All functionality lives in zltac_events and zltac_registrations.
-- Verified zero references via grep across src/ and api/.

DROP TABLE IF EXISTS public.event_registrations CASCADE;
DROP TABLE IF EXISTS public.event_settings CASCADE;
DROP TABLE IF EXISTS public.event_pricing CASCADE;
DROP TABLE IF EXISTS public.event_side_events CASCADE;
