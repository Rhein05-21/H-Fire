# H-Fire Admin Monitoring System Plan

This document outlines the architecture for a centralized **Admin Dashboard** integrated into the mobile app, designed for real-time monitoring and **Force Notifications**.

---

## 1. System Roles
*   **Resident (HomeOwner):** Monitors only their own 2 devices.
*   **Admin:** Monitors all 10 devices (5 households). Receives **Force Notifications** for any community-wide emergency.

---

## 2. Core Features (Mobile Admin App)

### A. Force Notification System (High Priority)
*   **Foreground Alerts:** If an alarm triggers while the app is open, a full-screen modal blocks the UI until acknowledged.
*   **Continuous Siren:** Uses `expo-av` to play a loud, repeating alarm sound that overrides silent mode (if possible) or at least plays at max volume.
*   **Persistent Vibration:** Continuous haptic feedback.
*   **Global Listener:** Subscribes to `supabase.channel('global-alerts')` for any new log where `status = 'Danger'`.

### B. Live Community Map
*   **Visual:** Map view showing all 5 households.
*   **Real-time Colors:** Markers turn RED immediately when a leak is detected in that house.
*   **One-Tap Navigation:** Click a red marker to see the house address and the specific room (Kitchen/Bedroom).

### C. Master Status Feed
*   A "live-only" feed of the last 5 minutes of data from ALL devices.
*   **Device Health:** Shows if any of the 10 devices have gone offline (Last seen > 5 minutes).

---

## 3. Technical Implementation

### A. Data Layer
1.  **Supabase Realtime:** The Admin app listens to *all* inserts in the `gas_logs` table.
2.  **Device Mapping:** A `devices` table maps `mac` -> `house_name` so the notification says "FIRE: Block 1 Lot 1" instead of a MAC address.

### B. App UI Integration
1.  **Role Switcher:** A hidden toggle or password-protected area in `Settings` to switch to "Admin Mode."
2.  **Admin Tab:** A new tab `(admin)/dashboard` that replaces the Resident view.

---

## 4. Proposed Database Changes
*   **`profiles` table:** Add `is_admin (boolean)` column.
*   **`devices` table:** New table to map MAC addresses to households.
    *   Columns: `mac (PK)`, `house_name`, `profile_id (Owner)`.

---

## 5. Implementation Phases
1.  **Phase 1 (Database):** Create the `devices` table and link your 10 MAC addresses.
2.  **Phase 2 (Auth):** Add Admin role logic to `UserContext`.
3.  **Phase 3 (Siren):** Build the `EmergencyModal` component with `expo-av` sound integration.
4.  **Phase 4 (Map):** Build the Global Map for the Admin view.
