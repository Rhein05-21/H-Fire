# Bugfix Requirements Document

## Introduction

The H-Fire emergency monitoring app has two related alarm behavior issues:

1. **Wrong action button on the alarm modal** — When an emergency is triggered, the `EmergencyModal` shows an "Acknowledge Incident" text link as the secondary action. The user wants this replaced with a prominent **CALL** button that directly dials a registered family/household member from the `family_members` Supabase table. Currently, the "Household Member / Owner" contact in the call options screen is hardcoded to `ADMIN_CONTACT = '09123456789'` and does not fetch real data from Supabase.

2. **Push notifications not delivered when app is closed or device is off** — The current push notification setup registers an Expo push token and saves it to the `profiles` table. The `hivemq-to-supabase-bridge.js` already calls `sendPushNotification()` when an incident is triggered, but the notification channel configuration and delivery reliability for background/terminated-state (and device-off scenarios) may not be fully correct, and the app does not handle notification taps to open the emergency modal when launched from a killed state.

---

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN an emergency incident is active and the `EmergencyModal` is displayed THEN the system shows an "Acknowledge Incident" text link as the only secondary action instead of a call button for family members.

1.2 WHEN the user taps "CALL FOR HELP" and the call options screen appears THEN the system dials the hardcoded number `09123456789` for "Household Member / Owner" instead of fetching the actual phone number from the `family_members` table in Supabase.

1.3 WHEN no family members are registered in the `family_members` table for the current user THEN the system still shows "Household Member / Owner" with a hardcoded number, giving the user a false sense that a real contact is available.

1.4 WHEN the mobile app is closed (terminated state) or the device screen is off and an incident is triggered THEN the system may not deliver a push notification reliably because the Android notification channel is only created at app startup and the bridge does not confirm successful delivery.

1.5 WHEN the user taps a push notification while the app is in a killed/background state THEN the system opens the app but does not navigate to or display the `EmergencyModal` for the relevant incident.

### Expected Behavior (Correct)

2.1 WHEN an emergency incident is active and the `EmergencyModal` is displayed THEN the system SHALL show a prominent "CALL" button (replacing the "Acknowledge Incident" link) that immediately initiates a call to the primary family member's phone number from the `family_members` table.

2.2 WHEN the user taps the "CALL" button and at least one family member is registered THEN the system SHALL dial the `phone` number of the member where `is_primary = true`, or the first registered member if no primary is set.

2.3 WHEN the user taps the "CALL" button and no family members are registered THEN the system SHALL fall back to showing the call options screen (BFP hotline + System Administrator) and display a message indicating no household contact is registered.

2.4 WHEN the "CALL FOR HELP" button is tapped and the call options screen is shown THEN the system SHALL display the actual registered family members fetched from the `family_members` Supabase table (with their real names and phone numbers) instead of the hardcoded `ADMIN_CONTACT`.

2.5 WHEN an incident is inserted into the `incidents` table with `status = 'Active'` THEN the bridge SHALL send a push notification via the Expo Push API to the device owner's `push_token` with `priority: 'high'` and `channelId: 'emergency-alerts'` so it is delivered even when the app is in the background or terminated state.

2.6 WHEN the user taps a received push notification and the app launches from a killed or background state THEN the system SHALL display the `EmergencyModal` for the corresponding incident by reading the notification's `data` payload.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the user taps "CALL FOR HELP" on the modal THEN the system SHALL CONTINUE TO show the BFP Hotline (911) and System Administrator options in the call options screen alongside the family member contacts.

3.2 WHEN an emergency incident is active THEN the system SHALL CONTINUE TO play the alarm sound, trigger haptic feedback, and animate the pulse effect as before.

3.3 WHEN the user dismisses the emergency modal (via the acknowledge/close action) THEN the system SHALL CONTINUE TO stop the alarm sound and clear the active incident from context.

3.4 WHEN the app is open and a new incident is inserted into Supabase THEN the system SHALL CONTINUE TO trigger the `EmergencyModal` via the existing `postgres_changes` listener in `_layout.tsx`.

3.5 WHEN a user registers, edits, or deletes a family member in the `family-members` screen THEN the system SHALL CONTINUE TO persist those changes to the `family_members` Supabase table without any regression.

3.6 WHEN the bridge processes an MQTT message that does not meet the danger/warning threshold THEN the system SHALL CONTINUE TO skip push notification sending and only log the gas reading.

---

## Bug Condition Pseudocode

### Bug Condition 1 — Hardcoded Contact / Missing CALL Button

```pascal
FUNCTION isBugCondition_CallButton(X)
  INPUT: X = { modalVisible: boolean, familyMembers: FamilyMember[] }
  OUTPUT: boolean

  RETURN X.modalVisible = true
    AND (UI shows "Acknowledge Incident" text link as secondary action
         OR "Household Member / Owner" dials hardcoded '09123456789')
END FUNCTION

// Property: Fix Checking
FOR ALL X WHERE isBugCondition_CallButton(X) DO
  result ← renderEmergencyModal'(X)
  ASSERT result contains CALL button that dials X.familyMembers[primary].phone
  ASSERT result does NOT contain hardcoded '09123456789' for household contact
END FOR

// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition_CallButton(X) DO
  ASSERT renderEmergencyModal(X) = renderEmergencyModal'(X)
END FOR
```

### Bug Condition 2 — Push Notification Not Delivered When App is Closed

```pascal
FUNCTION isBugCondition_PushNotification(X)
  INPUT: X = { appState: 'killed' | 'background' | 'foreground', incidentInserted: boolean }
  OUTPUT: boolean

  RETURN X.incidentInserted = true
    AND (X.appState = 'killed' OR X.appState = 'background')
    AND push notification NOT received on device
END FUNCTION

// Property: Fix Checking
FOR ALL X WHERE isBugCondition_PushNotification(X) DO
  result ← sendPushNotification'(X.ownerId, X.houseName, X.alertType, X.ppm)
  ASSERT Expo Push API returns { status: 'ok' }
  ASSERT device receives notification with title containing alertType
  ASSERT tapping notification opens app AND displays EmergencyModal for incident
END FOR

// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition_PushNotification(X) DO
  ASSERT sendPushNotification(X) = sendPushNotification'(X)
END FOR
```
