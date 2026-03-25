import React, { useEffect, useState, useMemo, useRef } from 'react';
import { StyleSheet, View, Text, FlatList, ActivityIndicator, Dimensions, TouchableOpacity, Modal, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/utils/supabase';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useAppTheme } from '@/context/ThemeContext';
import { getStatusColor } from '@/constants/thresholds';
import { useUser } from '@/context/UserContext';
import { IconSymbol } from '@/components/ui/icon-symbol';

const { width, height } = Dimensions.get('window');

const getStatusData = (ppm: number, isInactive: boolean) => {
  if (isInactive) return { color: '#9E9E9E', label: 'OFFLINE', level: 0 };
  if (ppm > 1500) return { color: '#FF3B30', label: 'FIRE', level: 3 };
  if (ppm > 450) return { color: '#FF9500', label: 'SMOKE', level: 2 };
  return { color: '#34C759', label: 'SAFE', level: 1 };
};

export default function AdminDashboard() {
  const { colorScheme } = useAppTheme();
  const { devices: liveMqttData } = useUser();
  
  const backgroundColor = useThemeColor({}, 'background');
  const cardBg = useThemeColor({ light: '#fff', dark: '#1c1c1e' }, 'background');
  const textColor = useThemeColor({}, 'text');
  const secondaryText = useThemeColor({ light: '#8E8E93', dark: '#8E8E93' }, 'text');

  const [dbDevices, setDbDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Map Modal State
  const [selectedDevice, setSelectedDevice] = useState<any>(null);
  const [showMap, setShowMap] = useState(false);

  const refreshData = async () => {
    try {
      const { data: devices } = await supabase.from('devices').select('*');
      const { data: profiles } = await supabase.from('profiles').select('*');
      const { data: logs } = await supabase.from('gas_logs').select('*').order('created_at', { ascending: false });

      if (devices) {
        const merged = devices.map(d => {
          const profile = profiles?.find(p => p.id === d.profile_id);
          const lastLog = logs?.find(l => l.device_mac === d.mac);
          return {
            mac: d.mac, house_name: d.house_name, label: d.label,
            ppm: lastLog?.ppm_level || 0,
            status: lastLog?.status || 'Normal',
            lastSeen: d.last_seen ? new Date(d.last_seen) : null,
            latitude: profile?.latitude,
            longitude: profile?.longitude,
            owner_name: profile?.name,
            community: profile?.community
          };
        });
        setDbDevices(merged);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    refreshData();
    const interval = setInterval(refreshData, 30000);
    return () => clearInterval(interval);
  }, []);

  const finalDisplayList = useMemo(() => {
    return dbDevices.map(dbDev => {
      const liveUpdate = liveMqttData[dbDev.mac];
      const currentPpm = liveUpdate ? liveUpdate.ppm : dbDev.ppm;
      const currentLastSeen = liveUpdate ? new Date() : dbDev.lastSeen;
      const isInactive = !currentLastSeen || (Date.now() - currentLastSeen.getTime() > 60000);
      const statusInfo = getStatusData(currentPpm, isInactive);

      return {
        ...dbDev,
        ppm: currentPpm,
        isInactive,
        uiColor: statusInfo.color,
        uiLabel: statusInfo.label,
        uiLevel: statusInfo.level
      };
    }).sort((a, b) => b.uiLevel - a.uiLevel);
  }, [dbDevices, liveMqttData]);

  const handleDevicePress = (device: any) => {
    if (device.latitude && device.longitude) {
      setSelectedDevice(device);
      setShowMap(true);
    }
  };

  const renderDeviceItem = ({ item }: { item: any }) => (
    <TouchableOpacity 
      activeOpacity={0.7}
      style={[styles.deviceCard, { backgroundColor: cardBg }]}
      onPress={() => handleDevicePress(item)}
    >
      <View style={[styles.statusIndicator, { backgroundColor: item.uiColor }]} />
      <View style={{ flex: 1, paddingLeft: 15 }}>
        <Text style={[styles.houseName, { color: textColor }]}>{item.house_name}</Text>
        <Text style={[styles.ownerName, { color: secondaryText }]}>{item.owner_name || 'No Owner'} • {item.label}</Text>
        <View style={[styles.miniBadge, { backgroundColor: item.uiColor + '20' }]}>
          <Text style={[styles.miniBadgeText, { color: item.uiColor }]}>{item.uiLabel}</Text>
        </View>
      </View>
      <View style={styles.ppmContainer}>
        <Text style={[styles.ppmValue, { color: item.uiColor }]}>{item.isInactive ? '--' : item.ppm}</Text>
        <Text style={styles.ppmUnit}>PPM</Text>
      </View>
      {item.latitude && (
        <View style={styles.mapIcon}>
          <IconSymbol name="map.fill" size={14} color={secondaryText} />
        </View>
      )}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['top']}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      
      <View style={styles.header}>
        <View>
          <Text style={styles.headerSub}>ADMIN COMMAND CENTER</Text>
          <Text style={[styles.headerTitle, { color: textColor }]}>Community Feed</Text>
        </View>
        <View style={styles.statsBadge}>
          <View style={styles.pulseDot} />
          <Text style={styles.statsText}>{finalDisplayList.filter(d => !d.isInactive).length} LIVE</Text>
        </View>
      </View>

      {loading && finalDisplayList.length === 0 ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#2196F3" />
        </View>
      ) : (
        <FlatList
          data={finalDisplayList}
          keyExtractor={(item) => item.mac}
          renderItem={renderDeviceItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* TACTICAL MAP MODAL */}
      <Modal visible={showMap} animationType="slide" transparent={false}>
        <View style={styles.modalContainer}>
          <MapView
            provider={PROVIDER_GOOGLE}
            style={styles.fullMap}
            userInterfaceStyle={colorScheme}
            initialRegion={selectedDevice ? {
              latitude: selectedDevice.latitude,
              longitude: selectedDevice.longitude,
              latitudeDelta: 0.005,
              longitudeDelta: 0.005,
            } : undefined}
          >
            {selectedDevice && (
              <Marker
                coordinate={{ latitude: selectedDevice.latitude, longitude: selectedDevice.longitude }}
                pinColor={selectedDevice.uiColor}
                title={selectedDevice.house_name}
                description={`${selectedDevice.owner_name} | ${selectedDevice.ppm} PPM`}
              />
            )}
          </MapView>

          <TouchableOpacity style={styles.closeMapBtn} onPress={() => setShowMap(false)}>
            <View style={styles.closeAction}>
              <IconSymbol name="chevron.left" size={20} color="#fff" />
              <Text style={styles.closeText}>Back to Monitor</Text>
            </View>
          </TouchableOpacity>

          {selectedDevice && (() => {
            const live = liveMqttData[selectedDevice.mac] || selectedDevice;
            const isInactive = (Date.now() - new Date(live.lastSeen).getTime() > 60000);
            const status = getStatusData(live.ppm, isInactive);
            
            return (
              <View style={styles.mapOverlayInfo}>
                <View style={[styles.mapStatusLine, { backgroundColor: status.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.mapHouseName}>{selectedDevice.house_name}</Text>
                  <Text style={styles.mapOwnerName}>{selectedDevice.owner_name}</Text>
                  <Text style={styles.mapLabel}>{status.label} | {selectedDevice.label.toUpperCase()}</Text>
                </View>
                <View style={styles.mapPpmBox}>
                  <Text style={[styles.mapPpmValue, { color: status.color }]}>{isInactive ? '--' : live.ppm}</Text>
                  <Text style={styles.mapPpmUnit}>PPM</Text>
                </View>
              </View>
            );
          })()}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 25, paddingVertical: 20 },
  headerSub: { color: '#2196F3', fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  headerTitle: { fontSize: 28, fontWeight: '900', marginTop: 2 },
  statsBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(52, 199, 89, 0.15)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  statsText: { color: '#34C759', fontSize: 10, fontWeight: '900', marginLeft: 6 },
  pulseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#34C759' },

  list: { paddingHorizontal: 20, paddingBottom: 40 },
  deviceCard: { flexDirection: 'row', alignItems: 'center', padding: 18, borderRadius: 24, marginBottom: 12, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10 },
  statusIndicator: { width: 4, height: 45, borderRadius: 2 },
  houseName: { fontSize: 18, fontWeight: '800' },
  ownerName: { fontSize: 12, marginTop: 2 },
  miniBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginTop: 8 },
  miniBadgeText: { fontSize: 9, fontWeight: '900' },
  ppmContainer: { alignItems: 'flex-end', paddingRight: 10 },
  ppmValue: { fontSize: 32, fontWeight: '900' },
  ppmUnit: { fontSize: 10, color: '#8E8E93', fontWeight: '800', marginTop: -2 },
  mapIcon: { marginLeft: 5 },
  
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Map Modal Styles
  modalContainer: { flex: 1, backgroundColor: '#000' },
  fullMap: { flex: 1 },
  closeMapBtn: { position: 'absolute', top: 60, left: 20, zIndex: 10 },
  closeAction: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 25, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  closeText: { color: '#fff', fontSize: 12, fontWeight: '800', marginLeft: 8 },
  mapOverlayInfo: { position: 'absolute', bottom: 40, left: 20, right: 20, backgroundColor: '#fff', borderRadius: 25, padding: 25, flexDirection: 'row', alignItems: 'center', elevation: 20, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 20 },
  mapStatusLine: { width: 5, height: '100%', borderRadius: 3, marginRight: 20 },
  mapHouseName: { fontSize: 22, fontWeight: '900', color: '#000' },
  mapOwnerName: { fontSize: 14, fontWeight: '700', color: '#666', marginTop: 2 },
  mapLabel: { fontSize: 10, fontWeight: '900', color: '#2196F3', letterSpacing: 1, marginTop: 8 },
  mapPpmBox: { alignItems: 'center', paddingLeft: 20, borderLeftWidth: 1, borderLeftColor: '#eee' },
  mapPpmValue: { fontSize: 36, fontWeight: '900' },
  mapPpmUnit: { fontSize: 10, fontWeight: '800', color: '#999' }
});
