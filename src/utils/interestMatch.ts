// 「その気分を、その人に届けてよいか」の判定を 1 箇所に集約する。
//
// 送信側 (HomeScreen) と受信側 (useNotifications) の両方から使う。
// 以前は受信側だけで絞っていたため、興味の無い相手にも notification doc と
// push が飛び、受信側の表示だけで握り潰していた。送信側でも同じ述語で
// 絞ることで、そもそも作らない・送らないようにする。
//
// ★ 受信側のフィルタは残す (二重で絞る)。
//   送信側だけにすると、送信後に相手が興味を外した場合に古い通知が
//   表示され続ける。受信側は「今の興味」で毎回評価されるため、
//   安全網として機能する。
import { ActivityId } from '../config/activities';

// interests が空 = まだ何も選んでいない。この場合は絞らない (全部対象)。
// 既存の受信側の挙動 (interests が空なら素通し) と揃えている。
export function matchesInterest(
  interests: ActivityId[] | undefined | null,
  activity: ActivityId,
): boolean {
  if (!interests || interests.length === 0) return true;
  return interests.includes(activity);
}
