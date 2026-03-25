import React, { useEffect, useState, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Modal, Animated, Dimensions } from 'react-native';
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
    alert_type: 'FIRE' | 'SMOKE';
    device_mac?: string;
  } | null;
  onClose: () => void;
}

export default function EmergencyModal({ visible, incident, onClose }: EmergencyModalProps) {
  const { devices } = useUser();
  const [pulseAnim] = useState(new Animated.Value(1));
  const [sound, setSound] = useState<Audio.Sound | null>(null);

  // REAL-TIME PPM LOOKUP: Get the current live PPM for the device causing the alarm
  const livePpm = useMemo(() => {
    if (!incident?.device_mac) return incident?.ppm || 0;
    const currentDevice = devices[incident.device_mac];
    return currentDevice ? currentDevice.ppm : incident.ppm;
  }, [devices, incident]);

  async function playSiren() {
    try {
      if (!incident) return;
      if (sound) { await sound.stopAsync(); await sound.unloadAsync(); }

      console.log(`Loading ${incident.alert_type} Alarm Sound...`);
      const soundFile = incident.alert_type === 'FIRE' 
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

  const handleAcknowledge = async () => {
    await stopSiren();
    onClose();
  };

  if (!incident) return null;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <Animated.View style={[styles.alertCircle, { transform: [{ scale: pulseAnim }] }]}>
          <IconSymbol name="flame.fill" size={80} color="#fff" />
        </Animated.View>

        <View style={styles.content}>
          <Text style={styles.emergencyTitle}>EMERGENCY ALERT</Text>
          <Text style={styles.houseName}>{incident.house_name}</Text>
          <Text style={styles.locationDetail}>{incident.label.toUpperCase()}</Text>
          
          <View style={styles.ppmBadge}>
            <Text style={styles.ppmValue}>{livePpm} PPM</Text>
            <Text style={styles.ppmLabel}>CURRENT LIVE LEVEL</Text>
          </View>

          <Text style={styles.instruction}>Immediate response required at this location.</Text>

          <TouchableOpacity style={styles.ackBtn} onPress={handleAcknowledge}>
            <Text style={styles.ackBtnText}>ACKNOWLEDGE INCIDENT</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(211, 47, 47, 0.95)', justifyContent: 'center', alignItems: 'center', padding: 30 },
  alertCircle: { width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center', marginBottom: 40 },
  content: { alignItems: 'center', width: '100%' },
  emergencyTitle: { color: '#fff', fontSize: 14, fontWeight: '900', letterSpacing: 4, marginBottom: 20 },
  houseName: { color: '#fff', fontSize: 32, fontWeight: '900', textAlign: 'center' },
  locationDetail: { color: 'rgba(255,255,255,0.8)', fontSize: 18, fontWeight: '700', marginTop: 5, letterSpacing: 1 },
  ppmBadge: { backgroundColor: '#fff', paddingHorizontal: 25, paddingVertical: 15, borderRadius: 20, alignItems: 'center', marginTop: 30, marginBottom: 30, elevation: 10 },
  ppmValue: { color: '#D32F2F', fontSize: 36, fontWeight: '900' },
  ppmLabel: { color: '#D32F2F', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  instruction: { color: '#fff', fontSize: 16, textAlign: 'center', fontWeight: '600', lineHeight: 24, marginBottom: 40, opacity: 0.9 },
  ackBtn: { backgroundColor: '#1a1a1a', width: '100%', padding: 22, borderRadius: 20, alignItems: 'center', elevation: 5 },
  ackBtnText: { color: '#fff', fontSize: 16, fontWeight: '900', letterSpacing: 1 },
});
