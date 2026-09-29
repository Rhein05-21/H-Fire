import { supabase } from './supabase';

/**
 * Normalizes phone numbers to standard E.164 format (+639XXXXXXXXX).
 */
export function normalizePhoneNumber(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;

  let cleaned = raw.trim().replace(/[\s\-\(\)\.]/g, '');

  if (cleaned.includes('XXXXXXXXX') || cleaned === '09123456789' || cleaned === '+639123456789') {
    return null;
  }

  if (cleaned.startsWith('+63')) {
    if (cleaned.length === 13 && cleaned.startsWith('+639')) return cleaned;
    return null;
  }

  if (cleaned.startsWith('63')) {
    if (cleaned.length === 12 && cleaned.startsWith('639')) return `+${cleaned}`;
    return null;
  }

  if (cleaned.startsWith('09')) {
    if (cleaned.length === 11) return `+63${cleaned.slice(1)}`;
    return null;
  }

  if (cleaned.startsWith('9')) {
    if (cleaned.length === 10) return `+63${cleaned}`;
    return null;
  }

  return null;
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
}

export interface DispatchEmergencySmsResult {
  success: boolean;
  sentCount: number;
  failedCount: number;
  results: { phone: string; name: string; success: boolean; error?: string }[];
  errorMessage?: string;
}

/**
 * Dispatches automated emergency SMS via httpSMS REST API.
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
}: DispatchEmergencySmsParams): Promise<DispatchEmergencySmsResult> {
  const apiKey = 
    process.env.EXPO_PUBLIC_HTTPSMS_API_KEY || 
    process.env.HTTPSMS_API_KEY || 
    'uk_TiLnzBua6GeNFJxiwrYl8B2LsTT04Wu0Uke775MsXCl6xYrsMwuFuxr197OpjYkw';

  const fromNumber = 
    process.env.EXPO_PUBLIC_HTTPSMS_FROM_NUMBER || 
    process.env.HTTPSMS_FROM_NUMBER || 
    '+639770163408';

  const timestampStr = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const flameText = flame ? 'FLAME CONFIRMED' : 'HIGH GAS/SMOKE';
  const alertHeader = flame || ppm > 1500 ? 'FIRE EMERGENCY' : 'CRITICAL GAS / SMOKE LEAK';

  const messageContent = 
`[H-FIRE EMERGENCY ALERT]
${alertHeader}!
Resident: ${houseName}
Location Unit: ${nodeLabel}
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
    };
  }

  const results: { phone: string; name: string; success: boolean; error?: string }[] = [];
  let sentCount = 0;
  let failedCount = 0;

  for (const recipient of validRecipients) {
    try {
      const response = await fetch('https://api.httpsms.com/v1/messages/send', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: messageContent,
          from: fromNumber,
          to: recipient.phone,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        sentCount++;
        results.push({ phone: recipient.phone, name: recipient.name, success: true });

        // Log to Supabase sms_logs
        try {
          await supabase.from('sms_logs').insert([{
            incident_id: typeof incidentId === 'number' ? incidentId : null,
            profile_id: profileId || null,
            recipient_phone: recipient.phone,
            sender_phone: fromNumber,
            recipient_name: recipient.name,
            recipient_role: recipient.role,
            message_content: messageContent,
            status: 'SENT',
          }]);
        } catch (e) {}
      } else {
        failedCount++;
        const errorMsg = data?.message || `HTTP ${response.status}`;
        results.push({ phone: recipient.phone, name: recipient.name, success: false, error: errorMsg });

        try {
          await supabase.from('sms_logs').insert([{
            incident_id: typeof incidentId === 'number' ? incidentId : null,
            profile_id: profileId || null,
            recipient_phone: recipient.phone,
            sender_phone: fromNumber,
            recipient_name: recipient.name,
            recipient_role: recipient.role,
            message_content: messageContent,
            status: 'FAILED',
            error_message: errorMsg,
          }]);
        } catch (e) {}
      }
    } catch (err: any) {
      failedCount++;
      results.push({ phone: recipient.phone, name: recipient.name, success: false, error: err.message });
    }
  }

  return {
    success: sentCount > 0,
    sentCount,
    failedCount,
    results,
  };
}
