// マッチ後オーバーレイ (MatchOverlay) を発火させるためのフック。
// 友達から「かー」リアクションを受け取った時の祝祭演出を出す。
//
// ■ 旧実装の問題 (実質ほとんど表示されていなかった原因)
//   mount 直後の snapshot を全件 seenIds にシードし、以降の docChanges() の
//   type==='added' だけを trigger 対象にしていた。その結果:
//     - アプリを開いている間に届いた reaction → 表示される
//     - アプリを閉じている間に届いた reaction → 起動時に「表示済み」として
//       シードされ、二度と表示されない
//   push 通知は基本的にアプリを閉じている時に届くので、ほぼ全ての
//   「かー」が演出なしで素通りしていた。
//
// ■ 新実装の方針
//   「未読 (isRead=false) の reaction 通知」を表示対象とする。
//   起動時でもフォアグラウンド復帰時でも、未読が残っていれば順に表示し、
//   閉じたタイミングで isRead=true にして二度目を防ぐ。これで
//     1. push をタップして開いた場合
//     2. push をタップせず普通に起動 / フォアグラウンド復帰した場合
//   の両方をカバーできる。onSnapshot はフォアグラウンド復帰時に再同期
//   されるため、AppState を別途監視する必要はない。
//
// ■ 二重表示を防ぐ仕組み
//   isRead=true の書き込みがサーバーに反映されるまでにラグがあるため、
//   Firestore の状態だけに頼ると同じ通知を複数回キューに積みうる。
//   queuedIds (in-memory) で一度積んだ ID を記録して弾く。
//
// ■ 他機能との独立性
//   - SendOverlay (送信時の演出) とは別コンポーネント・別状態で干渉しない。
//   - push タップ時の highlightId 遷移とも独立。MatchOverlay は
//     NavigationContainer の外に描画されるため、アラートタブへの遷移と
//     同時に発生しても互いを壊さない (演出を閉じるとハイライト済みの
//     カードが見える)。
//   - キューは in-memory なので、アラートタブの markAllAsRead が後から
//     isRead=true にしても表示待ちのイベントは消えない。
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { ActivityId } from '../config/activities';

export type MatchEvent = {
  id: string;
  senderId: string;
  senderName: string;
  activity: ActivityId;
  createdAtMs: number;
};

export function useMatchEvents(currentUserId: string | undefined) {
  // 表示待ちキュー。先頭が今表示すべきイベント。
  const [queue, setQueue] = useState<MatchEvent[]>([]);
  // 一度キューに積んだ ID (二重投入防止)
  const queuedIdsRef = useRef<Set<string>>(new Set());
  // dismiss から最新のキューを参照するためのミラー
  const queueRef = useRef<MatchEvent[]>([]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    if (!currentUserId) {
      setQueue([]);
      queuedIdsRef.current = new Set();
      return;
    }

    // NOTE: 等値フィルタのみの組み合わせなので composite index は不要
    // (Firestore が単一フィールドインデックスのマージで解決する)。
    // orderBy を入れると composite index が必須になり、未 deploy 時に
    // query が silent fail してオーバーレイが永久に出なくなるため、
    // 並び替えは JS 側で行う。
    const q = query(
      collection(db, 'notifications'),
      where('receiverId', '==', currentUserId),
      where('type', '==', 'reaction'),
      where('isRead', '==', false),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const additions: MatchEvent[] = [];
        snap.docs.forEach((d) => {
          if (queuedIdsRef.current.has(d.id)) return;
          queuedIdsRef.current.add(d.id);
          const data = d.data() as any;
          additions.push({
            id: d.id,
            senderId: data.senderId,
            senderName: data.senderName ?? 'フレンド',
            activity: (data.activity ?? 'drinking') as ActivityId,
            createdAtMs: data.createdAt?.toMillis?.() ?? 0,
          });
        });
        if (additions.length === 0) return;
        // 「最新1件を表示し、閉じたら次の1件」なので新しい順に並べる。
        // 一気に全部出さず、1件ずつ順番に消化する。
        additions.sort((a, b) => b.createdAtMs - a.createdAtMs);
        setQueue((prev) => [...prev, ...additions]);
      },
      (err) => {
        console.error('useMatchEvents onSnapshot error', err);
      },
    );

    return unsub;
  }, [currentUserId]);

  // キュー先頭が現在表示すべきイベント
  const current = queue[0] ?? null;

  // 閉じたら既読にして次の1件へ進む。
  // 既読化に失敗しても表示は前に進める (演出のために操作を止めない)。
  // firestore.rules は receiver による {isRead, reactedBy} のみの更新を
  // 許可しているので、isRead だけを書く。
  const dismiss = useCallback(() => {
    const shown = queueRef.current[0];
    setQueue((prev) => prev.slice(1));
    if (!shown) return;
    updateDoc(doc(db, 'notifications', shown.id), { isRead: true }).catch((e) =>
      console.warn('useMatchEvents: mark as read failed', e),
    );
  }, []);

  return { current, dismiss, queueLength: queue.length };
}
