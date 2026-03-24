export const GAS_THRESHOLDS = {
  NORMAL: 450,
  WARNING: 1300,
  // DANGER is anything above WARNING
};

export const getStatus = (ppm: number) => {
  if (ppm <= GAS_THRESHOLDS.NORMAL) return 'Normal';
  if (ppm <= GAS_THRESHOLDS.WARNING) return 'Warning';
  return 'Danger';
};

export const getStatusColor = (status: string) => {
  const s = (status || '').toUpperCase();
  if (s === 'NORMAL' || s === 'SAFE') return '#4CAF50'; // Green
  if (s === 'WARNING' || s.includes('SMOKE') || s.includes('GAS')) return '#FF9800'; // Orange
  if (s === 'DANGER' || s.includes('CRITICAL') || s.includes('FIRE')) return '#F44336'; // Red
  return '#9E9E9E'; // Grey for unknown
};
