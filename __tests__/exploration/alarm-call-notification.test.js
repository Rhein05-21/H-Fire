/**
 * Bug Condition Exploration Tests — alarm-call-notification
 *
 * These are STATIC CODE ANALYSIS tests that read source files and assert
 * the presence/absence of specific patterns to confirm bugs exist on UNFIXED code.
 *
 * EXPECTED OUTCOME: All 4 tests FAIL — failure confirms the bugs exist.
 * When the bugs are fixed, these tests will PASS.
 *
 * Run with: node __tests__/exploration/alarm-call-notification.test.js
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Helpers ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const counterexamples = [];

function assert(description, condition, counterexample) {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${description}`);
    console.log(`         Counterexample: ${counterexample}`);
    failed++;
    counterexamples.push({ description, counterexample });
  }
}

function readSource(relPath) {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf8');
}

// ─── Test 1 — CALL Button Absent (Bug 1) ────────────────────────────────────
//
// Confirms Bug 1: EmergencyModal shows "Acknowledge Incident" text link
// instead of a direct-dial CALL button that fetches from family_members.
//
// On UNFIXED code this test FAILS because:
//   - "Acknowledge Incident" IS present (bug confirmed)
//   - No family_members fetch exists (bug confirmed)
//
// After fix: "Acknowledge Incident" link is gone, CALL button + family_members
// fetch are present → test PASSES.

console.log('\n─── Test 1: CALL Button Absent (Bug 1) ───────────────────────────────────');

const emergencyModalSrc = readSource('components/EmergencyModal.tsx');

// 1a. Confirm the "Acknowledge Incident" link IS present (documents the bug)
assert(
  'EmergencyModal contains "Acknowledge Incident" text (bug: passive link shown instead of CALL button)',
  !emergencyModalSrc.includes('Acknowledge Incident'),
  '"Acknowledge Incident" text found in EmergencyModal.tsx — the passive text link is present instead of a CALL button'
);

// 1b. Confirm there is NO family_members fetch in the component (documents the bug)
assert(
  'EmergencyModal fetches from family_members table (fix: should query Supabase for real contacts)',
  emergencyModalSrc.includes('family_members'),
  'No "family_members" reference found in EmergencyModal.tsx — component never fetches real household contacts'
);

// ─── Test 2 — Hardcoded Number (Bug 1) ──────────────────────────────────────
//
// Confirms Bug 1: The hardcoded ADMIN_CONTACT = '09123456789' is defined and
// used for the "Household Member / Owner" contact row.
//
// On UNFIXED code this test FAILS because:
//   - ADMIN_CONTACT IS defined with the hardcoded number (bug confirmed)
//   - handleCall(ADMIN_CONTACT) IS used for the household contact row (bug confirmed)
//
// After fix: ADMIN_CONTACT is removed from the household row, real family
// member phones are used → test PASSES.

console.log('\n─── Test 2: Hardcoded Number (Bug 1) ─────────────────────────────────────');

// 2a. Confirm ADMIN_CONTACT is defined with the hardcoded number
assert(
  'ADMIN_CONTACT hardcoded to "09123456789" is NOT defined (fix: should use dynamic family member data)',
  !emergencyModalSrc.includes("ADMIN_CONTACT = '09123456789'"),
  'Found: ADMIN_CONTACT = \'09123456789\' in EmergencyModal.tsx — hardcoded phone number is present'
);

// 2b. Confirm the "Household Member / Owner" row calls handleCall(ADMIN_CONTACT)
assert(
  '"Household Member / Owner" contact does NOT use handleCall(ADMIN_CONTACT) (fix: should dial real family member phone)',
  !emergencyModalSrc.includes('handleCall(ADMIN_CONTACT)'),
  'Found: handleCall(ADMIN_CONTACT) used for "Household Member / Owner" row — hardcoded number is dialed regardless of family_members data'
);

// ─── Test 3 — Notification Tap No-Op (Bug 2) ────────────────────────────────
//
// Confirms Bug 2: _layout.tsx has no addNotificationResponseReceivedListener
// that invokes triggerEmergency, so tapping a notification from a killed/
// background state does nothing.
//
// On UNFIXED code this test FAILS because:
//   - addNotificationResponseReceivedListener is NOT present (bug confirmed)
//
// After fix: listener is added and calls triggerEmergency → test PASSES.

console.log('\n─── Test 3: Notification Tap No-Op (Bug 2) ───────────────────────────────');

const layoutSrc = readSource('app/_layout.tsx');

// 3a. Confirm addNotificationResponseReceivedListener is absent
assert(
  '_layout.tsx contains addNotificationResponseReceivedListener (fix: should handle notification taps)',
  layoutSrc.includes('addNotificationResponseReceivedListener'),
  'No "addNotificationResponseReceivedListener" found in app/_layout.tsx — tapping a push notification from a killed/background state will NOT open the EmergencyModal'
);

// 3b. Confirm triggerEmergency is not called from a notification response handler
//     (it IS called from postgres_changes, but NOT from a notification listener)
const notificationListenerBlock = layoutSrc.includes('addNotificationResponseReceivedListener');
assert(
  'triggerEmergency is called inside a notification response listener (fix: should reconstruct incident from notification data)',
  notificationListenerBlock && layoutSrc.includes('addNotificationResponseReceivedListener') &&
    // Check that triggerEmergency appears after the listener registration in the same block
    (() => {
      const listenerIdx = layoutSrc.indexOf('addNotificationResponseReceivedListener');
      const triggerIdx = layoutSrc.indexOf('triggerEmergency', listenerIdx);
      return listenerIdx !== -1 && triggerIdx !== -1 && triggerIdx - listenerIdx < 500;
    })(),
  'triggerEmergency is never called from a notification response listener in app/_layout.tsx — notification tap is a no-op'
);

// ─── Test 4 — Bridge Payload Missing Fields (Bug 2) ─────────────────────────
//
// Confirms Bug 2: sendPushNotification() in the bridge sends a notification
// data payload that lacks incidentId and device_mac, making it impossible
// for the app to reconstruct the incident when the notification is tapped.
//
// On UNFIXED code this test FAILS because:
//   - message.data does NOT contain incidentId (bug confirmed)
//   - message.data does NOT contain device_mac (bug confirmed)
//
// After fix: data payload includes both fields → test PASSES.

console.log('\n─── Test 4: Bridge Payload Missing Fields (Bug 2) ────────────────────────');

const bridgeSrc = readSource('utils/hivemq-to-supabase-bridge.js');

// Extract the sendPushNotification function body to scope the data: {} check
const sendPushFnMatch = bridgeSrc.match(/async function sendPushNotification[\s\S]*?^}/m);
const sendPushFnBody = sendPushFnMatch ? sendPushFnMatch[0] : '';
// Extract the data: { ... } block inside the message object
const messageDataMatch = sendPushFnBody.match(/data:\s*\{([^}]*)\}/);
const messageDataContent = messageDataMatch ? messageDataMatch[1] : '';

// 4a. Confirm incidentId is absent from message.data
assert(
  'sendPushNotification() message.data contains "incidentId" (fix: required to reconstruct incident on notification tap)',
  messageDataContent.includes('incidentId'),
  `message.data in sendPushNotification() is: { ${messageDataContent.trim()} } — "incidentId" is absent from the notification payload, so the app cannot identify the incident when the notification is tapped`
);

// 4b. Confirm device_mac is absent from message.data specifically.
// Note: device_mac appears elsewhere in the bridge (gas_logs insert, incidents insert)
// but must NOT appear inside the message.data object sent to the Expo Push API.
assert(
  'sendPushNotification() message.data contains "device_mac" (fix: required to reconstruct incident on notification tap)',
  messageDataContent.includes('device_mac'),
  `message.data in sendPushNotification() is: { ${messageDataContent.trim()} } — "device_mac" is absent from the notification payload, so the app cannot identify the device when the notification is tapped`
);

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════════════════════════');

if (failed > 0) {
  console.log('\n📋 Counterexamples (confirm bugs exist on unfixed code):');
  counterexamples.forEach((ce, i) => {
    console.log(`  ${i + 1}. [${ce.description}]`);
    console.log(`     → ${ce.counterexample}`);
  });
  console.log('\n⚠️  EXPECTED: All tests fail on unfixed code — this confirms the bugs exist.');
  console.log('   Re-run after applying the fix — all tests should then PASS.');
  // Exit with non-zero to signal failures (useful for CI)
  process.exit(1);
} else {
  console.log('\n✅ All tests pass — bugs have been fixed!');
  process.exit(0);
}
