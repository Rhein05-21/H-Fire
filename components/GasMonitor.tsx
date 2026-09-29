import React, { useState, useEffect, useCallback } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  FlatList, 
  Dimensions, 
  TouchableOpacity, 
  Modal, 
  TextInput, 
  ActivityIndicator, 
  Alert, 
  Platform, 
  RefreshControl,
  ScrollView
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '@/utils/supabase';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useAppTheme } from '@/context/ThemeContext';
import { useUser, Device } from '@/context/UserContext';
import { IconSymbol } from '@/components/ui/icon-symbol';

const { width } = Dimensions.get('window');

const getStatusData = (ppm: number, flame: boolean, isInactive: boolean) => {
  if (isInactive) return { color: '#9E9E9E', label: 'OFFLINE', icon: 'wifi.slash', msg: 'Device disconnected' };
  if (flame || ppm > 1500) return { color: '#FF3B30', label: 'FIRE', icon: 'flame.fill', msg: 'CRITICAL: EVACUATE NOW' };
  if (ppm > 450) return { color: '#FF9500', label: 'GAS/SMOKE', icon: 'exclamationmark.triangle.fill', msg: 'WARNING: GAS LEAK/SMOKE DETECTED' };
  return { color: '#34C759', label: 'SAFE', icon: 'check.circle.fill', msg: 'System monitoring active' };
};

export default function GasDashboard() {
  const { colorScheme } = useAppTheme();
  const { 
    userDetails, 
    devices, 
    secondaryNodes, 
    systemStatus, 
    refreshProfile, 
    renameDevice 
  } = useUser();
  
  const containerBg = useThemeColor({}, 'background');
  const cardBg = useThemeColor({ light: '#fff', dark: '#1c1c1e' }, 'background');
  const textColor = useThemeColor({}, 'text');
  const secondaryText = useThemeColor({ light: '#8E8E93', dark: '#8E8E93' }, 'text');
  const borderColor = useThemeColor({ light: '#e5e5ea', dark: '#3a3a3c' }, 'background');
  const modalBg = useThemeColor({ light: '#f2f2f7', dark: '#141416' }, 'background');
  const innerCardBg = useThemeColor({ light: '#ffffff', dark: '#1e1e22' }, 'background');

  const [labels, setLabels] = useState<Record<string, string>>({});
  const [internetConnected, setInternetConnected] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Modals State
  const [editingMac, setEditingMac] = useState<string | null>(null);
  const [tempLabel, setTempLabel] = useState('');
  const [loading, setLoading] = useState(false);

  // Mesh & Secondary Nodes Details Modal State
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);

  // 1. Network Connectivity Listener
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setInternetConnected(Boolean(state.isConnected && state.isInternetReachable !== false));
    });
    return () => unsubscribe();
  }, []);

  // 2. LOAD LABELS
  useEffect(() => {
    AsyncStorage.getItem('HFIRE_DEVICE_LABELS').then(stored => {
      if (stored) setLabels(JSON.parse(stored));
    });
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshProfile();
    setRefreshing(false);
  }, [refreshProfile]);

  const saveLabel = async () => {
    if (editingMac) {
      setLoading(true);
      try {
        // 1. Sync with Context & Supabase
        const res = await renameDevice(editingMac, tempLabel.trim());
        if (!res.success && res.error) throw new Error(res.error);

        // 2. Update Local State & Storage
        const newLabels = { ...labels, [editingMac]: tempLabel.trim() };
        setLabels(newLabels);
        await AsyncStorage.setItem('HFIRE_DEVICE_LABELS', JSON.stringify(newLabels));
        
        // 3. Trigger Global Refresh to sync UserContext
        await refreshProfile();
        
        setEditingMac(null);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (e) {
        console.error('Rename failed:', e);
        Alert.alert('Error', 'Failed to update label in database.');
      } finally {
        setLoading(false);
      }
    }
  };

  const renderDevice = ({ item }: { item: Device }) => {
    const isInactive = !item.lastSeen || (Date.now() - new Date(item.lastSeen).getTime() > 60000);
    const status = getStatusData(item.ppm, item.flame, isInactive);
    
    return (
      <TouchableOpacity 
        activeOpacity={0.85}
        onPress={() => setSelectedDevice(item)}
        style={[styles.card, { backgroundColor: cardBg }]}
      >
        <View style={[styles.statusIndicator, { backgroundColor: status.color }]} />
        
        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.deviceLabel, { color: textColor }]}>{labels[item.mac] || item.label}</Text>
              <Text style={styles.macText}>{item.mac}</Text>
            </View>
            <TouchableOpacity 
              onPress={(e) => { 
                e.stopPropagation(); 
                setEditingMac(item.mac); 
                setTempLabel(labels[item.mac] || item.label); 
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <IconSymbol name="pencil.circle.fill" size={22} color="#2196F3" />
            </TouchableOpacity>
          </View>

          <View style={styles.dataRow}>
            <View style={styles.ppmBox}>
              <Text style={[styles.ppmValue, { color: status.color }]}>{isInactive ? '--' : item.ppm}</Text>
              <Text style={styles.ppmUnit}>PPM</Text>
            </View>
            <View style={styles.statusBox}>
              <View style={[styles.badge, { backgroundColor: status.color + '15' }]}>
                <IconSymbol name={status.icon as any} size={12} color={status.color} />
                <Text style={[styles.badgeText, { color: status.color }]}>{status.label}</Text>
              </View>
              <Text style={[styles.statusMsg, { color: secondaryText }]} numberOfLines={1}>{status.msg}</Text>
            </View>
          </View>

          <View style={styles.cardFooter}>
            <View style={[styles.progressBase, { backgroundColor: borderColor }]}>
              <View style={[styles.progressFill, { backgroundColor: status.color, width: `${Math.min((item.ppm / 2000) * 100, 100)}%` }]} />
            </View>
            
            <View style={styles.footerRow}>
              <View style={styles.meshPill}>
                <IconSymbol name="waveform.path.ecg" size={10} color="#2196F3" />
                <Text style={styles.meshPillText}>Tap to view mesh sensors (N2 & N3)</Text>
              </View>
              <Text style={styles.timeText}>{item.lastSeen ? new Date(item.lastSeen).toLocaleTimeString() : 'N/A'}</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: containerBg }]}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      
      <View style={styles.heroHeader}>
        <View style={{ flex: 1, marginRight: 10 }}>
          <Text style={styles.brandText}>H-FIRE MONITOR</Text>
          <Text style={[styles.welcomeText, { color: textColor }]} numberOfLines={1}>
            Hi, {userDetails?.name?.includes(',') ? userDetails.name.split(',')[1].trim().split(' ')[0] : (userDetails?.name?.split(' ')[0] || 'User')}
          </Text>
        </View>

        <View style={styles.headerBadges}>
          <View style={[styles.connBadge, { backgroundColor: systemStatus === 'Online' ? '#34C75915' : '#FF3B3015' }]}>
            <View style={[styles.dot, { backgroundColor: systemStatus === 'Online' ? '#34C759' : '#FF3B30' }]} />
            <Text style={[styles.connText, { color: systemStatus === 'Online' ? '#34C759' : '#FF3B30' }]}>CLOUD</Text>
          </View>

          <View style={[styles.connBadge, { backgroundColor: internetConnected ? '#2196F315' : '#FF950015', marginTop: 4 }]}>
            <View style={[styles.dot, { backgroundColor: internetConnected ? '#2196F3' : '#FF9500' }]} />
            <Text style={[styles.connText, { color: internetConnected ? '#2196F3' : '#FF9500' }]}>APP</Text>
          </View>
        </View>
      </View>

      <FlatList
        data={Object.values(devices)}
        keyExtractor={(item) => item.mac}
        renderItem={renderDevice}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2196F3" />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <IconSymbol name="waveform.path.ecg" size={60} color={borderColor} />
            <Text style={[styles.emptyText, { color: secondaryText }]}>Waiting for device telemetry...</Text>
          </View>
        }
      />

      {/* RENAME MODAL */}
      <Modal visible={editingMac !== null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: cardBg }]}>
            <Text style={[styles.modalTitle, { color: textColor }]}>Rename Device</Text>
            <TextInput 
              style={[styles.modalInput, { backgroundColor: borderColor, color: textColor }]} 
              value={tempLabel} 
              onChangeText={setTempLabel} 
              autoFocus 
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setEditingMac(null)}>
                <Text style={{ color: secondaryText, fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveLabel} style={styles.modalSave}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '900' }}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MESH & SECONDARY NODES DETAIL MODAL */}
      <Modal visible={selectedDevice !== null} animationType="slide" transparent>
        <View style={styles.detailsModalBackdrop}>
          <View style={[styles.detailsModalCard, { backgroundColor: modalBg }]}>
            
            {/* Header */}
            <View style={styles.detailsHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.detailsHeaderSub}>ESP-NOW MESH SENSOR NETWORK</Text>
                <Text style={[styles.detailsHeaderTitle, { color: textColor }]} numberOfLines={1}>
                  {selectedDevice ? (labels[selectedDevice.mac] || selectedDevice.label) : 'Node Details'}
                </Text>
              </View>
              <TouchableOpacity 
                style={styles.detailsCloseBtn} 
                onPress={() => setSelectedDevice(null)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <IconSymbol name="xmark.circle.fill" size={26} color={secondaryText} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.detailsScroll}>
              
              {/* SECTION 1: PRIMARY CORE NODE (N1) */}
              {selectedDevice && (() => {
                const isInactive = !selectedDevice.lastSeen || (Date.now() - new Date(selectedDevice.lastSeen).getTime() > 60000);
                const n1Status = getStatusData(selectedDevice.ppm, selectedDevice.flame, isInactive);
                
                return (
                  <View style={[styles.nodeDetailCard, { backgroundColor: innerCardBg }]}>
                    <View style={styles.nodeDetailHeader}>
                      <View style={styles.channelBadgePrimary}>
                        <Text style={styles.channelBadgeTextPrimary}>PRIMARY CORE NODE (N1)</Text>
                      </View>
                      <View style={[styles.badge, { backgroundColor: n1Status.color + '15' }]}>
                        <IconSymbol name={n1Status.icon as any} size={11} color={n1Status.color} />
                        <Text style={[styles.badgeText, { color: n1Status.color }]}>{n1Status.label}</Text>
                      </View>
                    </View>

                    <Text style={[styles.nodeTitle, { color: textColor }]}>
                      {labels[selectedDevice.mac] || selectedDevice.label}
                    </Text>
                    <Text style={styles.nodeMac}>{selectedDevice.mac}</Text>

                    <View style={styles.nodeStatsGrid}>
                      <View style={styles.nodeStatBox}>
                        <Text style={styles.nodeStatLabel}>MQ-2 GAS LEVEL</Text>
                        <View style={styles.nodeStatValueRow}>
                          <Text style={[styles.nodeStatPpm, { color: n1Status.color }]}>
                            {isInactive ? '--' : selectedDevice.ppm}
                          </Text>
                          <Text style={styles.nodeStatUnit}>PPM</Text>
                        </View>
                      </View>

                      <View style={styles.nodeStatBox}>
                        <Text style={styles.nodeStatLabel}>OPTICAL FLAME</Text>
                        <View style={styles.nodeStatFlameRow}>
                          <IconSymbol 
                            name="flame.fill" 
                            size={16} 
                            color={selectedDevice.flame ? '#FF3B30' : '#34C759'} 
                          />
                          <Text style={[styles.nodeStatFlameText, { color: selectedDevice.flame ? '#FF3B30' : '#34C759' }]}>
                            {selectedDevice.flame ? 'FLAME DETECTED' : 'NO FLAME'}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <View style={[styles.progressBase, { backgroundColor: borderColor, marginTop: 12 }]}>
                      <View 
                        style={[
                          styles.progressFill, 
                          { backgroundColor: n1Status.color, width: `${Math.min((selectedDevice.ppm / 2000) * 100, 100)}%` }
                        ]} 
                      />
                    </View>
                  </View>
                );
              })()}

              <Text style={styles.secondarySectionHeading}>SATELLITE MESH NODES (N2 & N3)</Text>
              <Text style={[styles.secondarySectionSub, { color: secondaryText }]}>
                Live telemetry from satellite sensors connected via ESP-NOW local mesh
              </Text>

              {/* SECTION 2: SECONDARY SENSOR NODE (N2) */}
              {(() => {
                const n2 = secondaryNodes.N2;
                const n2Ppm = n2.ppm || 0;
                const n2Flame = Boolean(n2.flame);
                const n2Status = getStatusData(n2Ppm, n2Flame, false);

                return (
                  <View style={[styles.nodeDetailCard, { backgroundColor: innerCardBg, marginTop: 10 }]}>
                    <View style={styles.nodeDetailHeader}>
                      <View style={styles.channelBadgeSecondary}>
                        <Text style={styles.channelBadgeTextSecondary}>CHANNEL N2</Text>
                      </View>
                      <View style={[styles.badge, { backgroundColor: n2Status.color + '15' }]}>
                        <IconSymbol name={n2Status.icon as any} size={11} color={n2Status.color} />
                        <Text style={[styles.badgeText, { color: n2Status.color }]}>{n2Status.label}</Text>
                      </View>
                    </View>

                    <Text style={[styles.nodeTitle, { color: textColor }]}>
                      {n2.name || 'Secondary Node 2 (Living Room / Sector 2)'}
                    </Text>

                    <View style={styles.nodeStatsGrid}>
                      <View style={styles.nodeStatBox}>
                        <Text style={styles.nodeStatLabel}>MQ-2 GAS LEVEL</Text>
                        <View style={styles.nodeStatValueRow}>
                          <Text style={[styles.nodeStatPpm, { color: n2Status.color }]}>{n2Ppm}</Text>
                          <Text style={styles.nodeStatUnit}>PPM</Text>
                        </View>
                      </View>

                      <View style={styles.nodeStatBox}>
                        <Text style={styles.nodeStatLabel}>OPTICAL FLAME</Text>
                        <View style={styles.nodeStatFlameRow}>
                          <IconSymbol 
                            name="flame.fill" 
                            size={16} 
                            color={n2Flame ? '#FF3B30' : '#34C759'} 
                          />
                          <Text style={[styles.nodeStatFlameText, { color: n2Flame ? '#FF3B30' : '#34C759' }]}>
                            {n2Flame ? 'FLAME DETECTED' : 'NO FLAME'}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <View style={[styles.progressBase, { backgroundColor: borderColor, marginTop: 12 }]}>
                      <View 
                        style={[
                          styles.progressFill, 
                          { backgroundColor: n2Status.color, width: `${Math.min((n2Ppm / 2000) * 100, 100)}%` }
                        ]} 
                      />
                    </View>
                  </View>
                );
              })()}

              {/* SECTION 3: SECONDARY SENSOR NODE (N3) */}
              {(() => {
                const n3 = secondaryNodes.N3;
                const n3Ppm = n3.ppm || 0;
                const n3Flame = Boolean(n3.flame);
                const n3Status = getStatusData(n3Ppm, n3Flame, false);

                return (
                  <View style={[styles.nodeDetailCard, { backgroundColor: innerCardBg, marginTop: 14 }]}>
                    <View style={styles.nodeDetailHeader}>
                      <View style={styles.channelBadgeSecondary}>
                        <Text style={styles.channelBadgeTextSecondary}>CHANNEL N3</Text>
                      </View>
                      <View style={[styles.badge, { backgroundColor: n3Status.color + '15' }]}>
                        <IconSymbol name={n3Status.icon as any} size={11} color={n3Status.color} />
                        <Text style={[styles.badgeText, { color: n3Status.color }]}>{n3Status.label}</Text>
                      </View>
                    </View>

                    <Text style={[styles.nodeTitle, { color: textColor }]}>
                      {n3.name || 'Secondary Node 3 (Bedroom / Sector 3)'}
                    </Text>

                    <View style={styles.nodeStatsGrid}>
                      <View style={styles.nodeStatBox}>
                        <Text style={styles.nodeStatLabel}>MQ-2 GAS LEVEL</Text>
                        <View style={styles.nodeStatValueRow}>
                          <Text style={[styles.nodeStatPpm, { color: n3Status.color }]}>{n3Ppm}</Text>
                          <Text style={styles.nodeStatUnit}>PPM</Text>
                        </View>
                      </View>

                      <View style={styles.nodeStatBox}>
                        <Text style={styles.nodeStatLabel}>OPTICAL FLAME</Text>
                        <View style={styles.nodeStatFlameRow}>
                          <IconSymbol 
                            name="flame.fill" 
                            size={16} 
                            color={n3Flame ? '#FF3B30' : '#34C759'} 
                          />
                          <Text style={[styles.nodeStatFlameText, { color: n3Flame ? '#FF3B30' : '#34C759' }]}>
                            {n3Flame ? 'FLAME DETECTED' : 'NO FLAME'}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <View style={[styles.progressBase, { backgroundColor: borderColor, marginTop: 12 }]}>
                      <View 
                        style={[
                          styles.progressFill, 
                          { backgroundColor: n3Status.color, width: `${Math.min((n3Ppm / 2000) * 100, 100)}%` }
                        ]} 
                      />
                    </View>
                  </View>
                );
              })()}

              <TouchableOpacity 
                style={styles.detailsDoneBtn}
                onPress={() => setSelectedDevice(null)}
                activeOpacity={0.8}
              >
                <Text style={styles.detailsDoneBtnText}>Done</Text>
              </TouchableOpacity>
            </ScrollView>

          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  heroHeader: { paddingHorizontal: 25, paddingTop: 60, paddingBottom: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  brandText: { color: '#2196F3', fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  welcomeText: { fontSize: 28, fontWeight: '900', marginTop: 4 },
  headerBadges: { alignItems: 'flex-end' },
  connBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  connText: { fontSize: 10, fontWeight: '900' },
  list: { padding: 20, paddingBottom: 100 },
  card: { borderRadius: 28, marginBottom: 20, flexDirection: 'row', overflow: 'hidden', ...Platform.select({ ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 12 }, android: { elevation: 3 } }) },
  statusIndicator: { width: 6 },
  cardContent: { flex: 1, padding: 20 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 15 },
  deviceLabel: { fontSize: 20, fontWeight: '800' },
  macText: { fontSize: 10, color: '#8E8E93', fontWeight: '600', marginTop: 2 },
  dataRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20 },
  ppmBox: { flexDirection: 'row', alignItems: 'flex-end' },
  ppmValue: { fontSize: 48, fontWeight: '900', lineHeight: 48 },
  ppmUnit: { fontSize: 12, fontWeight: '800', color: '#8E8E93', marginLeft: 5, marginBottom: 8 },
  statusBox: { alignItems: 'flex-end' },
  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, marginBottom: 6 },
  badgeText: { fontSize: 10, fontWeight: '900', marginLeft: 4 },
  statusMsg: { fontSize: 11, fontWeight: '700' },
  cardFooter: { borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.03)', paddingTop: 15 },
  progressBase: { height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  meshPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#2196F315', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  meshPillText: { fontSize: 9, fontWeight: '800', color: '#2196F3', marginLeft: 4 },
  timeText: { fontSize: 10, color: '#8E8E93', fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 100 },
  emptyText: { marginTop: 15, fontWeight: '700' },
  
  // Rename Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: width * 0.8, padding: 30, borderRadius: 25 },
  modalTitle: { fontSize: 20, fontWeight: '900', marginBottom: 20 },
  modalInput: { padding: 15, borderRadius: 12, fontSize: 18, fontWeight: '700', marginBottom: 25 },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalSave: { backgroundColor: '#2196F3', paddingHorizontal: 25, paddingVertical: 12, borderRadius: 12 },

  // Details Modal
  detailsModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  detailsModalCard: { borderTopLeftRadius: 32, borderTopRightRadius: 32, maxHeight: '88%', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 36 },
  detailsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingHorizontal: 4 },
  detailsHeaderSub: { color: '#2196F3', fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  detailsHeaderTitle: { fontSize: 24, fontWeight: '900', marginTop: 2 },
  detailsCloseBtn: { padding: 4 },
  detailsScroll: { paddingBottom: 30 },
  
  nodeDetailCard: { borderRadius: 24, padding: 18, borderWidth: 1, borderColor: 'rgba(150,150,150,0.1)' },
  nodeDetailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  channelBadgePrimary: { backgroundColor: '#2196F318', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  channelBadgeTextPrimary: { color: '#2196F3', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  channelBadgeSecondary: { backgroundColor: '#FF950018', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  channelBadgeTextSecondary: { color: '#FF9500', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  nodeTitle: { fontSize: 18, fontWeight: '800' },
  nodeMac: { fontSize: 11, color: '#8E8E93', fontWeight: '600', marginTop: 2 },
  nodeStatsGrid: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, gap: 10 },
  nodeStatBox: { flex: 1, backgroundColor: 'rgba(150,150,150,0.06)', borderRadius: 14, padding: 12 },
  nodeStatLabel: { fontSize: 8, fontWeight: '900', color: '#8E8E93', letterSpacing: 0.5 },
  nodeStatValueRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 4 },
  nodeStatPpm: { fontSize: 26, fontWeight: '900' },
  nodeStatUnit: { fontSize: 10, fontWeight: '800', color: '#8E8E93', marginLeft: 4, marginBottom: 3 },
  nodeStatFlameRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  nodeStatFlameText: { fontSize: 10, fontWeight: '900', marginLeft: 6 },

  secondarySectionHeading: { fontSize: 12, fontWeight: '900', color: '#2196F3', letterSpacing: 1, marginTop: 24, marginBottom: 4, paddingHorizontal: 4 },
  secondarySectionSub: { fontSize: 11, fontWeight: '600', marginBottom: 10, paddingHorizontal: 4 },
  detailsDoneBtn: { backgroundColor: '#2196F3', borderRadius: 18, paddingVertical: 14, alignItems: 'center', marginTop: 24 },
  detailsDoneBtnText: { color: '#fff', fontSize: 15, fontWeight: '900' }
});
