// 通知一覧を管理するフック(v2: activity 情報を含める)
import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  addDoc,
  setDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { sendPushNotification } from '../utils/pushNotifications';
import { ActivityId } from '../config/activities';

export type Notification = {
  id: string;
  senderId: string;
  senderName: string;
  receiverId: string;
  type: 'kibun' | 'reaction';
  activity: ActivityId;
  area?: string;
  createdAt: any;
  isRead: boolean;
  reactedBy: string | null;
  // 送信側の mood との紐付け。旧データには無いので optional。
  moodId?: string;
  // 気分の有効期限 (ms)。過ぎたカードは減光して「かー」を押せなくする。
  expiresAtMs?: number;
};

// 「まだ返事をしていない、生きている気分」か。
//
// バッジの件数とホーム画面の表示で同じ判定を使うために切り出す。
// 期限の見方は NotificationCard の expired と同じ:
//   expiresAtMs を持たない旧データは期限の概念が無いので切れない扱い。
export function isPendingKibun(n: Notification, nowMs: number): boolean {
  if (n.type !== 'kibun') return false;
  if (n.reactedBy) return false;
  if (typeof n.expiresAtMs === 'number' && nowMs >= n.expiresAtMs) return false;
  return true;
}

export function useNotifications(
  currentUserId: string | undefined,
  interests?: ActivityId[],
) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  // 期限切れを時間の経過だけで反映させるための時計。
  // これが無いと、Firestore に変更が来るまで期限切れの気分がバッジに
  // 残り続ける (画面を開いたまま 3 時間経つ、が普通に起きる)。
  // 期限は分単位で足りるので 60 秒間隔にして再描画を抑える。
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!currentUserId) return;
    const t = setInterval(() => setNowMs(Date.now()), 60 * 1000);
    return () => clearInterval(t);
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) {
      setNotifications([]);
      setLoading(false);
      return;
    }
    // NOTE: orderBy('createdAt') を Firestore 側で使うと composite index
    // (receiverId + createdAt) が必須になり、未 deploy 時は query が silent
    // fail して "通知が来ない" 症状になる。JS 側で sort することで
    // single-field index (auto) だけで動かす。
    const q = query(
      collection(db, 'notifications'),
      where('receiverId', '==', currentUserId),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Notification[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            ...(data as Omit<Notification, 'id'>),
            // Timestamp のままだと比較しづらいので ms に落とす。
            // 旧データ (expiresAt 無し) は undefined のままにして、
            // 「期限の概念が無い = 減光しない」扱いにする。
            expiresAtMs: data.expiresAt?.toMillis?.(),
          };
        });
        list.sort((a, b) => {
          const ma = (a.createdAt as any)?.toMillis?.() ?? 0;
          const mb = (b.createdAt as any)?.toMillis?.() ?? 0;
          return mb - ma; // desc
        });
        setNotifications(list);
        setLoading(false);
      },
      (err) => {
        console.error('useNotifications onSnapshot error', err);
        setLoading(false);
      },
    );
    return unsub;
  }, [currentUserId]);

  // 自分の興味に合致するものだけ表示(リアクションは常に表示)
  const filtered = useMemo(() => {
    if (!interests || interests.length === 0) return notifications;
    return notifications.filter(
      (n) => n.type === 'reaction' || interests.includes(n.activity),
    );
  }, [notifications, interests]);

  // 「まだ返事をしていない、生きている気分」だけを数える。
  //
  // 以前は !isRead && !reactedBy だった。isRead はアラートタブを開いた瞬間に
  // markAllAsRead で全部 true になるため、「かー」を返さないまま画面を閉じると
  // バッジが消え、届いていること自体が分からなくなっていた。
  // isRead は「見た」であって「対応した」ではないので、判定から外す。
  //
  // reaction (お礼通知) を除くのは、返事が来た側にやることが残らないため。
  // 期限切れも除く。過ぎたものは送信側が既に締めていて、押しても届かない
  // (カード側も NotificationCard で押せなくしている)。
  const pending = useMemo(
    () => filtered.filter((n) => isPendingKibun(n, nowMs)),
    [filtered, nowMs],
  );

  const unreadCount = pending.length;

  const markAsRead = useCallback(async (notificationId: string) => {
    try {
      await updateDoc(doc(db, 'notifications', notificationId), {
        isRead: true,
      });
    } catch (e) {
      console.error('markAsRead error', e);
    }
  }, []);

  // 一覧表示時点でまだ未読のものを一括 isRead=true。
  // 「かー」を返したかどうかとは独立 (バッジは「見た」時点でリセット、
  //  カードと「かー」ボタンは reactedBy=null の間は残す)。
  const markAllAsRead = useCallback(async () => {
    const targets = notifications.filter((n) => !n.isRead);
    if (targets.length === 0) return;
    try {
      const batch = writeBatch(db);
      for (const n of targets) {
        batch.update(doc(db, 'notifications', n.id), { isRead: true });
      }
      await batch.commit();
    } catch (e) {
      console.error('markAllAsRead error', e);
    }
  }, [notifications]);

  // 「かー」リアクション
  // 重複防止のため Firestore 側で reactedBy が既に立っていれば早期 return。
  const reactToNotification = useCallback(
    async (
      notificationId: string,
      senderId: string,
      senderFcmToken: string | undefined,
      myName: string,
      activity: ActivityId,
      matchEmoji: string,
      moodId?: string,
    ) => {
      if (!currentUserId) return;
      try {
        // 二重防御 1: Firestore 側の状態確認。連打や複数端末からの同時実行を弾く。
        const snap = await getDoc(doc(db, 'notifications', notificationId));
        if (!snap.exists()) return;
        if (snap.data()?.reactedBy) {
          // 既に誰かが reacted。reaction 通知の重複生成を防ぐ。
          return;
        }
        await updateDoc(doc(db, 'notifications', notificationId), {
          reactedBy: currentUserId,
          isRead: true,
        });

        // 送信側の待機状態を解くための「かー」。doc ID を自分の uid に
        // することで 1人1件を構造で保証する。
        // ★ ルール上 create のみ許可。2回目以降は update 扱いで拒否される。
        //   二重タップを無害にするため、そのエラーは握り潰す
        //   (notifications 側は上の reactedBy で既に確定している)。
        if (moodId) {
          try {
            await setDoc(doc(db, 'moods', moodId, 'reactions', currentUserId), {
              createdAt: serverTimestamp(),
            });
          } catch (e) {
            console.warn('mood reaction skipped', e);
          }
        }
        // 相手にお礼通知
        const reactionRef = await addDoc(collection(db, 'notifications'), {
          senderId: currentUserId,
          senderName: myName,
          receiverId: senderId,
          type: 'reaction',
          activity,
          createdAt: serverTimestamp(),
          isRead: false,
          reactedBy: null,
        });
        if (senderFcmToken) {
          await sendPushNotification(
            [senderFcmToken],
            'KIBUNYA',
            `${myName}さんが「かー」しました${matchEmoji}`,
            {
              notificationIds: [reactionRef.id],
              type: 'reaction',
            },
          );
        }
      } catch (e) {
        console.error('reactToNotification error', e);
      }
    },
    [currentUserId],
  );

  return {
    notifications: filtered,
    // 未応答かつ期限内の気分。新しい順 (filtered が createdAt desc)。
    pending,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    reactToNotification,
  };
}

// 7 日以上前の自分宛アラートを削除する一回限りの掃除関数。
// アプリ起動時に App.tsx の Root から uid 切替時に呼ぶ前提。
// React コンポーネントの外でも使えるよう hook ではなく純関数として export。
//
// ⚠️ 設計メモ:
//   - where('receiverId', '==', uid) は single-field index (auto) で動く。
//     createdAt の比較を Firestore query 側でやると composite index が
//     必要になるため JS 側で filter する。
//   - Firestore rule で notifications の delete は sender/receiver 双方が
//     可能。本関数は受信側分だけ掃除する (送信側分は相手の起動で消える)。
//   - 失敗してもサイレント。アプリ本来のフローは止めない。
export async function cleanupOldNotifications(
  uid: string | undefined,
  olderThanDays = 7,
): Promise<number> {
  if (!uid) return 0;
  try {
    const cutoffMs = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const q = query(
      collection(db, 'notifications'),
      where('receiverId', '==', uid),
    );
    const snap = await getDocs(q);
    const targets = snap.docs.filter((d) => {
      const ts = d.data().createdAt;
      const ms = ts?.toMillis?.() ?? 0;
      // ms===0 (server timestamp 未確定) は安全側で対象外
      return ms > 0 && ms < cutoffMs;
    });
    if (targets.length === 0) return 0;
    const batch = writeBatch(db);
    for (const d of targets) {
      batch.delete(d.ref);
    }
    await batch.commit();
    // eslint-disable-next-line no-console
    console.log(`[cleanup] deleted ${targets.length} old notifications (>${olderThanDays}d)`);
    return targets.length;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('cleanupOldNotifications error', e);
    return 0;
  }
}
