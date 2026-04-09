-- SQL for Family Members Registry & Emergency Settings
-- Run this in your Supabase SQL Editor

-- 1. Create family_members table
CREATE TABLE IF NOT EXISTS public.family_members (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id  TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL,
  age         INTEGER CHECK (age >= 0 AND age <= 150),
  relationship TEXT NOT NULL DEFAULT 'Member',  -- 'Head', 'Spouse', 'Child', 'Parent', 'Sibling', 'Other'
  email       TEXT,
  phone       TEXT NOT NULL,                     -- E.164 format: +639XXXXXXXXX
  is_primary  BOOLEAN DEFAULT FALSE,             -- Primary emergency contact
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup by household
CREATE INDEX IF NOT EXISTS idx_family_members_profile ON family_members(profile_id);

-- 2. RLS Policies for family_members
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own family" ON public.family_members;
CREATE POLICY "Users manage own family"
  ON family_members FOR ALL
  USING (profile_id = auth.uid()::text)
  WITH CHECK (profile_id = auth.uid()::text);

DROP POLICY IF EXISTS "Admins view all families" ON public.family_members;
CREATE POLICY "Admins view all families"
  ON family_members FOR SELECT
  USING (public.is_admin());

-- 3. Add emergency hotline to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS emergency_hotline TEXT DEFAULT '+639XXXXXXXXX';

-- 4. Create emergency_settings table
CREATE TABLE IF NOT EXISTS public.emergency_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default settings
INSERT INTO public.emergency_settings (key, value) VALUES
  ('auto_call_enabled', 'true'),
  ('auto_call_delay_seconds', '120'),
  ('hotline_number', '+639XXXXXXXXX'),
  ('twilio_enabled', 'true'),
  ('max_call_attempts', '3'),
  ('call_retry_interval_seconds', '60')
ON CONFLICT (key) DO NOTHING;

-- 5. Create call_logs table
CREATE TABLE IF NOT EXISTS public.call_logs (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incident_id   BIGINT NOT NULL REFERENCES public.incidents(id),
  profile_id    TEXT REFERENCES public.profiles(id),
  family_member_id BIGINT REFERENCES public.family_members(id),
  phone_number  TEXT NOT NULL,
  call_type     TEXT NOT NULL,       -- 'family_primary', 'family_member', 'hotline'
  call_sid      TEXT,                -- Twilio Call SID
  status        TEXT DEFAULT 'initiated',
  duration_sec  INTEGER,
  attempt       INTEGER DEFAULT 1,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_call_logs_incident ON call_logs(incident_id);
