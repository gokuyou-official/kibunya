// 認証状態を管理するフック
import { useEffect, useState, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  signInWithCredential,
  OAuthProvider,
  User,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import * as AppleAuthentication from 'expo-apple-authentication';
import { auth, db } from '../config/firebase';

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
        await setDoc(ref, {
          name: name ?? user.displayName ?? 'ゲスト',
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
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) {
        throw new Error('Appleからトークンが取得できませんでした');
      }
      const provider = new OAuthProvider('apple.com');
      const fbCred = provider.credential({
        idToken: credential.identityToken,
        rawNonce: undefined,
      });
      const result = await signInWithCredential(auth, fbCred);
      const fullName = credential.fullName
        ? [credential.fullName.familyName, credential.fullName.givenName]
            .filter(Boolean)
            .join(' ')
        : undefined;
      await upsertUserDoc(result.user, fullName);
      return result.user;
    } catch (e: any) {
      if (e?.code === 'ERR_REQUEST_CANCELED') return null;
      console.error('signInWithApple error', e);
      throw e;
    }
  }, [upsertUserDoc]);

  // メール+パスワード ログイン/新規
  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      try {
        const result = await signInWithEmailAndPassword(auth, email, password);
        await upsertUserDoc(result.user);
        return result.user;
      } catch (e: any) {
        // 存在しない場合は新規作成にフォールバック
        if (
          e?.code === 'auth/user-not-found' ||
          e?.code === 'auth/invalid-credential'
        ) {
          const result = await createUserWithEmailAndPassword(auth, email, password);
          await upsertUserDoc(result.user);
          return result.user;
        }
        throw e;
      }
    },
    [upsertUserDoc],
  );

  const signOut = useCallback(async () => {
    try {
      await fbSignOut(auth);
    } catch (e) {
      console.error('signOut error', e);
      throw e;
    }
  }, []);

  return {
    currentUser,
    loading,
    signInWithApple,
    signInWithEmail,
    signOut,
  };
}
