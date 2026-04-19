// オンボーディング / ログイン画面(v2: 藍ベースのダーク基調)
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Alert,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../config/colors';
import { useAuth } from '../hooks/useAuth';

export default function OnboardingScreen() {
  const { signInWithApple, signInWithEmail } = useAuth();
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const handleApple = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await signInWithApple();
    } catch (e: any) {
      Alert.alert('ログイン失敗', e?.message ?? 'もう一度お試しください');
    } finally {
      setBusy(false);
    }
  };

  const handleEmail = async () => {
    if (busy) return;
    if (!email.trim() || password.length < 6) {
      Alert.alert('入力エラー', 'メールアドレスと6文字以上のパスワードを入力してください');
      return;
    }
    setBusy(true);
    try {
      await signInWithEmail(email.trim(), password);
    } catch (e: any) {
      Alert.alert('ログイン失敗', e?.message ?? 'もう一度お試しください');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.hero}>
            <Text style={styles.heroEmoji}>🍺</Text>
          </View>

          <Text style={styles.kicker}>KIBUNYA</Text>
          <Text style={styles.headline}>
            気分だけ、置いておく。
          </Text>
          <Text style={styles.sub}>
            誘ってないから大丈夫。{'\n'}同じ気分の友達が来たら、乾杯。
          </Text>

          <View style={styles.actions}>
            {Platform.OS === 'ios' && (
              <Pressable
                onPress={handleApple}
                disabled={busy}
                style={({ pressed }) => [
                  styles.appleBtn,
                  pressed && { opacity: 0.85 },
                ]}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.appleText}> Appleでログイン</Text>
                )}
              </Pressable>
            )}

            {!showEmail ? (
              <Pressable
                onPress={() => setShowEmail(true)}
                style={({ pressed }) => [
                  styles.emailBtn,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.emailText}>メールアドレスでログイン</Text>
              </Pressable>
            ) : (
              <View style={styles.emailForm}>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="メールアドレス"
                  placeholderTextColor={colors.textLight}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  style={styles.input}
                />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="パスワード(6文字以上)"
                  placeholderTextColor={colors.textLight}
                  secureTextEntry
                  style={styles.input}
                />
                <Pressable
                  onPress={handleEmail}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.submitBtn,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.cream} />
                  ) : (
                    <Text style={styles.submitText}>はじめる</Text>
                  )}
                </Pressable>
              </View>
            )}
          </View>

          <View style={styles.footer}>
            <Pressable
              onPress={() => Linking.openURL('https://example.com/terms')}
            >
              <Text style={styles.footerLink}>利用規約</Text>
            </Pressable>
            <Text style={styles.footerSep}>・</Text>
            <Pressable
              onPress={() => Linking.openURL('https://example.com/privacy')}
            >
              <Text style={styles.footerLink}>プライバシーポリシー</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.ai,
  },
  container: {
    padding: 24,
    paddingBottom: 40,
    gap: 14,
  },
  hero: {
    height: 220,
    backgroundColor: colors.aiDeep,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  heroEmoji: {
    fontSize: 96,
  },
  kicker: {
    fontSize: 12,
    letterSpacing: 5,
    color: colors.yamabuki,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 4,
  },
  headline: {
    fontSize: 24,
    color: colors.cream,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 34,
    paddingHorizontal: 6,
  },
  sub: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 12,
  },
  actions: {
    gap: 12,
    marginTop: 8,
  },
  appleBtn: {
    backgroundColor: '#000',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appleText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  emailBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.yamabuki,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emailText: {
    color: colors.yamabuki,
    fontSize: 15,
    fontWeight: '600',
  },
  emailForm: {
    gap: 10,
  },
  input: {
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: colors.cream,
  },
  submitBtn: {
    backgroundColor: colors.shu,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: {
    color: colors.cream,
    fontSize: 15,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
  },
  footerLink: {
    fontSize: 12,
    color: colors.textMuted,
    textDecorationLine: 'underline',
  },
  footerSep: {
    color: colors.textLight,
    marginHorizontal: 6,
  },
});
