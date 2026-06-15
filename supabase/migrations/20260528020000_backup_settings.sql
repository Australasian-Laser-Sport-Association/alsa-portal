-- =============================================================================
-- backup_settings — single-row configuration for the automated backup cron.
--
-- The cron route (/api/admin/event?resource=backup-run, triggered daily via
-- vercel.json crons) reads this row to decide whether to send today:
--   frequency = 'off'    → no-op
--   frequency = 'daily'  → always send
--   frequency = 'weekly' → only send when the current day-of-week in
--                          Australia/Sydney matches weekly_day (0 = Sun).
-- The row also records the last-attempt outcome so the admin UI can show
-- "Last backup: <time> — <status>".
--
-- Single-row enforcement via CHECK (id = 1). No INSERT or DELETE policies;
-- the seed below populates the row exactly once.
-- =============================================================================

CREATE TABLE public.backup_settings (
  id                  smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  frequency           text NOT NULL DEFAULT 'weekly'
                        CHECK (frequency IN ('daily', 'weekly', 'off')),
  weekly_day          smallint NOT NULL DEFAULT 0
                        CHECK (weekly_day BETWEEN 0 AND 6),
  recipient_emails    text[] NOT NULL DEFAULT '{}',
  last_backup_at      timestamptz,
  last_backup_status  text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Reuse the shared touch_updated_at trigger function from the initial schema.
CREATE TRIGGER backup_settings_touch_updated_at
  BEFORE UPDATE ON public.backup_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed the single row.
INSERT INTO public.backup_settings (id, frequency, weekly_day, recipient_emails)
VALUES (1, 'weekly', 0, ARRAY['committee@lasersport.org.au'])
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.backup_settings ENABLE ROW LEVEL SECURITY;

-- Committee read: schedule status is internal but not sensitive enough to
-- require superadmin. Any committee member can see when the last backup ran.
CREATE POLICY backup_settings_committee_read ON public.backup_settings
  FOR SELECT TO authenticated
  USING (public.is_committee());

-- Superadmin write: changing the schedule or the recipient list is a
-- system-level decision. service_role bypasses RLS for the cron and admin
-- API paths, which is the only write surface in normal operation; this
-- policy exists for defence-in-depth.
CREATE POLICY backup_settings_superadmin_update ON public.backup_settings
  FOR UPDATE TO authenticated
  USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

GRANT SELECT, UPDATE ON public.backup_settings TO authenticated;
