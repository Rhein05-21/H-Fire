import React, { useEffect, useState, useMemo } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  TouchableOpacity, 
  Modal, 
  Animated, 
  Dimensions, 
  Linking, 
  FlatList,
  ScrollView,
  Platform,
  Alert,
  ActivityIndicator
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import { IconSymbol } from './ui/icon-symbol';
import { useUser } from '@/context/UserContext';
import { supabase } from '@/utils/supabase';
import { dispatchAutomatedEmergencySms, SmsRecipient } from '@/utils/httpsms-client';

const { width, height } = Dimensions.get('window');

interface EmergencyModalProps {
  visible: boolean;
  incident: any;
  onClose: () => void;
}

interface FamilyMember {
  id: string | number;
  profile_id: string;
  full_name: string;
  phone: string;
  relationship: string;
  is_primary: boolean;
}

const BFP_HOTLINE = '911'; 
const ADMIN_CONTACT = '09123456789'; 

export default function EmergencyModal({ visible, incident, onClose }: EmergencyModalProps) {
  const { devices, profileId, userDetails } = useUser();
  const [pulseAnim] = useState(new Animated.Value(1));
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [showCallOptions, setShowCallOptions] = useState(false);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [savedHotline, setSavedHotline] = useState<string>(ADMIN_CONTACT);
  const [savedHotlineName, setSavedHotlineName] = useState<string>('System Administrator');
  const [sendingSms, setSendingSms] = useState(false);
  const [incidentLocation, setIncidentLocation] = useState<{
    latitude?: number | null;
    longitude?: number | null;
    address?: string | null;
  }>({});

  // REAL-TIME STATUS & COLOR ANIMATION
  const isFire = useMemo(() => {
    if (!incident?.device_mac) return incident?.alert_type === 'FIRE';
    const currentDevice = devices[incident.device_mac];
    // Mirror system thresholds: > 1500 or flame detected is Danger/Fire
    return (currentDevice?.ppm || incident.ppm) > 1500 || Boolean(currentDevice?.flame) || incident?.alert_type === 'FIRE';
  }, [devices, incident]);

  const [bgAnim] = useState(new Animated.Value(isFire ? 0 : 1));

  useEffect(() => {
    if (visible) {
      Animated.timing(bgAnim, {
        toValue: isFire ? 0 : 1,
        duration: 800,
        useNativeDriver: false,
      }).start();
      
      // Re-sync siren if state transitions while modal is open
      playSiren(isFire ? 'fire' : 'smoke');
    }
  }, [isFire, visible]);

  const dynamicBg = bgAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(211, 47, 47, 0.98)', 'rgba(255, 149, 0, 0.98)']
  });

  // FETCH REAL CONTACTS & SAVED HOTLINE
  useEffect(() => {
    if (visible) {
      setLoadingContacts(true);
      const targetProfileId = incident?.profile_id || profileId;

      if (targetProfileId) {
        supabase
          .from('family_members')
          .select('*')
          .eq('profile_id', targetProfileId)
          .then(({ data }) => {
            if (data && data.length > 0) {
              setFamilyMembers(data);
            } else if (profileId && profileId !== targetProfileId) {
              supabase
                .from('family_members')
                .select('*')
                .eq('profile_id', profileId)
                .then(({ data: userFam }) => {
                  if (userFam) setFamilyMembers(userFam);
                });
            } else {
              setFamilyMembers([]);
            }
            setLoadingContacts(false);
          });

        // Also fetch profile coordinates/address for accurate Google Maps location
        supabase
          .from('profiles')
          .select('latitude, longitude, address, block_lot')
          .eq('id', targetProfileId)
          .maybeSingle()
          .then(({ data: pLoc }) => {
            if (pLoc) {
              const fullAddr = [pLoc.block_lot, pLoc.address].filter(Boolean).join(', ');
              setIncidentLocation({
                latitude: pLoc.latitude,
                longitude: pLoc.longitude,
                address: fullAddr || undefined,
              });
            }
          });
      } else {
        setFamilyMembers([]);
        setIncidentLocation({});
        setLoadingContacts(false);
      }

      // Fetch Saved Hotline dynamically from emergency_settings / profiles
      async function fetchSavedHotline() {
        try {
          // 1. Check emergency_settings for hotline_number
          const { data: setting } = await supabase
            .from('emergency_settings')
            .select('value')
            .eq('key', 'hotline_number')
            .maybeSingle();

          if (setting?.value && !setting.value.includes('XXXXXXXXX')) {
            setSavedHotline(setting.value);
            setSavedHotlineName('Community Emergency Hotline');
            return;
          }

          // 2. Check guard / admin profiles for emergency_hotline
          const { data: guard } = await supabase
            .from('profiles')
            .select('name, emergency_hotline, role')
            .or('role.eq.guard,role.eq.admin,role.eq.hoa')
            .not('emergency_hotline', 'is', null)
            .limit(1)
            .maybeSingle();

          if (guard?.emergency_hotline && !guard.emergency_hotline.includes('XXXXXXXXX')) {
            setSavedHotline(guard.emergency_hotline);
            setSavedHotlineName(guard.name ? `${guard.name} (Hotline)` : 'Security Guard Hotline');
            return;
          }

          // 3. Check userDetails
          if (userDetails?.emergency_hotline && !userDetails.emergency_hotline.includes('XXXXXXXXX')) {
            setSavedHotline(userDetails.emergency_hotline);
            setSavedHotlineName('Saved Emergency Hotline');
          }
        } catch (e) {
          console.warn('[EmergencyModal] Failed to fetch hotline:', e);
        }
      }

      fetchSavedHotline();
    } else if (!visible) {
      setFamilyMembers([]);
      setShowCallOptions(false);
    }
  }, [visible, profileId, incident, userDetails]);

  // REAL-TIME PPM LOOKUP
  const livePpm = useMemo(() => {
    if (!incident?.device_mac) return incident?.ppm || 0;
    const currentDevice = devices[incident.device_mac];
    return currentDevice ? currentDevice.ppm : incident.ppm;
  }, [devices, incident]);

  const handleCallPrimary = () => {
    if (familyMembers.length > 0) {
      const primary = familyMembers.find(m => m.is_primary) || familyMembers[0];
      handleCall(primary.phone);
    } else if (savedHotline && savedHotline !== ADMIN_CONTACT) {
      handleCall(savedHotline);
    } else {
      setShowCallOptions(true);
    }
  };

  // Resolve accurate coordinates & address
  const activeLatitude = incidentLocation.latitude ?? userDetails?.latitude ?? null;
  const activeLongitude = incidentLocation.longitude ?? userDetails?.longitude ?? null;
  const activeAddress = incidentLocation.address || [userDetails?.block_lot, userDetails?.address].filter(Boolean).join(', ') || null;

  // Construct Emergency SMS Message
  const constructEmergencyMessage = () => {
    const timestampStr = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const alertLabel = isFire ? 'FIRE EMERGENCY' : 'CRITICAL GAS / SMOKE LEAK';
    const flameText = isFire ? 'FLAME CONFIRMED' : 'HIGH GAS LEVEL';

    let locationLines = '';
    if (activeAddress) {
      locationLines += `\nAddress: ${activeAddress}`;
    }
    if (activeLatitude && activeLongitude) {
      locationLines += `\nMap: https://maps.google.com/?q=${activeLatitude},${activeLongitude}`;
    } else if (activeAddress) {
      locationLines += `\nMap: https://maps.google.com/?q=${encodeURIComponent(activeAddress)}`;
    }

    return `[H-FIRE EMERGENCY ALERT]
${alertLabel}!
Resident: ${incident.house_name}${locationLines}
Unit: ${incident.label}
Hazard Level: ${livePpm} PPM (${flameText})
Time: ${timestampStr}
Immediate emergency assistance requested!`;
  };

  // Send SMS to Specific Number
  const handleSms = (number: string) => {
    const body = constructEmergencyMessage();
    const separator = Platform.OS === 'ios' ? '&' : '?';
    Linking.openURL(`sms:${number}${separator}body=${encodeURIComponent(body)}`);
  };

  // Direct SMS via httpSMS for a specific contact
  const handleDirectSms = async (name: string, phone: string, role: string) => {
    setSendingSms(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const result = await dispatchAutomatedEmergencySms({
        recipients: [{ name, phone, role }],
        incidentId: incident.id,
        profileId,
        houseName: incident.house_name,
        nodeLabel: incident.label,
        alertType: incident.alert_type || (isFire ? 'FIRE' : 'GAS / SMOKE LEAK'),
        ppm: livePpm,
        flame: isFire,
        latitude: activeLatitude,
        longitude: activeLongitude,
        address: activeAddress,
      });

      setSendingSms(false);

      if (result.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('✅ SMS Sent (httpSMS)', `Emergency alert dispatched via httpSMS to ${name} (${phone}).`);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert(
          'httpSMS Gateway Notice',
          `${result.results[0]?.error || 'Failed to dispatch via httpSMS.'}\n\nOpen phone Messages app instead?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Open Messages App',
              onPress: () => handleSms(phone),
            },
          ]
        );
      }
    } catch (e: any) {
      setSendingSms(false);
      Alert.alert('Error', e.message || 'Failed to dispatch SMS.');
    }
  };

  // Primary Auto SMS Action via httpSMS (Broadcast to Household & Saved Hotline)
  const handleAutoSms = async () => {
    setSendingSms(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Build recipient list
    const recipients: SmsRecipient[] = [];

    // 1. All family members
    familyMembers.forEach(m => {
      recipients.push({
        name: m.full_name,
        phone: m.phone,
        role: m.relationship || 'Family Member',
      });
    });

    // 2. Saved hotline
    if (savedHotline && savedHotline !== BFP_HOTLINE && !savedHotline.includes('XXXXXXXXX')) {
      recipients.push({
        name: savedHotlineName,
        phone: savedHotline,
        role: 'Community Hotline',
      });
    }

    if (recipients.length === 0) {
      setSendingSms(false);
      Alert.alert(
        'No Recipients Registered',
        'Please register family members or set an emergency hotline to send Auto SMS.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open Messages App',
            onPress: () => {
              const separator = Platform.OS === 'ios' ? '&' : '?';
              Linking.openURL(`sms:${separator}body=${encodeURIComponent(constructEmergencyMessage())}`);
            }
          }
        ]
      );
      return;
    }

    try {
      const result = await dispatchAutomatedEmergencySms({
        recipients,
        incidentId: incident.id,
        profileId,
        houseName: incident.house_name,
        nodeLabel: incident.label,
        alertType: incident.alert_type || (isFire ? 'FIRE' : 'GAS / SMOKE LEAK'),
        ppm: livePpm,
        flame: isFire,
        latitude: activeLatitude,
        longitude: activeLongitude,
        address: activeAddress,
      });

      setSendingSms(false);

      if (result.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const recipientListText = result.results
          .map(r => `• ${r.name} (${r.phone}): ${r.success ? '✅ Dispatched' : '❌ Failed'}`)
          .join('\n');

        Alert.alert(
          '🚨 Auto SMS Dispatched (httpSMS)',
          `Emergency alert successfully sent via httpSMS gateway to ${result.sentCount} recipient(s):\n\n${recipientListText}`
        );
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert(
          'httpSMS Gateway Notice',
          `${result.errorMessage || 'Failed to dispatch via httpSMS.'}\n\nWould you like to send via your phone's Messages app instead?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Open Messages App',
              onPress: () => {
                const separator = Platform.OS === 'ios' ? '&' : '?';
                const targetNumber = recipients[0]?.phone || '';
                Linking.openURL(`sms:${targetNumber}${separator}body=${encodeURIComponent(constructEmergencyMessage())}`);
              }
            }
          ]
        );
      }
    } catch (err: any) {
      setSendingSms(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Auto SMS Error', err.message || 'Network error occurred while calling httpSMS.');
    }
  };

  const currentPlayingTypeRef = React.useRef<string>('');
  const soundRef = React.useRef<Audio.Sound | null>(null);

  async function playSiren(targetType?: string) {
    const effectiveType = targetType || (isFire ? 'fire' : 'smoke');
    try {
      if (!incident) return;
      if (currentPlayingTypeRef.current === effectiveType && soundRef.current) {
        // Sound is already playing cleanly, do not restart
        return;
      }

      // 1. Force robust audio settings
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        interruptionModeIOS: 1, // DoNotMix
        playsInSilentModeIOS: true,
        shouldDuckAndroid: false,
        interruptionModeAndroid: 1, // DoNotMix
        playThroughEarpieceAndroid: false,
      });

      // 2. Cleanup existing sound if switching types
      if (soundRef.current) {
        try {
          await soundRef.current.stopAsync();
          await soundRef.current.unloadAsync();
        } catch {}
        soundRef.current = null;
      }

      // 3. Resolve Asset based on targetType
      const soundFile = effectiveType === 'fire'
        ? require('../assets/Fire Alarm.mp3') 
        : require('../assets/Smoke Alarm Sound.mp3');

      // 4. Load and Play
      const { sound: newSound } = await Audio.Sound.createAsync(
        soundFile,
        { shouldPlay: true, isLooping: true, volume: 1.0, androidImplementation: 'MediaPlayer' }
      );
      soundRef.current = newSound;
      currentPlayingTypeRef.current = effectiveType;
      setSound(newSound);
      await newSound.playAsync();
    } catch (error) { 
      console.error('Failed to play siren:', error); 
    }
  }

  async function stopSiren() {
    currentPlayingTypeRef.current = '';
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      } catch (e) {}
      soundRef.current = null;
      setSound(null);
    }
  }

  useEffect(() => {
    let vibrationInterval: any;
    if (visible) {
      playSiren(); // playSiren() ensures alarm sound plays on modal open
      setShowCallOptions(false);
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      ).start();
      vibrationInterval = setInterval(() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }, 1000);
    } else { 
      stopSiren(); 
    }

    return () => { 
      if (vibrationInterval) clearInterval(vibrationInterval); 
      stopSiren(); 
    };
  }, [visible]);

  const handleCall = (number: string) => {
    Linking.openURL(`tel:${number}`);
  };

  const handleAcknowledge = async () => {
    await stopSiren();
    onClose();
  };

  if (!incident) return null;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <Animated.View style={[styles.overlay, { backgroundColor: dynamicBg }]}>
        <Animated.View style={[styles.alertCircle, { transform: [{ scale: pulseAnim }] }]}>
          <IconSymbol name={isFire ? "flame.fill" : "exclamationmark.triangle.fill"} size={80} color="#fff" />
        </Animated.View>

        {!showCallOptions ? (
          <View style={styles.content}>
            <Text style={styles.emergencyTitle}>
              {isFire ? 'FIRE EMERGENCY ALERT' : 'WARNING: GAS LEAK / SMOKE DETECTED'}
            </Text>
            <Text style={styles.houseName}>{incident.house_name}</Text>
            <Text style={styles.locationDetail}>{incident.label.toUpperCase()}</Text>
            
            <View style={styles.ppmBadge}>
              <Text style={[styles.ppmValue, { color: isFire ? '#D32F2F' : '#FF9500' }]}>{livePpm} PPM</Text>
              <Text style={[styles.ppmLabel, { color: isFire ? '#D32F2F' : '#FF9500' }]}>CURRENT LIVE LEVEL</Text>
            </View>

            <Text style={styles.instruction}>Immediate response required at this location.</Text>

            {/* ACTION 1: CALL PRIMARY CONTACT / CALL FOR HELP */}
            <TouchableOpacity style={styles.callMainBtn} onPress={handleCallPrimary}>
              <IconSymbol name="phone.fill" size={24} color={isFire ? "#D32F2F" : "#FF9500"} />
              <Text style={[styles.callMainBtnText, { color: isFire ? "#D32F2F" : "#FF9500" }]}>
                {familyMembers.length > 0 ? 'CALL PRIMARY CONTACT' : 'CALL FOR HELP'}
              </Text>
            </TouchableOpacity>

            {/* ACTION 2: AUTO SMS EMERGENCY ALERT */}
            <TouchableOpacity 
              style={[styles.smsActionBtn, sendingSms && { opacity: 0.7 }]} 
              onPress={handleAutoSms}
              disabled={sendingSms}
            >
              {sendingSms ? (
                <>
                  <ActivityIndicator color="#fff" size="small" />
                  <Text style={styles.smsActionBtnText}>DISPATCHING AUTO SMS (httpSMS)...</Text>
                </>
              ) : (
                <>
                  <IconSymbol name="message.fill" size={20} color="#fff" />
                  <Text style={styles.smsActionBtnText}>AUTO SMS EMERGENCY ALERT</Text>
                </>
              )}
            </TouchableOpacity>

            {/* ACTION 3: OTHER OPTIONS & SAVED HOTLINE */}
            <TouchableOpacity style={styles.callSecondaryBtn} onPress={() => setShowCallOptions(true)}>
              <Text style={styles.callSecondaryBtnText}>OTHER OPTIONS & SAVED HOTLINE</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.ackLink} onPress={handleAcknowledge}>
              <Text style={styles.ackLinkText}>Dismiss Alert</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.content}>
            <Text style={styles.emergencyTitle}>EMERGENCY CONTACTS & HOTLINE</Text>
            
            <ScrollView style={styles.contactScroll} showsVerticalScrollIndicator={false}>
              {/* Broadcast Auto SMS Banner */}
              <TouchableOpacity 
                style={[styles.broadcastBanner, sendingSms && { opacity: 0.7 }]} 
                onPress={handleAutoSms}
                disabled={sendingSms}
              >
                <View style={styles.broadcastIconBox}>
                  {sendingSms ? (
                    <ActivityIndicator color="#FF3B30" size="small" />
                  ) : (
                    <IconSymbol name="bolt.fill" size={20} color="#FF3B30" />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.broadcastTitle}>BROADCAST AUTO SMS (httpSMS)</Text>
                  <Text style={styles.broadcastSub}>
                    {sendingSms ? 'Sending emergency SMS to all contacts...' : 'Auto-dispatches hazard alert to all contacts'}
                  </Text>
                </View>
                <IconSymbol name="message.fill" size={20} color="#fff" />
              </TouchableOpacity>

              {/* Family Members List */}
              <Text style={styles.directorySectionHeader}>HOUSEHOLD CONTACTS</Text>
              {familyMembers.length > 0 ? familyMembers.map((member) => (
                <View key={member.id} style={styles.contactItem}>
                  <View style={[styles.contactIcon, member.is_primary && { backgroundColor: '#34C759' }]}>
                    <IconSymbol name="person.fill" size={24} color="#fff" />
                  </View>
                  <View style={styles.contactText}>
                    <Text style={styles.contactName}>{member.full_name}</Text>
                    <Text style={styles.contactDesc}>{member.relationship} {member.is_primary ? '(Primary)' : ''} • {member.phone}</Text>
                  </View>
                  <View style={styles.contactActionGroup}>
                    <TouchableOpacity 
                      style={styles.actionBtnCall} 
                      onPress={() => handleCall(member.phone)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <IconSymbol name="phone.fill" size={18} color="#fff" />
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={styles.actionBtnSms} 
                      onPress={() => handleDirectSms(member.full_name, member.phone, member.relationship || 'Family Member')}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      disabled={sendingSms}
                    >
                      <IconSymbol name="message.fill" size={18} color="#fff" />
                    </TouchableOpacity>
                  </View>
                </View>
              )) : (
                <View style={styles.contactItem}>
                  <Text style={[styles.contactName, { opacity: 0.6 }]}>No household contact registered</Text>
                </View>
              )}

              {/* Saved Emergency Hotline / System Administrator */}
              <Text style={styles.directorySectionHeader}>SAVED EMERGENCY HOTLINE</Text>
              <View style={styles.contactItem}>
                <View style={[styles.contactIcon, { backgroundColor: '#2196F3' }]}>
                  <IconSymbol name="shield.fill" size={24} color="#fff" />
                </View>
                <View style={styles.contactText}>
                  <Text style={styles.contactName}>{savedHotlineName}</Text>
                  <Text style={styles.contactDesc}>Emergency Support Line • {savedHotline}</Text>
                </View>
                <View style={styles.contactActionGroup}>
                  <TouchableOpacity 
                    style={styles.actionBtnCall} 
                    onPress={() => handleCall(savedHotline)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <IconSymbol name="phone.fill" size={18} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={styles.actionBtnSms} 
                    onPress={() => handleDirectSms(savedHotlineName, savedHotline, 'Community Hotline')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    disabled={sendingSms}
                  >
                    <IconSymbol name="message.fill" size={18} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* BFP 911 Hotline */}
              <Text style={styles.directorySectionHeader}>GOVERNMENT HOTLINE</Text>
              <TouchableOpacity style={styles.contactItem} onPress={() => handleCall(BFP_HOTLINE)}>
                <View style={[styles.contactIcon, { backgroundColor: '#D32F2F' }]}>
                  <IconSymbol name="flame.fill" size={24} color="#fff" />
                </View>
                <View style={styles.contactText}>
                  <Text style={styles.contactName}>BFP HOTLINE (911)</Text>
                  <Text style={styles.contactDesc}>Bureau of Fire Protection • Speed Dial 911</Text>
                </View>
                <View style={styles.actionBtnCall}>
                  <IconSymbol name="phone.fill" size={18} color="#fff" />
                </View>
              </TouchableOpacity>
            </ScrollView>

            <TouchableOpacity style={styles.backBtn} onPress={() => setShowCallOptions(false)}>
              <Text style={styles.backBtnText}>GO BACK TO ALERT</Text>
            </TouchableOpacity>
          </View>
        )}

      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 25 },
  alertCircle: { width: 130, height: 130, borderRadius: 65, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center', marginBottom: 25 },
  content: { alignItems: 'center', width: '100%', flex: 1, justifyContent: 'center' },
  emergencyTitle: { color: '#fff', fontSize: 13, fontWeight: '900', letterSpacing: 3, marginBottom: 15, textAlign: 'center' },
  houseName: { color: '#fff', fontSize: 30, fontWeight: '900', textAlign: 'center' },
  locationDetail: { color: 'rgba(255,255,255,0.85)', fontSize: 16, fontWeight: '700', marginTop: 4, letterSpacing: 1 },
  ppmBadge: { backgroundColor: '#fff', paddingHorizontal: 22, paddingVertical: 12, borderRadius: 18, alignItems: 'center', marginTop: 20, marginBottom: 20, elevation: 10 },
  ppmValue: { fontSize: 34, fontWeight: '900' },
  ppmLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  instruction: { color: '#fff', fontSize: 14, textAlign: 'center', fontWeight: '600', lineHeight: 20, marginBottom: 25, opacity: 0.95 },
  callMainBtn: { backgroundColor: '#fff', width: '100%', paddingVertical: 18, borderRadius: 18, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', elevation: 5, marginBottom: 12 },
  callMainBtnText: { fontSize: 16, fontWeight: '900', letterSpacing: 1, marginLeft: 10 },
  smsActionBtn: { backgroundColor: 'rgba(0,0,0,0.3)', width: '100%', paddingVertical: 16, borderRadius: 18, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: '#fff', marginBottom: 12 },
  smsActionBtnText: { color: '#fff', fontSize: 14, fontWeight: '900', letterSpacing: 1, marginLeft: 8 },
  callSecondaryBtn: { width: '100%', paddingVertical: 15, borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)', alignItems: 'center', marginBottom: 5 },
  callSecondaryBtnText: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  ackLink: { marginTop: 15, padding: 8 },
  ackLinkText: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' },
  
  contactScroll: { width: '100%', flex: 1, marginBottom: 15 },
  directorySectionHeader: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '900', letterSpacing: 1.5, marginTop: 15, marginBottom: 8 },
  broadcastBanner: { backgroundColor: 'rgba(255,255,255,0.2)', padding: 15, borderRadius: 18, flexDirection: 'row', alignItems: 'center', marginBottom: 10, borderWidth: 1.5, borderColor: '#fff' },
  broadcastIconBox: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  broadcastTitle: { color: '#fff', fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
  broadcastSub: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '600', marginTop: 2 },
  contactItem: { backgroundColor: 'rgba(0,0,0,0.25)', padding: 14, borderRadius: 18, flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  contactIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  contactText: { flex: 1 },
  contactName: { color: '#fff', fontSize: 15, fontWeight: '800' },
  contactDesc: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600', marginTop: 2 },
  contactActionGroup: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  actionBtnCall: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#2196F3', justifyContent: 'center', alignItems: 'center' },
  actionBtnSms: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#34C759', justifyContent: 'center', alignItems: 'center' },
  backBtn: { padding: 15 },
  backBtnText: { color: '#fff', fontSize: 13, fontWeight: '900', letterSpacing: 1.5 }
});
