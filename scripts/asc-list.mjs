// App Store Connect API v1 — TestFlight tester / build 一覧表示スクリプト
//
// 実行方法:
//   ローカル: node --env-file=.env scripts/asc-list.mjs
//   CI:       node scripts/asc-list.mjs (env 変数は workflow から注入)
//
// 認証: ES256 JWT (ASC API 仕様)
//   - header.alg = ES256
//   - header.kid = ASC_KEY_ID
//   - payload.iss = ASC_ISSUER_ID
//   - payload.aud = "appstoreconnect-v1"
//   - payload.exp = iat + 20 分 (上限)
//
// 必要 npm パッケージ: jsonwebtoken
//
// 秘密鍵の取得元 (どちらか一方を設定):
//   1) ASC_P8_KEY      — P8 本文を直接環境変数で渡す (CI 推奨)
//   2) ASC_P8_KEY_PATH — ローカルファイルへのパス (ローカル開発用)
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const {
  ASC_ISSUER_ID,
  ASC_KEY_ID,
  ASC_P8_KEY,
  ASC_P8_KEY_PATH,
  ASC_APP_ID,
  ASC_BUNDLE_ID,
} = process.env;

function assertEnv(name, value) {
  if (!value) {
    console.error(`[error] 環境変数 ${name} が未設定です (.env または workflow secrets を確認)`);
    process.exit(1);
  }
}
assertEnv('ASC_ISSUER_ID', ASC_ISSUER_ID);
assertEnv('ASC_KEY_ID', ASC_KEY_ID);
assertEnv('ASC_APP_ID', ASC_APP_ID);

let privateKey;
if (ASC_P8_KEY && ASC_P8_KEY.includes('BEGIN PRIVATE KEY')) {
  // CI: 環境変数 ASC_P8_KEY に P8 本文 (PEM) が入っている
  privateKey = ASC_P8_KEY;
} else if (ASC_P8_KEY_PATH) {
  // ローカル: ファイルから読む
  const keyPath = path.resolve(ASC_P8_KEY_PATH);
  if (!fs.existsSync(keyPath)) {
    console.error(`[error] P8 キーが見つかりません: ${keyPath}`);
    process.exit(1);
  }
  privateKey = fs.readFileSync(keyPath, 'utf8');
} else {
  console.error('[error] ASC_P8_KEY か ASC_P8_KEY_PATH のいずれかを設定してください');
  process.exit(1);
}

function generateToken() {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: ASC_ISSUER_ID,
      iat: now,
      exp: now + 20 * 60,
      aud: 'appstoreconnect-v1',
    },
    privateKey,
    {
      algorithm: 'ES256',
      header: { alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' },
    },
  );
}

const token = generateToken();
const API = 'https://api.appstoreconnect.apple.com/v1';

async function api(pathname, query = {}) {
  const url = new URL(API + pathname);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} ${res.statusText} for ${url}\n${text}`,
    );
  }
  return JSON.parse(text);
}

function fmt(date) {
  if (!date) return '-';
  return new Date(date).toISOString().replace('T', ' ').slice(0, 19);
}

async function listBuilds() {
  console.log('\n=== Builds (app=' + ASC_APP_ID + ') ===');
  const data = await api('/builds', {
    'filter[app]': ASC_APP_ID,
    sort: '-uploadedDate',
    limit: 20,
  });
  if (!data.data?.length) {
    console.log('(ビルド無し)');
    return;
  }
  console.log(
    ['version', 'build#', 'state', 'uploaded', 'expired'].join('\t'),
  );
  for (const b of data.data) {
    const a = b.attributes ?? {};
    console.log(
      [
        a.version ?? '-',
        a.buildNumber ?? '-',
        a.processingState ?? '-',
        fmt(a.uploadedDate),
        a.expired ? 'expired' : '-',
      ].join('\t'),
    );
  }
}

async function listBetaTesters() {
  console.log('\n=== Beta Testers (app=' + ASC_APP_ID + ') ===');
  // /v1/betaTesters?filter[apps]=<appId> で対象アプリのテスター取得
  const data = await api('/betaTesters', {
    'filter[apps]': ASC_APP_ID,
    limit: 100,
  });
  if (!data.data?.length) {
    console.log('(テスター無し)');
    return;
  }
  console.log(['email', 'firstName', 'lastName', 'inviteType'].join('\t'));
  for (const t of data.data) {
    const a = t.attributes ?? {};
    console.log(
      [
        a.email ?? '-',
        a.firstName ?? '-',
        a.lastName ?? '-',
        a.inviteType ?? '-',
      ].join('\t'),
    );
  }
  console.log(`合計: ${data.data.length}名`);
}

async function listBetaGroups() {
  console.log('\n=== Beta Groups (app=' + ASC_APP_ID + ') ===');
  const data = await api('/betaGroups', {
    'filter[app]': ASC_APP_ID,
    limit: 50,
  });
  if (!data.data?.length) {
    console.log('(ベータグループ無し)');
    return;
  }
  console.log(['name', 'isInternalGroup', 'publicLinkEnabled'].join('\t'));
  for (const g of data.data) {
    const a = g.attributes ?? {};
    console.log(
      [
        a.name ?? '-',
        a.isInternalGroup ? 'internal' : 'external',
        a.publicLinkEnabled ? 'public' : '-',
      ].join('\t'),
    );
  }
}

(async () => {
  try {
    console.log('Bundle ID :', ASC_BUNDLE_ID ?? '-');
    console.log('App ID    :', ASC_APP_ID);
    console.log('Key ID    :', ASC_KEY_ID);
    await listBuilds();
    await listBetaGroups();
    await listBetaTesters();
  } catch (e) {
    console.error('[error]', e.message);
    process.exit(1);
  }
})();
