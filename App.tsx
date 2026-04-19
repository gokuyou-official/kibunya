// キブンヤ エントリーポイント(v2: 興味ベースゲート + プロフィールタブ)
import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet, AppState } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import { Text } from 'react-native';
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

import OnboardingScreen from './src/screens/OnboardingScreen';
import HomeScreen from './src/screens/HomeScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import FriendsScreen from './src/screens/FriendsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import InterestSelectionScreen from './src/screens/InterestSelectionScreen';

const Tab = createBottomTabNavigator();

const linking = {
  prefixes: [Linking.createURL('/'), 'kibunya://'],
  config: {
    screens: {
      Home: 'home',
      Notifications: 'notifications',
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
  const { profile, loading: profileLoading } = useProfile(currentUser?.uid);

  useEffect(() => {
    setupNotificationHandlers();
  }, []);

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

  // 興味未選択ならゲート
  if (profile.interests.length === 0) {
    return <InterestSelectionScreen />;
  }

  return (
    <NavigationContainer linking={linking}>
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
});
