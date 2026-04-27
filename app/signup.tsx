import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Animated,
  Alert,
  ScrollView,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useUser } from '@/context/UserContext';
import { useSignUp } from '@clerk/clerk-expo';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { WebView } from 'react-native-webview';
import { FontAwesome } from '@expo/vector-icons';

const { width } = Dimensions.get('window');
const ACCENT = '#2196F3';

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

export default function SignupScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const { updateProfile } = useUser();
  const { isLoaded, signUp, setActive } = useSignUp();

  const backgroundColor = useThemeColor({}, 'background');
  const textColor = useThemeColor({}, 'text');
  const inputBg = useThemeColor({ light: '#f2f2f7', dark: 'rgba(255,255,255,0.07)' }, 'background');
  const placeholderColor = colorScheme === 'dark' ? 'rgba(255,255,255,0.4)' : '#a1a1aa';
  const subtitleColor = colorScheme === 'dark' ? 'rgba(255,255,255,0.5)' : '#666';
  const labelColor = colorScheme === 'dark' ? 'rgba(255,255,255,0.6)' : '#444';

  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  
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

  // Password Requirements State
  const hasMinLength = password.length >= 8;
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>_]/.test(password);

  useEffect(() => {
    const validate = () => {
      if (step === 1) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) return 'Invalid email';
        if (!hasMinLength) return 'Min 8 chars';
        if (!hasSpecialChar) return 'Needs special char';
      } else if (step === 2) {
        if (!code || code.length < 6) return 'Code too short';
      } else if (step === 3) {
        if (!firstName.trim() || firstName.trim().length < 2) return 'FN error';
        if (!lastName.trim() || lastName.trim().length < 2) return 'LN error';
        if (!blockLot.trim()) return 'BL error';
      } else if (step === 4) {
        if (!location) return 'Loc error';
      }
      return '';
    };

    const validationError = validate();
    setIsStepValid(validationError === '');
    if (error && validationError === '') setError('');
  }, [email, password, code, firstName, lastName, blockLot, location, step]);

  const triggerShake = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 70, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 70, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 70, useNativeDriver: true }),
    ]).start();
  };

  const handleSignup = async () => {
    if (!isLoaded || !isStepValid) { triggerShake(); return; }
    setLoading(true);
    setError('');
    try {
      await signUp.create({ emailAddress: email.trim().toLowerCase(), password });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Verify Account', 'A code has been sent to your email.');
      setStep(2);
    } catch (err: any) { setError(err.errors?.[0]?.message || 'Signup failed'); triggerShake(); }
    finally { setLoading(false); }
  };

  const handleVerifyEmail = async () => {
    if (!isLoaded || !isStepValid) { triggerShake(); return; }
    setLoading(true);
    setError('');
    try {
      const completeSignUp = await signUp.attemptEmailAddressVerification({ code });
      if (completeSignUp.status === 'complete') {
        await setActive({ session: completeSignUp.createdSessionId });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setStep(3);
      } else { setError('Verification failed.'); }
    } catch (err: any) { setError(err.errors?.[0]?.message || 'Invalid code'); triggerShake(); }
    finally { setLoading(false); }
  };

  const handleCompleteProfile = async () => {
    if (step === 3) {
      if (isStepValid) setStep(4);
      else triggerShake();
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
  }, [step === 4]);

  const onMapMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      const coords = { latitude: data.latitude, longitude: data.longitude };
      setLocation(coords);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      
      const result = await Location.reverseGeocodeAsync(coords);
      if (result && result.length > 0) {
        const rev = result[0];
        const parts = [rev.name, rev.streetNumber, rev.street, rev.district, rev.city, rev.subregion, rev.region, rev.postalCode];
        const cleanAddr = parts.filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
        if (cleanAddr) setAddress(cleanAddr);
      }
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
      
      const result = await Location.reverseGeocodeAsync(coords);
      if (result && result.length > 0) {
        const rev = result[0];
        const parts = [rev.name, rev.streetNumber, rev.street, rev.district, rev.city, rev.subregion, rev.region, rev.postalCode];
        const cleanAddr = parts.filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
        if (cleanAddr) setAddress(cleanAddr);
      }
    } catch (err) {}
  };

  const sharedProps = { inputBg, textColor, colorScheme, placeholderColor, labelColor };

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <View style={[styles.bgTop, { backgroundColor: colorScheme === 'dark' ? 'rgba(33, 150, 243, 0.08)' : 'rgba(33, 150, 243, 0.05)' }]} />
      <View style={[styles.bgBottom, { backgroundColor: colorScheme === 'dark' ? 'rgba(33, 150, 243, 0.04)' : 'rgba(33, 150, 243, 0.02)' }]} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.brandRow}>
          <Image source={require('@/assets/images/h-fire_logo.png')} style={styles.logoImage} resizeMode="contain" />
          <Text style={[styles.brandTitle, { color: textColor }]}>H-FIRE</Text>
          <Text style={styles.brandSub}>CREATE ACCOUNT</Text>
        </View>

        <Text style={[styles.subtitle, { color: subtitleColor }]}>
          {step === 1 && 'Step 1: Account Credentials'}
          {step === 2 && 'Step 2: Verify Email'}
          {step === 3 && 'Step 3: Personal Information'}
          {step === 4 && 'Step 4: Household Location'}
        </Text>

        <Animated.View style={[styles.form, { transform: [{ translateX: shakeAnim }] }]}>
          {step === 1 && (
            <>
              <InputField label="Email Address" placeholder="example@email.com" keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} {...sharedProps} />
              <View>
                <InputField label="Password" placeholder="Strong Password" secureTextEntry value={password} onChangeText={setPassword} {...sharedProps} />
                <View style={styles.reqRow}>
                  <View style={styles.reqItem}><IconSymbol name={hasMinLength ? "checkmark.circle.fill" : "circle"} size={14} color={hasMinLength ? "#34C759" : subtitleColor} /><Text style={[styles.reqText, { color: hasMinLength ? textColor : subtitleColor }]}>Min. 8 characters</Text></View>
                  <View style={styles.reqItem}><IconSymbol name={hasSpecialChar ? "checkmark.circle.fill" : "circle"} size={14} color={hasSpecialChar ? "#34C759" : subtitleColor} /><Text style={[styles.reqText, { color: hasSpecialChar ? textColor : subtitleColor }]}>Includes special character</Text></View>
                </View>
              </View>
            </>
          )}

          {step === 2 && (
            <View>
              <Text style={styles.verifyInfo}>Sent to: {email}</Text>
              <InputField label="Verification Code" placeholder="000000" keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} autoFocus {...sharedProps} />
            </View>
          )}

          {step === 3 && (
            <View style={{ gap: 15 }}>
              <InputField label="First Name" placeholder="John" value={firstName} onChangeText={setFirstName} {...sharedProps} />
              <InputField label="Middle Name or Initial" placeholder="Middle Name or Initial" value={middleName} onChangeText={setMiddleName} {...sharedProps} />
              <InputField label="Last Name" placeholder="Doe" value={lastName} onChangeText={setLastName} {...sharedProps} />
              <InputField label="Block and Lot Number" placeholder="Block 1 Lot 1" value={blockLot} onChangeText={setBlockLot} {...sharedProps} />
            </View>
          )}

          {step === 4 && (
            <View style={{ gap: 10 }}>
              <InputField label="Detailed Household Address" placeholder="House No., Street name, etc." value={address} onChangeText={setAddress} multiline {...sharedProps} />
              <View style={styles.mapContainer}>
                <WebView ref={webViewRef} originWhitelist={['*']} source={{ html: mapHtml }} onMessage={onMapMessage} style={styles.map} scrollEnabled={false} />
                <TouchableOpacity style={styles.locationBtn} onPress={getCurrentLocation}>
                  <FontAwesome name="location-arrow" size={14} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '800', marginLeft: 6 }}>Find Me</Text>
                </TouchableOpacity>
              </View>
              <Text style={{ fontSize: 11, color: subtitleColor, textAlign: 'center', marginTop: 5 }}>Tap map or drag pin to your exact house.</Text>
            </View>
          )}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={{ gap: 15, marginTop: 10 }}>
            <TouchableOpacity style={[styles.authBtn, !isStepValid && { opacity: 0.6 }]} onPress={() => { if (step === 1) handleSignup(); else if (step === 2) handleVerifyEmail(); else handleCompleteProfile(); }} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.authBtnText}>{step === 1 ? 'CREATE ACCOUNT' : step === 2 ? 'VERIFY CODE' : step === 3 ? 'CONTINUE' : 'FINISH SETUP'}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.backToLoginBtn} onPress={() => router.replace('/login')}><IconSymbol name="arrow.left" size={16} color={subtitleColor} /><Text style={[styles.backToLoginText, { color: subtitleColor }]}>Back to Sign In</Text></TouchableOpacity>
          </View>
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
  brandTitle: { fontSize: 28, fontWeight: '900', letterSpacing: 4, textAlign: 'center' },
  brandSub: { color: ACCENT, fontSize: 12, fontWeight: '900', letterSpacing: 4, marginTop: 4 },
  subtitle: { fontSize: 14, textAlign: 'center', marginBottom: 30, lineHeight: 22, maxWidth: width * 0.8 },
  form: { width: '100%', gap: 15 },
  inputContainer: { gap: 6 },
  label: { fontSize: 11, fontWeight: '800', marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderRadius: 16, padding: 18, fontSize: 16, borderWidth: 1 },
  inlineError: { color: '#FF3B30', fontSize: 10, fontWeight: '700', marginLeft: 5 },
  reqRow: { marginTop: 10, gap: 5, marginLeft: 5 },
  reqItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reqText: { fontSize: 11, fontWeight: '700' },
  verifyInfo: { color: ACCENT, fontSize: 12, textAlign: 'center', marginBottom: 10, fontWeight: '700' },
  authBtn: { backgroundColor: ACCENT, borderRadius: 18, padding: 20, alignItems: 'center', elevation: 5 },
  authBtnText: { color: '#fff', fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  errorText: { color: '#FF3B30', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  mapContainer: { height: 350, borderRadius: 24, overflow: 'hidden', backgroundColor: '#eee', borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
  map: { flex: 1 },
  locationBtn: { position: 'absolute', bottom: 15, right: 15, backgroundColor: ACCENT, paddingHorizontal: 15, paddingVertical: 10, borderRadius: 15, flexDirection: 'row', alignItems: 'center', elevation: 5 },
  backToLoginBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 10, gap: 8, marginTop: 5 },
  backToLoginText: { fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
});