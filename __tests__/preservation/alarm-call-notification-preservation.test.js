/**
 * Preservation Property Tests — alarm-call-notification
 *
 * These are STATIC CODE ANALYSIS tests that read source files and assert
 * the presence of specific patterns to confirm existing correct behaviors
 * are preserved in the CURRENT UNFIXED code.
 *
 * EXPECTED OUTCOME: All 8 tests PASS on unfixed code.
 * They must CONTINUE TO PASS after the fix is applied (regression prevention).
 *
 * Run with: node __tests__/preservation/alarm-call-notification-preservation.test.js
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Helpers ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(description, condition, detail) {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${description}`);
    console.log(`         Detail: ${detail}`);
    failed++;
    failures.push({ description, detail });
  }
}

function readSource(relPath) {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf8');
}

// ─── Load source files ───────────────────────────────────────────────────────

const emergencyModalSrc = readSource('components/EmergencyModal.tsx');
const layoutSrc = readSource('app/_layout.tsx');
const bridgeSrc = readSource('utils/hivemq-to-supabase-bridge.js');

// ─── Test 1 — playSiren() called when modal opens ───────────────────────────
//
// Preservation: EmergencyModal must call playSiren() inside the useEffect
// that watches `visible`. This ensures the alarm sound plays on every open.
//
// Validates: Requirement 3.2

console.log('\n─── Test 1: playSiren() called inside useEffect([visible]) ───────────────');

// Find the useEffect that depends on [visible]
const useEffectVisibleMatch = emergencyModalSrc.match(
  /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[visible\]\s*\)/
);
const useEffectBlock = useEffectVisibleMatch ? useEffectVisibleMatch[0] : '';

assert(
  'playSiren() is called inside the useEffect that watches [visible]',
  useEffectBlock.includes('playSiren()'),
  useEffectBlock
    ? 'useEffect([visible]) found but does not contain playSiren() call'
    : 'No useEffect with [visible] dependency found in EmergencyModal.tsx'
);

// ─── Test 2 — Haptic feedback interval fires every second ───────────────────
//
// Preservation: A setInterval must exist that calls Haptics.notificationAsync
// to provide haptic feedback every 1000ms while the modal is visible.
//
// Validates: Requirement 3.2

console.log('\n─── Test 2: Haptic feedback setInterval(Haptics.notificationAsync, 1000) ─');

// Check setInterval with Haptics.notificationAsync exists in the component
const hasSetInterval = emergencyModalSrc.includes('setInterval');
const hasHapticsInInterval = (() => {
  // Find the setInterval call and check it contains Haptics.notificationAsync
  const intervalMatch = emergencyModalSrc.match(/setInterval\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?\}\s*,\s*1000\s*\)/);
  if (!intervalMatch) return false;
  return intervalMatch[0].includes('Haptics.notificationAsync');
})();

assert(
  'setInterval with Haptics.notificationAsync fires every 1000ms',
  hasSetInterval && hasHapticsInInterval,
  hasSetInterval
    ? 'setInterval found but does not contain Haptics.notificationAsync with 1000ms interval'
    : 'No setInterval found in EmergencyModal.tsx'
);

// ─── Test 3 — Pulse animation runs (Animated.loop / pulseAnim) ──────────────
//
// Preservation: The pulse animation using Animated.loop and pulseAnim must
// exist to animate the alert circle while the modal is visible.
//
// Validates: Requirement 3.2

console.log('\n─── Test 3: Pulse animation (Animated.loop + pulseAnim) ──────────────────');

const hasAnimatedLoop = emergencyModalSrc.includes('Animated.loop');
const hasPulseAnim = emergencyModalSrc.includes('pulseAnim');

assert(
  'Animated.loop and pulseAnim animation exist in EmergencyModal',
  hasAnimatedLoop && hasPulseAnim,
  !hasAnimatedLoop
    ? 'Animated.loop not found in EmergencyModal.tsx'
    : 'pulseAnim not found in EmergencyModal.tsx'
);

// ─── Test 4 — BFP Hotline (911) row exists in call options screen ────────────
//
// Preservation: The call options screen must always contain a BFP Hotline
// row that dials 911. This is a critical emergency contact that must never
// be removed.
//
// Validates: Requirement 3.1

console.log('\n─── Test 4: BFP Hotline (911) row in call options screen ─────────────────');

// Check that BFP_HOTLINE constant is defined as '911' OR '911' is referenced
// in a contactItem for BFP
const hasBfpHotlineConst = emergencyModalSrc.includes("BFP_HOTLINE = '911'");
const hasBfpHotlineRef = emergencyModalSrc.includes('BFP_HOTLINE') && emergencyModalSrc.includes("'911'");
const has911Direct = emergencyModalSrc.includes("handleCall('911')") || emergencyModalSrc.includes('handleCall(BFP_HOTLINE)');

assert(
  'BFP_HOTLINE (911) is defined and referenced in a contactItem for BFP',
  (hasBfpHotlineConst || hasBfpHotlineRef) && has911Direct,
  !hasBfpHotlineConst && !hasBfpHotlineRef
    ? 'BFP_HOTLINE constant or \'911\' reference not found in EmergencyModal.tsx'
    : 'BFP_HOTLINE is defined but handleCall(BFP_HOTLINE) or handleCall(\'911\') not found in contactItem'
);

// ─── Test 5 — System Administrator row exists in call options screen ─────────
//
// Preservation: The call options screen must always contain a System
// Administrator row as an emergency support contact.
//
// Validates: Requirement 3.1

console.log('\n─── Test 5: System Administrator row in call options screen ──────────────');

assert(
  '"System Administrator" text exists in EmergencyModal call options screen',
  emergencyModalSrc.includes('System Administrator'),
  '"System Administrator" text not found in EmergencyModal.tsx — the row may have been removed'
);

// ─── Test 6 — handleAcknowledge calls stopSiren() and onClose() ─────────────
//
// Preservation: Tapping dismiss/acknowledge must stop the siren AND call
// onClose() to clear the active incident from context.
//
// Validates: Requirement 3.3

console.log('\n─── Test 6: handleAcknowledge calls stopSiren() and onClose() ────────────');

// Extract the handleAcknowledge function body
const handleAckMatch = emergencyModalSrc.match(
  /const handleAcknowledge\s*=\s*async\s*\(\s*\)\s*=>\s*\{[\s\S]*?\};/
);
const handleAckBody = handleAckMatch ? handleAckMatch[0] : '';

const ackCallsStopSiren = handleAckBody.includes('stopSiren()');
const ackCallsOnClose = handleAckBody.includes('onClose()');

assert(
  'handleAcknowledge calls both stopSiren() and onClose()',
  ackCallsStopSiren && ackCallsOnClose,
  handleAckBody
    ? `handleAcknowledge found but missing: ${!ackCallsStopSiren ? 'stopSiren()' : ''} ${!ackCallsOnClose ? 'onClose()' : ''}`.trim()
    : 'handleAcknowledge function not found in EmergencyModal.tsx'
);

// ─── Test 7 — postgres_changes listener calls triggerEmergency() ─────────────
//
// Preservation: The _layout.tsx must have a postgres_changes listener on the
// incidents table that calls triggerEmergency() when an Active incident is
// inserted. This is the foreground incident trigger path.
//
// Validates: Requirement 3.4

console.log('\n─── Test 7: postgres_changes listener calls triggerEmergency() ───────────');

const hasPostgresChanges = layoutSrc.includes('postgres_changes');
const hasTriggerEmergency = layoutSrc.includes('triggerEmergency');

// Verify triggerEmergency is called within the postgres_changes listener block
const postgresChangesIdx = layoutSrc.indexOf('postgres_changes');
const triggerEmergencyIdx = layoutSrc.indexOf('triggerEmergency', postgresChangesIdx);
const triggerIsNearListener = postgresChangesIdx !== -1 && triggerEmergencyIdx !== -1 &&
  (triggerEmergencyIdx - postgresChangesIdx) < 800;

assert(
  'postgres_changes listener exists in _layout.tsx and calls triggerEmergency()',
  hasPostgresChanges && hasTriggerEmergency && triggerIsNearListener,
  !hasPostgresChanges
    ? 'postgres_changes not found in app/_layout.tsx'
    : !hasTriggerEmergency
      ? 'triggerEmergency not found in app/_layout.tsx'
      : 'triggerEmergency is not called within the postgres_changes listener block'
);

// ─── Test 8 — Bridge skips push notification below warning threshold ──────────
//
// Preservation: The bridge must NOT call sendPushNotification() for PPM
// readings that are below the warning threshold (≤ 450 with no flame, or
// ≤ 1500 without flame). Only Danger/Warning status readings trigger a push.
//
// Validates: Requirement 3.6

console.log('\n─── Test 8: Bridge skips push notification below warning threshold ────────');

// Verify a threshold check exists before sendPushNotification is called.
// The bridge uses: ppm > 1500 || (flame === true && ppm > 450) → Danger
//                  ppm > 450 → Warning
// sendPushNotification is only called inside the if (status === 'Danger' || status === 'Warning') block.
const hasThresholdCheck = bridgeSrc.includes('> 1500') || bridgeSrc.includes('> 450');

// Verify sendPushNotification is guarded by a status/threshold condition
const sendPushIdx = bridgeSrc.indexOf('sendPushNotification(');
const dangerWarningCheckIdx = bridgeSrc.lastIndexOf("status === 'Danger'", sendPushIdx);
const warningCheckIdx = bridgeSrc.lastIndexOf("status === 'Warning'", sendPushIdx);
const guardIdx = Math.max(dangerWarningCheckIdx, warningCheckIdx);

// The guard must appear before sendPushNotification and within a reasonable range
const sendPushIsGuarded = sendPushIdx !== -1 && guardIdx !== -1 &&
  guardIdx < sendPushIdx && (sendPushIdx - guardIdx) < 600;

assert(
  'Bridge has threshold check (> 450 or > 1500) and sendPushNotification is guarded by Danger/Warning status',
  hasThresholdCheck && sendPushIsGuarded,
  !hasThresholdCheck
    ? 'No threshold check (> 450 or > 1500) found in hivemq-to-supabase-bridge.js'
    : 'sendPushNotification() is not guarded by a Danger/Warning status check — it may be called for all readings'
);

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════════════════════════');

if (failed > 0) {
  console.log('\n❌ PRESERVATION FAILURE — some existing correct behaviors are NOT present:');
  failures.forEach((f, i) => {
    console.log(`  ${i + 1}. [${f.description}]`);
    console.log(`     → ${f.detail}`);
  });
  console.log('\n⚠️  These tests MUST pass on both unfixed and fixed code.');
  console.log('   A failure here means a regression was introduced or the test is wrong.');
  process.exit(1);
} else {
  console.log('\n✅ All preservation tests pass — existing correct behaviors are intact.');
  console.log('   Re-run after applying the fix to confirm no regressions were introduced.');
  process.exit(0);
}
