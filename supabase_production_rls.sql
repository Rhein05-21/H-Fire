-- H-Fire Production Security (Phase 1: RLS Hardening)

-- 1. Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gas_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

-- 2. HELPER FUNCTION: Check if the current user is an admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT is_admin FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- 3. PROFILES POLICIES
-- Users can view their own profile, Admins can view all.
CREATE POLICY "Profiles: viewable by owner or admin" ON public.profiles
FOR SELECT USING (auth.uid() = id OR is_admin());

-- 4. DEVICES POLICIES
-- Admins can view/manage all devices. Residents can only view devices linked to their profile.
CREATE POLICY "Devices: admins see all, residents see owned" ON public.devices
FOR SELECT USING (is_admin() OR profile_id = auth.uid());

CREATE POLICY "Devices: update only by admin" ON public.devices
FOR UPDATE USING (is_admin());

-- 5. GAS_LOGS POLICIES
-- Critical for privacy: Users see only their home logs.
CREATE POLICY "Gas Logs: admins see all, residents see owned" ON public.gas_logs
FOR SELECT USING (is_admin() OR profile_id = auth.uid());

-- Bridge/Service Role policy (If using a specific service key, RLS is bypassed. 
-- But if using Anon key on the bridge, we need an insert policy):
CREATE POLICY "Gas Logs: insert by authenticated users" ON public.gas_logs
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 6. INCIDENTS POLICIES
CREATE POLICY "Incidents: admins see all, residents see owned" ON public.incidents
FOR SELECT USING (is_admin() OR profile_id = auth.uid());

CREATE POLICY "Incidents: update only by admin (resolve alerts)" ON public.incidents
FOR UPDATE USING (is_admin());

-- 7. REFRESH REALTIME
-- Re-enable to ensure policies are applied to subscription streams
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS gas_logs, incidents;
ALTER PUBLICATION supabase_realtime ADD TABLE gas_logs, incidents;
