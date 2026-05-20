-- =============================================================================
-- Rules Test — attach placeholder images to a few seeded placeholder questions.
--
-- Demonstrates the image_url field end-to-end. Images are committed static
-- assets served from /referee-test-placeholders/<name>.svg (see
-- public/referee-test-placeholders/). Most questions stay text-only.
--
-- No video placeholders are seeded — clips are large, so the committee uploads
-- real videos through the admin editor (the video_url field + referee-test-media
-- bucket are wired and ready; leaving a question without a video demonstrates
-- the empty upload slot).
--
-- Dependency order (by timestamp):
--   20260520060000  adds section column
--   20260520060001  seeds the placeholder questions
--   20260520060002  adds image_url/video_url columns + bucket   <-- required
--   20260520060003  THIS FILE — sets image_url on seeded rows
--
-- Idempotent: each UPDATE is guarded by `image_url IS NULL`, so re-running
-- never clobbers media the committee has since changed.
-- =============================================================================

UPDATE public.referee_questions SET image_url = '/referee-test-placeholders/safety-eyewear.svg'
  WHERE question = 'PLACEHOLDER (Safety): What must you wear during play?' AND image_url IS NULL;

UPDATE public.referee_questions SET image_url = '/referee-test-placeholders/emergency-exits.svg'
  WHERE question = 'PLACEHOLDER (Safety): Emergency exits must be:' AND image_url IS NULL;

UPDATE public.referee_questions SET image_url = '/referee-test-placeholders/hit-zones.svg'
  WHERE question = 'PLACEHOLDER (Safety): Where should you never aim your laser phaser?' AND image_url IS NULL;

UPDATE public.referee_questions SET image_url = '/referee-test-placeholders/arena-layout.svg'
  WHERE question = 'PLACEHOLDER (General): The objective in capture mode is to:' AND image_url IS NULL;

UPDATE public.referee_questions SET image_url = '/referee-test-placeholders/base-defence.svg'
  WHERE question = 'PLACEHOLDER (General): In base-defence mode the base is:' AND image_url IS NULL;

UPDATE public.referee_questions SET image_url = '/referee-test-placeholders/team-colours.svg'
  WHERE question = 'PLACEHOLDER (General): Team colours are used to:' AND image_url IS NULL;

UPDATE public.referee_questions SET image_url = '/referee-test-placeholders/foul-play.svg'
  WHERE question = 'PLACEHOLDER (General): Tagging your own teammate usually:' AND image_url IS NULL;
