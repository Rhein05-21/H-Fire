/**
 * MAC Address to Household & Location Mapping
 * 5 Households, 2 Devices each (10 Devices total)
 */
export const HOUSEHOLD_MAPPING: Record<string, { house: string; location: string }> = {
  // Household 1 (Block 1 Lot 1)
  'A1:B2:C3:D4:E5:F1': { house: 'Block 1 Lot 1', location: 'Kitchen' },
  'A1:B2:C3:D4:E5:F2': { house: 'Block 1 Lot 1', location: 'Bedroom' },

  // Household 2 (Block 1 Lot 2)
  'A1:B2:C3:D4:E5:F3': { house: 'Block 1 Lot 2', location: 'Kitchen' },
  'A1:B2:C3:D4:E5:F4': { house: 'Block 1 Lot 2', location: 'Living Room' },

  // Household 3 (Block 2 Lot 1)
  'A1:B2:C3:D4:E5:F5': { house: 'Block 2 Lot 1', location: 'Kitchen' },
  'A1:B2:C3:D4:E5:F6': { house: 'Block 2 Lot 1', location: 'Bedroom' },

  // Household 4 (Block 2 Lot 2)
  'A1:B2:C3:D4:E5:F7': { house: 'Block 2 Lot 2', location: 'Kitchen' },
  'A1:B2:C3:D4:E5:F8': { house: 'Block 2 Lot 2', location: 'Master Suite' },

  // Household 5 (Block 3 Lot 1)
  'A1:B2:C3:D4:E5:F9': { house: 'Block 3 Lot 1', location: 'Kitchen' },
  'A1:B2:C3:D4:E5:FA': { house: 'Block 3 Lot 1', location: 'Garage' },
};

export const getDeviceInfo = (mac: string) => {
  return HOUSEHOLD_MAPPING[mac] || { house: `MAC: ${mac}`, location: 'Unknown Device' };
};
