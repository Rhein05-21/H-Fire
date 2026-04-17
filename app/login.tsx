import MapView, { Marker } from '@/components/Map';
import { useUser } from '@/context/UserContext';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useOAuth, useSignIn } from '@clerk/clerk-expo';
import { FontAwesome } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const { width } = Dimensions.get('window');
const ACCENT = '#2196F3';

WebBrowser.maybeCompleteAuthSession();

const InputField = ({ label, inputBg, textColor, colorScheme, placeholderColor, labelColor, ...props }: any) => (
  <View style={styles.inputContainer}>
    <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
    <TextInput
      style={[styles.input, { backgroundColor: inputBg, color: textColor, borderColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}
      placeholderTextColor={placeholderColor}
      {...props}
    />
  </View>
);

export default function LoginScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const { 
    isAuthenticated, userDetails, updateProfile, loading: contextLoading 
  } = useUser();

  const backgroundColor = useThemeColor({}, 'background');
  const textColor = useThemeColor({}, 'text');
  const inputBg = useThemeColor({ light: '#f2f2f7', dark: 'rgba(255,255,255,0.07)' }, 'background');
  const placeholderColor = colorScheme === 'dark' ? 'rgba(255,255,255,0.4)' : '#8e8e93';
  const subtitleColor = colorScheme === 'dark' ? 'rgba(255,255,255,0.5)' : '#666';
  const labelColor = colorScheme === 'dark' ? 'rgba(255,255,255,0.6)' : '#444';

  const { signIn, setActive, isLoaded: signInLoaded } = useSignIn();
  
  const { startOAuthFlow: startGoogleFlow } = useOAuth({ strategy: "oauth_google" });
  const { startOAuthFlow: startFacebookFlow } = useOAuth({ strategy: "oauth_facebook" });

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  // Profile Completion State (for first-time social login)
  const [isProfilePending, setIsProfilePending] = useState(false);
  const [profileStep, setProfileStep] = useState(1);
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [blockLot, setBlockLot] = useState(''); 
  const [address, setAddress] = useState('');
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isStepValid, setIsStepValid] = useState(false);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    if (isAuthenticated && !contextLoading) {
      if (userDetails && userDetails.name && userDetails.block_lot) {
        router.replace('/(tabs)');
      } else {
        setIsProfilePending(true);
      }
    }
  }, [isAuthenticated, userDetails, contextLoading]);

  // Real-time Validation Effect
  useEffect(() => {
    const validate = () => {
      if (!isProfilePending) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) return 'Invalid email';
        if (password.length < 1) return 'Password required';
      } else {
        if (profileStep === 1) {
          if (!firstName.trim() || firstName.trim().length < 2) return 'First Name too short';
          if (!lastName.trim() || lastName.trim().length < 2) return 'Last Name too short';
          if (!blockLot.trim()) return 'Block & Lot required';
        } else if (profileStep === 2) {
          if (!location) return 'Location required';
        }
      }
      return '';
    };

    const validationError = validate();
    setIsStepValid(validationError === '');
    if (error && validationError === '') setError('');
  }, [email, password, firstName, lastName, blockLot, location, isProfilePending, profileStep]);

  const triggerShake = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 70, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 70, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 70, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -6, duration: 70, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 70, useNativeDriver: true }),
    ]).start();
  };

  const handlePasswordLogin = async () => {
    if (!signInLoaded || !isStepValid) { triggerShake(); return; }
    setLoading(true);
    setError('');
    try {
      const result = await signIn.create({ identifier: email.trim().toLowerCase(), password });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else { setError('Login incomplete.'); }
    } catch (err: any) { setError(err.errors?.[0]?.message || 'Login failed'); triggerShake(); }
    finally { setLoading(false); }
  };

  const handleSocialLogin = async (provider: 'google' | 'facebook') => {
    setLoading(true);
    setError('');
    try {
      const flow = provider === 'google' ? startGoogleFlow : startFacebookFlow;
      const { createdSessionId, setActive: setOAuthActive } = await flow({ redirectUrl: Linking.createURL('/', { scheme: 'hfire' }) });
      if (createdSessionId && setOAuthActive) {
        await setOAuthActive({ session: createdSessionId });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err: any) { setError(err.message || `${provider} login failed`); triggerShake(); }
    finally { setLoading(false); }
  };

  const handleCompleteProfile = async () => {
    if (profileStep === 1) {
      if (!isStepValid) { triggerShake(); return; }
      setError('');
      setProfileStep(2);
      return;
    }
    if (!isStepValid) { triggerShake(); return; }
    setLoading(true);
    setError('');
    try {
      const fullName = `${lastName.trim()}, ${firstName.trim()}${middleName ? ' ' + middleName.trim() : ''}`;
      const { error: updateErr } = await updateProfile({
        name: fullName,
        block_lot: blockLot.trim(),
        latitude: location?.latitude,
        longitude: location?.longitude,
        address: address.trim(),
      });
      if (updateErr) throw updateErr;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)');
    } catch (err: any) { setError(err.message || 'Failed to update profile'); triggerShake(); }
    finally { setLoading(false); }
  };

  const handleMapPress = async (coords: { latitude: number; longitude: number }) => {
    setLocation(coords);
    try {
      const [rev] = await Location.reverseGeocodeAsync(coords);
      if (rev) {
        const parts = [rev.name, rev.streetNumber, rev.street, rev.subregion, rev.district, rev.city, rev.region];
        setAddress(parts.filter(Boolean).join(', '));
      }
    } catch (e) {}
  };

  const getCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setLocation(coords);
      mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 1000);
      const [rev] = await Location.reverseGeocodeAsync(coords);
      if (rev) {
        const parts = [rev.name, rev.streetNumber, rev.street, rev.subregion, rev.district, rev.city, rev.region];
        setAddress(parts.filter(Boolean).join(', '));
      }
    } catch (err) {}
  };

  const sharedProps = { inputBg, textColor, colorScheme, placeholderColor, labelColor };

  return (
    <KeyboardAvoidingView 
      style={[styles.container, { backgroundColor }]} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <View style={[styles.bgTop, { backgroundColor: colorScheme === 'dark' ? 'rgba(33, 150, 243, 0.08)' : 'rgba(33, 150, 243, 0.05)' }]} />
      <View style={[styles.bgBottom, { backgroundColor: colorScheme === 'dark' ? 'rgba(33, 150, 243, 0.04)' : 'rgba(33, 150, 243, 0.02)' }]} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.brandRow}>
          <Image 
            source={require('@/assets/images/h-fire_logo.png')} 
            style={styles.logoImage} 
            resizeMode="contain"
          />
          <Text style={[styles.brandTitle, { color: textColor }]}>H-FIRE</Text>
          <Text style={styles.brandSub}>RESIDENT MONITOR</Text>
        </View>

        <Text style={[styles.subtitle, { color: subtitleColor }]}>
          {!isProfilePending ? 'Sign in to access your dashboard' : `Complete your profile - Step ${profileStep} of 2`}
        </Text>

        <Animated.View style={[styles.form, { transform: [{ translateX: shakeAnim }] }]}>
          {!isProfilePending ? (
            <>
              <InputField label="Email Address" placeholder="example@email.com" keyboardType="email-address" autoCapitalize="none" maxLength={100} value={email} onChangeText={setEmail} {...sharedProps} />
              <InputField label="Password" placeholder="Your password" secureTextEntry maxLength={100} value={password} onChangeText={setPassword} {...sharedProps} />
            </>
          ) : profileStep === 1 ? (
            <View style={{ gap: 15 }}>
              <InputField label="First Name" placeholder="John" maxLength={50} value={firstName} onChangeText={setFirstName} {...sharedProps} />
              <InputField label="Middle Name (Optional)" placeholder="Quincy" maxLength={50} value={middleName} onChangeText={setMiddleName} {...sharedProps} />
              <InputField label="Last Name" placeholder="Doe" maxLength={50} value={lastName} onChangeText={setLastName} {...sharedProps} />
              <InputField label="Block and Lot Number" placeholder="Block 1 Lot 1" maxLength={100} value={blockLot} onChangeText={setBlockLot} {...sharedProps} />
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <InputField label="Detailed Household Address" placeholder="House No., Street, etc." maxLength={250} value={address} onChangeText={setAddress} multiline {...sharedProps} />
              <View style={{ height: 300, borderRadius: 16, overflow: 'hidden' }}>
                <MapView ref={mapRef} style={StyleSheet.absoluteFill} initialRegion={{ latitude: location?.latitude || 14.5995, longitude: location?.longitude || 120.9842, latitudeDelta: 0.01, longitudeDelta: 0.01 }} onPress={(e: any) => handleMapPress(e.nativeEvent.coordinate)}>
                  {location && <Marker coordinate={location} title="Your Location" />}
                </MapView>
                <TouchableOpacity style={styles.locationBtn} onPress={getCurrentLocation}>
                  <FontAwesome name="location-arrow" size={16} color="#fff" />
                  <Text style={styles.locationBtnText}>Use Current Location</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity style={[styles.authBtn, !isStepValid && { opacity: 0.6 }]} onPress={() => { if (isProfilePending) handleCompleteProfile(); else handlePasswordLogin(); }} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : (
              <Text style={styles.authBtnText}>
                {isProfilePending ? (profileStep === 1 ? 'CONTINUE' : 'FINISH SETUP') : 'SIGN IN'}
              </Text>
            )}
          </TouchableOpacity>

          {!isProfilePending && (
            <>
              <View style={styles.socialRow}>
                <TouchableOpacity style={[styles.socialBtn, { backgroundColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)', borderColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]} onPress={() => handleSocialLogin('google')}>
                  <FontAwesome name="google" size={24} color={textColor} />
                  <Text style={[styles.socialBtnText, { color: textColor }]}>Google</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.socialBtn, { backgroundColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)', borderColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]} onPress={() => handleSocialLogin('facebook')}>
                  <FontAwesome name="facebook" size={24} color={textColor} />
                  <Text style={[styles.socialBtnText, { color: textColor }]}>Facebook</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.linksRow}>
                <TouchableOpacity onPress={() => router.push('/forgot-password')}>
                  <Text style={[styles.linkText, { color: subtitleColor }]}>Forgot Password?</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.signupToggle} onPress={() => router.push('/signup')}>
                <Text style={[styles.toggleBtnText, { color: subtitleColor }]}>Don't have an account? <Text style={{ color: ACCENT }}>Sign Up</Text></Text>
              </TouchableOpacity>
            </>
          )}
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20 },
  bgTop: { position: 'absolute', top: -100, left: -80, width: 350, height: 350, borderRadius: 175 },
  bgBottom: { position: 'absolute', bottom: -80, right: -80, width: 300, height: 300, borderRadius: 150 },
  brandRow: { alignItems: 'center', marginBottom: 20 },
  logoImage: { width: 100, height: 100, marginBottom: 10 },
  brandTitle: { fontSize: 32, fontWeight: '900', letterSpacing: 8 },
  brandSub: { color: ACCENT, fontSize: 12, fontWeight: '900', letterSpacing: 4, marginTop: 4 },
  subtitle: { fontSize: 14, textAlign: 'center', marginBottom: 30, lineHeight: 22, maxWidth: width * 0.8 },
  form: { width: '100%', gap: 15 },
  inputContainer: { gap: 6 },
  label: { fontSize: 12, fontWeight: '800', marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderRadius: 16, padding: 18, fontSize: 16, borderWidth: 1 },
  authBtn: { backgroundColor: ACCENT, borderRadius: 16, padding: 20, alignItems: 'center', shadowColor: ACCENT, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 },
  authBtnText: { color: '#fff', fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  socialRow: { flexDirection: 'row', gap: 15, marginTop: 10 },
  socialBtn: { flex: 1, flexDirection: 'row', borderRadius: 16, padding: 15, alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1 },
  socialBtnText: { fontSize: 14, fontWeight: '700' },
  linksRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 5, marginTop: 5 },
  linkText: { fontSize: 13, fontWeight: '600' },
  signupToggle: { marginTop: 20, alignItems: 'center' },
  toggleBtnText: { fontSize: 14, fontWeight: '600' },
  errorText: { color: '#FF3B30', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  locationBtn: { position: 'absolute', bottom: 10, alignSelf: 'center', backgroundColor: ACCENT, borderRadius: 20, paddingHorizontal: 15, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 5 },
  locationBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  backToLoginBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 10, gap: 8, marginTop: 5 },
  backToLoginText: { fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
});
