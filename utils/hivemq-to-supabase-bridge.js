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
async function sendPushNotification(ownerId, houseName, alertType, ppm, incidentId, deviceMac, label) {
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

    console.log(`🔔 Sending Enriched Push Alert to: ${profile.name}`);

    const message = {
      to: profile.push_token,
      sound: 'default',
      title: alertType === 'FIRE' ? '🔥 FIRE ALERT' : '⚠️ GAS/SMOKE ALERT',
      body: `${houseName} · ${label} · ${ppm} PPM`,
      data: { 
        incidentId, 
        device_mac: deviceMac, 
        alert_type: alertType, 
        house_name: houseName, 
        label, 
        ppm 
      },
      priority: 'high',
      channelId: 'emergency-alerts',
      // ANTI-SPAM & GROUPING (Cross-Platform)
      android: {
        tag: deviceMac, // Android: Overwrites existing notification from this device
        collapseKey: deviceMac,
      },
      ios: {
        threadId: deviceMac, // iOS: Groups notifications from this device into one stack
        _displayInForeground: true,
      },
      mutableContent: true, // Allows for future rich media or custom logic on iOS
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
  let data;

  try {
    data = JSON.parse(payload);
  } catch (e) {
    // FALLBACK: Try parsing as comma-separated values (MAC,PPM,FLAME)
    const parts = payload.split(',');
    if (parts.length >= 2) {
      data = {
        mac: parts[0].trim(),
        ppm: Number(parts[1].trim()),
        flame: parts[2] ? parts[2].trim() === '1' || parts[2].trim() === 'true' : false
      };
      console.log(`💡 [${new Date().toLocaleTimeString()}] Parsed CSV Fallback:`, data);
    } else {
      console.warn(`⚠️ Rejected malformed payload: ${payload}`);
      return; 
    }
  }

  // Normalize MAC
  if (data.mac) data.mac = data.mac.toUpperCase();
  
  // Validate payload before processing
  const validation = validatePayload(data);
  if (!validation.valid) {
    console.warn(`⚠️ Rejected payload: ${validation.reason}`);
    return;
  }
  
  mac = data.mac;
  ppm = Number(data.ppm);
  flame = data.flame === true;

  if (!mac) return;

  // 1. Update Health/Heartbeat (UPSERT so new devices are registered automatically)
  await supabase.from('devices').upsert({ 
    mac: mac, 
    last_seen: new Date().toISOString(),
    label: `New Device ${mac.slice(-4)}`,
    house_name: 'Unregistered House'
  }, { onConflict: 'mac' });

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

    if (ppm > 1500 || (flame === true && ppm > 450)) {
      status = 'Danger';
      alertType = 'FIRE';
    } else if (ppm > 450) {
      status = 'Warning';
      alertType = 'GAS / SMOKE LEAK';
    }

    await supabase.from('gas_logs').insert([{ 
      device_mac: mac, ppm_level: ppm, status, profile_id: ownerId 
    }]);

    if (status === 'Danger' || status === 'Warning') {
      console.log(`🚨 ${alertType} DETECTED at ${mac}!`);
      const { data: device } = await supabase.from('devices').select('house_name, label').eq('mac', mac).single();
      
      let insertedIncidentId = null;
      if (status === 'Danger') {
        const { data: incident } = await supabase.from('incidents').insert([{
          device_mac: mac, status: 'Active', ppm_at_trigger: ppm,
          alert_type: alertType, profile_id: ownerId
        }]).select('id').single();
        insertedIncidentId = incident?.id;
      }

      await sendPushNotification(
        ownerId, 
        device?.house_name || 'Home', 
        alertType, 
        ppm, 
        insertedIncidentId, 
        mac, 
        device?.label || 'Unknown Room'
      );
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
