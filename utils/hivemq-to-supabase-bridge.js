const mqtt = require('mqtt');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const http = require('http');

dotenv.config();

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const HIVEMQ_URL = `wss://${process.env.EXPO_PUBLIC_HIVEMQ_BROKER}:${process.env.EXPO_PUBLIC_HIVEMQ_PORT}/mqtt`;
const TOPIC_WILDCARD = 'hfire/#';

let deviceCache = {};

// Refresh device mapping & update Bridge Heartbeat every 30 seconds
async function refreshDeviceCache() {
  const { data } = await supabase.from('devices').select('mac, profile_id');
  if (data) {
    const newCache = {};
    data.forEach(d => { newCache[d.mac] = d.profile_id; });
    deviceCache = newCache;
    console.log(`🔄 [${new Date().toLocaleTimeString()}] Cache Refreshed`);
  }

  // GLOBAL HEARTBEAT: Tell the app the Bridge is ALIVE
  await supabase.from('app_settings').upsert({ 
    key: 'bridge_heartbeat', 
    value: new Date().toISOString(),
    updated_at: new Date().toISOString() 
  });
}


refreshDeviceCache();
setInterval(refreshDeviceCache, 30000);

// --- PUSH NOTIFICATION LOGIC ---
async function sendPushNotification(ownerId, houseName, alertType, ppm) {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('push_token, name')
      .eq('id', ownerId)
      .single();

    if (!profile?.push_token) {
      console.log(`⚠️ No push token found for user: ${ownerId}`);
      return;
    }

    console.log(`🔔 Sending Push Alert to: ${profile.name}`);

    const message = {
      to: profile.push_token,
      sound: 'default',
      title: `🔥 EMERGENCY: ${alertType} DETECTED`,
      body: `${houseName}: Critical level detected (${ppm} PPM). Check the app!`,
      data: { houseName, alertType, ppm },
      priority: 'high',
    };

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const result = await response.json();
    console.log('✅ Expo Response:', result);
  } catch (error) {
    console.error('❌ Push Error:', error.message);
  }
}

const client = mqtt.connect(HIVEMQ_URL, {
  username: process.env.EXPO_PUBLIC_HIVEMQ_USERNAME,
  password: process.env.EXPO_PUBLIC_HIVEMQ_PASSWORD,
  clientId: `hfire_bridge_v11_${Math.random().toString(16).slice(2, 10)}`,
});

client.on('connect', () => {
  console.log('✅ Bridge Connected to HiveMQ Cloud');
  client.subscribe([TOPIC_WILDCARD]);
});

async function processMessage(topic, payload) {
  let mac, ppm, flame;
  try {
    const data = JSON.parse(payload);
    mac = data.mac;
    ppm = data.ppm;
    flame = data.flame;
  } catch (e) {
    return; 
  }

  if (!mac) return;

  // 1. Update Health/Heartbeat
  await supabase.from('devices').update({ last_seen: new Date().toISOString() }).eq('mac', mac);

  // 2. Process Data
  if (ppm !== undefined) {
    let ownerId = deviceCache[mac];
    if (!ownerId) {
      const { data: dev } = await supabase.from('devices').select('profile_id').eq('mac', mac).single();
      if (dev?.profile_id) {
        ownerId = dev.profile_id;
        deviceCache[mac] = ownerId;
      }
    }

    if (!ownerId) return;

    let status = 'Normal';
    let alertType = 'NONE';

    if (flame === true && ppm > 450) {
      status = 'Danger';
      alertType = 'FIRE';
    } else if (ppm > 1500) {
      status = 'Danger';
      alertType = 'GAS/SMOKE';
    } else if (flame === true || ppm > 450) {
      status = 'Warning';
      alertType = flame ? 'FLAME' : 'MODERATE SMOKE';
    }

    await supabase.from('gas_logs').insert([{ 
      device_mac: mac, ppm_level: ppm, status, profile_id: ownerId 
    }]);

    if (status === 'Danger') {
      console.log(`🚨 DANGER DETECTED at ${mac}!`);
      const { data: device } = await supabase.from('devices').select('house_name').eq('mac', mac).single();
      
      await supabase.from('incidents').insert([{
        device_mac: mac, status: 'Active', ppm_at_trigger: ppm,
        alert_type: alertType, profile_id: ownerId
      }]);

      await sendPushNotification(ownerId, device?.house_name || 'Home', alertType, ppm);
    }
  }
}

client.on('message', (t, m) => processMessage(t, m.toString()));

// --- RENDER KEEP-ALIVE SERVER ---
// This simple server allows Render to see the app as "Healthy" 
// and gives cron-job.org a target to ping.
const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
  console.log(`🌐 [${new Date().toLocaleTimeString()}] Ping received from: ${req.headers['user-agent']}`);
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.write('H-Fire Monitoring Bridge is ACTIVE');
  res.end();
}).listen(PORT, () => {
  console.log(`🚀 HTTP Health-Check Server running on port ${PORT}`);
});
