// ホーム画面(v2): タブ切替 + エリア任意入力 + 「いきますかー」→「待ちますかー」
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  ScrollView,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  addDoc,
  collection,
  serverTimestamp,
} from 'firebase/firestore';
import { colors } from '../config/colors';
import { ActivityId, getActivity, getEnabledActivityIds } from '../config/activities';
import { useAuth } from '../hooks/useAuth';
import { useFriends } from '../hooks/useFriends';
import { useProfile } from '../hooks/useProfile';
import { db } from '../config/firebase';
import { sendPushNotification } from '../utils/pushNotifications';
import SendOverlay from '../components/SendOverlay';
import ActivityTab from '../components/ActivityTab';
import FriendPill from '../components/FriendPill';
import { useWaitingReset } from '../contexts/WaitingResetContext';
import WaitingExpiredNotice from '../components/WaitingExpiredNotice';

// 「待ちますかー」を自動解除するまでの時間 (3時間)
const WAITING_TIMEOUT_MS = 3 * 60 * 60 * 1000;

export default function HomeScreen({ navigation, route }: any) {
  const { currentUser } = useAuth();
  const { profile } = useProfile(currentUser?.uid);
  const { friends } = useFriends(currentUser?.uid);

  // 表示対象: ユーザーの interests と enabled の積集合
  const visibleIds = useMemo<ActivityId[]>(() => {
    const enabled = new Set(getEnabledActivityIds());
    return profile.interests.filter((id) => enabled.has(id));
  }, [profile.interests]);
  const singleActivity = visibleIds.length === 1;

  // アクティブタブ: visibleIds 先頭をデフォルトに
  const [activeId, setActiveId] = useState<ActivityId | null>(null);
  useEffect(() => {
    if (!activeId && visibleIds.length > 0) {
      setActiveId(visibleIds[0]);
    }
    if (activeId && !visibleIds.includes(activeId)) {
      setActiveId(visibleIds[0] ?? null);
    }
  }, [visibleIds, activeId]);

  // 送信後の「待ちますかー」状態
  const [waiting, setWaiting] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const [sending, setSending] = useState(false);
  const [area, setArea] = useState('');
  // 「いきますかー」を送信した時刻 (epoch ms)。3時間経過の判定に使う。
  // アプリを完全終了すれば waiting ごと消えるので永続化はしない。
  const [waitingStartedAt, setWaitingStartedAt] = useState<number | null>(null);
  // 3時間経過時に「キブンじゃないかも？」を出している間 true
  const [expiredNotice, setExpiredNotice] = useState(false);
  // 期限切れ処理の二重発火ガード (AppState 復帰とタイマーが同時に来る等)
  const expiringRef = useRef(false);

  // 全ての解除経路が通る出口。タイマー関連の状態もまとめて畳む。
  const clearWaiting = useCallback(() => {
    expiringRef.current = false;
    setWaiting(false);
    setWaitingStartedAt(null);
    setExpiredNotice(false);
  }, []);

  const activity = useMemo(() => getActivity(activeId ?? 'drinking'), [activeId]);

  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => {
    Animated.spring(scale, { toValue: 0.97, friction: 5, useNativeDriver: true }).start();
  };
  const pressOut = () => {
    Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: true }).start();
  };

  // 送信対象: active なフレンドだけ。フレンドタブのトグルで OFF にされた
  // 相手はそもそも notification doc / push 通知の対象外。
  const activeFriends = useMemo(
    () => friends.filter((f) => f.active),
    [friends],
  );

  const handleSend = useCallback(async () => {
    if (!currentUser || sending || !activeId) return;
    setSending(true);
    try {
      const myName = profile.name || 'フレンド';
      // active なフレンドにだけ Firestore notification を書き込み、push を送る。
      // tokens と notificationIds は同じインデックスで保持し、受信側がタップ
      // したときに自分宛の Firestore notification doc に飛べるようにする。
      // 受信側 useNotifications が更に興味でフィルタする 2 段構成は維持。
      const tokens: string[] = [];
      const notificationIds: string[] = [];
      for (const f of activeFriends) {
        const docRef = await addDoc(collection(db, 'notifications'), {
          senderId: currentUser.uid,
          senderName: myName,
          receiverId: f.id,
          type: 'kibun',
          activity: activeId,
          area: area.trim() || null,
          createdAt: serverTimestamp(),
          isRead: false,
          reactedBy: null,
        });
        if (f.fcmToken) {
          tokens.push(f.fcmToken);
          notificationIds.push(docRef.id);
        }
      }
      if (tokens.length > 0) {
        const areaPart = area.trim() ? ` (${area.trim()})` : '';
        const body = `${myName}さん、いきますかー${areaPart}${activity.waitEmoji}`;
        await sendPushNotification(tokens, 'KIBUNYA', body, {
          notificationIds,
          type: 'kibun',
        });
      }
      setOverlay(true);
      expiringRef.current = false;
      setWaitingStartedAt(Date.now());
      setExpiredNotice(false);
      setWaiting(true);
    } catch (e: any) {
      console.error('handleSend error', e);
      Alert.alert('送信失敗', 'もう一度お試しください');
    } finally {
      setSending(false);
    }
  }, [currentUser, activeFriends, sending, activeId, profile.name, area, activity]);

  // 待機解除 (1): App.tsx の tabPress リスナーが「気分タブの再タップ」時に
  // route.params.resetAt を更新する。タブが選択済みでも「戻れる」ことを
  // 保証するための導線。
  const resetAt = route?.params?.resetAt;
  useEffect(() => {
    if (resetAt) clearWaiting();
  }, [resetAt, clearWaiting]);

  // 待機解除 (2): 友達から「かー」が返ってきた時の自動解除。
  // App.tsx の Root が useMatchEvents で reaction を検知した時点で
  // resetToken をインクリメントする。MatchOverlay の祝祭演出が閉じた
  // 時には既に通常画面に戻っており、そのまま次の「いきますかー」を
  // 押せる状態になる。
  const { resetToken } = useWaitingReset();
  useEffect(() => {
    if (resetToken > 0) clearWaiting();
  }, [resetToken, clearWaiting]);

  // 待機解除 (4): 送信から3時間経過。
  //
  // setTimeout だけに頼らないのは、アプリがバックグラウンドに入ると
  // JS タイマーが停止/遅延して発火時刻がずれるため。送信時刻を保持し、
  //   - 残り時間ぶんの setTimeout
  //   - フォアグラウンド復帰 (AppState 'active') 時の再判定
  // の両方で「今の時刻」と比較する。復帰時に既に3時間を超えていれば
  // その場で解除する。
  useEffect(() => {
    if (!waiting || waitingStartedAt === null) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const check = () => {
      if (cancelled) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const remaining = waitingStartedAt + WAITING_TIMEOUT_MS - Date.now();
      if (remaining <= 0) {
        // 一言を出してから解除する。実際の解除は
        // WaitingExpiredNotice の onFinish (= clearWaiting) が行う。
        if (expiringRef.current) return;
        expiringRef.current = true;
        setExpiredNotice(true);
        return;
      }
      timer = setTimeout(check, remaining);
    };

    check();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });

    // waiting が false になった時 / 別の解除経路が走った時にここが必ず
    // 呼ばれ、タイマーと AppState 購読を落とす。
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [waiting, waitingStartedAt]);

  // 表示可能なアクティビティが無い場合 (interests 未設定 or enabled なものが無い)
  if (visibleIds.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🔍</Text>
          <Text style={styles.emptyTitle}>気分を選んでないみたい</Text>
          <Text style={styles.emptySub}>
            プロフィールから「気分の種類」を追加してね
          </Text>
          <Pressable
            onPress={() => navigation?.navigate?.('Profile')}
            style={({ pressed }) => [
              styles.emptyBtn,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.emptyBtnText}>気分を追加</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.glow} pointerEvents="none" />

      <View style={styles.header}>
        <Text style={styles.logo}>KIBUNYA</Text>
        <Pressable
          onPress={() => navigation?.navigate?.('Friends')}
          style={({ pressed }) => [
            styles.friendsBtn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={styles.friendsIcon}>👥</Text>
        </Pressable>
      </View>

      {!singleActivity && (
        <View style={styles.tabRow}>
          <ActivityTab
            availableIds={visibleIds}
            activeId={activeId}
            // 待機解除 (3): アクティビティタブの切替
            onChange={(id) => {
              setActiveId(id);
              clearWaiting();
            }}
          />
        </View>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.center}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.emojiBox, singleActivity && styles.emojiBoxLarge]}>
            <Text style={[styles.emoji, singleActivity && styles.emojiLarge]}>
              {activity.waitEmoji}
            </Text>
          </View>

          <Text style={[styles.title, waiting && styles.titleWaiting]}>
            {waiting ? '待ちますかー' : activity.sendCopy}
          </Text>

          {!waiting && (
            <View style={styles.areaField}>
              <Text style={styles.areaLabel}>エリア (任意)</Text>
              <TextInput
                value={area}
                onChangeText={setArea}
                placeholder="例: 新宿・渋谷・自宅"
                placeholderTextColor={colors.textLight}
                style={styles.areaInput}
                maxLength={30}
              />
            </View>
          )}

          <Animated.View
            style={[
              { transform: [{ scale }], width: '100%', maxWidth: 320 },
              waiting && { marginTop: 16 },
            ]}
          >
            {waiting ? (
              // 待機中は「状態表示」だけを出す。解除は
              //   1. 友達から「かー」が返ってきた時の自動解除
              //   2. 「気分」タブの再タップ
              // の2経路があるため、画面内に取り消しボタンは置かない。
              <View style={styles.waitingStatus} pointerEvents="none">
                <Text style={styles.waitingStatusText}>
                  友達の「かー」を待ってます {activity.waitEmoji}
                </Text>
              </View>
            ) : (
              <Pressable
                onPressIn={pressIn}
                onPressOut={pressOut}
                onPress={handleSend}
                disabled={sending}
                style={({ pressed }) => [
                  styles.cta,
                  pressed && { opacity: 0.95 },
                  sending && { opacity: 0.6 },
                ]}
              >
                <Text style={styles.ctaText}>
                  {sending ? '送信中...' : 'いきますかー'}
                </Text>
              </Pressable>
            )}
          </Animated.View>

          <Text style={styles.hint}>
            {waiting
              ? '下の「気分」タブをもう一度タップしても戻れます'
              : '興味が合う友達に通知が届きます'}
          </Text>

          <View style={styles.pillRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 4 }}
            >
              {friends.length === 0 ? (
                <Text style={styles.noFriends}>
                  まだ友達がいません。フレンドタブから招待してね
                </Text>
              ) : activeFriends.length === 0 ? (
                <Text style={styles.noFriends}>
                  通知対象のフレンドがいません (フレンドタブで ON に)
                </Text>
              ) : (
                activeFriends.map((f) => (
                  <FriendPill key={f.id} name={f.name} online={f.isOnline} />
                ))
              )}
            </ScrollView>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <SendOverlay
        visible={overlay}
        onClose={() => setOverlay(false)}
        activityId={activity.id}
      />

      {/*
        3時間経過の一言。フェードアウトし終わってから clearWaiting() が
        走るので、「表示 → 通常画面へ」の順序になる。
      */}
      <WaitingExpiredNotice visible={expiredNotice} onFinish={clearWaiting} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.ai,
  },
  glow: {
    position: 'absolute',
    width: 420,
    height: 420,
    borderRadius: 210,
    backgroundColor: colors.yamabuki,
    opacity: 0.08,
    top: -100,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  logo: {
    fontSize: 12,
    letterSpacing: 5,
    color: colors.textLight,
    fontWeight: '700',
  },
  friendsBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    justifyContent: 'center',
    alignItems: 'center',
  },
  friendsIcon: { fontSize: 18 },
  tabRow: {
    paddingBottom: 8,
  },
  center: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 40,
    gap: 14,
  },
  emojiBox: {
    width: 140,
    height: 140,
    borderRadius: 34,
    backgroundColor: colors.yamabuki,
    borderWidth: 3,
    borderColor: colors.shu,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  emojiBoxLarge: {
    width: 200,
    height: 200,
    borderRadius: 48,
    marginTop: 8,
    marginBottom: 16,
  },
  emoji: { fontSize: 72 },
  emojiLarge: { fontSize: 110 },
  title: {
    fontSize: 22,
    color: colors.cream,
    fontWeight: '600',
  },
  titleWaiting: {
    // 待機中はこの下に状態カードが入るので、以前ほど余白を空けない
    marginBottom: 4,
  },
  areaField: {
    width: '100%',
    maxWidth: 320,
    gap: 6,
    marginTop: 4,
    marginBottom: 4,
  },
  areaLabel: {
    fontSize: 11,
    color: colors.textLight,
    marginLeft: 4,
  },
  areaInput: {
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.cream,
  },
  cta: {
    backgroundColor: colors.shu,
    paddingVertical: 20,
    borderRadius: 20,
    alignItems: 'center',
  },
  ctaText: {
    color: colors.cream,
    fontSize: 18,
    fontWeight: '600',
  },
  // 状態表示: 山吹の縁取りで「光って待っている」感を出す。押せない。
  waitingStatus: {
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.yamabuki,
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  waitingStatusText: {
    color: colors.yamabuki,
    fontSize: 15,
    fontWeight: '700',
  },
  hint: {
    fontSize: 11,
    color: colors.textLight,
    marginTop: 4,
  },
  pillRow: {
    width: '100%',
    marginTop: 18,
  },
  noFriends: {
    fontSize: 12,
    color: colors.textMuted,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
  },
  emptyEmoji: { fontSize: 56 },
  emptyTitle: {
    fontSize: 18,
    color: colors.cream,
    fontWeight: '600',
  },
  emptySub: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 12,
  },
  emptyBtn: {
    backgroundColor: colors.shu,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 14,
  },
  emptyBtnText: {
    color: colors.cream,
    fontWeight: '600',
    fontSize: 14,
  },
});
