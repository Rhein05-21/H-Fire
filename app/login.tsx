import { useUser } from '@/context/UserContext';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { supabase } from '@/utils/supabase';
import { FontAwesome } from '@expo/vector-icons';
import * as AuthSession from 'expo-auth-session';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  Alert,
  Modal,
} from 'react-native';
import { WebView } from 'react-native-webview';

const { width } = Dimensions.get('window');
const ACCENT = '#2196F3';

WebBrowser.maybeCompleteAuthSession();

const InputField = ({ label, inputBg, textColor, colorScheme, placeholderColor, labelColor, error, ...props }: any) => (
  <View style={styles.inputContainer}>
    <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
    <TextInput
      style={[styles.input, { backgroundColor: inputBg, color: textColor, borderColor: error ? '#FF3B30' : (colorScheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)') }]}
      placeholderTextColor={placeholderColor}
      {...props}
    />
    {error ? <Text style={styles.inlineError}>{error}</Text> : null}
  </View>
);

export default function LoginScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const { isAuthenticated, userDetails, updateProfile, loading: contextLoading } = useUser();

  const backgroundColor = useThemeColor({}, 'background');
  const textColor = useThemeColor({}, 'text');
  const inputBg = useThemeColor({ light: '#f2f2f7', dark: 'rgba(255,255,255,0.07)' }, 'background');
  const placeholderColor = colorScheme === 'dark' ? 'rgba(255,255,255,0.4)' : '#8e8e93';
  const subtitleColor = colorScheme === 'dark' ? 'rgba(255,255,255,0.5)' : '#666';
  const labelColor = colorScheme === 'dark' ? 'rgba(255,255,255,0.6)' : '#444';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  const [isProfilePending, setIsProfilePending] = useState(false);
  const [profileStep, setProfileStep] = useState(1);
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [blockLot, setBlockLot] = useState(''); 
  const [address, setAddress] = useState('');
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  const [firstNameError, setFirstNameError] = useState('');
  const [lastNameError, setLastNameError] = useState('');
  const [blockLotError, setBlockLotError] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isStepValid, setIsStepValid] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const webViewRef = useRef<WebView>(null);

  useEffect(() => {
    if (isAuthenticated && !contextLoading) {
      if (userDetails && userDetails.name && userDetails.block_lot) {
        console.log('[Login] Profile complete, navigating to tabs');
        router.replace('/(tabs)');
      } else {
        console.log('[Login] Profile incomplete, showing setup form');
        setIsProfilePending(true);
      }
    }
  }, [isAuthenticated, userDetails, contextLoading]);

  const validateFirstName = (text: string) => {
    const cleaned = text.replace(/[0-9]/g, '');
    setFirstName(cleaned);
    if (cleaned.trim().length < 2) setFirstNameError('At least 2 characters');
    else setFirstNameError('');
  };

  const validateLastName = (text: string) => {
    const cleaned = text.replace(/[0-9]/g, '');
    setLastName(cleaned);
    if (cleaned.trim().length < 2) setLastNameError('At least 2 characters');
    else setLastNameError('');
  };

  const validateBlockLot = (text: string) => {
    setBlockLot(text);
    if (text.trim().length === 0) setBlockLotError('Required');
    else setBlockLotError('');
  };

  useEffect(() => {
    const validate = () => {
      if (!isProfilePending) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Email error';
        if (password.length < 1) return 'Pass error';
      } else {
        if (profileStep === 1) {
          if (!firstName.trim() || firstName.trim().length < 2 || firstNameError) return 'FN error';
          if (!lastName.trim() || lastName.trim().length < 2 || lastNameError) return 'LN error';
          if (!blockLot.trim() || blockLotError) return 'BL error';
        } else if (profileStep === 2) {
          if (!location) return 'Loc error';
        }
      }
      return '';
    };
    setIsStepValid(validate() === '');
  }, [email, password, firstName, lastName, blockLot, location, isProfilePending, profileStep, firstNameError, lastNameError, blockLotError]);

  const triggerShake = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 70, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 70, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 70, useNativeDriver: true }),
    ]).start();
  };

  const handlePasswordLogin = async () => {
    if (!isStepValid) return triggerShake();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) throw error;
    } catch (err: any) { setError('Invalid email or password'); triggerShake(); }
    finally { setLoading(false); }
  };

  const handleSocialLogin = async () => {
    console.log('[Login] Starting Google OAuth...');
    setLoading(true);
    setError('');
    try {
      const redirectUrl = AuthSession.makeRedirectUri({ path: 'login' });
      console.log('[Login] Redirect URL:', redirectUrl);

      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
        },
      });
      if (oauthError) throw oauthError;

      console.log('[Login] Opening WebBrowser...');
      const res = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
      console.log('[Login] WebBrowser closed with type:', res.type);

      if (res.type === 'success' && res.url) {
        console.log('[Login] Parsing tokens from return URL...');
        const params: Record<string, string> = {};
        const regex = /[?&#]([^=#]+)=([^&#]*)/g;
        let match;
        while ((match = regex.exec(res.url)) !== null) {
          params[match[1]] = decodeURIComponent(match[2]);
        }
        
        const accessToken = params.access_token;
        const refreshToken = params.refresh_token;

        if (accessToken) {
          console.log('[Login] Setting session from browser return...');
          await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || '',
          });
        }
      } else {
        console.log('[Login] Browser closed without URL return.');
      }
    } catch (err: any) {
      console.error('[Login] Google Auth Error:', err);
      setError(err.message || 'Google login failed');
      triggerShake();
    } finally {
      console.log('[Login] handleSocialLogin finished');
      setLoading(false);
    }
  };

  const handleCompleteProfile = async () => {
    if (profileStep === 1) { 
      if (firstNameError || lastNameError || blockLotError) return triggerShake();
      setProfileStep(2); 
      return; 
    }
    if (!location) return Alert.alert('Location Required', 'Select your house location.');
    setLoading(true);
    try {
      const fullName = `${lastName.trim()}, ${firstName.trim()}${middleName ? ' ' + middleName.trim() : ''}`;
      const { error: updateErr } = await updateProfile({ name: fullName, block_lot: blockLot.trim(), latitude: location.latitude, longitude: location.longitude, address: address.trim() });
      if (updateErr) throw updateErr;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)');
    } catch (err: any) { setError('Failed to save profile'); triggerShake(); }
    finally { setLoading(false); }
  };

  const mapHtml = useMemo(() => {
    const initialLat = location?.latitude || 14.5995;
    const initialLng = location?.longitude || 120.9842;
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>body { margin: 0; padding: 0; background: #eee; } #map { height: 100vh; width: 100vw; } .leaflet-control-attribution { display: none; }</style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var map = L.map('map', { zoomControl: false }).setView([${initialLat}, ${initialLng}], 16);
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
          var marker = L.marker([${initialLat}, ${initialLng}], { draggable: true }).addTo(map);
          function updatePos(lat, lng) { window.ReactNativeWebView.postMessage(JSON.stringify({ latitude: lat, longitude: lng })); }
          map.on('click', function(e) { marker.setLatLng(e.latlng); updatePos(e.latlng.lat, e.latlng.lng); });
          marker.on('dragend', function(e) { updatePos(e.target.getLatLng().lat, e.target.getLatLng().lng); });
          window.addEventListener('message', function(event) {
            try {
              var data = JSON.parse(event.data);
              if (data.type === 'FLY_TO') { marker.setLatLng([data.lat, data.lng]); map.flyTo([data.lat, data.lng], 18); }
            } catch(e) {}
          });
        </script>
      </body>
      </html>
    `;
  }, [profileStep === 2]);

  const onMapMessage = (event: any) => {
    try {
      const coords = JSON.parse(event.nativeEvent.data);
      setLocation(coords);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // Automatic Address Update on Pin
      Location.reverseGeocodeAsync(coords).then(([rev]: any) => {
        if (rev) {
          const parts = [
            rev.name, 
            rev.streetNumber, 
            rev.street, 
            rev.district, 
            rev.city, 
            rev.region
          ];
          const newAddr = parts.filter(Boolean).join(', ');
          if (newAddr) setAddress(newAddr);
        }
      });
    } catch (e) {}
  };

  const getCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return Alert.alert('Permission Denied', 'GPS required.');
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setLocation(coords);
      webViewRef.current?.postMessage(JSON.stringify({ type: 'FLY_TO', lat: coords.latitude, lng: coords.longitude }));
      const [rev] = await Location.reverseGeocodeAsync(coords);
      if (rev) {
        const parts = [rev.name, rev.streetNumber, rev.street, rev.subregion, rev.district, rev.city, rev.region];
        setAddress(parts.filter(Boolean).join(', '));
      }
    } catch (err) {}
  };

  const sharedProps = { inputBg, textColor, colorScheme, placeholderColor, labelColor };

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.brandRow}>
          <Image source={require('@/assets/images/h-fire_logo.png')} style={styles.logoImage} resizeMode="contain" />
          <Text style={[styles.brandTitle, { color: textColor }]}>H-FIRE</Text>
          <Text style={styles.brandSub}>RESIDENT MONITOR</Text>
        </View>

        <Text style={[styles.subtitle, { color: subtitleColor }]}>
          {!isProfilePending ? 'Sign in to access your dashboard' : `Complete your profile - Step ${profileStep} of 2`}
        </Text>

        <Animated.View style={[styles.form, { transform: [{ translateX: shakeAnim }] }]}>
          {!isProfilePending ? (
            <>
              <InputField label="Email Address" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" {...sharedProps} />
              <View style={{ position: 'relative' }}>
                <InputField label="Password" value={password} onChangeText={setPassword} secureTextEntry {...sharedProps} />
                <TouchableOpacity onPress={() => router.push('/forgot-password')} style={styles.forgotPasswordSmall}>
                  <Text style={[styles.linkSmallText, { color: ACCENT }]}>Forgot Password?</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : profileStep === 1 ? (
            <View style={{ gap: 15 }}>
              <InputField label="First Name" value={firstName} onChangeText={validateFirstName} error={firstNameError} {...sharedProps} />
              <InputField label="Middle Name or Initial" value={middleName} onChangeText={setMiddleName} {...sharedProps} />
              <InputField label="Last Name" value={lastName} onChangeText={validateLastName} error={lastNameError} {...sharedProps} />
              <InputField label="Block and Lot" value={blockLot} onChangeText={validateBlockLot} error={blockLotError} placeholder="e.g. Block 1 Lot 2" {...sharedProps} />
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <TouchableOpacity onPress={() => setProfileStep(1)} disabled={loading} style={styles.backBtn}>
                <Text style={{ color: ACCENT, fontWeight: '800' }}>← Back to Step 1</Text>
              </TouchableOpacity>
              <InputField label="Detailed Household Address" value={address} onChangeText={setAddress} multiline {...sharedProps} />
              <View style={styles.mapContainer}>
                <WebView ref={webViewRef} originWhitelist={['*']} source={{ html: mapHtml }} onMessage={onMapMessage} style={styles.map} scrollEnabled={false} />
                <TouchableOpacity style={styles.location_btn} onPress={getCurrentLocation}>
                  <FontAwesome name="location-arrow" size={14} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '800', marginLeft: 6 }}>Find Me</Text>
                </TouchableOpacity>
              </View>
              <Text style={{ fontSize: 11, color: subtitleColor, textAlign: 'center', marginTop: 5 }}>Tap map or drag pin to your exact house.</Text>
            </View>
          )}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity style={[styles.authBtn, !isStepValid && { opacity: 0.6 }]} onPress={() => { if (isProfilePending) handleCompleteProfile(); else handlePasswordLogin(); }} disabled={loading}>
            {loading && !isProfilePending ? <ActivityIndicator color="#fff" /> : <Text style={styles.authBtnText}>{isProfilePending ? (profileStep === 1 ? 'CONTINUE' : 'FINISH SETUP') : 'SIGN IN'}</Text>}
          </TouchableOpacity>

          {!isProfilePending && (
            <>
              <View style={styles.orRow}>
                <View style={styles.orLine} />
                <Text style={[styles.orText, { color: subtitleColor }]}>OR</Text>
                <View style={styles.orLine} />
              </View>

              <TouchableOpacity style={styles.socialBtn} onPress={handleSocialLogin} disabled={loading}>
                {loading ? <ActivityIndicator color={textColor} /> : (
                  <>
                    <FontAwesome name="google" size={20} color={textColor} />
                    <Text style={[styles.socialText, { color: textColor }]}>Continue with Google</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.signupToggle} onPress={() => router.push('/signup')}>
                <Text style={[styles.toggleBtnText, { color: subtitleColor }]}>
                  Don't have an account? <Text style={{ color: ACCENT, fontWeight: '800' }}>Sign Up</Text>
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.privacyPolicyBtn} onPress={() => setShowPrivacyModal(true)}>
                <Text style={[styles.privacyPolicyText, { color: subtitleColor }]}>Privacy Policy</Text>
              </TouchableOpacity>
            </>
          )}
        </Animated.View>
      </ScrollView>

      <Modal visible={showPrivacyModal} animationType="slide" transparent={false}>
        <View style={{ flex: 1, backgroundColor }}>
          <View style={{ padding: 20, paddingTop: 60, paddingBottom: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(128,128,128,0.1)' }}>
            <Text style={{ fontSize: 18, fontWeight: '900', color: textColor }}>Privacy Policy</Text>
            <TouchableOpacity onPress={() => setShowPrivacyModal(false)} style={{ padding: 5 }}>
              <FontAwesome name="close" size={24} color={textColor} />
            </TouchableOpacity>
          </View>
          <WebView 
            source={{ uri: 'https://docs.google.com/document/d/e/2PACX-1vRsHZcfblnrZVzQf07-l1YuJ4XIU5tV1tS2m9zi3-M0EP-U3DU8KNi-iKw2YB63tQ9q3eGKxMrb7fnt/pub?embedded=true' }}
            style={{ flex: 1 }}
            startInLoadingState
            renderLoading={() => <ActivityIndicator size="large" color={ACCENT} style={{ position: 'absolute', top: '50%', left: '50%', marginLeft: -20, marginTop: -20 }} />}
          />
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 25 },
  brandRow: { alignItems: 'center', marginBottom: 20 },
  logoImage: { width: 100, height: 100 },
  brandTitle: { fontSize: 32, fontWeight: '900', letterSpacing: 8 },
  brandSub: { color: ACCENT, fontSize: 12, fontWeight: '900', letterSpacing: 4 },
  subtitle: { fontSize: 14, textAlign: 'center', marginBottom: 30, lineHeight: 20 },
  form: { gap: 15 },
  inputContainer: { gap: 6 },
  label: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderRadius: 16, padding: 18, fontSize: 16, borderWidth: 1 },
  authBtn: { backgroundColor: ACCENT, borderRadius: 18, padding: 20, alignItems: 'center', marginTop: 10 },
  authBtnText: { color: '#fff', fontSize: 15, fontWeight: '900', letterSpacing: 1 },
  orRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 10, paddingHorizontal: 10 },
  orLine: { flex: 1, height: 1, backgroundColor: 'rgba(128,128,128,0.1)' },
  orText: { marginHorizontal: 15, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  socialBtn: { flexDirection: 'row', borderRadius: 18, padding: 18, alignItems: 'center', justifyContent: 'center', gap: 12, borderWidth: 1, borderColor: 'rgba(128,128,128,0.2)' },
  socialText: { fontSize: 14, fontWeight: '700' },
  linksRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 10 },
  linkText: { fontSize: 13, fontWeight: '600' },
  signupToggle: { marginTop: 20, alignItems: 'center' },
  toggleBtnText: { fontSize: 14, fontWeight: '600' },
  errorText: { color: '#FF3B30', textAlign: 'center', fontWeight: '700' },
  inlineError: { color: '#FF3B30', fontSize: 10, fontWeight: '700', marginLeft: 5 },
  mapContainer: { height: 350, borderRadius: 24, overflow: 'hidden', backgroundColor: '#eee', borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
  map: { flex: 1 },
  location_btn: { position: 'absolute', bottom: 15, right: 15, backgroundColor: ACCENT, paddingHorizontal: 15, paddingVertical: 10, borderRadius: 15, flexDirection: 'row', alignItems: 'center', elevation: 5 },
  backBtn: { marginBottom: 15, paddingVertical: 5 },
  privacyPolicyBtn: { marginTop: 15, alignItems: 'center', padding: 10 },
  privacyPolicyText: { fontSize: 12, fontWeight: '600', textDecorationLine: 'underline' },
  forgotPasswordSmall: { alignSelf: 'flex-end', marginTop: -5, paddingVertical: 5 },
  linkSmallText: { fontSize: 13, fontWeight: '700' }
});