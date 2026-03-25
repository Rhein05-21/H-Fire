const mqtt = require('mqtt');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config();

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const HIVEMQ_URL = `wss://${process.env.EXPO_PUBLIC_HIVEMQ_BROKER}:${process.env.EXPO_PUBLIC_HIVEMQ_PORT}/mqtt`;
const TOPIC_WILDCARD = 'hfire/#';

let deviceCache = {};

async function refreshDeviceCache() {
  const { data } = await supabase.from('devices').select('mac, profile_id');
  if (data) {
    const newCache = {};
    data.forEach(d => { newCache[d.mac] = d.profile_id; });
    deviceCache = newCache;
  }
}

refreshDeviceCache();
setInterval(refreshDeviceCache, 30000);

const client = mqtt.connect(HIVEMQ_URL, {
  username: process.env.EXPO_PUBLIC_HIVEMQ_USERNAME,
  password: process.env.EXPO_PUBLIC_HIVEMQ_PASSWORD,
  clientId: `hfire_bridge_v11_${Math.random().toString(16).slice(2, 10)}`,
});

client.on('connect', () => {
  console.log('✅ Bridge V11: Persistent Discovery Active');
  client.subscribe([TOPIC_WILDCARD]);
});

async function processMessage(topic, payload) {
  let mac, ppm;
  const parts = topic.split('/');
  const houseId = parts[1];

  try {
    const data = JSON.parse(payload);
    mac = data.mac;
    ppm = data.ppm;
  } catch (e) {
    // If not JSON, try to find mac in cache by houseId
    mac = Object.keys(deviceCache).find(k => k.includes(houseId));
  }

  if (!mac) return;

  // 🔥 CRITICAL: Always update the 'last_seen' time in the database
  // This allows the App to "Scan" and find this device even if it has no owner.
  const { error: healthErr } = await supabase
    .from('devices')
    .update({ last_seen: new Date().toISOString() })
    .eq('mac', mac);

  if (healthErr) console.error('Health Update Error:', healthErr.message);

  if (ppm !== undefined && !isNaN(ppm)) {
    const ownerId = deviceCache[mac];
    
    // Only save logs/incidents if there is an owner
    if (!ownerId) {
      console.log(`⚪ [Discovery] Device ${mac} is online but unlinked.`);
      return;
    }

    let status = (ppm > 1500) ? 'Danger' : (ppm > 450 ? 'Warning' : 'Normal');
    console.log(`📊 [${mac}] ${ppm} PPM | ${status}`);

    await supabase.from('gas_logs').insert([{ device_mac: mac, ppm_level: ppm, status, profile_id: ownerId }]);

    if (status !== 'Normal') {
      await supabase.from('incidents').insert([{
        device_mac: mac, status: 'Active', ppm_at_trigger: ppm,
        alert_type: (status === 'Danger') ? 'FIRE' : 'SMOKE',
        profile_id: ownerId
      }]);
    }
  }
}

client.on('message', (t, m) => processMessage(t, m.toString()));
