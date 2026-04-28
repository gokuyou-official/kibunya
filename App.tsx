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
import { db } from './src/config/firebase';
import { useAuth } from './src/hooks/useAuth';
import { useNotifications } from './src/hooks/useNotifications';
import { useProfile } from './src/hooks/useProfile';
import {
  registerForPushNotifications,
  setupNotificationHandlers,
} from './src/utils/pushNotifications';
import { handleInviteLink } from './src/utils/inviteLink';
import { getEnabledActivityIds } from './src/config/activities';

import OnboardingScreen from './src/screens/OnboardingScreen';
import HomeScreen from './src/screens/HomeScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import FriendsScreen from './src/screens/FriendsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import InterestSelectionScreen from './src/screens/InterestSelectionScreen';

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

  useEffect(() => {
    if (!currentUser) return;

    registerForPushNotifications(currentUser.uid);

    Linking.getInitialURL().then((url) => {
      if (url) handleInviteLink(url, currentUser.uid);
    });
    const sub = Linking.addEventListener('url', ({ url }) => {
      handleInviteLink(url, currentUser.uid);
    });
    return () => sub.remove();
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
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Root />
    </SafeAreaProvider>
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
