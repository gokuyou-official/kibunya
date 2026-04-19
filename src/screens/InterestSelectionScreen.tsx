// 初回オンボーディング後の興味選択画面 + 変更画面としても使用
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../config/colors';
import { ACTIVITIES, ActivityId } from '../config/activities';
import { useAuth } from '../hooks/useAuth';
import { useProfile } from '../hooks/useProfile';

type Props = {
  // 既存ユーザーが編集するモード(true=閉じるボタンを表示)
  editMode?: boolean;
  onDone?: () => void;
};

export default function InterestSelectionScreen({ editMode, onDone }: Props) {
  const { currentUser } = useAuth();
  const { profile, setInterests } = useProfile(currentUser?.uid);
  const [selected, setSelected] = useState<ActivityId[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(profile.interests);
  }, [profile.interests]);

  const toggle = useCallback((id: ActivityId) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const handleSave = async () => {
    if (selected.length === 0) {
      Alert.alert('選んでね', '1つ以上選択してください');
      return;
    }
    setSaving(true);
    try {
      await setInterests(selected);
      onDone?.();
    } catch (e: any) {
      Alert.alert('保存できませんでした', e?.message ?? '');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.kicker}>KIBUNYA</Text>
        <Text style={styles.title}>気分、なに置いとく？</Text>
        <Text style={styles.sub}>
          通知を受け取りたいアクティビティを選んでね。{'\n'}後からいつでも変えられます。
        </Text>

        <View style={styles.grid}>
          {ACTIVITIES.map((a) => {
            const on = selected.includes(a.id);
            return (
              <Pressable
                key={a.id}
                onPress={() => toggle(a.id)}
                style={({ pressed }) => [
                  styles.tile,
                  on && styles.tileOn,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.tileEmoji}>{a.waitEmoji}</Text>
                <Text style={[styles.tileLabel, on && styles.tileLabelOn]}>
                  {a.label}
                </Text>
                {on && (
                  <View style={styles.check}>
                    <Text style={styles.checkText}>✓</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={({ pressed }) => [
            styles.cta,
            pressed && { opacity: 0.9 },
            saving && { opacity: 0.6 },
          ]}
        >
          {saving ? (
            <ActivityIndicator color={colors.cream} />
          ) : (
            <Text style={styles.ctaText}>
              {editMode ? '保存する' : 'はじめる'}
            </Text>
          )}
        </Pressable>

        {editMode && (
          <Pressable onPress={onDone} style={styles.cancel}>
            <Text style={styles.cancelText}>キャンセル</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.ai },
  container: { padding: 24, paddingBottom: 40, gap: 14 },
  kicker: {
    fontSize: 12,
    letterSpacing: 5,
    color: colors.textLight,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
  },
  title: {
    fontSize: 26,
    color: colors.cream,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 8,
  },
  sub: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  tile: {
    width: '47%',
    aspectRatio: 1,
    borderRadius: 22,
    backgroundColor: colors.cardBg,
    borderWidth: 1.5,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
    position: 'relative',
  },
  tileOn: {
    backgroundColor: 'rgba(245,197,24,0.14)',
    borderColor: colors.yamabuki,
  },
  tileEmoji: { fontSize: 52 },
  tileLabel: {
    fontSize: 15,
    color: colors.textMuted,
    fontWeight: '500',
  },
  tileLabelOn: { color: colors.cream, fontWeight: '600' },
  check: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.yamabuki,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkText: { color: colors.ai, fontWeight: '800' },
  cta: {
    backgroundColor: colors.shu,
    paddingVertical: 18,
    borderRadius: 18,
    alignItems: 'center',
    marginTop: 12,
  },
  ctaText: {
    color: colors.cream,
    fontSize: 16,
    fontWeight: '600',
  },
  cancel: {
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  cancelText: {
    color: colors.textMuted,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
});
