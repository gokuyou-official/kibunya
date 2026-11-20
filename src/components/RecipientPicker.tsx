// 気分を送る相手を個別に選ぶモーダル。
//
// なぜ必要か:
//   これまで宛先は自動で決まり、選ぶ手段が無かった。画面下のチップ列は
//   「トグル ON の友達」を並べているだけで、そこからさらに興味で絞られる。
//   そのため「チップに5人出ているのに届くのは2人」が起きても、送る側には
//   何も分からなかった。ここで宛先を見せ、必要なら外せるようにする。
//
// 出すのは届けられる人だけ:
//   興味が合わない人・通知オフの人は、そもそも一覧に並べない。
//   「この人には届きません」を常に見せる作りにはしない。
//
// 初期状態は全員チェック済み:
//   開いてそのまま送れば従来と同じ結果になる。外したい人だけ外す。
//   選択は毎回リセットする (呼び出し側が持っている)。前回外した人が
//   次回も外れたままだと、送ったつもりで届かない事故になるため。
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../config/colors';

export type PickableFriend = {
  id: string;
  name: string;
  // プロフィールの「一言」。未入力なら空文字。
  bio: string;
  isOnline: boolean;
};

type Props = {
  visible: boolean;
  // 届けられる人だけを渡すこと (興味・通知オフの絞り込みは呼び出し側で済ませる)
  friends: PickableFriend[];
  // 選ばれている人の id。friends の部分集合。
  selectedIds: string[];
  activityLabel: string;
  onToggle: (id: string) => void;
  onClose: () => void;
};

export default function RecipientPicker({
  visible,
  friends,
  selectedIds,
  activityLabel,
  onToggle,
  onClose,
}: Props) {
  const selected = new Set(selectedIds);
  const count = friends.filter((f) => selected.has(f.id)).length;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>相手を選ぶ</Text>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            style={({ pressed }) => pressed && { opacity: 0.6 }}
          >
            <Text style={styles.close}>閉じる</Text>
          </Pressable>
        </View>

        <Text style={styles.lead}>{activityLabel} に興味がある友達</Text>

        <ScrollView contentContainerStyle={styles.list}>
          {friends.map((f) => {
            const on = selected.has(f.id);
            return (
              <Pressable
                key={f.id}
                onPress={() => onToggle(f.id)}
                style={({ pressed }) => [
                  styles.row,
                  on ? styles.rowOn : styles.rowOff,
                  pressed && { opacity: 0.8 },
                ]}
              >
                {/* チェック。色だけで区別せず、記号でも分かるようにする */}
                <View style={[styles.check, on ? styles.checkOn : styles.checkOff]}>
                  <Text style={[styles.checkMark, !on && { opacity: 0 }]}>✓</Text>
                </View>
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: f.isOnline ? colors.online : colors.offline },
                  ]}
                />
                {/* 名前と一言を積む。一言は長くても 1 行で省略する。 */}
                <View style={styles.nameCol}>
                  <Text style={styles.name} numberOfLines={1}>
                    {f.name}
                  </Text>
                  {f.bio ? (
                    <Text style={styles.bio} numberOfLines={1}>
                      {f.bio}
                    </Text>
                  ) : null}
                </View>
                {f.isOnline ? (
                  <Text style={styles.onlineNote}>5分以内に開いています</Text>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            onPress={onClose}
            disabled={count === 0}
            style={({ pressed }) => [
              styles.cta,
              pressed && { opacity: 0.9 },
              count === 0 && { opacity: 0.5 },
            ]}
          >
            <Text style={styles.ctaText}>
              {count === 0 ? '相手を選んでください' : `${count}人に送る`}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.ai },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.cream },
  close: { fontSize: 15, color: colors.yamabuki, fontWeight: '600' },
  lead: {
    fontSize: 13,
    color: colors.textMuted,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  list: { paddingHorizontal: 20, paddingBottom: 24, gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  rowOn: {
    backgroundColor: 'rgba(245,197,24,0.10)',
    borderColor: 'rgba(245,197,24,0.35)',
  },
  rowOff: {
    backgroundColor: colors.cardBg,
    borderColor: colors.cardBorder,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  checkOn: { backgroundColor: colors.yamabuki, borderColor: colors.yamabuki },
  checkOff: { backgroundColor: 'transparent', borderColor: colors.cardBorder },
  checkMark: { fontSize: 13, fontWeight: '700', color: colors.ai },
  dot: { width: 8, height: 8, borderRadius: 4 },
  nameCol: { flex: 1 },
  name: { fontSize: 15, fontWeight: '500', color: colors.cream },
  bio: { marginTop: 2, fontSize: 11, color: colors.textMuted },
  onlineNote: { fontSize: 11, color: colors.textLight },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  cta: {
    backgroundColor: colors.shu,
    paddingVertical: 16,
    borderRadius: 18,
    alignItems: 'center',
  },
  ctaText: { color: colors.cream, fontSize: 16, fontWeight: '700' },
});
