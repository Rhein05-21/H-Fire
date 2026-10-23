const fs = require('fs');
const path = require('path');

const targetFiles = [
  'node_modules/expo-notifications/build/TopicSubscriptionModule.android.js',
  'node_modules/expo-notifications/build/PushTokenManager.native.js',
  'node_modules/expo-notifications/build/ServerRegistrationModule.native.js'
];

targetFiles.forEach(relPath => {
  const fullPath = path.join(__dirname, '..', relPath);
  if (fs.existsSync(fullPath)) {
    let content = fs.readFileSync(fullPath, 'utf8');
    if (content.includes("requireNativeModule(")) {
      content = content.replace(/requireNativeModule\(/g, "requireOptionalNativeModule(");
      content = content.replace(/import\s*{\s*requireNativeModule\s*}\s*from\s*'expo';/, "import { requireOptionalNativeModule } from 'expo';");
      content = content.replace(/export default requireOptionalNativeModule\(([^)]+)\);/, "export default requireOptionalNativeModule($1) || {};");
      fs.writeFileSync(fullPath, content, 'utf8');
      console.log(`[patch-expo-notifications] Patched ${relPath} for Expo Go compatibility.`);
    }
  }
});
