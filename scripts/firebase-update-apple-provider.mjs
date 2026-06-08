// Apple Sign-In Provider の Services ID を更新するスクリプト
//
// 発生していた問題:
//   "The audience in ID Token [com.gokuyouofficial.kibunya] does not match
//    the expected audience com.kibunya.app"
//
//   iOS ネイティブの Sign in with Apple では identity token の aud (audience)
//   が **アプリの Bundle ID** になる。Firebase Apple Provider に
//   設定されている Services ID (= clientId) と一致する必要がある。
//   現在 Firebase は "com.kibunya.app" で設定されているため、
//   実 Bundle ID "com.gokuyouofficial.kibunya" と不一致で全 Apple Sign-In
//   が auth/invalid-credential で失敗する。
//
// このスクリプトの動作:
//   Google Identity Platform Admin REST API
//     PATCH /admin/v2/projects/{projectId}/defaultSupportedIdpConfigs/apple.com
//   で clientId フィールドを ASC_NEW_CLIENT_ID (= Bundle ID) に書き換える。
//
// 認証: Service Account (FIREBASE_SERVICE_ACCOUNT_KEY)。
//   scope: https://www.googleapis.com/auth/cloud-platform
//
// DRY_RUN モード (default true):
//   現在の clientId だけ表示して終了。書込前の状態確認用。
//   実適用は DRY_RUN=false で再実行。
//
// 必須 env:
//   FIREBASE_SERVICE_ACCOUNT_KEY  Service Account JSON 本文
// 任意 env:
//   FIREBASE_PROJECT_ID  (default: kibunyapjt)
//   NEW_CLIENT_ID        (default: com.gokuyouofficial.kibunya)
//   DRY_RUN              (default: "true")
import jwt from 'jsonwebtoken';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'kibunyapjt';
const NEW_CLIENT_ID =
  process.env.NEW_CLIENT_ID || 'com.gokuyouofficial.kibunya';
const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
const SA_JSON_STR = process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? '';

if (!SA_JSON_STR) {
  console.error(
    '[error] FIREBASE_SERVICE_ACCOUNT_KEY が未設定です。\n' +
      'Firebase Console → プロジェクトの設定 → サービスアカウント →\n' +
      '新しい秘密鍵の生成 で JSON をダウンロードし、本文を GitHub Secret\n' +
      'FIREBASE_SERVICE_ACCOUNT_KEY に登録してください。',
  );
  process.exit(1);
}

let sa;
try {
  sa = JSON.parse(SA_JSON_STR);
} catch (e) {
  console.error('[error] FIREBASE_SERVICE_ACCOUNT_KEY が JSON parse 失敗:', e.message);
  process.exit(1);
}

function header(s) {
  console.log('\n=== ' + s + ' ===');
}

// cloud-platform scope を使うと Identity Platform Admin / Firebase 系
// 含めて広めに通る。
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    sa.private_key,
    { algorithm: 'RS256' },
  );
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OAuth token exchange failed: HTTP ${res.status} ${text}`);
  }
  return JSON.parse(text).access_token;
}

const IDP_BASE = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/defaultSupportedIdpConfigs`;

async function getCurrent(token) {
  const url = `${IDP_BASE}/apple.com`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `GET apple.com config failed: HTTP ${res.status}\n${text}`,
    );
  }
  return JSON.parse(text);
}

async function patchClientId(token, newClientId) {
  const url =
    `${IDP_BASE}/apple.com` +
    `?updateMask=clientId`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ clientId: newClientId }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`PATCH apple.com config failed: HTTP ${res.status}\n${text}`);
  }
  return JSON.parse(text);
}

(async () => {
  try {
    console.log('Project ID    :', PROJECT_ID);
    console.log('SA client     :', sa.client_email);
    console.log('NEW_CLIENT_ID :', NEW_CLIENT_ID);
    console.log('DRY_RUN       :', DRY_RUN);

    header('Step 1: Google OAuth (Service Account JWT bearer)');
    const token = await getAccessToken();
    console.log('access_token: ' + token.slice(0, 20) + '... (length=' + token.length + ')');

    header('Step 2: 現在の Apple provider config を取得');
    let current;
    try {
      current = await getCurrent(token);
    } catch (e) {
      console.error(e.message);
      console.error(
        '\nヒント: Apple Provider がまだ Firebase で一度も有効化されていない可能性。\n' +
          '初回有効化は Firebase Console から行う必要があります (REST だけでは作れない場合あり)。',
      );
      process.exit(1);
    }
    console.log('現在の clientId :', current.clientId);
    console.log('enabled         :', current.enabled);

    if (current.clientId === NEW_CLIENT_ID) {
      console.log('\n→ 既に正しい値が設定されています。更新不要。');
      return;
    }

    header('Step 3: 更新計画');
    console.log(`  ${current.clientId}  →  ${NEW_CLIENT_ID}`);

    if (DRY_RUN) {
      console.log(
        '\n[DRY_RUN] 何も変更しません。実行する場合は workflow_dispatch で\n' +
          '          dry_run=false を選んで再実行してください。',
      );
      return;
    }

    header('Step 4: PATCH clientId');
    const updated = await patchClientId(token, NEW_CLIENT_ID);
    console.log('✓ 更新成功');
    console.log('更新後 clientId :', updated.clientId);
    console.log('enabled        :', updated.enabled);
  } catch (e) {
    console.error('\n[fatal]', e.message);
    process.exit(1);
  }
})();
