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
import { db, firebaseApiKey } from '../config/firebase';
import { generateRawNonce } from './authNonce';

export type SignInProvider = 'apple.com' | 'password' | 'unknown';

export function getSignInProvider(user: User | null | undefined): SignInProvider {
  const id = user?.providerData?.[0]?.providerId;
  if (id === 'apple.com') return 'apple.com';
  if (id === 'password') return 'password';
  return 'unknown';
}

// Apple で再認証し、同時に「今回の認可コード」を取り出す。
// この authorizationCode は Apple トークン失効 (revoke) に使う。ログイン時に
// 取得したコードは短命かつ再利用不可なので、削除直前の再認証で得た新しい
// コードを使うのが確実。
async function reauthenticateWithApple(user: User): Promise<string | undefined> {
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
  return credential.authorizationCode ?? undefined;
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
// Apple の場合のみ、失効処理に使う authorizationCode を返す。
export async function reauthenticate(
  user: User,
  password?: string,
): Promise<{ appleAuthorizationCode?: string }> {
  const provider = getSignInProvider(user);
  if (provider === 'apple.com') {
    const appleAuthorizationCode = await reauthenticateWithApple(user);
    return { appleAuthorizationCode };
  }
  if (provider === 'password') {
    if (!password) {
      throw new Error('パスワードを入力してください');
    }
    await reauthenticateWithPassword(user, password);
  }
  // provider === 'unknown' の場合は再認証をスキップし、削除処理自体に
  // 委ねる (requires-recent-login が出たら呼び出し側の catch で案内する)。
  return {};
}

// Apple のサインイン連携を失効させる (App Store Guideline 5.1.1(v) 要件)。
//
// Firebase Auth のユーザー削除だけでは Apple 側の「このAppでApple IDを使用」
// 連携が残るため、Apple は審査でトークン失効を必須としている。
//
// 実装方式の選定:
//   - Firebase JS SDK の revokeAccessToken() は tokenType='ACCESS_TOKEN' 固定
//     (SDK 実装で確認済)。ネイティブの Sign in with Apple から得られるのは
//     authorizationCode (=CODE) なのでこの API は使えない。
//   - Apple の POST https://appleid.apple.com/auth/revoke を直接叩くには
//     client_secret (Apple の .p8 秘密鍵で署名した JWT) が必要で、鍵を
//     アプリに同梱するのは論外。サーバー (Cloud Functions) を建てると
//     Blaze プランが必要になる。
//   - 結論: Firebase iOS SDK の revokeToken(withAuthorizationCode:) と同じ
//     Identity Toolkit の accounts:revokeToken を tokenType='CODE' で叩く。
//     Firebase のバックエンドが Apple プロバイダ設定の鍵を使って Apple へ
//     revoke を代行するため、追加の鍵もサーバーも課金も不要。
async function revokeAppleToken(
  user: User,
  authorizationCode: string,
): Promise<void> {
  const idToken = await user.getIdToken();
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v2/accounts:revokeToken?key=${encodeURIComponent(firebaseApiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: 'apple.com',
        tokenType: 'CODE',
        token: authorizationCode,
        idToken,
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `accounts:revokeToken failed: HTTP ${res.status} ${body.slice(0, 300)}`,
    );
  }
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
//   再認証 → Firestore データ全削除 → Apple トークン失効 → Auth ユーザー削除
//
// revoke を deleteUser より前に置くのは必須。accounts:revokeToken は有効な
// idToken を要求するため、Auth ユーザーを消した後では実行できない。
export async function deleteAccount(user: User, password?: string): Promise<void> {
  const { appleAuthorizationCode } = await reauthenticate(user, password);

  await deleteUserFirestoreData(user.uid);

  if (appleAuthorizationCode) {
    try {
      await revokeAppleToken(user, appleAuthorizationCode);
    } catch (e) {
      // 失効に失敗してもアカウント削除自体は続行する。
      // ここで throw すると「データは消えたのにアカウントが残る」という
      // 最悪の中途半端な状態でユーザーが詰む。失効はサーバー側設定
      // (Firebase の Apple プロバイダ鍵) に依存するため、確実性は
      // 削除完了より一段低いものとして扱う。
      // eslint-disable-next-line no-console
      console.warn('[accountDeletion] Apple token revoke failed (continuing)', e);
    }
  }

  await deleteUser(user);
}
