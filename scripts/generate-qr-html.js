const fs = require('fs');
const QRCode = require('qrcode');

const url = 'exp://192.168.100.66:8081';

QRCode.toDataURL(url, { width: 400, margin: 2 }, (err, dataUrl) => {
  if (err) {
    console.error('Error generating QR:', err);
    process.exit(1);
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Expo Go QR Code - H-Fire</title>
  <style>
    body {
      background: #0B0F19;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      box-sizing: border-box;
    }
    .card {
      background: #1F2937;
      border: 1px solid #374151;
      border-radius: 20px;
      padding: 30px;
      text-align: center;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      max-width: 440px;
    }
    h1 {
      font-size: 24px;
      margin-top: 0;
      color: #EF4444;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }
    .qr-box {
      background: #ffffff;
      padding: 16px;
      border-radius: 16px;
      display: inline-block;
      margin: 16px 0;
    }
    .qr-box img {
      display: block;
      width: 280px;
      height: 280px;
    }
    .url {
      background: #111827;
      border: 1px solid #374151;
      padding: 12px;
      border-radius: 10px;
      font-family: monospace;
      font-size: 15px;
      color: #60A5FA;
      word-break: break-all;
      margin-top: 10px;
    }
    p {
      color: #9CA3AF;
      font-size: 13px;
      margin-bottom: 6px;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>🔥 H-Fire Mobile App</h1>
    <p>Scan with <b>Expo Go</b> on Android or Camera app on iOS</p>
    <div class="qr-box">
      <img src="${dataUrl}" alt="Expo Go QR Code" />
    </div>
    <p>Direct Connection URL:</p>
    <div class="url">${url}</div>
  </div>
</body>
</html>`;

  fs.writeFileSync('expo_qr.html', html, 'utf8');
  console.log('expo_qr.html generated successfully!');
});
