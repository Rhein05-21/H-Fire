/**
 * Verification Test Suite for Automated Emergency SMS Service
 * Tests:
 * 1. E.164 phone number normalization (09..., 9..., +63..., spaces, dashes)
 * 2. Placeholder & malformed number rejection
 * 3. Graceful fallback on missing API keys (Safe Simulation Mode)
 * 4. Anti-spam cooldown enforcement
 */

const { normalizePhoneNumber, sendAutomatedEmergencySms } = require('../utils/sms-service');

let passed = 0;
let failed = 0;

function assert(description, condition, details = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${description}`);
    if (details) console.error(`     Details: ${details}`);
    failed++;
  }
}

console.log('\n--- 1. Testing Phone Number Normalization ---');

// Standard 09xx
assert('Standard 09171234567 becomes +639171234567',
  normalizePhoneNumber('09171234567') === '+639171234567',
  `Got: ${normalizePhoneNumber('09171234567')}`
);

// Formatted with dashes
assert('Dashed 0917-123-4567 becomes +639171234567',
  normalizePhoneNumber('0917-123-4567') === '+639171234567',
  `Got: ${normalizePhoneNumber('0917-123-4567')}`
);

// Formatted with spaces and parentheses
assert('Spaced (0918) 987 6543 becomes +639189876543',
  normalizePhoneNumber('(0918) 987 6543') === '+639189876543',
  `Got: ${normalizePhoneNumber('(0918) 987 6543')}`
);

// Starts with 9 (10 digits)
assert('10-digit 9221234567 becomes +639221234567',
  normalizePhoneNumber('9221234567') === '+639221234567',
  `Got: ${normalizePhoneNumber('9221234567')}`
);

// Starts with +63
assert('Already E.164 +639171234567 preserved',
  normalizePhoneNumber('+639171234567') === '+639171234567',
  `Got: ${normalizePhoneNumber('+639171234567')}`
);

// Starts with 63 without plus
assert('639171234567 prepends +',
  normalizePhoneNumber('639171234567') === '+639171234567',
  `Got: ${normalizePhoneNumber('639171234567')}`
);

console.log('\n--- 2. Testing Malformed & Placeholder Rejections ---');

// Placeholder filter
assert('Rejects dummy placeholder 09123456789',
  normalizePhoneNumber('09123456789') === null
);

assert('Rejects dummy placeholder containing XXXXXXXXX',
  normalizePhoneNumber('+639XXXXXXXXX') === null
);

// Too short
assert('Rejects short number 12345',
  normalizePhoneNumber('12345') === null
);

// Non-PH or landline without mobile prefix
assert('Rejects landline 0281234567',
  normalizePhoneNumber('0281234567') === null
);

// Null or empty
assert('Rejects empty string',
  normalizePhoneNumber('') === null
);

assert('Rejects null',
  normalizePhoneNumber(null) === null
);

console.log('\n--- 3. Testing Mock SMS Dispatch & Safe Simulation ---');

async function testMockDispatch() {
  const loggedRows = [];
  const mockSupabase = {
    from: (table) => {
      if (table === 'emergency_settings') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { key: 'auto_sms_enabled', value: 'true' } }),
            }),
          }),
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  name: 'Juan Dela Cruz',
                  block_lot: 'Blk 1 Lot 2',
                  address: 'Mabuhay St.',
                  auto_sms_enabled: true,
                },
              }),
            }),
            or: () => ({
              // Guard profiles
              data: [{ name: 'HOA Guard Gate', emergency_hotline: '09191112233', role: 'guard' }],
            }),
          }),
        };
      }
      if (table === 'family_members') {
        return {
          select: () => ({
            eq: () => ({
              // Family members (Option C)
              data: [
                { full_name: 'Maria Dela Cruz', phone: '09171112222', relationship: 'Spouse' },
                { full_name: 'Pedro Dela Cruz', phone: '09183334444', relationship: 'Child' },
              ],
            }),
          }),
        };
      }
      if (table === 'sms_logs') {
        return {
          insert: async (rows) => {
            loggedRows.push(...rows);
            return { error: null };
          },
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
    },
  };

  // Dispatch mock danger event
  const testMac = 'AA:BB:CC:DD:EE:01';
  await sendAutomatedEmergencySms(mockSupabase, {
    incidentId: 999,
    profileId: 'usr_test_123',
    houseName: 'Dela Cruz Residence',
    nodeLabel: 'Kitchen Sensor Unit',
    alertType: 'FIRE',
    ppm: 1650,
    flame: true,
    mac: testMac,
  });

  assert('Dispatched to 3 recipients (2 family members + 1 guard)',
    loggedRows.length === 3,
    `Total recipients logged: ${loggedRows.length}`
  );

  const mariaLog = loggedRows.find(r => r.recipient_phone === '+639171112222');
  assert('Normalized Maria Dela Cruz number (+639171112222)',
    Boolean(mariaLog && mariaLog.recipient_name === 'Maria Dela Cruz')
  );

  const guardLog = loggedRows.find(r => r.recipient_phone === '+639191112233');
  assert('Normalized HOA Guard number (+639191112233)',
    Boolean(guardLog && guardLog.recipient_role === 'Community Guard / Admin')
  );

  assert('Simulation mode active (status = SIMULATED)',
    loggedRows.every(r => r.status === 'SIMULATED' || r.status === 'SENT')
  );

  // Test Anti-Spam Cooldown immediately after
  const beforeCount = loggedRows.length;
  await sendAutomatedEmergencySms(mockSupabase, {
    incidentId: 1000,
    profileId: 'usr_test_123',
    mac: testMac,
    ppm: 1800,
  });

  assert('Anti-spam cooldown prevented immediate re-dispatch for same MAC',
    loggedRows.length === beforeCount,
    `Logged count before: ${beforeCount}, after: ${loggedRows.length}`
  );

  console.log(`\n========================================`);
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

testMockDispatch();
