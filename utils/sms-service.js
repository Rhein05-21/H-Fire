/**
 * Automated Emergency SMS Service via FMCSMS REST API (FortMED / KBRSMS)
 * Integrates Option C (All Household Family Members) and Option B (Community Hotline)
 * Includes Philippine 639XXXXXXXXX Normalization, Anti-Spam Cooldown, Rate Pacing, and Safe Simulation Fallback.
 */

const dotenv = require('dotenv');
dotenv.config();

// In-memory cooldown tracker: mac -> timestamp (3 minutes cooldown)
const smsCooldownMap = new Map();
const COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Normalizes phone numbers to standard Philippine format (639XXXXXXXXX).
 * Handles: '09171234567', '9171234567', '+639171234567', '639171234567', and stripped spaces/dashes.
 */
function normalizePhoneNumber(raw) {
  if (!raw || typeof raw !== 'string') return null;

  let cleaned = raw.trim().replace(/[\s\-\(\)\.]/g, '');

  // Placeholder filter (avoid testing against dummy numbers)
  if (cleaned.includes('XXXXXXXXX') || cleaned === '09123456789' || cleaned === '+639123456789' || cleaned === '639123456789') {
    return null;
  }

  // Strip leading '+'
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1);
  }

  // If starts with 639 (12 digits)
  if (cleaned.startsWith('639') && cleaned.length === 12) {
    return cleaned;
  }

  // If starts with 09 (11 digits): replace '0' with '63'
  if (cleaned.startsWith('09') && cleaned.length === 11) {
    return `63${cleaned.slice(1)}`;
  }

  // If starts with 9 (10 digits): prepend '63'
  if (cleaned.startsWith('9') && cleaned.length === 10) {
    return `63${cleaned}`;
  }

  return null;
}

/**
 * Dispatches an SMS via FMCSMS REST API (FortMED / KBRSMS).
 * Accepts: { api_key, recipient, message, sender_id }
 */
async function sendFmcsmsMessage({ to, message, apiKey, senderId = 'HFIRE', apiEndpoint }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000); // 12-second timeout

  try {
    const url = apiEndpoint || process.env.FMCSMS_API_ENDPOINT || 'https://fortmed.org/web/FMCSMS/api/send.php';
    const payload = {
      api_key: apiKey,
      recipient: to,
      message,
      sender_id: senderId,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const data = await response.json().catch(() => ({}));
    const isSuccess = response.ok && (data?.status === 'success' || data?.status === 200 || !data?.status);

    if (!isSuccess) {
      return {
        success: false,
        error: data?.message || data?.error || `FMCSMS error HTTP ${response.status}`,
      };
    }

    return { success: true, data };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return { success: false, error: 'FMCSMS request timed out after 12s' };
    }
    return { success: false, error: err.message || 'Network error' };
  }
}

/**
 * Main Emergency SMS Dispatcher.
 * Called by the Node.js bridge when status === 'Danger'.
 */
async function sendAutomatedEmergencySms(supabase, {
  incidentId = null,
  profileId = null,
  houseName = 'Resident Home',
  nodeLabel = 'Sensor Unit',
  alertType = 'FIRE',
  ppm = 0,
  flame = false,
  mac = 'UNKNOWN_MAC',
}) {
  try {
    // 1. Anti-Spam Cooldown Check (3 minutes per device)
    const now = Date.now();
    const lastSent = smsCooldownMap.get(mac) || 0;
    if (now - lastSent < COOLDOWN_MS) {
      const remainingSec = Math.round((COOLDOWN_MS - (now - lastSent)) / 1000);
      console.log(`⏳ [SMS Gateway] Cooldown active for ${mac}. Next SMS allowed in ${remainingSec}s.`);
      return;
    }

    // 2. Check System-Wide Emergency Setting (emergency_settings.auto_sms_enabled)
    const { data: globalSetting } = await supabase
      .from('emergency_settings')
      .select('value')
      .eq('key', 'auto_sms_enabled')
      .maybeSingle();

    if (globalSetting && globalSetting.value === 'false') {
      console.log('ℹ️ [SMS Gateway] Global emergency SMS is turned OFF in emergency_settings.');
      return;
    }

    // 3. Check Resident Profile & Resident Toggle (profiles.auto_sms_enabled)
    let residentName = houseName;
    let residentAddress = 'Household Address';
    let residentLatitude = null;
    let residentLongitude = null;
    let isResidentSmsEnabled = true;

    if (profileId) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('name, block_lot, address, latitude, longitude, auto_sms_enabled')
        .eq('id', profileId)
        .maybeSingle();

      if (profile) {
        residentName = profile.name || residentName;
        residentAddress = [profile.block_lot, profile.address].filter(Boolean).join(', ') || residentAddress;
        residentLatitude = profile.latitude;
        residentLongitude = profile.longitude;
        if (profile.auto_sms_enabled === false) {
          isResidentSmsEnabled = false;
        }
      }
    }

    // 4. Resolve Recipients
    const recipientsMap = new Map();

    // --- RECIPIENTS (OPTION C): All Registered Household Family Members ---
    if (profileId && isResidentSmsEnabled) {
      const { data: familyMembers } = await supabase
        .from('family_members')
        .select('full_name, phone, relationship')
        .eq('profile_id', profileId);

      (familyMembers || []).forEach(member => {
        const normalized = normalizePhoneNumber(member.phone);
        if (normalized && !recipientsMap.has(normalized)) {
          recipientsMap.set(normalized, {
            name: member.full_name,
            role: member.relationship || 'Family Member',
          });
        }
      });
    } else if (!isResidentSmsEnabled) {
      console.log(`ℹ️ [SMS Gateway] Resident (${residentName}) has turned OFF auto_sms_enabled.`);
    }

    // --- RECIPIENTS (OPTION B): Community Hotline & Guard House ---
    // A. From emergency_settings.hotline_number
    const { data: hotlineSetting } = await supabase
      .from('emergency_settings')
      .select('value')
      .eq('key', 'hotline_number')
      .maybeSingle();

    if (hotlineSetting?.value) {
      const normalizedHotline = normalizePhoneNumber(hotlineSetting.value);
      if (normalizedHotline && !recipientsMap.has(normalizedHotline)) {
        recipientsMap.set(normalizedHotline, {
          name: 'Community Emergency Hotline',
          role: 'Emergency Hotline',
        });
      }
    }

    // B. From Guard / Admin Profiles
    const { data: guardProfiles } = await supabase
      .from('profiles')
      .select('name, emergency_hotline, role')
      .or('role.eq.guard,role.eq.admin,role.eq.hoa');

    (guardProfiles || []).forEach(guard => {
      const normalized = normalizePhoneNumber(guard.emergency_hotline);
      if (normalized && !recipientsMap.has(normalized)) {
        recipientsMap.set(normalized, {
          name: guard.name || 'Security Guard',
          role: 'Community Guard / Admin',
        });
      }
    });

    if (recipientsMap.size === 0) {
      console.log('ℹ️ [SMS Gateway] No valid recipient phone numbers found for emergency alert.');
      return;
    }

    // 5. Construct Emergency SMS Content
    const timestampStr = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Manila',
    });

    let mapLink = '';
    if (residentLatitude && residentLongitude) {
      mapLink = `\nMap: https://maps.google.com/?q=${residentLatitude},${residentLongitude}`;
    }

    const flameText = flame ? 'FLAME CONFIRMED' : 'HIGH GAS/SMOKE';
    const messageContent = 
`[H-FIRE EMERGENCY ALERT]
CRITICAL HAZARD DETECTED!
Resident: ${residentName}
Location: ${residentAddress}
Unit: ${nodeLabel}
Hazard: ${alertType} (${ppm} PPM, ${flameText})${mapLink}
Time: ${timestampStr}
Immediate response requested!`;

    // 6. Update Cooldown Timestamp
    smsCooldownMap.set(mac, now);

    // 7. Resolve FMCSMS Gateway & Credentials
    const fmcsmsApiKey = process.env.FMCSMS_API_KEY;
    const fmcsmsSenderId = process.env.FMCSMS_SENDER_ID || 'HFIRE';
    const fmcsmsEndpoint = process.env.FMCSMS_API_ENDPOINT || 'https://fortmed.org/web/FMCSMS/api/send.php';

    const isLiveGateway = Boolean(fmcsmsApiKey && !fmcsmsApiKey.includes('your_') && fmcsmsApiKey.length > 5);

    console.log(`\n📢 [FMCSMS Gateway] Broadcasting to ${recipientsMap.size} recipient(s)... (Mode: ${isLiveGateway ? 'LIVE FMCSMS' : 'SAFE SIMULATION'})`);

    // 8. Dispatch to each recipient with 300ms pacing delay
    for (const [phone, info] of recipientsMap.entries()) {
      let status = 'SENT';
      let errorMessage = null;
      let senderUsed = isLiveGateway ? fmcsmsSenderId : 'SYSTEM_SIMULATOR';

      if (isLiveGateway) {
        const result = await sendFmcsmsMessage({
          to: phone,
          message: messageContent,
          apiKey: fmcsmsApiKey,
          senderId: fmcsmsSenderId,
          apiEndpoint: fmcsmsEndpoint,
        });

        if (result.success) {
          console.log(`✅ [FMCSMS SENT] To: ${phone} (${info.name} - ${info.role})`);
        } else {
          status = 'FAILED';
          errorMessage = result.error;
          console.warn(`❌ [FMCSMS FAILED] To: ${phone} (${info.name}): ${result.error}`);
        }
      } else {
        status = 'SIMULATED';
        errorMessage = 'FMCSMS API key pending in .env (Safe Simulation Mode)';
        console.log(`📱 [FMCSMS SIMULATION] To: ${phone} (${info.name} - ${info.role})`);
        console.log(`   Message:\n   ${messageContent.replace(/\n/g, '\n   ')}\n`);
      }

      // Log to Supabase sms_logs table for audit trail
      try {
        await supabase.from('sms_logs').insert([{
          incident_id: incidentId,
          profile_id: profileId,
          recipient_phone: phone,
          sender_phone: senderUsed,
          recipient_name: info.name,
          recipient_role: info.role,
          message_content: messageContent,
          status,
          error_message: errorMessage,
        }]);
      } catch (logErr) {
        console.warn('⚠️ Could not write to sms_logs table:', logErr.message);
      }

      // Pacing delay (300ms)
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  } catch (err) {
    console.error('❌ [FMCSMS Gateway Critical Error]:', err.message);
  }
}

module.exports = {
  sendAutomatedEmergencySms,
  normalizePhoneNumber,
  sendFmcsmsMessage,
};
