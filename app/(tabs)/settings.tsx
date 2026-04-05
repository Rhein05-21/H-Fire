import React, { useState, useEffect, useRef, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Alert, Modal, Dimensions, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { supabase } from '@/utils/supabase';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useAppTheme } from '@/context/ThemeContext';
import { useUser } from '@/context/UserContext';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';

const { width, height } = Dimensions.get('window');
const HOA_PIN = '1111';
const SYSTEM_ADMIN_PIN = '2222';

type SettingsTab = 'PROFILE' | 'DEVICE' | 'ADMIN';

export default function SettingsScreen() {
  const router = useRouter();
  const { theme, setTheme } = useAppTheme();
  const { userDetails, setUserDetails, profileId, isAdmin, devices: globalDevices, allHeardDevices, refreshProfile } = useUser();
  
  const backgroundColor = useThemeColor({}, 'background');
  const textColor = useThemeColor({}, 'text');
  const cardBg = useThemeColor({ light: '#fff', dark: '#1c1c1e' }, 'background');
  const inputBg = useThemeColor({ light: '#f2f2f7', dark: '#2c2c2e' }, 'background');
  const borderColor = useThemeColor({ light: '#e5e5ea', dark: '#3a3a3c' }, 'background');
  const secondaryText = useThemeColor({ light: '#8e8e93', dark: '#8e8e93' }, 'text');

  const [activeTab, setActiveTab] = useState<SettingsTab>('PROFILE');
  const [name, setName] = useState('');
  const [community, setCommunity] = useState('');
  const [location, setLocation] = useState<{ latitude: number, longitude: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [unlinking, setUnlinking] = useState<string | null>(null);
  
  // Device Discovery
  const [isScanning, setIsScanning] = useState(false);
  const [availableDevices, setAvailableDevices] = useState<any[]>([]);

  const [showMap, setShowMap] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [mapRegion, setMapRegion] = useState<{ latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number } | undefined>(undefined);
  const [loadingGps, setLoadingGps] = useState(false);
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    if (userDetails) {
      setName(userDetails.name || '');
      setCommunity(userDetails.community || '');
      if (userDetails.latitude && userDetails.longitude) {
        setLocation({ latitude: userDetails.latitude, longitude: userDetails.longitude });
      }
    }
  }, [userDetails]);

  const myLinkedDevices = useMemo(() => {
    return Object.values(globalDevices);
  }, [globalDevices]);

  const scanForDevices = async () => {
    setIsScanning(true);
    setAvailableDevices([]);
    
    // Simulate scan duration
    setTimeout(async () => {
      // Find devices from the "Air" (MQTT) that have NO owner linked in Supabase
      const unowned = Object.values(allHeardDevices).filter(d => !d.profile_id);
      
      setAvailableDevices(unowned);
      setIsScanning(false);
      
      if (unowned.length === 0) {
        Alert.alert('None Found', 'No unlinked H-Fire devices were detected in the air. Ensure your ESP32 is powered on.');
      }
    }, 3000);
  };

  const linkDevice = async (mac: string) => {
    try {
      // 1. Update the device owner and house/community
      const { error } = await supabase
        .from('devices')
        .update({ 
          profile_id: profileId,
          house_name: name || 'Unnamed House',
          community: community || 'General'
        })
        .eq('mac', mac);
      
      if (error) throw error;

      // 2. 🔥 THE HISTORY FIX: Re-assign all previous logs for this MAC to this profile
      // This ensures that even if you unlinked/re-linked, you see the history of this device.
      // Alternatively, if you want history to be "fresh" for new owners, you can skip this.
      // But usually, the same user re-linking wants their history back.
      await supabase
        .from('gas_logs')
        .update({ profile_id: profileId })
        .eq('device_mac', mac);
      
      await supabase
        .from('incidents')
        .update({ profile_id: profileId })
        .eq('device_mac', mac);
      
      await refreshProfile(); // 🔥 FORCE REFRESH
      setAvailableDevices(prev => prev.filter(d => d.mac !== mac));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Device Linked!', 'You can now monitor this device from your Dashboard.');
    } catch (e) {
      Alert.alert('Error', 'Failed to claim device.');
    }
  };

  const handleUnlink = (mac: string, label: string) => {
    Alert.alert('Unlink Device', `Disconnect from ${label}?`, [
      { text: 'Cancel', style: 'cancel' },
      { 
        text: 'Unlink', style: 'destructive',
        onPress: async () => {
          setUnlinking(mac);
          try {
            await supabase.from('devices').update({ profile_id: null }).eq('mac', mac);
            // Note: We DON'T nullify logs here, so the next owner can claim them if desired,
            // or we keep them for the system. 
            await refreshProfile(); // 🔥 FORCE REFRESH
            
            const stored = await AsyncStorage.getItem('HFIRE_DEVICE_LABELS');
            if (stored) {
              const labels = JSON.parse(stored);
              delete labels[mac];
              await AsyncStorage.setItem('HFIRE_DEVICE_LABELS', JSON.stringify(labels));
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch (e) { Alert.alert('Error', 'Could not unlink.'); }
          finally { setUnlinking(null); }
        }
      }
    ]);
  };

  const handleSave = async () => {
    if (!name.trim()) return Alert.alert('Error', 'Name is required.');
    setSaving(true);
    try {
      const details = { name, community, latitude: location?.latitude, longitude: location?.longitude };
      await supabase.from('profiles').upsert({ id: profileId, ...details });
      
      // Also update ALL linked devices to match the new profile name/community
      await supabase.from('devices')
        .update({ house_name: name, community: community })
        .eq('profile_id', profileId);

      // Re-confirm all logs are tied to this profile (just in case)
      await supabase.from('gas_logs').update({ profile_id: profileId }).eq('profile_id', null); // This is a generic sweep

      await setUserDetails({ ...userDetails!, ...details });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Success', 'Profile updated.');
    } catch (err) { Alert.alert('Error', 'Failed to save.'); }
    finally { setSaving(false); }
  };

  const openMapModal = async () => {
    // If we already have a saved location, use that as the starting region
    if (location) {
      setMapRegion({
        latitude: location.latitude,
        longitude: location.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
      setShowMap(true);
      return;
    }

    // Otherwise, try to get the user's current GPS position
    setLoadingGps(true);
    setShowMap(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location access is needed to set your home. Defaulting to Manila.');
        setMapRegion({ latitude: 14.5995, longitude: 120.9842, latitudeDelta: 0.01, longitudeDelta: 0.01 });
        return;
      }
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = current.coords;
      const region = { latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 };
      setMapRegion(region);
      // Auto-pin to current location as a starting point
      setLocation({ latitude, longitude });
      setTimeout(() => mapRef.current?.animateToRegion(region, 800), 300);
    } catch (e) {
      Alert.alert('GPS Error', 'Could not get current location. Defaulting to Manila.');
      setMapRegion({ latitude: 14.5995, longitude: 120.9842, latitudeDelta: 0.01, longitudeDelta: 0.01 });
    } finally {
      setLoadingGps(false);
    }
  };

  const flyToMyLocation = async () => {
    setLoadingGps(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = current.coords;
      const region = { latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 };
      setMapRegion(region);
      setLocation({ latitude, longitude });
      mapRef.current?.animateToRegion(region, 800);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (e) {}
    finally { setLoadingGps(false); }
  };

  const verifyPin = async () => {
    if (pinInput === HOA_PIN || pinInput === SYSTEM_ADMIN_PIN) {
      await supabase.from('profiles').update({ is_admin: true }).eq('id', profileId);
      await setUserDetails({ ...userDetails!, is_admin: true });
      setShowPinModal(false); setPinInput(''); setAttempts(0);
      router.push('/(admin)/dashboard');
    } else {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      setPinInput('');
      if (newAttempts >= 5) Alert.alert('Access Denied', 'Ask System Administrator.');
      else Alert.alert('Wrong PIN', `Attempt ${newAttempts}/5`);
    }
  };

  const TabButton = ({ title, tab }: { title: string, tab: SettingsTab }) => (
    <TouchableOpacity 
      style={[styles.tabButton, activeTab === tab && { borderBottomColor: '#2196F3', borderBottomWidth: 3 }]}
      onPress={() => { setActiveTab(tab); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
    >
      <Text style={[styles.tabText, { color: activeTab === tab ? '#2196F3' : secondaryText }]}>{title}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['top']}>
      <View style={styles.header}>
        <ThemedText type="title" style={styles.title}>Settings</ThemedText>
      </View>

      <View style={styles.tabContainer}>
        <TabButton title="Profile" tab="PROFILE" />
        <TabButton title="Device" tab="DEVICE" />
        <TabButton title="Security" tab="ADMIN" />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {activeTab === 'PROFILE' && (
          <View style={styles.fadeAnim}>
            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={styles.sectionLabel}>PERSONAL INFORMATION</Text>
              <TextInput style={[styles.input, { backgroundColor: inputBg, color: textColor }]} value={name} onChangeText={setName} placeholder="Your Name" placeholderTextColor="#999" />
              <TextInput style={[styles.input, { backgroundColor: inputBg, color: textColor }]} value={community} onChangeText={setCommunity} placeholder="Community / Block" placeholderTextColor="#999" />
              <TouchableOpacity style={[styles.locBtn, { backgroundColor: inputBg }]} onPress={openMapModal}>
                <IconSymbol name="map.fill" size={18} color="#2196F3" />
                <Text style={[styles.locBtnText, { color: textColor }]}>{location ? 'Change Location' : 'Set Home Location'}</Text>
                {location && <View style={styles.locDot} />}
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
              </TouchableOpacity>
            </View>
            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={styles.sectionLabel}>THEME</Text>
              <View style={styles.themeRow}>
                {['light', 'dark', 'auto'].map((t) => (
                  <TouchableOpacity key={t} style={[styles.themeChip, { backgroundColor: theme === t ? '#2196F3' : inputBg }]} onPress={() => setTheme(t as any)}><Text style={[styles.themeChipText, { color: theme === t ? '#fff' : textColor }]}>{t.toUpperCase()}</Text></TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        )}

        {activeTab === 'DEVICE' && (
          <View style={styles.fadeAnim}>
            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={styles.sectionLabel}>CONNECTED HARDWARE</Text>
              {myLinkedDevices.length > 0 ? myLinkedDevices.map((dev) => (
                <View key={dev.mac} style={[styles.deviceRow, { backgroundColor: inputBg }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.deviceRowLabel, { color: textColor }]}>{dev.label}</Text>
                    <Text style={[styles.deviceRowSub, { color: secondaryText }]}>{dev.houseId} • {dev.community || 'General'}</Text>
                    <Text style={styles.deviceRowMac}>{dev.mac}</Text>
                  </View>
                  <TouchableOpacity style={styles.unlinkBtn} onPress={() => handleUnlink(dev.mac, dev.label)}>
                    {unlinking === dev.mac ? <ActivityIndicator size="small" color="#FF3B30" /> : <Text style={styles.unlinkText}>UNLINK</Text>}
                  </TouchableOpacity>
                </View>
              )) : (
                <Text style={{ color: secondaryText, textAlign: 'center', marginVertical: 10 }}>No devices currently linked.</Text>
              )}
            </View>

            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={styles.sectionLabel}>DEVICE DISCOVERY</Text>
              <TouchableOpacity 
                style={[styles.scanBtn, { borderColor: '#2196F3' }]} 
                onPress={scanForDevices}
                disabled={isScanning}
              >
                {isScanning ? <ActivityIndicator color="#2196F3" /> : (
                  <>
                    <IconSymbol name="magnifyingglass" size={18} color="#2196F3" />
                    <Text style={styles.scanBtnText}>Scan for New Device</Text>
                  </>
                )}
              </TouchableOpacity>

              {availableDevices.length > 0 && (
                <View style={{ marginTop: 20 }}>
                  <Text style={styles.foundTitle}>Available Devices Nearby:</Text>
                  {availableDevices.map(dev => (
                    <TouchableOpacity key={dev.mac} style={[styles.foundItem, { backgroundColor: inputBg }]} onPress={() => linkDevice(dev.mac)}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.foundMac, { color: textColor }]}>{dev.mac}</Text>
                        <Text style={styles.foundHouse}>Topic: {dev.house_name}</Text>
                      </View>
                      <IconSymbol name="plus.circle.fill" size={24} color="#34C759" />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          </View>
        )}

        {activeTab === 'ADMIN' && (
          <View style={styles.fadeAnim}>
            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={styles.sectionLabel}>ADMINISTRATOR</Text>
              {!isAdmin ? (
                <TouchableOpacity style={styles.adminEntryBtn} onPress={() => setShowPinModal(true)}>
                  <IconSymbol name="lock.fill" size={18} color="#fff" />
                  <Text style={styles.adminEntryText}>Unlock Admin</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity style={styles.adminEntryBtn} onPress={() => router.push('/(admin)/dashboard')}>
                    <IconSymbol name="chart.bar.fill" size={18} color="#fff" />
                    <Text style={styles.adminEntryText}>Open Monitor</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.adminEntryBtn, { backgroundColor: '#8E8E93', marginTop: 10 }]} onPress={async () => {
                    await supabase.from('profiles').update({ is_admin: false }).eq('id', profileId);
                    await setUserDetails({ ...userDetails!, is_admin: false });
                  }}><Text style={styles.adminEntryText}>Exit Admin</Text></TouchableOpacity>
                </>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* MAP MODAL */}
      <Modal visible={showMap} animationType="slide">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
          <View style={styles.mapModalContainer}>
            {/* Back Button */}
            <TouchableOpacity style={styles.mapBackBtn} onPress={() => setShowMap(false)}>
              <IconSymbol name="chevron.left" size={18} color="#fff" />
              <Text style={styles.mapBackText}>Back</Text>
            </TouchableOpacity>

            {mapRegion ? (
              <MapView
                ref={mapRef}
                provider={PROVIDER_GOOGLE}
                style={styles.map}
                region={mapRegion}
                onRegionChangeComplete={(r) => setMapRegion(r)}
                onLongPress={(e) => {
                  const coord = e.nativeEvent.coordinate;
                  setLocation(coord);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                }}
              >
                {location && (
                  <Marker
                    coordinate={location}
                    title="Your Home"
                    description="Long press anywhere to move"
                    pinColor="#2196F3"
                  />
                )}
              </MapView>
            ) : (
              <View style={styles.mapLoadingContainer}>
                <ActivityIndicator size="large" color="#2196F3" />
                <Text style={styles.mapLoadingText}>Getting your location...</Text>
              </View>
            )}

            <View style={styles.mapOverlay}>
              <Text style={styles.mapInstruction}>📍 Long press on the map to pin your home</Text>
              {location && (
                <Text style={styles.mapCoordsText}>
                  {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
                </Text>
              )}
              <View style={styles.mapBtnRow}>
                <TouchableOpacity style={styles.mapLocateBtn} onPress={flyToMyLocation} disabled={loadingGps}>
                  {loadingGps
                    ? <ActivityIndicator size="small" color="#2196F3" />
                    : <IconSymbol name="location.fill" size={16} color="#2196F3" />}
                  <Text style={styles.mapLocateBtnText}>My Location</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.mapConfirmBtn, !location && { opacity: 0.4 }]}
                  onPress={() => {
                    if (!location) { Alert.alert('No pin set', 'Long press on the map to set your home location.'); return; }
                    setShowMap(false);
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  }}
                  disabled={!location}
                >
                  <Text style={styles.mapConfirmText}>Confirm Location</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      {/* PIN MODAL placeholder (kept from previous code) */}
      <Modal visible={showPinModal} animationType="fade" transparent>
        <View style={styles.pinOverlay}>
          <KeyboardAvoidingView behavior="padding" style={styles.pinContent}>
            <View style={[styles.pinCard, { backgroundColor: cardBg }]}>
              <Text style={[styles.pinTitle, { color: textColor }]}>Security PIN</Text>
              <TextInput style={[styles.pinInput, { backgroundColor: inputBg, color: textColor }]} value={pinInput} onChangeText={setPinInput} keyboardType="number-pad" maxLength={4} secureTextEntry autoFocus />
              <View style={styles.pinActions}>
                <TouchableOpacity onPress={() => setShowPinModal(false)}><Text style={{ color: secondaryText, fontWeight: '700' }}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity onPress={verifyPin} style={styles.pinVerify}><Text style={{ color: '#fff', fontWeight: '900' }}>Verify</Text></TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 25, paddingTop: 20 },
  title: { fontSize: 34, fontWeight: '900' },
  tabContainer: { flexDirection: 'row', paddingHorizontal: 25, marginTop: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  tabButton: { paddingVertical: 12, marginRight: 25 },
  tabText: { fontSize: 15, fontWeight: '800' },
  scrollContent: { padding: 20, paddingTop: 25 },
  fadeAnim: { flex: 1 },
  section: { borderRadius: 20, padding: 20, marginBottom: 20, ...Platform.select({ ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10 }, android: { elevation: 2 } }) },
  sectionLabel: { fontSize: 11, fontWeight: '900', color: '#8e8e93', marginBottom: 15, letterSpacing: 1 },
  input: { borderRadius: 12, padding: 16, fontSize: 16, marginBottom: 12, fontWeight: '600' },
  locBtn: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 12, marginBottom: 20 },
  locBtnText: { marginLeft: 10, fontWeight: '700', fontSize: 15 },
  saveBtn: { backgroundColor: '#2196F3', padding: 18, borderRadius: 15, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '900', fontSize: 16 },
  themeRow: { flexDirection: 'row', gap: 10 },
  themeChip: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  themeChipText: { fontSize: 10, fontWeight: '900' },
  deviceRow: { flexDirection: 'row', alignItems: 'center', padding: 15, borderRadius: 12, marginBottom: 10 },
  deviceRowLabel: { fontSize: 15, fontWeight: '800' },
  deviceRowSub: { fontSize: 12, fontWeight: '600', marginTop: 1 },
  deviceRowMac: { fontSize: 10, color: '#8e8e93', fontWeight: '600', marginTop: 2 },
  unlinkBtn: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#FF3B30' },
  unlinkText: { color: '#FF3B30', fontSize: 10, fontWeight: '900' },
  scanBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 18, borderRadius: 15, borderStyle: 'dashed', borderWidth: 2 },
  scanBtnText: { color: '#2196F3', fontWeight: '900', fontSize: 15, marginLeft: 10 },
  foundTitle: { fontSize: 12, fontWeight: '800', color: '#8e8e93', marginBottom: 10 },
  foundItem: { flexDirection: 'row', alignItems: 'center', padding: 15, borderRadius: 12, marginBottom: 10 },
  foundMac: { fontSize: 14, fontWeight: '800' },
  foundHouse: { fontSize: 10, color: '#8e8e93', marginTop: 2 },
  adminEntryBtn: { backgroundColor: '#1a1a1a', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 18, borderRadius: 15 },
  adminEntryText: { color: '#fff', fontWeight: '900', fontSize: 15, marginLeft: 10 },
  idBox: { padding: 15, borderRadius: 12 },
  idText: { fontSize: 13, fontWeight: '800', textAlign: 'center' },
  helperText: { fontSize: 11, color: '#8e8e93', marginTop: 10, textAlign: 'center' },
  pinOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  pinContent: { width: width * 0.8 },
  pinCard: { padding: 30, borderRadius: 25, alignItems: 'center' },
  pinTitle: { fontSize: 20, fontWeight: '900', marginBottom: 20 },
  pinInput: { width: '100%', padding: 20, borderRadius: 15, fontSize: 32, textAlign: 'center', fontWeight: '900', letterSpacing: 10 },
  pinActions: { flexDirection: 'row', width: '100%', justifyContent: 'space-between', alignItems: 'center', marginTop: 25 },
  pinVerify: { backgroundColor: '#2196F3', paddingHorizontal: 25, paddingVertical: 12, borderRadius: 12 },
  
  // Map Modal Styles
  mapModalContainer: { flex: 1, backgroundColor: '#000' },
  map: { flex: 1 },
  mapBackBtn: { position: 'absolute', top: 16, left: 16, zIndex: 10, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  mapBackText: { color: '#fff', fontSize: 13, fontWeight: '800', marginLeft: 4 },
  mapLoadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111' },
  mapLoadingText: { color: '#aaa', marginTop: 12, fontWeight: '700', fontSize: 14 },
  mapOverlay: { position: 'absolute', bottom: 30, left: 16, right: 16, backgroundColor: 'rgba(255,255,255,0.96)', padding: 20, borderRadius: 24, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 20, elevation: 10 },
  mapInstruction: { fontSize: 14, fontWeight: '700', color: '#444', marginBottom: 6, textAlign: 'center' },
  mapCoordsText: { fontSize: 11, fontWeight: '700', color: '#2196F3', marginBottom: 14, letterSpacing: 0.5 },
  mapBtnRow: { flexDirection: 'row', gap: 10, width: '100%', alignItems: 'center' },
  mapLocateBtn: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: '#2196F3', paddingHorizontal: 16, paddingVertical: 13, borderRadius: 15, gap: 6 },
  mapLocateBtnText: { color: '#2196F3', fontWeight: '900', fontSize: 13 },
  mapConfirmBtn: { flex: 1, backgroundColor: '#2196F3', padding: 16, borderRadius: 15, alignItems: 'center' },
  mapConfirmText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  locDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#34C759', marginLeft: 8 }
});
