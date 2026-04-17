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
  const [community, setCommunity] = useState('');
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

  // DETECT IF FORM HAS CHANGES
  const hasChanges = useMemo(() => {
    if (!userDetails) return false;
    const combinedName = `${lastName.trim()}, ${firstName.trim()}${middleName ? ' ' + middleName.trim() : ''}`;
    const initialLocation = userDetails.latitude && userDetails.longitude ? { latitude: userDetails.latitude, longitude: userDetails.longitude } : null;

    return (
      combinedName !== (userDetails.name || '') ||
      community.trim() !== (userDetails.block_lot || '') ||
      address.trim() !== (userDetails.address || '') ||
      location?.latitude !== initialLocation?.latitude ||
      location?.longitude !== initialLocation?.longitude
    );
  }, [firstName, middleName, lastName, community, address, location, userDetails]);

  const [attempts, setAttempts] = useState(0);
  const [mapRegion, setMapRegion] = useState<{ latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number } | undefined>(undefined);
  const [loadingGps, setLoadingGps] = useState(false);
  const mapRef = useRef<MapView>(null);

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

      setCommunity(userDetails.block_lot || '');
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
    setTimeout(async () => {
      const unowned = Object.values(allHeardDevices).filter(d => !d.profile_id);
      setAvailableDevices(unowned);
      setIsScanning(false);
      if (unowned.length === 0) Alert.alert('None Found', 'No unlinked H-Fire devices detected.');
    }, 3000);
  };

  const linkDevice = async (mac: string) => {
    try {
      const combinedName = `${lastName.trim()}, ${firstName.trim()}${middleName ? ' ' + middleName.trim() : ''}`;
      const { error } = await supabase.from('devices').update({ profile_id: profileId, house_name: combinedName || 'Unnamed House', community: community || 'General' }).eq('mac', mac);
      if (error) throw error;
      await refreshProfile();
      setAvailableDevices(prev => prev.filter(d => d.mac !== mac));
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

  const handleSave = () => {
    if (!firstName.trim() || !lastName.trim()) return Alert.alert('Error', 'First and Last name are required.');

    if (!hasChanges) {
      setShowNoChangesModal(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    setShowSaveModal(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const confirmSave = async () => {
    setShowSaveModal(false);
    setSaving(true);
    try {
      const combinedName = `${lastName.trim()}, ${firstName.trim()}${middleName ? ' ' + middleName.trim() : ''}`;
      const details = { name: combinedName, block_lot: community, address: address.trim(), latitude: location?.latitude, longitude: location?.longitude };
      const { error } = await updateProfile(details);
      if (error) throw error;
      
      await supabase.from('devices').update({ house_name: combinedName, block_lot: community }).eq('profile_id', profileId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Success', 'Profile updated.');
    } catch (err) { 
      Alert.alert('Error', 'Failed to save.'); 
    } finally { 
      setSaving(false); 
    }
  };

  const handleSignOut = () => {
    setShowSignOutModal(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const confirmSignOut = async () => {
    setShowSignOutModal(false);
    try { 
      await signOut(); 
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); 
    } catch (e) { 
      Alert.alert('Error', 'Failed to sign out.'); 
    }
  };

  const constructAddress = (rev: Location.LocationGeocodedAddress) => {
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

  const openMapModal = async () => {
    if (location) {
      setMapRegion({ latitude: location.latitude, longitude: location.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 });
      setShowMap(true);
      return;
    }
    setLoadingGps(true);
    setShowMap(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setMapRegion({ latitude: 14.5995, longitude: 120.9842, latitudeDelta: 0.01, longitudeDelta: 0.01 });
        return;
      }
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords = { latitude: current.coords.latitude, longitude: current.coords.longitude };
      setMapRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 });
      setLocation(coords);
      
      const [rev] = await Location.reverseGeocodeAsync(coords);
      if (rev) setAddress(constructAddress(rev));
    } catch (e) {
      setMapRegion({ latitude: 14.5995, longitude: 120.9842, latitudeDelta: 0.01, longitudeDelta: 0.01 });
    } finally { setLoadingGps(false); }
  };

  const flyToMyLocation = async () => {
    setLoadingGps(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords = { latitude: current.coords.latitude, longitude: current.coords.longitude };
      setMapRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 });
      setLocation(coords);
      mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 1000);
      
      const [rev] = await Location.reverseGeocodeAsync(coords);
      if (rev) setAddress(constructAddress(rev));
    } catch (e) {}
    finally { setLoadingGps(false); }
  };

  const verifyPin = async () => {
    if (pinInput === HOA_PIN || pinInput === SYSTEM_ADMIN_PIN) {
      await updateProfile({ ...userDetails!, is_admin: true });
      setShowPinModal(false); setPinInput(''); setAttempts(0);
      router.push('/(admin)/dashboard');
    } else {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      setPinInput('');
      if (newAttempts >= 5) Alert.alert('Access Denied');
      else Alert.alert('Wrong PIN', `Attempt ${newAttempts}/5`);
    }
  };

  const TabButton = ({ title, tab }: { title: string, tab: SettingsTab }) => (
    <TouchableOpacity style={[styles.tabButton, activeTab === tab && { borderBottomColor: '#2196F3', borderBottomWidth: 3 }]} onPress={() => { setActiveTab(tab); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}>
      <Text style={[styles.tabText, { color: activeTab === tab ? '#2196F3' : secondaryText }]}>{title}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor }]} edges={['top']}>
      {/* HEADER WITH SIGN OUT BUTTON */}
      <View style={styles.header}>
        <TouchableOpacity onLongPress={() => setShowAdminTab(true)} delayLongPress={3000} activeOpacity={1}>
          <ThemedText type="title" style={styles.title}>Settings</ThemedText>
        </TouchableOpacity>
        
        <TouchableOpacity onPress={handleSignOut} style={styles.headerSignOutBtn}>
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
          <View style={styles.fadeAnim}>
            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={styles.sectionLabel}>PERSONAL INFORMATION</Text>
              <View style={styles.inputGroup}>
                <View>
                  <Text style={styles.fieldLabel}>FIRST NAME</Text>
                  <TextInput 
                    style={[styles.input, { backgroundColor: inputBg, color: textColor }]} 
                    value={firstName} 
                    onChangeText={setFirstName} 
                    placeholder="Enter first name" 
                    placeholderTextColor={placeholderColor}
                    maxLength={50} 
                  />
                </View>

                <View>
                  <Text style={styles.fieldLabel}>MIDDLE NAME (OPTIONAL)</Text>
                  <TextInput 
                    style={[styles.input, { backgroundColor: inputBg, color: textColor }]} 
                    value={middleName} 
                    onChangeText={setMiddleName} 
                    placeholder="Enter middle name" 
                    placeholderTextColor={placeholderColor}
                    maxLength={50} 
                  />
                </View>

                <View>
                  <Text style={styles.fieldLabel}>LAST NAME</Text>
                  <TextInput 
                    style={[styles.input, { backgroundColor: inputBg, color: textColor }]} 
                    value={lastName} 
                    onChangeText={setLastName} 
                    placeholder="Enter last name" 
                    placeholderTextColor={placeholderColor}
                    maxLength={50} 
                  />
                </View>

                <View>
                  <Text style={styles.fieldLabel}>COMMUNITY / BLOCK & LOT</Text>
                  <TextInput 
                    style={[styles.input, { backgroundColor: inputBg, color: textColor }]} 
                    value={community} 
                    onChangeText={setCommunity} 
                    placeholder="e.g. Block 1 Lot 1" 
                    placeholderTextColor={placeholderColor}
                    maxLength={100} 
                  />
                </View>

                <View>
                  <Text style={styles.fieldLabel}>DETAILED HOUSEHOLD ADDRESS</Text>
                  <TextInput 
                    style={[styles.input, { backgroundColor: inputBg, color: textColor }]} 
                    value={address} 
                    onChangeText={setAddress} 
                    placeholder="House No., Street name, etc." 
                    placeholderTextColor={placeholderColor}
                    maxLength={250} 
                    multiline 
                  />
                </View>
              </View>

              <TouchableOpacity style={[styles.locBtn, { backgroundColor: inputBg }]} onPress={openMapModal}>
                <IconSymbol name="map.fill" size={18} color="#2196F3" />
                <Text style={[styles.locBtnText, { color: textColor }]}>{location ? 'Change Location' : 'Set Home Location'}</Text>
                {location && <View style={styles.locDot} />}
              </TouchableOpacity>

              <TouchableOpacity style={[styles.locBtn, { backgroundColor: inputBg, marginTop: 10 }]} onPress={() => router.push('/family-members')}>
                <IconSymbol name="person.2.fill" size={18} color="#2196F3" />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[styles.locBtnText, { color: textColor, marginLeft: 0 }]}>Household Members</Text>
                  <Text style={{ fontSize: 11, color: secondaryText, fontWeight: '600' }}>Emergency contacts & residents</Text>
                </View>
                <IconSymbol name="chevron.right" size={14} color={secondaryText} />
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.saveBtn} 
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
              </TouchableOpacity>
            </View>

            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={styles.sectionLabel}>APPEARANCE</Text>
              <View style={styles.themeRow}>
                {(['light', 'dark', 'auto'] as const).map((t) => (
                  <TouchableOpacity key={t} style={[styles.themeChip, { backgroundColor: theme === t ? '#2196F3' : inputBg }]} onPress={() => { setTheme(t); Haptics.selectionAsync(); }}>
                    <IconSymbol name={t === 'light' ? 'sun.max.fill' : t === 'dark' ? 'moon.fill' : 'gearshape.fill'} size={16} color={theme === t ? '#fff' : secondaryText} />
                    <Text style={[styles.themeChipText, { color: theme === t ? '#fff' : textColor, marginTop: 4 }]}>{t.toUpperCase()}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        )}

        {activeTab === 'DEVICE' && (
          <View style={styles.fadeAnim}>
            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={styles.sectionLabel}>CONNECTED HARDWARE</Text>
              {myLinkedDevices.length > 0 ? myLinkedDevices.map((dev: any) => (
                <View key={dev.mac} style={[styles.deviceRow, { backgroundColor: inputBg }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.deviceRowLabel, { color: textColor }]}>{dev.label || 'H-Fire Device'}</Text>
                    <Text style={[styles.deviceRowSub, { color: secondaryText }]}>{dev.mac} • {dev.block_lot || 'General'}</Text>
                  </View>
                  <TouchableOpacity style={styles.unlinkBtn} onPress={() => handleUnlink(dev.mac, dev.label)}>
                    {unlinking === dev.mac ? <ActivityIndicator size="small" color="#FF3B30" /> : <Text style={styles.unlinkText}>UNLINK</Text>}
                  </TouchableOpacity>
                </View>
              )) : <Text style={{ color: secondaryText, textAlign: 'center', marginVertical: 10 }}>No devices currently linked.</Text>}
            </View>

            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={styles.sectionLabel}>DEVICE DISCOVERY</Text>
              <TouchableOpacity style={[styles.scanBtn, { borderColor: '#2196F3' }]} onPress={scanForDevices} disabled={isScanning}>
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
                  <TouchableOpacity style={[styles.adminEntryBtn, { backgroundColor: '#8E8E93', marginTop: 10 }]} onPress={async () => updateProfile({ ...userDetails!, is_admin: false })}>
                    <Text style={styles.adminEntryText}>Exit Admin</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* MAP MODAL */}
      <Modal visible={showMap} animationType="slide">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }} edges={['top', 'bottom']}>
          <View style={styles.mapModalContainer}>
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
                  Location.reverseGeocodeAsync(coord).then(([rev]) => { 
                    if (rev) setAddress(constructAddress(rev)); 
                  });
                }}
              >
                {location && <Marker coordinate={location} title="Your Home" pinColor="#2196F3" />}
              </MapView>
            ) : (
              <View style={styles.mapLoadingContainer}><ActivityIndicator size="large" color="#2196F3" /></View>
            )}

            <View style={styles.mapOverlay}>
              <Text style={styles.mapInstruction}>📍 Long press on the map to pin your home</Text>
              <View style={styles.mapBtnRow}>
                <TouchableOpacity style={styles.mapLocateBtn} onPress={flyToMyLocation} disabled={loadingGps}>
                  {loadingGps ? <ActivityIndicator size="small" color="#2196F3" /> : <IconSymbol name="location.fill" size={16} color="#2196F3" />}
                  <Text style={styles.mapLocateBtnText}>My Location</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.mapConfirmBtn, !location && { opacity: 0.4 }]}
                  onPress={() => { if (location) setShowMap(false); }}
                  disabled={!location}
                >
                  <Text style={styles.mapConfirmText}>Confirm Location</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      {/* PIN MODAL */}
      <Modal visible={showPinModal} animationType="fade" transparent>
        <View style={styles.pinOverlay}>
          <KeyboardAvoidingView behavior="padding" style={styles.pinContent}>
            <View style={[styles.pinCard, { backgroundColor: cardBg }]}>
              <Text style={[styles.pinTitle, { color: textColor }]}>Security PIN</Text>
              <TextInput 
                style={[styles.pinInput, { backgroundColor: inputBg, color: textColor }]} 
                value={pinInput} 
                onChangeText={setPinInput} 
                keyboardType="number-pad" 
                maxLength={4} 
                secureTextEntry 
                autoFocus 
                placeholder="0000"
                placeholderTextColor={placeholderColor}
              />
              <View style={styles.pinActions}>
                <TouchableOpacity onPress={() => setShowPinModal(false)}><Text style={{ color: secondaryText, fontWeight: '700' }}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity onPress={verifyPin} style={styles.pinVerify}><Text style={{ color: '#fff', fontWeight: '900' }}>Verify</Text></TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* SIGN OUT MODAL */}
      <Modal visible={showSignOutModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: cardBg }]}>
            <Text style={[styles.modalTitle, { color: textColor }]}>Sign Out</Text>
            <Text style={[styles.modalMessage, { color: secondaryText }]}>Are you sure you want to sign out? You will need to log in again to monitor your devices.</Text>
            
            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={[styles.modalBtn, { backgroundColor: inputBg }]} 
                onPress={() => setShowSignOutModal(false)}
              >
                <Text style={[styles.modalBtnText, { color: textColor }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalBtn, { backgroundColor: '#FF3B30' }]} 
                onPress={confirmSignOut}
              >
                <Text style={[styles.modalBtnText, { color: '#fff' }]}>Sign Out</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* SAVE CONFIRMATION MODAL */}
      <Modal visible={showSaveModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: cardBg }]}>
            <Text style={[styles.modalTitle, { color: textColor }]}>Save Changes</Text>
            <Text style={[styles.modalMessage, { color: secondaryText }]}>Are you sure you want to update your profile information? This will also update your household details for emergency responders.</Text>
            
            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={[styles.modalBtn, { backgroundColor: inputBg }]} 
                onPress={() => setShowSaveModal(false)}
              >
                <Text style={[styles.modalBtnText, { color: textColor }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalBtn, { backgroundColor: '#2196F3' }]} 
                onPress={confirmSave}
              >
                <Text style={[styles.modalBtnText, { color: '#fff' }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* NO CHANGES MODAL */}
      <Modal visible={showNoChangesModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: cardBg }]}>
            <Text style={[styles.modalTitle, { color: textColor }]}>No Changes</Text>
            <Text style={[styles.modalMessage, { color: secondaryText }]}>You haven't modified any information yet. Please update a field before saving.</Text>
            
            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={[styles.modalBtn, { backgroundColor: '#FF9800' }]} 
                onPress={() => setShowNoChangesModal(false)}
              >
                <Text style={[styles.modalBtnText, { color: '#fff' }]}>Understood</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // UPDATED HEADER AND ICON STYLES FOR FIXING THE SQUISHED BOX
  header: { 
    paddingHorizontal: 25, 
    paddingTop: 20, 
    paddingBottom: 10,
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center' 
  },
  headerSignOutBtn: { 
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 59, 48, 0.08)', 
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 59, 48, 0.15)'
  },
  headerSignOutText: {
    color: '#FF3B30',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5
  },
  title: { fontSize: 34, fontWeight: '900' },
  tabContainer: { flexDirection: 'row', paddingHorizontal: 25, marginTop: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  tabButton: { paddingVertical: 12, marginRight: 25 },
  tabText: { fontSize: 15, fontWeight: '800' },
  scrollContent: { padding: 20, paddingTop: 25, paddingBottom: 100 },
  fadeAnim: { flex: 1 },
  section: { borderRadius: 24, padding: 20, marginBottom: 20, ...Platform.select({ ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10 }, android: { elevation: 2 } }) },
  sectionLabel: { fontSize: 11, fontWeight: '900', color: '#8e8e93', marginBottom: 15, letterSpacing: 1 },
  fieldLabel: { fontSize: 10, fontWeight: '800', color: '#8e8e93', marginLeft: 4, marginBottom: 4, letterSpacing: 0.5 },
  inputGroup: { gap: 15, marginBottom: 15 },
  input: { borderRadius: 14, padding: 16, fontSize: 16, fontWeight: '600' },
  locBtn: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 14, marginBottom: 20 },
  locBtnText: { marginLeft: 10, fontWeight: '700', fontSize: 15 },
  saveBtn: { backgroundColor: '#2196F3', padding: 18, borderRadius: 16, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '900', fontSize: 16 },
  themeRow: { flexDirection: 'row', gap: 10 },
  themeChip: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(128,128,128,0.1)' },
  themeChipText: { fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
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
  pinOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  pinContent: { width: width * 0.8 },
  pinCard: { padding: 30, borderRadius: 25, alignItems: 'center' },
  pinTitle: { fontSize: 20, fontWeight: '900', marginBottom: 20 },
  pinInput: { width: '100%', padding: 20, borderRadius: 15, fontSize: 32, textAlign: 'center', fontWeight: '900', letterSpacing: 10 },
  pinActions: { flexDirection: 'row', width: '100%', justifyContent: 'space-between', alignItems: 'center', marginTop: 25 },
  pinVerify: { backgroundColor: '#2196F3', paddingHorizontal: 25, paddingVertical: 12, borderRadius: 12 },
  mapModalContainer: { flex: 1, backgroundColor: '#000' },
  map: { flex: 1 },
  mapBackBtn: { position: 'absolute', top: 16, left: 16, zIndex: 10, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  mapBackText: { color: '#fff', fontSize: 13, fontWeight: '800', marginLeft: 4 },
  mapLoadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111' },
  mapOverlay: { position: 'absolute', bottom: 30, left: 16, right: 16, backgroundColor: 'rgba(255,255,255,0.96)', padding: 20, borderRadius: 24, alignItems: 'center', elevation: 10 },
  mapInstruction: { fontSize: 14, fontWeight: '700', color: '#444', marginBottom: 14 },
  mapBtnRow: { flexDirection: 'row', gap: 10, width: '100%', alignItems: 'center' },
  mapLocateBtn: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: '#2196F3', paddingHorizontal: 16, paddingVertical: 13, borderRadius: 15, gap: 6 },
  mapLocateBtnText: { color: '#2196F3', fontWeight: '900', fontSize: 13 },
  mapConfirmBtn: { flex: 1, backgroundColor: '#2196F3', padding: 16, borderRadius: 15, alignItems: 'center' },
  mapConfirmText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  locDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#34C759', marginLeft: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 340, borderRadius: 28, padding: 25, alignItems: 'center', elevation: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20 },
  modalIconContainer: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255, 59, 48, 0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 22, fontWeight: '900', marginBottom: 10 },
  modalMessage: { fontSize: 15, fontWeight: '600', textAlign: 'center', lineHeight: 22, marginBottom: 25, paddingHorizontal: 10 },
  modalActions: { flexDirection: 'row', gap: 12, width: '100%' },
  modalBtn: { flex: 1, paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  modalBtnText: { fontSize: 15, fontWeight: '800' }
});