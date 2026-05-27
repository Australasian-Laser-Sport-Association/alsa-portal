-- Phase 2a: competition description + structured links.
--
-- Adds two content fields to public.competitions so managers can publish
-- long-form copy and a curated list of external resources (schedule, Google
-- Sheets, etc.) for each event.
--
-- Column shapes:
--   description text       — long-form free text, nullable, ≤ 10,000 chars.
--                            Rendered with whitespace-pre-wrap on the public
--                            detail page; no markdown / HTML parsing.
--   links       jsonb      — array of {label, url} objects, nullable.
--                            SQL CHECK only enforces "is array, ≤ 20 entries"
--                            so a future migration can extend the per-element
--                            schema without rewriting this constraint.
--
-- Per-element shape validation (label non-empty ≤ 80 chars, url http/https
-- ≤ 2048 chars) is enforced at the API layer in handleCompetitions
-- (validateContent helper). Keeping it out of SQL keeps the constraint
-- migration-cheap; column-level checks here would force a schema bump every
-- time we widen the limit.
--
-- No RLS or grant changes: the existing competitions policies cover the new
-- columns automatically. The public_competition_roster view does not
-- reference these columns and stays unchanged.

ALTER TABLE public.competitions
  ADD COLUMN description text;

ALTER TABLE public.competitions
  ADD COLUMN links jsonb;

ALTER TABLE public.competitions
  ADD CONSTRAINT competitions_description_length
  CHECK (description IS NULL OR length(description) <= 10000);

ALTER TABLE public.competitions
  ADD CONSTRAINT competitions_links_shape
  CHECK (
    links IS NULL
    OR (
      jsonb_typeof(links) = 'array'
      AND jsonb_array_length(links) <= 20
    )
  );
