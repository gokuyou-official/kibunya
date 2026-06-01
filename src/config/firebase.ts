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
//
// ⚠️ 重要: 設定値が欠落していると Firebase Web SDK の initializeApp が
// 同期 throw する。その例外を module-level で受けないと App.tsx の import
// チェーンごと evaluate に失敗し、React がマウントできずホワイトアウト
// する。そのため try/catch で握り、初期化失敗を initError として export し、
// 上位 (App.tsx Root) で可視エラー画面に切り替えられるようにする。
//
// 利用側の契約: App.tsx Root で initError をチェックし、null でなければ
// 早期 return でエラー画面を出すこと。これが守られている限り、後段で
// app/auth/db が non-null として扱われても実害は無い。
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
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
  // measurementId は任意 (Google Analytics 用)。RN 環境では未使用でも害なし。
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const missingKeys: string[] = [];
if (!firebaseConfig.apiKey) missingKeys.push('EXPO_PUBLIC_FIREBASE_API_KEY');
if (!firebaseConfig.projectId) missingKeys.push('EXPO_PUBLIC_FIREBASE_PROJECT_ID');
if (!firebaseConfig.appId) missingKeys.push('EXPO_PUBLIC_FIREBASE_APP_ID');

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;
let _db: Firestore | null = null;
let _initError: Error | null = null;

if (missingKeys.length > 0) {
  // 早期に空キーを検知した場合は initializeApp を呼ばない (空 apiKey で
  // 呼ぶと Firebase が同期 throw するため、こちらで明示エラーに変える)
  _initError = new Error(
    `Firebase 設定の必須キーが未設定です: ${missingKeys.join(', ')}\n` +
      `EAS ビルド: EAS Secrets を確認 (\`eas secret:list --scope project\`)\n` +
      `ローカル開発: .env を確認 (例は .env.example)`,
  );
  // eslint-disable-next-line no-console
  console.error('[firebase]', _initError.message);
} else {
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
}

// 利用側の契約 (App.tsx Root で initError チェックが行われている前提) のため、
// app/auth/db は non-null 型で export する。万一契約が破られた場合は runtime
// で null 参照例外が発生する。
export const app = _app as FirebaseApp;
export const auth = _auth as Auth;
export const db = _db as Firestore;
export const initError = _initError;
