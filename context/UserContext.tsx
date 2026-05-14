import React, { createContext, useContext, useEffect, useState, useRef, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import mqtt from 'mqtt';
import { supabase } from '@/utils/supabase';

interface UserDetails {
  name: string; 
  email?: string;
  block_lot: string; 
  address?: string; 
  latitude?: number; 
  longitude?: number; 
  is_admin?: boolean;
}

interface Incident {
  id: string | number; house_name: string; label: string; ppm: number; alert_type: 'FIRE' | 'GAS/SMOKE' | 'SMOKE' | 'FLAME' | 'MODERATE SMOKE'; device_mac?: string;
}

export interface Device {
  id: string; mac: string; ppm: number; status: string; label: string; houseId: string; block_lot?: string; lastSeen: Date; profile_id?: string | null;
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
  systemStatus: 'Online' | 'Offline';
  signOut: () => Promise<void>;
  updateProfile: (details: UserDetails) => Promise<{ error: any }>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);
const HIVEMQ_URL = `wss://${process.env.EXPO_PUBLIC_HIVEMQ_BROKER}:${process.env.EXPO_PUBLIC_HIVEMQ_PORT}/mqtt`;

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [userDetails, setUserDetailsState] = useState<UserDetails | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bridgeHeartbeat, setBridgeHeartbeat] = useState<Date | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  
  const [activeIncident, setActiveIncident] = useState<Incident | null>(null);
  const [allHeardDevices, setAllHeardDevices] = useState<Record<string, Device>>({});

  const systemStatus = useMemo(() => {
    if (!bridgeHeartbeat) return 'Offline';
    const secondsSinceLastPing = (Date.now() - bridgeHeartbeat.getTime()) / 1000;
    return secondsSinceLastPing < 90 ? 'Online' : 'Offline';
  }, [bridgeHeartbeat]);

  const [registry, setRegistry] = useState<Record<string, any>>({});
  const registryRef = useRef<Record<string, any>>({});

  useEffect(() => {
    // Initial session check
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        console.log('[UserContext] Initial session found');
        setIsAuthenticated(true);
        setProfileId(session.user.id);
        refreshProfile(session.user.id);
      } else {
        console.log('[UserContext] No initial session');
        setIsAuthenticated(false);
        setProfileId(null);
        setLoading(false);
      }
    });

    // Auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[UserContext] Auth event:', event);
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

  const devices = useMemo(() => {
    const mine: Record<string, Device> = {};
    if (!profileId) return mine;

    // Start with all devices registered to this user in Supabase
    Object.values(registry).forEach(regInfo => {
      if (regInfo.profile_id === profileId) {
        const normalizedMac = regInfo.mac.toUpperCase();
        const liveData = allHeardDevices[normalizedMac];
        
        mine[normalizedMac] = {
          id: normalizedMac,
          mac: normalizedMac,
          ppm: liveData ? liveData.ppm : 0,
          status: liveData ? liveData.status : 'Offline',
          label: regInfo.label || `Device ${normalizedMac.slice(-4)}`,
          houseId: regInfo.house_name,
          block_lot: regInfo.block_lot,
          lastSeen: liveData ? liveData.lastSeen : (regInfo.last_seen ? new Date(regInfo.last_seen) : new Date(0)),
          profile_id: regInfo.profile_id
        };
      }
    });
    return mine;
  }, [allHeardDevices, registry, profileId]);

  const refreshProfile = async (uid?: string) => {
    const targetId = uid || profileId;
    if (!targetId) { 
      setLoading(false); 
      return; 
    }

    console.log('[UserContext] Refreshing profile for:', targetId);
    // Use loading only for initial load, not for every refresh to avoid UI freeze
    if (!userDetails) setLoading(true);
    
    try {
      const { data: dbProfile, error: profileErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', targetId)
        .maybeSingle();
      
      if (profileErr) console.error('[UserContext] Profile error:', profileErr.message);

      if (dbProfile) {
        console.log('[UserContext] Profile loaded:', dbProfile.name);
        setUserDetailsState({ 
          name: dbProfile.name, 
          email: dbProfile.email,
          block_lot: dbProfile.block_lot, 
          address: dbProfile.address,
          latitude: dbProfile.latitude, 
          longitude: dbProfile.longitude,
          is_admin: dbProfile.is_admin
        });
        setIsAdmin(!!dbProfile.is_admin);
      } else {
        console.log('[UserContext] No profile record found.');
        setUserDetailsState(null);
        setIsAdmin(false);
      }
    } catch (e: any) { 
      console.error('[UserContext] Refresh exception:', e); 
    } finally {
      console.log('[UserContext] Profile refresh complete.');
      setLoading(false);
    }

    // Secondary non-blocking data
    supabase.from('app_settings').select('value').eq('key', 'bridge_heartbeat').maybeSingle()
      .then(({ data: hb }) => hb && setBridgeHeartbeat(new Date(hb.value)));
    
    supabase.from('devices').select('*').then(({ data: reg }) => {
      if (reg) {
        const cache: any = {};
        reg.forEach(d => { cache[d.mac] = d; });
        setRegistry(cache);
        registryRef.current = cache;
      }
    });
  };

  const signOut = async () => {
    setLoading(true);
    try { 
      await supabase.auth.signOut();
    } catch (e) {}
    setProfileId(null);
    setUserDetailsState(null);
    setIsAdmin(false);
    setLoading(false);
  };

  const updateProfile = async (details: UserDetails) => {
    if (!profileId) return { error: new Error('Not authenticated') };

    // Use provided email, or current user email from auth, or existing state
    let finalEmail = details.email;
    if (!finalEmail) {
      const { data: { user } } = await supabase.auth.getUser();
      finalEmail = user?.email || userDetails?.email;
    }

    const { error } = await supabase.from('profiles').upsert({
      id: profileId,
      name: details.name,
      email: finalEmail,
      block_lot: details.block_lot, 
      address: details.address,
      latitude: details.latitude,
      longitude: details.longitude,
      is_admin: details.is_admin || false,
      updated_at: new Date().toISOString()
    });

    if (!error) {
      const updatedDetails = { ...details, email: finalEmail };
      setUserDetailsState(updatedDetails);
      setIsAdmin(!!details.is_admin);
      await AsyncStorage.setItem('HFIRE_USER_DETAILS', JSON.stringify(updatedDetails));
    }
    return { error };
  };

  // MQTT & Listeners logic...
  useEffect(() => {
    const channel = supabase
      .channel('system-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, (payload) => {
        const updated = payload.new as any;
        if (updated && updated.key === 'bridge_heartbeat') {
          setBridgeHeartbeat(new Date(updated.value));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, (payload) => {
        const updated = payload.new as any;
        if (updated) {
          setRegistry(prev => {
            const next = { ...prev, [updated.mac]: updated };
            registryRef.current = next;
            return next;
          });
        }
      })
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!profileId) return;
    const client = mqtt.connect(HIVEMQ_URL, {
      protocol: 'wss', path: '/mqtt',
      username: process.env.EXPO_PUBLIC_HIVEMQ_USERNAME,
      password: process.env.EXPO_PUBLIC_HIVEMQ_PASSWORD,
      clientId: `hfire_app_${profileId}_${Math.random().toString(16).slice(2, 5)}`,
      reconnectPeriod: 5000,
    });
    client.on('connect', () => client.subscribe('hfire/#'));
    client.on('message', (receivedTopic, message) => {
      try {
        const payload = message.toString();
        const parts = receivedTopic.split('/');
        const houseId = parts[1] || 'Unknown';
        const type = parts[2]; // data, status, etc.

        let data: any = null;

        // 1. Try JSON
        if (payload.startsWith('{')) {
          try { data = JSON.parse(payload); } catch (e) {}
        } 
        
        // 2. Try CSV Fallback (MAC,PPM,FLAME)
        if (!data) {
          const csvParts = payload.split(',');
          if (csvParts.length >= 2) {
            data = {
              mac: csvParts[0].trim(),
              ppm: Number(csvParts[1].trim()),
              flame: csvParts[2] ? (csvParts[2].trim() === '1' || csvParts[2].trim() === 'true') : false
            };
          }
        }

        // 3. Try Raw Number Fallback (hfire/houseId/data)
        if (!data && type === 'data') {
          const rawPpm = parseInt(payload, 10);
          if (!isNaN(rawPpm)) {
            data = { mac: null, ppm: rawPpm };
          }
        }

        if (!data) return;

        // Determine MAC (use houseId as fallback for legacy/raw signals)
        const mac = (data.mac || houseId).toUpperCase();
        
        setAllHeardDevices(prev => ({
          ...prev,
          [mac]: {
            id: mac, 
            mac: mac,
            ppm: data.ppm !== undefined ? data.ppm : (prev[mac]?.ppm || 0),
            status: data.ppm > 1500 ? 'Danger' : (data.ppm > 450 || data.flame ? 'Warning' : 'Normal'),
            label: `Device ${mac.slice(-4)}`,
            houseId: houseId,
            lastSeen: new Date()
          }
        }));
      } catch (e) {
        console.error('MQTT direct parse error:', e);
      }
    });
    return () => { client.end(); };
  }, [profileId]);

  const setUserDetails = async (details: UserDetails) => {
    setUserDetailsState(details);
    setIsAdmin(!!details.is_admin);
    await AsyncStorage.setItem('HFIRE_USER_DETAILS', JSON.stringify(details));
  };

  const triggerEmergency = (incident: Incident) => { setActiveIncident(incident); };
  const dismissEmergency = () => { setActiveIncident(null); };
  const isMuted = (mac: string) => false;

  return (
    <UserContext.Provider value={{ 
      userDetails, setUserDetails, profileId, isAdmin, refreshProfile, loading,
      activeIncident, triggerEmergency, dismissEmergency, isMuted, devices,
      allHeardDevices, systemStatus,
      isAuthenticated, signOut, updateProfile
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
