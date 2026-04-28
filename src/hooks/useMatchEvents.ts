// マッチ後オーバーレイを発火するためのリアクション通知監視フック。
// useNotifications とは独立した listener を持ち、reaction 通知のみを対象に
// in-memory で「まだ表示していない match」をキューする。
//
// 「まだ表示していない」判定 (案C: in-memory dedup):
//   フック mount 直後の初回 snapshot は seenIds に全件登録するだけで trigger
//   しない (歴史的 reaction を出さない)。以降の docChanges() で type==='added'
//   の reaction だけをキューに積む。
//
// 端末跨ぎや再起動を跨いだ「未消化 match」の表示は MVP スコープ外。アラート
// タブには通知カードとして残るため、機能性は損なわれない。
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { ActivityId } from '../config/activities';

export type MatchEvent = {
  id: string;
  senderId: string;
  senderName: string;
  activity: ActivityId;
};

export function useMatchEvents(currentUserId: string | undefined) {
  // 表示待ちキュー
  const [queue, setQueue] = useState<MatchEvent[]>([]);
  // 既に表示済み or 初回 snapshot で除外済みの id 集合
  const seenIdsRef = useRef<Set<string>>(new Set());
  // 初回 snapshot を区別するためのフラグ
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!currentUserId) {
      setQueue([]);
      seenIdsRef.current = new Set();
      initializedRef.current = false;
      return;
    }

    const q = query(
      collection(db, 'notifications'),
      where('receiverId', '==', currentUserId),
      where('type', '==', 'reaction'),
      orderBy('createdAt', 'desc'),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        if (!initializedRef.current) {
          // 初回: 既存 reaction は全て seenIds に積み、trigger しない
          snap.docs.forEach((d) => seenIdsRef.current.add(d.id));
          initializedRef.current = true;
          return;
        }
        // 2回目以降: added だけをキューに追加
        const additions: MatchEvent[] = [];
        snap.docChanges().forEach((change) => {
          if (change.type !== 'added') return;
          const id = change.doc.id;
          if (seenIdsRef.current.has(id)) return;
          seenIdsRef.current.add(id);
          const data = change.doc.data() as any;
          additions.push({
            id,
            senderId: data.senderId,
            senderName: data.senderName ?? 'フレンド',
            activity: (data.activity ?? 'drinking') as ActivityId,
          });
        });
        if (additions.length > 0) {
          // createdAt 昇順 (古い順) にして順次表示
          additions.reverse();
          setQueue((prev) => [...prev, ...additions]);
        }
      },
      (err) => {
        console.error('useMatchEvents onSnapshot error', err);
      },
    );

    return () => {
      unsub();
      initializedRef.current = false;
    };
  }, [currentUserId]);

  // キュー先頭が現在表示すべきイベント
  const current = queue[0] ?? null;

  // dismiss でキューを進める
  const dismiss = useCallback(() => {
    setQueue((prev) => prev.slice(1));
  }, []);

  return { current, dismiss, queueLength: queue.length };
}
