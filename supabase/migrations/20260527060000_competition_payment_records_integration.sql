-- Phase 2d: competition payment records integration.
--
-- Extends the existing payment_records ledger to cover pre-nationals
-- competitions in addition to ZLTAC events. Mirrors the teams.event_id /
-- teams.competition_id xor pattern from Phase 1a: one row per payment, one
-- of two FKs set (never both, never neither).
--
-- UNIT DRIFT (deliberate; documented here so future tooling does not get
-- caught out):
--
--   payment_records.amount is integer cents regardless of which FK is set.
--   ZLTAC parents (zltac_registrations.amount_owing) also store cents.
--   Pre-nats parents (competition_registrations.amount_owing and
--   amount_paid) store numeric(8,2) dollars (Phase 1a convention).
--
--   The API converts dollars -> cents on insert and cents -> dollars when
--   it recomputes the parent (api/_lib/computeCompetitionAmountPaid.js).
--   Any future code that reads payment_records.amount directly must know
--   which FK is set before interpreting the unit; if the row points at
--   competition_registration_id, divide by 100 before comparing to the
--   parent's stored amounts.
--
-- Manager writes go through the API using supabaseAdmin (service-role,
-- bypasses RLS). No manager-scoped write policy on payment_records — that
-- matches the existing manager-write convention across the app. The new
-- read policy (payment_records_competition_own_read) covers the player's
-- own pre-nats payment history, which a later UI phase will surface in
-- CompetitionHub.

-- -----------------------------------------------------------------------------
-- 1. Schema change: relax registration_id, add competition_registration_id,
--    enforce xor.
-- -----------------------------------------------------------------------------

ALTER TABLE public.payment_records
  ALTER COLUMN registration_id DROP NOT NULL;

ALTER TABLE public.payment_records
  ADD COLUMN competition_registration_id uuid
    REFERENCES public.competition_registrations(id) ON DELETE CASCADE;

-- xor: exactly one of the two FKs is set. Existing rows have
-- registration_id NOT NULL and competition_registration_id NULL, which
-- satisfies (false != true) = true.
ALTER TABLE public.payment_records
  ADD CONSTRAINT chk_payment_records_event_xor_competition
    CHECK ((registration_id IS NULL) != (competition_registration_id IS NULL));

CREATE INDEX payment_records_competition_registration_idx
  ON public.payment_records (competition_registration_id);


-- -----------------------------------------------------------------------------
-- 2. RLS: player-self read for pre-nats payments.
-- -----------------------------------------------------------------------------
-- Mirrors payment_records_own_read but joins via the new FK. Managers and
-- superadmins do not need a parallel policy because their writes go through
-- the service-role API; the existing payment_records_committee_all already
-- covers committee reads on the ZLTAC side and superadmin reads here too
-- (is_committee() is a superset of superadmin).

CREATE POLICY payment_records_competition_own_read ON public.payment_records
  FOR SELECT TO authenticated
  USING (
    competition_registration_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.competition_registrations cr
      WHERE cr.id = payment_records.competition_registration_id
        AND cr.user_id = auth.uid()
    )
  );
