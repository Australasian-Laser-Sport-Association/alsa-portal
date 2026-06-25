-- Harden internal trigger/event-trigger functions against direct RPC execution.
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default. That made a
-- set of trigger-only helpers appear executable to anon/authenticated via the
-- Data API even though they are not intended as RPC endpoints. Trigger
-- execution is unaffected by these revokes; triggers were already created.
--
-- Deliberately not included here:
--   * RLS helper functions such as is_committee(), is_active_user(),
--     is_superadmin(), is_competition_manager(), and is_reg_open_for_year().
--     Policies call those helpers as the querying role.
--   * Service-role RPCs such as claim_placeholder_profile() and
--     create_zltac_captain_team(), which already have explicit service_role
--     EXECUTE grants and no anon/authenticated EXECUTE grants.

DO $$
DECLARE
  function_signature text;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.cleanup_profile_on_auth_delete()',
    'public.clear_force_incomplete_on_resign()',
    'public.enforce_alias_lock()',
    'public.enforce_zltac_registration_capacity()',
    'public.enforce_zltac_roster_capacity()',
    'public.enforce_zltac_roster_lock()',
    'public.enforce_zltac_team_capacity()',
    'public.enforce_zltac_team_lock()',
    'public.handle_new_user()',
    'public.log_payment_record_delete()',
    'public.protect_competition_registration_fields()',
    'public.protect_registration_admin_fields()',
    'public.rls_auto_enable()',
    'public.set_competition_amount_owing()',
    'public.set_competition_payment_reference()',
    'public.set_zltac_registration_payment_reference()',
    'public.sync_profile_email()',
    'public.touch_updated_at()'
  ]
  LOOP
    IF to_regprocedure(function_signature) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
        function_signature
      );
    END IF;
  END LOOP;
END
$$;
