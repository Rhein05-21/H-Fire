import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, Modal, FlatList, ActivityIndicator, Dimensions, RefreshControl, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '@/utils/supabase';
import { getStatusColor } from '@/constants/thresholds';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useAppTheme } from '@/context/ThemeContext';
import { useUser, Device } from '@/context/UserContext';

const { width } = Dimensions.get('window');

const getStatusData = (ppm: number, isInactive: boolean) => {
  if (isInactive) return { color: '#9E9E9E', label: 'OFFLINE', icon: 'wifi.slash', msg: 'Device disconnected' };
  if (ppm > 1500) return { color: '#FF3B30', label: 'FIRE', icon: 'flame.fill', msg: 'CRITICAL: EVACUATE NOW' };
  if (ppm > 450) return { color: '#FF9500', label: 'GAS/SMOKE', icon: 'exclamationmark.triangle.fill', msg: 'WARNING: GAS LEAK/SMOKE DETECTED' };
  return { color: '#34C759', label: 'SAFE', icon: 'check.circle.fill', msg: 'System monitoring active' };
};

export default function GasDashboard() {
  const { colorScheme } = useAppTheme();
  const { userDetails, profileId, loading: userLoading, devices, setUserDetails } = useUser();
  
  const containerBg = useThemeColor({}, 'background');
  const cardBg = useThemeColor({ light: '#fff', dark: '#1c1c1e' }, 'background');
  const textColor = useThemeColor({}, 'text');
  const secondaryText = useThemeColor({ light: '#8E8E93', dark: '#8E8E93' }, 'text');
  const borderColor = useThemeColor({ light: '#e5e5ea', dark: '#3a3a3c' }, 'background');

  const [labels, setLabels] = useState<Record<string, string>>({});
  const [internetConnected, setInternetConnected] = useState<boolean | null>(null);
  const [editingMac, setEditingMac] = useState<string | null>(null);
  const [tempLabel, setTempLabel] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [setupName, setSetupName] = useState('');
  const [setupCommunity, setSetupCommunity] = useState('');

  useEffect(() => {
    if (!userLoading && !userDetails) setShowOnboarding(true);
    else setShowOnboarding(false);
  }, [userDetails, userLoading]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => setInternetConnected(state.isConnected));
    return () => unsubscribe();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const saveLabel = async () => {
    if (editingMac) {
      try {
        // 1. Sync with Supabase (so Admin sees the new label)
        const { error } = await supabase
          .from('devices')
          .update({ label: tempLabel })
          .eq('mac', editingMac);

        if (error) throw error;

        // 2. Update Local State & Storage
        const newLabels = { ...labels, [editingMac]: tempLabel };
        setLabels(newLabels);
        await AsyncStorage.setItem('HFIRE_DEVICE_LABELS', JSON.stringify(newLabels));
        
        setEditingMac(null);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (e) {
        console.error('Rename failed:', e);
        alert('Failed to update label in database.');
      }
    }
  };

  const renderDevice = ({ item }: { item: Device }) => {
    const isInactive = !item.lastSeen || (Date.now() - new Date(item.lastSeen).getTime() > 60000);
    const status = getStatusData(item.ppm, isInactive);
    
    return (
      <View style={[styles.card, { backgroundColor: cardBg }]}>
        <View style={[styles.statusIndicator, { backgroundColor: status.color }]} />
        
        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.deviceLabel, { color: textColor }]}>{labels[item.mac] || item.label}</Text>
              <Text style={styles.macText}>{item.mac}</Text>
            </View>
            <TouchableOpacity onPress={() => { setEditingMac(item.mac); setTempLabel(labels[item.mac] || item.label); }}>
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
            <Text style={styles.timeText}>Last update: {item.lastSeen ? new Date(item.lastSeen).toLocaleTimeString() : 'N/A'}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: containerBg }]}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      
      <View style={styles.heroHeader}>
        <View>
          <Text style={styles.brandText}>H-FIRE MONITOR</Text>
          <Text style={[styles.welcomeText, { color: textColor }]}>Welcome, {userDetails?.name?.split(' ')[0] || 'Homeowner'}</Text>
        </View>
        <View style={[styles.connBadge, { backgroundColor: internetConnected ? '#34C75920' : '#FF3B3020' }]}>
          <View style={[styles.dot, { backgroundColor: internetConnected ? '#34C759' : '#FF3B30' }]} />
          <Text style={[styles.connText, { color: internetConnected ? '#34C759' : '#FF3B30' }]}>{internetConnected ? 'LIVE' : 'OFFLINE'}</Text>
        </View>
      </View>

      <FlatList
        data={Object.values(devices)}
        keyExtractor={(item) => item.id}
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

      {/* Rename Modal */}
      <Modal visible={editingMac !== null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: cardBg }]}>
            <Text style={[styles.modalTitle, { color: textColor }]}>Rename Device</Text>
            <TextInput style={[styles.modalInput, { backgroundColor: borderColor, color: textColor }]} value={tempLabel} onChangeText={setTempLabel} autoFocus />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setEditingMac(null)}><Text style={{ color: secondaryText, fontWeight: '700' }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={saveLabel} style={styles.modalSave}><Text style={{ color: '#fff', fontWeight: '900' }}>Save</Text></TouchableOpacity>
            </View>
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
  timeText: { fontSize: 10, color: '#8E8E93', fontWeight: '600', marginTop: 10, textAlign: 'right' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 100 },
  emptyText: { marginTop: 15, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: width * 0.8, padding: 30, borderRadius: 25 },
  modalTitle: { fontSize: 20, fontWeight: '900', marginBottom: 20 },
  modalInput: { padding: 15, borderRadius: 12, fontSize: 18, fontWeight: '700', marginBottom: 25 },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalSave: { backgroundColor: '#2196F3', paddingHorizontal: 25, paddingVertical: 12, borderRadius: 12 }
});
