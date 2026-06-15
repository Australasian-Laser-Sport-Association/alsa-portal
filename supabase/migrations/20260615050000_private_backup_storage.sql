-- Store backups in private object storage. No authenticated storage policy is
-- created: only the service-role backup endpoint can read or write this bucket.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('portal-backups', 'portal-backups', false, 26214400, ARRAY['text/csv', 'application/json'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE public.backup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL CHECK (status IN ('running', 'complete', 'failed')),
  object_prefix text NOT NULL UNIQUE,
  object_paths text[] NOT NULL DEFAULT ARRAY[]::text[],
  manifest jsonb,
  failure_message text,
  triggered_by text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX backup_runs_started_at_idx ON public.backup_runs (started_at DESC);
ALTER TABLE public.backup_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY backup_runs_committee_read
  ON public.backup_runs FOR SELECT TO authenticated
  USING (public.is_committee());

REVOKE INSERT, UPDATE, DELETE ON public.backup_runs FROM authenticated;
GRANT SELECT ON public.backup_runs TO authenticated;
