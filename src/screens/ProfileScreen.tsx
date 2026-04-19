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

export default function ProfileScreen() {
  const { currentUser, signOut } = useAuth();
  const { profile, loading, updateProfile } = useProfile(currentUser?.uid);

  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [showInterestModal, setShowInterestModal] = useState(false);

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
});
