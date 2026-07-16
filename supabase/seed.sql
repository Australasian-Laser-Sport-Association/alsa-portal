-- Local resets intentionally start with an empty application database.
-- Tests and development fixtures should create only the rows they need so
-- repeated `supabase db reset` runs remain deterministic and contain no real
-- member information.
begin;
commit;
