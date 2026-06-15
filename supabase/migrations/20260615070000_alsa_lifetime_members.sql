-- ALSA lifetime members
--
-- A lifetime membership is a public honorary status attached to a profile,
-- separate from annual paid membership periods. Keeping it in its own table
-- avoids exposing a writable profile flag to ordinary profile self-edits and
-- leaves a small audit trail for committee maintenance.

CREATE TABLE IF NOT EXISTS public.alsa_lifetime_members (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes text
);

CREATE INDEX IF NOT EXISTS alsa_lifetime_members_granted_at_idx
  ON public.alsa_lifetime_members (granted_at DESC);

GRANT ALL ON public.alsa_lifetime_members TO service_role;

ALTER TABLE public.alsa_lifetime_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alsa_lifetime_members_committee_all" ON public.alsa_lifetime_members
  FOR ALL TO authenticated
  USING (public.is_committee())
  WITH CHECK (public.is_committee());
