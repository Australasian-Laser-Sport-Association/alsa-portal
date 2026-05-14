-- =============================================================================
-- Event bank details: BSB / account number / account name on zltac_events.
-- Shown to players on the payment screen so they can pay the balance.
-- =============================================================================

ALTER TABLE public.zltac_events
  ADD COLUMN bank_bsb            text,
  ADD COLUMN bank_account_number text,
  ADD COLUMN bank_account_name   text;
