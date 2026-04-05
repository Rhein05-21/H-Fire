const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
);

async function triggerFakeFire() {
  console.log('🔥 Initializing Virtual Fire Simulation...');

  // 1. Get a Profile ID (Get the first user in the system)
  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('id, name')
    .limit(1)
    .single();

  if (profErr || !profile) {
    console.error('❌ Error: No profiles found. Please sign up in the app first!');
    return;
  }

  const TEST_MAC = 'VIRTUAL-ESP32-001';
  console.log(`👤 Linking test to user: ${profile.name} (${profile.id})`);

  // 2. Create a Virtual Device if it doesn't exist
  const { error: devErr } = await supabase
    .from('devices')
    .upsert([{
      mac: TEST_MAC,
      house_name: 'Virtual Laboratory',
      label: 'Main Computer',
      profile_id: profile.id,
      community: 'Simulation-Town'
    }]);

  if (devErr) {
    console.error('❌ Error creating virtual device:', devErr.message);
    return;
  }

  console.log(`📡 Virtual Device Ready: ${TEST_MAC}`);

  // 3. Trigger the Incident
  const { data, error } = await supabase
    .from('incidents')
    .insert([{
      device_mac: TEST_MAC,
      status: 'Active',
      ppm_at_trigger: 2850, 
      alert_type: 'FIRE',
      profile_id: profile.id
    }])
    .select();

  if (error) {
    console.error('❌ Failed to trigger alert:', error.message);
  } else {
    console.log('\n✅ ALERT SENT TO SUPABASE!');
    console.log('---------------------------');
    console.log('🔔 STATUS: Critical Fire');
    console.log('📍 LOCATION: Virtual Laboratory');
    console.log('🔥 INTENSITY: 2850 PPM');
    console.log('---------------------------');
    console.log('Check your phone. The Siren should be playing now!');
  }
}

triggerFakeFire();
