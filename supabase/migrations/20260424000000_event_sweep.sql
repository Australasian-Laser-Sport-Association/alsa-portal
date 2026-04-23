-- =============================================================================
-- Event sweep: enforce single open event + add event_year to payments + FK constraints
-- =============================================================================


-- Ensure only one event can be 'open' at a time
CREATE UNIQUE INDEX IF NOT EXISTS zltac_events_one_open
  ON public.zltac_events (status)
  WHERE status = 'open';


-- Add event_year column to payments (was missing; required for per-event filtering)
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS event_year integer;

CREATE INDEX IF NOT EXISTS payments_event_year_idx
  ON public.payments (event_year);


-- =============================================================================
-- Foreign key constraints: event-scoped tables → zltac_events(year)
-- zltac_events.year has a UNIQUE constraint, so it can be referenced as FK target.
-- =============================================================================

ALTER TABLE public.zltac_registrations
  ADD CONSTRAINT zltac_registrations_year_fk
  FOREIGN KEY (year) REFERENCES public.zltac_events(year) ON DELETE CASCADE;

ALTER TABLE public.doubles_pairs
  ADD CONSTRAINT doubles_pairs_event_year_fk
  FOREIGN KEY (event_year) REFERENCES public.zltac_events(year) ON DELETE CASCADE;

ALTER TABLE public.triples_teams
  ADD CONSTRAINT triples_teams_event_year_fk
  FOREIGN KEY (event_year) REFERENCES public.zltac_events(year) ON DELETE CASCADE;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_event_year_fk
  FOREIGN KEY (event_year) REFERENCES public.zltac_events(year) ON DELETE SET NULL;

ALTER TABLE public.code_of_conduct_signatures
  ADD CONSTRAINT coc_sigs_event_year_fk
  FOREIGN KEY (event_year) REFERENCES public.zltac_events(year) ON DELETE SET NULL;

ALTER TABLE public.media_release_submissions
  ADD CONSTRAINT media_release_event_year_fk
  FOREIGN KEY (event_year) REFERENCES public.zltac_events(year) ON DELETE CASCADE;

ALTER TABLE public.under18_submissions
  ADD CONSTRAINT under18_event_year_fk
  FOREIGN KEY (event_year) REFERENCES public.zltac_events(year) ON DELETE CASCADE;
