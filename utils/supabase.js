import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const isWeb = Platform.OS === 'web';
const isSSR = isWeb && typeof window === 'undefined';

const customStorage = {
  getItem: async (key) => {
    if (isSSR) return null;
    return AsyncStorage.getItem(key);
  },
  setItem: async (key, value) => {
    if (isSSR) return;
    return AsyncStorage.setItem(key, value);
  },
  removeItem: async (key) => {
    if (isSSR) return;
    return AsyncStorage.removeItem(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: customStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
