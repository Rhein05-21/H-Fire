import React, { createContext, useContext, useEffect, useState, useRef, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import mqtt from 'mqtt';
import { supabase } from '@/utils/supabase';

interface UserDetails {
  name: string; community: string; latitude?: number; longitude?: number; is_admin?: boolean;
}

interface Incident {
  id: string | number; house_name: string; label: string; ppm: number; alert_type: 'FIRE' | 'GAS/SMOKE'; device_mac?: string;
}

export interface Device {
  id: string; mac: string; ppm: number; status: string; label: string; houseId: string; community?: string; lastSeen: Date; profile_id?: string | null;
}

interface UserContextType {
  userDetails: UserDetails | null;
  setUserDetails: (details: UserDetails) => void;
  profileId: string | null;
  isAdmin: boolean;
  refreshProfile: () => Promise<void>;
  loading: boolean;
  activeIncident: Incident | null;
  triggerEmergency: (incident: Incident) => void;
  dismissEmergency: () => void;
  isMuted: (mac: string) => boolean;
  devices: Record<string, Device>;
  allHeardDevices: Record<string, Device>;
  systemStatus: 'Online' | 'Offline';
}

const UserContext = createContext<UserContextType | undefined>(undefined);
const HIVEMQ_URL = `wss://${process.env.EXPO_PUBLIC_HIVEMQ_BROKER}:${process.env.EXPO_PUBLIC_HIVEMQ_PORT}/mqtt`;

export function UserProvider({ children }: { children: React.ReactNode }) {
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

  const mutedDevices = useRef<Record<string, number>>({});
  const lastLoggedTime = useRef<Record<string, number>>({});
  const [registry, setRegistry] = useState<Record<string, any>>({});
  const registryRef = useRef<Record<string, any>>({});

  // Live filtered view for Resident
  const devices = useMemo(() => {
    const mine: Record<string, Device> = {};
    Object.values(allHeardDevices).forEach(dev => {
      const regInfo = registry[dev.mac];
      if (regInfo && regInfo.profile_id === profileId) {
        mine[dev.mac] = { ...dev, label: regInfo.label, houseId: regInfo.house_name, community: regInfo.community };
      }
    });
    return mine;
  }, [allHeardDevices, registry, profileId]);

  const refreshProfile = async () => {
    try {
      let currentId = await AsyncStorage.getItem('HFIRE_PROFILE_ID');
      if (!currentId) {
        currentId = `user_${Math.random().toString(36).slice(2, 11)}`;
        await AsyncStorage.setItem('HFIRE_PROFILE_ID', currentId);
      }
      setProfileId(currentId);

      const { data: dbProfile } = await supabase.from('profiles').select('*').eq('id', currentId).single();
      if (dbProfile) {
        const profileData = { 
          name: dbProfile.name, community: dbProfile.community,
          latitude: dbProfile.latitude, longitude: dbProfile.longitude,
          is_admin: dbProfile.is_admin
        };
        setUserDetailsState(profileData);
        setIsAdmin(!!dbProfile.is_admin);
      }

      // Initial Heartbeat Fetch
      const { data: hb } = await supabase.from('app_settings').select('value').eq('key', 'bridge_heartbeat').single();
      if (hb) setBridgeHeartbeat(new Date(hb.value));

      // Initial Registry Fetch
      const { data: reg } = await supabase.from('devices').select('*');
      if (reg) {
        const cache: any = {};
        reg.forEach(d => { cache[d.mac] = d; });
        setRegistry(cache);
        registryRef.current = cache;
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  // Realtime System Health & Registry Sync
  useEffect(() => {
    const channel = supabase
      .channel('system-sync')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_settings', filter: 'key=eq.bridge_heartbeat' }, (payload) => {
        setBridgeHeartbeat(new Date(payload.new.value));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, (payload) => {
        const updated = payload.new as any;
        if (updated) {
          console.log('Registry Update:', updated.mac, 'linked to', updated.profile_id);
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

  // Stable MQTT Connection
  useEffect(() => {
    if (!profileId) return;
    
    let client: mqtt.MqttClient | null = null;
    const topic = 'hfire/#';

    client = mqtt.connect(HIVEMQ_URL, {
      protocol: 'wss', path: '/mqtt',
      username: process.env.EXPO_PUBLIC_HIVEMQ_USERNAME,
      password: process.env.EXPO_PUBLIC_HIVEMQ_PASSWORD,
      clientId: `hfire_app_${profileId}_${Math.random().toString(16).slice(2, 5)}`,
      reconnectPeriod: 5000,
    });

    client.on('connect', () => client?.subscribe(topic));

    client.on('message', (receivedTopic, message) => {
      try {
        const payload = message.toString();
        if (!payload.startsWith('{')) return;

        const data = JSON.parse(payload);
        const mac = data.mac;
        if (!mac || !mac.includes(':')) return;

        const parts = receivedTopic.split('/');
        const houseIdFromTopic = parts[1];

        setAllHeardDevices(prev => {
          const updated: Device = {
            id: mac, mac: mac,
            ppm: data.ppm !== undefined ? parseInt(data.ppm) : 0,
            status: (data.status === 'SAFE') ? 'Normal' : (data.status || 'Normal'),
            label: `Device ${mac.slice(-4)}`,
            houseId: houseIdFromTopic,
            lastSeen: new Date()
          };

          // Check ownership via the REF (to avoid rebooting client)
          const regInfo = registryRef.current[mac];
          const isMine = regInfo && regInfo.profile_id === profileId;
          
          // --- 🔥 APP-SIDE RECORDING LOGIC ---
          // If it's my device, or I am an Admin, record the log to Supabase
          if (isMine || isAdmin) {
            const now = Date.now();
            const lastLog = lastLoggedTime.current[mac] || 0;
            const targetProfile = regInfo?.profile_id || profileId;

            // Record every 1 minute OR if PPM is high (> 450)
            if (now - lastLog > 60000 || (updated.ppm > 450 && now - lastLog > 10000)) {
              lastLoggedTime.current[mac] = now;
              const status = (updated.ppm > 1500) ? 'Danger' : (updated.ppm > 450 ? 'Warning' : 'Normal');
              
              supabase.from('gas_logs').insert([{ 
                device_mac: mac, ppm_level: updated.ppm, status, profile_id: targetProfile 
              }]).then(({ error }) => { if (error) console.error('Log error:', error.message); });

              if (status !== 'Normal') {
                supabase.from('incidents').insert([{
                  device_mac: mac, status: 'Active', ppm_at_trigger: updated.ppm,
                  alert_type: (status === 'Danger') ? 'FIRE' : 'GAS/SMOKE',
                  profile_id: targetProfile
                }]);
              }
            }
          }
          // -----------------------------------

          if ((isAdmin || isMine) && updated.ppm > 450) {
            const muteTime = mutedDevices.current[mac] || 0;
            if (Date.now() - muteTime > 120000) {
              setActiveIncident({
                id: `mqtt_${Date.now()}`,
                house_name: regInfo?.house_name || updated.houseId,
                label: regInfo?.label || updated.label,
                ppm: updated.ppm,
                alert_type: updated.ppm > 1500 ? 'FIRE' : 'GAS/SMOKE',
                device_mac: mac
              });
            }
          }

          return { ...prev, [mac]: updated };
        });
      } catch (e) {}
    });

    return () => { if (client) client.end(); };
  }, [profileId, isAdmin]); // Only re-connect if profile/role changes

  useEffect(() => { refreshProfile(); }, []);

  const setUserDetails = async (details: UserDetails) => {
    setUserDetailsState(details);
    setIsAdmin(!!details.is_admin);
    await AsyncStorage.setItem('HFIRE_USER_DETAILS', JSON.stringify(details));
  };

  const triggerEmergency = (incident: Incident) => {
    const mac = incident.device_mac || 'unknown';
    const muteTime = mutedDevices.current[mac] || 0;
    if (Date.now() - muteTime < 120000) return;
    setActiveIncident(incident);
  };

  const dismissEmergency = () => {
    if (activeIncident && activeIncident.device_mac) {
      mutedDevices.current[activeIncident.device_mac] = Date.now();
    }
    setActiveIncident(null);
  };

  const isMuted = (mac: string) => {
    const muteTime = mutedDevices.current[mac] || 0;
    return (Date.now() - muteTime < 120000);
  };

  return (
    <UserContext.Provider value={{ 
      userDetails, setUserDetails, profileId, isAdmin, refreshProfile, loading,
      activeIncident, triggerEmergency, dismissEmergency, isMuted, devices,
      allHeardDevices, systemStatus
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
