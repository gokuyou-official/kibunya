// Firebase 初期化
// 注意: 実際の設定値は `firebase apps:sdkconfig` で取得後、
// 環境変数 or Constants.expoConfig.extra に入れて差し替えてください。
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeAuth,
  getAuth,
  // @ts-ignore react-native permanence helper
  getReactNativePersistence,
  type Auth,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// firebase apps:sdkconfig で取得した値をここに入れる
// 本番では Constants.expoConfig?.extra?.firebase などから読む想定
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? 'REPLACE_ME',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'kibunya-app.firebaseapp.com',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'kibunya-app',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'kibunya-app.appspot.com',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? 'REPLACE_ME',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? 'REPLACE_ME',
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// React Native では AsyncStorage で永続化
let auth: Auth;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  auth = getAuth(app);
}

const db = getFirestore(app);

export { app, auth, db };
