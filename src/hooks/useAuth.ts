// 認証状態を管理するフック
import { useEffect, useState, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  signInWithCredential,
  sendPasswordResetEmail,
  fetchSignInMethodsForEmail,
  OAuthProvider,
  User,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import * as AppleAuthentication from 'expo-apple-authentication';
import { sha256 } from 'js-sha256';
import { auth, db } from '../config/firebase';
import { generateRawNonce } from '../utils/authNonce';

// Apple Sign-In + Firebase Auth の正しい連携:
//   1. クライアントでランダム raw nonce を生成
//   2. raw を SHA-256 で hash し、Apple へ `nonce` として渡す
//   3. Apple は identityToken の nonce claim に hash を埋め込んで返す
//   4. Firebase へ raw nonce を `rawNonce` として渡す
//      → Firebase が rawNonce を SHA-256 して identityToken の nonce と
//        一致するか検証する
//
// nonce を渡さずに rawNonce: undefined だけにすると、Apple が自動生成した
// nonce hash を identityToken に含めた場合に Firebase 側で検証失敗
// (特に新規アカウント作成時に厳しい) を引き起こす可能性がある。

// エラーオブジェクトから安全に構造化情報を抜く。
// TestFlight ではログが見えないので、最低限の構造を console に流して
// Crashlytics/Sentry を後から入れた時に解析可能な形を保つ。
function logAuthError(tag: string, e: any) {
  // eslint-disable-next-line no-console
  console.error(`[auth] ${tag}`, {
    code: e?.code ?? null,
    name: e?.name ?? null,
    message: typeof e?.message === 'string' ? e.message : String(e),
  });
}

export function useAuth() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setLoading(false);
    });
    return unsub;
  }, []);

  // ユーザードキュメントを作成/更新
  //
  // ⚠️ 重要: Firestore の `{ merge: true }` は「書いたフィールドは上書き、
  // 書かなかったフィールドのみ保持」という意味。空値で明示的に書くと
  // 既存値も空値で上書きされる。
  //
  // ログインのたびに name='ゲスト' / area='' / bio='' / interests=[] と
  // 書き込むと、ユーザーが編集済みの値が初期化されてしまう (実際これが
  // 起きていた)。
  //
  // 対策: getDoc で既存性を確認し、
  //  - 新規ユーザー: 全フィールド初期値で create
  //  - 既存ユーザー: lastSeen のみ更新 (ユーザー編集値は触らない)
  const upsertUserDoc = useCallback(async (user: User, name?: string) => {
    try {
      const ref = doc(db, 'users', user.uid);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        // 新規ユーザー: 全フィールド初期化して保存
        // ⚠️ name は `??` ではなく `||` で chain。空文字を素通しさせない。
        const safeName =
          (typeof name === 'string' && name.trim()) ||
          user.displayName ||
          'ゲスト';
        await setDoc(ref, {
          name: safeName,
          email: user.email ?? '',
          area: '',
          bio: '',
          interests: [],
          createdAt: serverTimestamp(),
          lastSeen: serverTimestamp(),
        });
      } else {
        // 既存ユーザー: lastSeen のみ更新。ユーザー編集済の
        // name / area / bio / interests は絶対に触らない。
        await setDoc(
          ref,
          { lastSeen: serverTimestamp() },
          { merge: true },
        );
      }
    } catch (e) {
      console.warn('upsertUserDoc error', e);
    }
  }, []);

  // Appleでログイン
  const signInWithApple = useCallback(async () => {
    try {
      const available = await AppleAuthentication.isAvailableAsync();
      if (!available) {
        throw new Error('この端末ではAppleサインインが使えません');
      }
      // Apple へは hash 済 nonce、Firebase へは raw nonce を渡す。
      // これが Firebase 公式推奨フロー (新規アカウント作成時の nonce 検証失敗を防ぐ)。
      const rawNonce = generateRawNonce();
      const hashedNonce = sha256(rawNonce);
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });
      if (!credential.identityToken) {
        throw new Error('Appleからトークンが取得できませんでした');
      }
      const provider = new OAuthProvider('apple.com');
      const fbCred = provider.credential({
        idToken: credential.identityToken,
        rawNonce,
      });
      const result = await signInWithCredential(auth, fbCred);
      const fullName = credential.fullName
        ? [credential.fullName.familyName, credential.fullName.givenName]
            .filter(Boolean)
            .join(' ')
        : undefined;
      // ⚠️ ここで await すると Firestore (upsertUserDoc) のエラーが
      // ログイン失敗として表面化し、Face ID 成功直後に一瞬「ログイン失敗」
      // が点滅する。Firebase 認証自体は成功しているので非同期で投げ捨てる。
      upsertUserDoc(result.user, fullName).catch((err) =>
        console.warn('upsertUserDoc (background) failed', err),
      );
      return result.user;
    } catch (e: any) {
      const code = e?.code;
      const msg = String(e?.message ?? '').toLowerCase();
      // Cancel 系: Alert を出さないため null を返す。
      // 公式は ERR_REQUEST_CANCELED のみだが端末・OS 差で別コードや
      // message-only でも来るため広めに拾う (誤検知より誤Alertの方が悪い)。
      if (
        code === 'ERR_REQUEST_CANCELED' ||
        code === 'ERR_CANCELED' ||
        code === 'ERR_REQUEST_NOT_HANDLED' ||
        msg.includes('cancel')
      ) {
        return null;
      }
      // Firebase auth が既に通っている場合は後段エラーを無視。
      // 「ログイン成功 → 後段で何か失敗 → Alert フラッシュ → 画面遷移」
      // の不快な点滅を防ぐ。
      if (auth.currentUser) {
        console.warn('signInWithApple: post-auth error ignored', e);
        return auth.currentUser;
      }
      logAuthError('signInWithApple', e);
      throw e;
    }
  }, [upsertUserDoc]);

  // メール+パスワード ログイン (アカウントが無ければ失敗)
  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      try {
        const result = await signInWithEmailAndPassword(auth, email, password);
        await upsertUserDoc(result.user);
        return result.user;
      } catch (e: any) {
        logAuthError('signInWithEmail', e);
        throw e;
      }
    },
    [upsertUserDoc],
  );

  // メール+パスワード 新規登録
  // name を必須にして upsertUserDoc に渡す。これがないと users/{uid}.name が
  // 'ゲスト' になり、自分の名前と送信通知の senderName が "ゲスト" 固定になる。
  const signUpWithEmail = useCallback(
    async (email: string, password: string, name: string) => {
      try {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        await upsertUserDoc(result.user, name.trim());
        return result.user;
      } catch (e: any) {
        logAuthError('signUpWithEmail', e);
        throw e;
      }
    },
    [upsertUserDoc],
  );

  // パスワードリセットメール送信。
  // 成功/失敗は呼び出し側で Alert に出す。Firebase は存在しないメールでも
  // 成功扱いになる場合があるが (email enumeration protection)、
  // ユーザーに「届かない」と伝えるのは UX を悪化させるため、API 成功なら
  // 同じ「送信しました」表示で統一する。
  const sendPasswordReset = useCallback(async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (e: any) {
      logAuthError('sendPasswordReset', e);
      throw e;
    }
  }, []);

  // 指定 email に紐付いている sign-in provider 一覧を取得。
  // ログイン失敗時に「Apple アカウントです」案内を出す等の補助に使う。
  // Firebase の email enumeration protection が ON だと空配列が返るので、
  // 呼び出し側は「空配列 = 判定不能」として扱うこと。
  const getSignInMethodsForEmail = useCallback(
    async (email: string): Promise<string[]> => {
      try {
        return await fetchSignInMethodsForEmail(auth, email);
      } catch (e: any) {
        logAuthError('getSignInMethodsForEmail', e);
        return [];
      }
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      await fbSignOut(auth);
    } catch (e: any) {
      logAuthError('signOut', e);
      throw e;
    }
  }, []);

  return {
    currentUser,
    loading,
    signInWithApple,
    signInWithEmail,
    signUpWithEmail,
    sendPasswordReset,
    getSignInMethodsForEmail,
    signOut,
  };
}
