// Firebase 初期化
//
// 設定値ポリシー:
//   - 1次: process.env.EXPO_PUBLIC_FIREBASE_* (EAS Secrets / .env 経由)
//   - 2次 (fallback): 下記の実値ハードコード
//
// 既存の EAS Secrets / .env が未設定の場合でも production ビルドが動くよう、
// Firebase Web SDK の config をハードコード fallback で持たせている。
//
// セキュリティ補足: Firebase Web SDK の apiKey は公開前提で設計されている
// (実態は project identifier。データアクセス制御は firestore.rules で行う)。
// このため git 履歴に残しても直接的なセキュリティ実害は無い。key rotation
// したい場合は EAS Secrets / .env を上書きすれば 1 次優先で採用される。
//
// 旧 missingKeys ガードは fallback が常に値を返す前提となったため除去した。
// initializeApp 自体の異常系は try/catch で握り initError として上位に伝える
// 仕組みは維持 (App.tsx Root で firebaseInitError をチェック)。
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  initializeAuth,
  getAuth,
  // @ts-ignore react-native permanence helper
  getReactNativePersistence,
  type Auth,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey:
    process.env.EXPO_PUBLIC_FIREBASE_API_KEY ||
    'AIzaSyAUbgIu2bsYHsUreMBHhgXK0yGx2negtF8',
  authDomain:
    process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ||
    'kibunyapjt.firebaseapp.com',
  projectId:
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'kibunyapjt',
  storageBucket:
    process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    'kibunyapjt.firebasestorage.app',
  messagingSenderId:
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '726312004432',
  appId:
    process.env.EXPO_PUBLIC_FIREBASE_APP_ID ||
    '1:726312004432:web:db070d6ba4841cd9019a55',
  measurementId:
    process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID || 'G-WVHCNJJK2H',
};

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;
let _db: Firestore | null = null;
let _initError: Error | null = null;

try {
  _app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  try {
    _auth = initializeAuth(_app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    _auth = getAuth(_app);
  }
  _db = getFirestore(_app);
} catch (e: any) {
  _initError = e instanceof Error ? e : new Error(String(e));
  // eslint-disable-next-line no-console
  console.error('[firebase] initialization failed:', _initError.message);
}

// App.tsx Root で initError チェックが行われている前提で non-null 型で export。
// fallback により実際には initError は通常 null。
export const app = _app as FirebaseApp;
export const auth = _auth as Auth;
export const db = _db as Firestore;
export const initError = _initError;
