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
      console.log(`[patch] Patched ${relPath} for Expo Go compatibility.`);
    }
  }
});

// Patch TreeFS for Windows Metro stability
const treeFSPath = path.join(__dirname, '..', 'node_modules/@expo/metro-file-map/build/lib/TreeFS.js');
if (fs.existsSync(treeFSPath)) {
  let treeFS = fs.readFileSync(treeFSPath, 'utf8');
  if (treeFS.includes("throw new Error(`TreeFS: Failed to make parent directory entry for ${mixedPath}`);")) {
    treeFS = treeFS.replace("throw new Error(`TreeFS: Failed to make parent directory entry for ${mixedPath}`);", "return;");
    treeFS = treeFS.replace(/if \(!lookup\.exists\) \{[\s\S]*?throw new Error\(`TreeFS: Unexpected error adding \$\{normalPath\}[\s\S]*?\}/, "if (!lookup.exists) { continue; }");
    fs.writeFileSync(treeFSPath, treeFS, 'utf8');
    console.log('[patch] Patched TreeFS for Windows path stability.');
  }
}
