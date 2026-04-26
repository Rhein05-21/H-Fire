import React, { useEffect, useState, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Modal, Animated, Dimensions, Linking, FlatList } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import { IconSymbol } from './ui/icon-symbol';
import { useUser } from '@/context/UserContext';

import { supabase } from '@/utils/supabase';

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
  const { devices, profileId } = useUser();
  const [pulseAnim] = useState(new Animated.Value(1));
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [showCallOptions, setShowCallOptions] = useState(false);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);

  // REAL-TIME STATUS & COLOR ANIMATION
  const isFire = useMemo(() => {
    if (!incident?.device_mac) return incident?.alert_type === 'FIRE';
    const currentDevice = devices[incident.device_mac];
    // Mirror system thresholds: > 1500 is Danger/Fire
    return (currentDevice?.ppm || incident.ppm) > 1500;
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
      playSiren();
    }
  }, [isFire, visible]);

  const dynamicBg = bgAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(211, 47, 47, 0.98)', 'rgba(255, 149, 0, 0.98)']
  });

  // FETCH REAL CONTACTS
  useEffect(() => {
    if (visible && profileId) {
      setLoadingContacts(true);
      supabase
        .from('family_members')
        .select('*')
        .eq('profile_id', profileId)
        .then(({ data }) => {
          if (data) setFamilyMembers(data);
          setLoadingContacts(false);
        });
    } else if (!visible) {
      setFamilyMembers([]);
    }
  }, [visible, profileId]);

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
    } else {
      setShowCallOptions(true);
    }
  };

  async function playSiren() {
    try {
      if (!incident) return;

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

      // 2. Cleanup existing sound
      if (sound) {
        await sound.stopAsync();
        await sound.unloadAsync();
      }

      // 3. Resolve Asset based on LIVE status
      const soundFile = isFire 
        ? require('../assets/Fire Alarm.mp3') 
        : require('../assets/Smoke Alarm Sound.mp3');

      // 4. Load and Play
      const { sound: newSound } = await Audio.Sound.createAsync(
        soundFile,
        { shouldPlay: true, isLooping: true, volume: 1.0, androidImplementation: 'MediaPlayer' }
      );
      setSound(newSound);
      await newSound.playAsync();
    } catch (error) { 
      console.error('CRITICAL: Failed to play siren', error); 
    }
  }

  async function stopSiren() {
    if (sound) {
      try {
        await sound.stopAsync();
        await sound.unloadAsync();
      } catch (e) {}
      setSound(null);
    }
  }

  useEffect(() => {
    let vibrationInterval: any;
    if (visible) {
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

            <TouchableOpacity style={styles.callMainBtn} onPress={handleCallPrimary}>
              <IconSymbol name="phone.fill" size={24} color={isFire ? "#D32F2F" : "#FF9500"} />
              <Text style={[styles.callMainBtnText, { color: isFire ? "#D32F2F" : "#FF9500" }]}>
                {familyMembers.length > 0 ? 'CALL PRIMARY CONTACT' : 'CALL FOR HELP'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.callSecondaryBtn} onPress={() => setShowCallOptions(true)}>
              <Text style={styles.callSecondaryBtnText}>OTHER CALL OPTIONS</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.ackLink} onPress={handleAcknowledge}>
              <Text style={styles.ackLinkText}>Dismiss Alert</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.content}>
            <Text style={styles.emergencyTitle}>SELECT CONTACT</Text>
            
            <View style={styles.contactList}>
              {familyMembers.length > 0 ? familyMembers.map((member) => (
                <TouchableOpacity key={member.id} style={styles.contactItem} onPress={() => handleCall(member.phone)}>
                  <View style={[styles.contactIcon, member.is_primary && { backgroundColor: '#34C759' }]}>
                    <IconSymbol name="person.fill" size={24} color="#fff" />
                  </View>
                  <View style={styles.contactText}>
                    <Text style={styles.contactName}>{member.full_name}</Text>
                    <Text style={styles.contactDesc}>{member.relationship} {member.is_primary ? '(Primary)' : ''}</Text>
                  </View>
                  <IconSymbol name="phone.fill" size={20} color="rgba(255,255,255,0.5)" />
                </TouchableOpacity>
              )) : (
                <View style={styles.contactItem}>
                  <Text style={[styles.contactName, { opacity: 0.6 }]}>No household contact registered</Text>
                </View>
              )}

              <TouchableOpacity style={styles.contactItem} onPress={() => handleCall(ADMIN_CONTACT)}>
                <View style={[styles.contactIcon, { backgroundColor: '#2196F3' }]}><IconSymbol name="shield.fill" size={24} color="#fff" /></View>
                <View style={styles.contactText}>
                  <Text style={styles.contactName}>System Administrator</Text>
                  <Text style={styles.contactDesc}>Emergency Support Line</Text>
                </View>
                <IconSymbol name="phone.fill" size={20} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>

              <TouchableOpacity style={styles.contactItem} onPress={() => handleCall(BFP_HOTLINE)}>
                <View style={[styles.contactIcon, { backgroundColor: '#D32F2F' }]}><IconSymbol name="flame.fill" size={24} color="#fff" /></View>
                <View style={styles.contactText}>
                  <Text style={styles.contactName}>BFP HOTLINE (911)</Text>
                  <Text style={styles.contactDesc}>Bureau of Fire Protection</Text>
                </View>
                <IconSymbol name="phone.fill" size={20} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.backBtn} onPress={() => setShowCallOptions(false)}>
              <Text style={styles.backBtnText}>GO BACK</Text>
            </TouchableOpacity>
          </View>
        )}

      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  alertCircle: { width: 140, height: 140, borderRadius: 70, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center', marginBottom: 40 },
  content: { alignItems: 'center', width: '100%' },
  emergencyTitle: { color: '#fff', fontSize: 14, fontWeight: '900', letterSpacing: 4, marginBottom: 20, textAlign: 'center' },
  houseName: { color: '#fff', fontSize: 32, fontWeight: '900', textAlign: 'center' },
  locationDetail: { color: 'rgba(255,255,255,0.8)', fontSize: 18, fontWeight: '700', marginTop: 5, letterSpacing: 1 },
  ppmBadge: { backgroundColor: '#fff', paddingHorizontal: 25, paddingVertical: 15, borderRadius: 20, alignItems: 'center', marginTop: 30, marginBottom: 30, elevation: 10 },
  ppmValue: { fontSize: 36, fontWeight: '900' },
  ppmLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  instruction: { color: '#fff', fontSize: 16, textAlign: 'center', fontWeight: '600', lineHeight: 24, marginBottom: 40, opacity: 0.9 },
  callMainBtn: { backgroundColor: '#fff', width: '100%', padding: 22, borderRadius: 20, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', elevation: 5 },
  callMainBtnText: { fontSize: 18, fontWeight: '900', letterSpacing: 1, marginLeft: 10 },
  callSecondaryBtn: { marginTop: 15, width: '100%', padding: 18, borderRadius: 20, borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)', alignItems: 'center' },
  callSecondaryBtnText: { color: '#fff', fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  ackLink: { marginTop: 25, padding: 10 },
  ackLinkText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' },
  
  contactList: { width: '100%', gap: 15, marginBottom: 40 },
  contactItem: { backgroundColor: 'rgba(0,0,0,0.2)', padding: 18, borderRadius: 20, flexDirection: 'row', alignItems: 'center' },
  contactIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  contactText: { flex: 1 },
  contactName: { color: '#fff', fontSize: 16, fontWeight: '800' },
  contactDesc: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600', marginTop: 2 },
  backBtn: { padding: 20 },
  backBtnText: { color: '#fff', fontSize: 14, fontWeight: '900', letterSpacing: 2 }
});
