// 「いきますかー」を送った後の状態を Firestore で持つフック。
//
// これまで待機状態は HomeScreen のローカル state だった。そのためアプリを
// 落とすと消え、機種を変えても引き継がれず、「送ったのに待機が消えている」
// 状態が起きていた。moods コレクションに持たせて永続化する。
//
// ドキュメント構成:
//   moods/{moodId}
//     senderId, senderName, activity, area, recipientIds,
//     createdAt, expiresAt, closedAt (null の間が「生きている」)
//   moods/{moodId}/reactions/{userId}
//     createdAt   … 「かー」を返した人。create のみ (取り消し不可)
//
// 状態遷移 (closedAt が null の mood が対象):
//   「かー」が 1 件以上          → 🍻 の締め表示。閉じるまで残る
//   0 件かつ now <  expiresAt    → 待機中 (🍺 + カウントダウン)
//   0 件かつ now >= expiresAt    → 「気分じゃないかも？」を出して閉じる
//
// ★ 「かー」が返ってきた時点で締め表示に移る。期限を待たない。
//   演出 (MatchOverlay) はあくまで通知で、mood の寿命には影響しない。
//   演出を閉じても mood は生きたままで、3 時間経っても勝手には消えない。
//
// closedAt を立てて初めて消えるので、締め表示を見ずにアプリを落としても
// 次回起動時にまた出る。
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { ActivityId } from '../config/activities';

// 送信から自動的に締めるまでの時間 (3時間)
export const MOOD_TTL_MS = 3 * 60 * 60 * 1000;

export type MyMood = {
  id: string;
  activity: ActivityId;
  area: string | null;
  createdAtMs: number;
  expiresAtMs: number;
  reactionCount: number;
  // 「かー」を返した人の uid。締め表示で人数を出すのに使う。
  reactedBy: string[];
};

function toMs(v: any): number {
  return v?.toMillis?.() ?? 0;
}

export function useMyMood(currentUserId: string | undefined) {
  const [mood, setMood] = useState<MyMood | null>(null);
  const [loading, setLoading] = useState(true);
  // 1秒ごとに進むだけの値。カウントダウンを止めないために持つ。
  const [nowMs, setNowMs] = useState(() => Date.now());

  // 生きている自分の mood を購読する。
  // ★ 等値フィルタ 2 つだけなので複合インデックスは要らない
  //   (orderBy を足すと必要になるので、並べ替えはクライアント側で行う)。
  useEffect(() => {
    if (!currentUserId) {
      setMood(null);
      setLoading(false);
      return;
    }
    const q = query(
      collection(db, 'moods'),
      where('senderId', '==', currentUserId),
      where('closedAt', '==', null),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setMood(null);
          setLoading(false);
          return;
        }
        // 生きている mood は基本 1 件だが、競合で複数できた場合は
        // 最新だけを見る (古い方は締め処理で順次閉じられる)。
        const docs = [...snap.docs].sort(
          (a, b) => toMs(b.data().createdAt) - toMs(a.data().createdAt),
        );
        const d = docs[0];
        const data = d.data() ?? {};
        const createdAtMs = toMs(data.createdAt);
        setMood({
          id: d.id,
          activity: data.activity,
          area: data.area ?? null,
          createdAtMs,
          // expiresAt が入っていない古いデータでも動くようにフォールバック。
          expiresAtMs: toMs(data.expiresAt) || createdAtMs + MOOD_TTL_MS,
          reactionCount: 0,
          reactedBy: [],
        });
        setLoading(false);
      },
      (err) => {
        console.error('useMyMood onSnapshot error', err);
        setLoading(false);
      },
    );
    return unsub;
  }, [currentUserId]);

  // 「かー」の購読。mood が決まってから張る。
  const moodId = mood?.id;
  useEffect(() => {
    if (!moodId) return;
    const unsub = onSnapshot(
      collection(db, 'moods', moodId, 'reactions'),
      (snap) => {
        const ids = snap.docs.map((d) => d.id);
        setMood((prev) =>
          prev && prev.id === moodId
            ? { ...prev, reactionCount: ids.length, reactedBy: ids }
            : prev,
        );
      },
      (err) => {
        console.error('useMyMood reactions onSnapshot error', err);
      },
    );
    return unsub;
  }, [moodId]);

  // カウントダウン用の時計。mood がある間だけ動かす。
  // ★ 期限が来ても止めない。締め表示に入った後も経過時間を出せるようにする。
  useEffect(() => {
    if (!moodId) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    // バックグラウンドから戻った直後にすぐ正しい値にする
    setNowMs(Date.now());
    return () => clearInterval(t);
  }, [moodId]);

  // 締める。closedAt を入れた瞬間に上のクエリから外れて mood が null になる。
  const closeMood = useCallback(async () => {
    if (!moodId) return;
    try {
      await updateDoc(doc(db, 'moods', moodId), { closedAt: serverTimestamp() });
    } catch (e) {
      console.error('closeMood error', e);
    }
  }, [moodId]);

  const phase = useMemo<'none' | 'waiting' | 'expiredEmpty' | 'matched'>(() => {
    if (!mood) return 'none';
    // 「かー」が返ってきたら期限を待たずに締め表示へ。
    // 期限が過ぎてもこの状態のまま (静かに残る)。
    if (mood.reactionCount > 0) return 'matched';
    if (nowMs < mood.expiresAtMs) return 'waiting';
    return 'expiredEmpty';
  }, [mood, nowMs]);

  // 残り時間 (ms)。期限後は 0 で止める (負の値を表示に出さない)。
  const remainingMs = mood ? Math.max(0, mood.expiresAtMs - nowMs) : 0;

  return { mood, phase, remainingMs, loading, closeMood };
}

// 残りミリ秒を「2:59:03」形式にする
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return `${h}:${mm}:${ss}`;
}
