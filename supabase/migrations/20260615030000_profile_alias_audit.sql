-- Privileged alias changes must be atomic and attributable. Browser clients
-- cannot execute this function or write its audit table directly.

CREATE TABLE public.profile_change_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_profile_id uuid NOT NULL,
  field_name text NOT NULL CHECK (field_name = 'alias'),
  old_value text,
  new_value text,
  reason text NOT NULL CHECK (char_length(btrim(reason)) >= 5),
  changed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('admin-users', 'registration-editor')),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX profile_change_audit_target_idx
  ON public.profile_change_audit (target_profile_id, changed_at DESC);
CREATE INDEX profile_change_audit_changed_at_idx
  ON public.profile_change_audit (changed_at DESC);

ALTER TABLE public.profile_change_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY profile_change_audit_committee_read
  ON public.profile_change_audit FOR SELECT TO authenticated
  USING (public.is_committee());

REVOKE INSERT, UPDATE, DELETE ON public.profile_change_audit FROM authenticated;
GRANT SELECT ON public.profile_change_audit TO authenticated;

CREATE OR REPLACE FUNCTION public.change_profile_alias(
  p_target_profile_id uuid,
  p_new_alias text,
  p_reason text,
  p_changed_by uuid,
  p_source text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_alias text;
  v_new_alias text := nullif(btrim(p_new_alias), '');
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  IF v_new_alias IS NOT NULL AND char_length(v_new_alias) > 30 THEN
    RAISE EXCEPTION 'Alias must be 30 characters or fewer' USING ERRCODE = '22001';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('admin-users', 'registration-editor') THEN
    RAISE EXCEPTION 'Invalid alias change source' USING ERRCODE = '22023';
  END IF;

  SELECT alias INTO v_old_alias
    FROM public.profiles
   WHERE id = p_target_profile_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_old_alias IS NOT DISTINCT FROM v_new_alias THEN
    RETURN jsonb_build_object('changed', false, 'alias', v_new_alias);
  END IF;
  IF char_length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Alias change reason must be at least 5 characters' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles SET alias = v_new_alias WHERE id = p_target_profile_id;
  INSERT INTO public.profile_change_audit (
    target_profile_id, field_name, old_value, new_value, reason, changed_by, source
  ) VALUES (
    p_target_profile_id, 'alias', v_old_alias, v_new_alias, v_reason, p_changed_by, p_source
  );

  RETURN jsonb_build_object('changed', true, 'alias', v_new_alias);
END;
$$;

REVOKE ALL ON FUNCTION public.change_profile_alias(uuid, text, text, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.change_profile_alias(uuid, text, text, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.change_profile_alias(uuid, text, text, uuid, text) TO service_role;
