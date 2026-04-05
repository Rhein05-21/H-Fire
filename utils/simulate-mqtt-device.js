const mqtt = require('mqtt');
const dotenv = require('dotenv');
dotenv.config();

// --- HiveMQ Credentials ---
const HIVEMQ_URL = `wss://${process.env.EXPO_PUBLIC_HIVEMQ_BROKER}:${process.env.EXPO_PUBLIC_HIVEMQ_PORT}/mqtt`;
const TOPIC_DATA = 'hfire/house1/data';

const client = mqtt.connect(HIVEMQ_URL, {
  username: process.env.EXPO_PUBLIC_HIVEMQ_USERNAME,
  password: process.env.EXPO_PUBLIC_HIVEMQ_PASSWORD,
  clientId: `sim_esp32_${Math.random().toString(16).slice(2, 8)}`,
});

client.on('connect', () => {
  console.log('📡 [Simulator] Connected to HiveMQ Cloud');
  
  // Simulation Payload: High Smoke (1800 PPM) + Flame (true)
  const payload = {
    mac: 'VIRTUAL-ESP32-001',
    ppm: 1800,
    flame: true
  };

  console.log(`🔥 Sending Emergency Data to ${TOPIC_DATA}...`);
  console.log('Payload:', JSON.stringify(payload));

  client.publish(TOPIC_DATA, JSON.stringify(payload), { qos: 1 }, (err) => {
    if (err) {
      console.error('❌ Failed to publish:', err.message);
    } else {
      console.log('✅ MESSAGE SENT TO HIVEMQ!');
      console.log('---------------------------');
      console.log('Now, check your Render Logs and your Mobile App.');
    }
    client.end(); // Close connection after sending
  });
});

client.on('error', (err) => {
  console.error('❌ MQTT Error:', err.message);
});
