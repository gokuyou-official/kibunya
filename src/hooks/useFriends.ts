// 友達一覧を管理するフック
import { useEffect, useState, useCallback } from 'react';
import {
  collection,
  onSnapshot,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';

export type Friend = {
  id: string;
  name: string;
  fcmToken?: string;
  lastSeen?: any;
  isOnline: boolean;
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
            const uSnap = await getDoc(doc(db, 'users', friendId));
            const u = uSnap.data() ?? {};
            const lastSeenMs = u.lastSeen?.toMillis?.() ?? 0;
            const isOnline = Date.now() - lastSeenMs < ONLINE_THRESHOLD_MS;
            list.push({
              id: friendId,
              name: u.name ?? 'フレンド',
              fcmToken: u.fcmToken,
              lastSeen: u.lastSeen,
              isOnline,
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

  return { friends, loading, addFriend };
}
