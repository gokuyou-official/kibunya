// 招待リンク関連のユーティリティ
import * as Linking from 'expo-linking';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';

// 招待リンクを生成: kibunya://invite/{userId}
export function generateInviteLink(userId: string): string {
  return Linking.createURL(`/invite/${userId}`, { scheme: 'kibunya' });
}

// ディープリンクを解析して友達追加
export async function handleInviteLink(
  url: string,
  currentUserId: string,
): Promise<void> {
  try {
    if (!url || !currentUserId) return;
    const parsed = Linking.parse(url);
    // path = "invite/abc123" もしくは hostname=invite, path=abc123
    let friendId: string | null = null;
    if (parsed.path) {
      const parts = parsed.path.split('/').filter(Boolean);
      if (parts[0] === 'invite' && parts[1]) friendId = parts[1];
      else if (parts.length === 1 && parsed.hostname === 'invite') friendId = parts[0];
    }
    if (!friendId) return;
    if (friendId === currentUserId) return;

    // 存在チェック
    const friendSnap = await getDoc(doc(db, 'users', friendId));
    if (!friendSnap.exists()) {
      console.warn('招待元のユーザーが見つかりません');
      return;
    }
    // 双方向フレンド登録
    await setDoc(
      doc(db, 'friends', currentUserId, 'friendsList', friendId),
      { addedAt: serverTimestamp() },
    );
    await setDoc(
      doc(db, 'friends', friendId, 'friendsList', currentUserId),
      { addedAt: serverTimestamp() },
    );
  } catch (e) {
    console.error('handleInviteLink error', e);
  }
}
