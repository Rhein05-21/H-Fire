const mqtt = require('mqtt');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const http = require('http');

dotenv.config();

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
// FIX: Use service_role key for server-side bridge (bypasses RLS for system-level inserts)
// Falls back to anon key if service_role not set (dev compatibility)
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('⚠️  WARNING: SUPABASE_SERVICE_ROLE_KEY not set. Using anon key as fallback.');
  console.warn('   Set SUPABASE_SERVICE_ROLE_KEY in your .env for production use.');
}

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

// --- PAYLOAD VALIDATION ---
const MAC_REGEX = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

function validatePayload(data) {
  // Validate MAC address format (XX:XX:XX:XX:XX:XX)
  if (!data.mac || typeof data.mac !== 'string' || !MAC_REGEX.test(data.mac)) {
    return { valid: false, reason: `Invalid MAC: ${data.mac}` };
  }
  // Validate PPM range (must be a number between 0 and 10000)
  if (data.ppm !== undefined) {
    const ppm = Number(data.ppm);
    if (isNaN(ppm) || ppm < 0 || ppm > 10000) {
      return { valid: false, reason: `Invalid PPM: ${data.ppm}` };
    }
  }
  // Validate flame field (must be boolean if present)
  if (data.flame !== undefined && typeof data.flame !== 'boolean') {
    return { valid: false, reason: `Invalid flame value: ${data.flame}` };
  }
  return { valid: true };
}

async function processMessage(topic, payload) {
  let mac, ppm, flame;
  try {
    const data = JSON.parse(payload);
    
    // FIX: Validate payload before processing
    const validation = validatePayload(data);
    if (!validation.valid) {
      console.warn(`⚠️ Rejected payload: ${validation.reason}`);
      return;
    }
    
    mac = data.mac;
    ppm = Number(data.ppm);
    flame = data.flame === true;
  } catch (e) {
    console.warn('⚠️ Rejected non-JSON payload');
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

// --- RENDER KEEP-ALIVE SERVER (with basic rate limiting) ---
const PORT = process.env.PORT || 8080;
const rateLimit = {}; // { ip: { count, resetTime } }
const RATE_LIMIT_MAX = 60;       // Max requests per window
const RATE_LIMIT_WINDOW = 60000; // 1 minute window

http.createServer((req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  
  // Basic rate limiting
  if (!rateLimit[ip] || now > rateLimit[ip].resetTime) {
    rateLimit[ip] = { count: 1, resetTime: now + RATE_LIMIT_WINDOW };
  } else {
    rateLimit[ip].count++;
    if (rateLimit[ip].count > RATE_LIMIT_MAX) {
      res.writeHead(429, { 'Content-Type': 'text/plain' });
      res.end('Rate limit exceeded');
      return;
    }
  }
  
  console.log(`🌐 [${new Date().toLocaleTimeString()}] Ping from: ${ip}`);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'active',
    uptime: process.uptime(),
    devices_cached: Object.keys(deviceCache).length,
    timestamp: new Date().toISOString()
  }));
}).listen(PORT, () => {
  console.log(`🚀 HTTP Health-Check Server running on port ${PORT}`);
});
