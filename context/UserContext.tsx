import React, { createContext, useContext, useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import mqtt from 'mqtt';
import * as Notifications from 'expo-notifications';
import { supabase, isSupabaseConfigured, DeviceRecord, IncidentRecord } from '@/utils/supabase';
import { getStatusFromPPM, GasStatus, THRESHOLDS } from '@/constants/thresholds';

export interface UserDetails {
  name: string; 
  email?: string;
  block_lot: string; 
  address?: string; 
  latitude?: number; 
  longitude?: number; 
  is_admin?: boolean;
  role?: string;
  emergency_hotline?: string;
  auto_sms_enabled?: boolean;
}

export interface Incident {
  id: string | number; 
  house_name: string; 
  label: string; 
  ppm: number; 
  flame?: boolean;
  alert_type: 'FIRE' | 'GAS / SMOKE LEAK' | 'GAS/SMOKE' | 'SMOKE' | 'FLAME' | 'MODERATE SMOKE' | string; 
  device_mac?: string;
  status?: string;
}

export interface Device {
  id: string; 
  mac: string; 
  ppm: number; 
  flame: boolean;
  status: GasStatus; 
  label: string; 
  houseId: string; 
  house_name?: string;
  block_lot?: string; 
  lastSeen: Date; 
  profile_id?: string | null;
}

export interface SecondaryNodeTelemetry {
  id: string;
  name: string;
  gasKey: string;
  fireKey: string;
  ppm: number;
  flame: boolean;
  status: GasStatus;
  last_seen: string;
}

export interface SecondaryNodesState {
  N2: SecondaryNodeTelemetry;
  N3: SecondaryNodeTelemetry;
}

interface UserContextType {
  userDetails: UserDetails | null;
  setUserDetails: (details: UserDetails) => void;
  profileId: string | null;
  isAdmin: boolean;
  isAuthenticated: boolean;
  refreshProfile: (uid?: string) => Promise<void>;
  loading: boolean;
  activeIncident: Incident | null;
  triggerEmergency: (incident: Incident) => void;
  dismissEmergency: () => void;
  isMuted: (mac: string) => boolean;
  devices: Record<string, Device>;
  allHeardDevices: Record<string, Device>;
  secondaryNodes: SecondaryNodesState;
  systemStatus: 'Online' | 'Offline';
  signOut: () => Promise<void>;
  updateProfile: (details: Partial<UserDetails>) => Promise<{ error: any }>;
  claimDevice: (mac: string, label?: string) => Promise<{ success: boolean; error?: string }>;
  unlinkDevice: (mac: string) => Promise<{ success: boolean; error?: string }>;
  renameDevice: (mac: string, label: string) => Promise<{ success: boolean; error?: string }>;
  isGuardEnabled: boolean;
  showGuardPrompt: boolean;
  enableGuard: () => Promise<void>;
  disableGuard: () => Promise<void>;
  promptGuard: () => void;
  dismissGuardPrompt: () => Promise<void>;
  autoSmsEnabled: boolean;
  toggleAutoSms: (enabled: boolean) => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

const HIVEMQ_BROKER = process.env.EXPO_PUBLIC_HIVEMQ_BROKER || '16e51255d95244c2b069b92cf77ebf81.s1.eu.hivemq.cloud';
const HIVEMQ_PORT = process.env.EXPO_PUBLIC_HIVEMQ_PORT || '8884';
const HIVEMQ_URL = `wss://${HIVEMQ_BROKER}:${HIVEMQ_PORT}/mqtt`;

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [userDetails, setUserDetailsState] = useState<UserDetails | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bridgeHeartbeat, setBridgeHeartbeat] = useState<Date | null>(new Date());
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  
  const [activeIncident, setActiveIncident] = useState<Incident | null>(null);
  const [allHeardDevices, setAllHeardDevices] = useState<Record<string, Device>>({});
  const [registry, setRegistry] = useState<Record<string, DeviceRecord>>({});
  const [secondaryNodes, setSecondaryNodes] = useState<SecondaryNodesState>({
    N2: {
      id: 'N2',
      name: 'Secondary Sensor Node 2 (N2)',
      gasKey: 'N2_Gas',
      fireKey: 'N2_Fire',
      ppm: 0,
      flame: false,
      status: 'Normal',
      last_seen: new Date().toISOString(),
    },
    N3: {
      id: 'N3',
      name: 'Secondary Sensor Node 3 (N3)',
      gasKey: 'N3_Gas',
      fireKey: 'N3_Fire',
      ppm: 0,
      flame: false,
      status: 'Normal',
      last_seen: new Date().toISOString(),
    },
  });

  const [isGuardEnabled, setIsGuardEnabled] = useState<boolean>(true);
  const [showGuardPrompt, setShowGuardPrompt] = useState<boolean>(false);
  const isGuardEnabledRef = useRef<boolean>(true);
  isGuardEnabledRef.current = isGuardEnabled;

  const [autoSmsEnabled, setAutoSmsEnabled] = useState<boolean>(true);

  useEffect(() => {
    async function checkGuardPreference() {
      try {
        const pref = await AsyncStorage.getItem('HFIRE_BACKGROUND_GUARD_PREF');
        if (pref === 'denied') {
          setIsGuardEnabled(false);
          isGuardEnabledRef.current = false;
        } else {
          // Default: 24/7 monitoring is active silently in the background (no popup)
          setIsGuardEnabled(true);
          isGuardEnabledRef.current = true;
        }
      } catch (e) {}
    }
    checkGuardPreference();
  }, []);
  
  const profileIdRef = useRef<string | null>(null);
  profileIdRef.current = profileId;

  const isAdminRef = useRef<boolean>(false);
  isAdminRef.current = isAdmin;

  const registryRef = useRef<Record<string, DeviceRecord>>({});
  const latestTelemetryMapRef = useRef<Record<string, { ppm: number; flame: boolean; timestamp: number }>>({});
  const lastLoggedHazardRef = useRef<{ timestamp: number; ppm: number; flame: boolean }>({ timestamp: 0, ppm: 0, flame: false });

  // Direct Database Hazard Persistence (Only Warning & Danger, with Node Attribution)
  const recordHazardToSupabase = useCallback(async (mac: string, ppm: number, flame: boolean, nodeLabel: string = 'Core Node 1 (Main Sensor Unit)') => {
    if (!isSupabaseConfigured) return;
    const curProfileId = profileIdRef.current;
    if (!curProfileId) return;

    const norm = mac.toUpperCase();
    const isOwned = registryRef.current[norm]?.profile_id === curProfileId;
    if (!isAdminRef.current && !isOwned) return;

    const status: GasStatus = ppm > 1500 || flame ? 'Danger' : (ppm > 450 ? 'Warning' : 'Normal');
    
    // STRICT: Only save Warning and Danger into database logs. NEVER save Normal ambient readings.
    if (status !== 'Danger' && status !== 'Warning') return;

    const now = Date.now();
    if (now - lastLoggedHazardRef.current.timestamp < 3500) return;
    lastLoggedHazardRef.current = { timestamp: now, ppm, flame };

    const alertType = flame ? 'FIRE' : (ppm > 1500 ? 'FIRE / DENSE SMOKE' : 'GAS / SMOKE LEAK');
    const timestamp = new Date().toISOString();

    try {
      // 1. Insert into gas_logs table (Only Warning / Danger)
      await supabase.from('gas_logs').insert([{
        device_mac: norm,
        ppm_level: ppm,
        status,
        profile_id: registryRef.current[norm]?.profile_id || curProfileId,
        created_at: timestamp,
      }]);

      // 2. Insert into incidents table with clear Node Attribution
      const { data: existing } = await supabase
        .from('incidents')
        .select('id')
        .eq('device_mac', norm)
        .eq('status', 'Active')
        .maybeSingle();

      if (existing?.id) {
        await supabase.from('incidents').update({
          ppm_at_trigger: ppm,
          alert_type: alertType,
          start_time: timestamp,
          notes: `[${nodeLabel}] ${alertType} detected at ${ppm} PPM (Flame: ${flame ? 'YES' : 'NO'}).`,
        }).eq('id', existing.id);
      } else {
        await supabase.from('incidents').insert([{
          device_mac: norm,
          status: 'Active',
          ppm_at_trigger: ppm,
          alert_type: alertType,
          profile_id: registryRef.current[norm]?.profile_id || curProfileId,
          start_time: timestamp,
          notes: `[${nodeLabel}] ${alertType} detected at ${ppm} PPM (Flame: ${flame ? 'YES' : 'NO'}).`,
        }]);
      }
    } catch (err) {
      console.warn('[UserContext] Database log exception:', err);
    }
  }, []);

  // System Online Status based on Bridge Heartbeat
  const systemStatus = useMemo(() => {
    if (!bridgeHeartbeat) return 'Offline';
    const secondsSincePing = (Date.now() - bridgeHeartbeat.getTime()) / 1000;
    return secondsSincePing < 90 ? 'Online' : 'Offline';
  }, [bridgeHeartbeat]);

  // Initial Session & Auth State Listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setIsAuthenticated(true);
        setProfileId(session.user.id);
        refreshProfile(session.user.id);
      } else {
        setIsAuthenticated(false);
        setProfileId(null);
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        setIsAuthenticated(true);
        setProfileId(session.user.id);
        refreshProfile(session.user.id);
      } else {
        setIsAuthenticated(false);
        setProfileId(null);
        setUserDetailsState(null);
        setIsAdmin(false);
        setLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Compute Resident's Owned Devices
  const devices = useMemo(() => {
    const mine: Record<string, Device> = {};
    if (!profileId) return mine;

    Object.values(registry).forEach(regInfo => {
      if (regInfo.profile_id === profileId) {
        const normalizedMac = regInfo.mac.toUpperCase();
        const liveData = allHeardDevices[normalizedMac];
        const cachedTelemetry = latestTelemetryMapRef.current[normalizedMac];

        const lastSeenDate = liveData?.lastSeen || (regInfo.last_seen ? new Date(regInfo.last_seen) : new Date(0));
        const isOnline = (Date.now() - lastSeenDate.getTime()) < THRESHOLDS.OFFLINE_TIMEOUT_MS;

        const ppm = liveData !== undefined 
          ? liveData.ppm 
          : (cachedTelemetry !== undefined ? cachedTelemetry.ppm : (regInfo.current_ppm ?? 0));
        
        const flame = liveData !== undefined 
          ? liveData.flame 
          : (cachedTelemetry !== undefined ? cachedTelemetry.flame : Boolean(regInfo.flame));

        const status = getStatusFromPPM(ppm, flame, isOnline);

        mine[normalizedMac] = {
          id: normalizedMac,
          mac: normalizedMac,
          ppm,
          flame,
          status,
          label: regInfo.label || `Device ${normalizedMac.slice(-4)}`,
          houseId: regInfo.house_name || 'My Household',
          house_name: regInfo.house_name,
          block_lot: regInfo.block_lot || userDetails?.block_lot || 'Block 1 Lot 1',
          lastSeen: lastSeenDate,
          profile_id: regInfo.profile_id
        };
      }
    });

    return mine;
  }, [allHeardDevices, registry, profileId, userDetails]);

  // Refresh Profile & Device Registry from Supabase
  const refreshProfile = async (uid?: string) => {
    const targetId = uid || profileId;
    if (!targetId) { 
      setLoading(false); 
      return; 
    }

    if (!userDetails) setLoading(true);
    
    try {
      // 1. Fetch Profile
      const { data: dbProfile, error: profileErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', targetId)
        .maybeSingle();
      
      if (profileErr) console.error('[UserContext] Profile error:', profileErr.message);

      if (dbProfile) {
        const adminFlag = Boolean(dbProfile.is_admin || dbProfile.role === 'admin' || dbProfile.role === 'hoa' || dbProfile.role === 'guard');
        const smsEnabled = dbProfile.auto_sms_enabled !== false;
        setUserDetailsState({ 
          name: dbProfile.name, 
          email: dbProfile.email,
          block_lot: dbProfile.block_lot, 
          address: dbProfile.address,
          latitude: dbProfile.latitude, 
          longitude: dbProfile.longitude,
          is_admin: adminFlag,
          role: dbProfile.role,
          emergency_hotline: dbProfile.emergency_hotline,
          auto_sms_enabled: smsEnabled,
        });
        setIsAdmin(adminFlag);
        setAutoSmsEnabled(smsEnabled);
      }

      // 2. Fetch Devices & App Settings
      const [{ data: regData }, { data: settingsData }, { data: incData }] = await Promise.all([
        supabase.from('devices').select('*'),
        supabase.from('app_settings').select('*'),
        supabase.from('incidents').select('*').eq('status', 'Active').order('start_time', { ascending: false }).limit(5)
      ]);

      if (regData) {
        const cache: Record<string, DeviceRecord> = {};
        regData
          .filter(d => 
            d.mac !== '20:50:0D:33:68:02' && 
            d.mac !== '20:50:0D:33:68:03' &&
            !d.house_name?.includes('Household Sector 2') &&
            !d.house_name?.includes('Household Sector 3')
          )
          .forEach(d => { 
            const normalized = d.mac.toUpperCase();
            cache[normalized] = { ...d, mac: normalized }; 
          });
        setRegistry(cache);
        registryRef.current = cache;
      }

      if (settingsData) {
        const hb = settingsData.find(s => s.key === 'bridge_heartbeat');
        if (hb) setBridgeHeartbeat(new Date(hb.value));

        // Parse broadcast telemetry for physical device
        settingsData.forEach(s => {
          if (s.key && s.key.startsWith('telemetry_')) {
            try {
              const parsed = JSON.parse(s.value);
              const rawMac = parsed.mac || s.key.replace(/^telemetry_/i, '');
              const formattedMac = String(rawMac).toUpperCase().replace(/-/g, ':');

              if (formattedMac === '20:50:0D:33:68:02' || formattedMac === '20:50:0D:33:68:03') {
                return;
              }

              const ppm = Number(parsed.N1_Gas ?? parsed.ppm ?? parsed.ppm_level ?? 0);
              const flame = Boolean(parsed.N1_Fire === 1 || parsed.flame || parsed.fire === 1);
              
              latestTelemetryMapRef.current[formattedMac] = {
                ppm,
                flame,
                timestamp: Date.now()
              };

              // Extract Secondary Nodes N2 and N3 telemetry if broadcasted
              if (parsed.N2_Gas !== undefined || parsed.n2_gas !== undefined) {
                const n2Ppm = Number(parsed.N2_Gas ?? parsed.n2_gas ?? 0);
                const n2Flame = parsed.N2_Fire !== undefined ? (Number(parsed.N2_Fire) === 1 || Boolean(parsed.N2_Fire)) : false;
                const n2Status = n2Ppm > 1500 || n2Flame ? 'Danger' : (n2Ppm > 450 ? 'Warning' : 'Normal');
                setSecondaryNodes(prev => ({
                  ...prev,
                  N2: {
                    ...prev.N2,
                    ppm: n2Ppm,
                    flame: n2Flame,
                    status: n2Status,
                    last_seen: parsed.timestamp || s.updated_at || new Date().toISOString(),
                  }
                }));

                if (n2Status === 'Danger' && !activeIncident && Date.now() >= silencedUntilRef.current) {
                  setActiveIncident({
                    id: `n2_${Date.now()}`,
                    house_name: userDetails?.name || 'My Household',
                    label: 'Secondary Node 2 (Living Room)',
                    ppm: n2Ppm,
                    alert_type: n2Flame ? 'FIRE' : 'GAS / SMOKE LEAK',
                    device_mac: formattedMac,
                    status: 'Active',
                  });
                }
              }

              if (parsed.N3_Gas !== undefined || parsed.n3_gas !== undefined) {
                const n3Ppm = Number(parsed.N3_Gas ?? parsed.n3_gas ?? 0);
                const n3Flame = parsed.N3_Fire !== undefined ? (Number(parsed.N3_Fire) === 1 || Boolean(parsed.N3_Fire)) : false;
                const n3Status = n3Ppm > 1500 || n3Flame ? 'Danger' : (n3Ppm > 450 ? 'Warning' : 'Normal');
                setSecondaryNodes(prev => ({
                  ...prev,
                  N3: {
                    ...prev.N3,
                    ppm: n3Ppm,
                    flame: n3Flame,
                    status: n3Status,
                    last_seen: parsed.timestamp || s.updated_at || new Date().toISOString(),
                  }
                }));

                if (n3Status === 'Danger' && !activeIncident && Date.now() >= silencedUntilRef.current) {
                  setActiveIncident({
                    id: `n3_${Date.now()}`,
                    house_name: userDetails?.name || 'My Household',
                    label: 'Secondary Node 3 (Sector 3 / Ext)',
                    ppm: n3Ppm,
                    alert_type: n3Flame ? 'FIRE' : 'GAS / SMOKE LEAK',
                    device_mac: formattedMac,
                    status: 'Active',
                  });
                }
              }

              setAllHeardDevices(prev => {
                const next = { ...prev };
                delete next['20:50:0D:33:68:02'];
                delete next['20:50:0D:33:68:03'];
                next[formattedMac] = {
                  id: formattedMac,
                  mac: formattedMac,
                  ppm,
                  flame,
                  status: getStatusFromPPM(ppm, flame, true),
                  label: prev[formattedMac]?.label || `Device ${formattedMac.slice(-4)}`,
                  houseId: prev[formattedMac]?.houseId || 'Home',
                  lastSeen: new Date(parsed.timestamp || s.updated_at || Date.now()),
                };
                return next;
              });
            } catch {}
          }
        });
      }

      // Check Active Incidents for this user
      if (incData && incData.length > 0) {
        const myActive = incData.find(i => 
          (i.profile_id === targetId || 
          Object.keys(registryRef.current).some(mac => registryRef.current[mac].profile_id === targetId && mac === i.device_mac?.toUpperCase()))
          && i.status === 'Active'
        );

        if (myActive) {
          const devMac = myActive.device_mac?.toUpperCase() || '';
          const currentTelemetry = latestTelemetryMapRef.current[devMac];
          const isCurrentlyDangerous = (currentTelemetry?.ppm ?? 0) > 1500 || Boolean(currentTelemetry?.flame);

          // If currently in danger and not snoozed, trigger modal
          if (isCurrentlyDangerous && !activeIncident && Date.now() >= silencedUntilRef.current) {
            const matchedDev = regData?.find(d => d.mac?.toUpperCase() === devMac);
            setActiveIncident({
              id: myActive.id,
              house_name: matchedDev?.house_name || userDetails?.name || 'My Household',
              label: matchedDev?.label || 'Gas & Flame Sensor',
              ppm: currentTelemetry?.ppm || myActive.ppm_at_trigger || 0,
              alert_type: currentTelemetry?.flame ? 'FIRE' : (myActive.alert_type as any) || 'FIRE',
              device_mac: myActive.device_mac,
              status: myActive.status,
            });
          } else if (!isCurrentlyDangerous && (currentTelemetry?.ppm ?? 0) <= 450 && !currentTelemetry?.flame) {
            // Auto-resolve stale incident in database since sensor is safe
            supabase.from('incidents').update({ 
              status: 'Resolved', 
              end_time: new Date().toISOString(),
              notes: 'Auto-resolved: Sensor returned to safe level'
            }).eq('id', myActive.id).then(() => {});
            
            if (activeIncident) {
              setActiveIncident(null);
            }
          }
        }
      } else if (activeIncident) {
        setActiveIncident(null);
      }

    } catch (e: any) { 
      console.error('[UserContext] Refresh exception:', e); 
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    setLoading(true);
    try { 
      await supabase.auth.signOut();
    } catch (e) {}
    setProfileId(null);
    setUserDetailsState(null);
    setIsAdmin(false);
    setActiveIncident(null);
    setLoading(false);
  };

  const updateProfile = async (details: Partial<UserDetails>) => {
    if (!profileId) return { error: new Error('Not authenticated') };

    let finalEmail = details.email;
    if (!finalEmail) {
      const { data: { user } } = await supabase.auth.getUser();
      finalEmail = user?.email || userDetails?.email;
    }

    const payload = {
      id: profileId,
      name: details.name !== undefined ? details.name : (userDetails?.name || ''),
      email: finalEmail,
      block_lot: details.block_lot !== undefined ? details.block_lot : (userDetails?.block_lot || ''), 
      address: details.address !== undefined ? details.address : (userDetails?.address || ''),
      latitude: details.latitude !== undefined ? details.latitude : userDetails?.latitude,
      longitude: details.longitude !== undefined ? details.longitude : userDetails?.longitude,
      is_admin: details.is_admin !== undefined ? details.is_admin : (userDetails?.is_admin || false),
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase.from('profiles').upsert(payload);

    if (!error) {
      const updatedDetails: UserDetails = {
        ...userDetails,
        ...details,
        name: payload.name,
        email: payload.email,
        block_lot: payload.block_lot,
        address: payload.address,
        latitude: payload.latitude || undefined,
        longitude: payload.longitude || undefined,
      };
      setUserDetailsState(updatedDetails);
      setIsAdmin(Boolean(payload.is_admin));
      await AsyncStorage.setItem('HFIRE_USER_DETAILS', JSON.stringify(updatedDetails));
    }
    return { error };
  };

  const claimDevice = async (mac: string, customLabel?: string): Promise<{ success: boolean; error?: string }> => {
    if (!profileId) return { success: false, error: 'Not authenticated' };

    const normalizedMac = mac.toUpperCase();
    const houseName = userDetails?.name ? `${userDetails.name} Household` : 'Resident Household';
    const label = customLabel || `Device ${normalizedMac.slice(-4)}`;
    const blockLot = userDetails?.block_lot || 'Block 1 Lot 1';

    try {
      const { error } = await supabase.from('devices').upsert({
        mac: normalizedMac,
        profile_id: profileId,
        house_name: houseName,
        label,
        block_lot: blockLot,
        last_seen: new Date().toISOString()
      }, { onConflict: 'mac' });

      if (error) throw error;

      await refreshProfile();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Failed to claim device.' };
    }
  };

  const unlinkDevice = async (mac: string): Promise<{ success: boolean; error?: string }> => {
    if (!profileId) return { success: false, error: 'Not authenticated' };

    const normalizedMac = mac.toUpperCase();
    try {
      const { error } = await supabase
        .from('devices')
        .update({ profile_id: null })
        .eq('mac', normalizedMac);

      if (error) throw error;

      await refreshProfile();
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Failed to unlink device.' };
    }
  };

  const renameDevice = async (mac: string, newLabel: string): Promise<{ success: boolean; error?: string }> => {
    const normalizedMac = mac.toUpperCase();
    try {
      const { error } = await supabase
        .from('devices')
        .update({ label: newLabel })
        .eq('mac', normalizedMac);

      if (error) throw error;

      setRegistry(prev => {
        if (prev[normalizedMac]) {
          return { ...prev, [normalizedMac]: { ...prev[normalizedMac], label: newLabel } };
        }
        return prev;
      });

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Failed to update device label.' };
    }
  };

  const silencedUntilRef = useRef<number>(0);
  const lastNotificationTimeRef = useRef<number>(0);
  const lastGuardUpdateRef = useRef<number>(0);
  const lastGuardValuesRef = useRef<{ maxPpm: number; anyFlame: boolean; statusText: string }>({ maxPpm: -1, anyFlame: false, statusText: '' });
  const activeIncidentRef = useRef<Incident | null>(null);
  activeIncidentRef.current = activeIncident;

  const updatePersistentGuardNotification = useCallback((n1Ppm: number, n1Flame: boolean, n2Ppm: number = 0, n2Flame: boolean = false, n3Ppm: number = 0, n3Flame: boolean = false) => {
    if (Platform.OS !== 'android') return;
    if (!isGuardEnabledRef.current) return;

    const now = Date.now();
    const maxPpm = Math.max(n1Ppm, n2Ppm, n3Ppm);
    const anyFlame = n1Flame || n2Flame || n3Flame;
    const statusText = maxPpm > 1500 || anyFlame ? '🚨 DANGER ALARM' : (maxPpm > 450 ? '⚠️ WARNING LEVEL' : '🛡️ SAFE');

    const prev = lastGuardValuesRef.current;
    const statusChanged = prev.statusText !== statusText;
    const flameChanged = prev.anyFlame !== anyFlame;
    const ppmDifference = Math.abs(prev.maxPpm - maxPpm);
    const timeElapsed = now - lastGuardUpdateRef.current;

    // STRICT: Only update if status/flame changed, or PPM changed by >= 30 PPM, or 60 seconds have passed.
    // This stops continuous re-posting and eliminates ALL vibration during normal monitoring!
    if (!statusChanged && !flameChanged && ppmDifference < 30 && timeElapsed < 60000) {
      return;
    }

    lastGuardUpdateRef.current = now;
    lastGuardValuesRef.current = { maxPpm, anyFlame, statusText };

    const flameText = anyFlame ? '🔥 FLAME DETECTED' : 'Flame: Safe';
    const bodyText = `Core: ${n1Ppm} PPM | Living Room: ${n2Ppm} PPM | Sector 3: ${n3Ppm} PPM • ${flameText}`;

    Notifications.scheduleNotificationAsync({
      identifier: 'hfire-persistent-safety-guard',
      content: {
        title: `${statusText} • Live PPM: ${maxPpm}`,
        body: bodyText,
        priority: Notifications.AndroidNotificationPriority.LOW,
        sticky: true,
        autoDismiss: false,
        channelId: 'hfire-guard',
      } as any,
      trigger: null,
    }).catch(() => {});
  }, []);

  const enableGuard = useCallback(async () => {
    await AsyncStorage.setItem('HFIRE_BACKGROUND_GUARD_PREF', 'granted');
    setIsGuardEnabled(true);
    isGuardEnabledRef.current = true;
    setShowGuardPrompt(false);
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status === 'granted') {
        updatePersistentGuardNotification(0, false);
      }
    } catch (e) {}
  }, [updatePersistentGuardNotification]);

  const disableGuard = useCallback(async () => {
    await AsyncStorage.setItem('HFIRE_BACKGROUND_GUARD_PREF', 'denied');
    setIsGuardEnabled(false);
    isGuardEnabledRef.current = false;
    setShowGuardPrompt(false);
    try {
      await Notifications.dismissNotificationAsync('hfire-persistent-safety-guard');
    } catch (e) {}
  }, []);

  const dismissGuardPrompt = useCallback(async () => {
    await AsyncStorage.setItem('HFIRE_BACKGROUND_GUARD_PREF', 'denied');
    setIsGuardEnabled(false);
    isGuardEnabledRef.current = false;
    setShowGuardPrompt(false);
  }, []);

  const promptGuard = useCallback(() => {
    setShowGuardPrompt(true);
  }, []);

  const toggleAutoSms = useCallback(async (enabled: boolean) => {
    setAutoSmsEnabled(enabled);
    if (profileId) {
      try {
        await supabase.from('profiles').update({ auto_sms_enabled: enabled }).eq('id', profileId);
        await AsyncStorage.setItem(`HFIRE_AUTO_SMS_${profileId}`, String(enabled));
      } catch (err) {
        console.error('Failed to update auto_sms_enabled:', err);
      }
    }
  }, [profileId]);

  const triggerEmergency = useCallback((incident: Incident) => { 
    // If currently snoozed/silenced by user, ignore incoming hazard triggers
    if (Date.now() < silencedUntilRef.current) {
      return;
    }

    const isAlreadyActive = activeIncidentRef.current !== null;
    setActiveIncident(incident); 

    // Throttle Push Notifications: only send once every 30s per hazard event
    const now = Date.now();
    if (!isAlreadyActive || (now - lastNotificationTimeRef.current > 30000)) {
      lastNotificationTimeRef.current = now;

      Notifications.scheduleNotificationAsync({
        content: {
          title: `🔥 CRITICAL HAZARD: ${incident.alert_type || 'FIRE / GAS LEAK'}`,
          body: `EMERGENCY at ${incident.house_name || 'Home'} (${incident.label || 'Sensor Unit'})! Gas/Smoke level: ${incident.ppm || 0} PPM. Tap to open emergency siren & family contacts.`,
          sound: 'default',
          priority: Notifications.AndroidNotificationPriority.MAX,
          vibrate: [0, 500, 250, 500],
          channelId: 'emergency-alerts',
          data: {
            incidentId: incident.id,
            house_name: incident.house_name,
            label: incident.label,
            ppm: incident.ppm,
            alert_type: incident.alert_type,
            device_mac: incident.device_mac,
          },
        } as any,
        trigger: null,
      }).catch(() => {});
    }
  }, []);

  const dismissEmergency = useCallback(async () => { 
    const currentMac = activeIncidentRef.current?.device_mac;
    setActiveIncident(null); 
    // Silence/snooze re-triggering for 60s while sensors cool down
    silencedUntilRef.current = Date.now() + 60000;

    if (currentMac && isSupabaseConfigured) {
      try {
        await supabase
          .from('incidents')
          .update({
            status: 'Resolved',
            end_time: new Date().toISOString(),
            notes: 'Dismissed and cleared by Resident on mobile device'
          })
          .eq('device_mac', currentMac)
          .eq('status', 'Active');
      } catch (e) {}
    }
  }, []);

  const isMuted = (_mac: string) => false;

  // Supabase Realtime Subscriptions & Polling
  useEffect(() => {
    // Gentle fallback refresh (60 seconds instead of 4 seconds to protect Disk I/O)
    const interval = setInterval(() => {
      if (profileId) refreshProfile();
    }, 60000);

    const channel = supabase
      .channel('telemetry-feed')
      // 1. Supabase Realtime Broadcast: In-Memory WebSockets (Zero Disk I/O)
      .on('broadcast', { event: 'telemetry' }, ({ payload }: { payload: any }) => {
        if (!payload) return;
        const mac = String(payload.mac || '').toUpperCase().replace(/-/g, ':');
        const ppm = Number(payload.ppm ?? 0);
        const flame = Boolean(payload.flame);
        
        latestTelemetryMapRef.current[mac] = { ppm, flame, timestamp: Date.now() };

        setAllHeardDevices(prev => ({
          ...prev,
          [mac]: {
            id: mac,
            mac,
            ppm,
            flame,
            status: getStatusFromPPM(ppm, flame, true),
            label: payload.label || prev[mac]?.label || `Device ${mac.slice(-4)}`,
            houseId: payload.house_name || prev[mac]?.houseId || 'Home',
            lastSeen: new Date(payload.timestamp || Date.now()),
          }
        }));

        if (payload.N2_Gas !== undefined || payload.n2_gas !== undefined) {
          const n2Ppm = Number(payload.N2_Gas ?? payload.n2_gas ?? 0);
          const n2Flame = Boolean(Number(payload.N2_Fire ?? payload.n2_fire ?? 0) === 1 || payload.N2_Fire === true);
          const n2Status = n2Ppm > 1500 || n2Flame ? 'Danger' : (n2Ppm > 450 ? 'Warning' : 'Normal');
          setSecondaryNodes(prev => ({
            ...prev,
            N2: {
              ...prev.N2,
              ppm: n2Ppm,
              flame: n2Flame,
              status: n2Status,
              last_seen: payload.timestamp || new Date().toISOString(),
            }
          }));
        }

        if (payload.N3_Gas !== undefined || payload.n3_gas !== undefined) {
          const n3Ppm = Number(payload.N3_Gas ?? payload.n3_gas ?? 0);
          const n3Flame = Boolean(Number(payload.N3_Fire ?? payload.n3_fire ?? 0) === 1 || payload.N3_Fire === true);
          const n3Status = n3Ppm > 1500 || n3Flame ? 'Danger' : (n3Ppm > 450 ? 'Warning' : 'Normal');
          setSecondaryNodes(prev => ({
            ...prev,
            N3: {
              ...prev.N3,
              ppm: n3Ppm,
              flame: n3Flame,
              status: n3Status,
              last_seen: payload.timestamp || new Date().toISOString(),
            }
          }));
        }
      })
      .on('broadcast', { event: 'heartbeat' }, ({ payload }: { payload: any }) => {
        if (payload?.timestamp) {
          setBridgeHeartbeat(new Date(payload.timestamp));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, (payload: any) => {
        const updated = payload.new as any;
        if (updated?.key === 'bridge_heartbeat') {
          setBridgeHeartbeat(new Date(updated.value));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, (payload: any) => {
        const updated = payload.new as DeviceRecord;
        if (updated?.mac) {
          const normalized = updated.mac.toUpperCase();
          setRegistry(prev => ({ ...prev, [normalized]: { ...updated, mac: normalized } }));
          registryRef.current[normalized] = { ...updated, mac: normalized };
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents' }, (payload: any) => {
        if (payload.eventType === 'INSERT') {
          const newIncident = payload.new as IncidentRecord;
          if (newIncident.status === 'Active') {
            const mac = newIncident.device_mac?.toUpperCase();
            const dev = registryRef.current[mac || ''];
            
            const curProfile = profileIdRef.current;
            const isOwned = Boolean(curProfile && (newIncident.profile_id === curProfile || dev?.profile_id === curProfile));

            // Trigger emergency if owned by resident or user is admin
            if (isAdminRef.current || isOwned) {
              triggerEmergency({
                id: newIncident.id,
                house_name: dev?.house_name || userDetails?.name || 'My Household',
                label: dev?.label || 'Gas / Fire Alarm',
                ppm: newIncident.ppm_at_trigger || 0,
                alert_type: (newIncident.alert_type as any) || 'FIRE',
                device_mac: newIncident.device_mac,
                status: 'Active',
              });
            }
          }
        } else if (payload.eventType === 'UPDATE') {
          const updated = payload.new as IncidentRecord;
          // CRITICAL: When Admin resolves the incident, dismiss emergency modal automatically!
          if (updated.status === 'Resolved') {
            setActiveIncident(prev => {
              if (prev && String(prev.id) === String(updated.id)) {
                return null;
              }
              return prev;
            });
          }
        }
      })
      .subscribe();

    return () => { 
      clearInterval(interval);
      supabase.removeChannel(channel); 
    };
  }, [profileId, triggerEmergency, userDetails]);

  // Direct HiveMQ WebSocket Telemetry Listener (for 0ms live streaming)
  useEffect(() => {
    if (!HIVEMQ_URL) return;

    let client: any = null;
    try {
      client = mqtt.connect(HIVEMQ_URL, {
        username: process.env.EXPO_PUBLIC_HIVEMQ_USERNAME || 'RheinTigle',
        password: process.env.EXPO_PUBLIC_HIVEMQ_PASSWORD || '052105@Rhein',
        clientId: `hfire_res_live_${Math.random().toString(16).slice(2, 8)}`,
        clean: true,
        reconnectPeriod: 3000,
      });

      client.on('connect', () => {
        client.subscribe(['hfire/#', 'hfire/house1/data', 'hfire/house1/status', '#']);
      });

      const handleTelemetryReading = (mac: string, ppm: number, flame: boolean, houseId: string = 'Home') => {
        const normalizedMac = mac.toUpperCase();
        latestTelemetryMapRef.current[normalizedMac] = { ppm, flame, timestamp: Date.now() };

        setAllHeardDevices(prev => ({
          ...prev,
          [normalizedMac]: {
            id: normalizedMac, 
            mac: normalizedMac,
            ppm,
            flame,
            status: getStatusFromPPM(ppm, flame, true),
            label: prev[normalizedMac]?.label || `Device ${normalizedMac.slice(-4)}`,
            houseId,
            lastSeen: new Date()
          }
        }));
      };

      client.on('message', (receivedTopic: string, message: any) => {
        try {
          const raw = message.toString().trim();
          const parts = receivedTopic.split('/');
          const houseId = parts[1] || 'Home';

          // 1. JSON Payload
          if (raw.startsWith('{') || raw.startsWith('[')) {
            const data = JSON.parse(raw);

            // Multi-node key check (N1_Gas, N1_Fire, etc.)
            const hasNKeys = typeof data === 'object' && Object.keys(data).some(k => /^N\d+_Gas$/i.test(k));
            if (hasNKeys) {
              const coreMac = String(data.mac || data.core_mac || '20:50:0D:33:68:0C').toUpperCase();
              const n1Ppm = Number(data.N1_Gas ?? data.n1_gas ?? data.ppm ?? 0);
              const n1Flame = Boolean(Number(data.N1_Fire ?? data.n1_fire ?? 0) === 1 || data.flame === true || data.fire === 1);
              handleTelemetryReading(coreMac, n1Ppm, n1Flame, houseId);

              // Secondary Node 2 (N2)
              let n2Ppm = 0;
              let n2Flame = false;
              let n2Status: GasStatus = 'Normal';
              const n2GasKey = Object.keys(data).find(k => /^N2_Gas$/i.test(k));
              const n2FireKey = Object.keys(data).find(k => /^N2_Fire$/i.test(k));
              if (n2GasKey !== undefined || n2FireKey !== undefined) {
                n2Ppm = Number(data[n2GasKey || ''] ?? 0);
                n2Flame = Number(data[n2FireKey || ''] ?? 0) === 1;
                n2Status = (n2Ppm > 1500 || n2Flame ? 'Danger' : (n2Ppm > 450 ? 'Warning' : 'Normal')) as GasStatus;
                setSecondaryNodes(prev => ({
                  ...prev,
                  N2: {
                    ...prev.N2,
                    ppm: n2Ppm,
                    flame: n2Flame,
                    status: n2Status,
                    last_seen: new Date().toISOString(),
                  }
                }));
              }

              // Secondary Node 3 (N3)
              let n3Ppm = 0;
              let n3Flame = false;
              let n3Status: GasStatus = 'Normal';
              const n3GasKey = Object.keys(data).find(k => /^N3_Gas$/i.test(k));
              const n3FireKey = Object.keys(data).find(k => /^N3_Fire$/i.test(k));
              if (n3GasKey !== undefined || n3FireKey !== undefined) {
                n3Ppm = Number(data[n3GasKey || ''] ?? 0);
                n3Flame = Number(data[n3FireKey || ''] ?? 0) === 1;
                n3Status = (n3Ppm > 1500 || n3Flame ? 'Danger' : (n3Ppm > 450 ? 'Warning' : 'Normal')) as GasStatus;
                setSecondaryNodes(prev => ({
                  ...prev,
                  N3: {
                    ...prev.N3,
                    ppm: n3Ppm,
                    flame: n3Flame,
                    status: n3Status,
                    last_seen: new Date().toISOString(),
                  }
                }));
              }

              // Auto-reset silence buffer when all nodes return to safe
              const allSafe = (n1Ppm <= 450 && !n1Flame) && 
                              (n2Ppm <= 450 && !n2Flame) && 
                              (n3Ppm <= 450 && !n3Flame);
              if (allSafe) {
                silencedUntilRef.current = 0;
              }

              // Device Ownership / Relevance Check:
              // Only alert and persist logs if user owns this device, or if user is admin!
              const curProfile = profileIdRef.current;
              const isRelevant = isAdminRef.current || Boolean(curProfile && registryRef.current[coreMac]?.profile_id === curProfile);

              if (isRelevant) {
                // Record hazards for any node with accurate sector attribution
                if (n1Ppm > 450 || n1Flame) {
                  recordHazardToSupabase(coreMac, n1Ppm, n1Flame, 'Core Node 1 (Main Sensor)');
                }
                if (n2Ppm > 450 || n2Flame) {
                  recordHazardToSupabase(coreMac, n2Ppm, n2Flame, 'Secondary Node 2 (Living Room)');
                }
                if (n3Ppm > 450 || n3Flame) {
                  recordHazardToSupabase(coreMac, n3Ppm, n3Flame, 'Secondary Node 3 (Sector 3 / Ext)');
                }

                const houseNameStr = registryRef.current[coreMac]?.house_name || userDetails?.name || 'My Household';

                // Interconnected Alarms: Trigger Emergency on Core OR Secondary Nodes
                if (n1Ppm > 1500 || n1Flame) {
                  triggerEmergency({
                    id: `live_n1_${Date.now()}`,
                    house_name: houseNameStr,
                    label: 'Core Node 1 (Main Sensor)',
                    ppm: n1Ppm,
                    alert_type: n1Flame ? 'FIRE' : 'GAS / SMOKE LEAK',
                    device_mac: coreMac,
                    status: 'Active',
                  });
                } else if (n2Ppm > 1500 || n2Flame) {
                  triggerEmergency({
                    id: `live_n2_${Date.now()}`,
                    house_name: houseNameStr,
                    label: 'Secondary Node 2 (Living Room)',
                    ppm: n2Ppm,
                    alert_type: n2Flame ? 'FIRE' : 'GAS / SMOKE LEAK',
                    device_mac: coreMac,
                    status: 'Active',
                  });
                } else if (n3Ppm > 1500 || n3Flame) {
                  triggerEmergency({
                    id: `live_n3_${Date.now()}`,
                    house_name: houseNameStr,
                    label: 'Secondary Node 3 (Sector 3 / Ext)',
                    ppm: n3Ppm,
                    alert_type: n3Flame ? 'FIRE' : 'GAS / SMOKE LEAK',
                    device_mac: coreMac,
                    status: 'Active',
                  });
                }

                // Live Dynamic 24/7 Foreground Notification Status update
                updatePersistentGuardNotification(n1Ppm, n1Flame, n2Ppm, n2Flame, n3Ppm, n3Flame);
              }

              return;
            }

            // Single Node Object
            if (!Array.isArray(data)) {
              let mac = String(data.mac || data.device_mac || data.core_mac || '20:50:0D:33:68:0C').toUpperCase();
              const ppm = Number(data.ppm ?? data.ppm_level ?? data.gas ?? data.smoke ?? data.reading ?? 0);
              const flame = Boolean(data.flame ?? (data.fire === 1 || data.flameDetected === true));
              handleTelemetryReading(mac, ppm, flame, houseId);

              const curProfile = profileIdRef.current;
              const isRelevant = isAdminRef.current || Boolean(curProfile && registryRef.current[mac]?.profile_id === curProfile);

              if (isRelevant) {
                // Live Dynamic 24/7 Foreground Notification Status update
                updatePersistentGuardNotification(ppm, flame);

                if (ppm <= 450 && !flame) {
                  silencedUntilRef.current = 0;
                }

                if (ppm > 450 || flame) {
                  recordHazardToSupabase(mac, ppm, flame);
                }

                if (ppm > 1500 || flame) {
                  triggerEmergency({
                    id: `live_${Date.now()}`,
                    house_name: registryRef.current[mac]?.house_name || userDetails?.name || 'My Household',
                    label: registryRef.current[mac]?.label || 'Gas & Flame Sensor',
                    ppm: ppm,
                    alert_type: flame ? 'FIRE' : 'GAS / SMOKE LEAK',
                    device_mac: mac,
                    status: 'Active',
                  });
                }
              }
              return;
            }

            // Array of nodes
            if (Array.isArray(data)) {
              data.forEach((item: any) => {
                if (item && typeof item === 'object') {
                  const mac = item.mac || '20:50:0D:33:68:0C';
                  const ppm = Number(item.ppm ?? item.ppm_level ?? 0);
                  const flame = Boolean(item.flame);
                  handleTelemetryReading(mac, ppm, flame, houseId);
                }
              });
            }
            return;
          }

          // 2. CSV Fallback: MAC,PPM,FLAME
          const csvParts = raw.split(',');
          if (csvParts.length >= 2) {
            const mac = csvParts[0].trim();
            const ppm = Number(csvParts[1].trim());
            const flame = csvParts[2] ? (csvParts[2].trim() === '1' || csvParts[2].trim() === 'true') : false;
            handleTelemetryReading(mac, ppm, flame, houseId);
          }
        } catch (e) {
          // Ignore invalid packet
        }
      });
    } catch (err) {
      console.warn('[UserContext] MQTT Direct Connect:', err);
    }

    return () => {
      if (client) {
        try { client.end(); } catch {}
      }
    };
  }, []);

  const setUserDetails = async (details: UserDetails) => {
    setUserDetailsState(details);
    setIsAdmin(Boolean(details.is_admin));
    await AsyncStorage.setItem('HFIRE_USER_DETAILS', JSON.stringify(details));
  };

  return (
    <UserContext.Provider value={{ 
      userDetails, 
      setUserDetails, 
      profileId, 
      isAdmin, 
      refreshProfile, 
      loading,
      activeIncident, 
      triggerEmergency, 
      dismissEmergency, 
      isMuted, 
      devices,
      allHeardDevices, 
      secondaryNodes,
      systemStatus,
      isAuthenticated, 
      signOut, 
      updateProfile,
      claimDevice,
      unlinkDevice,
      renameDevice,
      isGuardEnabled,
      showGuardPrompt,
      enableGuard,
      disableGuard,
      promptGuard,
      dismissGuardPrompt,
      autoSmsEnabled,
      toggleAutoSms
    }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) throw new Error('useUser must be used within a UserProvider');
  return context;
}
