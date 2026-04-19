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
} from 'firebase/firestore';
import { colors } from '../config/colors';
import { ActivityId, getActivity } from '../config/activities';
import { useAuth } from '../hooks/useAuth';
import { useFriends } from '../hooks/useFriends';
import { useProfile } from '../hooks/useProfile';
import { db } from '../config/firebase';
import { sendPushNotification } from '../utils/pushNotifications';
import SendOverlay from '../components/SendOverlay';
import ActivityTab from '../components/ActivityTab';
import FriendPill from '../components/FriendPill';

export default function HomeScreen({ navigation }: any) {
  const { currentUser } = useAuth();
  const { profile } = useProfile(currentUser?.uid);
  const { friends } = useFriends(currentUser?.uid);

  // アクティブタブ: interests 先頭をデフォルトに
  const [activeId, setActiveId] = useState<ActivityId | null>(null);
  useEffect(() => {
    if (!activeId && profile.interests.length > 0) {
      setActiveId(profile.interests[0]);
    }
    if (activeId && !profile.interests.includes(activeId)) {
      setActiveId(profile.interests[0] ?? null);
    }
  }, [profile.interests, activeId]);

  // 送信後の「待ちますかー」状態
  const [waiting, setWaiting] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const [sending, setSending] = useState(false);
  const [area, setArea] = useState('');

  const activity = useMemo(() => getActivity(activeId ?? 'drinking'), [activeId]);

  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => {
    Animated.spring(scale, { toValue: 0.97, friction: 5, useNativeDriver: true }).start();
  };
  const pressOut = () => {
    Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: true }).start();
  };

  const handleSend = useCallback(async () => {
    if (!currentUser || sending || !activeId) return;
    setSending(true);
    try {
      const myName = profile.name || 'フレンド';
      // 友達全員(興味に activeId を持つ人だけ受信する設計だが、
      // FCM送信時は全員にtoken送る。通知フィルタは受信側で useNotifications が担う)
      const tokens: string[] = [];
      for (const f of friends) {
        await addDoc(collection(db, 'notifications'), {
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
        if (f.fcmToken) tokens.push(f.fcmToken);
      }
      if (tokens.length > 0) {
        const body = area.trim()
          ? `${myName}さんが${activity.label}の気分(${area.trim()})${activity.waitEmoji}`
          : `${myName}さんが${activity.label}の気分${activity.waitEmoji}`;
        await sendPushNotification(tokens, 'KIBUNYA', body);
      }
      setOverlay(true);
      setWaiting(true);
    } catch (e: any) {
      console.error('handleSend error', e);
      Alert.alert('送信失敗', 'もう一度お試しください');
    } finally {
      setSending(false);
    }
  }, [currentUser, friends, sending, activeId, profile.name, area, activity]);

  const cancelWaiting = () => {
    setWaiting(false);
  };

  // 興味が未設定の場合
  if (profile.interests.length === 0) {
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

      <View style={styles.tabRow}>
        <ActivityTab
          availableIds={profile.interests}
          activeId={activeId}
          onChange={(id) => {
            setActiveId(id);
            setWaiting(false);
          }}
        />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.center}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.emojiBox}>
            <Text style={styles.emoji}>{activity.waitEmoji}</Text>
          </View>

          <Text style={styles.title}>
            {waiting ? '待ちますかー' : activity.sendCopy}
          </Text>
          <Text style={styles.caption}>{activity.waitCopy}</Text>

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

          <Animated.View style={{ transform: [{ scale }], width: '100%', maxWidth: 320 }}>
            {waiting ? (
              <Pressable
                onPress={cancelWaiting}
                style={({ pressed }) => [
                  styles.ctaWaiting,
                  pressed && { opacity: 0.9 },
                ]}
              >
                <Text style={styles.ctaWaitingText}>
                  待ちますかー {activity.waitEmoji}
                </Text>
                <Text style={styles.ctaWaitingSub}>タップでキャンセル</Text>
              </Pressable>
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
              ? '友達の「かー」を待ってます'
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
              ) : (
                friends.map((f) => (
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
  emoji: { fontSize: 72 },
  title: {
    fontSize: 22,
    color: colors.cream,
    fontWeight: '600',
  },
  caption: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
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
  ctaWaiting: {
    backgroundColor: colors.yamabuki,
    paddingVertical: 20,
    borderRadius: 20,
    alignItems: 'center',
  },
  ctaWaitingText: {
    color: colors.ai,
    fontSize: 18,
    fontWeight: '700',
  },
  ctaWaitingSub: {
    color: 'rgba(26,46,85,0.65)',
    fontSize: 11,
    marginTop: 2,
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
