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
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
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
  const upsertUserDoc = useCallback(async (user: User, name?: string) => {
    try {
      await setDoc(
        doc(db, 'users', user.uid),
        {
          name: name ?? user.displayName ?? 'ゲスト',
          email: user.email ?? '',
          lastSeen: serverTimestamp(),
          createdAt: serverTimestamp(),
          // 新規作成時のみ空値を入れる(既存値は merge で保持)
          area: '',
          bio: '',
          interests: [],
        },
        { merge: true },
      );
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
