import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Alert, Modal, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import mqtt from 'mqtt';
import { supabase } from '@/utils/supabase';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useAppTheme, ThemeType } from '@/context/ThemeContext';
import { useUser } from '@/context/UserContext';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';

const { width, height } = Dimensions.get('window');

const MQTT_URL = `wss://${process.env.EXPO_PUBLIC_HIVEMQ_BROKER}:${process.env.EXPO_PUBLIC_HIVEMQ_PORT}/mqtt`;
const MQTT_OPTIONS = {
  username: process.env.EXPO_PUBLIC_HIVEMQ_USERNAME,
  password: process.env.EXPO_PUBLIC_HIVEMQ_PASSWORD,
  clientId: `hfire_app_${Math.random().toString(16).slice(3)}`,
};

export default function SettingsScreen() {
  const { theme, setTheme, colorScheme } = useAppTheme();
  const { userDetails, setUserDetails, profileId, loading } = useUser();
  
  // Theme Colors
  const backgroundColor = useThemeColor({}, 'background');
  const textColor = useThemeColor({}, 'text');
  const cardBg = useThemeColor({ light: '#fff', dark: '#1e1e1e' }, 'background');
  const inputBg = useThemeColor({ light: '#f8f9fa', dark: '#2a2a2a' }, 'background');
  const borderColor = useThemeColor({ light: '#eee', dark: '#333' }, 'background');
  const secondaryText = useThemeColor({ light: '#666', dark: '#aaa' }, 'text');

  const [name, setName] = useState('');
  const [community, setCommunity] = useState('');
  const [location, setLocation] = useState<{ latitude: number, longitude: number } | null>(null);
  
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [mapRegion, setMapRegion] = useState({
    latitude: 14.5995,
    longitude: 120.9842,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });

  useEffect(() => {
    if (userDetails) {
      setName(userDetails.name || '');
      setCommunity(userDetails.community || '');
      if (userDetails.latitude && userDetails.longitude) {
        setLocation({ latitude: userDetails.latitude, longitude: userDetails.longitude });
        setMapRegion({
          ...mapRegion,
          latitude: userDetails.latitude,
          longitude: userDetails.longitude,
        });
      }
    }
  }, [userDetails]);

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Name is required.');
      return;
    }

    setSaving(true);
    try {
      const details = { 
        name, 
        community,
        latitude: location?.latitude,
        longitude: location?.longitude
      };
      
      const { error } = await supabase
        .from('profiles')
        .upsert({ id: profileId, ...details });

      if (error) throw error;

      await setUserDetails(details);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Success', 'Profile updated successfully.');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleResetWiFi = () => {
    Alert.alert(
      'Reset Device Wi-Fi',
      'This will clear the saved Wi-Fi credentials on your H-Fire device. The device will restart and enter Setup Mode. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Reset Now', 
          style: 'destructive',
          onPress: performWiFiReset
        }
      ]
    );
  };

  const performWiFiReset = () => {
    setResetting(true);
    const client = mqtt.connect(MQTT_URL, MQTT_OPTIONS);

    const timeout = setTimeout(() => {
      client.end();
      setResetting(false);
      Alert.alert('Timeout', 'Failed to connect to the device. Please ensure it is online.');
    }, 10000);

    client.on('connect', () => {
      const configTopic = 'hfire/house1/config';
      client.publish(configTopic, 'RESET_WIFI', { qos: 1 }, (err) => {
        clearTimeout(timeout);
        client.end();
        setResetting(false);
        if (err) {
          Alert.alert('Error', 'Failed to send reset command.');
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert('Success', 'Reset command sent. The device should restart into Setup Mode shortly.');
        }
      });
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      client.end();
      setResetting(false);
      Alert.alert('Connection Error', 'Could not reach the MQTT broker.');
    });
  };

  const getCurrentLocation = async () => {
    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Allow location access to find your current position.');
      return;
    }

    let current = await Location.getCurrentPositionAsync({});
    const newCoords = {
      latitude: current.coords.latitude,
      longitude: current.coords.longitude,
    };
    setLocation(newCoords);
    setMapRegion({
      ...mapRegion,
      ...newCoords,
    });
  };

  const ThemeOption = ({ label, value, icon }: { label: string, value: ThemeType, icon: any }) => (
    <TouchableOpacity 
      style={[
        styles.themeOption, 
        { backgroundColor: inputBg, borderColor: theme === value ? '#2196F3' : borderColor },
        theme === value && { borderWidth: 2 }
      ]}
      onPress={() => {
        setTheme(value);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }}
    >
      <IconSymbol name={icon} size={24} color={theme === value ? '#2196F3' : textColor} />
      <Text style={[styles.themeOptionText, { color: theme === value ? '#2196F3' : textColor }]}>{label}</Text>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor }]}>
        <ActivityIndicator size="large" color="#2196F3" />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <ThemedText type="title" style={styles.title}>Settings</ThemedText>
          <Text style={styles.subtitle}>Personalize your H-Fire experience</Text>
        </View>

        <View style={[styles.section, { backgroundColor: cardBg }]}>
          <Text style={styles.sectionTitle}>PROFILE INFORMATION</Text>
          
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>YOUR NAME</Text>
            <TextInput
              style={[styles.input, { backgroundColor: inputBg, color: textColor, borderColor }]}
              value={name}
              onChangeText={setName}
              placeholder="Enter your name"
              placeholderTextColor="#999"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>BLOCK / COMMUNITY</Text>
            <TextInput
              style={[styles.input, { backgroundColor: inputBg, color: textColor, borderColor }]}
              value={community}
              onChangeText={setCommunity}
              placeholder="e.g. Phase 1 Block 5"
              placeholderTextColor="#999"
            />
          </View>

          <View style={styles.inputGroup}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <Text style={styles.inputLabel}>HOME LOCATION</Text>
              <TouchableOpacity onPress={() => setShowMap(true)}>
                <Text style={{ color: '#2196F3', fontSize: 12, fontWeight: '800' }}>OPEN MAP</Text>
              </TouchableOpacity>
            </View>
            
            {location ? (
              <View style={[styles.locationPreview, { backgroundColor: inputBg, borderColor }]}>
                <IconSymbol name="house.fill" size={20} color="#2196F3" />
                <View style={{ marginLeft: 12 }}>
                  <Text style={[styles.locationCoords, { color: textColor }]}>
                    {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                  </Text>
                  <Text style={styles.locationSub}>Saved Coordinates</Text>
                </View>
              </View>
            ) : (
              <TouchableOpacity 
                style={[styles.locationPlaceholder, { backgroundColor: inputBg, borderStyle: 'dashed', borderColor }]}
                onPress={() => setShowMap(true)}
              >
                <IconSymbol name="paperplane.fill" size={20} color="#aaa" />
                <Text style={styles.locationPlaceholderText}>Tap to set your location</Text>
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity 
            style={[styles.saveBtn, saving && { opacity: 0.7 }]} 
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.saveBtnText}>Update Profile</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={[styles.section, { backgroundColor: cardBg }]}>
          <Text style={styles.sectionTitle}>APPEARANCE</Text>
          <Text style={[styles.inputLabel, { marginBottom: 15 }]}>THEME PREFERENCE</Text>
          
          <View style={styles.themeContainer}>
            <ThemeOption label="Light" value="light" icon="sun.max.fill" />
            <ThemeOption label="Dark" value="dark" icon="moon.fill" />
            <ThemeOption label="Auto" value="auto" icon="waveform.path.ecg" />
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: cardBg }]}>
          <Text style={styles.sectionTitle}>DEVICE MANAGEMENT</Text>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>CONNECTIVITY</Text>
            <TouchableOpacity 
              style={[styles.resetBtn, resetting && { opacity: 0.7 }]} 
              onPress={handleResetWiFi}
              disabled={resetting}
            >
              {resetting ? (
                <ActivityIndicator size="small" color="#FF5252" />
              ) : (
                <>
                  <IconSymbol name="antenna.radiowaves.left.and.right" size={20} color="#FF5252" />
                  <Text style={styles.resetBtnText}>Reset Device Wi-Fi</Text>
                </>
              )}
            </TouchableOpacity>
            <Text style={styles.helperText}>
              Use this if you want to connect your H-Fire device to a different Wi-Fi network.
            </Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.versionText}>H-Fire Version 1.0.0</Text>
        </View>
      </ScrollView>

      {/* Map Modal */}
      <Modal visible={showMap} animationType="slide">
        <View style={[styles.mapContainer, { backgroundColor }]}>
          <MapView
            provider={PROVIDER_GOOGLE}
            style={styles.map}
            region={mapRegion}
            onRegionChangeComplete={setMapRegion}
            onPress={(e) => setLocation(e.nativeEvent.coordinate)}
            userInterfaceStyle={colorScheme}
          >
            {location && (
              <Marker 
                coordinate={location} 
                title="Your Home"
                description="H-Fire Protected"
              />
            )}
          </MapView>

          <View style={styles.mapHeader}>
            <TouchableOpacity 
              style={styles.mapCloseBtn} 
              onPress={() => setShowMap(false)}
            >
              <IconSymbol name="xmark.circle.fill" size={32} color="#000" />
            </TouchableOpacity>
            <View style={styles.mapTip}>
              <Text style={styles.mapTipText}>Tap anywhere to set your home location</Text>
            </View>
          </View>

          <View style={styles.mapFooter}>
            <TouchableOpacity style={styles.currentLocBtn} onPress={getCurrentLocation}>
              <IconSymbol name="paperplane.fill" size={20} color="#2196F3" />
              <Text style={styles.currentLocText}>Use Current Location</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.confirmLocBtn, !location && { opacity: 0.5 }]} 
              onPress={() => setShowMap(false)}
              disabled={!location}
            >
              <Text style={styles.confirmLocText}>Confirm Location</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 100 },
  header: { marginBottom: 30, marginTop: 10 },
  title: { fontSize: 32, fontWeight: '900' },
  subtitle: { fontSize: 14, color: '#888', fontWeight: '700', marginTop: 4 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  section: {
    borderRadius: 24,
    padding: 20,
    marginBottom: 20,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: '#2196F3',
    letterSpacing: 1.5,
    marginBottom: 20,
  },
  inputGroup: { marginBottom: 20 },
  inputLabel: {
    fontSize: 10,
    fontWeight: '900',
    color: '#888',
    marginBottom: 8,
    letterSpacing: 1,
  },
  input: {
    borderRadius: 16,
    padding: 16,
    fontSize: 16,
    borderWidth: 1,
    fontWeight: '600',
  },
  locationPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  locationCoords: {
    fontSize: 14,
    fontWeight: '800',
  },
  locationSub: {
    fontSize: 11,
    color: '#999',
    fontWeight: '600',
  },
  locationPlaceholder: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  locationPlaceholderText: {
    color: '#aaa',
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 10,
  },
  saveBtn: {
    backgroundColor: '#2196F3',
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    marginTop: 10,
    elevation: 4,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
  themeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  themeOption: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 16,
    marginHorizontal: 5,
    borderWidth: 1,
  },
  themeOptionText: {
    fontSize: 12,
    fontWeight: '900',
    marginTop: 8,
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#FF5252',
    marginTop: 5,
  },
  resetBtnText: {
    color: '#FF5252',
    fontSize: 14,
    fontWeight: '900',
    marginLeft: 10,
  },
  helperText: {
    fontSize: 11,
    color: '#888',
    marginTop: 10,
    fontWeight: '600',
    lineHeight: 16,
  },
  footer: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 40,
  },
  versionText: {
    fontSize: 12,
    color: '#aaa',
    fontWeight: '700',
  },
  // Map Styles
  mapContainer: { flex: 1 },
  map: { flex: 1 },
  mapHeader: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  mapCloseBtn: {
    backgroundColor: '#fff',
    borderRadius: 20,
    elevation: 10,
  },
  mapTip: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
    marginLeft: 15,
    flex: 1,
  },
  mapTipText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  mapFooter: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
  },
  currentLocBtn: {
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    borderRadius: 16,
    marginBottom: 15,
    elevation: 10,
  },
  currentLocText: {
    color: '#2196F3',
    fontWeight: '900',
    marginLeft: 10,
  },
  confirmLocBtn: {
    backgroundColor: '#2196F3',
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
    elevation: 10,
  },
  confirmLocText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
});
