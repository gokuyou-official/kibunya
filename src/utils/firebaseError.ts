// Firebase Auth / Apple Sign-In エラーをユーザー向け日本語に変換し、
// 同時にデバッグ用の生コードを保持する。
//
// 目的: TestFlight 等でログが取れない環境でも、Alert にコードを併記する
// ことでユーザー (テスター) がスクショで原因を報告できるようにする。
//
// 想定外コードは「ログインに失敗しました (auth/xxx)」のように生コードを
// 末尾に付ける。

const MESSAGES: Record<string, string> = {
  // Email/Password
  'auth/email-already-in-use': 'このメールアドレスは既に使われています。「ログイン」タブから入ってください',
  'auth/invalid-email': 'メールアドレスの形式が正しくありません',
  'auth/wrong-password': 'パスワードが間違っています',
  'auth/user-not-found': 'アカウントが見つかりません。「新規登録」タブから作成してください',
  'auth/weak-password': 'パスワードは6文字以上にしてください',
  'auth/invalid-credential': 'メールアドレスまたはパスワードが正しくありません',
  'auth/missing-password': 'パスワードを入力してください',
  'auth/missing-email': 'メールアドレスを入力してください',

  // OAuth / Provider 系
  'auth/operation-not-allowed':
    'このログイン方法は現在無効です (Firebase Console で有効化が必要)',
  'auth/account-exists-with-different-credential':
    '同じメールで別のログイン方法のアカウントが存在します',
  'auth/credential-already-in-use':
    'この認証情報は別のアカウントで使用されています',
  'auth/popup-closed-by-user': 'ログインがキャンセルされました',
  'auth/cancelled-popup-request': 'ログインがキャンセルされました',
  'auth/web-storage-unsupported': 'ストレージが利用できません',

  // ネットワーク・一時的
  'auth/network-request-failed':
    'ネットワークエラーです。接続を確認してから再試行してください',
  'auth/timeout': 'タイムアウトしました。もう一度お試しください',
  'auth/too-many-requests':
    '試行回数が多すぎます。しばらく時間をおいてお試しください',
  'auth/internal-error':
    '一時的なエラーです。少し待ってからもう一度お試しください',
  'auth/quota-exceeded': '利用上限に達しました。時間をおいてお試しください',

  // アカウント状態
  'auth/user-disabled': 'このアカウントは無効化されています',
  'auth/requires-recent-login': '再度ログインが必要です',
  'auth/user-token-expired': 'セッションの有効期限が切れました。再ログインしてください',

  // Apple sign-in 側 (expo-apple-authentication)
  ERR_REQUEST_FAILED:
    'Apple サインインに失敗しました。少し待ってもう一度お試しください',
  ERR_REQUEST_NOT_INTERACTIVE: 'Apple サインインを開始できませんでした',
  ERR_REQUEST_UNKNOWN: 'Apple サインインで不明なエラーが発生しました',
  ERR_INVALID_RESPONSE: 'Apple から不正な応答を受け取りました',
};

const FALLBACK = 'ログインに失敗しました';

export interface AuthErrorDetail {
  message: string; // ユーザー向け本文
  code: string;    // 生エラーコード (Alert 末尾に [code] で出す)
  raw?: string;    // 追加情報 (message から先頭1行)
}

export function firebaseAuthErrorDetail(e: unknown): AuthErrorDetail {
  const code = (e as { code?: unknown })?.code;
  const codeStr =
    typeof code === 'string' && code.length > 0 ? code : 'unknown';
  const rawMessage =
    typeof (e as { message?: unknown })?.message === 'string'
      ? ((e as { message: string }).message ?? '').split('\n')[0]
      : undefined;

  if (codeStr in MESSAGES) {
    return { message: MESSAGES[codeStr], code: codeStr, raw: rawMessage };
  }
  // 未知コード: 本文は汎用、コードと message の頭を併記して原因特定に使う。
  return {
    message: FALLBACK,
    code: codeStr,
    raw: rawMessage,
  };
}

// 既存呼び出し互換: 文字列だけ欲しい場合のヘルパ。
export function firebaseAuthErrorToJa(e: unknown): string {
  return firebaseAuthErrorDetail(e).message;
}

// Alert の本文 1 つにまとめる (コードを必ず添えて原因特定可能に)。
export function formatAuthErrorAlert(e: unknown): string {
  const d = firebaseAuthErrorDetail(e);
  const tail = d.raw && d.raw !== d.message ? `\n${d.raw}` : '';
  return `${d.message}\n\n[${d.code}]${tail}`;
}
