import React, { useEffect, useState, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Modal, Animated, Dimensions, Linking, FlatList } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import { IconSymbol } from './ui/icon-symbol';
import { useUser } from '@/context/UserContext';

const { width, height } = Dimensions.get('window');

interface EmergencyModalProps {
  visible: boolean;
  incident: {
    id: string | number;
    house_name: string;
    label: string;
    ppm: number;
    alert_type: 'FIRE' | 'GAS/SMOKE' | 'SMOKE' | 'FLAME' | 'MODERATE SMOKE' | 'GAS / SMOKE LEAK';
    device_mac?: string;
  } | null;
  onClose: () => void;
}

const BFP_HOTLINE = '911'; // Bureau of Fire Protection placeholder
const ADMIN_CONTACT = '09123456789'; // Admin placeholder

export default function EmergencyModal({ visible, incident, onClose }: EmergencyModalProps) {
  const { devices, userDetails } = useUser();
  const [pulseAnim] = useState(new Animated.Value(1));
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [showCallOptions, setShowCallOptions] = useState(false);

  // REAL-TIME PPM LOOKUP
  const livePpm = useMemo(() => {
    if (!incident?.device_mac) return incident?.ppm || 0;
    const currentDevice = devices[incident.device_mac];
    return currentDevice ? currentDevice.ppm : incident.ppm;
  }, [devices, incident]);

  async function playSiren() {
    try {
      if (!incident) return;
      if (sound) { await sound.stopAsync(); await sound.unloadAsync(); }

      const isFire = incident.alert_type === 'FIRE';
      const soundFile = isFire 
        ? require('../assets/Fire Alarm.mp3') 
        : require('../assets/Smoke Alarm Sound.mp3');

      const { sound: newSound } = await Audio.Sound.createAsync(
        soundFile,
        { shouldPlay: true, isLooping: true, volume: 1.0 }
      );
      setSound(newSound);
      await newSound.playAsync();
    } catch (error) { console.error('CRITICAL: Failed to play siren', error); }
  }

  async function stopSiren() {
    if (sound) {
      await sound.stopAsync();
      await sound.unloadAsync();
      setSound(null);
    }
  }

  useEffect(() => {
    let vibrationInterval: any;
    if (visible) {
      playSiren();
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
    } else { stopSiren(); }

    return () => { if (vibrationInterval) clearInterval(vibrationInterval); stopSiren(); };
  }, [visible]);

  const handleCall = (number: string) => {
    Linking.openURL(`tel:${number}`);
  };

  const handleAcknowledge = async () => {
    await stopSiren();
    onClose();
  };

  if (!incident) return null;

  const isFire = incident.alert_type === 'FIRE';

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={[styles.overlay, { backgroundColor: isFire ? 'rgba(211, 47, 47, 0.98)' : 'rgba(255, 149, 0, 0.98)' }]}>
        <Animated.View style={[styles.alertCircle, { transform: [{ scale: pulseAnim }] }]}>
          <IconSymbol name={isFire ? "flame.fill" : "exclamationmark.triangle.fill"} size={80} color="#fff" />
        </Animated.View>

        {!showCallOptions ? (
          <View style={styles.content}>
            <Text style={styles.emergencyTitle}>{isFire ? 'FIRE EMERGENCY ALERT' : 'SMOKE / GAS ALERT'}</Text>
            <Text style={styles.houseName}>{incident.house_name}</Text>
            <Text style={styles.locationDetail}>{incident.label.toUpperCase()}</Text>
            
            <View style={styles.ppmBadge}>
              <Text style={[styles.ppmValue, { color: isFire ? '#D32F2F' : '#FF9500' }]}>{livePpm} PPM</Text>
              <Text style={[styles.ppmLabel, { color: isFire ? '#D32F2F' : '#FF9500' }]}>CURRENT LIVE LEVEL</Text>
            </View>

            <Text style={styles.instruction}>Immediate response required at this location.</Text>

            <TouchableOpacity style={styles.callMainBtn} onPress={() => setShowCallOptions(true)}>
              <IconSymbol name="phone.fill" size={24} color="#fff" />
              <Text style={styles.callMainBtnText}>CALL FOR HELP</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.ackLink} onPress={handleAcknowledge}>
              <Text style={styles.ackLinkText}>Acknowledge Incident</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.content}>
            <Text style={styles.emergencyTitle}>SELECT CONTACT</Text>
            
            <View style={styles.contactList}>
              <TouchableOpacity style={styles.contactItem} onPress={() => handleCall(ADMIN_CONTACT)}>
                <View style={styles.contactIcon}><IconSymbol name="person.fill" size={24} color="#fff" /></View>
                <View style={styles.contactText}>
                  <Text style={styles.contactName}>Household Member / Owner</Text>
                  <Text style={styles.contactDesc}>Contact house owner directly</Text>
                </View>
                <IconSymbol name="chevron.right" size={20} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>

              <TouchableOpacity style={styles.contactItem} onPress={() => handleCall(ADMIN_CONTACT)}>
                <View style={[styles.contactIcon, { backgroundColor: '#2196F3' }]}><IconSymbol name="shield.fill" size={24} color="#fff" /></View>
                <View style={styles.contactText}>
                  <Text style={styles.contactName}>System Administrator</Text>
                  <Text style={styles.contactDesc}>Emergency Support Line</Text>
                </View>
                <IconSymbol name="chevron.right" size={20} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>

              <TouchableOpacity style={styles.contactItem} onPress={() => handleCall(BFP_HOTLINE)}>
                <View style={[styles.contactIcon, { backgroundColor: '#D32F2F' }]}><IconSymbol name="flame.fill" size={24} color="#fff" /></View>
                <View style={styles.contactText}>
                  <Text style={styles.contactName}>BFP HOTLINE</Text>
                  <Text style={styles.contactDesc}>Bureau of Fire Protection</Text>
                </View>
                <IconSymbol name="chevron.right" size={20} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.backBtn} onPress={() => setShowCallOptions(false)}>
              <Text style={styles.backBtnText}>GO BACK</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  alertCircle: { width: 140, height: 140, borderRadius: 70, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center', marginBottom: 40 },
  content: { alignItems: 'center', width: '100%' },
  emergencyTitle: { color: '#fff', fontSize: 14, fontWeight: '900', letterSpacing: 4, marginBottom: 20 },
  houseName: { color: '#fff', fontSize: 32, fontWeight: '900', textAlign: 'center' },
  locationDetail: { color: 'rgba(255,255,255,0.8)', fontSize: 18, fontWeight: '700', marginTop: 5, letterSpacing: 1 },
  ppmBadge: { backgroundColor: '#fff', paddingHorizontal: 25, paddingVertical: 15, borderRadius: 20, alignItems: 'center', marginTop: 30, marginBottom: 30, elevation: 10 },
  ppmValue: { fontSize: 36, fontWeight: '900' },
  ppmLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  instruction: { color: '#fff', fontSize: 16, textAlign: 'center', fontWeight: '600', lineHeight: 24, marginBottom: 40, opacity: 0.9 },
  callMainBtn: { backgroundColor: '#fff', width: '100%', padding: 22, borderRadius: 20, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', elevation: 5 },
  callMainBtnText: { color: '#D32F2F', fontSize: 18, fontWeight: '900', letterSpacing: 1, marginLeft: 10 },
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

