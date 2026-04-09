/**
 * H-Fire PPM Thresholds — Single Source of Truth
 * All bridges, contexts, and components should reference these values.
 * 
 * NORMAL:  PPM ≤ 450    → Safe, no alerts
 * WARNING: 451–1500     → Gas/Smoke detected, orange alert
 * DANGER:  PPM > 1500   → Fire-level, red alert, siren, incident created
 */
export const GAS_THRESHOLDS = {
  NORMAL: 450,
  WARNING: 1500,
  // DANGER is anything above WARNING (>1500 PPM)
};

export const getStatus = (ppm: number): 'Normal' | 'Warning' | 'Danger' => {
  if (ppm <= GAS_THRESHOLDS.NORMAL) return 'Normal';
  if (ppm <= GAS_THRESHOLDS.WARNING) return 'Warning';
  return 'Danger';
};

export const getStatusColor = (status: string): string => {
  const s = (status || '').toUpperCase();
  if (s === 'NORMAL' || s === 'SAFE') return '#4CAF50'; // Green
  if (s === 'WARNING' || s.includes('SMOKE') || s.includes('GAS')) return '#FF9800'; // Orange
  if (s === 'DANGER' || s.includes('CRITICAL') || s.includes('FIRE')) return '#F44336'; // Red
  return '#9E9E9E'; // Grey for unknown
};
