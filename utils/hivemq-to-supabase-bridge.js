const mqtt = require('mqtt');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const http = require('http');
const { sendAutomatedEmergencySms } = require('./sms-service');

dotenv.config();

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
// Service role key allows full backend updates, falls back to anon key
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials in .env file.');
}

const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseKey || 'placeholder');

const HIVEMQ_URL = process.env.EXPO_PUBLIC_HIVEMQ_BROKER 
  ? `wss://${process.env.EXPO_PUBLIC_HIVEMQ_BROKER}:${process.env.EXPO_PUBLIC_HIVEMQ_PORT || 8884}/mqtt`
  : null;

const TOPIC_WILDCARD = process.env.EXPO_PUBLIC_HIVEMQ_TOPIC || 'hfire/#';

console.log('🚀 Starting H-Fire Resident Telemetry Bridge...');
console.log('📡 Broker:', process.env.EXPO_PUBLIC_HIVEMQ_BROKER);
console.log('🎯 Topic Subscription:', TOPIC_WILDCARD);

// 1. Heartbeat updater to app_settings
if (supabaseUrl && !supabaseUrl.includes('placeholder')) {
  setInterval(async () => {
    try {
      await supabase.from('app_settings').upsert({ 
        key: 'bridge_heartbeat', 
        value: new Date().toISOString(),
        updated_at: new Date().toISOString() 
      }, { onConflict: 'key' });
    } catch (e) {
      console.warn('Heartbeat update warning:', e.message);
    }
  }, 30000);
}

// 2. Broadcast Emergency Push Notifications
async function sendPushNotification (ownerId, houseName, alertType, ppm, mac) {
  try {
    const tokens = new Set();

    // 1. Fetch user-specific tokens if ownerId is known
    if (ownerId) {
      const { data: userTokens } = await supabase
        .from('user_push_tokens')
        .select('token')
        .eq('profile_id', ownerId);

      (userTokens || []).forEach(t => {
        if (t.token) tokens.add(t.token);
      });

      const { data: profile } = await supabase
        .from('profiles')
        .select('push_token')
        .eq('id', ownerId)
        .single();

      if (profile?.push_token) tokens.add(profile.push_token);
    }

    // 2. Also notify Admins/Guards
    const { data: adminProfiles } = await supabase
      .from('profiles')
      .select('push_token')
      .or('role.eq.admin,role.eq.hoa,role.eq.guard,is_admin.eq.true');

    (adminProfiles || []).forEach(p => {
      if (p.push_token) tokens.add(p.push_token);
    });

    if (tokens.size === 0) {
      console.log('ℹ️ No active push tokens found for alert broadcast.');
      return;
    }

    const messages = Array.from(tokens).map(token => ({
      to: token,
      sound: 'default',
      title: `🚨 EMERGENCY: ${alertType} DETECTED`,
      body: `${houseName}: Critical hazard detected (${ppm} PPM)! Check your H-Fire app immediately.`,
      data: { houseName, alertType, ppm, mac, type: 'emergency' },
      priority: 'high',
      channelId: 'emergency-alerts',
    }));

    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });

    console.log(`📡 Broadcasted emergency push notification to ${messages.length} device(s).`);
  } catch (err) {
    console.error('Push Notification Error:', err.message);
  }
}

// 3. Process individual telemetry reading
async function processTelemetryItem(data, topic, timestamp) {
  if (!data || typeof data !== 'object') return;

  // Resolve MAC Address
  let mac = data.mac || 
            data.device_mac || 
            data.core_mac || 
            data.coreMac || 
            data.core || 
            data.node_mac || 
            data.nodeMac || 
            data.deviceId || 
            data.sensorId || 
            data.sender || 
            data.addr || 
            data.id;

  if (!mac && topic) {
    const topicMacMatch = topic.match(/([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/);
    if (topicMacMatch) {
      mac = topicMacMatch[0];
    }
  }

  if (!mac) {
    mac = '20:50:0D:33:68:0C';
  }

  mac = mac.toUpperCase().replace(/-/g, ':');
  const ppm = Number(data.ppm ?? data.ppm_level ?? data.gas ?? data.smoke ?? data.reading ?? 0);
  const flame = data.flame === true || data.flame === 1 || data.flameDetected === true || data.fire === true || data.fire === 1;

  // Retrieve device record
  const { data: dev } = await supabase
    .from('devices')
    .select('profile_id, house_name, label, block_lot')
    .eq('mac', mac)
    .maybeSingle();

  let profileId = dev?.profile_id || null;
  let houseName = dev?.house_name || data.house_name || `H-Fire Node (${mac.slice(-5)})`;

  // Update devices table last_seen (DO NOT auto-link unregistered devices to arbitrary resident profiles)
  await supabase.from('devices').upsert({
    mac,
    last_seen: timestamp,
    label: dev?.label || data.label || `Device ${mac.slice(-4)}`,
    house_name: houseName,
    profile_id: profileId,
  }, { onConflict: 'mac' });

  // Evaluate Status
  let status = 'Normal';
  let alertType = 'NONE';
  if (ppm > 1500 || flame) {
    status = 'Danger';
    alertType = flame ? 'FIRE' : 'FIRE / DENSE SMOKE';
  } else if (ppm > 450) {
    status = 'Warning';
    alertType = 'GAS / SMOKE LEAK';
  }

  // 1. Insert into gas_logs ONLY IF Warning or Danger (Never spam normal ambient logs)
  if (status === 'Warning' || status === 'Danger') {
    await supabase.from('gas_logs').insert([{
      device_mac: mac,
      ppm_level: ppm,
      status,
      profile_id: profileId,
      created_at: timestamp,
    }]);
  }

  // Upsert live telemetry state to app_settings (for 0ms live dashboard streaming)
  await supabase.from('app_settings').upsert({
    key: `telemetry_${mac.replace(/:/g, '')}`,
    value: JSON.stringify({ mac, ppm, flame, status, timestamp }),
    updated_at: timestamp,
  }, { onConflict: 'key' });

  // Handle Hazard Incidents (Both Gas Leaks & Fire Alarms with Node Labeling)
  if (status === 'Danger' || status === 'Warning') {
    const nodeName = data.node_name || 'Core Node 1 (Main Sensor Unit)';
    console.log(`🚨 ${status.toUpperCase()} DETECTED on [${nodeName}] for ${mac} (${ppm} PPM, Flame: ${flame}) - Alert: ${alertType}`);

    const { data: existingIncident } = await supabase
      .from('incidents')
      .select('id')
      .eq('device_mac', mac)
      .eq('status', 'Active')
      .maybeSingle();

    if (existingIncident) {
      await supabase.from('incidents').update({
        ppm_at_trigger: ppm,
        alert_type: alertType,
        start_time: timestamp,
        notes: `[${nodeName}] ${alertType} detected at ${ppm} PPM (Flame: ${flame ? 'YES' : 'NO'}).`,
      }).eq('id', existingIncident.id);
    } else {
      await supabase.from('incidents').insert([{
        device_mac: mac,
        status: 'Active',
        ppm_at_trigger: ppm,
        alert_type: alertType,
        profile_id: profileId,
        start_time: timestamp,
        notes: `[${nodeName}] ${alertType} detected at ${ppm} PPM (Flame: ${flame ? 'YES' : 'NO'}).`,
      }]);
    }

    if (status === 'Danger') {
      await sendPushNotification(profileId, `${houseName || 'Resident Home'} (${nodeName})`, alertType, ppm, mac);
      await sendAutomatedEmergencySms(supabase, {
        incidentId: existingIncident ? existingIncident.id : null,
        profileId,
        houseName,
        nodeLabel: nodeName,
        alertType,
        ppm,
        flame,
        mac,
      });
    }
  }
}

// 4. HiveMQ MQTT Connection
if (HIVEMQ_URL) {
  const client = mqtt.connect(HIVEMQ_URL, {
    username: process.env.EXPO_PUBLIC_HIVEMQ_USERNAME,
    password: process.env.EXPO_PUBLIC_HIVEMQ_PASSWORD,
    clientId: `hfire_bridge_res_${Math.random().toString(16).slice(2, 10)}`,
  });

  client.on('connect', () => {
    console.log('✅ Telemetry Bridge connected to HiveMQ Cloud!');
    client.subscribe([TOPIC_WILDCARD, '#'], (err) => {
      if (!err) console.log('📡 Subscribed to MQTT topics:', TOPIC_WILDCARD);
    });
  });

  client.on('message', async (topic, payload) => {
    const rawPayload = payload.toString().trim();
    const timestamp = new Date().toISOString();

    // Plain text event
    if (!rawPayload.startsWith('{') && !rawPayload.startsWith('[')) {
      const csvParts = rawPayload.split(',');
      if (csvParts.length >= 2) {
        await processTelemetryItem({
          mac: csvParts[0].trim(),
          ppm: Number(csvParts[1].trim()),
          flame: csvParts[2] ? (csvParts[2].trim() === '1' || csvParts[2].trim() === 'true') : false
        }, topic, timestamp);
        return;
      }
      return;
    }

    try {
      const data = JSON.parse(rawPayload);

      // Multi-Node Bundle format: {"N1_Gas":571, "N1_Fire":0, "N2_Gas":1800, "N2_Fire":0, "N3_Gas":0, "N3_Fire":0}
      const hasNKeys = Object.keys(data).some(k => /^N\d+_Gas$/i.test(k));
      if (hasNKeys) {
        const coreMac = String(data.mac || data.core_mac || '20:50:0D:33:68:0C').toUpperCase();
        
        // 1. Process Core Node 1
        const n1Ppm = Number(data.N1_Gas ?? data.n1_gas ?? 0);
        const n1Flame = Boolean(Number(data.N1_Fire ?? data.n1_fire ?? 0) === 1 || data.flame === true || data.fire === 1);
        await processTelemetryItem({
          mac: coreMac,
          ppm: n1Ppm,
          flame: n1Flame,
          node_name: 'Core Node 1 (Main Sensor Unit)',
          label: data.label || 'ESP32 Main Gas & Flame Sensor',
          house_name: data.house_name || 'Resident Household',
        }, topic, timestamp);

        // 2. Process Secondary Node 2 (Living Room)
        const n2GasKey = Object.keys(data).find(k => /^N2_Gas$/i.test(k));
        const n2FireKey = Object.keys(data).find(k => /^N2_Fire$/i.test(k));
        if (n2GasKey !== undefined || n2FireKey !== undefined) {
          const n2Ppm = Number(data[n2GasKey || ''] ?? 0);
          const n2Flame = Number(data[n2FireKey || ''] ?? 0) === 1;
          if (n2Ppm > 450 || n2Flame) {
            await processTelemetryItem({
              mac: coreMac,
              ppm: n2Ppm,
              flame: n2Flame,
              node_name: 'Secondary Node 2 (Living Room)',
              label: 'Secondary Node 2 (Living Room)',
              house_name: data.house_name || 'Resident Household',
            }, topic, timestamp);
          }
        }

        // 3. Process Secondary Node 3 (Sector 3 / Ext)
        const n3GasKey = Object.keys(data).find(k => /^N3_Gas$/i.test(k));
        const n3FireKey = Object.keys(data).find(k => /^N3_Fire$/i.test(k));
        if (n3GasKey !== undefined || n3FireKey !== undefined) {
          const n3Ppm = Number(data[n3GasKey || ''] ?? 0);
          const n3Flame = Number(data[n3FireKey || ''] ?? 0) === 1;
          if (n3Ppm > 450 || n3Flame) {
            await processTelemetryItem({
              mac: coreMac,
              ppm: n3Ppm,
              flame: n3Flame,
              node_name: 'Secondary Node 3 (Sector 3 / Ext)',
              label: 'Secondary Node 3 (Sector 3 / Ext)',
              house_name: data.house_name || 'Resident Household',
            }, topic, timestamp);
          }
        }

        return;
      }
      }

      // Array format
      if (Array.isArray(data)) {
        for (const item of data) {
          await processTelemetryItem(item, topic, timestamp);
        }
        return;
      }

      // Envelope format
      const childList = data.nodes || data.devices || data.sensors || data.readings || data.data;
      if (Array.isArray(childList)) {
        for (const item of childList) {
          await processTelemetryItem(item, topic, timestamp);
        }
        return;
      }

      // Single object
      await processTelemetryItem(data, topic, timestamp);
    } catch (e) {
      console.warn('⚠️ Telemetry parse warning:', e.message);
    }
  });

  client.on('error', (err) => {
    console.error('HiveMQ Bridge Error:', err.message);
  });
}

// 5. Healthcheck HTTP Server
const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ 
    status: 'hfire-resident-bridge-active', 
    timestamp: new Date().toISOString(),
    supabaseConnected: Boolean(supabaseUrl),
    mqttConnected: Boolean(HIVEMQ_URL)
  }));
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`ℹ️ Port ${PORT} in use; MQTT telemetry bridge running.`);
  } else {
    console.error('HTTP Server error:', e.message);
  }
});

server.listen(PORT, () => {
  console.log(`🌐 Healthcheck listening on port ${PORT}`);
});
