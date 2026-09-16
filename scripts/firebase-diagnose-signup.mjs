// Firebase Auth REST API 診断スクリプト — 新規 Email signup の挙動確認
//
// 目的:
//   "新規ユーザーだけログイン失敗する" 事象の原因切り分け。
//   アプリ経由ではなく Firebase REST API を直接叩くことで、Firebase 側の
//   判定結果 (エラーコード) を確実に取得する。ビルド不要。
//
// API:
//   POST https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=<API_KEY>
//   body: { email, password, returnSecureToken: true }
//
// 流れ:
//   1. ユニークなテスト email でアカウント作成を試行
//   2. 成功した場合: localId を表示 → accounts:delete で即削除 (テストデータ残さない)
//   3. 失敗した場合: HTTP status / error.code / error.message を表示し、
//      代表的なケースを日本語で解釈
//
// 必須 env: なし (Web API Key は public のため firebase.ts と同じ値を埋め込み)
// 任意 env:
//   FIREBASE_API_KEY  上書き
//   FIREBASE_PROJECT_ID  表示用 (default: kibunyapjt)

const API_KEY =
  process.env.FIREBASE_API_KEY ||
  'AIzaSyAUbgIu2bsYHsUreMBHhgXK0yGx2negtF8';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'kibunyapjt';
const BASE = 'https://identitytoolkit.googleapis.com/v1';

// 衝突しないよう毎回ユニーク化 (削除に失敗してもプロジェクトを汚しにくい)。
const TEST_EMAIL = `diag+${Date.now()}@kibunya-diag.example.com`;
const TEST_PASSWORD = 'DiagTestPass!2026';

function header(s) {
  console.log('\n=== ' + s + ' ===');
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, ok: res.ok, json, text };
}

function interpret(errMsg) {
  const m = String(errMsg ?? '');
  const lines = [];
  if (m.includes('OPERATION_NOT_ALLOWED')) {
    lines.push(
      '→ Email/Password Provider が Firebase Console で無効化されています。',
      '  Authentication → Sign-in method → Email/Password を Enable してください。',
    );
  }
  if (m.includes('ADMIN_ONLY_OPERATION')) {
    lines.push(
      '→ User actions で sign-up が無効化されています (Identity Platform 設定)。',
      '  Authentication → Settings → User actions → "Enable create (sign-up)" を ON。',
    );
  }
  if (m.includes('EMAIL_EXISTS')) {
    lines.push(
      '→ テスト email が既に存在 (この診断としては想定外。同じ run で再試行を推奨)。',
    );
  }
  if (m.includes('WEAK_PASSWORD')) {
    lines.push('→ パスワード強度不足 (スクリプト側の問題なので想定外)。');
  }
  if (m.includes('TOO_MANY_ATTEMPTS')) {
    lines.push('→ レート制限。少し待ってから再試行してください。');
  }
  if (m.includes('APP_CHECK') || m.includes('appcheck')) {
    lines.push(
      '→ App Check enforcement が有効。App Check トークンなしの REST 呼び出しが弾かれています。',
      '  Firebase Console → App Check で REST API enforcement を確認。',
    );
  }
  if (m.includes('INVALID_EMAIL')) {
    lines.push('→ Email 形式不正 (スクリプト側の問題)。');
  }
  if (m.includes('PASSWORD_DOES_NOT_MEET_REQUIREMENTS')) {
    lines.push(
      '→ Firebase Console の Password policy 要件を満たしていません。',
      '  Authentication → Settings → Password policy を確認。',
    );
  }
  if (lines.length === 0) {
    lines.push('→ 既知パターン外。Firebase Auth REST error code を ドキュメントで確認してください。');
  }
  return lines.join('\n');
}

async function deleteAccount(idToken) {
  return await postJSON(`${BASE}/accounts:delete?key=${API_KEY}`, { idToken });
}

(async () => {
  console.log('Project ID    :', PROJECT_ID);
  console.log('API Key (head):', API_KEY.slice(0, 10) + '...');
  console.log('Test email    :', TEST_EMAIL);

  header('Step 1: signUp REST API call');
  const signup = await postJSON(`${BASE}/accounts:signUp?key=${API_KEY}`, {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    returnSecureToken: true,
  });
  console.log('HTTP status:', signup.status);

  if (!signup.ok) {
    const err = signup.json?.error ?? {};
    console.log('error.code    :', err.code ?? '(none)');
    console.log('error.message :', err.message ?? '(none)');
    console.log('error.status  :', err.status ?? '(none)');
    if (err.errors?.length) {
      console.log('error.errors  :', JSON.stringify(err.errors, null, 2));
    }
    if (!signup.json) console.log('raw text      :', signup.text);
    header('判定');
    console.log(interpret(err.message));
    process.exit(1);
  }

  // 成功
  console.log('✓ Signup succeeded');
  console.log('  localId :', signup.json.localId);
  console.log('  email   :', signup.json.email);
  console.log('  idToken :', String(signup.json.idToken).slice(0, 20) + '...');

  header('Step 2: cleanup (accounts:delete)');
  const del = await deleteAccount(signup.json.idToken);
  console.log('HTTP status:', del.status);
  if (del.ok) {
    console.log('✓ Test account deleted (localId=' + signup.json.localId + ')');
  } else {
    console.log('✗ Delete failed — 残留テストアカウントを Firebase Console から手動削除してください');
    console.log('  email   :', signup.json.email);
    console.log('  localId :', signup.json.localId);
    console.log('  error   :', JSON.stringify(del.json ?? del.text));
  }

  header('判定');
  console.log('→ Email/Password での新規 sign-up は Firebase 側で「成功」しました。');
  console.log('  つまり Email 経路の失敗原因はアプリ側 (またはネットワーク/');
  console.log('  クライアント側の処理) にある可能性が高いです。');
  console.log('  - クライアントコードの createUserWithEmailAndPassword 呼び出し');
  console.log('  - Web SDK と REST のセキュリティポリシー差 (App Check 等)');
  console.log('  を順に切り分けてください。');
})();
