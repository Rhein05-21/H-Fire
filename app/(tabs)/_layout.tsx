import { Tabs } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useThemeColor } from '@/hooks/use-theme-color';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const backgroundColor = useThemeColor({ light: '#fff', dark: '#1e1e1e' }, 'background');
  const shadowColor = useThemeColor({ light: '#000', dark: '#000' }, 'text');
  const activeTintColor = Colors[colorScheme ?? 'light'].tint;
  const inactiveTintColor = colorScheme === 'dark' ? '#666' : '#999';

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: activeTintColor,
        tabBarInactiveTintColor: inactiveTintColor,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          backgroundColor: backgroundColor,
          borderTopWidth: 0,
          elevation: 20,
          shadowColor: shadowColor,
          shadowOpacity: 0.1,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: -5 },
          height: 80,
          paddingBottom: 20,
          paddingTop: 8,
          borderTopLeftRadius: 30,
          borderTopRightRadius: 30,
          position: 'absolute',
          borderWidth: 0,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '900',
          marginTop: -4,
        }
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'MONITOR',
          tabBarIcon: ({ color }) => <IconSymbol size={22} name="waveform.path.ecg" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'HISTORY',
          tabBarIcon: ({ color }) => <IconSymbol size={22} name="clock.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'SETTINGS',
          tabBarIcon: ({ color }) => <IconSymbol size={22} name="gearshape.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}
