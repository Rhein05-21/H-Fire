const dotenv = require('dotenv');
dotenv.config();

const API_KEY = process.env.FMCSMS_API_KEY;
const SENDER_ID = process.env.FMCSMS_SENDER_ID || 'HFIRE';
const API_ENDPOINT = process.env.FMCSMS_API_ENDPOINT || 'https://fortmed.org/web/FMCSMS/api/send.php';
const TEST_RECIPIENT = process.env.TEST_SMS_RECIPIENT || '639770163408';

async function testFmcsms() {
  console.log('==================================================');
  console.log('📡 Testing FMCSMS (FortMED / KBRSMS) Gateway API...');
  console.log('==================================================');
  console.log('🔑 API Key:     ', API_KEY ? `${API_KEY.slice(0, 10)}... (configured)` : '⚠️ NOT SET (Pending your approval)');
  console.log('🏷️  Sender ID:   ', SENDER_ID);
  console.log('🌐 API Endpoint:', API_ENDPOINT);
  console.log('📱 Recipient:   ', TEST_RECIPIENT);
  console.log('--------------------------------------------------');

  if (!API_KEY || API_KEY.includes('your_')) {
    console.log(`
ℹ️  FMCSMS STATUS: PENDING API KEY
    Once your API request on https://fortmed.org/web/FMCSMS/ is approved:
    1. Copy your API Key from your FMCSMS dashboard.
    2. Open your .env file and set:
       FMCSMS_API_KEY=<your_actual_key>
       EXPO_PUBLIC_FMCSMS_API_KEY=<your_actual_key>
    3. Re-run: node scripts/test-fmcsms.js
`);
    return;
  }

  try {
    console.log(`\n📤 Dispatching test emergency alert to ${TEST_RECIPIENT}...`);
    const payload = {
      api_key: API_KEY,
      recipient: TEST_RECIPIENT,
      message: '🚨 [H-FIRE TEST]: FMCSMS emergency alert gateway is connected and operational!',
      sender_id: SENDER_ID,
    };

    console.log('Payload sent:', JSON.stringify(payload, null, 2));

    const res = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => null);
    console.log('\nHTTP Response Status:', res.status, res.statusText);
    console.log('Response Body:', data);

    if (res.ok && (data?.status === 'success' || data?.status === 200 || !data?.status)) {
      console.log('\n🎉 SUCCESS! Test SMS dispatched successfully via FMCSMS!');
    } else {
      console.warn('\n⚠️ FMCSMS returned an error response:');
      console.log(data);
    }
  } catch (err) {
    console.error('\n❌ Network or fetch error while calling FMCSMS:', err.message);
  }
}

testFmcsms();
