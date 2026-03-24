import 'react-native-url-polyfill/auto';
import { Buffer } from 'buffer';
global.Buffer = global.Buffer || Buffer;
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import React, { useEffect } from 'react';
import { supabase } from '@/utils/supabase';
import { ThemeProvider, useAppTheme } from '@/context/ThemeContext';
import { UserProvider } from '@/context/UserContext';

export const unstable_settings = {
  anchor: '(tabs)',
};

function RootLayoutContent() {
  const { colorScheme } = useAppTheme();

  useEffect(() => {
    console.log('Supabase client initialized:', supabase);
  }, []);

  return (
    <NavigationThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style="auto" />
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
