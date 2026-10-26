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
import { ActivityIndicator, Alert, Dimensions, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

const { width } = Dimensions.get('window');
const HOA_PIN = '1111';
const SYSTEM_ADMIN_PIN = '2222';

const FAQS = [
  {
    id: 1,
    category: 'ALERTS',
    q: 'What do the alert status colors mean?',
    a: '• NORMAL (Green, ≤ 450 PPM): Safe clean air.\n• WARNING (Yellow, 451–1500 PPM): Trace combustible gas detected. Check your stove, valves, and ventilate the room.\n• DANGER (Red, > 1500 PPM or Flame): High risk of fire or explosion. The siren sounds immediately and automated emergency protocols activate. Evacuate safely!'
  },
  {
    id: 2,
    category: 'ALERTS',
    q: 'How does the Emergency Siren work, and can I mute it?',
    a: 'When your device detects Danger (> 1500 PPM or active flame), the app activates a full-screen emergency siren with continuous haptics.\n\nTo mute it, tap the "Mute Siren" button on the emergency popup. Muting silences the audio on your phone while the hardware continues active safety monitoring.'
  },
  {
    id: 3,
    category: 'SMS',
    q: 'How does Automated Emergency SMS dispatch work?',
    a: 'When enabled under Settings, any Danger event automatically sends an SMS broadcast via httpSMS to all registered household family members and the community guard/hotline. The SMS includes your household name, exact PPM level, and timestamp.'
  },
  {
    id: 4,
    category: 'SMS',
    q: 'Where do I add family contacts for emergency SMS?',
    a: 'Go to Settings > Profile > "Household Members". Tap "Add Member", enter their name, relationship (e.g. Spouse, Child, Parent), and Philippine mobile number (+639... or 09...).'
  },
  {
    id: 5,
    category: 'HARDWARE',
    q: 'Why is my device showing "Offline"?',
    a: 'A device is marked offline if it has not sent telemetry in over 60 seconds. To resolve:\n1. Ensure the ESP32 is plugged in and receiving power.\n2. Verify your home 2.4GHz Wi-Fi is active.\n3. Make sure the unit is within Wi-Fi router range.'
  },
  {
    id: 6,
    category: 'HARDWARE',
    q: 'How many devices can I link to my household account?',
    a: 'Each household account can link up to 4 H-Fire sensor units (e.g. Kitchen, Living Room, Garage, Bedroom). Go to Settings > Device > "Scan for New Device" to pair an unlinked unit.'
  },
  {
    id: 7,
    category: 'ALERTS',
    q: 'What is the 24/7 Safety Guard background monitor?',
    a: 'The Safety Guard runs a lightweight background listener that posts a persistent lock-screen status widget on your phone. Even if you swipe the app closed, you will still receive urgent fire and gas alarms.'
  },
  {
    id: 8,
    category: 'HARDWARE',
    q: 'How should the sensor hardware be cleaned and maintained?',
    a: '• Keep the MQ2 gas sensor and KY-026 flame sensor free of heavy cooking grease and dust.\n• Use a soft, dry cloth or compressed air to clean the sensor mesh.\n• Never submerge the device in water or spray aerosol directly onto the sensor elements.'
  },
  {
    id: 9,
    category: 'ALERTS',
    q: 'Who should I contact during an actual fire or gas emergency?',
    a: '1. Evacuate everyone from the household immediately.\n2. Call 911 or your local Bureau of Fire Protection (BFP) hotline.\n3. Do not turn electrical switches on or off during a gas leak.'
  }
];

type SettingsTab = 'PROFILE' | 'DEVICE' | 'ADMIN';

export default function SettingsScreen() {
  const router = useRouter();
  const systemColorScheme = useColorScheme();
  const { theme, setTheme } = useAppTheme();
  const { 
    userDetails, 
    profileId, 
    isAdmin, 
    devices: globalDevices, 
    allHeardDevices, 
    refreshProfile, 
    signOut, 
    updateProfile,
    isGuardEnabled,
    enableGuard,
    disableGuard,
    autoSmsEnabled,
    toggleAutoSms,
    calibrationStatus,
    sendCalibrationCommand
  } = useUser();
  
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
  const [showFaqModal, setShowFaqModal] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [faqSearch, setFaqSearch] = useState('');
  const [faqCategory, setFaqCategory] = useState<'ALL' | 'ALERTS' | 'SMS' | 'HARDWARE'>('ALL');
  const [pinInput, setPinInput] = useState('');
  const [loadingGps, setLoadingGps] = useState(false);
  const [showWifiPortalModal, setShowWifiPortalModal] = useState(false);
  const [wifiPortalKey, setWifiPortalKey] = useState(0);

  // Sensor Calibration & Threshold Adjustment States
  const [safePpm, setSafePpm] = useState<number>(450);
  const [dangerPpm, setDangerPpm] = useState<number>(1500);
  const [flameDelta, setFlameDelta] = useState<number>(600);
  const [isCalibratingMQ2, setIsCalibratingMQ2] = useState<boolean>(false);
  const [isCalibratingFlame, setIsCalibratingFlame] = useState<boolean>(false);
  const [isSyncingThresholds, setIsSyncingThresholds] = useState<boolean>(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  useEffect(() => {
    if (!calibrationStatus) return;
    if (calibrationStatus.lastEvent === 'CAL_SUCCESS') {
      setIsCalibratingMQ2(false);
      setIsCalibratingFlame(false);
      setIsSyncingThresholds(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      let desc = 'ESP32 settings updated successfully!';
      if (calibrationStatus.sensor === 'MQ2') desc = `Clean-Air R0 saved: ${calibrationStatus.r0?.toFixed(2)} kΩ`;
      else if (calibrationStatus.sensor === 'FLAME') desc = `Ambient IR baseline zeroed: ${calibrationStatus.baseline} mV`;
      else if (calibrationStatus.sensor === 'FLAME_DELTA') desc = `Flame sensitivity delta: ${calibrationStatus.delta} mV`;
      else if (calibrationStatus.sensor === 'THRESHOLDS') desc = `Limits saved: Safe ${calibrationStatus.safePpm} PPM | Danger ${calibrationStatus.dangerPpm} PPM`;
      setSyncToast(desc);
      setTimeout(() => setSyncToast(null), 5000);
    } else if (calibrationStatus.lastEvent === 'CAL_STATUS') {
      if (calibrationStatus.safePpm) setSafePpm(calibrationStatus.safePpm);
      if (calibrationStatus.dangerPpm) setDangerPpm(calibrationStatus.dangerPpm);
      if (calibrationStatus.delta) setFlameDelta(calibrationStatus.delta);
    }
  }, [calibrationStatus]);

  const myLinkedDevices = useMemo(() => Object.values(globalDevices || {}), [globalDevices]);

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



  const handleTareMQ2 = () => {
    if (myLinkedDevices.length === 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert(
        'Link First on a Device',
        'Please link an ESP32 device first before calibrating the MQ-2 sensor.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Scan for Device', onPress: () => scanForDevices() }
        ]
      );
      return;
    }
    setIsCalibratingMQ2(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const sent = sendCalibrationCommand('CALIBRATE_MQ2');
    if (!sent) {
      setIsCalibratingMQ2(false);
      Alert.alert('Connection Issue', 'Could not reach HiveMQ cloud broker. Check Wi-Fi.');
    } else {
      setTimeout(() => setIsCalibratingMQ2(false), 5000);
    }
  };

  const handleTareFlame = () => {
    if (myLinkedDevices.length === 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert(
        'Link First on a Device',
        'Please link an ESP32 device first before zeroing the flame sensor.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Scan for Device', onPress: () => scanForDevices() }
        ]
      );
      return;
    }
    setIsCalibratingFlame(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const sent = sendCalibrationCommand('TARE_FLAME');
    if (!sent) {
      setIsCalibratingFlame(false);
      Alert.alert('Connection Issue', 'Could not reach HiveMQ cloud broker.');
    } else {
      setTimeout(() => setIsCalibratingFlame(false), 3000);
    }
  };

  const handleApplyThresholds = () => {
    if (myLinkedDevices.length === 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert(
        'Link First on a Device',
        'Please link an ESP32 device first before syncing threshold settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Scan for Device', onPress: () => scanForDevices() }
        ]
      );
      return;
    }

    setIsSyncingThresholds(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    const sentThresholds = sendCalibrationCommand(`SET_THRESHOLDS: {"safe": ${safePpm}, "danger": ${dangerPpm}}`);
    const sentFlame = sendCalibrationCommand(`SET_FLAME_DELTA: {"delta": ${flameDelta}}`);

    if (!sentThresholds && !sentFlame) {
      setIsSyncingThresholds(false);
      Alert.alert('Connection Issue', 'Could not reach HiveMQ cloud broker. Check your internet connection.');
      return;
    }

    const hasOnlineDevice = myLinkedDevices.some((d: any) => d.status !== 'OFFLINE');

    setTimeout(() => {
      setIsSyncingThresholds(false);
      if (hasOnlineDevice) {
        setSyncToast(`Saved & synced: Safe ${safePpm} PPM | Danger ${dangerPpm} PPM | Delta ${flameDelta} mV`);
      } else {
        setSyncToast('Command sent to broker! ESP32 is offline and will apply once online.');
      }
      setTimeout(() => setSyncToast(null), 4000);
    }, 1500);
  };

  const handleResetDefaults = () => {
    if (myLinkedDevices.length === 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert(
        'Link First on a Device',
        'Please link an ESP32 device first before resetting hardware settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Scan for Device', onPress: () => scanForDevices() }
        ]
      );
      return;
    }
    setSafePpm(450);
    setDangerPpm(1500);
    setFlameDelta(600);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendCalibrationCommand('SET_THRESHOLDS: {"safe": 450, "danger": 1500}');
    sendCalibrationCommand('SET_FLAME_DELTA: {"delta": 600}');
    setSyncToast('Reset to factory defaults: 450 PPM / 1500 PPM');
    setTimeout(() => setSyncToast(null), 3000);
  };

  const applyPreset = (preset: 'STANDARD' | 'KITCHEN' | 'HIGH_SECURITY') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (preset === 'STANDARD') {
      setSafePpm(450);
      setDangerPpm(1500);
      setFlameDelta(600);
    } else if (preset === 'KITCHEN') {
      setSafePpm(600);
      setDangerPpm(1800);
      setFlameDelta(750);
    } else if (preset === 'HIGH_SECURITY') {
      setSafePpm(350);
      setDangerPpm(1200);
      setFlameDelta(450);
    }
  };

  const filteredFaqs = useMemo(() => {
    return FAQS.filter(item => {
      const matchCat = faqCategory === 'ALL' || item.category === faqCategory;
      const searchLower = faqSearch.trim().toLowerCase();
      const matchSearch = !searchLower || item.q.toLowerCase().includes(searchLower) || item.a.toLowerCase().includes(searchLower);
      return matchCat && matchSearch;
    });
  }, [faqSearch, faqCategory]);

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
    if (firstNameError || lastNameError) return Alert.alert('Error', 'Please fix name errors.');
    if (!hasChanges) {
      setShowNoChangesModal(true);
      return;
    }
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
    const parts = [rev.name, rev.streetNumber, rev.street, rev.district, rev.city, rev.subregion, rev.region, rev.postalCode];
    return parts.filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
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
        <style>body { margin: 0; padding: 0; background: #eee; } #map { height: 100vh; width: 100vw; } .leaflet-control-attribution { display: none; }</style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var map = L.map('map', { zoomControl: false }).setView([${initialLat}, ${initialLng}], 16);
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
          var marker = L.marker([${initialLat}, ${initialLng}], { draggable: true }).addTo(map);
          function updatePos(lat, lng) { window.ReactNativeWebView.postMessage(JSON.stringify({ latitude: lat, longitude: lng })); }
          map.on('click', function(e) { marker.setLatLng(e.latlng); updatePos(e.latlng.lat, e.latlng.lng); });
          marker.on('dragend', function(e) { updatePos(e.target.getLatLng().lat, e.target.getLatLng().lng); });
          window.addEventListener('message', function(event) {
            try {
              var data = JSON.parse(event.data);
              if (data.type === 'FLY_TO') { marker.setLatLng([data.lat, data.lng]); map.flyTo([data.lat, data.lng], 18); }
            } catch(e) {}
          });
        </script>
      </body>
      </html>
    `;
  }, [showMap, location]);

  const onMapMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      const coords = { latitude: data.latitude, longitude: data.longitude };
      setLocation(coords);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const result = await Location.reverseGeocodeAsync(coords);
      if (result && result.length > 0) {
        setAddress(constructAddress(result[0]));
      }
    } catch (e) {}
  };

  const flyToMyLocation = async () => {
    setLoadingGps(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return Alert.alert('Permission Denied', 'GPS required.');
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords = { latitude: current.coords.latitude, longitude: current.coords.longitude };
      setLocation(coords);
      const result = await Location.reverseGeocodeAsync(coords);
      if (result && result.length > 0) setAddress(constructAddress(result[0]));
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

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {activeTab === 'PROFILE' && (
          <View>
            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={styles.sectionLabel}>PERSONAL INFORMATION</Text>
              <View style={styles.inputGroup}>
                <View>
                  <Text style={styles.fieldLabel}>FIRST NAME</Text>
                  <TextInput 
                    style={[styles.input, { backgroundColor: inputBg, color: textColor }, firstNameError ? styles.inputError : null]} 
                    value={firstName} 
                    onChangeText={validateFirstName} 
                    placeholder="First Name" 
                    placeholderTextColor={placeholderColor} 
                  />
                  {firstNameError ? <Text style={styles.errorText}>{firstNameError}</Text> : null}
                </View>
                <View>
                  <Text style={styles.fieldLabel}>MIDDLE NAME OR INITIAL</Text>
                  <TextInput 
                    style={[styles.input, { backgroundColor: inputBg, color: textColor }]} 
                    value={middleName} 
                    onChangeText={setMiddleName} 
                    placeholder="Middle Name or Initial" 
                    placeholderTextColor={placeholderColor} 
                  />
                </View>
                <View>
                  <Text style={styles.fieldLabel}>LAST NAME</Text>
                  <TextInput 
                    style={[styles.input, { backgroundColor: inputBg, color: textColor }, lastNameError ? styles.inputError : null]} 
                    value={lastName} 
                    onChangeText={validateLastName} 
                    placeholder="Last Name" 
                    placeholderTextColor={placeholderColor} 
                  />
                  {lastNameError ? <Text style={styles.errorText}>{lastNameError}</Text> : null}
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

              <TouchableOpacity style={[styles.saveBtn, (!hasChanges || firstNameError !== '' || lastNameError !== '') && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
              </TouchableOpacity>
            </View>

            {/* 24/7 Safety Guard Monitoring Toggle Section */}
            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={styles.sectionLabel}>BACKGROUND SAFETY GUARD</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: textColor, marginBottom: 2 }}>
                    24/7 Safety Guard
                  </Text>
                  <Text style={{ fontSize: 12, color: secondaryText, lineHeight: 16 }}>
                    Monitors gas & fire in the background with a live notification tray widget.
                  </Text>
                </View>
                <Switch
                  value={isGuardEnabled}
                  onValueChange={(val) => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    if (val) {
                      enableGuard();
                    } else {
                      disableGuard();
                    }
                  }}
                  trackColor={{ false: '#767577', true: '#34C759' }}
                  thumbColor="#ffffff"
                />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: isGuardEnabled ? '#34C759' : '#8E8E93' }} />
                <Text style={{ fontSize: 11, fontWeight: '700', color: isGuardEnabled ? '#34C759' : secondaryText }}>
                  {isGuardEnabled ? 'Active (Continuous Telemetry & Lock-Screen Protection)' : 'Disabled (Alerts Only When App Is Open)'}
                </Text>
              </View>
            </View>

            {/* Automated Emergency SMS Toggle Section */}
            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={styles.sectionLabel}>EMERGENCY SMS DISPATCH</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: textColor, marginBottom: 2 }}>
                    Auto-SMS on Danger
                  </Text>
                  <Text style={{ fontSize: 12, color: secondaryText, lineHeight: 16 }}>
                    Automatically texts all registered family members & community hotline during a fire or critical gas leak.
                  </Text>
                </View>
                <Switch
                  value={autoSmsEnabled}
                  onValueChange={(val) => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    toggleAutoSms(val);
                  }}
                  trackColor={{ false: '#767577', true: '#FF3B30' }}
                  thumbColor="#ffffff"
                />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: autoSmsEnabled ? '#FF3B30' : '#8E8E93' }} />
                <Text style={{ fontSize: 11, fontWeight: '700', color: autoSmsEnabled ? '#FF3B30' : secondaryText }}>
                  {autoSmsEnabled ? 'Active (All Household Contacts & Hotline Notified via SMS)' : 'Disabled (No SMS Sent on Alarm)'}
                </Text>
              </View>
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

            {/* SUPPORT & USER GUIDE SECTION */}
            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={styles.sectionLabel}>SUPPORT & USER GUIDE</Text>
              
              <TouchableOpacity 
                style={[styles.menuRowBtn, { backgroundColor: inputBg }]} 
                onPress={() => {
                  setShowFaqModal(true);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
              >
                <View style={[styles.menuRowIconBg, { backgroundColor: 'rgba(33, 150, 243, 0.12)' }]}>
                  <IconSymbol name="questionmark.circle.fill" size={20} color="#2196F3" />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.menuRowTitle, { color: textColor }]}>Frequently Asked Questions (FAQ)</Text>
                  <Text style={[styles.menuRowSubtitle, { color: secondaryText }]}>Answers for sirens, SMS, alarms, and offline units</Text>
                </View>
                <IconSymbol name="chevron.right" size={14} color={secondaryText} />
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.menuRowBtn, { backgroundColor: inputBg, marginTop: 10 }]} 
                onPress={() => {
                  setShowManualModal(true);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
              >
                <View style={[styles.menuRowIconBg, { backgroundColor: 'rgba(52, 199, 89, 0.12)' }]}>
                  <IconSymbol name="book.fill" size={20} color="#34C759" />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.menuRowTitle, { color: textColor }]}>Resident User Manual</Text>
                  <Text style={[styles.menuRowSubtitle, { color: secondaryText }]}>Complete quick-start guide and safety protocols</Text>
                </View>
                <IconSymbol name="chevron.right" size={14} color={secondaryText} />
              </TouchableOpacity>
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
            {/* ESP32 WI-FI CONFIGURATION CARD */}
            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={styles.sectionLabel}>ESP32 WI-FI SETUP</Text>
                  <Text style={{ fontSize: 12, color: secondaryText }}>Connect your hardware node to 2.4GHz Wi-Fi</Text>
                </View>
                <View style={{ backgroundColor: 'rgba(52, 199, 89, 0.15)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
                  <Text style={{ color: '#34C759', fontSize: 11, fontWeight: '800' }}>PORTAL</Text>
                </View>
              </View>

              <View style={[styles.wifiGuideBox, { backgroundColor: inputBg }]}>
                <View style={styles.wifiGuideStep}>
                  <View style={styles.wifiStepBadge}><Text style={styles.wifiStepBadgeText}>1</Text></View>
                  <Text style={[styles.wifiStepText, { color: textColor }]}>Turn on ESP32 or hold <Text style={{ fontWeight: '700' }}>BOOT</Text> for 3s until OLED says <Text style={{ color: '#2196F3', fontWeight: '700' }}>WIFI SETUP MODE</Text>.</Text>
                </View>
                <View style={styles.wifiGuideStep}>
                  <View style={styles.wifiStepBadge}><Text style={styles.wifiStepBadgeText}>2</Text></View>
                  <Text style={[styles.wifiStepText, { color: textColor }]}>Connect your phone's Wi-Fi to <Text style={{ color: '#FF9500', fontWeight: '700' }}>H-Fire-Gateway</Text>.</Text>
                </View>
                <View style={styles.wifiGuideStep}>
                  <View style={styles.wifiStepBadge}><Text style={styles.wifiStepBadgeText}>3</Text></View>
                  <Text style={[styles.wifiStepText, { color: textColor }]}>Tap button below to configure your home Wi-Fi directly inside this app!</Text>
                </View>
              </View>

              <TouchableOpacity 
                style={[styles.openWifiPortalBtn, { backgroundColor: '#2196F3' }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setWifiPortalKey(k => k + 1);
                  setShowWifiPortalModal(true);
                }}
              >
                <IconSymbol name="wifi" size={18} color="#fff" />
                <Text style={styles.openWifiPortalBtnText}>Open In-App Wi-Fi Setup Portal</Text>
              </TouchableOpacity>
            </View>

            {/* SENSOR ADJUSTMENT & SOFTWARE CALIBRATION CARD */}
            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={styles.sectionLabel}>SENSOR CALIBRATION & SENSITIVITY</Text>
                  <Text style={{ fontSize: 12, color: secondaryText }}>OTA Hardware Thresholds (ESP32 Master)</Text>
                </View>
                <View style={{ backgroundColor: '#2196F320', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
                  <Text style={{ color: '#2196F3', fontSize: 11, fontWeight: '800' }}>WIRELESS</Text>
                </View>
              </View>

              {/* Toast Banner for ACK */}
              {syncToast && (
                <View style={{ backgroundColor: '#34C75920', padding: 12, borderRadius: 12, marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#34C75940' }}>
                  <IconSymbol name="checkmark.circle.fill" size={18} color="#34C759" />
                  <Text style={{ color: '#34C759', fontSize: 12, fontWeight: '700', flex: 1 }}>{syncToast}</Text>
                </View>
              )}

              {/* Unlinked Hardware Warning Banner */}
              {myLinkedDevices.length === 0 && (
                <View style={{ backgroundColor: 'rgba(255, 149, 0, 0.10)', borderWidth: 1, borderColor: 'rgba(255, 149, 0, 0.35)', padding: 12, borderRadius: 12, marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <IconSymbol name="exclamationmark.triangle.fill" size={20} color="#FF9500" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#FF9500', fontSize: 13, fontWeight: '700' }}>Link First on a Device</Text>
                    <Text style={{ color: secondaryText, fontSize: 11, marginTop: 2, lineHeight: 15 }}>
                      No ESP32 hardware is linked. Link a device below to calibrate sensors and sync threshold settings.
                    </Text>
                  </View>
                </View>
              )}

              {/* Mode Presets */}
              <Text style={{ fontSize: 12, fontWeight: '800', color: textColor, marginBottom: 8 }}>SENSITIVITY PRESETS</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 16 }}>
                <TouchableOpacity 
                  style={[styles.presetChip, safePpm === 450 && dangerPpm === 1500 ? styles.presetActive : { backgroundColor: inputBg }]} 
                  onPress={() => applyPreset('STANDARD')}
                >
                  <Text style={[styles.presetText, safePpm === 450 && dangerPpm === 1500 && { color: '#fff' }]} numberOfLines={1}>Standard</Text>
                  <Text style={{ fontSize: 9, color: safePpm === 450 && dangerPpm === 1500 ? '#ffffffb0' : secondaryText, marginTop: 2 }}>450 / 1500</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.presetChip, safePpm === 600 && dangerPpm === 1800 ? styles.presetActive : { backgroundColor: inputBg }]} 
                  onPress={() => applyPreset('KITCHEN')}
                >
                  <Text style={[styles.presetText, safePpm === 600 && dangerPpm === 1800 && { color: '#fff' }]} numberOfLines={1}>Kitchen</Text>
                  <Text style={{ fontSize: 9, color: safePpm === 600 && dangerPpm === 1800 ? '#ffffffb0' : secondaryText, marginTop: 2 }}>600 / 1800</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.presetChip, safePpm === 350 && dangerPpm === 1200 ? styles.presetActive : { backgroundColor: inputBg }]} 
                  onPress={() => applyPreset('HIGH_SECURITY')}
                >
                  <Text style={[styles.presetText, safePpm === 350 && dangerPpm === 1200 && { color: '#fff' }]} numberOfLines={1}>Sensitive</Text>
                  <Text style={{ fontSize: 9, color: safePpm === 350 && dangerPpm === 1200 ? '#ffffffb0' : secondaryText, marginTop: 2 }}>350 / 1200</Text>
                </TouchableOpacity>
              </View>

              {/* MQ-2 Gas/Smoke Section */}
              <View style={[styles.sensorControlCard, { backgroundColor: inputBg }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8, gap: 8 }}>
                    <View style={[styles.sensorIconBadge, { backgroundColor: 'rgba(255, 149, 0, 0.15)' }]}>
                      <IconSymbol name="waveform.path.ecg" size={18} color="#FF9500" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.sensorTitle, { color: textColor }]} numberOfLines={1}>MQ-2 Gas / Smoke</Text>
                      <Text style={{ fontSize: 11, color: secondaryText }}>ADC Pin 34 · Power-Law Curve</Text>
                    </View>
                  </View>
                  <TouchableOpacity 
                    style={[styles.tareBtn, isCalibratingMQ2 && { opacity: 0.6 }]} 
                    onPress={handleTareMQ2} 
                    disabled={isCalibratingMQ2}
                  >
                    {isCalibratingMQ2 ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.tareBtnText}>Tare Air</Text>
                    )}
                  </TouchableOpacity>
                </View>

                {/* Safe Threshold Stepper Block */}
                <View style={[styles.thresholdBlock, { backgroundColor: cardBg, borderColor: '#8E8E9325', borderWidth: 1 }]}>
                  <View style={styles.thresholdTopRow}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={[styles.statusDot, { backgroundColor: '#FF9500' }]} />
                        <Text style={[styles.thresholdLabel, { color: textColor }]}>Warning Trigger (Safe Limit)</Text>
                      </View>
                      <Text style={[styles.thresholdSub, { color: secondaryText }]}>
                        Normal air baseline transition
                      </Text>
                    </View>
                    <View style={[styles.valBadge, { backgroundColor: 'rgba(255, 149, 0, 0.12)', borderColor: 'rgba(255, 149, 0, 0.35)', borderWidth: 1 }]}>
                      <Text style={[styles.valBadgeText, { color: '#FF9500' }]}>{safePpm} PPM</Text>
                    </View>
                  </View>

                  <View style={styles.stepperBar}>
                    <TouchableOpacity 
                      style={[styles.stepperBtnRound, { backgroundColor: 'rgba(33, 150, 243, 0.12)' }]} 
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSafePpm(p => Math.max(150, p - 50)); }}
                    >
                      <Text style={[styles.stepperBtnRoundText, { color: '#2196F3' }]}>−</Text>
                    </TouchableOpacity>

                    <View style={styles.stepperCenterInfo}>
                      <Text style={[styles.stepperBigVal, { color: textColor }]}>{safePpm}</Text>
                      <Text style={[styles.stepperUnitText, { color: secondaryText }]}>PPM (Warning Level)</Text>
                    </View>

                    <TouchableOpacity 
                      style={[styles.stepperBtnRound, { backgroundColor: 'rgba(33, 150, 243, 0.12)' }]} 
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSafePpm(p => Math.min(dangerPpm - 100, p + 50)); }}
                    >
                      <Text style={[styles.stepperBtnRoundText, { color: '#2196F3' }]}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Danger Threshold Stepper Block */}
                <View style={[styles.thresholdBlock, { backgroundColor: cardBg, borderColor: '#8E8E9325', borderWidth: 1, marginTop: 10 }]}>
                  <View style={styles.thresholdTopRow}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={[styles.statusDot, { backgroundColor: '#FF3B30' }]} />
                        <Text style={[styles.thresholdLabel, { color: '#FF3B30' }]}>Danger Siren Alarm (Critical)</Text>
                      </View>
                      <Text style={[styles.thresholdSub, { color: secondaryText }]}>
                        Activates siren & auto-SMS
                      </Text>
                    </View>
                    <View style={[styles.valBadge, { backgroundColor: 'rgba(255, 59, 48, 0.12)', borderColor: 'rgba(255, 59, 48, 0.35)', borderWidth: 1 }]}>
                      <Text style={[styles.valBadgeText, { color: '#FF3B30' }]}>{dangerPpm} PPM</Text>
                    </View>
                  </View>

                  <View style={styles.stepperBar}>
                    <TouchableOpacity 
                      style={[styles.stepperBtnRound, { backgroundColor: 'rgba(255, 59, 48, 0.12)' }]} 
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDangerPpm(p => Math.max(safePpm + 100, p - 100)); }}
                    >
                      <Text style={[styles.stepperBtnRoundText, { color: '#FF3B30' }]}>−</Text>
                    </TouchableOpacity>

                    <View style={styles.stepperCenterInfo}>
                      <Text style={[styles.stepperBigVal, { color: '#FF3B30' }]}>{dangerPpm}</Text>
                      <Text style={[styles.stepperUnitText, { color: secondaryText }]}>PPM (Danger Trigger)</Text>
                    </View>

                    <TouchableOpacity 
                      style={[styles.stepperBtnRound, { backgroundColor: 'rgba(255, 59, 48, 0.12)' }]} 
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDangerPpm(p => Math.min(4000, p + 100)); }}
                    >
                      <Text style={[styles.stepperBtnRoundText, { color: '#FF3B30' }]}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              {/* KY-026 Flame Sensor Section */}
              <View style={[styles.sensorControlCard, { backgroundColor: inputBg, marginTop: 14 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8, gap: 8 }}>
                    <View style={[styles.sensorIconBadge, { backgroundColor: 'rgba(255, 59, 48, 0.15)' }]}>
                      <IconSymbol name="flame.fill" size={18} color="#FF3B30" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.sensorTitle, { color: textColor }]} numberOfLines={1}>KY-026 Flame Sensor</Text>
                      <Text style={{ fontSize: 11, color: secondaryText }}>IR Phototransistor · Pin 32</Text>
                    </View>
                  </View>
                  <TouchableOpacity 
                    style={[styles.tareBtn, { backgroundColor: '#FF3B30' }, isCalibratingFlame && { opacity: 0.6 }]} 
                    onPress={handleTareFlame} 
                    disabled={isCalibratingFlame}
                  >
                    {isCalibratingFlame ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.tareBtnText}>Tare IR</Text>
                    )}
                  </TouchableOpacity>
                </View>

                {/* Flame Sensitivity Delta Stepper Block */}
                <View style={[styles.thresholdBlock, { backgroundColor: cardBg, borderColor: '#8E8E9325', borderWidth: 1 }]}>
                  <View style={styles.thresholdTopRow}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={[styles.statusDot, { backgroundColor: '#2196F3' }]} />
                        <Text style={[styles.thresholdLabel, { color: textColor }]}>Flame Trigger Delta</Text>
                      </View>
                      <Text style={[styles.thresholdSub, { color: secondaryText }]}>
                        IR drop from ambient lighting
                      </Text>
                    </View>
                    <View style={[styles.valBadge, { backgroundColor: 'rgba(33, 150, 243, 0.12)', borderColor: 'rgba(33, 150, 243, 0.35)', borderWidth: 1 }]}>
                      <Text style={[styles.valBadgeText, { color: '#2196F3' }]}>{flameDelta} mV</Text>
                    </View>
                  </View>

                  <View style={styles.stepperBar}>
                    <TouchableOpacity 
                      style={[styles.stepperBtnRound, { backgroundColor: 'rgba(33, 150, 243, 0.12)' }]} 
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFlameDelta(d => Math.max(200, d - 50)); }}
                    >
                      <Text style={[styles.stepperBtnRoundText, { color: '#2196F3' }]}>−</Text>
                    </TouchableOpacity>

                    <View style={styles.stepperCenterInfo}>
                      <Text style={[styles.stepperBigVal, { color: textColor }]}>{flameDelta}</Text>
                      <Text style={[styles.stepperUnitText, { color: secondaryText }]}>mV (Sensitivity Delta)</Text>
                    </View>

                    <TouchableOpacity 
                      style={[styles.stepperBtnRound, { backgroundColor: 'rgba(33, 150, 243, 0.12)' }]} 
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setFlameDelta(d => Math.min(2000, d + 50)); }}
                    >
                      <Text style={[styles.stepperBtnRoundText, { color: '#2196F3' }]}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              {/* Sync Actions */}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
                <TouchableOpacity 
                  style={[styles.syncBtn, { flex: 1, backgroundColor: '#2196F3' }]} 
                  onPress={handleApplyThresholds} 
                  disabled={isSyncingThresholds}
                >
                  {isSyncingThresholds ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <IconSymbol name="bolt.fill" size={16} color="#fff" />
                      <Text style={styles.syncBtnText}>Sync to ESP32</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.syncBtn, { backgroundColor: inputBg, borderWidth: 1, borderColor: '#8E8E9340' }]} 
                  onPress={handleResetDefaults}
                >
                  <Text style={[styles.syncBtnText, { color: secondaryText }]}>Reset</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={styles.sectionLabel}>DEVICE DISCOVERY</Text>
              <TouchableOpacity style={[styles.scanBtn, { borderColor: '#2196F3' }]} onPress={scanForDevices} disabled={isScanning}>
                {isScanning ? <ActivityIndicator color="#2196F3" /> : <><IconSymbol name="magnifyingglass" size={18} color="#2196F3" /><Text style={styles.scanBtnText}>Scan for New Device</Text></>}
              </TouchableOpacity>
              {availableDevices.length > 0 && (
                <View style={{ marginTop: 20 }}>
                  <Text style={styles.foundTitle}>Available Devices Nearby:</Text>
                  {availableDevices.map(dev => (
                    <TouchableOpacity key={dev.mac} style={[styles.foundItem, { backgroundColor: inputBg }]} onPress={() => linkDevice(dev.mac)}>
                      <View style={{ flex: 1 }}><Text style={[styles.foundMac, { color: textColor }]}>{dev.mac}</Text><Text style={styles.foundHouse}>Topic: {dev.house_name}</Text></View>
                      <IconSymbol name="plus.circle.fill" size={24} color="#34C759" />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          </View>
        )}

        {activeTab === 'ADMIN' && (
          <View>
            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={styles.sectionLabel}>ADMIN SECURITY ACCESS</Text>
              <Text style={{ color: secondaryText, fontSize: 13, marginBottom: 16, lineHeight: 18 }}>
                Enter HOA Administrator or System Admin PIN to access community-wide monitoring, command center, and broadcast sirens.
              </Text>
              <TouchableOpacity style={styles.adminEntryBtn} onPress={() => setShowPinModal(true)}>
                <IconSymbol name="exclamationmark.shield.fill" size={20} color="#fff" />
                <Text style={styles.adminEntryText}>Enter Admin Portal</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* IN-APP ESP32 WI-FI SETUP PORTAL (WEBVIEW) */}
      <Modal visible={showWifiPortalModal} animationType="slide">
        <SafeAreaView style={{ flex: 1, backgroundColor: cardBg }} edges={['top', 'bottom']}>
          {/* Header Bar */}
          <View style={[styles.portalHeader, { borderBottomColor: '#8E8E9325' }]}>
            <TouchableOpacity 
              style={styles.portalHeaderBtn} 
              onPress={() => setShowWifiPortalModal(false)}
            >
              <IconSymbol name="xmark" size={18} color={textColor} />
              <Text style={[styles.portalHeaderBtnText, { color: textColor }]}>Close</Text>
            </TouchableOpacity>

            <View style={{ alignItems: 'center' }}>
              <Text style={[styles.portalTitle, { color: textColor }]}>ESP32 Wi-Fi Setup</Text>
              <Text style={{ fontSize: 11, color: '#34C759', fontWeight: '600' }}>http://192.168.4.1/wifi</Text>
            </View>

            <TouchableOpacity 
              style={styles.portalHeaderBtn} 
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setWifiPortalKey(k => k + 1);
              }}
            >
              <IconSymbol name="arrow.clockwise" size={18} color="#2196F3" />
              <Text style={[styles.portalHeaderBtnText, { color: '#2196F3' }]}>Reload</Text>
            </TouchableOpacity>
          </View>

          {/* Embedded WebView */}
          <View style={{ flex: 1 }}>
            <WebView
              key={wifiPortalKey}
              source={{ uri: 'http://192.168.4.1/wifi' }}
              style={{ flex: 1, backgroundColor: '#0B0F19' }}
              originWhitelist={['*']}
              startInLoadingState={true}
              renderLoading={() => (
                <View style={styles.portalLoadingOverlay}>
                  <ActivityIndicator size="large" color="#2196F3" />
                  <Text style={[styles.portalLoadingText, { color: textColor }]}>Connecting to H-Fire-Gateway...</Text>
                  <Text style={{ fontSize: 12, color: secondaryText, textAlign: 'center', marginTop: 6, paddingHorizontal: 40, lineHeight: 18 }}>
                    Make sure your phone is connected to the "H-Fire-Gateway" Wi-Fi hotspot in your phone settings.
                  </Text>
                </View>
              )}
              renderError={() => (
                <View style={styles.portalErrorContainer}>
                  <IconSymbol name="wifi.exclamationmark" size={48} color="#FF9500" />
                  <Text style={[styles.portalErrorTitle, { color: textColor }]}>Cannot Reach ESP32 Hotspot</Text>
                  <Text style={[styles.portalErrorDesc, { color: secondaryText }]}>
                    Your phone is not connected to <Text style={{ fontWeight: '700', color: textColor }}>H-Fire-Gateway</Text> or the ESP32 is not in setup mode.
                  </Text>
                  <View style={[styles.portalStepsBox, { backgroundColor: inputBg }]}>
                    <Text style={[styles.portalStepItem, { color: textColor }]}>1. Check ESP32 OLED: should display <Text style={{ color: '#2196F3', fontWeight: '700' }}>"WIFI SETUP MODE"</Text></Text>
                    <Text style={[styles.portalStepItem, { color: textColor }]}>2. Open phone Wi-Fi settings & connect to <Text style={{ color: '#FF9500', fontWeight: '700' }}>"H-Fire-Gateway"</Text></Text>
                    <Text style={[styles.portalStepItem, { color: textColor }]}>3. Return here and tap <Text style={{ color: '#34C759', fontWeight: '700' }}>"Retry Connection"</Text></Text>
                  </View>
                  <TouchableOpacity 
                    style={[styles.retryPortalBtn, { backgroundColor: '#2196F3' }]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      setWifiPortalKey(k => k + 1);
                    }}
                  >
                    <IconSymbol name="arrow.clockwise" size={16} color="#fff" />
                    <Text style={styles.retryPortalBtnText}>Retry Connection</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
          </View>
        </SafeAreaView>
      </Modal>

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
                <TouchableOpacity style={styles.mapLocateBtn} onPress={flyToMyLocation}><IconSymbol name="location.fill" size={16} color="#2196F3" /><Text style={styles.mapLocateBtnText}>My Location</Text></TouchableOpacity>
                <TouchableOpacity style={styles.mapConfirmBtn} onPress={() => { if (location) setShowMap(false); }}><Text style={styles.mapConfirmText}>Confirm</Text></TouchableOpacity>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      {/* SUPPORTING MODALS */}
      <Modal visible={showSignOutModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: cardBg }]}>
            <Text style={[styles.modalTitle, { color: textColor }]}>Sign Out</Text>
            <Text style={[styles.modalMessage, { color: secondaryText }]}>Are you sure you want to sign out?</Text>
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
            <Text style={[styles.modalMessage, { color: secondaryText }]}>Modify a field before saving.</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#2196F3' }]} onPress={() => setShowNoChangesModal(false)}><Text style={{ color: '#fff' }}>Understood</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ADMIN PIN MODAL */}
      <Modal visible={showPinModal} transparent animationType="fade">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.pinOverlay}>
          <View style={[styles.pinCard, { backgroundColor: cardBg }]}>
            <Text style={[styles.pinTitle, { color: textColor }]}>Enter Security PIN</Text>
            <TextInput
              style={[styles.pinInput, { backgroundColor: inputBg, color: textColor }]}
              value={pinInput}
              onChangeText={setPinInput}
              keyboardType="number-pad"
              maxLength={4}
              secureTextEntry
              placeholder="••••"
              placeholderTextColor={placeholderColor}
            />
            <View style={styles.pinActions}>
              <TouchableOpacity onPress={() => { setShowPinModal(false); setPinInput(''); }}>
                <Text style={{ color: secondaryText, fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.pinVerify} onPress={verifyPin}>
                <Text style={{ color: '#fff', fontWeight: '900' }}>Verify</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* HELP & FAQS MODAL */}
      <Modal visible={showFaqModal} animationType="slide">
        <SafeAreaView style={[styles.fullModalContainer, { backgroundColor }]} edges={['top', 'bottom']}>
          <View style={[styles.fullModalHeader, { borderBottomColor: 'rgba(150,150,150,0.15)' }]}>
            <TouchableOpacity 
              style={styles.fullModalCloseBtn} 
              onPress={() => {
                setShowFaqModal(false);
                setFaqSearch('');
                setExpandedFaq(null);
              }}
            >
              <IconSymbol name="chevron.left" size={20} color="#2196F3" />
              <Text style={styles.fullModalCloseText}>Settings</Text>
            </TouchableOpacity>
            <Text style={[styles.fullModalTitle, { color: textColor }]}>Help & FAQs</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView 
            contentContainerStyle={styles.fullModalContent} 
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Search Input */}
            <View style={[styles.faqSearchBox, { backgroundColor: inputBg }]}>
              <IconSymbol name="magnifyingglass" size={18} color={secondaryText} />
              <TextInput
                style={[styles.faqSearchInput, { color: textColor }]}
                placeholder="Search FAQs (siren, offline, SMS, gas levels)..."
                placeholderTextColor={placeholderColor}
                value={faqSearch}
                onChangeText={setFaqSearch}
                clearButtonMode="while-editing"
              />
              {faqSearch.length > 0 && (
                <TouchableOpacity onPress={() => setFaqSearch('')}>
                  <IconSymbol name="xmark.circle.fill" size={16} color={secondaryText} />
                </TouchableOpacity>
              )}
            </View>

            {/* Category Filter Chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              <View style={styles.faqCategoryRow}>
                {(['ALL', 'ALERTS', 'SMS', 'HARDWARE'] as const).map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      styles.faqChip,
                      faqCategory === cat && styles.faqChipActive
                    ]}
                    onPress={() => {
                      setFaqCategory(cat);
                      Haptics.selectionAsync();
                    }}
                  >
                    <Text style={[styles.faqChipText, faqCategory === cat && styles.faqChipTextActive]}>
                      {cat === 'ALL' ? 'All Questions' : cat === 'ALERTS' ? 'Alerts & Siren' : cat === 'SMS' ? 'Emergency SMS' : 'Hardware & Wi-Fi'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* Accordion FAQ Items */}
            {filteredFaqs.map((faq) => {
              const isExpanded = expandedFaq === faq.id;
              return (
                <View key={faq.id} style={[styles.faqCard, { backgroundColor: cardBg }]}>
                  <TouchableOpacity
                    style={styles.faqQuestionRow}
                    activeOpacity={0.7}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setExpandedFaq(isExpanded ? null : faq.id);
                    }}
                  >
                    <View style={styles.faqQuestionContent}>
                      <View style={[styles.faqBadge, { backgroundColor: faq.category === 'ALERTS' ? 'rgba(255, 59, 48, 0.12)' : faq.category === 'SMS' ? 'rgba(33, 150, 243, 0.12)' : 'rgba(52, 199, 89, 0.12)' }]}>
                        <Text style={[styles.faqBadgeText, { color: faq.category === 'ALERTS' ? '#FF3B30' : faq.category === 'SMS' ? '#2196F3' : '#34C759' }]}>
                          {faq.category}
                        </Text>
                      </View>
                      <Text style={[styles.faqQuestionText, { color: textColor }]}>
                        {faq.q}
                      </Text>
                    </View>
                    <IconSymbol 
                      name={isExpanded ? 'chevron.up' : 'chevron.down'} 
                      size={18} 
                      color={secondaryText} 
                    />
                  </TouchableOpacity>

                  {isExpanded && (
                    <View style={styles.faqAnswerContainer}>
                      <Text style={[styles.faqAnswerText, { color: textColor }]}>
                        {faq.a}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}

            {filteredFaqs.length === 0 && (
              <View style={styles.emptyFaq}>
                <IconSymbol name="exclamationmark.magnifyingglass" size={40} color={secondaryText} />
                <Text style={[styles.emptyFaqTitle, { color: textColor }]}>No Results Found</Text>
                <Text style={[styles.emptyFaqText, { color: secondaryText }]}>
                  Try searching for keywords like "siren", "offline", "SMS", "gas", or "power".
                </Text>
              </View>
            )}

            {/* Quick Emergency Notice */}
            <View style={styles.faqEmergencyCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <IconSymbol name="flame.fill" size={18} color="#FF3B30" />
                <Text style={styles.faqEmergencyTitle}>Fire Emergency Protocol</Text>
              </View>
              <Text style={styles.faqEmergencyBody}>
                If you smell gas or see flames, evacuate immediately. Do not use electrical switches. Dial 911 (BFP Hotline) from a safe distance outside.
              </Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* USER MANUAL MODAL */}
      <Modal visible={showManualModal} animationType="slide">
        <SafeAreaView style={[styles.fullModalContainer, { backgroundColor }]} edges={['top', 'bottom']}>
          <View style={[styles.fullModalHeader, { borderBottomColor: 'rgba(150,150,150,0.15)' }]}>
            <TouchableOpacity 
              style={styles.fullModalCloseBtn} 
              onPress={() => setShowManualModal(false)}
            >
              <IconSymbol name="chevron.left" size={20} color="#2196F3" />
              <Text style={styles.fullModalCloseText}>Settings</Text>
            </TouchableOpacity>
            <Text style={[styles.fullModalTitle, { color: textColor }]}>Resident User Manual</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView contentContainerStyle={styles.fullModalContent} showsVerticalScrollIndicator={false}>
            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={styles.manualChapterTitle}>1. System Overview</Text>
              <Text style={[styles.manualText, { color: textColor }]}>
                H-Fire is an integrated IoT fire and gas safety system connecting your home sensor hardware (ESP32, MQ2 Gas Sensor, KY-026 Flame Sensor) to your mobile phone via HiveMQ MQTT and Supabase Realtime.
              </Text>
            </View>

            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={styles.manualChapterTitle}>2. PPM Thresholds & Status</Text>
              <View style={styles.manualThresholdRow}>
                <View style={[styles.manualStatusDot, { backgroundColor: '#34C759' }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.manualStatusName, { color: textColor }]}>NORMAL (0 – 450 PPM)</Text>
                  <Text style={[styles.manualStatusDesc, { color: secondaryText }]}>Safe ambient air. Standard residential background level.</Text>
                </View>
              </View>
              <View style={styles.manualThresholdRow}>
                <View style={[styles.manualStatusDot, { backgroundColor: '#FF9500' }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.manualStatusName, { color: textColor }]}>WARNING (451 – 1500 PPM)</Text>
                  <Text style={[styles.manualStatusDesc, { color: secondaryText }]}>Trace combustible gas detected. Ventilate kitchen and check LPG valves.</Text>
                </View>
              </View>
              <View style={styles.manualThresholdRow}>
                <View style={[styles.manualStatusDot, { backgroundColor: '#FF3B30' }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.manualStatusName, { color: textColor }]}>DANGER ({'>'} 1500 PPM or Flame)</Text>
                  <Text style={[styles.manualStatusDesc, { color: secondaryText }]}>Lethal explosion / fire risk. Siren activates, Auto-SMS dispatches, evacuate now.</Text>
                </View>
              </View>
            </View>

            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={styles.manualChapterTitle}>3. Emergency Alarms & Mute</Text>
              <Text style={[styles.manualText, { color: textColor }]}>
                When an alarm triggers, your device sounds a high-pitch siren with continuous vibration. Tap "Mute Siren" on the screen to silence audio. The app will continue monitoring the sensor until PPM drops back to safe levels.
              </Text>
            </View>

            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={styles.manualChapterTitle}>4. Automated SMS Gateway</Text>
              <Text style={[styles.manualText, { color: textColor }]}>
                Ensure "Emergency SMS Dispatch" is switched ON under Settings. Register your family members in "Household Members". In Danger events, automated SMS messages with your location and sensor reading are dispatched instantly.
              </Text>
            </View>

            <View style={[styles.section, { backgroundColor: cardBg }]}>
              <Text style={styles.manualChapterTitle}>5. Hardware Maintenance</Text>
              <Text style={[styles.manualText, { color: textColor }]}>
                • Allow 24 hours of initial burn-in when first powering on a new MQ2 sensor.{'\n'}
                • Keep the unit away from direct water splashes or heavy grease.{'\n'}
                • Clean outer sensor mesh with a soft brush or compressed air monthly.
              </Text>
            </View>
          </ScrollView>
        </SafeAreaView>
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
  errorText: { color: '#FF3B30', fontSize: 11, fontWeight: '700', marginTop: 4, marginLeft: 4 },
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
  modalBtn: { flex: 1, paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(128,128,128,0.1)' },

  menuRowBtn: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14 },
  menuRowIconBg: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  menuRowTitle: { fontSize: 14, fontWeight: '800' },
  menuRowSubtitle: { fontSize: 11, fontWeight: '600', marginTop: 2 },

  fullModalContainer: { flex: 1 },
  fullModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  fullModalCloseBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  fullModalCloseText: { color: '#2196F3', fontSize: 15, fontWeight: '700', marginLeft: 2 },
  fullModalTitle: { fontSize: 17, fontWeight: '900' },
  fullModalContent: { padding: 20, paddingBottom: 60 },

  faqSearchBox: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, gap: 10, marginBottom: 14 },
  faqSearchInput: { flex: 1, fontSize: 14, fontWeight: '600' },
  faqCategoryRow: { flexDirection: 'row', gap: 8 },
  faqChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: 'rgba(150,150,150,0.12)' },
  faqChipActive: { backgroundColor: '#2196F3' },
  faqChipText: { fontSize: 12, fontWeight: '800', color: '#8E8E93' },
  faqChipTextActive: { color: '#ffffff', fontWeight: '900' },

  faqCard: { borderRadius: 18, marginBottom: 10, padding: 16, overflow: 'hidden' },
  faqQuestionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  faqQuestionContent: { flex: 1, marginRight: 10 },
  faqBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginBottom: 6 },
  faqBadgeText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  faqQuestionText: { fontSize: 14, fontWeight: '800', lineHeight: 18 },
  faqAnswerContainer: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(150,150,150,0.12)' },
  faqAnswerText: { fontSize: 13, lineHeight: 19, fontWeight: '500' },

  emptyFaq: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  emptyFaqTitle: { fontSize: 16, fontWeight: '800', marginTop: 12 },
  emptyFaqText: { fontSize: 12, textAlign: 'center', marginTop: 6, paddingHorizontal: 30 },

  faqEmergencyCard: { backgroundColor: 'rgba(255, 59, 48, 0.08)', borderColor: '#FF3B30', borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 16 },
  faqEmergencyTitle: { fontSize: 13, fontWeight: '900', color: '#FF3B30' },
  faqEmergencyBody: { fontSize: 12, fontWeight: '600', color: '#FF3B30', lineHeight: 17 },

  manualChapterTitle: { fontSize: 16, fontWeight: '900', color: '#2196F3', marginBottom: 8 },
  manualText: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
  manualThresholdRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  manualStatusDot: { width: 12, height: 12, borderRadius: 6, marginTop: 3 },
  manualStatusName: { fontSize: 13, fontWeight: '800' },
  manualStatusDesc: { fontSize: 11, fontWeight: '600', marginTop: 2 },

  // Sensor Calibration Styles (Mobile Responsive)
  presetChip: { flex: 1, minWidth: 0, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  presetActive: { backgroundColor: '#2196F3' },
  presetText: { fontSize: 11, fontWeight: '800', color: '#8e8e93', textAlign: 'center' },
  sensorControlCard: { padding: 14, borderRadius: 18 },
  sensorIconBadge: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sensorTitle: { fontSize: 13, fontWeight: '800' },
  tareBtn: { backgroundColor: '#FF9500', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, alignItems: 'center', justifyContent: 'center', minWidth: 72 },
  tareBtnText: { color: '#fff', fontSize: 11, fontWeight: '800' },

  thresholdBlock: { padding: 12, borderRadius: 14, marginTop: 8 },
  thresholdTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  thresholdLabel: { fontSize: 13, fontWeight: '800' },
  thresholdSub: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  valBadge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  valBadgeText: { fontSize: 12, fontWeight: '900' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },

  stepperBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingTop: 4 },
  stepperBtnRound: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  stepperBtnRoundText: { fontSize: 24, fontWeight: '900', lineHeight: 26 },
  stepperCenterInfo: { alignItems: 'center', justifyContent: 'center', flex: 1, paddingHorizontal: 8 },
  stepperBigVal: { fontSize: 19, fontWeight: '900', letterSpacing: 0.5 },
  stepperUnitText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginTop: 1 },

  syncBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 20, borderRadius: 14, gap: 8 },
  syncBtnText: { fontWeight: '900', fontSize: 14, color: '#fff' },

  // ESP32 Wi-Fi Setup Styles
  wifiGuideBox: { padding: 14, borderRadius: 14, marginBottom: 14 },
  wifiGuideStep: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 },
  wifiStepBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#2196F3', alignItems: 'center', justifyContent: 'center' },
  wifiStepBadgeText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  wifiStepText: { fontSize: 12, flex: 1, lineHeight: 17 },
  openWifiPortalBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, gap: 8 },
  openWifiPortalBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },

  portalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  portalHeaderBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 6 },
  portalHeaderBtnText: { fontSize: 13, fontWeight: '700' },
  portalTitle: { fontSize: 15, fontWeight: '900' },
  portalLoadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B0F19' },
  portalLoadingText: { fontSize: 15, fontWeight: '800', marginTop: 14 },
  portalErrorContainer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#0B0F19' },
  portalErrorTitle: { fontSize: 18, fontWeight: '900', marginTop: 14 },
  portalErrorDesc: { fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 18, paddingHorizontal: 16 },
  portalStepsBox: { width: '100%', padding: 16, borderRadius: 14, marginTop: 20, marginBottom: 20, gap: 8 },
  portalStepItem: { fontSize: 12, lineHeight: 18 },
  retryPortalBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, gap: 8 },
  retryPortalBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
});