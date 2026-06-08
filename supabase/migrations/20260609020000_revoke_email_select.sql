-- 20260609020000_revoke_email_select.sql
-- Item 2 (read-guard): profiles.email is a mirror of auth.users.email and must
-- only ever be surfaced through vetted service-role endpoints (managers /
-- registrations / volunteers). Revoking column SELECT from the authenticated
-- role means a future select('*') or a widened roster view CANNOT leak member
-- emails to logged-in users or anon — the DB rejects it rather than relying on
-- every reader staying explicit. The service role (endpoints) and SECURITY
-- DEFINER functions are unaffected (they bypass column grants); AuthContext
-- already selects explicit columns excluding email, and a user's own email is
-- read from the auth session, not this column.
REVOKE SELECT (email) ON public.profiles FROM authenticated;

-- ROLLBACK:
--   GRANT SELECT (email) ON public.profiles TO authenticated;
