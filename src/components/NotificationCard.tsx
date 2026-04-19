// 通知カード(v2: activity別絵文字 + 「済👌」状態)
import React, { useState } from 'react';
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

function formatTime(ts: any): string {
  try {
    const ms = ts?.toMillis?.() ?? 0;
    if (!ms) return '';
    const date = new Date(ms);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  } catch {
    return '';
  }
}

export default function NotificationCard({ notification, onReact }: Props) {
  const [busy, setBusy] = useState(false);
  const isReaction = notification.type === 'reaction';
  const activity = getActivity(notification.activity);
  const reacted = !!notification.reactedBy;
  const unread = !notification.isRead && !reacted && !isReaction;

  const handlePress = async () => {
    if (busy || !onReact) return;
    setBusy(true);
    try {
      await onReact();
    } finally {
      setBusy(false);
    }
  };

  // 表示メッセージ
  let message: string;
  if (isReaction) {
    message = `${notification.senderName}さんが「かー」しました ${activity.matchEmoji}`;
  } else if (reacted) {
    message = `${notification.senderName}さんの${activity.label}の気分 — かーした`;
  } else {
    const areaPart = notification.area ? ` (${notification.area})` : '';
    message = `${notification.senderName}さんが${activity.label}の気分${areaPart}`;
  }

  return (
    <View
      style={[
        styles.card,
        unread ? styles.cardUnread : styles.cardRead,
        reacted && styles.cardDone,
      ]}
    >
      {unread && <View style={styles.bar} />}
      <View style={styles.emojiWrap}>
        <Text style={styles.emojiText}>
          {isReaction || reacted ? activity.matchEmoji : activity.waitEmoji}
        </Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.name}>{notification.senderName}</Text>
        <Text style={styles.message}>{message}</Text>
        <Text style={styles.time}>{formatTime(notification.createdAt)}</Text>
      </View>
      {unread ? (
        <Pressable
          onPress={handlePress}
          disabled={busy}
          style={({ pressed }) => [
            styles.reactBtn,
            pressed && { opacity: 0.7 },
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
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
    width: 3,
    backgroundColor: colors.yamabuki,
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
