import React, { useEffect, useState, useRef, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, Modal, FlatList, ActivityIndicator, Dimensions, RefreshControl } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import mqtt from 'mqtt';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '@/utils/supabase';
import { getStatusColor } from '@/constants/thresholds';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useAppTheme, ThemeType } from '@/context/ThemeContext';
import { useUser } from '@/context/UserContext';

const HIVEMQ_URL = `wss://${process.env.EXPO_PUBLIC_HIVEMQ_BROKER}:${process.env.EXPO_PUBLIC_HIVEMQ_PORT}/mqtt`;
const { width } = Dimensions.get('window');

interface Device {
  id: string;
  mac: string;
  ppm: number;
  status: string;
  label: string;
  houseId: string;
  lastSeen: Date;
}

export default function GasDashboard() {
  const [devices, setDevices] = useState<Record<string, Device>>({});
  const { theme, setTheme } = useAppTheme();
  const { userDetails, profileId, loading: userLoading } = useUser();
  
  // Theme Colors
  const containerBg = useThemeColor({}, 'background');
  const headerBg = useThemeColor({}, 'background');
  const textColor = useThemeColor({}, 'text');
  const cardBg = useThemeColor({ light: '#fff', dark: '#1e1e1e' }, 'background');
  const shadowColor = useThemeColor({ light: '#000', dark: '#000' }, 'text');
  const inputBg = useThemeColor({ light: '#f8f9fa', dark: '#2a2a2a' }, 'background');
  const secondaryText = useThemeColor({ light: '#666', dark: '#aaa' }, 'text');
  const borderColor = useThemeColor({ light: '#eee', dark: '#333' }, 'background');

  const [labels, setLabels] = useState<Record<string, string>>({});
  const [mqttConnectionState, setMqttConnectionState] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [internetConnected, setInternetConnected] = useState<boolean | null>(null);
  const [supabaseConnected, setSupabaseConnected] = useState<boolean | null>(null);
  const [hasAttemptedLoad, setHasAttemptedLoad] = useState(false);
  
  const [editingMac, setEditingMac] = useState<string | null>(null);
  const [tempLabel, setTempLabel] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [setupName, setSetupName] = useState('');
  const [setupCommunity, setSetupCommunity] = useState('');

  const labelsRef = useRef<Record<string, string>>({});
  const lastSavedLogs = useRef<Record<string, number>>({}); // { mac_status: timestamp }

  useEffect(() => {
    labelsRef.current = labels;
  }, [labels]);

  const saveLog = async (mac: string, ppm: number, status: string) => {
    try {
      // Prevent spamming logs for the same state on the same device
      const now = Date.now();
      const logKey = `${mac}_${status}`;
      const lastSaveTime = lastSavedLogs.current[logKey] || 0;
      
      // Only save if it's a new state or at least 2 minutes have passed
      if (now - lastSaveTime < 120000) return;

      const { error } = await supabase.from('gas_logs').insert([
        { 
          device_mac: mac || 'Unknown', 
          ppm_level: ppm, 
          status: status,
          created_at: new Date().toISOString()
        }
      ]);

      if (!error) {
        lastSavedLogs.current[logKey] = now;
      }
    } catch (err) {
      console.error('Error auto-saving log:', err);
    }
  };

  useEffect(() => {
    if (!userLoading && !userDetails) {
      setShowOnboarding(true);
    } else {
      setShowOnboarding(false);
    }
  }, [userDetails, userLoading]);

  // NetInfo Listener
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setInternetConnected(state.isConnected);
    });
    return () => unsubscribe();
  }, []);

  // Supabase Connection Heartbeat
  const checkSupabase = async () => {
    try {
      const { error } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).limit(1);
      setSupabaseConnected(!error);
    } catch (err) {
      setSupabaseConnected(false);
    }
  };

  useEffect(() => {
    checkSupabase();
    const interval = setInterval(checkSupabase, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      // Load Device Labels
      const stored = await AsyncStorage.getItem('HFIRE_DEVICE_LABELS');
      const loadedLabels = stored ? JSON.parse(stored) : {};
      setLabels(loadedLabels);

      // Fetch History to get latest device states
      const { data } = await supabase
        .from('gas_logs')
        .select('*')
        .order('created_at', { ascending: false });

      if (data) {
        const latestDevices: Record<string, Device> = {};
        data.forEach(log => {
          const deviceId = log.device_mac && log.device_mac !== 'Unknown' && log.device_mac !== 'null' 
            ? log.device_mac 
            : `house_${log.id}`; // Fallback if MAC is missing

          if (!latestDevices[deviceId]) {
            latestDevices[deviceId] = {
              id: deviceId,
              mac: log.device_mac || '...',
              ppm: log.ppm_level,
              status: log.status,
              label: loadedLabels[deviceId] || 'New Device',
              houseId: deviceId,
              lastSeen: new Date(log.created_at)
            };
          }
        });
        setDevices(latestDevices);
      }
      setHasAttemptedLoad(true);
    } catch (err) {
      console.error('Init Error:', err);
      setSupabaseConnected(false);
      setHasAttemptedLoad(true);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    await checkSupabase();
    setRefreshing(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  // 1. Initial Load
  useEffect(() => {
    loadData();
  }, []);

  // 2. SUPABASE REALTIME FALLBACK (Aggressive)
  useEffect(() => {
    const channel = supabase
      .channel('gas-updates')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'gas_logs' },
        (payload) => {
          const newLog = payload.new;
          console.log('Realtime (Supabase): Received log for', newLog.device_mac);
          
          setDevices((prev) => {
            const mac = newLog.device_mac || 'Unknown';
            const existing = prev[mac];
            
            return {
              ...prev,
              [mac]: {
                id: mac,
                mac: mac,
                ppm: newLog.ppm_level,
                status: newLog.status || 'Normal',
                label: existing?.label || labelsRef.current[mac] || `Device ${mac.slice(-4)}`,
                houseId: existing?.houseId || '...',
                lastSeen: new Date()
              }
            };
          });
        }
      )
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, []);

  // 3. LIVE MQTT LISTENER
  useEffect(() => {
    let client: mqtt.MqttClient | null = null;
    try {
      const topic = process.env.EXPO_PUBLIC_HIVEMQ_TOPIC || 'hfire/#';
      
      console.log('App: Attempting MQTT connect to', HIVEMQ_URL);
      
      // Explicitly define options for HiveMQ Cloud WSS
      client = mqtt.connect(HIVEMQ_URL, {
        protocol: 'wss',
        path: '/mqtt',
        username: process.env.EXPO_PUBLIC_HIVEMQ_USERNAME,
        password: process.env.EXPO_PUBLIC_HIVEMQ_PASSWORD,
        clientId: `hfire_app_v2_${Math.random().toString(16).slice(2, 10)}`,
        connectTimeout: 15000,
        reconnectPeriod: 5000,
        rejectUnauthorized: false,
      });

      client.on('connect', () => {
        console.log('App: Connected to HiveMQ Broker!');
        setMqttConnectionState('live');
        client?.subscribe(topic, (err) => {
          if (err) console.error('App: Subscription error:', err);
          else console.log(`App: Subscribed to ${topic}`);
        });
      });

      client.on('error', (err) => {
        console.error('App: MQTT Broker Error:', err);
        setMqttConnectionState('error');
      });

      client.on('close', () => {
        console.log('App: MQTT Connection closed');
        setMqttConnectionState('error');
      });

      client.on('message', (topic, message) => {
        try {
          const payload = message.toString();
          console.log(`App: Received message on ${topic}:`, payload);
          const parts = topic.split('/');
          if (parts.length < 2) return;

          const houseId = parts[1];
          const type = parts[2];

          setDevices((prev) => {
            let macFromPayload = '___';
            let ppmFromPayload = -1;
            let statusFromPayload = '';

            if (payload.startsWith('{')) {
              try {
                const json = JSON.parse(payload);
                macFromPayload = json.mac || '___';
                ppmFromPayload = json.ppm !== undefined ? parseInt(json.ppm, 10) : -1;
                statusFromPayload = json.status;
              } catch (e) {}
            }

            // Standardized device identification
            const targetMac = macFromPayload !== '___' ? macFromPayload : (type === 'mac' ? payload : '___');
            
            // 1. Find existing device key (prioritize matching MAC, then House ID)
            let existingKey = Object.keys(prev).find(key => 
              (targetMac !== '___' && (key === targetMac || prev[key].mac === targetMac)) || 
              key === houseId ||
              prev[key].houseId === houseId
            );
            
            const effectiveKey = existingKey || (targetMac !== '___' ? targetMac : houseId);
            const existing = prev[effectiveKey];

            const updated: Device = existing ? { ...existing } : { 
              id: effectiveKey,
              mac: targetMac !== '___' ? targetMac : (type === 'mac' ? payload : '...'), 
              ppm: ppmFromPayload !== -1 ? ppmFromPayload : 0, 
              status: statusFromPayload || 'Normal', 
              label: labelsRef.current[effectiveKey] || `House ${houseId}`,
              houseId,
              lastSeen: new Date()
            };

            if (ppmFromPayload !== -1) updated.ppm = ppmFromPayload;
            else if (type === 'ppm') updated.ppm = parseInt(payload, 10) || 0;

            if (macFromPayload !== '___') updated.mac = macFromPayload;
            else if (type === 'mac') updated.mac = payload;

            if (statusFromPayload) updated.status = statusFromPayload;
            else if (type === 'status') updated.status = payload;
            
            updated.lastSeen = new Date();

            if (updated.status === 'SAFE') updated.status = 'Normal';

            const s = updated.status.toUpperCase();
            const isDanger = s.includes('CRITICAL') || s.includes('FIRE') || s.includes('DANGER');
            const isWarning = s.includes('WARNING') || s.includes('SMOKE') || s.includes('GAS');

            if (isDanger || isWarning) {
              if (!existing || existing.status !== updated.status) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              }
              // Automatically save to database ONLY if we have a valid MAC
              if (updated.mac !== '...' && updated.mac !== 'Unknown') {
                saveLog(updated.mac, updated.ppm, updated.status);
              }
            }

            // 2. Aggressive Migration Logic: If we now have a MAC, ensure it's the ONLY key for this device
            if (targetMac !== '___' && targetMac !== 'Unknown') {
              const newDevices = { ...prev };
              
              // Find and remove any record that matches this MAC or HouseID but isn't the macKey
              Object.keys(newDevices).forEach(key => {
                if (key !== targetMac && (newDevices[key].mac === targetMac || newDevices[key].houseId === houseId)) {
                  delete newDevices[key];
                }
              });

              return { 
                ...newDevices, 
                [targetMac]: { ...updated, id: targetMac, mac: targetMac } 
              };
            }

            return { ...prev, [effectiveKey]: updated };
          });
        } catch (msgErr) {
          console.error('MQTT Msg Err:', msgErr);
        }
      });
    } catch (connErr) {
      setMqttConnectionState('error');
    }

    return () => { if (client) client.end(); };
  }, []);

  const { setUserDetails } = useUser();

  const completeOnboarding = async () => {
    if (!setupName.trim()) return;
    try {
      const details = { name: setupName, community: setupCommunity };
      
      const { error } = await supabase
        .from('profiles')
        .upsert({ id: profileId, ...details });

      if (error) console.error('Supabase Profile Save Error:', error);

      await setUserDetails(details);
      setShowOnboarding(false);
    } catch (err) {
      console.error('Onboarding Error:', err);
    }
  };

  const saveLabel = async () => {
    if (editingMac) {
      const newLabels = { ...labels, [editingMac]: tempLabel };
      setLabels(newLabels);
      await AsyncStorage.setItem('HFIRE_DEVICE_LABELS', JSON.stringify(newLabels));
      setEditingMac(null);
    }
  };

  const ConnectionStatusBanner = () => {
    const errors = [];
    if (internetConnected === false) errors.push({ label: 'No Internet', color: '#F44336', icon: 'wifi.slash' });
    else {
      if (supabaseConnected === false) errors.push({ label: 'Database Error', color: '#FF9800', icon: 'server.rack' });
      if (mqttConnectionState === 'error') errors.push({ label: 'Broker Error', color: '#FF9800', icon: 'antenna.radiowaves.left.and.right.slash' });
      else if (mqttConnectionState === 'connecting') errors.push({ label: 'Connecting to MQTT...', color: '#2196F3', icon: 'antenna.radiowaves.left.and.right' });
    }

    if (errors.length === 0) return null;

    return (
      <View style={styles.errorBannerContainer}>
        {errors.map((err, i) => (
          <View key={i} style={[styles.errorChip, { backgroundColor: err.color + '20', borderColor: err.color }]}>
            <IconSymbol name={err.icon as any} size={12} color={err.color} style={{ marginRight: 6 }} />
            <Text style={[styles.errorChipText, { color: err.color }]}>{err.label}</Text>
          </View>
        ))}
      </View>
    );
  };

  const renderDevice = ({ item }: { item: Device }) => {
    const color = getStatusColor(item.status);
    const lastUpdate = item.lastSeen ? item.lastSeen.toLocaleTimeString() : 'N/A';
    const statusUpper = item.status.toUpperCase();
    
    let statusIconName: any = "check.circle.fill";
    let statusMsg = "System Normal";
    
    if (statusUpper.includes('DANGER') || statusUpper.includes('FIRE') || statusUpper.includes('CRITICAL')) {
      statusIconName = "flame.fill";
      statusMsg = "CRITICAL: FIRE DETECTED";
    } else if (statusUpper.includes('WARNING') || statusUpper.includes('SMOKE') || statusUpper.includes('GAS')) {
      statusIconName = "exclamationmark.triangle.fill";
      statusMsg = "WARNING: GAS LEAK";
    }

    return (
      <View style={[styles.card, { borderLeftColor: color, backgroundColor: cardBg, shadowColor }]}>
        <View style={styles.cardHeader}>
          <View style={styles.headerTitleGroup}>
            <View style={styles.labelRow}>
              <Text style={[styles.householdLabel, { color: textColor }]} numberOfLines={1}>
                {labels[item.mac] || labels[item.houseId] || item.label}
              </Text>
              <TouchableOpacity 
                style={styles.editBtn} 
                onPress={() => {
                  const targetKey = item.mac !== '...' ? item.mac : item.houseId;
                  setEditingMac(targetKey);
                  setTempLabel(labels[targetKey] || item.label);
                }}
              >
                <IconSymbol name="pencil.circle.fill" size={18} color="#2196F3" />
              </TouchableOpacity>
            </View>
            <Text style={styles.macText}>DEVICE ID: {item.mac}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: color + '15' }]}>
            <IconSymbol name={statusIconName} size={14} color={color} style={{ marginRight: 6 }} />
            <Text style={[styles.statusBadgeText, { color }]}>{statusUpper}</Text>
          </View>
        </View>
        
        <View style={styles.dataRow}>
          <View style={styles.ppmBox}>
            <Text style={[styles.ppmValue, { color }]}>{item.ppm}</Text>
            <Text style={styles.ppmLabel}>PPM LEVEL</Text>
          </View>
          <View style={styles.updateBox}>
            <View style={styles.statusDescriptionRow}>
              <Text style={[styles.statusDescription, { color }]}>{statusMsg}</Text>
            </View>
            <View style={styles.timeRow}>
              <IconSymbol name="clock.fill" size={12} color="#999" style={{ marginRight: 4 }} />
              <Text style={styles.timeText}>{lastUpdate}</Text>
            </View>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <View style={[styles.progressBar, { backgroundColor: color + '20' }]}>
            <View 
              style={[
                styles.progressFill, 
                { 
                  backgroundColor: color, 
                  width: `${Math.min((item.ppm / 2000) * 100, 100)}%` 
                }
              ]} 
            />
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: containerBg }]}>
      <StatusBar style="auto" />
      
      <View style={[styles.header, { backgroundColor: headerBg, shadowColor }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.welcomeText}>DASHBOARD</Text>
          <View style={styles.userNameRow}>
            <Text style={[styles.userNameText, { color: textColor }]} numberOfLines={1}>{userDetails?.name || 'Home Owner'}</Text>
          </View>
          {userDetails?.community ? (
            <View style={styles.communityRow}>
              <IconSymbol name="house.fill" size={14} color="#2196F3" style={{ marginRight: 4 }} />
              <Text style={[styles.communityText, { color: secondaryText }]}>{userDetails.community}</Text>
            </View>
          ) : null}
        </View>
        <View style={[styles.connectionStatus, { backgroundColor: inputBg, borderColor }]}>
          <View style={[styles.statusDot, { backgroundColor: (mqttConnectionState === 'live' && internetConnected !== false && supabaseConnected !== false) ? '#4CAF50' : '#F44336' }]} />
          <Text style={[styles.statusLabel, { color: secondaryText }]}>{(mqttConnectionState === 'live' && internetConnected !== false && supabaseConnected !== false) ? 'CONNECTED' : 'OFFLINE'}</Text>
        </View>
      </View>

      <ConnectionStatusBanner />

      <FlatList
        data={Object.values(devices).filter(d => d.mac !== 'Unknown' || d.houseId)}
        keyExtractor={(item) => item.id}
        renderItem={renderDevice}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            {!hasAttemptedLoad ? (
              <>
                <IconSymbol name="waveform.path.ecg" size={60} color="#ddd" />
                <Text style={styles.empty}>Searching for devices...</Text>
                <ActivityIndicator size="small" color="#2196F3" style={{ marginTop: 20 }} />
              </>
            ) : internetConnected === false ? (
              <>
                <IconSymbol name="wifi.slash" size={60} color="#F44336" />
                <Text style={[styles.empty, { color: '#F44336' }]}>No internet connection found.</Text>
                <Text style={styles.emptySub}>Please check your network settings.</Text>
              </>
            ) : supabaseConnected === false ? (
              <>
                <IconSymbol name="server.rack" size={60} color="#FF9800" />
                <Text style={[styles.empty, { color: '#FF9800' }]}>Database offline.</Text>
                <Text style={styles.emptySub}>We couldn&apos;t reach the database server.</Text>
              </>
            ) : (
              <>
                <IconSymbol name="exclamationmark.magnifyingglass" size={60} color="#ccc" />
                <Text style={styles.empty}>No telemetry data found.</Text>
                <Text style={styles.emptySub}>Ensure your H-Fire devices are powered on and connected.</Text>
                <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh}>
                  <Text style={styles.refreshBtnText}>Try Again</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        }
      />

      {/* Onboarding Modal */}
      <Modal visible={showOnboarding} animationType="slide">
        <View style={styles.onboardingContainer}>
          <View style={[styles.onboardingCard, { backgroundColor: cardBg }]}>
            <Text style={[styles.onboardingTitle, { color: textColor }]}>H-Fire Setup</Text>
            <Text style={styles.onboardingSub}>Let&apos;s get your monitoring dashboard ready.</Text>
            
            <Text style={styles.inputLabel}>WHAT&apos;S YOUR NAME?</Text>
            <TextInput
              style={[styles.onboardingInput, { backgroundColor: inputBg, color: textColor }]}
              value={setupName}
              onChangeText={setSetupName}
              placeholder="e.g. John Doe"
              placeholderTextColor="#999"
            />

            <Text style={styles.inputLabel}>BLOCK / COMMUNITY (OPTIONAL)</Text>
            <TextInput
              style={[styles.onboardingInput, { backgroundColor: inputBg, color: textColor }]}
              value={setupCommunity}
              onChangeText={setSetupCommunity}
              placeholder="e.g. Phase 1 Block 5"
              placeholderTextColor="#999"
            />

            <TouchableOpacity 
              style={[styles.startBtn, { opacity: setupName.trim() ? 1 : 0.5 }]} 
              onPress={completeOnboarding}
              disabled={!setupName.trim()}
            >
              <Text style={styles.startBtnText}>Start Monitoring</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Rename Device Modal */}
      <Modal visible={editingMac !== null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: cardBg }]}>
            <Text style={[styles.modalTitle, { color: textColor }]}>Rename Device</Text>
            <TextInput
              style={[styles.input, { backgroundColor: inputBg, color: textColor, borderColor }]}
              value={tempLabel}
              onChangeText={setTempLabel}
              placeholder="e.g., Kitchen"
              placeholderTextColor="#999"
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={() => setEditingMac(null)} style={styles.btnCancel}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveLabel} style={styles.btnSave}>
                <Text style={styles.saveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { 
    padding: 25, 
    paddingTop: 20, 
    flexDirection: 'row', 
    justifyContent: 'space-between',
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    elevation: 8,
    shadowOpacity: 0.08,
    shadowRadius: 15,
    zIndex: 10,
  },
  welcomeText: { fontSize: 12, color: '#2196F3', fontWeight: '800', letterSpacing: 1.5 },
  userNameText: { fontSize: 26, fontWeight: '900', marginTop: 2 },
  userNameRow: { flexDirection: 'row', alignItems: 'center' },
  profileEditBtn: { marginLeft: 10, padding: 5 },
  communityRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  communityText: { fontSize: 13, fontWeight: '600' },
  connectionStatus: { flexDirection: 'row', alignItems: 'center', height: 28, paddingHorizontal: 10, borderRadius: 20, borderWidth: 1 },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  statusLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  errorBannerContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 8,
  },
  errorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  errorChipText: {
    fontSize: 11,
    fontWeight: '800',
  },
  list: { padding: 20, paddingTop: 15, paddingBottom: 100 },
  card: {
    borderRadius: 24,
    padding: 20,
    marginBottom: 20,
    borderLeftWidth: 8,
    elevation: 4,
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 15 },
  headerTitleGroup: { flex: 1, marginRight: 10 },
  labelRow: { flexDirection: 'row', alignItems: 'center' },
  editBtn: { marginLeft: 6, padding: 4 },
  householdLabel: { fontSize: 20, fontWeight: '800', flexShrink: 1 },
  macText: { fontSize: 9, color: '#aaa', fontWeight: '700', marginTop: 2, letterSpacing: 0.5 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  statusBadgeText: { fontSize: 10, fontWeight: '900' },
  dataRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ppmBox: { alignItems: 'flex-start' },
  ppmValue: { fontSize: 48, fontWeight: '900', lineHeight: 52 },
  ppmLabel: { fontSize: 10, color: '#999', fontWeight: '800', letterSpacing: 1, marginTop: -4 },
  updateBox: { alignItems: 'flex-end', flex: 1 },
  statusDescriptionRow: { marginBottom: 4 },
  statusDescription: { fontSize: 12, fontWeight: '800' },
  timeRow: { flexDirection: 'row', alignItems: 'center' },
  timeText: { fontSize: 12, fontWeight: '700', color: '#999' },
  cardFooter: { marginTop: 15 },
  progressBar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 80, padding: 40 },
  empty: { marginTop: 15, color: '#aaa', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  emptySub: { marginTop: 8, color: '#999', fontSize: 12, fontWeight: '500', textAlign: 'center' },
  refreshBtn: { marginTop: 25, backgroundColor: '#2196F3', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  refreshBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  onboardingContainer: { flex: 1, backgroundColor: '#2196F3', justifyContent: 'center', padding: 30 },
  onboardingCard: { borderRadius: 30, padding: 30, elevation: 20 },
  onboardingTitle: { fontSize: 32, fontWeight: '900', marginBottom: 10 },
  onboardingSub: { fontSize: 16, color: '#666', marginBottom: 40 },
  inputLabel: { fontSize: 10, fontWeight: '900', color: '#888', marginBottom: 8, letterSpacing: 1 },
  onboardingInput: { borderRadius: 15, padding: 18, fontSize: 16, marginBottom: 25 },
  startBtn: { backgroundColor: '#1a1a1a', borderRadius: 15, padding: 20, alignItems: 'center', marginTop: 10 },
  startBtnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { padding: 25, borderRadius: 28, width: width * 0.85, elevation: 20 },
  modalTitle: { fontSize: 22, fontWeight: '900', marginBottom: 20 },
  input: { borderRadius: 16, padding: 15, fontSize: 18, marginBottom: 25, borderWidth: 1 },
  themeContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 25 },
  themeOption: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 12, marginHorizontal: 4, borderWidth: 1 },
  themeOptionText: { fontSize: 11, fontWeight: '900', marginTop: 4 },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  btnCancel: { padding: 12, marginRight: 15 },
  cancelText: { fontWeight: '800', color: '#999', fontSize: 14 },
  btnSave: { backgroundColor: '#2196F3', paddingHorizontal: 25, paddingVertical: 14, borderRadius: 16, elevation: 4 },
  saveText: { fontWeight: '900', color: '#fff', fontSize: 14 },
});
