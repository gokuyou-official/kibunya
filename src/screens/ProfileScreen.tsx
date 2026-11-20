// プロフィール画面(v2)
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  Alert,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../config/colors';
import { useAuth } from '../hooks/useAuth';
import { useProfile } from '../hooks/useProfile';
import { ACTIVITIES } from '../config/activities';
import InterestSelectionScreen from './InterestSelectionScreen';
import { deleteAccount, getSignInProvider } from '../utils/accountDeletion';
import { formatAuthErrorAlert } from '../utils/firebaseError';

export default function ProfileScreen() {
  const { currentUser, signOut } = useAuth();
  const { profile, loading, updateProfile } = useProfile(currentUser?.uid);

  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [showInterestModal, setShowInterestModal] = useState(false);

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setName(profile.name);
    setArea(profile.area);
    setBio(profile.bio);
  }, [profile.name, profile.area, profile.bio]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await updateProfile({
        name: name.trim(),
        area: area.trim(),
        bio: bio.trim(),
      });
      Alert.alert('保存しました');
    } catch (e: any) {
      Alert.alert('保存できませんでした', e?.message ?? '');
    } finally {
      setSaving(false);
    }
  };

  // アカウント削除の実行本体。password 方式は事前にモーダルで入力させた
  // パスワードを、Apple / unknown はそのまま渡す (Apple は端末側で
  // Face ID 等の再認証UIが出る)。
  const runDeleteAccount = async (password?: string) => {
    if (!currentUser || deleting) return;
    setDeleting(true);
    try {
      await deleteAccount(currentUser, password);
      // 成功: Firebase Auth ユーザーが消え、onAuthStateChanged 経由で
      // currentUser が null になる。App.tsx の Root がそれを検知して
      // 自動的にログイン/初期画面(OnboardingScreen)へ遷移するため、
      // ここで明示的な画面遷移は不要。deleting は true のままにして
      // unmount までの間、ボタン類を無効化しておく。
    } catch (e: any) {
      setDeleting(false);
      setDeletePassword('');
      const code = e?.code;
      const msg = String(e?.message ?? '').toLowerCase();
      const appleCanceled =
        code === 'ERR_REQUEST_CANCELED' ||
        code === 'ERR_CANCELED' ||
        code === 'ERR_REQUEST_NOT_HANDLED' ||
        msg.includes('cancel');
      if (appleCanceled) return;

      if (code === 'auth/requires-recent-login') {
        Alert.alert(
          '再ログインが必要です',
          'セキュリティ保護のため、一度ログアウトしてから再度ログインし、もう一度「アカウントを削除」をお試しください。',
          [
            { text: 'あとで', style: 'cancel' },
            { text: 'ログアウトする', style: 'destructive', onPress: () => signOut() },
          ],
        );
        return;
      }

      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        Alert.alert('パスワードが正しくありません', 'もう一度お試しください');
        setShowPasswordModal(true);
        return;
      }

      Alert.alert('削除できませんでした', formatAuthErrorAlert(e));
    }
  };

  const handleDeleteAccountPress = () => {
    Alert.alert(
      'アカウントを削除しますか？',
      '削除するとすべてのデータが失われ、復元できません。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除する',
          style: 'destructive',
          onPress: () => {
            const provider = getSignInProvider(currentUser);
            if (provider === 'password') {
              setShowPasswordModal(true);
            } else {
              runDeleteAccount();
            }
          },
        },
      ],
    );
  };

  const interestLabels = profile.interests
    .map((id) => ACTIVITIES.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a))
    .map((a) => `${a.waitEmoji} ${a.label}`)
    .join('・');

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.shu} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.title}>プロフィール</Text>

          <View style={styles.field}>
            <Text style={styles.label}>名前</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="ニックネーム"
              placeholderTextColor={colors.textLight}
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>主な活動エリア</Text>
            <TextInput
              value={area}
              onChangeText={setArea}
              placeholder="例: 渋谷・新宿"
              placeholderTextColor={colors.textLight}
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>一言</Text>
            <TextInput
              value={bio}
              onChangeText={setBio}
              placeholder="最近の気分や好きなもの"
              placeholderTextColor={colors.textLight}
              multiline
              numberOfLines={3}
              style={[styles.input, styles.multiline]}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>気分の種類</Text>
            <View style={styles.interestBox}>
              <Text style={styles.interestText} numberOfLines={2}>
                {interestLabels || '未設定'}
              </Text>
              <Pressable
                onPress={() => setShowInterestModal(true)}
                style={({ pressed }) => [
                  styles.interestBtn,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.interestBtnText}>気分の種類を変更</Text>
              </Pressable>
            </View>
          </View>

          <Pressable
            onPress={handleSave}
            disabled={saving}
            style={({ pressed }) => [
              styles.saveBtn,
              pressed && { opacity: 0.9 },
              saving && { opacity: 0.6 },
            ]}
          >
            {saving ? (
              <ActivityIndicator color={colors.cream} />
            ) : (
              <Text style={styles.saveText}>保存する</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => signOut()}
            style={({ pressed }) => [
              styles.logoutBtn,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.logoutText}>ログアウト</Text>
          </Pressable>

          <Pressable
            onPress={handleDeleteAccountPress}
            disabled={deleting}
            style={({ pressed }) => [
              styles.deleteBtn,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={styles.deleteText}>アカウントを削除</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={showInterestModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowInterestModal(false)}
      >
        <InterestSelectionScreen
          editMode
          onDone={() => setShowInterestModal(false)}
        />
      </Modal>

      {/* メール/パスワードアカウント向け: 削除前の本人確認(再認証)モーダル */}
      <Modal
        visible={showPasswordModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!deleting) setShowPasswordModal(false);
        }}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>本人確認</Text>
            <Text style={styles.modalSub}>
              セキュリティ保護のため、アカウント削除には現在のパスワードの入力が必要です
            </Text>
            <TextInput
              value={deletePassword}
              onChangeText={setDeletePassword}
              placeholder="パスワード"
              placeholderTextColor={colors.textLight}
              secureTextEntry
              autoFocus
              editable={!deleting}
              style={styles.input}
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => {
                  setShowPasswordModal(false);
                  setDeletePassword('');
                }}
                disabled={deleting}
                style={({ pressed }) => [
                  styles.modalCancelBtn,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.modalCancelText}>キャンセル</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (!deletePassword) {
                    Alert.alert('パスワードを入力してください');
                    return;
                  }
                  runDeleteAccount(deletePassword);
                }}
                disabled={deleting}
                style={({ pressed }) => [
                  styles.modalDeleteBtn,
                  pressed && { opacity: 0.85 },
                ]}
              >
                {deleting ? (
                  <ActivityIndicator color={colors.cream} />
                ) : (
                  <Text style={styles.modalDeleteText}>削除する</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 削除処理中(Apple 再認証待ち含む)のブロッキング表示 */}
      <Modal visible={deleting && !showPasswordModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.deletingCard}>
            <ActivityIndicator color={colors.cream} />
            <Text style={styles.deletingText}>アカウントを削除しています…</Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.ai,
  },
  container: {
    padding: 20,
    paddingBottom: 40,
    gap: 14,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.cream,
    marginBottom: 6,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
    letterSpacing: 1,
  },
  input: {
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.cream,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  interestBox: {
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  interestText: {
    color: colors.cream,
    fontSize: 14,
    lineHeight: 20,
  },
  interestBtn: {
    alignSelf: 'flex-start',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.yamabuki,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  interestBtnText: {
    color: colors.yamabuki,
    fontSize: 12,
    fontWeight: '600',
  },
  saveBtn: {
    backgroundColor: colors.shu,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 10,
  },
  saveText: {
    color: colors.cream,
    fontSize: 15,
    fontWeight: '600',
  },
  logoutBtn: {
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    marginTop: 6,
  },
  logoutText: {
    fontSize: 12,
    color: colors.textMuted,
    textDecorationLine: 'underline',
  },
  deleteBtn: {
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  deleteText: {
    fontSize: 11,
    color: colors.danger,
    textDecorationLine: 'underline',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  modalCard: {
    width: '100%',
    backgroundColor: colors.aiDeep,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 20,
    gap: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.cream,
  },
  modalSub: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  modalCancelText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  modalDeleteBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.shu,
  },
  modalDeleteText: {
    color: colors.cream,
    fontSize: 14,
    fontWeight: '600',
  },
  deletingCard: {
    backgroundColor: colors.aiDeep,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 28,
    paddingVertical: 24,
    alignItems: 'center',
    gap: 12,
  },
  deletingText: {
    color: colors.cream,
    fontSize: 13,
  },
});
