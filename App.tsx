// force rebuild 2026-06-10
// キブンヤ エントリーポイント(v2: 興味ベースゲート + プロフィールタブ)
import 'react-native-gesture-handler';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet, AppState } from 'react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

import { colors } from './src/config/colors';
import { db, initError as firebaseInitError } from './src/config/firebase';
import { useAuth } from './src/hooks/useAuth';
import { useNotifications, cleanupOldNotifications } from './src/hooks/useNotifications';
import { useProfile } from './src/hooks/useProfile';
import { useMatchEvents } from './src/hooks/useMatchEvents';
import {
  registerForPushNotifications,
  setupNotificationHandlers,
} from './src/utils/pushNotifications';
import {
  handleInviteLink,
  extractFriendIdFromUrl,
} from './src/utils/inviteLink';
import {
  savePendingInvite,
  takePendingInvite,
  clearPendingInvite,
} from './src/utils/pendingInvite';
import { WaitingResetProvider } from './src/contexts/WaitingResetContext';
import { getEnabledActivityIds } from './src/config/activities';

import OnboardingScreen from './src/screens/OnboardingScreen';
import HomeScreen from './src/screens/HomeScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import FriendsScreen from './src/screens/FriendsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import InterestSelectionScreen from './src/screens/InterestSelectionScreen';
import NameInputScreen from './src/screens/NameInputScreen';
import MatchOverlay from './src/components/MatchOverlay';

const Tab = createBottomTabNavigator();

// プッシュ通知タップから NavigationContainer の外でナビゲーションを呼ぶための ref
export const navigationRef = createNavigationContainerRef();

function navigateToNotifications(highlightId?: string) {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('Notifications' as never, (highlightId ? { highlightId } : undefined) as never);
}

const linking = {
  prefixes: [Linking.createURL('/'), 'kibunya://'],
  config: {
    screens: {
      Home: 'home',
      Notifications: {
        path: 'notifications',
        parse: { highlightId: (v: string) => v },
      },
      Friends: 'friends',
      Profile: 'profile',
    },
  },
};

function MainTabs() {
  const { currentUser } = useAuth();
  const { profile } = useProfile(currentUser?.uid);
  const { unreadCount } = useNotifications(currentUser?.uid, profile.interests);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.aiDeep,
          borderTopColor: colors.cardBorder,
          borderTopWidth: 1,
          height: 70,
          paddingBottom: 10,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.yamabuki,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        // ★ かつてここに tabPress リスナーがあり、気分タブの再タップを
        //   「待機状態のリセット」として HomeScreen に伝えていた。
        //   送信後の状態がローカル state だった頃は見た目を戻すだけの
        //   操作だったが、moods (Firestore) が真実になった今は
        //   closedAt を立てて送信そのものを終了させる操作に変質し、
        //   待機画面へ二度と戻れなくなっていた。
        //   取り消し機能は仕様として持たないため、リスナーごと削除した。
        //   待機の終了経路は「かー」受信 / 3時間経過 / 締め表示を閉じる の3つ。
        options={{
          title: '気分',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: focused ? 22 : 20 }}>🍺</Text>
          ),
        }}
      />
      <Tab.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{
          title: 'アラート',
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: focused ? 22 : 20 }}>🔔</Text>
          ),
        }}
      />
      <Tab.Screen
        name="Friends"
        component={FriendsScreen}
        options={{
          title: 'フレンド',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: focused ? 22 : 20 }}>👥</Text>
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          title: 'プロフィール',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: focused ? 22 : 20 }}>👤</Text>
          ),
        }}
      />
    </Tab.Navigator>
  );
}

function Root() {
  const { currentUser, loading } = useAuth();
  const { profile, loading: profileLoading, setInterests } = useProfile(currentUser?.uid);
  // マッチ後オーバーレイ用イベントキュー (Issue #4)
  // ナビゲーションツリー外で render するため Root に保持し、
  // どのタブ/画面にいてもグローバルに重ねて表示できるようにする。
  const { current: matchEvent, dismiss: dismissMatch } = useMatchEvents(currentUser?.uid);

  // 「かー」を受け取ったら HomeScreen の待機状態を解除する。
  // 祝祭演出が出ているのに裏で「友達の「かー」を待ってます」が
  // 残り続けるのはちぐはぐなため。
  // dismiss ではなく検知の時点で解除しておくことで、演出を閉じて
  // HomeScreen が見えた瞬間には既に「いきますかー」が押せる状態になる
  // (閉じた後に表示が切り替わるチラつきを避ける)。
  const [waitingResetToken, setWaitingResetToken] = useState(0);
  const matchEventId = matchEvent?.id;
  useEffect(() => {
    if (!matchEventId) return;
    setWaitingResetToken((n) => n + 1);
  }, [matchEventId]);
  // コールドスタート時に取得した通知タップ情報を保持。
  // ナビゲーション準備が整い次第アラートタブに遷移する。
  const pendingNavRef = useRef<{ notificationId?: string } | null>(null);

  useEffect(() => {
    setupNotificationHandlers();
  }, []);

  // プッシュ通知タップ → アラートタブへ遷移
  useEffect(() => {
    // バックグラウンド/フォアグラウンドからのタップ
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response?.notification?.request?.content?.data ?? {};
      const notificationId =
        typeof data?.notificationId === 'string' ? data.notificationId : undefined;
      if (navigationRef.isReady()) {
        navigateToNotifications(notificationId);
      } else {
        pendingNavRef.current = { notificationId };
      }
    });

    // コールドスタート: アプリが通知タップで起動された場合
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification?.request?.content?.data ?? {};
      const notificationId =
        typeof data?.notificationId === 'string' ? data.notificationId : undefined;
      pendingNavRef.current = { notificationId };
    });

    return () => sub.remove();
  }, []);

  // MVP: enabled なアクティビティが1つだけのとき、interests と enabled の積集合 (visibleIds)
  // が空のユーザーは InterestSelectionScreen を経由せず自動で初期化する。
  // 単純な interests.length === 0 だと、過去に4アクティビティ全有効時代に登録した
  // レガシーユーザー (interests=['sauna','lunch'] 等) が拾えず HomeScreen で
  // 行き詰まるため、visibleIds で判定する。
  // (v1.1 で enabled が複数になれば自動で従来のゲートが復活する)
  const enabledIds = useMemo(() => getEnabledActivityIds(), []);
  const visibleIds = useMemo(
    () => profile.interests.filter((id) => enabledIds.includes(id)),
    [profile.interests, enabledIds],
  );

  // 自動初期化のリトライ管理: Firestore 書き込み失敗時にスピナーが永遠に
  // 回り続けるのを防ぐ。3秒以内に visibleIds が埋まらない / Promise が
  // reject された場合はエラー画面に遷移し、再試行ボタンを提示する。
  // 3回連続失敗したら InterestSelectionScreen にフォールバック。
  const INIT_TIMEOUT_MS = 3000;
  const MAX_INIT_ATTEMPTS = 3;
  const [initAttempt, setInitAttempt] = useState(0);
  const [initError, setInitError] = useState(false);

  const triggerInit = useCallback(() => {
    setInitError(false);
    setInitAttempt((n) => n + 1);
    setInterests(enabledIds).catch((e) => {
      console.warn('auto-init interests failed', e);
      setInitError(true);
    });
  }, [setInterests, enabledIds]);

  // 初回トリガー: 条件を満たし、まだ試行していない場合のみ実行
  useEffect(() => {
    if (!currentUser || profileLoading) return;
    if (enabledIds.length !== 1) return;
    if (visibleIds.length > 0) return;
    if (initAttempt > 0) return;
    triggerInit();
  }, [
    currentUser,
    profileLoading,
    enabledIds.length,
    visibleIds.length,
    initAttempt,
    triggerInit,
  ]);

  // タイムアウト検知: 試行中なのに INIT_TIMEOUT_MS 経過しても visibleIds が
  // 埋まらない場合、Firestore リスナー反映遅延 or 書き込み失敗とみなしエラー化
  useEffect(() => {
    if (initAttempt === 0 || initError) return;
    if (visibleIds.length > 0) return;
    const t = setTimeout(() => setInitError(true), INIT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [initAttempt, initError, visibleIds.length]);

  // 未ログイン中に踏まれた招待リンクの退避。
  //
  // ★ この購読は currentUser の有無に関係なく常時張る。
  //   以前は下の useEffect (currentUser 必須) だけで購読していたため、
  //   ログアウト状態で踏んだ 'url' イベントを受け取る先が無く、uid が
  //   永久に失われていた。インストール直後はまさにこの状態になる。
  //
  // 保存するだけで友達追加はしない。実際の処理はログイン後に下の
  // useEffect が takePendingInvite() で拾って行う。
  useEffect(() => {
    if (currentUser) return; // ログイン中は下の本処理が直接さばく

    const stash = (url: string | null) => {
      if (!url) return;
      const uid = extractFriendIdFromUrl(url);
      if (uid) savePendingInvite(uid);
    };

    Linking.getInitialURL().then(stash);
    const sub = Linking.addEventListener('url', ({ url }) => stash(url));
    return () => sub.remove();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;

    // 7 日以上前の自分宛アラートを一括削除 (起動 / ログイン直後に 1 回)。
    // 失敗してもサイレント (関数内で console.warn のみ、本フローは止めない)。
    cleanupOldNotifications(currentUser.uid);

    registerForPushNotifications(currentUser.uid);

    let cancelled = false;

    // ★ 起動時の二重処理よけ。
    //   コールドスタートで招待リンクから起動した場合、
    //     - 未ログイン時の退避 (savePendingInvite)
    //     - こちらの getInitialURL()
    //   が同じ uid を指す。素直に両方処理すると
    //   「友達になりました」が 2 回出る。
    //   起動時に処理した uid を 1 つだけ覚えて弾く。
    //   実行中に届く 'url' イベントは対象外 (踏み直しには毎回反応させる)。
    let startupUid: string | null = null;
    const handleOnce = (url: string) => {
      const uid = extractFriendIdFromUrl(url);
      if (uid && startupUid === uid) return;
      if (uid) startupUid = uid;
      handleInviteLink(url, currentUser.uid);
    };

    // ログイン/サインアップ完了時に、未ログイン中へ退避しておいた招待を消化する。
    // 24 時間を過ぎたものは takePendingInvite が null を返して破棄する
    // (古い招待が突然発火して混乱するのを防ぐため)。
    //
    // 取り出せた時点で削除する。ここで消さずに handleInviteLink の成否で
    // 分岐すると、失敗時に毎起動リトライして同じアラートが出続ける。
    // 踏み直してもらう方が挙動として素直。
    //
    // getInitialURL より先に消化する。逆順だと上の二重処理よけが効かない。
    takePendingInvite()
      .then((pendingUid) => {
        if (cancelled) return;
        if (pendingUid) {
          clearPendingInvite();
          // handleInviteLink は URL を受け取るので uid から組み立てる。
          handleOnce(`kibunya://invite/${pendingUid}`);
        }
        return Linking.getInitialURL();
      })
      .then((url) => {
        if (cancelled || !url) return;
        handleOnce(url);
      });

    const sub = Linking.addEventListener('url', ({ url }) => {
      handleInviteLink(url, currentUser.uid);
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const updateLastSeen = () => {
      setDoc(
        doc(db, 'users', currentUser.uid),
        { lastSeen: serverTimestamp() },
        { merge: true },
      ).catch((e) => console.warn('lastSeen update error', e));
    };
    updateLastSeen();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') updateLastSeen();
    });
    const interval = setInterval(updateLastSeen, 2 * 60 * 1000);
    return () => {
      sub.remove();
      clearInterval(interval);
    };
  }, [currentUser]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.shu} />
      </View>
    );
  }

  if (!currentUser) {
    return <OnboardingScreen />;
  }

  // 認証済みでプロフィール読み込み中
  if (profileLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.shu} />
      </View>
    );
  }

  // 名前が空のレガシーユーザー救済ゲート。
  // 旧ビルド (名前入力欄なし) で登録したユーザーや、Apple sign-in で
  // fullName が取れなかったユーザーの users/{uid}.name が空文字 or
  // 'ゲスト' になっており、フレンド名や通知の送信者名で 'フレンド'
  // フォールバックが連発する。アプリ起動時にここで強制入力させる。
  // ユーザーが NameInputScreen で保存すると profile.name が更新され
  // この gate を抜けて次のステップに進む。
  {
    const trimmedName = (profile.name ?? '').trim();
    if (!trimmedName || trimmedName === 'ゲスト') {
      return <NameInputScreen />;
    }
  }

  // 表示可能なアクティビティが無いならゲート。enabled が1つの場合は
  // 上の useEffect が自動で interests を埋めるため、ここではローディング表示を出す。
  // (interests に無効化済みアクティビティしか入っていないレガシーユーザーも
  //  visibleIds=[] となり同じ自動初期化フローに乗る)
  if (visibleIds.length === 0) {
    if (enabledIds.length === 1) {
      // 3回連続失敗したら最終救済として InterestSelectionScreen に強制フォールバック
      // (Firestore 書き込み権限の問題等で自動初期化が継続的に失敗するケース)
      if (initError && initAttempt >= MAX_INIT_ATTEMPTS) {
        return <InterestSelectionScreen />;
      }
      if (initError) {
        return (
          <View style={styles.errorScreen}>
            <Text style={styles.errorEmoji}>⚠️</Text>
            <Text style={styles.errorTitle}>初期化に失敗しました</Text>
            <Text style={styles.errorSub}>
              通信状況をご確認のうえ、再試行してください。
            </Text>
            <Pressable
              onPress={triggerInit}
              style={({ pressed }) => [
                styles.retryBtn,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.retryText}>もう一度試す</Text>
            </Pressable>
            <Text style={styles.errorAttempt}>
              試行 {initAttempt} / {MAX_INIT_ATTEMPTS}
            </Text>
          </View>
        );
      }
      return (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.shu} />
        </View>
      );
    }
    return <InterestSelectionScreen />;
  }

  return (
    <WaitingResetProvider resetToken={waitingResetToken}>
      <NavigationContainer
        ref={navigationRef}
        linking={linking}
        onReady={() => {
          // コールドスタートで pending な通知タップがあれば反映
          const pending = pendingNavRef.current;
          if (pending) {
            pendingNavRef.current = null;
            navigateToNotifications(pending.notificationId);
          }
        }}
      >
        <MainTabs />
      </NavigationContainer>
      {/*
        MatchOverlay はナビゲーションツリーの外に置く。
        どのタブにいても重ねて表示でき、画面遷移の影響を受けない。
        useMatchEvents が dedup 済みのキューを返すため、ここでは
        current を visible に流すだけ。
      */}
      {/*
        key にイベント ID を渡し、queue 内で次イベントに切り替わる時に
        MatchOverlay を unmount/remount させる。これにより内部の
        useEffect (enter animation 初期化) が確実に再実行され、
        backdropOpacity 等の Animated.Value が前イベントの値で stuck
        するバグを根本的に防ぐ。
      */}
      <MatchOverlay
        key={matchEvent?.id ?? 'none'}
        visible={!!matchEvent}
        senderName={matchEvent?.senderName ?? ''}
        activityId={matchEvent?.activity ?? 'drinking'}
        onClose={dismissMatch}
      />
    </WaitingResetProvider>
  );
}

// React レンダリング中の例外を必ず可視化するための Error Boundary。
// 既存の styles に依存せず inline スタイルで自己完結させ、colors の
// import が壊れていてもエラー画面が表示できるようにする。
class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: any) {
    // eslint-disable-next-line no-console
    console.error('[AppErrorBoundary]', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <View
          style={{
            flex: 1,
            backgroundColor: '#1A2E55',
            paddingHorizontal: 24,
            paddingTop: 80,
            paddingBottom: 40,
          }}
        >
          <Text style={{ color: '#FFF9EC', fontSize: 22, fontWeight: '700', marginBottom: 8 }}>
            ⚠️ アプリでエラー
          </Text>
          <Text style={{ color: '#F5C518', fontSize: 14, marginBottom: 16 }}>
            起動中に問題が発生しました
          </Text>
          <Text style={{ color: '#FFF9EC', fontSize: 14, marginBottom: 12 }}>
            {String(this.state.error.message ?? this.state.error)}
          </Text>
          <Text style={{ color: 'rgba(255,249,236,0.55)', fontSize: 10, fontFamily: 'Courier' }}>
            {String(this.state.error.stack ?? '').slice(0, 1500)}
          </Text>
        </View>
      );
    }
    return this.props.children as any;
  }
}

export default function App() {
  // Firebase 初期化エラーがあれば、Root より前にエラー画面を出す。
  // (Root の中で hooks (useAuth etc.) が auth/db を触る前に止める)
  if (firebaseInitError) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <View
          style={{
            flex: 1,
            backgroundColor: '#1A2E55',
            paddingHorizontal: 24,
            paddingTop: 80,
          }}
        >
          <Text style={{ color: '#FFF9EC', fontSize: 22, fontWeight: '700', marginBottom: 8 }}>
            ⚠️ 初期化に失敗しました
          </Text>
          <Text style={{ color: '#FFF9EC', fontSize: 14 }}>
            {String(firebaseInitError.message)}
          </Text>
        </View>
      </SafeAreaProvider>
    );
  }
  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Root />
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.ai,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorScreen: {
    flex: 1,
    backgroundColor: colors.ai,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 10,
  },
  errorEmoji: {
    fontSize: 56,
    marginBottom: 4,
  },
  errorTitle: {
    fontSize: 18,
    color: colors.cream,
    fontWeight: '600',
  },
  errorSub: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryBtn: {
    backgroundColor: colors.shu,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 16,
  },
  retryText: {
    color: colors.cream,
    fontWeight: '600',
    fontSize: 15,
  },
  errorAttempt: {
    fontSize: 11,
    color: colors.textLight,
    marginTop: 8,
  },
});
