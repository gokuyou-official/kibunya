// 友達一覧を管理するフック
import { useEffect, useState, useCallback } from 'react';
import {
  collection,
  onSnapshot,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';

export type Friend = {
  id: string;
  name: string;
  fcmToken?: string;
  lastSeen?: any;
  isOnline: boolean;
  // 通知対象フラグ。未定義の旧データは true (有効) として扱う。
  active: boolean;
};

// 5分以内にlastSeen更新があればオンライン扱い
const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

export function useFriends(currentUserId: string | undefined) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUserId) {
      setFriends([]);
      setLoading(false);
      return;
    }
    const col = collection(db, 'friends', currentUserId, 'friendsList');
    const unsub = onSnapshot(
      col,
      async (snap) => {
        try {
          const list: Friend[] = [];
          for (const d of snap.docs) {
            const friendId = d.id;
            const friendListData = d.data() ?? {};
            // active が undefined の旧データは true として扱う (後方互換)。
            // 明示的に false が入っている時だけ無効。
            const active = friendListData.active !== false;
            const uSnap = await getDoc(doc(db, 'users', friendId));
            const u = uSnap.data() ?? {};
            const lastSeenMs = u.lastSeen?.toMillis?.() ?? 0;
            const isOnline = Date.now() - lastSeenMs < ONLINE_THRESHOLD_MS;
            // ⚠️ name フォールバックは `??` ではなく `||` チェインを使う。
            // `u.name ?? 'フレンド'` だと空文字 '' を素通しして表示が空になる
            // (新規メール登録ユーザーで実際に発生していた)。
            // 優先度: trim 後の name → email の @ より前 → 'フレンド'
            const emailLocal =
              typeof u.email === 'string' ? u.email.split('@')[0] : '';
            const friendName =
              (typeof u.name === 'string' && u.name.trim()) ||
              emailLocal ||
              'フレンド';
            list.push({
              id: friendId,
              name: friendName,
              fcmToken: u.fcmToken,
              lastSeen: u.lastSeen,
              isOnline,
              active,
            });
          }
          setFriends(list);
        } catch (e) {
          console.error('useFriends snapshot error', e);
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        console.error('useFriends onSnapshot error', err);
        setLoading(false);
      },
    );
    return unsub;
  }, [currentUserId]);

  // 友達を追加(双方向)
  const addFriend = useCallback(
    async (friendId: string) => {
      if (!currentUserId || !friendId || currentUserId === friendId) return;
      try {
        await setDoc(
          doc(db, 'friends', currentUserId, 'friendsList', friendId),
          { addedAt: serverTimestamp() },
        );
        await setDoc(
          doc(db, 'friends', friendId, 'friendsList', currentUserId),
          { addedAt: serverTimestamp() },
        );
      } catch (e) {
        console.error('addFriend error', e);
        throw e;
      }
    },
    [currentUserId],
  );

  // 自分側だけ更新 (片方向)。相手側の active は触らない。
  // 自分が通知を送る/送らないの判断材料なので、相手の同意は不要。
  const setFriendActive = useCallback(
    async (friendId: string, active: boolean) => {
      if (!currentUserId || !friendId) return;
      try {
        await updateDoc(
          doc(db, 'friends', currentUserId, 'friendsList', friendId),
          { active },
        );
      } catch (e) {
        console.error('setFriendActive error', e);
        throw e;
      }
    },
    [currentUserId],
  );

  return { friends, loading, addFriend, setFriendActive };
}
