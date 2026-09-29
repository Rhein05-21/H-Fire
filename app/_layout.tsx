import 'react-native-url-polyfill/auto';
import { Buffer } from 'buffer';
global.Buffer = global.Buffer || Buffer;
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import React, { useEffect, useState } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import * as Updates from 'expo-updates';
import { View, Image, StyleSheet, Animated, ActivityIndicator } from 'react-native';
import { supabase } from '@/utils/supabase';
import { ThemeProvider, useAppTheme } from '@/context/ThemeContext';
import { UserProvider, useUser } from '@/context/UserContext';
import EmergencyModal from '@/components/EmergencyModal';
import { BackgroundGuardModal } from '@/components/BackgroundGuardModal';
import ErrorBoundary from '@/components/ErrorBoundary';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { ThemedText } from '@/components/themed-text';
import { useThemeColor } from '@/hooks/use-theme-color';
import * as Sentry from '@sentry/react-native';
import * as Notifications from 'expo-notifications';
import { Audio } from 'expo-av';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Platform } from 'react-native';

// CONFIGURE NOTIFICATION BEHAVIOR AT MODULE ROOT FOR EXPO GO & STANDALONE
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  } as any),
});

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  debug: false,
});

export const unstable_settings = {
  anchor: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

function ProtectedLayout() {
  const { isAuthenticated, loading, userDetails } = useUser();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === 'login' || segments[0] === 'signup' || segments[0] === 'forgot-password';
    const isProfileComplete = Boolean(userDetails && userDetails.name && userDetails.block_lot);

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/login');
    } else if (isAuthenticated && inAuthGroup) {
      if (isProfileComplete) {
        router.replace('/(tabs)');
      }
    } else if (isAuthenticated && !inAuthGroup && !isProfileComplete) {
      router.replace('/login');
    }
  }, [isAuthenticated, loading, segments, userDetails]);

  return null; // Logic only, no UI to avoid double indicators
}

function RootLayoutContent() {
  const { colorScheme } = useAppTheme();
  const { 
    isAuthenticated,
    isAdmin, 
    profileId, 
    activeIncident, 
    triggerEmergency, 
    dismissEmergency, 
    loading,
    showGuardPrompt,
    enableGuard,
    dismissGuardPrompt 
  } = useUser();
  const backgroundColor = useThemeColor({}, 'background');
  const accentColor = '#2196F3';
  
  const [splashVisible, setSplashVisible] = useState(true);
  const fadeAnim = React.useRef(new Animated.Value(1)).current;

  usePushNotifications(profileId);

  // --- NOTIFICATIONS CHANNELS & PERMISSIONS INITIALIZATION ---
  useEffect(() => {
    async function initNotifications() {
      try {
        if (Platform.OS === 'android') {
          // 1. Critical Alarm Channel (Max Priority with sound & vibration)
          await Notifications.setNotificationChannelAsync('emergency-alerts', {
            name: 'Emergency Alerts',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 500, 250, 500],
            lightColor: '#FF3B30',
            sound: 'default',
            enableVibrate: true,
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
          });

          // 2. Persistent Safety Guard Channel (Low priority, silent, keeps process alive in background)
          await Notifications.setNotificationChannelAsync('hfire-guard', {
            name: 'H-Fire 24/7 Safety Guard',
            importance: Notifications.AndroidImportance.LOW,
            enableVibrate: false,
            showBadge: false,
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
          });
        }

        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        if (existingStatus !== 'granted') {
          await Notifications.requestPermissionsAsync();
        }
      } catch (e) {
        console.warn('Notification init:', e);
      }
    }
    initNotifications();
  }, []);

  // --- GLOBAL AUDIO CONFIGURATION ---
  useEffect(() => {
    async function setupAudio() {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          staysActiveInBackground: true,
          interruptionModeIOS: 1, // DoNotMix
          playsInSilentModeIOS: true,
          shouldDuckAndroid: false, // Don't duck, we want full volume for alarms
          interruptionModeAndroid: 1, // DoNotMix
          playThroughEarpieceAndroid: false,
        });
      } catch (e) {
        console.warn('Audio setup failed', e);
      }
    }
    setupAudio();
  }, []);

  // --- NOTIFICATION TAP HANDLER (for Background/Killed state) ---
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response: any) => {
      const data = response?.notification?.request?.content?.data as any;
      if (data?.incidentId || data?.device_mac) {
        triggerEmergency({
          id: data.incidentId || Date.now(),
          house_name: String(data.house_name || 'Home'),
          label: String(data.label || 'Sensor Unit'),
          ppm: Number(data.ppm || 0),
          alert_type: String(data.alert_type || 'FIRE'),
          device_mac: data.device_mac ? String(data.device_mac) : undefined,
        });
      }
    });
    return () => subscription.remove();
  }, [triggerEmergency]);

  // --- OTA UPDATE LOGIC ---
  useEffect(() => {
    async function onFetchUpdateAsync() {
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync();
          await Updates.reloadAsync();
        }
      } catch (error) {
        // Silently fail, or log to Sentry if needed
      }
    }
    if (!__DEV__) onFetchUpdateAsync();
  }, []);

  useEffect(() => {
    if (!profileId) return;
    const channel = supabase
      .channel('global-alerts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'incidents' },
        async (payload: any) => {
          const newIncident = payload.new;
          
          if (newIncident.status !== 'Active') return;

          try {
            const { data: dev } = await supabase.from('devices').select('profile_id, house_name, label').eq('mac', newIncident.device_mac).maybeSingle();
            if (!isAdmin && (newIncident.profile_id || dev?.profile_id) !== profileId) return;

            const houseName = dev?.house_name || 'Emergency House';
            const label = dev?.label || 'Sensor Unit';
            const alertType = newIncident.alert_type || 'FIRE';
            const ppm = newIncident.ppm_at_trigger || 0;

            triggerEmergency({
              id: newIncident.id,
              house_name: houseName,
              label: label,
              ppm,
              alert_type: alertType as any,
              device_mac: newIncident.device_mac,
              status: 'Active',
            });

            // 2. Dispatch Local Heads-Up System Notification Banner immediately
            await Notifications.scheduleNotificationAsync({
              content: {
                title: `🔥 CRITICAL HAZARD: ${alertType}`,
                body: `EMERGENCY at ${houseName} (${label})! Gas/Smoke level: ${ppm} PPM. Tap to open emergency siren & contact family.`,
                sound: 'default',
                priority: Notifications.AndroidNotificationPriority.MAX,
                vibrate: [0, 500, 250, 500],
                channelId: 'emergency-alerts',
                data: {
                  incidentId: newIncident.id,
                  house_name: houseName,
                  label: label,
                  ppm,
                  alert_type: alertType,
                  device_mac: newIncident.device_mac,
                },
              } as any,
              trigger: null,
            });
          } catch (err) {
            console.error('Error handling new incident:', err);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'incidents' },
        (payload: any) => {
          const updated = payload.new;
          if (updated.status === 'Resolved') {
            dismissEmergency();
          }
        }
      )
      .subscribe();
      
    return () => { supabase.removeChannel(channel); };
  }, [isAdmin, profileId, triggerEmergency, dismissEmergency]);

  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(() => {
        SplashScreen.hideAsync();
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }).start(() => setSplashVisible(false));
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  return (
    <NavigationThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <ProtectedLayout />
      <Stack>
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="signup" options={{ headerShown: false }} />
        <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
        <Stack.Screen name="family-members" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(admin)/dashboard" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style="auto" />
      
      <EmergencyModal 
        visible={!!activeIncident} 
        incident={activeIncident} 
        onClose={dismissEmergency} 
      />

      <BackgroundGuardModal
        visible={showGuardPrompt}
        onEnable={enableGuard}
        onDismiss={dismissGuardPrompt}
      />

      {/* Global Theme-Aware Loading Overlay (only during initial cold start if splash is gone) */}
      {loading && !splashVisible && !isAuthenticated && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor, justifyContent: 'center', alignItems: 'center', zIndex: 9998 }]}>
          <ActivityIndicator size="large" color={accentColor} />
        </View>
      )}

      {splashVisible && (
        <Animated.View style={[styles.splashContainer, { backgroundColor, opacity: fadeAnim }]}>
          <Image 
            source={require('@/assets/images/h-fire_logo.png')} 
            style={styles.splashLogo}
            resizeMode="contain"
          />
          <ThemedText type="defaultSemiBold" style={styles.splashText}>
            Fire/Gas Leak Monitoring System
          </ThemedText>
        </Animated.View>
      )}
    </NavigationThemeProvider>
  );
}

const styles = StyleSheet.create({
  splashContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  splashLogo: {
    width: 250,
    height: 250,
    marginBottom: 20,
  },
  splashText: {
    fontSize: 14,
    letterSpacing: 1.2,
    opacity: 0.8,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});

function RootLayout() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <ThemeProvider>
          <UserProvider>
            <RootLayoutContent />
          </UserProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

export default Sentry.wrap(RootLayout);
