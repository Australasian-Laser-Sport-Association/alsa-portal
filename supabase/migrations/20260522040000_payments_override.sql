-- =============================================================================
-- Payment availability gate: committee override for player-facing payment info.
--
-- Bank details on the PlayerHub payment panel are gated behind a "payments
-- open" state. By default this auto-follows the registration lock date
-- (reg_close_date): once that passes, registrations lock and payment
-- information becomes visible to players. The committee can override that with
-- a manual force-open (e.g. release bank details early) or force-closed (e.g.
-- pull them temporarily in an emergency).
--
-- payment_reference and amount_owing are NOT gated by this column; only the
-- bank details (BSB / account number / account name) are.
--
-- NULL = auto (follow reg_close_date). 'open' = force open. 'closed' = force
-- closed. Writes are committee-gated by the existing zltac_events_committee_write
-- RLS policy (FOR ALL ... is_committee()), which covers this column with no
-- further changes.
-- =============================================================================

ALTER TABLE public.zltac_events
  ADD COLUMN payments_override text
    CHECK (payments_override IN ('open', 'closed'));

COMMENT ON COLUMN public.zltac_events.payments_override IS
  'Committee override for player-facing payment availability. NULL = auto (open when reg_close_date has passed). ''open'' = force open. ''closed'' = force closed.';
