// なまえ入力画面 (legacy ユーザー救済用)
//
// 名前が空のまま認証だけ通っているユーザー (旧ビルドで登録 / Apple sign-in
// で fullName 取得失敗 等) に対して、Root 側でこの画面に gating する。
// 保存すると useProfile の onSnapshot が走り、Root が再評価して
// 次のステップ (InterestSelection or MainTabs) に進む。
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../config/colors';
import { useAuth } from '../hooks/useAuth';
import { useProfile } from '../hooks/useProfile';

export default function NameInputScreen() {
  const { currentUser } = useAuth();
  const { updateProfile } = useProfile(currentUser?.uid);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('入力エラー', 'なまえを入力してください');
      return;
    }
    setSaving(true);
    try {
      await updateProfile({ name: trimmed });
      // setSaving(false) は意図的にしない:
      // 保存後 onSnapshot で profile.name が更新され、Root の gate が外れて
      // この画面は unmount される。ここで false にするとボタンラベルが
      // 一瞬戻ってチラつく。
    } catch (e: any) {
      setSaving(false);
      Alert.alert('保存できませんでした', e?.message ?? '');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.container}>
          <Text style={styles.emoji}>🐈</Text>
          <Text style={styles.title}>なまえを設定</Text>
          <Text style={styles.sub}>
            友達に表示される名前です。{'\n'}あとからプロフィールタブで変更できます。
          </Text>

          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="ニックネーム"
            placeholderTextColor={colors.textLight}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
            style={styles.input}
          />

          <Pressable
            onPress={handleSave}
            disabled={saving}
            style={({ pressed }) => [
              styles.btn,
              pressed && { opacity: 0.9 },
              saving && { opacity: 0.6 },
            ]}
          >
            {saving ? (
              <ActivityIndicator color={colors.cream} />
            ) : (
              <Text style={styles.btnText}>保存して進む</Text>
            )}
          </Pressable>
        </View>
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
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    gap: 14,
  },
  emoji: {
    fontSize: 56,
    textAlign: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 22,
    color: colors.cream,
    fontWeight: '700',
    textAlign: 'center',
  },
  sub: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  input: {
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.cream,
  },
  btn: {
    backgroundColor: colors.shu,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  btnText: {
    color: colors.cream,
    fontSize: 15,
    fontWeight: '600',
  },
});
