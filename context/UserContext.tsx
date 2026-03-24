import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/utils/supabase';

interface UserDetails {
  name: string;
  community: string;
  latitude?: number;
  longitude?: number;
}

interface UserContextType {
  userDetails: UserDetails | null;
  setUserDetails: (details: UserDetails) => void;
  profileId: string | null;
  refreshProfile: () => Promise<void>;
  loading: boolean;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [userDetails, setUserDetailsState] = useState<UserDetails | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = async () => {
    try {
      let currentId = await AsyncStorage.getItem('HFIRE_PROFILE_ID');
      if (!currentId) {
        currentId = `user_${Math.random().toString(36).slice(2, 11)}`;
        await AsyncStorage.setItem('HFIRE_PROFILE_ID', currentId);
      }
      setProfileId(currentId);

      // Try Supabase first
      const { data: dbProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentId)
        .single();

      if (dbProfile) {
        const profileData = { 
          name: dbProfile.name, 
          community: dbProfile.community,
          latitude: dbProfile.latitude,
          longitude: dbProfile.longitude
        };
        setUserDetailsState(profileData);
        await AsyncStorage.setItem('HFIRE_USER_DETAILS', JSON.stringify(profileData));
      } else {
        // Fallback to Local
        const userJson = await AsyncStorage.getItem('HFIRE_USER_DETAILS');
        if (userJson) {
          setUserDetailsState(JSON.parse(userJson));
        }
      }
    } catch (e) {
      console.error('Failed to load user profile', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshProfile();
  }, []);

  const setUserDetails = async (details: UserDetails) => {
    setUserDetailsState(details);
    await AsyncStorage.setItem('HFIRE_USER_DETAILS', JSON.stringify(details));
  };

  return (
    <UserContext.Provider value={{ userDetails, setUserDetails, profileId, refreshProfile, loading }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}
