// Firebase Auth / Apple Sign-In エラーをユーザー向け日本語に変換する。
//
// 方針:
//   - Alert に表示するのはユーザー向けメッセージのみ。生のエラーコードや
//     技術的な英文 message は出さない (テスターを混乱させない)。
//   - デバッグ用には console.error にコード/メッセージを構造化して残す
//     (Crashlytics 等を後から入れた時にも拾える形)。
//
// メッセージ辞書のポリシー:
//   - 各 code 別に「次に何をすれば良いか」が分かる行動指示を含める。
//     例: "アカウントが見つかりません。「新規登録」タブから登録してください"
//   - 既知 code に無いものは 1 種類の汎用 FALLBACK だけにまとめる。

const MESSAGES: Record<string, string> = {
  // Email/Password
  'auth/email-already-in-use':
    'このメールアドレスは既に使われています。「ログイン」タブから入ってください',
  'auth/invalid-email': 'メールアドレスの形式が正しくありません',
  'auth/wrong-password': 'メールアドレスまたはパスワードが正しくありません',
  'auth/user-not-found':
    'アカウントが見つかりません。「新規登録」タブから登録してください',
  'auth/weak-password': 'パスワードは6文字以上で入力してください',
  'auth/invalid-credential': 'メールアドレスまたはパスワードが正しくありません',
  'auth/missing-password': 'パスワードを入力してください',
  'auth/missing-email': 'メールアドレスを入力してください',

  // OAuth / Provider 系
  'auth/operation-not-allowed':
    'このログイン方法は現在利用できません',
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
    'ログイン試行回数が多すぎます。しばらくしてから再度お試しください',
  'auth/internal-error':
    '一時的なエラーです。少し待ってからもう一度お試しください',
  'auth/quota-exceeded': '利用上限に達しました。時間をおいてお試しください',

  // アカウント状態
  'auth/user-disabled': 'このアカウントは無効化されています',
  'auth/requires-recent-login': '再度ログインが必要です',
  'auth/user-token-expired':
    'セッションの有効期限が切れました。再ログインしてください',

  // Apple sign-in 側 (expo-apple-authentication)
  ERR_REQUEST_FAILED:
    'Apple サインインに失敗しました。少し待ってもう一度お試しください',
  ERR_REQUEST_NOT_INTERACTIVE: 'Apple サインインを開始できませんでした',
  ERR_REQUEST_UNKNOWN: 'Apple サインインで不明なエラーが発生しました',
  ERR_INVALID_RESPONSE: 'Apple から不正な応答を受け取りました',
};

const FALLBACK = 'ログインに失敗しました。もう一度お試しください';

export interface AuthErrorDetail {
  message: string; // ユーザー向け本文 (これだけ Alert に出す)
  code: string;    // 生エラーコード (console / 解析用、UI には出さない)
  raw?: string;    // Firebase が返した英文 message (デバッグ用)
}

export function firebaseAuthErrorDetail(e: unknown): AuthErrorDetail {
  const code = (e as { code?: unknown })?.code;
  const codeStr =
    typeof code === 'string' && code.length > 0 ? code : 'unknown';
  const rawMessage =
    typeof (e as { message?: unknown })?.message === 'string'
      ? ((e as { message: string }).message ?? '').split('\n')[0]
      : undefined;

  const message = codeStr in MESSAGES ? MESSAGES[codeStr] : FALLBACK;
  return { message, code: codeStr, raw: rawMessage };
}

// 既存呼び出し互換: 文字列だけ欲しい場合のヘルパ。
export function firebaseAuthErrorToJa(e: unknown): string {
  return firebaseAuthErrorDetail(e).message;
}

// Alert に表示する本文を組み立てる。
//
// 旧実装は [code] と raw 英文を末尾に併記してデバッグ用に視認できる形に
// していたが、ユーザー (テスター) に対して "[auth/invalid-credential]
// Firebase: Error (auth/invalid-credential)." のような技術的な文字列を
// 見せると不必要に混乱させる。
//
// 現方針: Alert にはユーザー向けメッセージのみ。エラーコード等は
// console.error に構造化して残し、後付けの Crashlytics/Sentry で拾う。
export function formatAuthErrorAlert(e: unknown): string {
  const d = firebaseAuthErrorDetail(e);
  // eslint-disable-next-line no-console
  console.error('[auth-error]', {
    code: d.code,
    rawMessage: d.raw,
    userMessage: d.message,
  });
  return d.message;
}
