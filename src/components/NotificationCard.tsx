// 通知カード(v2: activity別絵文字 + 「済👌」状態)
import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { colors } from '../config/colors';
import type { Notification } from '../hooks/useNotifications';
import { getActivity } from '../config/activities';

type Props = {
  notification: Notification;
  onReact?: () => Promise<void> | void;
};

// 通知は 7 日間残る (useNotifications の cleanupOldNotifications) ため、
// 時刻だけではいつの通知か判別できない。当日は時刻のみ、前日は「昨日」、
// それ以前は「M/D」を前置する。
//
// 判定は経過時間 (24時間差) ではなく暦日の境界で行う。経過時間で判定すると
// 深夜 1 時に受け取った通知が翌朝 9 時の時点でまだ「今日」扱いのままになり、
// 実際の日付とずれてしまうため。
//
// 保持期間が 7 日なので年跨ぎでも月日だけで一意に読める。年は表示しない。
function formatTime(ts: any): string {
  try {
    const ms = ts?.toMillis?.() ?? 0;
    if (!ms) return '';
    const date = new Date(ms);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const time = `${hh}:${mm}`;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);

    if (ms >= startOfToday.getTime()) return time;
    if (ms >= startOfYesterday.getTime()) return `昨日 ${time}`;
    return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
  } catch {
    return '';
  }
}

export default function NotificationCard({ notification, onReact }: Props) {
  const [busy, setBusy] = useState(false);
  // ⚠️ 連打防止は state ではなく ref で同期的に行う。
  // state は setBusy → 次 render まで反映されないため、連打すると 1 回目の
  // setBusy(true) が反映される前に 2 回目の handlePress が busy=false を
  // 見て通過してしまい「かー」が複数送信される (実際に発生していた)。
  const busyRef = useRef(false);
  const isReaction = notification.type === 'reaction';
  const activity = getActivity(notification.activity);
  const reacted = !!notification.reactedBy;
  // 未読 highlight (黄色 bar) は isRead=false かつ未 react の時のみ。
  const unread = !notification.isRead && !reacted && !isReaction;
  // 「かー」ボタンの表示条件は reactedBy / isReaction だけに依存する。
  // isRead が true でも (= アラートタブを「見た」後でも) reacted でなければ
  // ボタンは押せる状態のままにする。
  // 気分の有効期限が切れたカード。送信側は既に締めているので、
  // ここで「かー」を返しても相手には届かない。押せなくして減光する。
  // expiresAtMs を持たない旧データは期限の概念が無いので対象外。
  const expired =
    !isReaction &&
    typeof notification.expiresAtMs === 'number' &&
    Date.now() >= notification.expiresAtMs;
  const canReact = !reacted && !isReaction && !expired;

  const handlePress = async () => {
    if (busyRef.current || !onReact) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await onReact();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // senderName 安全フォールバック (古いデータで空文字が混ざっている可能性)
  const safeSenderName =
    (typeof notification.senderName === 'string' && notification.senderName.trim()) ||
    'フレンド';

  // 表示メッセージ
  //
  // 3 通りある。どれも主語は相手の名前だが、述語で「どちらが誘ったか」が
  // 分かるようにする。以前は色 (金/緑) と「済👌」バッジだけが手がかりで、
  // 一覧をスクロールすると両者が時系列に混ざり、文面からは方向が読めなかった。
  //
  //   reaction        自分が誘い、相手が応じた   … 「〜してくれました」
  //   kibun (未応答)   相手が誘い、自分は未応答   … 現状のまま
  //   kibun (応答済)   相手が誘い、自分が応じた   … 「〜に「かー」しました」
  //
  // NOTE: 以前も reacted 用の別テンプレートがあったが、
  //   `${name}さんの${label}の気分 — かーした`
  // と後ろに継ぎ足す形だったため日本語として繋がらず、一度一本化した。
  // 今回は文末まで作り直した独立した一文なのでその問題は起きない。
  //
  // 応答済みだけエリアを出さないのは、この段になるとカードが
  // 「自分が動いた記録」でしかなく、どこで飲むかの情報はもう要らないため。
  // 未応答カードには従来どおり残すので、判断に必要な間は消えない。
  let message: string;
  if (isReaction) {
    message = `${safeSenderName}さんが「かー」してくれました ${activity.matchEmoji}`;
  } else if (reacted) {
    message = `${safeSenderName}さんの気分に「かー」しました ${activity.matchEmoji}`;
  } else {
    const areaPart = notification.area ? ` (${notification.area})` : '';
    message = `${safeSenderName}さんが${activity.label}の気分${areaPart}`;
  }

  return (
    <View
      style={[
        styles.card,
        unread ? styles.cardUnread : styles.cardRead,
        reacted && styles.cardDone,
        // 期限切れは全体を減光する。本文は読めるまま残す
        // (何が終わったのか分からなくならないように)。
        expired && styles.cardExpired,
      ]}
    >
      {/*
        左端のカラーバー (幅 4px) で種類を視覚的に判別する。
        - kibun (受信した気分 / 誘われた側): 朱 (shu)
        - reaction (自分への「かー」返答):    金 (yamabuki)
        unread 状態に関わらず常時表示。未読 highlight は cardUnread の
        背景色で別途表現する。
      */}
      <View
        style={[
          styles.bar,
          { backgroundColor: isReaction ? colors.yamabuki : colors.shu },
        ]}
      />
      <View style={styles.emojiWrap}>
        <Text style={styles.emojiText}>
          {isReaction || reacted ? activity.matchEmoji : activity.waitEmoji}
        </Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.name}>{safeSenderName}</Text>
        <Text style={styles.message}>{message}</Text>
        <Text style={styles.time}>{formatTime(notification.createdAt)}</Text>
      </View>
      {canReact ? (
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
      ) : reacted && !isReaction ? (
        <View style={styles.doneBadge}>
          <Text style={styles.doneText}>済👌</Text>
        </View>
      ) : expired ? (
        // 期限切れ。押せないことが分かるよう、バッジだけ残す。
        <View style={styles.expiredBadge}>
          <Text style={styles.expiredText}>終了</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cardExpired: { opacity: 0.45 },
  expiredBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  expiredText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    marginBottom: 10,
    gap: 12,
    overflow: 'hidden',
  },
  cardUnread: {
    backgroundColor: 'rgba(245,197,24,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(245,197,24,0.35)',
  },
  cardRead: {
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  cardDone: {
    backgroundColor: 'rgba(59,178,115,0.08)',
    borderColor: 'rgba(59,178,115,0.25)',
  },
  bar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    // backgroundColor は inline で type に応じて上書きする
  },
  emojiWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,249,236,0.08)',
  },
  emojiText: {
    fontSize: 22,
  },
  body: {
    flex: 1,
  },
  name: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.cream,
  },
  message: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  time: {
    fontSize: 11,
    color: colors.textLight,
    marginTop: 4,
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
  doneBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(59,178,115,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(59,178,115,0.4)',
  },
  doneText: {
    color: '#3BB273',
    fontSize: 13,
    fontWeight: '700',
  },
});
