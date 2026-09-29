-- SQL Script for Automated Emergency SMS Setup (httpSMS)
-- Run this in your Supabase SQL Editor

-- 1. Add auto_sms_enabled toggle to profiles (defaults to TRUE)
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS auto_sms_enabled BOOLEAN DEFAULT true;

-- 2. Add system-wide emergency settings for SMS
INSERT INTO public.emergency_settings (key, value) VALUES
  ('auto_sms_enabled', 'true'),
  ('hotline_number', '+639XXXXXXXXX')
ON CONFLICT (key) DO NOTHING;

-- 3. Create sms_logs table for audit trail and delivery tracking
CREATE TABLE IF NOT EXISTS public.sms_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incident_id BIGINT REFERENCES public.incidents(id) ON DELETE SET NULL,
  profile_id TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_phone TEXT NOT NULL,
  sender_phone TEXT,
  recipient_name TEXT,
  recipient_role TEXT, -- 'Family Member' or 'Community Hotline'
  message_content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING', -- 'SENT', 'FAILED', 'SIMULATED'
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_sms_logs_created ON public.sms_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_logs_profile ON public.sms_logs(profile_id);
