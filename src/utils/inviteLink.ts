// 招待リンク関連のユーティリティ
import { Alert } from 'react-native';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';

// 招待リンクを生成。
// 旧: kibunya:///invite/{uid} (アプリ未インストール時に死ぬ)
// 新: https://gokuyou-official.github.io/kibunya/invite/{uid}
//     未インストールの友人もブラウザ経由で App Store に誘導できる。
//     ブラウザ側の bridging は docs/404.html (or docs/invite/...) が担う。
export function generateInviteLink(userId: string): string {
  return `https://gokuyou-official.github.io/kibunya/invite/${userId}`;
}

// ディープリンクを解析して友達追加。
// アプリは kibunya://invite/{uid} 形式で受け取る (HTTPS リンクは docs/404.html
// 経由で kibunya:// にリダイレクトされる前提)。互換のため両方の path 形式を解釈。
export async function handleInviteLink(
  url: string,
  currentUserId: string,
): Promise<void> {
  try {
    if (!url || !currentUserId) return;

    const friendId = extractFriendIdFromUrl(url);
    if (!friendId) return;
    if (friendId === currentUserId) {
      // 自分のリンクを自分で踏んだ場合は無音 (UI 上の混乱を避ける)
      return;
    }

    // 招待元の存在チェック
    const friendSnap = await getDoc(doc(db, 'users', friendId));
    if (!friendSnap.exists()) {
      Alert.alert('招待リンクが無効です', 'このリンクは既に削除されたか、誤っている可能性があります。');
      return;
    }
    const friendName = (friendSnap.data() as any)?.name ?? 'フレンド';

    // 双方向フレンド登録
    //
    // ⚠️ merge: true は必須。merge なしの setDoc はドキュメント全体の置換で、
    // 既存の active (通知トグル) が消える。active は未定義だと有効扱い
    // (useFriends.ts の active !== false) なので、ミュートが黙って解除される。
    // 招待リンクは何度でも踏めるため、実際に起きる。
    //
    // また相手側は firestore.rules 上 addedAt しか触れない
    // (allow update の hasOnly(['addedAt']))。merge なしだと active の削除が
    // affectedKeys に乗って permission-denied になる。
    await setDoc(
      doc(db, 'friends', currentUserId, 'friendsList', friendId),
      { addedAt: serverTimestamp() },
      { merge: true },
    );
    await setDoc(
      doc(db, 'friends', friendId, 'friendsList', currentUserId),
      { addedAt: serverTimestamp() },
      { merge: true },
    );

    Alert.alert('友達になりました', `${friendName}さんと友達になりました`);
  } catch (e) {
    console.error('handleInviteLink error', e);
    Alert.alert('招待リンクの処理に失敗しました', 'もう一度お試しください。');
  }
}

// URL から friendId を取り出す。下記いずれの形式にも対応:
//   kibunya://invite/{uid}             (アプリのカスタムスキーム)
//   kibunya:///invite/{uid}            (Linking.createURL の旧出力)
//   https://.../kibunya/invite/{uid}   (Web 招待リンク → ブラウザ経由)
function extractFriendIdFromUrl(url: string): string | null {
  // パス部分を取り出して '/' で分割
  // URL コンストラクタは独自スキームも解釈できるが Hermes でない RN ランタイム
  // 互換性のため正規表現で素朴に処理する
  const match = url.match(/[/]invite[/]([^/?#]+)/);
  if (match && match[1]) return match[1];
  return null;
}
