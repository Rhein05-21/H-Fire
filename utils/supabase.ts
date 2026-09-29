import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export interface ProfileRecord {
  id: string;
  name: string;
  block_lot?: string | null;
  updated_at?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  is_admin?: boolean | null;
  push_token?: string | null;
  emergency_hotline?: string | null;
  address?: string | null;
  email?: string | null;
  role?: string | null;
  location_url?: string | null;
}

export interface DeviceRecord {
  mac: string;
  house_name: string;
  label: string;
  profile_id?: string | null;
  created_at?: string | null;
  last_seen?: string | null;
  block_lot?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  current_ppm?: number;
  flame?: boolean;
  current_status?: string;
}

export interface IncidentRecord {
  id: number;
  device_mac: string;
  status: 'Active' | 'Resolved';
  start_time?: string | null;
  end_time?: string | null;
  resolved_by?: string | null;
  notes?: string | null;
  ppm_at_trigger?: number | null;
  alert_type?: 'FIRE' | 'GAS / SMOKE LEAK' | 'SMOKE' | 'FLAME' | string | null;
  profile_id?: string | null;
  house_name?: string;
  label?: string;
}

export interface GasLogRecord {
  id: number;
  created_at: string;
  device_mac: string;
  ppm_level: number;
  status: 'Normal' | 'Warning' | 'Danger';
  profile_id?: string | null;
}

export interface FamilyMemberRecord {
  id: number;
  profile_id: string;
  full_name: string;
  age?: number | null;
  relationship: string;
  email?: string | null;
  phone: string;
  is_primary?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AppSettingRecord {
  key: string;
  value: string;
  updated_at?: string | null;
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl && 
  supabaseAnonKey && 
  !supabaseUrl.includes('placeholder')
);

const isWeb = Platform.OS === 'web';
const isSSR = isWeb && typeof window === 'undefined';

const customStorage = {
  getItem: async (key: string) => {
    if (isSSR) return null;
    return AsyncStorage.getItem(key);
  },
  setItem: async (key: string, value: string) => {
    if (isSSR) return;
    return AsyncStorage.setItem(key, value);
  },
  removeItem: async (key: string) => {
    if (isSSR) return;
    return AsyncStorage.removeItem(key);
  },
};

export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseAnonKey || 'placeholder', {
  auth: {
    storage: customStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
