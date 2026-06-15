CREATE TABLE IF NOT EXISTS public.document_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('alsa','zltac')),
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('alsa','zltac')),
  category_id uuid REFERENCES public.document_categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  url text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.document_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_categories_public_read ON public.document_categories;
CREATE POLICY document_categories_public_read ON public.document_categories FOR SELECT USING (true);
DROP POLICY IF EXISTS document_categories_committee_write ON public.document_categories;
CREATE POLICY document_categories_committee_write ON public.document_categories FOR ALL USING (public.is_committee()) WITH CHECK (public.is_committee());
DROP POLICY IF EXISTS documents_public_read ON public.documents;
CREATE POLICY documents_public_read ON public.documents FOR SELECT USING (true);
DROP POLICY IF EXISTS documents_committee_write ON public.documents;
CREATE POLICY documents_committee_write ON public.documents FOR ALL USING (public.is_committee()) WITH CHECK (public.is_committee());
GRANT SELECT ON public.document_categories TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.document_categories TO authenticated;
GRANT SELECT ON public.documents TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.documents TO authenticated;
DROP TRIGGER IF EXISTS document_categories_touch ON public.document_categories;
CREATE TRIGGER document_categories_touch BEFORE UPDATE ON public.document_categories FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS documents_touch ON public.documents;
CREATE TRIGGER documents_touch BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
