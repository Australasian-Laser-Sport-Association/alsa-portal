-- Migration: Explicit service_role table grants
--
-- The app's Vercel API routes use the Supabase service-role key for
-- cross-user committee/admin reads and writes. Supabase service_role bypasses
-- RLS, but Postgres table privileges are still enforced. Make those table and
-- sequence privileges explicit so fresh/staging projects do not fail with
-- 42501 "permission denied for table ..." errors.

GRANT USAGE ON SCHEMA public TO service_role;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;
