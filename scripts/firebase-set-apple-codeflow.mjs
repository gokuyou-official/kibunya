// Firebase の Apple プロバイダに codeFlowConfig (teamId / keyId / privateKey)
// を登録する。これが無いと Identity Toolkit の accounts:revokeToken が
// サーバー側で失敗し、アカウント削除時の Apple トークン失効
// (App Store Guideline 5.1.1(v) 要件) が行われない。
//
// 秘密鍵の扱い:
//   privateKey は必ず GitHub Actions の secret (APPLE_SIGNIN_P8_KEY) から
//   環境変数で受け取る。workflow_dispatch の input は実行履歴に平文で残り、
//   public リポジトリでは誰でも閲覧できるため絶対に input で渡さないこと。
//   ログにも出力しない (長さと先頭/末尾の形式チェックのみ表示)。
//
// 必須 env:
//   FIREBASE_SERVICE_ACCOUNT_KEY  Firebase Admin 用サービスアカウント JSON
//   FIREBASE_PROJECT_ID           例: kibunyapjt
//   APPLE_TEAM_ID / APPLE_KEY_ID  Apple Developer の Team ID / Key ID
//   APPLE_SIGNIN_P8_KEY           Sign in with Apple 用 .p8 の本文
import crypto from 'node:crypto';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'kibunyapjt';
const TEAM_ID = (process.env.APPLE_TEAM_ID || '').trim();
const KEY_ID = (process.env.APPLE_KEY_ID || '').trim();
const PRIVATE_KEY = process.env.APPLE_SIGNIN_P8_KEY || '';
const DRY_RUN = String(process.env.DRY_RUN ?? 'false') === 'true';

function header(s) {
  console.log(`\n=== ${s} ===`);
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`::error::${msg}`);
    process.exit(1);
  }
}

// サービスアカウント JWT で Google OAuth アクセストークンを取得
async function getAccessToken() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  assert(raw, 'FIREBASE_SERVICE_ACCOUNT_KEY が未設定');
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const b64 = (o) =>
    Buffer.from(JSON.stringify(o))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claim)}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const sig = signer
    .sign(sa.private_key, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sig}`,
    }),
  });
  const text = await res.text();
  assert(res.ok, `OAuth token 取得失敗: HTTP ${res.status} ${text.slice(0, 300)}`);
  console.log(`  サービスアカウント: ${sa.client_email}`);
  return JSON.parse(text).access_token;
}

const IDP_URL = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/defaultSupportedIdpConfigs/apple.com`;

async function getConfig(token) {
  const res = await fetch(IDP_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  assert(res.ok, `GET apple.com config 失敗: HTTP ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// ⚠️ codeFlowConfig はトップレベルではなく appleSignInConfig の下にある。
// Identity Toolkit Admin API v2 の discovery document で確認済み:
//   DefaultSupportedIdpConfig
//     └ appleSignInConfig: AppleSignInConfig
//          ├ bundleIds: array
//          └ codeFlowConfig: { privateKey, teamId, keyId }
// 当初トップレベルとして読み書きしていたため、GET は常に「未設定」と表示し、
// PATCH は 400 "Unknown name codeFlowConfig" で失敗していた。
function describeConfig(cfg) {
  const apple = cfg.appleSignInConfig ?? {};
  const cf = apple.codeFlowConfig ?? {};
  console.log(`  clientId : ${cfg.clientId}`);
  console.log(`  enabled  : ${cfg.enabled}`);
  console.log(`  bundleIds: ${JSON.stringify(apple.bundleIds ?? [])}`);
  console.log(`  teamId   : ${cf.teamId ? `設定済 (${cf.teamId})` : '未設定'}`);
  console.log(`  keyId    : ${cf.keyId ? `設定済 (${cf.keyId})` : '未設定'}`);
  console.log(
    `  privateKey : ${cf.privateKey ? '設定済 (値は非表示)' : '未返却 (API が秘匿する場合あり)'}`,
  );
  return cf;
}

async function main() {
  header('入力チェック');
  assert(TEAM_ID, 'APPLE_TEAM_ID が未設定');
  assert(KEY_ID, 'APPLE_KEY_ID が未設定');
  assert(PRIVATE_KEY, 'APPLE_SIGNIN_P8_KEY が未設定 (GitHub secret に登録が必要)');
  // 鍵そのものはログに出さず、形式だけ検証する
  const looksPem =
    PRIVATE_KEY.includes('BEGIN PRIVATE KEY') && PRIVATE_KEY.includes('END PRIVATE KEY');
  console.log(`  teamId=${TEAM_ID} keyId=${KEY_ID}`);
  console.log(`  privateKey: ${PRIVATE_KEY.length} 文字 / PEM形式=${looksPem}`);
  assert(looksPem, 'APPLE_SIGNIN_P8_KEY が PEM 形式に見えない');
  // 実際に ES256 鍵として使えるかローカル検証 (Apple は ES256 を要求する)
  try {
    const key = crypto.createPrivateKey(PRIVATE_KEY);
    console.log(`  鍵の型: ${key.asymmetricKeyType} (期待値: ec)`);
    assert(key.asymmetricKeyType === 'ec', 'EC 鍵ではない。Sign in with Apple 用の .p8 か確認が必要');
  } catch (e) {
    assert(false, `秘密鍵を解析できない: ${e.message}`);
  }

  header('Google OAuth');
  const token = await getAccessToken();

  header('現在の Apple プロバイダ設定');
  const before = await getConfig(token);
  describeConfig(before);

  if (DRY_RUN) {
    console.log('\n[DRY_RUN] 書き込みは行わない');
    return;
  }

  header('appleSignInConfig.codeFlowConfig を PATCH');
  // updateMask=appleSignInConfig は appleSignInConfig 全体を置き換えるため、
  // 既存の bundleIds を GET 結果から引き継いで消さないようにする。
  const existingBundleIds = before.appleSignInConfig?.bundleIds;
  const appleSignInConfig = {
    codeFlowConfig: {
      teamId: TEAM_ID,
      keyId: KEY_ID,
      privateKey: PRIVATE_KEY,
    },
  };
  if (Array.isArray(existingBundleIds) && existingBundleIds.length > 0) {
    appleSignInConfig.bundleIds = existingBundleIds;
    console.log(`  既存 bundleIds を引き継ぐ: ${JSON.stringify(existingBundleIds)}`);
  }

  const res = await fetch(`${IDP_URL}?updateMask=appleSignInConfig`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ appleSignInConfig }),
  });
  const text = await res.text();
  if (!res.ok) {
    // エラー本文に鍵が含まれる可能性は低いが、念のため長さを制限して出す
    console.error(`::error::PATCH 失敗: HTTP ${res.status} ${text.slice(0, 500)}`);
    process.exit(1);
  }
  console.log('✓ PATCH 成功');

  header('反映後の確認');
  const after = await getConfig(token);
  const cf = describeConfig(after);
  if (cf.teamId === TEAM_ID && cf.keyId === KEY_ID) {
    console.log('\n🎉 codeFlowConfig 登録完了。accounts:revokeToken が機能する構成になった。');
  } else {
    console.error('::error::反映を確認できなかった');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('::error::', e?.message ?? String(e));
  process.exit(1);
});
