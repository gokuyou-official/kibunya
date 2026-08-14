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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  addDoc,
  collection,
  serverTimestamp,
  Timestamp,
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
import { matchesInterest } from '../utils/interestMatch';
import WaitingExpiredNotice from '../components/WaitingExpiredNotice';
import MoodClosingCard from '../components/MoodClosingCard';
import { useMyMood, formatRemaining, MOOD_TTL_MS } from '../hooks/useMyMood';

// 待機時間の実体は useMyMood の MOOD_TTL_MS (3時間)。
// ここでは再エクスポートせず、必要な箇所で MOOD_TTL_MS を使う。

export default function HomeScreen({ navigation }: any) {
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

  const [overlay, setOverlay] = useState(false);
  const [sending, setSending] = useState(false);
  const [area, setArea] = useState('');
  // 届く相手が0人だった時の一言を出している間 true。
  // 送信自体を行わないので mood とは無関係。
  const [noRecipients, setNoRecipients] = useState(false);

  // 送信後の状態は Firestore が持つ。ローカル state だとアプリを落とすと
  // 消えてしまい、「送ったのに待機が消えている」状態になっていた。
  const { mood, phase, remainingMs, closeMood } = useMyMood(currentUser?.uid);
  const waiting = phase === 'waiting';

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

  // 実際に送る相手: active かつ「その気分に興味がある人」。
  // 以前は受信側でしか絞っていなかったため、興味の無い相手にも doc と push が
  // 飛んでいた。判定は受信側と同じ述語 (matchesInterest) を使う。
  const recipients = useMemo(
    () =>
      activeId
        ? activeFriends.filter((f) => matchesInterest(f.interests, activeId))
        : [],
    [activeFriends, activeId],
  );

  const handleSend = useCallback(async () => {
    if (!currentUser || sending || !activeId) return;
    // 届く相手が1人もいないなら、doc も push も作らずに終わる。
    // 「送ったのに誰にも届いていない」状態 (待機だけ始まる) を作らないため。
    if (recipients.length === 0) {
      setNoRecipients(true);
      return;
    }
    setSending(true);
    try {
      const myName = profile.name || 'フレンド';
      // 先に mood を作る。送信後の状態はこのドキュメントが持つ。
      // expiresAt はクライアントで計算した固定値。serverTimestamp は
      // 「今」しか入れられず未来時刻を作れないため。
      // recipientIds は「かー」を返せる人の判定にルール側で使う。
      const expiresAt = Timestamp.fromMillis(Date.now() + MOOD_TTL_MS);
      const moodRef = await addDoc(collection(db, 'moods'), {
        senderId: currentUser.uid,
        senderName: myName,
        activity: activeId,
        area: area.trim() || null,
        recipientIds: recipients.map((f) => f.id),
        createdAt: serverTimestamp(),
        expiresAt,
        // null で作る。締めた時に closedAt が入り、購読クエリから外れる。
        closedAt: null,
      });
      // active なフレンドにだけ Firestore notification を書き込み、push を送る。
      // tokens と notificationIds は同じインデックスで保持し、受信側がタップ
      // したときに自分宛の Firestore notification doc に飛べるようにする。
      // 受信側 useNotifications が更に興味でフィルタする 2 段構成は維持。
      const tokens: string[] = [];
      const notificationIds: string[] = [];
      for (const f of recipients) {
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
          // 受信側が「かー」を書き込む先と、期限切れ表示の判定に使う。
          moodId: moodRef.id,
          expiresAt,
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
      // 待機状態は mood の購読 (useMyMood) が拾うので、ここでは立てない。
      setOverlay(true);
    } catch (e: any) {
      console.error('handleSend error', e);
      Alert.alert('送信失敗', 'もう一度お試しください');
    } finally {
      setSending(false);
    }
  }, [currentUser, recipients, sending, activeId, profile.name, area, activity]);

  // ★ 「気分タブの再タップで待機を解除する」経路は廃止した。
  //   送信後の状態がローカル state だった頃は表示を戻すだけだったが、
  //   moods (Firestore) が真実になってからは closedAt を立てて
  //   送信そのものを終了させる操作になっていた。押した本人に自覚が無いまま
  //   取り消しが起きるうえ、待機画面に二度と戻れなくなる。
  //   取り消し機能は仕様として持たないため、route.params.resetAt ごと削除。

  // ★ 「かー」を受け取った時に mood を閉じる処理は廃止した。
  //   演出 (MatchOverlay) はあくまで「返事が来た」という通知であって、
  //   送信の寿命とは別物。演出を閉じたら送信も終わる、という結び付けを
  //   やめ、mood は 🍻 の締め表示として残るようにした。
  //   これに伴い WaitingResetContext は利用者が居なくなったため削除。

  // 待機解除 (4): 送信から3時間経過。
  //
  // 期限判定は useMyMood が mood.expiresAt と現在時刻の比較で行う。
  // 以前は setTimeout + AppState でローカルに測っていたが、
  // 期限そのものを Firestore に持たせたので、復帰時に再計算するだけで
  // 済むようになった (タイマーのズレを気にしなくてよい)。
  //
  // 「かー」が0件で期限切れ → 一言を出して締める。
  // 1件以上 → 締め表示を出し、ユーザーが閉じるまで残す (下の JSX)。

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
            // ★ ここでも待機を解除していたが、同じ理由で外した。
            //   気分の種類を見比べただけで送信が終了するのは事故になる。
            //   (現在は有効なアクティビティが1つでこの行自体が描画されないが、
            //    2つ目を有効にした瞬間に表面化するため先に直しておく)
            onChange={(id) => setActiveId(id)}
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
                {/* カウントダウンは期限まで止めずに動かす */}
                <Text style={styles.waitingCountdown}>
                  あと {formatRemaining(remainingMs)}
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
              ? '気分は3時間でリセットされます'
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

      {/*
        送信した気分の締め。2 つの終わり方で同じカードを使う。
        どちらも closedAt を入れるまで残るので、閉じずにアプリを
        終了しても次回起動時にまた出る。
      */}
      {mood && (
        <MoodClosingCard
          visible={phase === 'matched'}
          emoji="🍻"
          title={`${mood.reactionCount}人から「かー」が届きました`}
          sub="気分が合いましたね。あとは直接どうぞ。"
          // 1人返した後に別の友達が返す可能性があるため、
          // 締め表示に移った後も受付の残り時間を出し続ける。
          footer={
            remainingMs > 0
              ? `あと ${formatRemaining(remainingMs)} 受付中`
              : '受付は終了しました'
          }
          onClose={closeMood}
        />
      )}

      {/*
        3時間経過かつ「かー」0件。
        以前は 2.5 秒で自動的に消えるポップアップだったため、その瞬間に
        画面を見ていないと気づけず痕跡も残らなかった。返事があった時と
        同じカードに揃え、閉じるまで残す。
      */}
      {mood && (
        <MoodClosingCard
          visible={phase === 'expiredEmpty'}
          emoji="🍺"
          title="気分じゃないかも？"
          sub="今回は返事がありませんでした。またどうぞ。"
          onClose={closeMood}
        />
      )}

      <SendOverlay
        visible={overlay}
        onClose={() => setOverlay(false)}
        activityId={activity.id}
      />

      {/* 届く相手が0人だった場合。送信は行われず、待機状態にも入らない。 */}
      <WaitingExpiredNotice
        visible={noRecipients}
        onFinish={() => setNoRecipients(false)}
        message="いま気分の合う友達がいません"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  waitingCountdown: {
    marginTop: 6,
    fontSize: 13,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },

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
