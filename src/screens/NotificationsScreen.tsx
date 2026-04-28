// 通知一覧画面(v2: 興味でフィルタ、activity/matchEmoji を reactToNotification に渡す)
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, getDoc } from 'firebase/firestore';
import { colors } from '../config/colors';
import { useAuth } from '../hooks/useAuth';
import { useProfile } from '../hooks/useProfile';
import { useNotifications } from '../hooks/useNotifications';
import { db } from '../config/firebase';
import NotificationCard from '../components/NotificationCard';
import { getActivity } from '../config/activities';

export default function NotificationsScreen({ route }: any) {
  const { currentUser } = useAuth();
  const { profile } = useProfile(currentUser?.uid);
  const {
    notifications,
    unreadCount,
    loading,
    reactToNotification,
  } = useNotifications(currentUser?.uid, profile.interests);

  // プッシュタップで指定された通知 ID にスクロール / 一時ハイライト
  const listRef = useRef<FlatList<any>>(null);
  const [highlightId, setHighlightId] = useState<string | null>(
    route?.params?.highlightId ?? null,
  );
  // scrollToIndex フォールバック用の段階リトライカウンタ。
  // highlightId が変わるたびにリセットする (highlightId と紐付けて管理)。
  const scrollRetryRef = useRef<{ id: string | null; attempts: number }>({
    id: null,
    attempts: 0,
  });

  useEffect(() => {
    const id = route?.params?.highlightId;
    if (id) setHighlightId(id);
  }, [route?.params?.highlightId]);

  useEffect(() => {
    if (!highlightId || notifications.length === 0) return;
    const idx = notifications.findIndex((n) => n.id === highlightId);
    if (idx >= 0) {
      // 新しいハイライトに切り替わったらリトライカウンタをリセット
      scrollRetryRef.current = { id: highlightId, attempts: 0 };
      // FlatList の描画完了を待ってからスクロール
      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 });
      });
      // 2.5秒後にハイライト解除
      const t = setTimeout(() => setHighlightId(null), 2500);
      return () => clearTimeout(t);
    }
  }, [highlightId, notifications]);

  const handleReact = useCallback(
    async (
      notifId: string,
      senderId: string,
      activityId: string,
    ) => {
      if (!currentUser) return;
      try {
        const senderSnap = await getDoc(doc(db, 'users', senderId));
        const senderFcm = senderSnap.data()?.fcmToken;
        const activity = getActivity(activityId);
        await reactToNotification(
          notifId,
          senderId,
          senderFcm,
          profile.name || 'フレンド',
          activity.id,
          activity.matchEmoji,
        );
      } catch (e) {
        console.error('handleReact error', e);
      }
    },
    [currentUser, reactToNotification, profile.name],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>気分アラート</Text>
        {unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>新着 {unreadCount}</Text>
          </View>
        )}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.shu} />
      ) : notifications.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🍻</Text>
          <Text style={styles.emptyText}>まだアラートはありません</Text>
          <Text style={styles.emptySub}>
            興味に合う友達の気分がここに届きます
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={notifications}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            // 通知カードは可変高さ (sender 名・エリア有無で message が 1〜2行に
            // 折り返す) のため getItemLayout が事前計算できず、averageItemLength
            // ベースの一発 scrollToOffset では目的カードを通り過ぎる可能性がある。
            // 段階リトライ (粗→精) で目的位置に収束させる:
            //   1) 粗いoffsetで近傍まで一気にジャンプ (animated:false で測定誤差を最小化)
            //   2) requestAnimationFrame で再描画を待ち scrollToIndex を再試行
            //   3) 失敗したら再度フォールバックが呼ばれ attempts++ で更にリトライ
            //      (最大3回で収束しない場合は諦める)
            const MAX_SCROLL_RETRIES = 3;
            const state = scrollRetryRef.current;
            if (state.attempts >= MAX_SCROLL_RETRIES) return;
            state.attempts += 1;

            const offset = Math.max(0, index * (averageItemLength || 80));
            listRef.current?.scrollToOffset({ offset, animated: false });
            requestAnimationFrame(() => {
              setTimeout(() => {
                listRef.current?.scrollToIndex({
                  index,
                  animated: true,
                  viewPosition: 0.3,
                });
              }, 50 * state.attempts);
            });
          }}
          renderItem={({ item }) => (
            <View
              style={highlightId === item.id ? styles.highlightWrap : undefined}
            >
              <NotificationCard
                notification={item}
                onReact={() => handleReact(item.id, item.senderId, item.activity)}
              />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.ai,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.cream,
  },
  badge: {
    backgroundColor: 'rgba(217,72,41,0.20)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(217,72,41,0.4)',
  },
  badgeText: {
    fontSize: 12,
    color: colors.shu,
    fontWeight: '700',
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  highlightWrap: {
    borderRadius: 16,
    backgroundColor: 'rgba(245,197,24,0.18)',
    borderWidth: 1,
    borderColor: colors.yamabuki,
    marginVertical: 4,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 32,
  },
  emptyEmoji: {
    fontSize: 56,
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 15,
    color: colors.cream,
    fontWeight: '500',
  },
  emptySub: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
