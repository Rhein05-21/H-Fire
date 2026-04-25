# Alarm Call Notification Bugfix Design

## Overview

Two bugs affect the H-Fire emergency alarm flow:

**Bug 1** — `EmergencyModal` shows a passive "Acknowledge Incident" text link as the secondary action and uses a hardcoded phone number (`09123456789`) for the "Household Member / Owner" contact. The fix replaces the text link with a prominent CALL button that fetches real family members from the `family_members` Supabase table and dials the primary contact directly. The call options screen is also updated to show real family member names and numbers.

**Bug 2** — Push notifications are not reliably delivered when the app is closed/killed, and tapping a notification from a killed state does not open the `EmergencyModal`. The fix updates the bridge to include richer notification data (incidentId, device_mac, etc.) and adds a `Notifications.addNotificationResponseReceivedListener` in `_layout.tsx` that calls `triggerEmergency()` with the incident data from the notification payload.

---

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — either the modal shows the wrong UI/hardcoded contact, or a push notification is not delivered/handled when the app is killed.
- **Property (P)**: The desired correct behavior — CALL button dials the real primary family member; push notification is delivered and opens the EmergencyModal on tap.
- **Preservation**: Existing behaviors that must remain unchanged — alarm sound, haptics, pulse animation, BFP Hotline option, Supabase incident listener, family-members CRUD.
- **`EmergencyModal`**: The full-screen overlay in `components/EmergencyModal.tsx` that displays when an active incident is detected.
- **`family_members` table**: Supabase table with columns `{ id, profile_id, full_name, age, relationship, phone, email, is_primary }` — stores household contacts per user.
- **`profiles` table**: Supabase table with columns `{ id, push_token, name, block_lot, ... }` — stores the Expo push token per user.
- **`incidents` table**: Supabase table with columns `{ id, device_mac, alert_type, ppm_at_trigger, status, profile_id }` — records active emergencies.
- **`hivemq-to-supabase-bridge.js`**: Node.js backend that listens to MQTT messages and sends Expo push notifications when an incident is triggered.
- **`use-push-notifications.ts`**: React Native hook that registers the device for push notifications and creates the Android notification channel.
- **`profileId`**: The authenticated user's Supabase profile ID, available via `useUser()` context.
- **`triggerEmergency(incident)`**: Context function in `UserContext` that sets `activeIncident`, causing `EmergencyModal` to render.

---

## Bug Details

### Bug 1 — Hardcoded Contact / Missing CALL Button

The bug manifests when the `EmergencyModal` is visible. The secondary action is a text link ("Acknowledge Incident") instead of a direct CALL button, and the call options screen dials a hardcoded number regardless of what is stored in `family_members`.

**Formal Specification:**
```
FUNCTION isBugCondition_CallButton(X)
  INPUT: X = { modalVisible: boolean, familyMembers: FamilyMember[] }
  OUTPUT: boolean

  RETURN X.modalVisible = true
    AND (UI shows "Acknowledge Incident" text link as secondary action
         OR "Household Member / Owner" dials hardcoded '09123456789')
END FUNCTION
```

**Examples:**
- User has `is_primary = true` member with phone `09171234567` → modal still shows "Acknowledge Incident" link; tapping "CALL FOR HELP" → "Household Member / Owner" dials `09123456789` (wrong).
- User has no family members registered → modal shows "Acknowledge Incident" link; call options screen shows "Household Member / Owner" with hardcoded number (misleading).
- User has 3 family members, none marked primary → first member's phone should be dialed; currently hardcoded number is dialed instead.

### Bug 2 — Push Notification Not Delivered / Not Handled When App is Killed

The bug manifests when an incident is inserted while the app is in a killed or background state. The bridge sends a notification but the `data` payload lacks `incidentId` and `device_mac`, so even if the notification arrives, tapping it cannot reconstruct the incident for `triggerEmergency()`. Additionally, `_layout.tsx` has no `addNotificationResponseReceivedListener` to handle the tap.

**Formal Specification:**
```
FUNCTION isBugCondition_PushNotification(X)
  INPUT: X = { appState: 'killed' | 'background' | 'foreground', incidentInserted: boolean }
  OUTPUT: boolean

  RETURN X.incidentInserted = true
    AND (X.appState = 'killed' OR X.appState = 'background')
    AND (push notification data lacks incidentId/device_mac
         OR app does not call triggerEmergency() on notification tap)
END FUNCTION
```

**Examples:**
- App is killed, fire incident inserted → notification arrives but tapping it opens the app to the home screen without showing `EmergencyModal`.
- App is in background, gas alert inserted → notification arrives; tapping it does nothing because no response listener is registered.
- App is open (foreground) → existing `postgres_changes` listener handles it correctly (not a bug condition).

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Alarm sound (Fire Alarm.mp3 / Smoke Alarm Sound.mp3) must continue to play when the modal opens.
- Haptic feedback loop must continue to fire every second while the modal is visible.
- Pulse animation on the alert circle must continue to run.
- BFP Hotline (911) and System Administrator options must remain in the call options screen.
- The existing `postgres_changes` listener in `_layout.tsx` must continue to trigger `EmergencyModal` when the app is open.
- Family member CRUD operations in `app/family-members.tsx` must remain unaffected.
- The bridge must continue to skip push notifications for readings below the warning threshold.
- Dismissing the modal must continue to stop the alarm and clear `activeIncident`.

**Scope:**
All inputs that do NOT involve the bug conditions (modal secondary action, hardcoded contact, killed-state notification tap) must be completely unaffected. This includes:
- Mouse/touch interactions with the "CALL FOR HELP" button flow (beyond the specific contact fix).
- All MQTT message processing in the bridge for non-alert readings.
- All other screens and navigation flows.

---

## Hypothesized Root Cause

### Bug 1

1. **Missing Supabase fetch in EmergencyModal**: The component never queries `family_members` — it only uses the hardcoded `ADMIN_CONTACT` constant. No async data-fetching logic exists for contacts.
2. **Wrong secondary action**: The `ackLink` / `ackLinkText` style block renders a text link instead of a styled call button. The intent to have a direct-dial shortcut was never implemented.
3. **Static contact list in call options**: The `showCallOptions` view hardcodes two `TouchableOpacity` items both pointing to `ADMIN_CONTACT`, with no dynamic rendering from a data source.

### Bug 2

1. **Incomplete notification `data` payload in bridge**: `sendPushNotification()` sends `{ houseName, alertType, ppm }` but omits `incidentId` and `device_mac`, which are required to reconstruct the incident object in the app.
2. **No notification response listener in `_layout.tsx`**: `usePushNotifications` registers a `responseListener` that only `console.log`s the tap — it does not call `triggerEmergency()`. The listener in `_layout.tsx` is absent entirely.
3. **`triggerEmergency` not accessible in `use-push-notifications.ts`**: The hook does not receive `triggerEmergency` as a parameter, so even if a response listener existed, it could not open the modal.

---

## Correctness Properties

Property 1: Bug Condition — CALL Button Dials Real Primary Family Member

_For any_ `EmergencyModal` render where `isBugCondition_CallButton` returns true (modal is visible and family members exist), the fixed component SHALL display a prominent CALL button as the secondary action, and tapping it SHALL dial the `phone` of the `family_members` row where `is_primary = true`, or the first row if none is primary, using `Linking.openURL('tel:...')`.

**Validates: Requirements 2.1, 2.2**

Property 2: Bug Condition — No Family Members Falls Back to Call Options Screen

_For any_ `EmergencyModal` render where `isBugCondition_CallButton` returns true and `familyMembers` is empty, the fixed component SHALL fall back to showing the call options screen and SHALL display a "No household contact registered" message instead of a hardcoded number.

**Validates: Requirements 2.3**

Property 3: Bug Condition — Call Options Screen Shows Real Family Members

_For any_ render of the call options screen (`showCallOptions = true`), the fixed component SHALL display the actual family members fetched from Supabase (real names and phone numbers) and SHALL NOT dial the hardcoded `ADMIN_CONTACT` for the household contact row.

**Validates: Requirements 2.4**

Property 4: Bug Condition — Push Notification Delivered and Handled on Tap from Killed State

_For any_ incident insertion where `isBugCondition_PushNotification` returns true (app killed/background), the fixed bridge SHALL send a push notification with `data: { incidentId, device_mac, alert_type, house_name, label, ppm }` and `priority: 'high'`, and the fixed `_layout.tsx` SHALL call `triggerEmergency()` with the reconstructed incident when the user taps the notification.

**Validates: Requirements 2.5, 2.6**

Property 5: Preservation — Unchanged Alarm Behaviors

_For any_ input where the bug conditions do NOT hold (modal interactions unrelated to the CALL button, non-alert MQTT readings, foreground incident triggers), the fixed code SHALL produce exactly the same behavior as the original code, preserving alarm sound, haptics, pulse animation, BFP Hotline option, and the Supabase incident listener.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

---

## Fix Implementation

### Bug 1 — EmergencyModal

**File**: `components/EmergencyModal.tsx`

**Specific Changes:**

1. **Add Supabase import and family member state**: Import `supabase` from `@/utils/supabase`. Add state `familyMembers: FamilyMember[]` and `loadingContacts: boolean`.

2. **Fetch family members when modal opens**: In the `useEffect` that watches `visible`, when `visible = true`, query `supabase.from('family_members').select('*').eq('profile_id', profileId)` and store results in state. Use `profileId` from `useUser()`.

3. **Replace "Acknowledge Incident" link with CALL button**: Remove the `ackLink` / `ackLinkText` styled `TouchableOpacity`. Add a new prominent CALL button styled similarly to `callMainBtn`. On press: if `familyMembers.length > 0`, find the member where `is_primary = true` (or fall back to index 0) and call `handleCall(member.phone)`. If `familyMembers.length === 0`, call `setShowCallOptions(true)`.

4. **Update call options screen — dynamic family member list**: In the `showCallOptions` view, replace the hardcoded "Household Member / Owner" `TouchableOpacity` with a `FlatList` (or `.map()`) over `familyMembers`. Each item shows `full_name`, `relationship`, and dials `phone`. If `familyMembers` is empty, show a "No household contact registered" `Text` element instead.

5. **Keep BFP Hotline and System Administrator rows**: These two static rows remain unchanged in the call options screen below the dynamic family member list.

### Bug 2 — Push Notification Bridge + App Handler

**File**: `utils/hivemq-to-supabase-bridge.js`

**Specific Changes:**

1. **Enrich notification `data` payload**: Update `sendPushNotification()` signature to accept `incidentId`, `deviceMac`, `label`. Update the `message.data` field to `{ incidentId, device_mac: deviceMac, alert_type: alertType, house_name: houseName, label, ppm }`.

2. **Update `title` and `body` format**: Change `title` to `alertType === 'FIRE' ? '🔥 FIRE ALERT' : '⚠️ GAS/SMOKE ALERT'`. Change `body` to `${houseName} · ${label} · ${ppm} PPM`.

3. **Pass new args at call site**: In `processMessage()`, after inserting the incident, pass `incidentId` (from the insert result), `mac` (as `deviceMac`), and `device.label` to `sendPushNotification()`.

**File**: `app/_layout.tsx`

**Specific Changes:**

1. **Add notification response listener**: Inside `RootLayoutContent`, after `usePushNotifications(profileId)`, add a `useEffect` that calls `Notifications.addNotificationResponseReceivedListener`. In the callback, extract `response.notification.request.content.data` and call `triggerEmergency({ id: data.incidentId, house_name: data.house_name, label: data.label, ppm: data.ppm, alert_type: data.alert_type, device_mac: data.device_mac })`. Return the subscription's `.remove()` as cleanup.

2. **Import `Notifications`**: Add `import * as Notifications from 'expo-notifications'` to `_layout.tsx`.

**File**: `hooks/use-push-notifications.ts`

**Specific Changes:**

1. **Verify channel config**: Confirm `sound: 'default'` and `importance: Notifications.AndroidImportance.MAX` are set (already correct — no change needed). The existing `responseListener` in the hook can remain as a debug log; the actual emergency trigger is handled in `_layout.tsx` where `triggerEmergency` is in scope.

---

## Testing Strategy

### Validation Approach

Two-phase approach: first surface counterexamples on unfixed code to confirm root cause, then verify the fix and run preservation checks.

### Exploratory Bug Condition Checking

**Goal**: Demonstrate the bugs on unfixed code to confirm root cause analysis.

**Test Plan**: Render `EmergencyModal` with mock family member data and assert the UI. Simulate notification taps and assert `triggerEmergency` is called.

**Test Cases:**
1. **CALL Button Absent Test**: Render `EmergencyModal` with `visible=true` and a mock `familyMembers` array — assert "Acknowledge Incident" text is present and no direct-dial CALL button exists (will confirm bug on unfixed code).
2. **Hardcoded Number Test**: Tap "CALL FOR HELP" → tap "Household Member / Owner" — assert `Linking.openURL` is called with `tel:09123456789` (confirms hardcoded contact bug).
3. **Notification Tap Test**: Simulate `addNotificationResponseReceivedListener` callback with a mock notification payload — assert `triggerEmergency` is NOT called (confirms missing listener bug).
4. **Bridge Payload Test**: Inspect the `message.data` object sent by `sendPushNotification` — assert `incidentId` and `device_mac` are absent (confirms incomplete payload bug).

**Expected Counterexamples:**
- `EmergencyModal` renders "Acknowledge Incident" link instead of CALL button.
- `Linking.openURL` receives `tel:09123456789` regardless of `family_members` data.
- `triggerEmergency` is never called on notification tap from killed state.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed code produces the expected behavior.

**Pseudocode:**
```
FOR ALL X WHERE isBugCondition_CallButton(X) DO
  result := renderEmergencyModal_fixed(X)
  ASSERT result contains CALL button (not "Acknowledge Incident" link)
  ASSERT tapping CALL button calls Linking.openURL with primary member's phone
END FOR

FOR ALL X WHERE isBugCondition_PushNotification(X) DO
  result := sendPushNotification_fixed(X)
  ASSERT result.data contains incidentId AND device_mac
  ASSERT Expo Push API returns { status: 'ok' }
  ASSERT triggerEmergency() is called on notification tap
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug conditions do NOT hold, behavior is unchanged.

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition_CallButton(X) DO
  ASSERT renderEmergencyModal(X) = renderEmergencyModal_fixed(X)
END FOR

FOR ALL X WHERE NOT isBugCondition_PushNotification(X) DO
  ASSERT sendPushNotification(X) = sendPushNotification_fixed(X)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because it generates many input combinations (different `familyMembers` arrays, different `appState` values, different PPM readings) and catches regressions that manual tests miss.

**Test Cases:**
1. **Alarm Sound Preservation**: Verify `playSiren()` is still called when modal opens after fix.
2. **BFP Hotline Preservation**: Verify 911 row still appears in call options screen after fix.
3. **System Administrator Preservation**: Verify System Administrator row still appears after fix.
4. **Dismiss Preservation**: Verify tapping the close/acknowledge action still stops the siren and calls `onClose()`.
5. **Foreground Incident Preservation**: Verify `postgres_changes` listener in `_layout.tsx` still triggers `EmergencyModal` when app is open.
6. **Non-Alert Bridge Preservation**: Verify bridge does not send push notification for PPM readings below warning threshold.

### Unit Tests

- Test `EmergencyModal` renders CALL button when `familyMembers` has a primary member.
- Test `EmergencyModal` renders CALL button that dials first member when no primary is set.
- Test `EmergencyModal` falls back to call options screen with "No household contact registered" when `familyMembers` is empty.
- Test call options screen renders dynamic family member rows with real names/phones.
- Test `sendPushNotification` in bridge includes `incidentId` and `device_mac` in `data` payload.
- Test notification response listener in `_layout.tsx` calls `triggerEmergency` with correct incident shape.

### Property-Based Tests

- Generate random `FamilyMember[]` arrays (0–10 members, random `is_primary` flags) and verify the CALL button always dials the correct number (primary or first).
- Generate random notification `data` payloads and verify `triggerEmergency` is always called with a valid incident object.
- Generate random PPM/alert combinations and verify bridge push notification payload always contains required fields when threshold is exceeded.

### Integration Tests

- Full flow: MQTT message → bridge inserts incident → push notification sent → app killed → user taps notification → `EmergencyModal` opens with correct incident data.
- Full flow: `EmergencyModal` opens → user taps CALL button → `Linking.openURL` called with primary family member's phone.
- Full flow: `EmergencyModal` opens → user taps "CALL FOR HELP" → call options screen shows real family member names alongside BFP Hotline and System Administrator.
- Regression: `EmergencyModal` opens → user taps dismiss → siren stops, modal closes, `activeIncident` is null.
