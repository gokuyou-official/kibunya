// Apple Sign-In 用の nonce ヘルパ。useAuth (新規ログイン) と
// accountDeletion (再認証) の両方から使う共通ロジック。
export function generateRawNonce(length = 32): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
