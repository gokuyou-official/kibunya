// ホーム画面に出す「届いている気分」の1枚。
//
// なぜ必要か:
//   届いた気分に気づける手段がアラートタブのバッジとプッシュ通知しか無く、
//   タブを一度開くとバッジが消えて痕跡がゼロになっていた。ホーム画面は
//   完全に「自分が送る側」の画面で、受信側の情報を持っていなかった。
//   気づける場所をもう1つ、いちばん最初に開く画面に置く。
//
// 押したら消える:
//   「かー」で reactedBy が入り、購読側の絞り込みから外れるので
//   再描画で自然に消える。ここで消す処理は持たない。
import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { colors } from '../config/colors';

type Props = {
  senderName: string;
  activityLabel: string;
  emoji: string;
  area?: string;
  // 同じ状態の気分が他に何件あるか (この1枚を除いた数)。0 なら出さない。
  othersCount: number;
  onReact: () => Promise<void> | void;
  onPressOthers: () => void;
};

export default function IncomingMoodCard({
  senderName,
  activityLabel,
  emoji,
  area,
  othersCount,
  onReact,
  onPressOthers,
}: Props) {
  const [busy, setBusy] = useState(false);
  // ⚠️ 連打防止は state ではなく ref で同期的に行う。
  // NotificationCard と同じ理由: setBusy は次 render まで反映されないため、
  // 連打すると 2 回目が busy=false を見て通過し「かー」が複数飛ぶ。
  const busyRef = useRef(false);

  const handlePress = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await onReact();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const areaPart = area ? ` (${area})` : '';

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.emojiWrap}>
          <Text style={styles.emoji}>{emoji}</Text>
        </View>
        <View style={styles.body}>
          <Text style={styles.label}>届いています</Text>
          <Text style={styles.message} numberOfLines={2}>
            {senderName}さんが {activityLabel}の気分{areaPart} です
          </Text>
        </View>
        <Pressable
          onPress={handlePress}
          disabled={busy}
          style={({ pressed }) => [
            styles.reactBtn,
            pressed && { opacity: 0.7 },
            busy && { opacity: 0.6 },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.cream} />
          ) : (
            <Text style={styles.reactText}>かー🙋</Text>
          )}
        </Pressable>
      </View>

      {othersCount > 0 ? (
        <Pressable
          onPress={onPressOthers}
          style={({ pressed }) => [styles.others, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.othersText}>他 {othersCount} 件</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    marginTop: 18,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    // 山吹の淡い面 + 枠。アラート一覧の未読カードと同じ扱いにして
    // 「まだ手がついていない」ことを色でも揃える。
    backgroundColor: 'rgba(245,197,24,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(245,197,24,0.35)',
  },
  emojiWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,249,236,0.08)',
  },
  emoji: { fontSize: 20 },
  body: { flex: 1 },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.yamabuki,
  },
  message: {
    fontSize: 13,
    color: colors.cream,
    marginTop: 2,
  },
  reactBtn: {
    backgroundColor: colors.shu,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
  },
  reactText: {
    color: colors.cream,
    fontSize: 13,
    fontWeight: '600',
  },
  others: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  othersText: {
    fontSize: 12,
    color: colors.textMuted,
    textDecorationLine: 'underline',
  },
});
