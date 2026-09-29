const dotenv = require('dotenv');
dotenv.config();

const API_KEY = process.env.HTTPSMS_API_KEY;
const FROM_NUMBER = process.env.HTTPSMS_FROM_NUMBER;

async function testSms() {
  console.log('📡 Testing httpSMS Connection...');
  console.log('🔑 API Key:', API_KEY ? `${API_KEY.slice(0, 10)}...` : 'MISSING');
  console.log('📱 Sender Phone:', FROM_NUMBER);

  if (!API_KEY || !FROM_NUMBER) {
    console.error('❌ Missing HTTPSMS_API_KEY or HTTPSMS_FROM_NUMBER in .env');
    return;
  }

  try {
    const res = await fetch('https://api.httpsms.com/v1/messages/send', {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: '🚨 [H-FIRE TEST]: Your automated emergency SMS gateway is connected and active!',
        from: FROM_NUMBER,
        to: FROM_NUMBER,
      }),
    });

    const data = await res.json().catch(() => ({}));
    console.log('HTTP Status:', res.status);

    if (res.ok) {
      console.log('🎉 SUCCESS! Test SMS dispatched successfully to your phone!');
      console.log('Response:', data);
    } else {
      console.warn('⚠️ httpSMS returned an error:');
      console.log(JSON.stringify(data, null, 2));
      if (data?.data?.from?.[0]?.includes('no phone found')) {
        console.log('\n👉 ACTION NEEDED: Open the httpSMS app on your phone (09770163408) and make sure it is linked and shows "Connected" or "Online".');
      }
    }
  } catch (err) {
    console.error('❌ Network error while calling httpSMS:', err.message);
  }
}

testSms();
