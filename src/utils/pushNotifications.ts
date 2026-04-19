// プッシュ通知関連のユーティリティ
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

// フォアグラウンドで通知を受け取ったときの挙動
export function setupNotificationHandlers(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });

  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#E8391F',
    }).catch((e) => console.warn('setNotificationChannelAsync', e));
  }
}

// アプリ起動時: 通知権限取得 → Expo Push Token を Firestore に保存
export async function registerForPushNotifications(userId: string): Promise<void> {
  try {
    if (!Device.isDevice) {
      console.warn('シミュレーターではプッシュ通知を登録できません');
      return;
    }
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.warn('通知権限が許可されませんでした');
      return;
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    const tokenResult = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const fcmToken = tokenResult.data;
    if (fcmToken) {
      await setDoc(
        doc(db, 'users', userId),
        { fcmToken },
        { merge: true },
      );
    }
  } catch (e) {
    console.error('registerForPushNotifications error', e);
  }
}

// Expo Push API 経由で通知送信
export async function sendPushNotification(
  tokens: string[],
  title: string,
  body: string,
): Promise<void> {
  if (!tokens || tokens.length === 0) return;
  try {
    const messages = tokens
      .filter((t) => typeof t === 'string' && t.length > 0)
      .map((to) => ({
        to,
        sound: 'default',
        title,
        body,
        priority: 'high',
      }));
    if (messages.length === 0) return;

    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });
  } catch (e) {
    console.error('sendPushNotification error', e);
  }
}
