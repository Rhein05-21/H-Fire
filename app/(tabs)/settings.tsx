import MapView, { Marker, PROVIDER_GOOGLE } from '@/components/Map';
import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAppTheme } from '@/context/ThemeContext';
import { useUser } from '@/context/UserContext';
import { useThemeColor } from '@/hooks/use-theme-color';
import { supabase } from '@/utils/supabase';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

const { width } = Dimensions.get('window');
const HOA_PIN = '1111';
const SYSTEM_ADMIN_PIN = '2222';

type SettingsTab = 'PROFILE' | 'DEVICE' | 'ADMIN';

export default function SettingsScreen() {
  const router = useRouter();
  const systemColorScheme = useColorScheme();
  const { theme, setTheme } = useAppTheme();
  const { userDetails, profileId, isAdmin, devices: globalDevices, allHeardDevices, refreshProfile, signOut, updateProfile } = useUser();
  
  const backgroundColor = useThemeColor({}, 'background');
  const textColor = useThemeColor({}, 'text');
  const cardBg = useThemeColor({ light: '#fff', dark: '#1c1c1e' }, 'background');
  const inputBg = useThemeColor({ light: '#f2f2f7', dark: '#2c2c2e' }, 'background');
  const secondaryText = useThemeColor({ light: '#8e8e93', dark: '#8e8e93' }, 'text');
  
  const placeholderColor = systemColorScheme === 'dark' ? 'rgba(255,255,255,0.4)' : '#a1a1aa';

  const [activeTab, setActiveTab] = useState<SettingsTab>('PROFILE');
  const [showAdminTab, setShowAdminTab] = useState(false);
  
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [firstNameError, setFirstNameError] = useState('');
  const [lastNameError, setLastNameError] = useState('');
  const [blockLot, setBlockLot] = useState('');
  const [address, setAddress] = useState('');
  const [location, setLocation] = useState<{ latitude: number, longitude: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [unlinking, setUnlinking] = useState<string | null>(null);
  
  const [isScanning, setIsScanning] = useState(false);
  const [availableDevices, setAvailableDevices] = useState<any[]>([]);

  const [showMap, setShowMap] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showNoChangesModal, setShowNoChangesModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [loadingGps, setLoadingGps] = useState(false);

  const hasChanges = useMemo(() => {
    if (!userDetails) return false;
    const combinedName = `${lastName.trim()}, ${firstName.trim()}${middleName ? ' ' + middleName.trim() : ''}`;
    const initialLocation = userDetails.latitude && userDetails.longitude ? { latitude: userDetails.latitude, longitude: userDetails.longitude } : null;

    return (
      combinedName !== (userDetails.name || '') ||
      blockLot.trim() !== (userDetails.block_lot || '') ||
      address.trim() !== (userDetails.address || '') ||
      location?.latitude !== initialLocation?.latitude ||
      location?.longitude !== initialLocation?.longitude
    );
  }, [firstName, middleName, lastName, blockLot, address, location, userDetails]);

  useEffect(() => {
    if (userDetails) {
      const fullName = userDetails.name || '';
      if (fullName.includes(',')) {
        const [last, rest] = fullName.split(',').map(s => s.trim());
        setLastName(last || '');
        if (rest) {
          const parts = rest.split(' ');
          setFirstName(parts[0] || '');
          setMiddleName(parts.slice(1).join(' ') || '');
        }
      } else {
        setFirstName(fullName);
      }
      setBlockLot(userDetails.block_lot || '');
      setAddress(userDetails.address || '');
      if (userDetails.latitude && userDetails.longitude) {
        setLocation({ latitude: userDetails.latitude, longitude: userDetails.longitude });
      }
    }
  }, [userDetails]);

  const myLinkedDevices = useMemo(() => Object.values(globalDevices), [globalDevices]);

  const scanForDevices = async () => {
    setIsScanning(true);
    setAvailableDevices([]);
    await refreshProfile();
    setTimeout(async () => {
      const unowned = Object.values(allHeardDevices).filter(heard => {
        const normalizedMac = heard.mac.toUpperCase();
        const isAlreadyLinked = globalDevices[normalizedMac] !== undefined;
        return !isAlreadyLinked;
      });
      setAvailableDevices(unowned);
      setIsScanning(false);
      if (unowned.length === 0) Alert.alert('None Found', 'No unlinked H-Fire devices detected.');
    }, 2000);
  };

  const linkDevice = async (mac: string) => {
    if (myLinkedDevices.length >= 4) {
      Alert.alert('Limit Reached', 'You can only link up to 4 devices.');
      return;
    }
    try {
      const normalizedMac = mac.toUpperCase();
      const combinedName = `${lastName.trim()}, ${firstName.trim()}${middleName ? ' ' + middleName.trim() : ''}`;
      const { error } = await supabase.from('devices').upsert({ 
        mac: normalizedMac,
        profile_id: profileId, 
        house_name: combinedName || 'Unnamed House', 
        block_lot: blockLot || 'General',
        label: `Device ${normalizedMac.slice(-4)}`
      }, { onConflict: 'mac' });
      if (error) throw error;
      await refreshProfile();
      setAvailableDevices(prev => prev.filter(d => d.mac.toUpperCase() !== normalizedMac));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Device Linked!');
    } catch (e) { Alert.alert('Error', 'Failed to claim device.'); }
  };

  const handleUnlink = (mac: string, label: string) => {
    Alert.alert('Unlink Device', `Disconnect from ${label}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unlink', style: 'destructive', onPress: async () => {
        setUnlinking(mac);
        try { await supabase.from('devices').update({ profile_id: null }).eq('mac', mac); await refreshProfile(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
        catch (e) { Alert.alert('Error', 'Could not unlink.'); }
        finally { setUnlinking(null); }
      }}
    ]);
  };

  const validateFirstName = (text: string) => {
    const cleaned = text.replace(/[0-9]/g, '');
    setFirstName(cleaned);
    if (cleaned.trim().length < 2) setFirstNameError('At least 2 characters');
    else setFirstNameError('');
  };

  const validateLastName = (text: string) => {
    const cleaned = text.replace(/[0-9]/g, '');
    setLastName(cleaned);
    if (cleaned.trim().length < 2) setLastNameError('At least 2 characters');
    else setLastNameError('');
  };

  const handleSave = () => {
    if (!firstName.trim() || !lastName.trim() || !blockLot.trim()) return Alert.alert('Error', 'Required fields missing.');
    if (!hasChanges) return setShowNoChangesModal(true);
    setShowSaveModal(true);
  };

  const confirmSave = async () => {
    setShowSaveModal(false);
    setSaving(true);
    try {
      const combinedName = `${lastName.trim()}, ${firstName.trim()}${middleName ? ' ' + middleName.trim() : ''}`;
      const details = { name: combinedName, block_lot: blockLot, address: address.trim(), latitude: location?.latitude, longitude: location?.longitude };
      await updateProfile(details);
      await supabase.from('devices').update({ house_name: combinedName, block_lot: blockLot }).eq('profile_id', profileId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Success', 'Profile updated.');
    } catch (err) { Alert.alert('Error', 'Failed to save.'); }
    finally { setSaving(false); }
  };

  const confirmSignOut = async () => {
    setShowSignOutModal(false);
    try { await signOut(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
    catch (e) { Alert.alert('Error', 'Failed to sign out.'); }
  };

  const constructAddress = (rev: any) => {
    const parts = [];
    if (rev.name && rev.name !== rev.street) parts.push(rev.name);
    if (rev.streetNumber) parts.push(rev.streetNumber);
    if (rev.street) parts.push(rev.street);
    if (rev.subregion) parts.push(rev.subregion);
    if (rev.district) parts.push(rev.district);
    if (rev.city) parts.push(rev.city);
    if (rev.region) parts.push(rev.region);
    return parts.filter(Boolean).join(', ');
  };

  const mapHtml = useMemo(() => {
    const initialLat = location?.latitude || 14.5995;
    const initialLng = location?.longitude || 120.9842;
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          body { margin: 0; padding: 0; }
          #map { height: 100vh; width: 100vw; }
          .leaflet-control-attribution { display: none; }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var map = L.map('map').setView([${initialLat}, ${initialLng}], 16);
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
          var marker = L.marker([${initialLat}, ${initialLng}], { draggable: true }).addTo(map);
          function updatePos(lat, lng) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ latitude: lat, longitude: lng }));
          }
          map.on('click', function(e) {
            marker.setLatLng(e.latlng);
            updatePos(e.latlng.lat, e.latlng.lng);
          });
          marker.on('dragend', function(e) {
            updatePos(e.target.getLatLng().lat, e.target.getLatLng().lng);
          });
        </script>
      </body>
      </html>
    `;
  }, [showMap, location]);

  const onMapMessage = (event: any) => {
    try {
      const coords = JSON.parse(event.nativeEvent.data);
      setLocation(coords);
      Location.reverseGeocodeAsync(coords).then(([rev]: any) => {
        if (rev) setAddress(constructAddress(rev));
      });
    } catch (e) {}
  };

  const flyToMyLocation = async () => {
    setLoadingGps(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords = { latitude: current.coords.latitude, longitude: current.coords.longitude };
      setLocation(coords);
      const [rev] = await Location.reverseGeocodeAsync(coords);
      if (rev) setAddress(constructAddress(rev));
    } catch (e) {}
    finally { setLoadingGps(false); }
  };

  const verifyPin = async () => {
    if (pinInput === HOA_PIN || pinInput === SYSTEM_ADMIN_PIN) {
      await updateProfile({ ...userDetails!, is_admin: true });
      setShowPinModal(false); setPinInput('');
      router.push('/(admin)/dashboard');
    } else { Alert.alert('Wrong PIN'); }
  };

  const TabButton = ({ title, tab }: { title: string, tab: SettingsTab }) => (
    <TouchableOpacity style={[styles.tabButton, activeTab === tab && { borderBottomColor: '#2196F3', borderBottomWidth: 3 }]} onPress={() => { setActiveTab(tab); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}>
      <Text style={[styles.tabText, { color: activeTab === tab ? '#2196F3' : secondaryText }]}>{title}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onLongPress={() => setShowAdminTab(true)} delayLongPress={3000} activeOpacity={1}>
          <ThemedText type="title" style={styles.title}>Settings</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowSignOutModal(true)} style={styles.headerSignOutBtn}>
          <IconSymbol name="arrow.left.square.fill" size={16} color="#FF3B30" />
          <Text style={styles.headerSignOutText}>SIGN OUT</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabContainer}>
        <TabButton title="Profile" tab="PROFILE" />
        <TabButton title="Device" tab="DEVICE" />
        {showAdminTab && <TabButton title="Security" tab="ADMIN" />}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {activeTab === 'PROFILE' && (
          <View>
            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={styles.sectionLabel}>PERSONAL INFORMATION</Text>
              <View style={styles.inputGroup}>
                <View>
                  <Text style={styles.fieldLabel}>FIRST NAME</Text>
                  <TextInput style={[styles.input, { backgroundColor: inputBg, color: textColor }]} value={firstName} onChangeText={validateFirstName} placeholder="Enter first name" placeholderTextColor={placeholderColor} />
                </View>
                <View>
                  <Text style={styles.fieldLabel}>LAST NAME</Text>
                  <TextInput style={[styles.input, { backgroundColor: inputBg, color: textColor }]} value={lastName} onChangeText={validateLastName} placeholder="Enter last name" placeholderTextColor={placeholderColor} />
                </View>
                <View>
                  <Text style={styles.fieldLabel}>COMMUNITY / BLOCK & LOT</Text>
                  <TextInput style={[styles.input, { backgroundColor: inputBg, color: textColor }]} value={blockLot} onChangeText={setBlockLot} placeholder="e.g. Block 1 Lot 1" placeholderTextColor={placeholderColor} />
                </View>
                <View>
                  <Text style={styles.fieldLabel}>DETAILED HOUSEHOLD ADDRESS</Text>
                  <TextInput style={[styles.input, { backgroundColor: inputBg, color: textColor }]} value={address} onChangeText={setAddress} placeholder="House No., Street name, etc." placeholderTextColor={placeholderColor} multiline />
                </View>
              </View>

              <TouchableOpacity style={[styles.locBtn, { backgroundColor: inputBg }]} onPress={() => setShowMap(true)}>
                <IconSymbol name="map.fill" size={18} color="#2196F3" />
                <Text style={[styles.locBtnText, { color: textColor }]}>{location ? 'Change Location' : 'Set Home Location'}</Text>
                {location && <View style={styles.locDot} />}
              </TouchableOpacity>

              <TouchableOpacity style={[styles.locBtn, { backgroundColor: inputBg, marginTop: 10 }]} onPress={() => router.push('/family-members')}>
                <IconSymbol name="person.2.fill" size={18} color="#2196F3" />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[styles.locBtnText, { color: textColor, marginLeft: 0 }]}>Household Members</Text>
                  <Text style={{ fontSize: 11, color: secondaryText, fontWeight: '600' }}>Contacts & residents</Text>
                </View>
                <IconSymbol name="chevron.right" size={14} color={secondaryText} />
              </TouchableOpacity>

              <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
              </TouchableOpacity>
            </View>

            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={styles.sectionLabel}>APPEARANCE</Text>
              <View style={styles.themeRow}>
                {(['light', 'dark', 'auto'] as const).map((t) => (
                  <TouchableOpacity key={t} style={[styles.themeChip, { backgroundColor: theme === t ? '#2196F3' : inputBg }]} onPress={() => setTheme(t)}>
                    <Text style={[styles.themeChipText, { color: theme === t ? '#fff' : textColor }]}>{t.toUpperCase()}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        )}

        {activeTab === 'DEVICE' && (
          <View>
            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={styles.sectionLabel}>CONNECTED HARDWARE</Text>
              {myLinkedDevices.length > 0 ? myLinkedDevices.map((dev: any) => (
                <View key={dev.mac} style={[styles.deviceRow, { backgroundColor: inputBg }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.deviceRowLabel, { color: textColor }]}>{dev.label || 'H-Fire Device'}</Text>
                    <Text style={[styles.deviceRowSub, { color: secondaryText }]}>{dev.mac}</Text>
                  </View>
                  <TouchableOpacity style={styles.unlinkBtn} onPress={() => handleUnlink(dev.mac, dev.label)}>
                    <Text style={styles.unlinkText}>UNLINK</Text>
                  </TouchableOpacity>
                </View>
              )) : <Text style={{ color: secondaryText, textAlign: 'center' }}>No devices linked.</Text>}
            </View>
          </View>
        )}
      </ScrollView>

      {/* WEBVIEW MAP MODAL */}
      <Modal visible={showMap} animationType="slide">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['top', 'bottom']}>
          <View style={styles.mapModalContainer}>
            <TouchableOpacity style={styles.mapBackBtn} onPress={() => setShowMap(false)}>
              <IconSymbol name="chevron.left" size={18} color="#fff" />
              <Text style={styles.mapBackText}>Back</Text>
            </TouchableOpacity>

            <WebView originWhitelist={['*']} source={{ html: mapHtml }} onMessage={onMapMessage} style={styles.map} />

            <View style={styles.mapOverlay}>
              <Text style={styles.mapInstruction}>📍 Tap map or drag pin to your home</Text>
              <View style={styles.mapBtnRow}>
                <TouchableOpacity style={styles.mapLocateBtn} onPress={flyToMyLocation}>
                  <IconSymbol name="location.fill" size={16} color="#2196F3" />
                  <Text style={styles.mapLocateBtnText}>My Location</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.mapConfirmBtn} onPress={() => setShowMap(false)}>
                  <Text style={styles.mapConfirmText}>Confirm</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      {/* SUPPORTING MODALS */}
      <Modal visible={showPinModal} animationType="fade" transparent>
        <View style={styles.pinOverlay}>
          <View style={[styles.pinCard, { backgroundColor: cardBg }]}>
            <Text style={[styles.pinTitle, { color: textColor }]}>Security PIN</Text>
            <TextInput style={[styles.pinInput, { backgroundColor: inputBg, color: textColor }]} value={pinInput} onChangeText={setPinInput} keyboardType="number-pad" maxLength={4} secureTextEntry autoFocus />
            <View style={styles.pinActions}>
              <TouchableOpacity onPress={() => setShowPinModal(false)}><Text style={{ color: secondaryText }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={verifyPin} style={styles.pinVerify}><Text style={{ color: '#fff' }}>Verify</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showSignOutModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: cardBg }]}>
            <Text style={[styles.modalTitle, { color: textColor }]}>Sign Out</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalBtn} onPress={() => setShowSignOutModal(false)}><Text style={{ color: textColor }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#FF3B30' }]} onPress={confirmSignOut}><Text style={{ color: '#fff' }}>Sign Out</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showSaveModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: cardBg }]}>
            <Text style={[styles.modalTitle, { color: textColor }]}>Save Changes?</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalBtn} onPress={() => setShowSaveModal(false)}><Text style={{ color: textColor }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#2196F3' }]} onPress={confirmSave}><Text style={{ color: '#fff' }}>Save</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showNoChangesModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: cardBg }]}>
            <Text style={[styles.modalTitle, { color: textColor }]}>No Changes</Text>
            <TouchableOpacity style={styles.modalBtn} onPress={() => setShowNoChangesModal(false)}><Text style={{ color: textColor }}>OK</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 25, paddingTop: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerSignOutBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255, 59, 48, 0.1)', padding: 10, borderRadius: 12 },
  headerSignOutText: { color: '#FF3B30', fontSize: 11, fontWeight: '900' },
  title: { fontSize: 34, fontWeight: '900' },
  tabContainer: { flexDirection: 'row', paddingHorizontal: 25, marginTop: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  tabButton: { paddingVertical: 12, marginRight: 25 },
  tabText: { fontSize: 15, fontWeight: '800' },
  scrollContent: { padding: 20, paddingBottom: 100 },
  section: { borderRadius: 24, padding: 20, marginBottom: 20 },
  sectionLabel: { fontSize: 11, fontWeight: '900', color: '#8e8e93', marginBottom: 15 },
  fieldLabel: { fontSize: 10, fontWeight: '800', color: '#8e8e93', marginBottom: 4 },
  inputGroup: { gap: 15, marginBottom: 15 },
  input: { borderRadius: 14, padding: 16, fontSize: 16, fontWeight: '600' },
  inputError: { borderWidth: 1, borderColor: '#FF3B30' },
  errorText: { color: '#FF3B30', fontSize: 11, fontWeight: '700' },
  locBtn: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 14 },
  locBtnText: { marginLeft: 10, fontWeight: '700', fontSize: 15 },
  saveBtn: { backgroundColor: '#2196F3', padding: 18, borderRadius: 16, alignItems: 'center', marginTop: 20 },
  saveBtnText: { color: '#fff', fontWeight: '900', fontSize: 16 },
  themeRow: { flexDirection: 'row', gap: 10 },
  themeChip: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  themeChipText: { fontSize: 11, fontWeight: '900' },
  deviceRow: { flexDirection: 'row', alignItems: 'center', padding: 15, borderRadius: 12, marginBottom: 10 },
  deviceRowLabel: { fontSize: 15, fontWeight: '800' },
  deviceRowSub: { fontSize: 12, fontWeight: '600' },
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
  pinOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  pinCard: { padding: 30, borderRadius: 25, width: '80%' },
  pinTitle: { fontSize: 20, fontWeight: '900', marginBottom: 20 },
  pinInput: { width: '100%', padding: 20, borderRadius: 15, fontSize: 32, textAlign: 'center', fontWeight: '900', letterSpacing: 10 },
  pinActions: { flexDirection: 'row', width: '100%', justifyContent: 'space-between', alignItems: 'center', marginTop: 25 },
  pinVerify: { backgroundColor: '#2196F3', paddingHorizontal: 25, paddingVertical: 12, borderRadius: 12 },
  mapModalContainer: { flex: 1, backgroundColor: '#000' },
  map: { flex: 1 },
  mapBackBtn: { position: 'absolute', top: 16, left: 16, zIndex: 10, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  mapBackText: { color: '#fff', fontSize: 13, fontWeight: '800', marginLeft: 4 },
  mapOverlay: { position: 'absolute', bottom: 30, left: 16, right: 16, backgroundColor: 'rgba(255,255,255,0.96)', padding: 20, borderRadius: 24, alignItems: 'center', elevation: 10 },
  mapInstruction: { fontSize: 14, fontWeight: '700', color: '#444', marginBottom: 14 },
  mapBtnRow: { flexDirection: 'row', gap: 10, width: '100%', alignItems: 'center' },
  mapLocateBtn: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: '#2196F3', paddingHorizontal: 16, paddingVertical: 13, borderRadius: 15, gap: 6 },
  mapLocateBtnText: { color: '#2196F3', fontWeight: '900', fontSize: 13 },
  mapConfirmBtn: { flex: 1, backgroundColor: '#2196F3', padding: 16, borderRadius: 15, alignItems: 'center' },
  mapConfirmText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  locDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#34C759', marginLeft: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 340, borderRadius: 28, padding: 25, alignItems: 'center' },
  modalTitle: { fontSize: 22, fontWeight: '900', marginBottom: 10 },
  modalMessage: { fontSize: 15, fontWeight: '600', textAlign: 'center', marginBottom: 25 },
  modalActions: { flexDirection: 'row', gap: 12, width: '100%' },
  modalBtn: { flex: 1, paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(128,128,128,0.1)' }
});