// Firebase Auth プロジェクト設定診断スクリプト
//
// 目的:
//   Web API Key だけで取得できる範囲のサイン設定を出力する。
//   "新規ユーザー失敗" の原因切り分け補助。
//
// 取得できるもの (公開 REST 経由):
//   - email/password / anonymous / phone の enable 状態
//   - allowDuplicateEmails
//   - authorizedDomains
//   - signIn.email.passwordRequired
//
// 取得できないもの (Admin SDK 認証が必要):
//   - Apple Provider の Services ID / Team ID / Key ID 詳細
//   - SAML / OIDC プロバイダー設定
//   - User actions (sign-up 有効化 ON/OFF)
//   - Email enumeration protection ON/OFF
//   - App Check enforcement ON/OFF
//
//   → これらは Firebase Console で目視確認が必要。

const API_KEY =
  process.env.FIREBASE_API_KEY ||
  'AIzaSyAUbgIu2bsYHsUreMBHhgXK0yGx2negtF8';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'kibunyapjt';

function header(s) {
  console.log('\n=== ' + s + ' ===');
}

(async () => {
  console.log('Project ID    :', PROJECT_ID);
  console.log('API Key (head):', API_KEY.slice(0, 10) + '...');

  header('GET /v1/projects (public REST)');
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects?key=${API_KEY}`,
  );
  const text = await res.text();
  console.log('HTTP status:', res.status);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}

  if (!res.ok) {
    console.log('error:', json?.error ?? text);
    process.exit(1);
  }

  const signIn = json.signIn ?? {};
  console.log('\nSign-in providers (公開フラグ):');
  console.log(
    '  email.enabled         :',
    signIn.email?.enabled ?? '(unset)',
  );
  console.log(
    '  email.passwordRequired:',
    signIn.email?.passwordRequired ?? '(unset)',
  );
  console.log(
    '  anonymous.enabled     :',
    signIn.anonymous?.enabled ?? '(unset)',
  );
  console.log(
    '  phoneNumber.enabled   :',
    signIn.phoneNumber?.enabled ?? '(unset)',
  );
  console.log(
    '  allowDuplicateEmails  :',
    signIn.allowDuplicateEmails ?? '(unset)',
  );

  const domains = json.authorizedDomains ?? [];
  console.log('\nAuthorized domains:');
  for (const d of domains) console.log('  -', d);

  header('Apple Provider — 取得不可項目');
  console.log('Apple Provider の Services ID / Team ID / Key ID は');
  console.log('Admin SDK 認証 (service account JSON) が必要なため、');
  console.log('Web API Key だけのこのスクリプトでは取得できません。');
  console.log('');
  console.log('Firebase Console で目視確認してください:');
  console.log(
    `  https://console.firebase.google.com/project/${PROJECT_ID}/authentication/providers`,
  );
  console.log('');
  console.log('Apple カードをクリックして以下が空白でないことを確認:');
  console.log('  - Services ID  (例 com.gokuyouofficial.kibunya.signin)');
  console.log('  - Apple Team ID (HR8PFR4Y3W)');
  console.log('  - Key ID  (Sign in with Apple 用、ASC API key とは別)');
  console.log('  - Private key (Sign in with Apple 用 .p8 内容)');

  header('User actions / Email enum protection / App Check も Console で確認');
  console.log(
    `  https://console.firebase.google.com/project/${PROJECT_ID}/authentication/settings`,
  );
  console.log('  - User actions: "Enable create (sign-up)" が ON か');
  console.log('  - Email enumeration protection: 状態 (newer Firebase の機能)');
  console.log(
    `  https://console.firebase.google.com/project/${PROJECT_ID}/appcheck`,
  );
  console.log('  - App Check enforcement: Auth / Identity Toolkit が enforce か');
})();
