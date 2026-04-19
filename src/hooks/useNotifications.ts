// 通知一覧を管理するフック(v2: activity 情報を含める)
import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp,
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
};

export function useNotifications(
  currentUserId: string | undefined,
  interests?: ActivityId[],
) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUserId) {
      setNotifications([]);
      setLoading(false);
      return;
    }
    const q = query(
      collection(db, 'notifications'),
      where('receiverId', '==', currentUserId),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Notification[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Notification, 'id'>),
        }));
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

  const unreadCount = useMemo(
    () => filtered.filter((n) => !n.isRead && !n.reactedBy).length,
    [filtered],
  );

  const markAsRead = useCallback(async (notificationId: string) => {
    try {
      await updateDoc(doc(db, 'notifications', notificationId), {
        isRead: true,
      });
    } catch (e) {
      console.error('markAsRead error', e);
    }
  }, []);

  // 「かー」リアクション
  const reactToNotification = useCallback(
    async (
      notificationId: string,
      senderId: string,
      senderFcmToken: string | undefined,
      myName: string,
      activity: ActivityId,
      matchEmoji: string,
    ) => {
      if (!currentUserId) return;
      try {
        await updateDoc(doc(db, 'notifications', notificationId), {
          reactedBy: currentUserId,
          isRead: true,
        });
        // 相手にお礼通知
        await addDoc(collection(db, 'notifications'), {
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
    unreadCount,
    loading,
    markAsRead,
    reactToNotification,
  };
}
