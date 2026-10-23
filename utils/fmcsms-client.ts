import { supabase } from './supabase';

/**
 * Normalizes Philippine mobile numbers to standard format.
 * Supports: '09171234567', '9171234567', '+639171234567', '639171234567'.
 */
export function normalizePhoneNumber(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;

  let cleaned = raw.trim().replace(/[\s\-\(\)\.]/g, '');

  // Filter dummy or placeholder numbers
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

  // If starts with 09 (11 digits): convert to '63' format
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
 * Converts standard 639XXXXXXXXX number to 09XXXXXXXXX local format if required.
 */
export function toLocalPhoneNumber(normalized: string): string {
  if (normalized.startsWith('639') && normalized.length === 12) {
    return `0${normalized.slice(2)}`;
  }
  return normalized;
}

export interface SmsRecipient {
  name: string;
  phone: string;
  role: string;
}

export interface DispatchEmergencySmsParams {
  recipients: SmsRecipient[];
  incidentId?: number | string | null;
  profileId?: string | null;
  houseName: string;
  nodeLabel: string;
  alertType: string;
  ppm: number;
  flame?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
}

export interface DispatchEmergencySmsResult {
  success: boolean;
  sentCount: number;
  failedCount: number;
  results: { phone: string; name: string; success: boolean; error?: string }[];
  errorMessage?: string;
  mode?: 'LIVE_FMCSMS' | 'SIMULATION';
}

/**
 * Dispatches a single SMS via FMCSMS REST API (FortMED / KBRSMS) with timeout.
 */
export async function sendFmcsmsMessage({
  to,
  message,
  apiKey,
  senderId = 'HFIRE',
  apiEndpoint = 'https://fortmed.org/web/FMCSMS/api/send.php',
}: {
  to: string;
  message: string;
  apiKey: string;
  senderId?: string;
  apiEndpoint?: string;
}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const payload = {
      api_key: apiKey,
      recipient: to,
      message,
      sender_id: senderId,
    };

    const response = await fetch(apiEndpoint, {
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
        error: data?.message || data?.error || `FMCSMS returned status ${response.status}`,
      };
    }

    return { success: true, data };
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return { success: false, error: 'FMCSMS request timed out after 12s' };
    }
    return { success: false, error: err.message || 'Network error calling FMCSMS' };
  }
}

/**
 * Main In-App Emergency SMS Dispatcher via FMCSMS.
 * If FMCSMS_API_KEY is configured in .env, sends live SMS. Otherwise, operates safely in simulation mode.
 */
export async function dispatchAutomatedEmergencySms({
  recipients,
  incidentId,
  profileId,
  houseName,
  nodeLabel,
  alertType,
  ppm,
  flame = false,
  latitude,
  longitude,
  address,
}: DispatchEmergencySmsParams): Promise<DispatchEmergencySmsResult> {
  const fmcsmsApiKey =
    process.env.EXPO_PUBLIC_FMCSMS_API_KEY ||
    process.env.FMCSMS_API_KEY;

  const fmcsmsEndpoint =
    process.env.EXPO_PUBLIC_FMCSMS_API_ENDPOINT ||
    process.env.FMCSMS_API_ENDPOINT ||
    'https://fortmed.org/web/FMCSMS/api/send.php';

  const fmcsmsSenderId =
    process.env.EXPO_PUBLIC_FMCSMS_SENDER_ID ||
    process.env.FMCSMS_SENDER_ID ||
    'HFIRE';

  const activeMode: 'LIVE_FMCSMS' | 'SIMULATION' =
    fmcsmsApiKey && !fmcsmsApiKey.includes('your_') && fmcsmsApiKey.length > 5
      ? 'LIVE_FMCSMS'
      : 'SIMULATION';

  const timestampStr = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const flameText = flame ? 'FLAME CONFIRMED' : 'HIGH GAS/SMOKE';
  const alertHeader = flame || ppm > 1500 ? 'FIRE EMERGENCY' : 'CRITICAL GAS / SMOKE LEAK';

  let locationLines = '';
  if (address) {
    locationLines += `\nAddress: ${address}`;
  }
  if (latitude && longitude) {
    locationLines += `\nMap: https://maps.google.com/?q=${latitude},${longitude}`;
  } else if (address) {
    locationLines += `\nMap: https://maps.google.com/?q=${encodeURIComponent(address)}`;
  }

  const messageContent = 
`[H-FIRE EMERGENCY ALERT]
${alertHeader}!
Resident: ${houseName}${locationLines}
Triggered By: ${nodeLabel}
Hazard Level: ${ppm} PPM (${flameText})
Time: ${timestampStr}
Immediate emergency assistance requested!`;

  const validRecipients: SmsRecipient[] = [];
  const seenNumbers = new Set<string>();

  for (const r of recipients) {
    const normalized = normalizePhoneNumber(r.phone);
    if (normalized && !seenNumbers.has(normalized)) {
      seenNumbers.add(normalized);
      validRecipients.push({ ...r, phone: normalized });
    }
  }

  if (validRecipients.length === 0) {
    return {
      success: false,
      sentCount: 0,
      failedCount: 0,
      results: [],
      errorMessage: 'No valid phone numbers found to receive emergency SMS.',
      mode: activeMode,
    };
  }

  const results: { phone: string; name: string; success: boolean; error?: string }[] = [];
  let sentCount = 0;
  let failedCount = 0;

  for (const recipient of validRecipients) {
    let success = false;
    let errorDetail: string | undefined = undefined;

    if (activeMode === 'LIVE_FMCSMS') {
      const res = await sendFmcsmsMessage({
        to: recipient.phone,
        message: messageContent,
        apiKey: fmcsmsApiKey!,
        senderId: fmcsmsSenderId,
        apiEndpoint: fmcsmsEndpoint,
      });
      success = res.success;
      errorDetail = res.error;
    } else {
      // Simulation mode
      success = true;
      console.log(`📱 [FMCSMS SIMULATION] To: ${recipient.phone} (${recipient.name})\n${messageContent}`);
    }

    if (success) {
      sentCount++;
      results.push({ phone: recipient.phone, name: recipient.name, success: true });
    } else {
      failedCount++;
      results.push({ phone: recipient.phone, name: recipient.name, success: false, error: errorDetail });
    }

    // Write audit record to Supabase sms_logs
    try {
      await supabase.from('sms_logs').insert([{
        incident_id: typeof incidentId === 'number' ? incidentId : null,
        profile_id: profileId || null,
        recipient_phone: recipient.phone,
        sender_phone: activeMode === 'LIVE_FMCSMS' ? fmcsmsSenderId : 'SIMULATOR',
        recipient_name: recipient.name,
        recipient_role: recipient.role,
        message_content: messageContent,
        status: success ? (activeMode === 'SIMULATION' ? 'SIMULATED' : 'SENT') : 'FAILED',
        error_message: errorDetail || null,
      }]);
    } catch (e) {
      // Silent fail for logging errors
    }
  }

  return {
    success: sentCount > 0,
    sentCount,
    failedCount,
    results,
    errorMessage: failedCount > 0 && sentCount === 0 ? results[0]?.error : undefined,
    mode: activeMode,
  };
}
