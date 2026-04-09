import 'react-native-url-polyfill/auto';
import { Buffer } from 'buffer';
global.Buffer = global.Buffer || Buffer;
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import React, { useEffect, useState } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { View, Image, StyleSheet, Animated, ActivityIndicator } from 'react-native';
import { supabase } from '@/utils/supabase';
import { ThemeProvider, useAppTheme } from '@/context/ThemeContext';
import { UserProvider, useUser } from '@/context/UserContext';
import EmergencyModal from '@/components/EmergencyModal';
import ErrorBoundary from '@/components/ErrorBoundary';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { ThemedText } from '@/components/themed-text';
import { useThemeColor } from '@/hooks/use-theme-color';
import * as Sentry from '@sentry/react-native';
import { ClerkProvider, ClerkLoaded } from '@clerk/clerk-expo';
import { tokenCache } from '@/utils/cache';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

if (!publishableKey) {
  throw new Error(
    'Missing Publishable Key. Please set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in your .env',
  );
}

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

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/login');
    } else if (isAuthenticated && inAuthGroup) {
      if (userDetails) {
        router.replace('/(tabs)');
      }
    } else if (isAuthenticated && !inAuthGroup && !userDetails) {
      router.replace('/login');
    }
  }, [isAuthenticated, loading, segments, userDetails]);

  return null; // Logic only, no UI to avoid double indicators
}

function RootLayoutContent() {
  const { colorScheme } = useAppTheme();
  const { isAdmin, profileId, activeIncident, triggerEmergency, dismissEmergency, loading } = useUser();
  const backgroundColor = useThemeColor({}, 'background');
  const accentColor = '#2196F3';
  
  const [splashVisible, setSplashVisible] = useState(true);
  const fadeAnim = React.useRef(new Animated.Value(1)).current;

  usePushNotifications(profileId);

  useEffect(() => {
    if (!profileId) return;
    const channel = supabase
      .channel('global-alerts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'incidents' },
        async (payload) => {
          const newIncident = payload.new;
          if (newIncident.status !== 'Active') return;
          if (!isAdmin && newIncident.profile_id !== profileId) return;

          const { data: device } = await supabase
            .from('devices')
            .select('house_name, label')
            .eq('mac', newIncident.device_mac)
            .single();

          triggerEmergency({
            id: newIncident.id,
            house_name: device?.house_name || 'Unknown House',
            label: device?.label || 'Unknown Room',
            ppm: newIncident.ppm_at_trigger,
            alert_type: newIncident.alert_type as any,
            device_mac: newIncident.device_mac
          });
        }
      )
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [isAdmin, profileId]);

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

      {/* Global Theme-Aware Loading Overlay (only if splash is gone) */}
      {loading && !splashVisible && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor, justifyContent: 'center', alignItems: 'center', zIndex: 9998 }]}>
          <ActivityIndicator size="large" color={accentColor} />
        </View>
      )}

      {splashVisible && (
        <Animated.View style={[styles.splashContainer, { backgroundColor, opacity: fadeAnim }]}>
          <Image 
            source={require('@/assets/images/H-Fire _logo.png')} 
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
      <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
        <ClerkLoaded>
          <SafeAreaProvider>
            <ThemeProvider>
              <UserProvider>
                <RootLayoutContent />
              </UserProvider>
            </ThemeProvider>
          </SafeAreaProvider>
        </ClerkLoaded>
      </ClerkProvider>
    </ErrorBoundary>
  );
}

export default Sentry.wrap(RootLayout);
