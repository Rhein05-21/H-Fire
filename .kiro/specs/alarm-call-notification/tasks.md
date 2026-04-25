# Implementation Plan

- [x] 1. Write bug condition exploration tests
  - **Property 1: Bug Condition** - Hardcoded Contact & Missing CALL Button
  - **CRITICAL**: These tests MUST FAIL on unfixed code — failure confirms the bugs exist
  - **DO NOT attempt to fix the tests or the code when they fail**
  - **NOTE**: These tests encode the expected behavior — they will validate the fix when they pass after implementation
  - **GOAL**: Surface counterexamples that demonstrate both bugs exist
  - **Scoped PBT Approach**: Scope to concrete failing cases for reproducibility
  - Test 1 — CALL Button Absent: Render `EmergencyModal` with `visible=true` and a mock `familyMembers` array; assert "Acknowledge Incident" text is present and no direct-dial CALL button exists (confirms Bug 1 on unfixed code)
  - Test 2 — Hardcoded Number: Simulate tapping "CALL FOR HELP" then "Household Member / Owner"; assert `Linking.openURL` is called with `tel:09123456789` regardless of `familyMembers` data (confirms hardcoded contact bug)
  - Test 3 — Notification Tap No-Op: Simulate `addNotificationResponseReceivedListener` callback with a mock payload `{ incidentId, device_mac, alert_type, house_name, label, ppm }`; assert `triggerEmergency` is NOT called (confirms missing listener in `_layout.tsx`)
  - Test 4 — Bridge Payload Missing Fields: Inspect the `message.data` object produced by the current `sendPushNotification()`; assert `incidentId` and `device_mac` are absent (confirms incomplete payload)
  - Run all tests on UNFIXED code
  - **EXPECTED OUTCOME**: All tests FAIL (this is correct — it proves the bugs exist)
  - Document counterexamples found (e.g., "CALL button absent", "`Linking.openURL` receives `tel:09123456789`", "`triggerEmergency` never called")
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [-] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Unchanged Alarm Behaviors
  - **IMPORTANT**: Follow observation-first methodology — run UNFIXED code with non-buggy inputs and record actual outputs
  - Observe: `EmergencyModal` with `visible=true` still calls `playSiren()` (alarm sound plays)
  - Observe: Haptic feedback interval fires every second while modal is visible
  - Observe: Pulse animation (`pulseAnim`) runs while modal is visible
  - Observe: Call options screen always contains BFP Hotline (911) row
  - Observe: Call options screen always contains System Administrator row
  - Observe: Tapping dismiss/acknowledge calls `onClose()` and stops the siren
  - Observe: `postgres_changes` listener in `_layout.tsx` calls `triggerEmergency()` when an `Active` incident is inserted while app is open
  - Observe: Bridge does NOT call `sendPushNotification()` when PPM is below warning threshold (≤ 450 and no flame)
  - Write property-based tests: for any `EmergencyModal` render where `isBugCondition_CallButton` is false, all above behaviors are unchanged
  - Write property-based tests: for any bridge `processMessage()` call where `isBugCondition_PushNotification` is false (foreground app or below threshold), output is identical to unfixed code
  - Verify all preservation tests PASS on UNFIXED code
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [~] 3. Fix Bug 1 — EmergencyModal hardcoded contact and missing CALL button

  - [ ] 3.1 Add Supabase import, FamilyMember interface, and contact state to EmergencyModal
    - Add `import { supabase } from '@/utils/supabase'` to `components/EmergencyModal.tsx`
    - Define `interface FamilyMember { id: string; profile_id: string; full_name: string; age?: number; relationship?: string; phone: string; email?: string; is_primary: boolean; }`
    - Add state: `const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([])`
    - Add state: `const [loadingContacts, setLoadingContacts] = useState(false)`
    - Extract `profileId` from `useUser()` (already available in context)
    - _Bug_Condition: isBugCondition_CallButton(X) where X.modalVisible = true_
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ] 3.2 Fetch family members from Supabase when modal becomes visible
    - In the existing `useEffect` that watches `visible`, when `visible = true`, run: `supabase.from('family_members').select('*').eq('profile_id', profileId).then(({ data }) => setFamilyMembers(data ?? []))`
    - Set `loadingContacts` to true before the query and false after
    - Reset `familyMembers` to `[]` when `visible` becomes false
    - _Bug_Condition: isBugCondition_CallButton(X) — modal visible but no real contacts fetched_
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ] 3.3 Replace "Acknowledge Incident" text link with a prominent CALL button
    - Remove the `<TouchableOpacity style={styles.ackLink}>` / `ackLinkText` block
    - Add a new `<TouchableOpacity>` styled similarly to `callMainBtn` (white background, red text, phone icon)
    - On press logic: if `familyMembers.length > 0`, find member where `is_primary === true` (fall back to index 0) and call `handleCall(member.phone)`; if `familyMembers.length === 0`, call `setShowCallOptions(true)`
    - _Bug_Condition: isBugCondition_CallButton — "Acknowledge Incident" link shown instead of CALL button_
    - _Expected_Behavior: CALL button dials primary family member's phone via `Linking.openURL('tel:...')`_
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 3.4 Update call options screen to show dynamic family member list
    - In the `showCallOptions` view, replace the hardcoded "Household Member / Owner" `TouchableOpacity` with a dynamic render of `familyMembers`
    - If `familyMembers.length > 0`: render each member as a `contactItem` row showing `full_name`, `relationship`, and dialing `phone` on press
    - If `familyMembers.length === 0`: render a disabled/greyed `contactItem` row with text "No household contact registered" and no phone action
    - Keep BFP Hotline (911) and System Administrator rows unchanged below the dynamic section
    - Remove the hardcoded `ADMIN_CONTACT` reference from the household contact row
    - _Bug_Condition: isBugCondition_CallButton — call options screen dials hardcoded '09123456789'_
    - _Expected_Behavior: expectedBehavior — real family member names/phones shown; no hardcoded number_
    - _Preservation: BFP Hotline and System Administrator rows remain unchanged_
    - _Requirements: 2.4, 3.1_

  - [ ] 3.5 Verify bug condition exploration test (Property 1) now passes for Bug 1
    - **Property 1: Expected Behavior** - CALL Button Dials Real Primary Family Member
    - **IMPORTANT**: Re-run the SAME tests from task 1 (Tests 1 and 2) — do NOT write new tests
    - Test 1 should now PASS: CALL button is present, "Acknowledge Incident" link is gone
    - Test 2 should now PASS: `Linking.openURL` receives the primary family member's phone, not `tel:09123456789`
    - **EXPECTED OUTCOME**: Tests PASS (confirms Bug 1 is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ] 3.6 Verify preservation tests still pass after Bug 1 fix
    - **Property 2: Preservation** - Unchanged Alarm Behaviors
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Confirm alarm sound, haptics, pulse animation, BFP Hotline row, System Administrator row, and dismiss behavior are all unchanged
    - **EXPECTED OUTCOME**: All preservation tests PASS (confirms no regressions from Bug 1 fix)

- [~] 4. Fix Bug 2 — Push notification payload and notification tap handler

  - [ ] 4.1 Enrich sendPushNotification() with incidentId, deviceMac, and label
    - In `utils/hivemq-to-supabase-bridge.js`, update `sendPushNotification()` signature to: `async function sendPushNotification(ownerId, houseName, alertType, ppm, incidentId, deviceMac, label)`
    - Update `message.title` to: `alertType === 'FIRE' ? '🔥 FIRE ALERT' : '⚠️ GAS/SMOKE ALERT'`
    - Update `message.body` to: `` `${houseName} · ${label} · ${ppm} PPM` ``
    - Update `message.data` to: `{ incidentId, device_mac: deviceMac, alert_type: alertType, house_name: houseName, label, ppm }`
    - _Bug_Condition: isBugCondition_PushNotification — data payload lacks incidentId/device_mac_
    - _Expected_Behavior: notification data contains all fields needed to reconstruct the incident_
    - _Requirements: 2.5_

  - [ ] 4.2 Pass incidentId, mac, and label at the sendPushNotification call site in processMessage()
    - In `processMessage()`, update the `supabase.from('devices').select(...)` query to also select `label`: `.select('house_name, label')`
    - Capture the inserted incident's `id` from the insert result: `const { data: insertedIncident } = await supabase.from('incidents').insert([...]).select('id').single()`
    - Update the `sendPushNotification()` call to pass: `sendPushNotification(ownerId, device?.house_name || 'Home', alertType, ppm, insertedIncident?.id, mac, device?.label || 'Unknown Room')`
    - _Bug_Condition: isBugCondition_PushNotification — incidentId and device_mac not passed to notification_
    - _Requirements: 2.5_

  - [ ] 4.3 Add Notifications import and notification response listener in _layout.tsx
    - Add `import * as Notifications from 'expo-notifications'` to `app/_layout.tsx`
    - Inside `RootLayoutContent`, after `usePushNotifications(profileId)`, add a `useEffect` with dependency `[triggerEmergency]`
    - Inside the effect, call `Notifications.addNotificationResponseReceivedListener(response => { ... })`
    - In the callback: extract `const data = response.notification.request.content.data`
    - Call `triggerEmergency({ id: data.incidentId, house_name: data.house_name, label: data.label, ppm: data.ppm, alert_type: data.alert_type, device_mac: data.device_mac })`
    - Return `subscription.remove()` as the cleanup function
    - _Bug_Condition: isBugCondition_PushNotification — no response listener; triggerEmergency never called on tap_
    - _Expected_Behavior: tapping notification from killed/background state opens EmergencyModal with correct incident_
    - _Preservation: existing postgres_changes listener in _layout.tsx remains unchanged_
    - _Requirements: 2.6, 3.4_

  - [ ] 4.4 Verify notification channel config in use-push-notifications.ts (no change needed)
    - Confirm `sound: 'default'` is set on the `emergency-alerts` channel (already present)
    - Confirm `importance: Notifications.AndroidImportance.MAX` is set (already present)
    - Confirm existing `responseListener` in the hook remains as a debug log (no change needed — actual trigger is now in `_layout.tsx`)
    - No code changes required; mark complete after verification
    - _Requirements: 2.5_

  - [ ] 4.5 Verify bug condition exploration test (Property 1) now passes for Bug 2
    - **Property 1: Expected Behavior** - Push Notification Delivered and Handled on Tap
    - **IMPORTANT**: Re-run the SAME tests from task 1 (Tests 3 and 4) — do NOT write new tests
    - Test 3 should now PASS: `triggerEmergency` IS called when notification response listener fires with a valid payload
    - Test 4 should now PASS: `sendPushNotification()` data object contains `incidentId` and `device_mac`
    - **EXPECTED OUTCOME**: Tests PASS (confirms Bug 2 is fixed)
    - _Requirements: 2.5, 2.6_

  - [ ] 4.6 Verify preservation tests still pass after Bug 2 fix
    - **Property 2: Preservation** - Unchanged Alarm Behaviors
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Confirm `postgres_changes` listener still triggers `EmergencyModal` when app is open (foreground path unchanged)
    - Confirm bridge still skips push notification for PPM readings below warning threshold
    - **EXPECTED OUTCOME**: All preservation tests PASS (confirms no regressions from Bug 2 fix)

- [~] 5. Checkpoint — Ensure all tests pass
  - Re-run the full test suite (exploration tests from task 1 + preservation tests from task 2)
  - All Property 1 (Bug Condition) tests must PASS — confirms both bugs are fixed
  - All Property 2 (Preservation) tests must PASS — confirms no regressions
  - Manually verify end-to-end: MQTT message → bridge inserts incident → push notification sent with enriched payload → app killed → user taps notification → `EmergencyModal` opens with correct incident data
  - Manually verify: `EmergencyModal` opens → CALL button visible → tap dials primary family member's phone
  - Manually verify: `EmergencyModal` opens → "CALL FOR HELP" → call options screen shows real family member names + BFP Hotline + System Administrator
  - Ensure all tests pass; ask the user if questions arise.
