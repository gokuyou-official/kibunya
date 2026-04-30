// Firebase 初期化
//
// 設定値の出所:
//   - ローカル開発 (Expo Go / `npx expo start`): リポジトリ直下の `.env`
//     ファイルが Expo によって自動ロードされ process.env に展開される。
//     `EXPO_PUBLIC_` プレフィックスがついたものだけクライアントに渡る。
//   - EAS ビルド (preview / production): EAS Secrets に登録された値が
//     ビルド時に process.env に注入される。詳細は README §5「EAS Secrets
//     登録」を参照。
//
// このファイル自体には実値を書かない。.env / EAS Secrets を経由させる。
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

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
  // measurementId は任意 (Google Analytics 用)。RN 環境では未使用でも害なし。
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// 必須キーが空のままだと Firebase 側で 'auth/invalid-api-key' 等の
// 紛らわしいエラーになるため、明示的にコンソールへ警告を出す。
if (
  !firebaseConfig.apiKey ||
  !firebaseConfig.projectId ||
  !firebaseConfig.appId
) {
  // eslint-disable-next-line no-console
  console.error(
    '[firebase] EXPO_PUBLIC_FIREBASE_* 環境変数が未設定です。\n' +
      '  ローカル開発: リポジトリ直下の .env を確認 (例は .env.example)\n' +
      '  EAS ビルド  : `eas secret:list` で登録済みか確認',
  );
}

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
