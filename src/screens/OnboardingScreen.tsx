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
import { formatAuthErrorAlert } from '../utils/firebaseError';

export default function OnboardingScreen() {
  const { signInWithApple, signInWithEmail, signUpWithEmail } = useAuth();
  const [showEmail, setShowEmail] = useState(false);
  // デフォルトは 'signup'。理由:
  //   新規ユーザーが「メールアドレスでログイン / 新規登録」ボタンを押した直後
  //   にデフォルトが 'login' だと、何も知らずにメール+パスワードを入れて
  //   submit → signInWithEmailAndPassword (signUp ではない) → auth/user-not-found
  //   で失敗する。新規ユーザーはタブの切替に気付かず「登録できない」と判断する。
  //   既存ユーザーは sign-out した稀ケースのみこの画面に来るため、その時だけ
  //   「ログイン」タブに自分で切り替えてもらう方が全体のフリクションが少ない。
  const [emailMode, setEmailMode] = useState<'login' | 'signup'>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const handleApple = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const user = await signInWithApple();
      if (!user) {
        // キャンセル: spinner を戻す
        setBusy(false);
        return;
      }
      // 成功: busy=true のまま維持。Root 側の auth state 変化で画面遷移するため
      // この画面は unmount される。ここで setBusy(false) すると
      // 「Appleでログイン」ラベルが一瞬戻ってチラつく原因になる。
    } catch (e: any) {
      setBusy(false);
      Alert.alert('ログイン失敗', formatAuthErrorAlert(e));
    }
  };

  const handleEmail = async () => {
    if (busy) return;
    if (!email.trim() || password.length < 6) {
      Alert.alert('入力エラー', 'メールアドレスと6文字以上のパスワードを入力してください');
      return;
    }
    if (emailMode === 'signup' && !name.trim()) {
      Alert.alert('入力エラー', 'なまえ(表示名)を入力してください');
      return;
    }
    setBusy(true);
    try {
      if (emailMode === 'signup') {
        await signUpWithEmail(email.trim(), password, name.trim());
      } else {
        await signInWithEmail(email.trim(), password);
      }
    } catch (e: any) {
      Alert.alert(
        emailMode === 'signup' ? '登録失敗' : 'ログイン失敗',
        formatAuthErrorAlert(e),
      );
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
            今日は、こんな気分。
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

            {Platform.OS === 'ios' && !showEmail && (
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>または</Text>
                <View style={styles.dividerLine} />
              </View>
            )}

            {!showEmail ? (
              <Pressable
                onPress={() => setShowEmail(true)}
                style={({ pressed }) => [
                  styles.emailBtn,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.emailText}>メールアドレスでログイン / 新規登録</Text>
              </Pressable>
            ) : (
              <View style={styles.emailForm}>
                <View style={styles.modeToggle}>
                  <Pressable
                    onPress={() => setEmailMode('login')}
                    style={[
                      styles.modeTab,
                      emailMode === 'login' && styles.modeTabActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.modeTabText,
                        emailMode === 'login' && styles.modeTabTextActive,
                      ]}
                    >
                      ログイン
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setEmailMode('signup')}
                    style={[
                      styles.modeTab,
                      emailMode === 'signup' && styles.modeTabActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.modeTabText,
                        emailMode === 'signup' && styles.modeTabTextActive,
                      ]}
                    >
                      新規登録
                    </Text>
                  </Pressable>
                </View>
                {emailMode === 'signup' && (
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="なまえ (表示名)"
                    placeholderTextColor={colors.textLight}
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={20}
                    style={styles.input}
                  />
                )}
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
                    <Text style={styles.submitText}>
                      {emailMode === 'signup' ? '新規登録' : 'ログイン'}
                    </Text>
                  )}
                </Pressable>
              </View>
            )}
          </View>

          <View style={styles.footer}>
            <Pressable
              onPress={() => Linking.openURL('https://gokuyou-official.github.io/kibunya/terms.html')}
            >
              <Text style={styles.footerLink}>利用規約</Text>
            </Pressable>
            <Text style={styles.footerSep}>・</Text>
            <Pressable
              onPress={() => Linking.openURL('https://gokuyou-official.github.io/kibunya/privacy-policy.html')}
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
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.cardBorder,
  },
  dividerText: {
    fontSize: 12,
    color: colors.textLight,
    fontWeight: '500',
  },
  emailForm: {
    gap: 10,
  },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 12,
    padding: 4,
    marginBottom: 4,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeTabActive: {
    backgroundColor: colors.shu,
  },
  modeTabText: {
    color: colors.textLight,
    fontSize: 14,
    fontWeight: '600',
  },
  modeTabTextActive: {
    color: colors.cream,
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
