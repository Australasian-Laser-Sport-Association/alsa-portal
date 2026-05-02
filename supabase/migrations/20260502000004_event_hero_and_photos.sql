-- Phase B.3c.2: Add admin-editable hero text + photo gallery to current events.
-- Both columns are non-destructive additions — existing rows keep working.
-- description (short summary) stays as-is for archived event history records.

ALTER TABLE public.zltac_events
  ADD COLUMN IF NOT EXISTS hero_text text,
  ADD COLUMN IF NOT EXISTS photo_urls text[] NOT NULL DEFAULT '{}';
