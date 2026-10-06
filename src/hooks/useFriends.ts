// 友達一覧を管理するフック
import { useEffect, useMemo, useState, useCallback } from 'react';
import { AppState } from 'react-native';
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
import { ActivityId } from '../config/activities';

export type Friend = {
  id: string;
  name: string;
  // プロフィールの「一言」。友達一覧と宛先選択で名前の下に出す。
  // 旧データ・未設定は空文字。
  bio: string;
  fcmToken?: string;
  lastSeen?: any;
  isOnline: boolean;
  // 通知対象フラグ。未定義の旧データは true (有効) として扱う。
  active: boolean;
  // 相手が選んでいる気分の種類。送信側で「その気分に興味がある人」だけに
  // 絞るために持つ。ここで持っておけば送信時に getDoc を追加しなくて済む
  // (users/{friendId} は下でどのみち読んでいる)。
  interests: ActivityId[];
};

// 5分以内にlastSeen更新があればオンライン扱い
const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

// 友達の users ドキュメントを読み直す間隔。
//
// ★ しきい値 (5分) より短くする。同じ 5 分にすると、相手が真面目に
//   更新していても「読み直す直前の数秒」が必ず期限切れに見える。
//   2 分なら、相手が開いていれば必ず 5 分以内の lastSeen を拾える。
//
// Firestore の読み取り回数は「友達の人数 × 1日の更新回数」で増える。
// 友達 5 人・前面 60 分/日なら 5 × 30 = 150 回/日で、無料枠 (5万回/日)
// に対して誤差の範囲。人数が増えても線形にしか増えない。
const PRESENCE_REFRESH_MS = 2 * 60 * 1000;

// friendsList の 1 行ぶん。users 側は別で読む。
type FriendEntry = { id: string; active: boolean };

// users/{friendId} から読んだ表示用の情報。
type FriendProfile = {
  name: string;
  bio: string;
  fcmToken?: string;
  lastSeen?: any;
  lastSeenMs: number;
  interests: ActivityId[];
};

export function useFriends(currentUserId: string | undefined) {
  // friendsList (誰と友達か / 通知 ON か) と、users 側の表示情報を分けて持つ。
  //
  // 以前は friendsList の onSnapshot の中で users を getDoc していた。
  // そのため「友達の増減やトグル操作が起きた時」しか users を読み直さず、
  // 相手がアプリを開いても丸は灰色のままだった。さらに isOnline を
  // その場の Date.now() で固定していたので、時間が経っても色が変わらない。
  // 読み直しと時計を friendsList の購読から切り離す。
  const [entries, setEntries] = useState<FriendEntry[]>([]);
  const [profiles, setProfiles] = useState<Record<string, FriendProfile>>({});
  const [loading, setLoading] = useState(true);
  // 読み直しと再評価のトリガー。前面にいる間だけ進む。
  const [tick, setTick] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // 前面にいる間だけ定期的に進める。背面では止める
  // (読み取り回数を使わない。iOS では止まっていることが多いが明示する)。
  useEffect(() => {
    if (!currentUserId) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        setTick((t) => t + 1);
        setNowMs(Date.now());
      }, PRESENCE_REFRESH_MS);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        // 戻ってきた時はすぐ読み直す。背面の間に相手が開いているかもしれない。
        setTick((t) => t + 1);
        setNowMs(Date.now());
        start();
      } else {
        stop();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [currentUserId]);

  // 1. friendsList の購読。users は読まない。
  useEffect(() => {
    if (!currentUserId) {
      setEntries([]);
      setProfiles({});
      setLoading(false);
      return;
    }
    const col = collection(db, 'friends', currentUserId, 'friendsList');
    const unsub = onSnapshot(
      col,
      (snap) => {
        setEntries(
          snap.docs.map((d) => ({
            id: d.id,
            // active が undefined の旧データは true として扱う (後方互換)。
            // 明示的に false が入っている時だけ無効。
            active: (d.data() ?? {}).active !== false,
          })),
        );
      },
      (err) => {
        console.error('useFriends onSnapshot error', err);
        setLoading(false);
      },
    );
    return unsub;
  }, [currentUserId]);

  // 2. 友達の users を読む。friendsList が変わった時と、tick ごと。
  //    ここが読み取り回数を使う唯一の場所 (友達の人数ぶん)。
  const entryKey = entries.map((e) => e.id).join(',');
  useEffect(() => {
    if (!currentUserId) return;
    if (entries.length === 0) {
      setProfiles({});
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const next: Record<string, FriendProfile> = {};
        for (const e of entries) {
          const uSnap = await getDoc(doc(db, 'users', e.id));
          const u = uSnap.data() ?? {};
          // ⚠️ name フォールバックは `??` ではなく `||` チェインを使う。
          // `u.name ?? 'フレンド'` だと空文字 '' を素通しして表示が空になる
          // (新規メール登録ユーザーで実際に発生していた)。
          // 優先度: trim 後の name → email の @ より前 → 'フレンド'
          const emailLocal =
            typeof u.email === 'string' ? u.email.split('@')[0] : '';
          next[e.id] = {
            name:
              (typeof u.name === 'string' && u.name.trim()) ||
              emailLocal ||
              'フレンド',
            bio: (typeof u.bio === 'string' && u.bio.trim()) || '',
            fcmToken: u.fcmToken,
            lastSeen: u.lastSeen,
            lastSeenMs: u.lastSeen?.toMillis?.() ?? 0,
            // 旧データや未設定は空配列。空 = 絞らない扱い
            // (matchesInterest の仕様に合わせる)。
            interests: Array.isArray(u.interests) ? u.interests : [],
          };
        }
        if (cancelled) return;
        setProfiles(next);
      } catch (e) {
        console.error('useFriends profile fetch error', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // entryKey で「顔ぶれが変わった時」だけ反応させる。entries 自体を
    // 依存に置くと、同じ内容の配列が作り直されるたびに読み直してしまう。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, entryKey, tick]);

  // 3. 組み立て。isOnline はここで nowMs から導出するので、
  //    読み直しが無くても時間の経過だけで灰色に変わる。
  const friends = useMemo<Friend[]>(
    () =>
      entries.map((e) => {
        const p = profiles[e.id];
        return {
          id: e.id,
          name: p?.name ?? 'フレンド',
          bio: p?.bio ?? '',
          fcmToken: p?.fcmToken,
          lastSeen: p?.lastSeen,
          isOnline: !!p && nowMs - p.lastSeenMs < ONLINE_THRESHOLD_MS,
          active: e.active,
          interests: p?.interests ?? [],
        };
      }),
    [entries, profiles, nowMs],
  );

  // 友達を追加(双方向)
  const addFriend = useCallback(
    async (friendId: string) => {
      if (!currentUserId || !friendId || currentUserId === friendId) return;
      try {
        // ⚠️ merge: true は必須。理由は inviteLink.ts の同処理のコメント参照
        // (merge なしだと既存の active が消え、相手側は rules で拒否される)。
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
