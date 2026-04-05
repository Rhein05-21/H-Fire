import 'react-native-url-polyfill/auto';
import { Buffer } from 'buffer';
global.Buffer = global.Buffer || Buffer;
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import React, { useEffect, useState } from 'react';
import { supabase } from '@/utils/supabase';
import { ThemeProvider, useAppTheme } from '@/context/ThemeContext';
import { UserProvider, useUser } from '@/context/UserContext';
import EmergencyModal from '@/components/EmergencyModal';
import { usePushNotifications } from '@/hooks/use-push-notifications';

export const unstable_settings = {
  anchor: '(tabs)',
};

function RootLayoutContent() {
  const { colorScheme } = useAppTheme();
  const { isAdmin, profileId, activeIncident, triggerEmergency, dismissEmergency } = useUser();

  // 1. REGISTER FOR PUSH NOTIFICATIONS (Temporarily disabled for Expo Go Testing)
  // usePushNotifications(profileId);

  // 2. SUPABASE LISTENER (Fallback / Remote)
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
            alert_type: newIncident.alert_type as 'FIRE' | 'SMOKE',
            device_mac: newIncident.device_mac
          });
        }
      )
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, [isAdmin, profileId]);

  // MQTT is now handled globally in UserProvider

  return (
    <NavigationThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
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
    </NavigationThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <UserProvider>
        <RootLayoutContent />
      </UserProvider>
    </ThemeProvider>
  );
}
