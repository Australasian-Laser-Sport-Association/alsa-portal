-- Make the four admin override columns on zltac_registrations tri-state.
--
-- Before: each admin_override_* column was a NOT NULL boolean defaulting to
-- false, where false meant "no override". The admin modal bound its checkbox
-- directly to this flag, so a player who genuinely completed a requirement
-- (recorded in legal_acceptances / referee_test_results / under_18_approvals)
-- still showed as unchecked unless an override was set.
--
-- After: the column is nullable with no default and carries three meanings:
--   NULL  = no override; follow the player's REAL completion state
--   true  = force COMPLETE  (override: treat the requirement as satisfied)
--   false = force INCOMPLETE (override: treat the requirement as unsatisfied)
--
-- Existing false rows previously meant "no override", so they are migrated to
-- NULL. A deliberate "force incomplete" must now be set explicitly as false.

BEGIN;

ALTER TABLE public.zltac_registrations
  ALTER COLUMN admin_override_coc      DROP NOT NULL,
  ALTER COLUMN admin_override_coc      DROP DEFAULT,
  ALTER COLUMN admin_override_media    DROP NOT NULL,
  ALTER COLUMN admin_override_media    DROP DEFAULT,
  ALTER COLUMN admin_override_ref_test DROP NOT NULL,
  ALTER COLUMN admin_override_ref_test DROP DEFAULT,
  ALTER COLUMN admin_override_u18      DROP NOT NULL,
  ALTER COLUMN admin_override_u18      DROP DEFAULT;

UPDATE public.zltac_registrations
  SET admin_override_coc = NULL
  WHERE admin_override_coc = false;

UPDATE public.zltac_registrations
  SET admin_override_media = NULL
  WHERE admin_override_media = false;

UPDATE public.zltac_registrations
  SET admin_override_ref_test = NULL
  WHERE admin_override_ref_test = false;

UPDATE public.zltac_registrations
  SET admin_override_u18 = NULL
  WHERE admin_override_u18 = false;

COMMIT;

-- ROLLBACK (manual): restoring the old boolean-with-default shape collapses the
-- NULL ("follow real completion") and false ("force incomplete") states back
-- into a single false, which is lossy. Provided for shape parity only.
-- BEGIN;
-- UPDATE public.zltac_registrations SET admin_override_coc      = false WHERE admin_override_coc      IS NULL;
-- UPDATE public.zltac_registrations SET admin_override_media    = false WHERE admin_override_media    IS NULL;
-- UPDATE public.zltac_registrations SET admin_override_ref_test = false WHERE admin_override_ref_test IS NULL;
-- UPDATE public.zltac_registrations SET admin_override_u18      = false WHERE admin_override_u18      IS NULL;
-- ALTER TABLE public.zltac_registrations
--   ALTER COLUMN admin_override_coc      SET DEFAULT false,
--   ALTER COLUMN admin_override_coc      SET NOT NULL,
--   ALTER COLUMN admin_override_media    SET DEFAULT false,
--   ALTER COLUMN admin_override_media    SET NOT NULL,
--   ALTER COLUMN admin_override_ref_test SET DEFAULT false,
--   ALTER COLUMN admin_override_ref_test SET NOT NULL,
--   ALTER COLUMN admin_override_u18      SET DEFAULT false,
--   ALTER COLUMN admin_override_u18      SET NOT NULL;
-- COMMIT;
