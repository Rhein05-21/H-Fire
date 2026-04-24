import React, { createContext, useContext, useEffect, useState, useRef, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import mqtt from 'mqtt';
import { supabase } from '@/utils/supabase';
import { useAuth, useUser as useClerkUser, useSignIn, useSignUp } from '@clerk/clerk-expo';

interface UserDetails {
  name: string; 
  block_lot: string; // Reverted to block_lot
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
  const { isLoaded, userId, sessionId, getToken, signOut: clerkSignOut } = useAuth();
  
  const [userDetails, setUserDetailsState] = useState<UserDetails | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bridgeHeartbeat, setBridgeHeartbeat] = useState<Date | null>(null);
  
  const [activeIncident, setActiveIncident] = useState<Incident | null>(null);
  const [allHeardDevices, setAllHeardDevices] = useState<Record<string, Device>>({});

  const systemStatus = useMemo(() => {
    if (!bridgeHeartbeat) return 'Offline';
    const secondsSinceLastPing = (Date.now() - bridgeHeartbeat.getTime()) / 1000;
    return secondsSinceLastPing < 90 ? 'Online' : 'Offline';
  }, [bridgeHeartbeat]);

  const isAuthenticated = !!userId;

  const [registry, setRegistry] = useState<Record<string, any>>({});
  const registryRef = useRef<Record<string, any>>({});

  useEffect(() => {
    const syncAuth = async () => {
      if (userId) {
        try {
          const token = await getToken({ template: 'supabase' });
          if (token) {
            await supabase.auth.setSession({
              access_token: token,
              refresh_token: '',
            });
          }
        } catch (e) {
          console.error('Error syncing Clerk with Supabase:', e);
        }
      }
    };

    if (isLoaded) {
      if (userId) {
        setProfileId(userId);
        syncAuth().then(() => refreshProfile(userId));
      } else {
        setProfileId(null);
        setUserDetailsState(null);
        setIsAdmin(false);
        setLoading(false);
      }
    }
  }, [isLoaded, userId]);

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
    if (!targetId) { setLoading(false); return; }

    setLoading(true);
    try {
      const { data: dbProfile, error: profileErr } = await supabase.from('profiles').select('*').eq('id', targetId).single();
      
      if (dbProfile) {
        const profileData: UserDetails = { 
          name: dbProfile.name, 
          block_lot: dbProfile.block_lot, 
          address: dbProfile.address,
          latitude: dbProfile.latitude, 
          longitude: dbProfile.longitude,
          is_admin: dbProfile.is_admin
        };
        setUserDetailsState(profileData);
        setIsAdmin(!!dbProfile.is_admin);
      } else {
        setUserDetailsState(null);
        setIsAdmin(false);
      }

      const { data: hb } = await supabase.from('app_settings').select('value').eq('key', 'bridge_heartbeat').single();
      if (hb) setBridgeHeartbeat(new Date(hb.value));

      const { data: reg } = await supabase.from('devices').select('*');
      if (reg) {
        const cache: any = {};
        reg.forEach(d => { cache[d.mac] = d; }); // Store by original key
        setRegistry(cache);
        registryRef.current = cache;
      }
    } catch (e: any) { console.error(e); }
    finally { setLoading(false); }
  };

  const signOut = async () => {
    setLoading(true);
    try { 
      await clerkSignOut(); 
      await supabase.auth.signOut();
    } catch (e) {}
    setProfileId(null);
    setUserDetailsState(null);
    setIsAdmin(false);
    setLoading(false);
  };

  const updateProfile = async (details: UserDetails) => {
    if (!profileId) return { error: new Error('Not authenticated') };
    
    const { error } = await supabase.from('profiles').upsert({
      id: profileId,
      name: details.name,
      block_lot: details.block_lot, 
      address: details.address,
      latitude: details.latitude,
      longitude: details.longitude,
      is_admin: details.is_admin || false,
      updated_at: new Date().toISOString()
    });

    if (!error) {
      setUserDetailsState(details);
      setIsAdmin(!!details.is_admin);
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
