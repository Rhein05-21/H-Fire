import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { useThemeColor } from '@/hooks/use-theme-color';
import { IconSymbol } from '@/components/ui/icon-symbol';

interface BackgroundGuardModalProps {
  visible: boolean;
  onEnable: () => void;
  onDismiss: () => void;
}

export const BackgroundGuardModal: React.FC<BackgroundGuardModalProps> = ({
  visible,
  onEnable,
  onDismiss,
}) => {
  const cardBg = useThemeColor({ light: '#ffffff', dark: '#1c1c1e' }, 'background');
  const textColor = useThemeColor({ light: '#111827', dark: '#F9FAFB' }, 'text');
  const mutedText = useThemeColor({ light: '#6B7280', dark: '#9CA3AF' }, 'text');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: cardBg }]}>
          {/* Header Icon */}
          <View style={styles.iconCircle}>
            <Text style={styles.iconEmoji}>🛡️</Text>
          </View>

          {/* Title & Subtitle */}
          <Text style={[styles.title, { color: textColor }]}>
            Enable 24/7 Safety Guard?
          </Text>
          <Text style={[styles.subtitle, { color: mutedText }]}>
            H-Fire needs permission to run background safety monitoring so it can alert and protect your home at all times.
          </Text>

          {/* Feature List */}
          <View style={styles.featureList}>
            <View style={styles.featureItem}>
              <View style={styles.bulletIcon}>
                <IconSymbol name="bell.badge.fill" size={16} color="#FF3B30" />
              </View>
              <View style={styles.featureTextContainer}>
                <Text style={[styles.featureTitle, { color: textColor }]}>
                  Alarm While Closed & Locked
                </Text>
                <Text style={[styles.featureDesc, { color: mutedText }]}>
                  Rings siren and drops emergency banner even if playing games or phone is asleep.
                </Text>
              </View>
            </View>

            <View style={styles.featureItem}>
              <View style={styles.bulletIcon}>
                <IconSymbol name="gauge.with.needle.fill" size={16} color="#2196F3" />
              </View>
              <View style={styles.featureTextContainer}>
                <Text style={[styles.featureTitle, { color: textColor }]}>
                  Live Lock-Screen PPM Widget
                </Text>
                <Text style={[styles.featureDesc, { color: mutedText }]}>
                  View continuous gas PPM and fire sensor status right in your notification tray.
                </Text>
              </View>
            </View>

            <View style={styles.featureItem}>
              <View style={styles.bulletIcon}>
                <IconSymbol name="bolt.shield.fill" size={16} color="#34C759" />
              </View>
              <View style={styles.featureTextContainer}>
                <Text style={[styles.featureTitle, { color: textColor }]}>
                  Ultra Low Battery Usage
                </Text>
                <Text style={[styles.featureDesc, { color: mutedText }]}>
                  Optimized background listener uses minimal battery.
                </Text>
              </View>
            </View>
          </View>

          {/* Action Buttons */}
          <TouchableOpacity
            style={styles.enableBtn}
            onPress={onEnable}
            activeOpacity={0.8}
          >
            <Text style={styles.enableBtnText}>Enable 24/7 Safety Guard</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.dismissBtn}
            onPress={onDismiss}
            activeOpacity={0.7}
          >
            <Text style={[styles.dismissBtnText, { color: mutedText }]}>
              Not Now (Only Alert When App Is Open)
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.3,
        shadowRadius: 20,
      },
      android: {
        elevation: 10,
      },
    }),
  },
  iconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(33, 150, 243, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: 'rgba(33, 150, 243, 0.3)',
  },
  iconEmoji: {
    fontSize: 32,
  },
  title: {
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 6,
  },
  featureList: {
    width: '100%',
    gap: 14,
    marginBottom: 24,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  bulletIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(150, 150, 150, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  featureTextContainer: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 2,
  },
  featureDesc: {
    fontSize: 12,
    lineHeight: 16,
  },
  enableBtn: {
    width: '100%',
    backgroundColor: '#2196F3',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    shadowColor: '#2196F3',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  enableBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  dismissBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  dismissBtnText: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
});
