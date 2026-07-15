-- Complete the public-view cutover by removing anonymous base-table access.
-- Authenticated users retain RLS-scoped access required by their private
-- dashboards. Public legal-document discovery is served by the filtered
-- /api/public?resource=required-documents contract introduced alongside the
-- legal publication-integrity migration.

BEGIN;

REVOKE SELECT ON public.zltac_events FROM anon;
REVOKE SELECT ON public.competitions FROM anon;
REVOKE SELECT ON public.teams FROM anon;
REVOKE SELECT ON public.legal_documents FROM anon;

-- The legacy competition view retains nullable compatibility columns for the
-- previously deployed service-role API. Keep the object temporarily so that
-- migration-first rollout remains failure-safe, but make it unreachable to
-- both browser roles.
-- New code reads public_competition_roster_safe; a later cleanup may drop the
-- legacy object after the cutover has been observed in production.
REVOKE ALL ON public.public_competition_roster FROM anon, authenticated;

COMMIT;
