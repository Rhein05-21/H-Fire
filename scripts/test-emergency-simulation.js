const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const { sendAutomatedEmergencySms } = require('../utils/sms-service');

dotenv.config();

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
);

async function simulateDangerEvent() {
  console.log('\n🔥 --- SIMULATING CRITICAL EMERGENCY EVENT (DANGER) ---');

  // Fetch first available profile
  const { data: profile } = await supabase.from('profiles').select('id, name').limit(1).maybeSingle();
  const profileId = profile?.id || null;
  const houseName = profile?.name ? `${profile.name} Household` : 'Demo Resident Home';

  console.log(`👤 Target Household: ${houseName} (${profileId})`);

  // Trigger automated emergency SMS dispatcher
  await sendAutomatedEmergencySms(supabase, {
    incidentId: null,
    profileId,
    houseName,
    nodeLabel: 'Kitchen Sensor Node 1',
    alertType: 'FIRE / GAS LEAK',
    ppm: 1850,
    flame: true,
    mac: '20:50:0D:33:68:0C',
  });

  console.log('✅ Simulation completed. Check Supabase sms_logs table and terminal output above!\n');
}

simulateDangerEvent();
