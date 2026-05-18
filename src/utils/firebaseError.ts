// Firebase Auth エラーコードを日本語メッセージに変換する。
// Alert で出してユーザーに見せる用途を想定しているため、技術用語は使わない。
// 想定外コードは汎用フォールバックを返す。

const MESSAGES: Record<string, string> = {
  'auth/email-already-in-use': 'このメールアドレスは既に使われています',
  'auth/invalid-email': 'メールアドレスの形式が正しくありません',
  'auth/wrong-password': 'パスワードが間違っています',
  'auth/user-not-found': 'アカウントが見つかりません',
  'auth/weak-password': 'パスワードは6文字以上にしてください',
  'auth/too-many-requests': 'しばらく時間をおいてお試しください',
  'auth/operation-not-allowed': 'このログイン方法は現在利用できません',
};

const FALLBACK = 'ログインに失敗しました。もう一度お試しください';

export function firebaseAuthErrorToJa(e: unknown): string {
  const code = (e as { code?: unknown })?.code;
  if (typeof code === 'string' && code in MESSAGES) {
    return MESSAGES[code];
  }
  return FALLBACK;
}
