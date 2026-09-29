/**
 * H-Fire PPM Thresholds — Single Source of Truth
 * All bridges, contexts, and components reference these values.
 * 
 * NORMAL:  PPM ≤ 450    → Safe baseline, normal monitoring
 * WARNING: 451–1500     → Gas / Smoke detected, caution alert
 * DANGER:  PPM > 1500   → Fire / High gas hazard (or Flame sensor HIGH), critical siren alarm
 */

export type GasStatus = 'Normal' | 'Warning' | 'Danger' | 'Offline';

export const THRESHOLDS = {
  NORMAL_MAX: 450,
  WARNING_MAX: 1500,
  OFFLINE_TIMEOUT_MS: 60000, // 60 seconds of no telemetry = Offline
};

export const GAS_THRESHOLDS = {
  NORMAL: 450,
  WARNING: 1500,
};

export const getStatusFromPPM = (ppm: number, flame: boolean = false, isOnline: boolean = true): GasStatus => {
  if (!isOnline) return 'Offline';
  if (flame || ppm > THRESHOLDS.WARNING_MAX) return 'Danger';
  if (ppm > THRESHOLDS.NORMAL_MAX) return 'Warning';
  return 'Normal';
};

export const getStatus = (ppm: number): 'Normal' | 'Warning' | 'Danger' => {
  if (ppm <= GAS_THRESHOLDS.NORMAL) return 'Normal';
  if (ppm <= GAS_THRESHOLDS.WARNING) return 'Warning';
  return 'Danger';
};

export const getStatusColor = (status: string): string => {
  const s = (status || '').toUpperCase();
  if (s === 'NORMAL' || s === 'SAFE') return '#4CAF50'; // Green
  if (s === 'WARNING' || s.includes('SMOKE') || s.includes('GAS') || s.includes('CAUTION')) return '#FF9800'; // Orange
  if (s === 'DANGER' || s.includes('CRITICAL') || s.includes('FIRE')) return '#F44336'; // Red
  return '#9E9E9E'; // Grey for offline or unknown
};
