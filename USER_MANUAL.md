# 📖 H-Fire Resident Mobile Application — User Manual

Welcome to the **H-Fire Resident Mobile Application**. This comprehensive guide will walk you through setting up, configuring, and using the H-Fire emergency fire and gas leak monitoring system for your household.

---

## 📑 Table of Contents
1. [System Overview & Key Features](#1-system-overview--key-features)
2. [Initial Setup & Account Registration](#2-initial-setup--account-registration)
3. [Managing Your Profile & Home Location](#3-managing-your-profile--home-location)
4. [Connecting & Managing Hardware Sensors](#4-connecting--managing-hardware-sensors)
5. [Understanding the Dashboard & Gas Thresholds](#5-understanding-the-dashboard--gas-thresholds)
6. [Multi-Room Sensor Mesh Monitoring](#6-multi-room-sensor-mesh-monitoring)
7. [Emergency Alert & Response System](#7-emergency-alert--response-system)
8. [Automated SMS & Emergency Hotline Calling](#8-automated-sms--emergency-hotline-calling)
9. [Household Family Members Directory](#9-household-family-members-directory)
10. [Reviewing History & Incident Logs](#10-reviewing-history--incident-logs)
11. [App Settings & Customization](#11-app-settings--customization)
12. [Troubleshooting & Frequently Asked Questions (FAQ)](#12-troubleshooting--frequently-asked-questions-faq)

---

## 1. System Overview & Key Features

The **H-Fire Resident App** pairs with your household's IoT physical hardware (ESP32 microcontroller, MQ-2 Gas/Smoke Sensor, and Optical Flame Sensor) to provide real-time, 24/7 protection against fire and toxic gas leaks.

### 🌟 Core Capabilities
* **0-Second Live Streaming:** Continuous telemetry over HiveMQ MQTT with real-time parts-per-million (PPM) air quality readings.
* **Full-Screen Emergency Siren:** Instant audiovisual siren alarm and tactile haptic pulse even when your phone is locked or set to silent.
* **Automated Background Emergency SMS:** Instant SMS dispatch via httpSMS to registered family members and the Community Hotline containing your exact home address and a **one-tap Google Maps navigation link**.
* **Household Multi-Room Mesh:** Monitor up to three distinct sectors (Kitchen, Living Room, Exterior/Bedroom) from a single dashboard.
* **Strict Privacy & Ownership Filtering:** Alerts and sirens only trigger for devices explicitly linked to your household.

---

## 2. Initial Setup & Account Registration

### Creating an Account
1. Open the **H-Fire** application on your mobile device.
2. If you are a new resident, tap **"Create Account"** or **"Sign Up"**.
3. Fill in your:
   * **Full Name** (e.g., `Dela Cruz, Juan`)
   * **Email Address**
   * **Password** (minimum 6 characters)
4. Tap **"Sign Up"**. Once verified, you will be automatically logged in to the dashboard.

### Logging In
1. Enter your registered email address and password.
2. Tap **"Login"**.
3. If you forgot your password, tap **"Forgot Password?"** to receive a password reset link via email.

---

## 3. Managing Your Profile & Home Location

To ensure emergency responders and community guards can reach your household during an incident, your profile details must be accurate.

### Updating Your Profile
1. Navigate to the **Settings** tab (gear icon at the bottom right).
2. Under the **Profile** section, review and update:
   * **First Name, Middle Name, Last Name**
   * **Block & Lot** (e.g., `Block 3 Lot 14`)
   * **Street / Subdivision Address**
3. Tap **"Save Profile"**.

### Pinning Your Home on Google Maps
1. In the **Profile** tab, tap **"Set Location on Map"**.
2. An interactive map will appear:
   * Tap **"My Location"** to automatically detect your current GPS coordinates.
   * Or drag the pin directly onto your home's rooftop.
3. Tap **"Confirm Location"**.
4. Tap **"Save Profile"** to store your coordinates (`latitude` and `longitude`).

> [!IMPORTANT]
> Setting your exact map coordinates is critical. When an emergency alarm triggers, the automated SMS dispatched to the community hotline and your family members will include a direct Google Maps link (`https://maps.google.com/?q=lat,lng`) leading straight to your home.

---

## 4. Connecting & Managing Hardware Sensors

Your H-Fire ESP32 sensor unit must be claimed by your account so that only your household receives alerts.

### Linking Your Device
1. Ensure your physical H-Fire hardware is plugged into power and connected to your home Wi-Fi.
2. In the **Settings** tab, tap the **"DEVICE"** sub-tab.
3. Tap **"Scan for New Device"**.
4. The app will search for active H-Fire nodes broadcasting on the local network.
5. When your device MAC address appears (e.g., `20:50:0D:33:68:0C`), tap the **"+"** button to link it.
6. Once linked, the hardware is tied to your account.

### Renaming & Customizing Units
1. On the main **Gas Monitor** dashboard, locate your device card.
2. Tap the pencil icon next to the unit name.
3. Enter a custom name (e.g., *"Kitchen Stove Unit"*, *"Ground Floor Sensor"*).
4. Tap **"Save"**.

### Unlinking a Device
1. Go to **Settings** > **DEVICE** tab.
2. Under **Connected Hardware**, locate the device and tap **"UNLINK"**.
3. Confirm unlinking. The device will be released and will stop sending alerts to your account.

---

## 5. Understanding the Dashboard & Gas Thresholds

The main screen (**Gas Monitor**) features a circular gauge representing atmospheric combustible gas and smoke concentration in **Parts Per Million (PPM)**.

### Gas Concentration Thresholds

| Status Level | PPM Range | Indicator Color | System Behavior |
| :--- | :--- | :--- | :--- |
| **🛡️ Safe / Normal** | $0 - 450\text{ PPM}$ | **Green** | Clean air. Background telemetry logs normally. |
| **⚠️ Warning** | $451 - 1500\text{ PPM}$ | **Orange / Yellow** | Elevated gas or light smoke detected. System enters cautionary monitoring. |
| **🚨 Danger / Fire** | $> 1500\text{ PPM}$ or Optical Flame | **Red / Flashing** | **CRITICAL EMERGENCY**. Looping siren plays, full-screen alarm displays, and automated SMS is dispatched. |
| **⚪ Offline** | Inactivity $> 60\text{s}$ | **Gray** | Device powered off or lost Wi-Fi connection. |

### Network Connectivity Badges
* **Cloud Service:** Confirms connection to the cloud telemetry bridge.
* **App Network:** Confirms your phone has an active internet connection (Wi-Fi or Cellular Data).

---

## 6. Multi-Room Sensor Mesh Monitoring

If your household has satellite nodes installed (e.g., Node 2 in the Living Room, Node 3 in the Bedroom):

1. On the main **Gas Monitor** dashboard, tap on the device card.
2. The **Mesh Sensors Modal** will slide up showing all rooms simultaneously:
   * **Node 1 (Core):** Kitchen Main Sensor (Gas PPM + Optical Flame state).
   * **Node 2 (Secondary):** Living Room Sector (Live PPM + Flame state).
   * **Node 3 (Secondary):** Bedroom / Exterior Sector (Live PPM + Flame state).
3. If **any** room exceeds danger thresholds, the interconnected alarm triggers across your entire home.

---

## 7. Emergency Alert & Response System

When gas concentration exceeds **1500 PPM** or optical flame sensors detect fire, the **Emergency Siren Modal** takes over your phone screen.

### Alarm Screen Features
1. **Looping Siren:**
   * High-intensity fire alarm tone for fire events.
   * Alternating smoke alarm pulse for gas leak events.
2. **Continuous Tactile Haptics:** Strong vibration patterns ensure you wake up even if your phone is on silent.
3. **Hazard Information:**
   * Live PPM count.
   * Specific node/room where the hazard originated.
   * Current flame status.

### Actions You Can Take:
* **CALL FOR HELP:** Opens the emergency contact and speed-dial drawer.
* **SEND AUTO SMS (httpSMS):** Instantly dispatches background emergency SMS containing your home location and Google Maps link to all family members and the community hotline.
* **ACKNOWLEDGE / DISMISS:** Silences the siren audio and dismisses the alert if the hazard has been inspected and cleared.

> [!NOTE]
> If the Community Command Center / Admin resolves the incident remotely from the admin platform, the Emergency Modal on your phone will **automatically close and silence the siren** without you needing to press anything.

---

## 8. Automated SMS & Emergency Hotline Calling

### Automated Background SMS (httpSMS)
When you tap **"SEND AUTO SMS"** (or when automated danger dispatch is enabled):
* The app sends an encrypted HTTP request directly to the **httpSMS Gateway**.
* **It does NOT open your phone's native messaging app.** Everything happens silently in the background.
* The dispatched message format:

```text
[H-FIRE EMERGENCY ALERT]
🔥 FIRE EMERGENCY!
Resident: Dela Cruz, Juan
Address: Block 3 Lot 14, Phase 2, Subdivision
Unit: Core Node 1 (Kitchen Main Unit)
Hazard Level: 1820 PPM (FLAME CONFIRMED)
Map: https://maps.google.com/?q=14.200314,121.382419
Time: 05:45 PM
Immediate emergency assistance requested!
```

### Speed-Dialing Emergency Numbers
When you tap **"CALL FOR HELP"**:
1. **Primary Family Contact:** Calls your designated household family member with a single tap.
2. **Other Options & Saved Hotline:**
   * **BFP Hotline (911):** Direct phone dialer to the Bureau of Fire Protection national emergency hotline.
   * **Community Emergency Hotline:** Direct dialer or direct SMS to the subdivision gate/HOA guard house (`+639770163408`).
   * **Individual Family Members:** Individual call and SMS buttons for each registered household member.

---

## 9. Household Family Members Directory

Add family members living in your household so they are automatically alerted during emergencies.

### Adding a Family Member
1. Open the left-hand navigation or tap **"Family Members"** in Settings.
2. Tap **"Add Member"** (+ icon).
3. Fill in:
   * **Full Name** (e.g., `Maria Dela Cruz`)
   * **Phone Number** (e.g., `09171234567` or `+639171234567`)
   * **Relationship** (e.g., `Spouse`, `Child`, `Parent`)
   * **Age**
   * **Set as Primary Contact** toggle (enables 1-tap emergency calling).
4. Tap **"Save Contact"**.

---

## 10. Reviewing History & Incident Logs

1. Tap the **Activity / History** tab (clock/magnifying glass icon at the bottom).
2. View the chronological feed:
   * **Hazard Incidents:** Timestamped records of when danger/fire was detected, PPM levels, and duration.
   * **Gas Logs:** Historical warning spikes.
3. Tap on any past incident card to inspect notes, attributed room sensor, and resolution status.

---

## 11. App Settings & Customization

Navigate to the **Settings** tab to configure system behavior:

* **24/7 Background Guard:**
  * When enabled, H-Fire runs a persistent low-priority Android notification showing live household PPM and safety status even when the app is minimized.
* **Auto-SMS on Danger:**
  * Toggle ON to automatically broadcast emergency SMS via httpSMS whenever a Danger event occurs.
* **Theme Preference:**
  * Choose between **Light Mode**, **Dark Mode**, or **System Default**.

---

## 12. Troubleshooting & Frequently Asked Questions (FAQ)

### Q: Why does my device show "Offline"?
* Check if the ESP32 hardware is plugged into a functional power outlet.
* Confirm that your home 2.4GHz Wi-Fi is online.
* If you changed your home Wi-Fi password, the ESP32 hardware will need to be reconfigured with the new credentials.

### Q: Why did I receive an alert before, but not anymore for another house's device?
* H-Fire incorporates strict **Device Ownership Filtering**. You will **only** receive sirens and alarms for devices claimed under your profile. Community-wide broadcasts are reserved for HOA Admins and Guards.

### Q: Does the Auto SMS require mobile load/credit on my phone?
* **No.** Automated SMS is dispatched through the cloud **httpSMS Gateway** over the internet. As long as your phone has Wi-Fi or mobile data, the SMS will be sent.

### Q: How does the Google Maps link work for emergency responders?
* When recipients receive the emergency SMS, tapping the link opens Google Maps with a red navigation pin placed exactly on your home's roof. They can immediately tap **"Start"** or **"Directions"** to navigate directly to your house.

---

*H-Fire Emergency Response System — Protecting Homes, Saving Lives.*
