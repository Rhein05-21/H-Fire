const mqtt = require('mqtt');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

// Load .env variables
dotenv.config();

// Supabase Configuration
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// HiveMQ Configuration
const HIVEMQ_URL = `wss://${process.env.EXPO_PUBLIC_HIVEMQ_BROKER}:${process.env.EXPO_PUBLIC_HIVEMQ_PORT}/mqtt`;
const TOPIC_WILDCARD = 'hfire/#';

// Store state for all devices dynamically
const devices = {};
const profile_cache = {}; // MAC -> ProfileID Mapping

async function fetchProfileMappings() {
  console.log('Bridge: Refreshing Profile Mappings...');
  // Note: We need a devices table mapping mac to profile_id
  // For now, we'll try to find any profile with a matching 'houseId' if we can't find a direct MAC mapping
  const { data, error } = await supabase
    .from('profiles')
    .select('id, community, name');
  
  if (data) {
    data.forEach(p => {
      // Logic to map houseId/Block to profile
      profile_cache[p.community] = p.id;
    });
  }
}

// Initial fetch and periodic refresh
fetchProfileMappings();
setInterval(fetchProfileMappings, 60000); // Every minute

const client = mqtt.connect(HIVEMQ_URL, {
  username: process.env.EXPO_PUBLIC_HIVEMQ_USERNAME,
  password: process.env.EXPO_PUBLIC_HIVEMQ_PASSWORD,
  clientId: `hfire_bridge_${Math.random().toString(16).slice(2, 10)}`,
});

client.on('connect', () => {
  console.log('Bridge: Connected to HiveMQ (Dynamic Wildcard Mode)');
  client.subscribe([TOPIC_WILDCARD]);
});

async function saveToSupabase(houseId) {
  const device = devices[houseId];
  if (!device) return;

  // Find the profile_id for this houseId
  // We can match by community/block or a dedicated mapping
  const profileId = profile_cache[houseId] || profile_cache[`House ${houseId}`] || null;

  console.log(`[${houseId}] Saving: ${device.mac} | ${device.ppm} PPM | ${device.status} | Profile: ${profileId || 'NONE'}`);
  
  const { data, error } = await supabase
    .from('gas_logs')
    .insert([
      {
        device_mac: device.mac,
        ppm_level: device.ppm,
        status: device.status,
        profile_id: profileId
      },
    ]);

  if (error) {
    console.error(`[${houseId}] Supabase Insert Error:`, error.message);
  } else {
    console.log(`[${houseId}] Log saved: ${device.ppm} PPM (${device.status})`);
  }
}

client.on('message', async (topic, message) => {
  const payload = message.toString();
  const parts = topic.split('/');
  if (parts.length < 2) return;

  const houseId = parts[1];
  const type = parts[2];

  if (!devices[houseId]) {
    devices[houseId] = { ppm: 0, mac: 'Unknown', status: 'Normal' };
  }

  const device = devices[houseId];
  let shouldSave = false;

  // Try to parse as JSON first
  try {
    if (payload.startsWith('{')) {
      const json = JSON.parse(payload);
      if (json.mac) device.mac = json.mac;
      if (json.ppm !== undefined) {
        device.ppm = parseInt(json.ppm, 10);
        shouldSave = true;
      }
      if (json.status) {
        device.status = json.status === 'SAFE' ? 'Normal' : json.status;
        shouldSave = true;
      }
    } else {
      // Fallback to topic-based parsing
      if (type === 'ppm') {
        const newPpm = parseInt(payload, 10);
        if (!isNaN(newPpm)) {
          device.ppm = newPpm;
          shouldSave = true;
        }
      } else if (type === 'mac') {
        if (device.mac !== payload) {
          device.mac = payload;
        }
      } else if (type === 'status') {
        const normalizedStatus = payload === 'SAFE' ? 'Normal' : payload;
        if (device.status !== normalizedStatus) {
          device.status = normalizedStatus;
          shouldSave = true;
        }
      }
    }
  } catch (err) {
    console.error(`Error parsing message on ${topic}:`, err.message);
  }

  if (shouldSave) {
    await saveToSupabase(houseId);
  }
});

client.on('error', (err) => {
  console.error('MQTT Bridge Error:', err);
});
