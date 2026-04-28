// マッチ後オーバーレイを発火するためのリアクション通知監視フック。
// useNotifications とは独立した listener を持ち、reaction 通知のみを対象に
// in-memory で「まだ表示していない match」をキューする。
//
// 「まだ表示していない」判定 (案C: in-memory dedup):
//   フック mount 直後の初回 snapshot 群は seenIds に全件登録するだけで trigger
//   しない (歴史的 reaction を出さない)。以降の docChanges() で type==='added'
//   の reaction だけをキューに積む。
//
// 初回 snapshot のレースコンディションについて (検証結果):
//   Firebase JS SDK の onSnapshot は購読登録後 必ず最初に「初回 snapshot」を
//   1回以上 fire する仕様。snap.docChanges() は初回時に全件を 'added' として
//   返すため、もし initializedRef ガード無しに docChanges を回すと歴史的
//   reaction 全件で overlay が暴発する。
//
//   さらに **キャッシュ→サーバーの2段階 fire** が起きうる:
//     1) ローカルキャッシュ snapshot (snap.metadata.fromCache === true)
//     2) サーバー反映 snapshot (snap.metadata.fromCache === false)
//   キャッシュが空 (新規端末) の場合、(1) は空、(2) で初めて全件届く。
//   この間に新規 reaction が増えると (2) で 'added' として混ざり、判別不可。
//
//   対策: snap.metadata.fromCache === false を観測するまで初期化完了とみなさず、
//   各 snapshot の snap.docs を seenIds に毎回シードする。サーバー snapshot を
//   観測した時点で initializedRef を立て、以降の追加だけを trigger 対象とする。
//   これによりキャッシュ→サーバーの 2段階 fire でも安全に dedup できる。
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
        // 初期化フェーズ: サーバー反映 snapshot を観測するまで継続
        // (キャッシュ snapshot だけを見て初期化完了とすると、後続の
        //  サーバー snapshot で歴史的 reaction が全件 'added' として届き暴発する)
        if (!initializedRef.current) {
          // 現時点の docs を全て seenIds にシード
          snap.docs.forEach((d) => seenIdsRef.current.add(d.id));
          // サーバー反映済み snapshot を観測したら初期化完了
          if (!snap.metadata.fromCache) {
            initializedRef.current = true;
          }
          return;
        }
        // 初期化後: docChanges() の added だけをキューに追加
        const additions: MatchEvent[] = [];
        snap.docChanges().forEach((change) => {
          if (change.type !== 'added') return;
          const id = change.doc.id;
          // 二重防御: seenIds に既にあるなら trigger しない
          // (初期化フェーズでシード済みのものは確実に弾かれる)
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
