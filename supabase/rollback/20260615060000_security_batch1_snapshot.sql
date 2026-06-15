-- Run immediately before 20260615060000_security_batch1.sql.
-- Captures values that the migration intentionally changes or clears.

CREATE SCHEMA IF NOT EXISTS rollout_20260615;

DROP TABLE IF EXISTS rollout_20260615.storage_bucket_config;
CREATE TABLE rollout_20260615.storage_bucket_config AS
SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id IN ('team-logos', 'referee-test-media');

DROP TABLE IF EXISTS rollout_20260615.team_svg_references;
CREATE TABLE rollout_20260615.team_svg_references AS
SELECT id, logo_url
FROM public.teams
WHERE logo_url IS NOT NULL
  AND lower(split_part(logo_url, '?', 1)) LIKE '%.svg';

DROP TABLE IF EXISTS rollout_20260615.referee_svg_references;
CREATE TABLE rollout_20260615.referee_svg_references AS
SELECT id, image_url
FROM public.referee_questions
WHERE image_url IS NOT NULL
  AND lower(split_part(image_url, '?', 1)) LIKE '%.svg';
