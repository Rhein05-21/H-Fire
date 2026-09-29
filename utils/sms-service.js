/**
 * Automated Emergency SMS Service via httpSMS
 * Integrates Option C (All Household Family Members) and Option B (Community Hotline)
 * Includes E.164 Normalization, Anti-Spam Cooldown, Rate Pacing, and Safe Simulation Fallback.
 */

const dotenv = require('dotenv');
dotenv.config();

// In-memory cooldown tracker: mac -> timestamp (3 minutes cooldown)
const smsCooldownMap = new Map();
const COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Normalizes phone numbers to standard E.164 format (+639XXXXXXXXX).
 * Handles: '09171234567', '9171234567', '+639171234567', '639171234567', and stripped spaces/dashes.
 */
function normalizePhoneNumber(raw) {
  if (!raw || typeof raw !== 'string') return null;

  // Remove all non-digit characters except leading '+'
  let cleaned = raw.trim().replace(/[\s\-\(\)\.]/g, '');

  // Placeholder filter (avoid testing against dummy numbers)
  if (cleaned.includes('XXXXXXXXX') || cleaned === '09123456789' || cleaned === '+639123456789') {
    return null;
  }

  // If starts with +63
  if (cleaned.startsWith('+63')) {
    if (cleaned.length === 13 && cleaned.startsWith('+639')) return cleaned;
    return null;
  }

  // If starts with 63 without '+'
  if (cleaned.startsWith('63')) {
    if (cleaned.length === 12 && cleaned.startsWith('639')) return `+${cleaned}`;
    return null;
  }

  // If starts with 09 (standard PH mobile)
  if (cleaned.startsWith('09')) {
    if (cleaned.length === 11) return `+63${cleaned.slice(1)}`;
    return null;
  }

  // If starts with 9 (missing 0)
  if (cleaned.startsWith('9')) {
    if (cleaned.length === 10) return `+63${cleaned}`;
    return null;
  }

  return null;
}

/**
 * Dispatches an SMS via httpSMS REST API with network timeout and error handling.
 */
async function sendHttpSmsMessage({ to, content, apiKey, fromNumber }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // 8-second timeout

  try {
    const response = await fetch('https://api.httpsms.com/v1/messages/send', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content,
        from: fromNumber,
        to,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        success: false,
        error: data.message || `httpSMS error ${response.status}`,
      };
    }

    return { success: true, data };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return { success: false, error: 'httpSMS request timed out after 8s' };
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
    // Map of normalizedPhone -> { name, role }
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

    // 7. Check httpSMS Credentials
    const apiKey = process.env.HTTPSMS_API_KEY;
    const fromNumber = process.env.HTTPSMS_FROM_NUMBER;
    const isLiveGateway = Boolean(apiKey && fromNumber);

    console.log(`\n📢 [SMS Gateway] Broadcasting to ${recipientsMap.size} recipient(s)... (Mode: ${isLiveGateway ? 'LIVE httpSMS' : 'SAFE SIMULATION'})`);

    // 8. Dispatch to each recipient with 300ms pacing delay
    for (const [phone, info] of recipientsMap.entries()) {
      let status = 'SENT';
      let errorMessage = null;

      if (isLiveGateway) {
        const result = await sendHttpSmsMessage({
          to: phone,
          content: messageContent,
          apiKey,
          fromNumber,
        });

        if (result.success) {
          console.log(`✅ [SMS SENT] To: ${phone} (${info.name} - ${info.role})`);
        } else {
          status = 'FAILED';
          errorMessage = result.error;
          console.warn(`❌ [SMS FAILED] To: ${phone} (${info.name}): ${result.error}`);
        }
      } else {
        // Safe Simulation Mode: Log to console and record in Supabase
        status = 'SIMULATED';
        errorMessage = 'httpSMS credentials not set in .env (Simulation Mode)';
        console.log(`📱 [SMS SIMULATION] To: ${phone} (${info.name} - ${info.role})`);
        console.log(`   Message:\n   ${messageContent.replace(/\n/g, '\n   ')}\n`);
      }

      // Log to Supabase sms_logs table for audit trail
      try {
        await supabase.from('sms_logs').insert([{
          incident_id: incidentId,
          profile_id: profileId,
          recipient_phone: phone,
          sender_phone: fromNumber || 'SYSTEM_SIMULATOR',
          recipient_name: info.name,
          recipient_role: info.role,
          message_content: messageContent,
          status,
          error_message: errorMessage,
        }]);
      } catch (logErr) {
        console.warn('⚠️ Could not write to sms_logs table:', logErr.message);
      }

      // Pacing delay (300ms) to prevent hitting Android OS background rate limits
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  } catch (err) {
    // Non-blocking catch-all: Never allow an SMS error to crash the bridge!
    console.error('❌ [SMS Gateway Critical Error]:', err.message);
  }
}

module.exports = {
  sendAutomatedEmergencySms,
  normalizePhoneNumber,
};
