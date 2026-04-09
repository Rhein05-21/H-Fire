import React, { createContext, useContext, useEffect, useState, useRef, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import mqtt from 'mqtt';
import { supabase } from '@/utils/supabase';
import { useAuth, useUser as useClerkUser, useSignIn, useSignUp } from '@clerk/clerk-expo';

interface UserDetails {
  name: string; 
  block_lot: string; // Changed from community
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
  const { isLoaded, userId, sessionId, signOut: clerkSignOut } = useAuth();
  
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
    if (isLoaded) {
      if (userId) {
        setProfileId(userId);
        refreshProfile(userId);
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
    Object.values(allHeardDevices).forEach(dev => {
      const regInfo = registry[dev.mac];
      if (regInfo && regInfo.profile_id === profileId) {
        mine[dev.mac] = { ...dev, label: regInfo.label, houseId: regInfo.house_name, block_lot: regInfo.block_lot };
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
          block_lot: dbProfile.block_lot, // Map to new field
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
        reg.forEach(d => { cache[d.mac] = d; });
        setRegistry(cache);
        registryRef.current = cache;
      }
    } catch (e: any) { console.error(e); }
    finally { setLoading(false); }
  };

  const signOut = async () => {
    setLoading(true);
    try { await clerkSignOut(); } catch (e) {}
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
      block_lot: details.block_lot, // Use new column name
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
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_settings', filter: 'key=eq.bridge_heartbeat' }, (payload) => {
        setBridgeHeartbeat(new Date(payload.new.value));
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
        const data = JSON.parse(message.toString());
        const mac = data.mac;
        if (!mac) return;
        setAllHeardDevices(prev => ({
          ...prev,
          [mac]: {
            id: mac, mac,
            ppm: data.ppm || 0,
            status: data.status || 'Normal',
            label: `Device ${mac.slice(-4)}`,
            houseId: receivedTopic.split('/')[1],
            lastSeen: new Date()
          }
        }));
      } catch (e) {}
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
