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
} from 'react-native';
import { WebView } from 'react-native-webview';

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

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isStepValid, setIsStepValid] = useState(false);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const webViewRef = useRef<WebView>(null);

  useEffect(() => {
    if (isAuthenticated && !contextLoading) {
      if (userDetails && userDetails.name && userDetails.block_lot) {
        router.replace('/(tabs)');
      } else {
        setIsProfilePending(true);
      }
    }
  }, [isAuthenticated, userDetails, contextLoading]);

  const validateFirstName = (text: string) => {
    const cleaned = text.replace(/[0-9]/g, '');
    setFirstName(cleaned);
  };

  const validateLastName = (text: string) => {
    const cleaned = text.replace(/[0-9]/g, '');
    setLastName(cleaned);
  };

  useEffect(() => {
    const validate = () => {
      if (!isProfilePending) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) return 'Invalid email';
        if (password.length < 1) return 'Password required';
      } else {
        if (profileStep === 1) {
          if (!firstName.trim() || firstName.trim().length < 2) return 'First Name error';
          if (!lastName.trim() || lastName.trim().length < 2) return 'Last Name error';
          if (!blockLot.trim()) return 'Block & Lot error';
        } else if (profileStep === 2) {
          if (!location) return 'Location required';
        }
      }
      return '';
    };
    setIsStepValid(validate() === '');
  }, [email, password, firstName, lastName, blockLot, location, isProfilePending, profileStep]);

  const triggerShake = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 70, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 70, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 70, useNativeDriver: true }),
    ]).start();
  };

  const handlePasswordLogin = async () => {
    if (!signInLoaded || !isStepValid) { triggerShake(); return; }
    setLoading(true);
    try {
      const result = await signIn.create({ identifier: email.trim().toLowerCase(), password });
      if (result.status === 'complete') await setActive({ session: result.createdSessionId });
      else setError('Login incomplete.');
    } catch (err: any) { setError(err.errors?.[0]?.message || 'Login failed'); triggerShake(); }
    finally { setLoading(false); }
  };

  const handleSocialLogin = async () => {
    setLoading(true);
    try {
      const { createdSessionId, setActive: setOAuthActive } = await startGoogleFlow({ redirectUrl: Linking.createURL('/', { scheme: 'hfire' }) });
      if (createdSessionId && setOAuthActive) await setOAuthActive({ session: createdSessionId });
    } catch (err: any) { setError('Google login failed'); triggerShake(); }
    finally { setLoading(false); }
  };

  const handleCompleteProfile = async () => {
    if (profileStep === 1) { setProfileStep(2); return; }
    if (!location) return Alert.alert('Location Required', 'Please select your house location on the map.');
    setLoading(true);
    try {
      const fullName = `${lastName.trim()}, ${firstName.trim()}${middleName ? ' ' + middleName.trim() : ''}`;
      const { error: updateErr } = await updateProfile({ 
        name: fullName, 
        block_lot: blockLot.trim(), 
        latitude: location.latitude, 
        longitude: location.longitude, 
        address: address.trim() 
      });
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
        <style>
          body { margin: 0; padding: 0; background: #eee; }
          #map { height: 100vh; width: 100vw; }
          .leaflet-control-attribution { display: none; }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var map = L.map('map', { zoomControl: false }).setView([${initialLat}, ${initialLng}], 16);
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
          var marker = L.marker([${initialLat}, ${initialLng}], { draggable: true }).addTo(map);
          
          function updatePos(lat, lng) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ latitude: lat, longitude: lng }));
          }

          map.on('click', function(e) {
            marker.setLatLng(e.latlng);
            updatePos(e.latlng.lat, e.latlng.lng);
          });

          marker.on('dragend', function(e) {
            updatePos(e.target.getLatLng().lat, e.target.getLatLng().lng);
          });

          window.addEventListener('message', function(event) {
            try {
              var data = JSON.parse(event.data);
              if (data.type === 'FLY_TO') {
                marker.setLatLng([data.lat, data.lng]);
                map.flyTo([data.lat, data.lng], 18);
              }
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
      Location.reverseGeocodeAsync(coords).then(([rev]: any) => {
        if (rev) {
          const parts = [rev.name, rev.streetNumber, rev.street, rev.subregion, rev.district, rev.city, rev.region];
          setAddress(parts.filter(Boolean).join(', '));
        }
      });
    } catch (e) {}
  };

  const getCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return Alert.alert('Permission Denied', 'We need location access to find your home.');
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
              <InputField label="Password" value={password} onChangeText={setPassword} secureTextEntry {...sharedProps} />
            </>
          ) : profileStep === 1 ? (
            <View style={{ gap: 15 }}>
              <InputField label="First Name" value={firstName} onChangeText={validateFirstName} {...sharedProps} />
              <InputField label="Middle Name (Optional)" value={middleName} onChangeText={setMiddleName} {...sharedProps} />
              <InputField label="Last Name" value={lastName} onChangeText={validateLastName} {...sharedProps} />
              <InputField label="Block and Lot" value={blockLot} onChangeText={setBlockLot} placeholder="e.g. Block 1 Lot 2" {...sharedProps} />
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <TouchableOpacity onPress={() => setProfileStep(1)} disabled={loading} style={styles.backBtn}>
                <Text style={{ color: ACCENT, fontWeight: '800' }}>← Back to Step 1</Text>
              </TouchableOpacity>
              <InputField label="Detailed Household Address" value={address} onChangeText={setAddress} multiline {...sharedProps} />
              <View style={styles.mapContainer}>
                <WebView 
                  ref={webViewRef} 
                  originWhitelist={['*']} 
                  source={{ html: mapHtml }} 
                  onMessage={onMapMessage} 
                  style={styles.map} 
                  scrollEnabled={false}
                />
                <TouchableOpacity style={styles.locationBtn} onPress={getCurrentLocation}>
                  <FontAwesome name="location-arrow" size={14} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '800', marginLeft: 6 }}>Find Me</Text>
                </TouchableOpacity>
              </View>
              <Text style={{ fontSize: 11, color: subtitleColor, textAlign: 'center', marginTop: 5 }}>
                Tap the map or drag the pin to your exact house.
              </Text>
            </View>
          )}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity style={[styles.authBtn, !isStepValid && { opacity: 0.6 }]} onPress={() => { if (isProfilePending) handleCompleteProfile(); else handlePasswordLogin(); }} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.authBtnText}>{isProfilePending ? (profileStep === 1 ? 'CONTINUE' : 'FINISH SETUP') : 'SIGN IN'}</Text>}
          </TouchableOpacity>

          {!isProfilePending && (
            <TouchableOpacity style={styles.socialBtn} onPress={handleSocialLogin}>
              <FontAwesome name="google" size={20} color={textColor} />
              <Text style={[styles.socialText, { color: textColor }]}>Continue with Google</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </ScrollView>
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
  socialBtn: { flexDirection: 'row', borderRadius: 18, padding: 18, alignItems: 'center', justifyContent: 'center', gap: 12, borderWidth: 1, borderColor: 'rgba(128,128,128,0.2)', marginTop: 10 },
  socialText: { fontSize: 14, fontWeight: '700' },
  errorText: { color: '#FF3B30', textAlign: 'center', fontWeight: '700' },
  mapContainer: { height: 350, borderRadius: 24, overflow: 'hidden', backgroundColor: '#eee', borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
  map: { flex: 1 },
  locationBtn: { position: 'absolute', bottom: 15, right: 15, backgroundColor: ACCENT, paddingHorizontal: 15, paddingVertical: 10, borderRadius: 15, flexDirection: 'row', alignItems: 'center', elevation: 5 },
  backBtn: { marginBottom: 15, paddingVertical: 5 }
});