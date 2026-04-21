-- ============================================================
-- ALSA Portal — Admin Panel schema
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. Add role and suspended columns to profiles
-- -----------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'player'
    CHECK (role IN ('player', 'captain', 'committee', 'superadmin')),
  ADD COLUMN IF NOT EXISTS suspended boolean NOT NULL DEFAULT false;

-- 2. ZLTAC Events
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS zltac_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  year            int  NOT NULL,
  location        text,
  status          text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'closed', 'archived')),
  description     text,
  main_fee        int  NOT NULL DEFAULT 0,        -- cents
  dinner_guest_price int NOT NULL DEFAULT 6500,   -- cents
  side_events     jsonb,                          -- array of side event config objects
  reg_open_date   timestamptz,
  reg_close_date  timestamptz,
  require_coc     boolean NOT NULL DEFAULT true,
  require_ref_test boolean NOT NULL DEFAULT true,
  require_payment boolean NOT NULL DEFAULT true,
  max_teams       int,
  max_players     int,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE zltac_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read open events"
  ON zltac_events FOR SELECT
  USING (status IN ('open', 'closed', 'archived'));

CREATE POLICY "Committee can manage events"
  ON zltac_events FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('committee', 'superadmin')
    )
  );

-- 3. Referee Questions
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS referee_questions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question        text NOT NULL,
  option_a        text NOT NULL,
  option_b        text NOT NULL,
  option_c        text NOT NULL,
  option_d        text NOT NULL,
  correct_answer  text NOT NULL CHECK (correct_answer IN ('a', 'b', 'c', 'd')),
  category        text NOT NULL DEFAULT 'General',
  difficulty      text NOT NULL DEFAULT 'medium'
    CHECK (difficulty IN ('easy', 'medium', 'hard')),
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE referee_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read active questions"
  ON referee_questions FOR SELECT
  TO authenticated
  USING (active = true);

CREATE POLICY "Committee can manage questions"
  ON referee_questions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('committee', 'superadmin')
    )
  );

-- 4. Referee Test Settings
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS referee_test_settings (
  id                  int PRIMARY KEY DEFAULT 1,
  pass_score          int NOT NULL DEFAULT 70,       -- percentage
  time_limit_minutes  int NOT NULL DEFAULT 30,
  questions_per_test  int NOT NULL DEFAULT 20,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Seed default row
INSERT INTO referee_test_settings (id, pass_score, time_limit_minutes, questions_per_test)
VALUES (1, 70, 30, 20)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE referee_test_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read test settings"
  ON referee_test_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Committee can manage test settings"
  ON referee_test_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('committee', 'superadmin')
    )
  );

-- 5. Code of Conduct Versions
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS code_of_conduct_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content      text NOT NULL,
  is_published boolean NOT NULL DEFAULT false,
  version_note text,
  created_by   uuid REFERENCES profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE code_of_conduct_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read published CoC"
  ON code_of_conduct_versions FOR SELECT
  TO authenticated
  USING (is_published = true);

CREATE POLICY "Committee can manage CoC versions"
  ON code_of_conduct_versions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('committee', 'superadmin')
    )
  );

-- 6. Ensure teams table has a status column
-- -----------------------------------------------
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected'));

-- 7. Ensure payments table has expected columns
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES profiles(id) ON DELETE CASCADE,
  amount     int NOT NULL,   -- cents
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'refunded')),
  reference  text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own payments"
  ON payments FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Committee can read all payments"
  ON payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('committee', 'superadmin')
    )
  );

-- 8. Helper function: flag players needing CoC re-sign
--    Called after publishing a new CoC version.
--    Simplest implementation: delete existing signatures so players
--    are prompted to re-sign on next hub visit.
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION flag_coc_resign_required()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  DELETE FROM code_of_conduct_signatures;
$$;

-- 9. Update own role (run manually for your account):
-- -----------------------------------------------
-- UPDATE profiles SET role = 'superadmin' WHERE email = 'your@email.com';

-- ============================================================
-- Done. Refresh your schema cache in Supabase after running.
-- ============================================================
