# H-Fire Project Documentation

## Project Overview
H-Fire is an integrated emergency response and monitoring system for fire and gas leaks. It connects IoT hardware sensors to a mobile application for real-time alerts and community-wide monitoring.

### Core Technologies
- **Mobile App:** Expo (React Native, TypeScript)
- **Backend/Database:** Supabase (Auth, DB, Realtime)
- **Authentication:** Clerk + Supabase
- **IoT Messaging:** HiveMQ (MQTT)
- **Hardware:** ESP32, MQ2 Gas Sensor, KY-026 Flame Sensor, I2C LCD
- **Alerting:** Expo Notifications, `expo-av` (Sirens), Haptics
- **Monitoring:** `react-native-maps` for device location tracking

---

## System Architecture

1.  **Hardware (IoT):** ESP32 devices monitor gas (PPM) and flame status. Data is published to HiveMQ MQTT topics (`hfire/#`).
2.  **Bridge Service:** A Node.js script (`utils/hivemq-to-supabase-bridge.js`) acts as a bridge. It listens to MQTT, validates data, inserts logs into Supabase, and triggers Expo Push Notifications during "Danger" states.
3.  **Mobile App:**
    *   **Residents:** Monitor their own devices and receive local alerts.
    *   **Admins:** Monitor all community devices, receive "Force Notifications," and view a live community map.
4.  **Real-time Layer:** The app uses Supabase Realtime to listen for new entries in the `incidents` table to trigger the `EmergencyModal`.

---

## Building and Running

### Mobile App (Expo)
```bash
# Install dependencies
npm install

# Start the Expo development server
npm start

# Run on specific platforms
npm run android
npm run ios
npm run web
```

### MQTT-to-Supabase Bridge
The bridge must be running for IoT data to reach the mobile app.
```bash
# Start the bridge (requires .env with HiveMQ and Supabase credentials)
npm run bridge
```

### Environment Variables
Ensure the following are set in `.env`:
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (Required for Bridge)
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_HIVEMQ_BROKER`
- `EXPO_PUBLIC_HIVEMQ_USERNAME`
- `EXPO_PUBLIC_HIVEMQ_PASSWORD`

---

## Development Conventions

### Single Source of Truth
- **PPM Thresholds:** Always refer to `constants/thresholds.ts`.
    - **Normal:** ≤ 450 PPM
    - **Warning:** 451–1500 PPM
    - **Danger:** > 1500 PPM (or Flame detected)

### Routing
- This project uses **Expo Router** with file-based navigation.
- Main tabs are located in `app/(tabs)/`.
- Admin features are being developed in `app/(admin)/`.

### Database Updates
- SQL setup scripts are available in the root directory (e.g., `supabase_setup.sql.txt`, `family_members_setup.sql`).
- Use the `SUPABASE_SERVICE_ROLE_KEY` in the bridge to bypass RLS for system-level inserts.

### Hardware
- The latest Arduino/ESP32 code is maintained in `HFire_app_mq2_lcd_updated.txt`.

---

## Key Files
- `app/_layout.tsx`: Root layout with Auth, Theme, and Global Emergency listeners.
- `utils/supabase.js`: Supabase client configuration.
- `utils/hivemq-to-supabase-bridge.js`: Logic for MQTT data processing and push notifications.
- `components/EmergencyModal.tsx`: Full-screen siren/alert UI for danger events.
- `ADMIN_PLAN.md`: Strategic roadmap for the Admin Monitoring System.
- `constants/thresholds.ts`: Defines system-wide gas level standards.
