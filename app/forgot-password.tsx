import React, { useState, useRef, useEffect } from 'react';
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
import { useSignIn } from '@clerk/clerk-expo';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useColorScheme } from '@/hooks/use-color-scheme';

const { width } = Dimensions.get('window');
const ACCENT = '#2196F3';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const { isLoaded, signIn, setActive } = useSignIn();

  const backgroundColor = useThemeColor({}, 'background');
  const textColor = useThemeColor({}, 'text');
  const inputBg = useThemeColor({ light: '#f2f2f7', dark: 'rgba(255,255,255,0.07)' }, 'background');
  const placeholderColor = colorScheme === 'dark' ? 'rgba(255,255,255,0.4)' : '#a1a1aa';
  const subtitleColor = colorScheme === 'dark' ? 'rgba(255,255,255,0.5)' : '#666';

  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isStepValid, setIsStepValid] = useState(false);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // Real-time Validation Effect
  useEffect(() => {
    const validate = () => {
      if (step === 1) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) return 'Invalid email';
      } else {
        if (!code || code.length < 6) return 'Code too short';
        if (!password || password.length < 8) return 'Password too short';
      }
      return '';
    };

    const validationError = validate();
    setIsStepValid(validationError === '');
    if (error && validationError === '') setError('');
  }, [email, code, password, step]);

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

  const handleSendCode = async () => {
    if (!isLoaded) return;
    if (!isStepValid) {
      setError('Please enter a valid email address');
      triggerShake();
      return;
    }
    setLoading(true);
    setError('');
    try {
      await signIn.create({
        strategy: "reset_password_email_code",
        identifier: email.trim().toLowerCase(),
      });
      setStep(2);
      Alert.alert('Code Sent', 'Check your inbox for the reset code.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      setError(err.errors?.[0]?.message || 'Failed to request reset');
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!isLoaded) return;
    if (!isStepValid) {
      if (code.length < 6) setError('Please enter the 6-digit code');
      else if (password.length < 8) setError('Password must be at least 8 characters');
      triggerShake();
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code,
        password,
      });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Success', 'Password updated! You are now signed in.', [
          { text: 'OK', onPress: () => router.replace('/(tabs)') }
        ]);
      } else {
        setError('Failed to reset password.');
      }
    } catch (err: any) {
      setError(err.errors?.[0]?.message || 'Invalid or expired code');
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

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
          <Text style={styles.brandSub}>RESET PASSWORD</Text>
        </View>

        <Text style={[styles.subtitle, { color: subtitleColor }]}>
          {step === 1 ? 'Enter your email to receive a password reset code.' : 'Enter the code and your new password.'}
        </Text>

        <Animated.View style={[styles.form, { transform: [{ translateX: shakeAnim }] }]}>
          {step === 1 ? (
            <TextInput
              style={[styles.input, { backgroundColor: inputBg, color: textColor, borderColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}
              placeholder="Email Address"
              placeholderTextColor={placeholderColor}
              keyboardType="email-address"
              autoCapitalize="none"
              maxLength={100}
              value={email}
              onChangeText={setEmail}
            />
          ) : (
            <>
              <Text style={styles.verifyInfo}>Resetting for: {email}</Text>
              <TextInput 
                style={[styles.input, styles.otpInput, { backgroundColor: inputBg, color: textColor, borderColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]} 
                placeholder="000000" 
                placeholderTextColor={placeholderColor} 
                keyboardType="number-pad" 
                maxLength={6} 
                value={code} 
                onChangeText={setCode} 
                autoFocus 
              />
              <TextInput
                style={[styles.input, { marginTop: 10, backgroundColor: inputBg, color: textColor, borderColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}
                placeholder="New Password (Min 8 chars)"
                placeholderTextColor={placeholderColor}
                secureTextEntry
                maxLength={100}
                value={password}
                onChangeText={setPassword}
              />
            </>
          )}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={{ gap: 15, marginTop: 10 }}>
            <TouchableOpacity 
              style={[styles.authBtn, !isStepValid && { opacity: 0.6 }]} 
              onPress={step === 1 ? handleSendCode : handleResetPassword}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : (
                <Text style={styles.authBtnText}>
                  {step === 1 ? 'SEND RESET CODE' : 'UPDATE PASSWORD'}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.backToLoginBtn} 
              onPress={() => router.replace('/login')}
            >
              <IconSymbol name="arrow.left" size={16} color={subtitleColor} />
              <Text style={[styles.backToLoginText, { color: subtitleColor }]}>Back to Sign In</Text>
            </TouchableOpacity>
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
  input: { borderRadius: 16, padding: 18, fontSize: 16, borderWidth: 1 },
  otpInput: { fontSize: 32, textAlign: 'center', letterSpacing: 10, fontWeight: '900' },
  verifyInfo: { color: ACCENT, fontSize: 12, textAlign: 'center', marginBottom: 10, fontWeight: '700' },
  authBtn: { backgroundColor: ACCENT, borderRadius: 16, padding: 20, alignItems: 'center', shadowColor: ACCENT, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 },
  authBtnText: { color: '#fff', fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  errorText: { color: '#FF3B30', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  backToLoginBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 10, gap: 8, marginTop: 5 },
  backToLoginText: { fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
});
