// 未ログイン中に踏まれた招待リンクの uid を一時保持する。
//
// なぜ必要か:
//   App.tsx の招待リンク購読は currentUser が居る時だけ張られる。
//   ログアウト状態で招待リンクを踏むと、Linking の 'url' イベントを
//   受け取る購読自体が存在せず、uid が永久に失われていた。
//   「インストール直後にリンクを踏んだが友達にならない」の主因のひとつ。
//
// そこで踏んだ時点で uid をローカルに退避し、ログイン/サインアップ完了後に
// 取り出して処理する。
//
// 有効期限を持たせる理由:
//   無期限だと、何日も前に踏んだ招待が突然発火して
//   「知らないうちに友達が増えた」状態になる。24時間で捨てる。
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'kibunya.pendingInviteUid';

// 24 時間。これを過ぎた保留は捨てる。
export const PENDING_INVITE_TTL_MS = 24 * 60 * 60 * 1000;

type Stored = {
  uid: string;
  savedAt: number;
};

// 未ログイン時に踏んだ uid を保存する。
// 複数回踏まれた場合は最後のものを残す (直近の意図を優先)。
export async function savePendingInvite(uid: string): Promise<void> {
  if (!uid) return;
  try {
    const payload: Stored = { uid, savedAt: Date.now() };
    await AsyncStorage.setItem(KEY, JSON.stringify(payload));
  } catch (e) {
    // 保存できなくても本フローは止めない (次にリンクを踏めば復帰できる)。
    console.warn('savePendingInvite error', e);
  }
}

// 保留中の uid を取り出す。期限切れ・壊れたデータは null を返し、
// その場で消す (呼び出し側が期限を意識しなくて済むようにする)。
export async function takePendingInvite(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;

    let parsed: Stored | null = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // 旧形式や壊れた値。残しておいても使えないので捨てる。
      await clearPendingInvite();
      return null;
    }

    if (!parsed?.uid || typeof parsed.savedAt !== 'number') {
      await clearPendingInvite();
      return null;
    }

    // 端末の時計が巻き戻った場合 (savedAt が未来) も期限切れ扱いにする。
    // 巻き戻り分だけ延命されるより、捨てて踏み直してもらう方が安全。
    const age = Date.now() - parsed.savedAt;
    if (age < 0 || age > PENDING_INVITE_TTL_MS) {
      await clearPendingInvite();
      return null;
    }

    return parsed.uid;
  } catch (e) {
    console.warn('takePendingInvite error', e);
    return null;
  }
}

export async function clearPendingInvite(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch (e) {
    console.warn('clearPendingInvite error', e);
  }
}
