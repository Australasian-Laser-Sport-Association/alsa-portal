-- Tighten over-broad authenticated write grants.
--
-- doubles_pairs, triples_teams, and competition_registrations are written ONLY
-- via the service-role API (supabaseAdmin in api/*). The authenticated role
-- never writes them from the browser. The INSERT/UPDATE/DELETE grants to
-- authenticated — together with their self-write RLS policies — were an unused
-- client-write bypass:
--   * doubles_pairs / triples_teams: a player could forge or alter pairings
--     directly (forced pairings), bypassing the API's partner-confirmation flow.
--   * competition_registrations: a player could self-insert/self-update,
--     dodging server-authoritative pricing (billing-slug dodge) and inserting
--     into closed competitions, bypassing the registration-window checks the
--     API enforces.
-- Removing the write grants closes that surface. SELECT is retained so the
-- existing read policies keep working. service_role bypasses table grants
-- entirely, so the API write paths are unaffected.
--
-- The self-write RLS policies on these tables are now inert (no underlying
-- grant for them to act on) and can be pruned in a later cleanup migration.
--
-- ALREADY APPLIED: these REVOKEs were applied to the database by hand. This
-- file exists so local migration history stays in sync with the deployed
-- schema; `supabase db push` is a no-op for this change in production.

REVOKE INSERT, UPDATE, DELETE ON public.doubles_pairs             FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.triples_teams            FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.competition_registrations FROM authenticated;


-- =============================================================================
-- ROLLBACK (commented out — run this block manually to revert this migration)
-- =============================================================================
-- GRANT INSERT, UPDATE, DELETE ON public.doubles_pairs             TO authenticated;
-- GRANT INSERT, UPDATE, DELETE ON public.triples_teams            TO authenticated;
-- GRANT INSERT, UPDATE, DELETE ON public.competition_registrations TO authenticated;
