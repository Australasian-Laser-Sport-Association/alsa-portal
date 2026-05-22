-- =============================================================================
-- Per-event timezone.
--
-- All datetime fields on a zltac_events row (reg_open_date, reg_close_date,
-- event_starts_at) are stored as UTC timestamptz, but the admin enters and
-- everyone reads them in the event's local timezone. Until now the input layer
-- chopped the UTC string and saved it back raw, so a typed "7:00 PM" was stored
-- as 19:00 UTC. That made the RLS lock helpers, the display layer, and the
-- pure phase/payment helpers disagree about whether a deadline had passed.
--
-- This column captures the IANA zone for the row. The app converts on the way
-- in (event-local string -> UTC) and on the way out (UTC -> event-local with a
-- short abbreviation like AEST / NZDT). The underlying timestamptz columns are
-- unchanged: the instant comparisons in is_reg_open_for_year /
-- is_active_event_open / eventPhase / arePaymentsOpen are already correct and
-- need no migration.
--
-- Backfill: existing rows pick up the DEFAULT (Australia/Melbourne) for free.
-- Their stored UTC instants are intentionally left untouched. On first load the
-- tz-aware form shows those instants interpreted in Melbourne, which may differ
-- from the wall-clock the buggy form used to show; an admin re-saves once to
-- confirm. No data UPDATE is performed here.
-- =============================================================================

ALTER TABLE public.zltac_events
  ADD COLUMN timezone text NOT NULL DEFAULT 'Australia/Melbourne'
    CHECK (length(timezone) > 0);

COMMENT ON COLUMN public.zltac_events.timezone IS
  'IANA timezone name (e.g. Australia/Melbourne, Pacific/Auckland). All datetime fields on this row (reg_open_date, reg_close_date, event_starts_at) are stored as UTC timestamptz but interpreted, edited, and displayed in this timezone.';
