// アカウント削除 (App Store Guideline 5.1.1(v) 対応)
//
// 削除の順序は必ず「Firestore の関連データ削除 → Firebase Auth ユーザー削除」。
// 逆順にすると Auth ユーザーが消えた直後に Firestore 書き込み権限
// (request.auth.uid == userId 系のルール) が失われ、データが消せなくなる。
//
// auth/requires-recent-login 対策:
//   Firebase は「機微な操作」(delete 含む) を最終ログインから一定時間
//   経過後に拒否する。ここでは削除処理そのものを始める前に必ず
//   reauthenticate() を挟むことで、途中で requires-recent-login が
//   発生してデータだけ消えて Auth ユーザーが残る、という中途半端な
//   状態を避ける。
import {
  EmailAuthProvider,
  OAuthProvider,
  User,
  deleteUser,
  reauthenticateWithCredential,
} from 'firebase/auth';
import {
  DocumentReference,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import * as AppleAuthentication from 'expo-apple-authentication';
import { sha256 } from 'js-sha256';
import { db } from '../config/firebase';
import { generateRawNonce } from './authNonce';

export type SignInProvider = 'apple.com' | 'password' | 'unknown';

export function getSignInProvider(user: User | null | undefined): SignInProvider {
  const id = user?.providerData?.[0]?.providerId;
  if (id === 'apple.com') return 'apple.com';
  if (id === 'password') return 'password';
  return 'unknown';
}

async function reauthenticateWithApple(user: User): Promise<void> {
  const available = await AppleAuthentication.isAvailableAsync();
  if (!available) {
    throw new Error('この端末ではAppleサインインが使えません');
  }
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
  const fbCredential = provider.credential({
    idToken: credential.identityToken,
    rawNonce,
  });
  await reauthenticateWithCredential(user, fbCredential);
}

async function reauthenticateWithPassword(user: User, password: string): Promise<void> {
  if (!user.email) {
    throw new Error('メールアドレスが取得できませんでした');
  }
  const credential = EmailAuthProvider.credential(user.email, password);
  await reauthenticateWithCredential(user, credential);
}

// サインイン方法に応じて再認証する。password 方式のみ呼び出し側からの
// パスワード入力が必要 (呼び出し前に UI でモーダル等を出して取得する)。
export async function reauthenticate(user: User, password?: string): Promise<void> {
  const provider = getSignInProvider(user);
  if (provider === 'apple.com') {
    await reauthenticateWithApple(user);
  } else if (provider === 'password') {
    if (!password) {
      throw new Error('パスワードを入力してください');
    }
    await reauthenticateWithPassword(user, password);
  }
  // provider === 'unknown' の場合は再認証をスキップし、削除処理自体に
  // 委ねる (requires-recent-login が出たら呼び出し側の catch で案内する)。
}

const BATCH_LIMIT = 450;

async function deleteRefsInBatches(refs: DocumentReference[]): Promise<void> {
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const chunk = refs.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    chunk.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

// users/{uid} に紐づく Firestore 上の全データを削除する。
//   - friends/{uid}/friendsList/* (自分側) と friends/{friendId}/friendsList/{uid} (相手側の逆参照)
//   - notifications (自分が送信者 or 受信者のもの全て)
//   - users/{uid} 本体 (最後に削除)
export async function deleteUserFirestoreData(uid: string): Promise<void> {
  const refsToDelete: DocumentReference[] = [];

  const myFriendsSnap = await getDocs(collection(db, 'friends', uid, 'friendsList'));
  myFriendsSnap.docs.forEach((d) => {
    const friendId = d.id;
    refsToDelete.push(d.ref);
    refsToDelete.push(doc(db, 'friends', friendId, 'friendsList', uid));
  });

  const [sentSnap, receivedSnap] = await Promise.all([
    getDocs(query(collection(db, 'notifications'), where('senderId', '==', uid))),
    getDocs(query(collection(db, 'notifications'), where('receiverId', '==', uid))),
  ]);
  sentSnap.docs.forEach((d) => refsToDelete.push(d.ref));
  receivedSnap.docs.forEach((d) => refsToDelete.push(d.ref));

  await deleteRefsInBatches(refsToDelete);

  // ユーザードキュメント本体は他の参照を消し終えた最後に削除する。
  await deleteDoc(doc(db, 'users', uid));
}

// アカウント削除のオーケストレーション:
//   再認証 → Firestore データ全削除 → Firebase Auth ユーザー削除
export async function deleteAccount(user: User, password?: string): Promise<void> {
  await reauthenticate(user, password);
  await deleteUserFirestoreData(user.uid);
  await deleteUser(user);
}
