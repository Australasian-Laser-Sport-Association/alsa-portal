CREATE TABLE IF NOT EXISTS public.cms_global (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cms_global ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cms_global_public_read ON public.cms_global;
CREATE POLICY cms_global_public_read ON public.cms_global FOR SELECT USING (true);
DROP POLICY IF EXISTS cms_global_committee_write ON public.cms_global;
CREATE POLICY cms_global_committee_write ON public.cms_global FOR ALL USING (public.is_committee()) WITH CHECK (public.is_committee());
GRANT SELECT ON public.cms_global TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.cms_global TO authenticated;
INSERT INTO public.cms_global (key, value) VALUES ('site_banner', '{"enabled": false, "message": "This site is in testing mode. All information, dates, and payment figures shown are placeholders and should be treated as fictitious."}'::jsonb) ON CONFLICT (key) DO NOTHING;
