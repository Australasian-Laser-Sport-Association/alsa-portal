-- Repoint payment_records.recorded_by FK from auth.users to profiles, matching the
-- project's profiles(id) user-reference convention and enabling the PostgREST
-- payment_records -> profiles embed used by the payment modals. Same constraint name.

BEGIN;

ALTER TABLE public.payment_records
  DROP CONSTRAINT payment_records_recorded_by_fkey;

ALTER TABLE public.payment_records
  ADD CONSTRAINT payment_records_recorded_by_fkey
    FOREIGN KEY (recorded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMIT;

-- ROLLBACK:
-- BEGIN;
-- ALTER TABLE public.payment_records DROP CONSTRAINT payment_records_recorded_by_fkey;
-- ALTER TABLE public.payment_records
--   ADD CONSTRAINT payment_records_recorded_by_fkey
--     FOREIGN KEY (recorded_by) REFERENCES auth.users(id) ON DELETE SET NULL;
-- COMMIT;
