// 招待リンクの uid を Firestore 上で逆引きする調査スクリプト (読み取り専用)
//
// ★ GET のみ。ドキュメントの作成・更新・削除は一切行わない。
//
// ★★ プライバシー: このリポジトリは public で、Actions のログも公開される。
//    メールアドレスや氏名をそのまま出力しない。存在有無・長さ・伏字のみ。
//
// 調べること:
//   - uid ごとに users/{uid} が存在するか (= サインアップ完了しているか)
//   - createdAt / lastSeen (アカウント作成と最終利用の時刻)
//   - friends/{uid}/friendsList の件数と相手 uid
//     → 「フレンド登録が成功したか」を直接判定できる
//
// 必須 env: FIREBASE_SERVICE_ACCOUNT_KEY
// 任意 env: UIDS (カンマ区切り), FIREBASE_PROJECT_ID
import jwt from 'jsonwebtoken';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'kibunyapjt';
const SA_JSON_STR = process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? '';
const UIDS = (process.env.UIDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!SA_JSON_STR) {
  console.error('::error::FIREBASE_SERVICE_ACCOUNT_KEY が未設定');
  process.exit(1);
}
if (UIDS.length === 0) {
  console.error('::error::UIDS が未設定');
  process.exit(1);
}

const sa = JSON.parse(SA_JSON_STR);
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// 値そのものは出さず、判定に必要な情報だけに落とす
function mask(v) {
  if (v === undefined || v === null) return '(なし)';
  const s = String(v);
  if (s.length === 0) return '(空文字)';
  return `${s.slice(0, 1)}***(${s.length}文字)`;
}
function header(s) {
  console.log(`\n${'='.repeat(64)}\n${s}\n${'='.repeat(64)}`);
}

async function getToken() {
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/datastore',
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
  const t = await res.text();
  if (!res.ok) throw new Error(`token failed: ${res.status} ${t}`);
  return JSON.parse(t).access_token;
}

async function get(token, path) {
  const res = await fetch(`${BASE}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  const t = await res.text();
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}\n${t}`);
  return JSON.parse(t);
}

// Firestore REST の値表現をほどく
function val(f) {
  if (!f) return undefined;
  if ('stringValue' in f) return f.stringValue;
  if ('timestampValue' in f) return f.timestampValue;
  if ('booleanValue' in f) return f.booleanValue;
  if ('integerValue' in f) return f.integerValue;
  if ('arrayValue' in f) return (f.arrayValue.values ?? []).map(val);
  return JSON.stringify(f);
}

async function main() {
  console.log(`PROJECT_ID = ${PROJECT_ID}`);
  console.log('MODE       = READ ONLY (GET のみ)');
  console.log('※ 個人情報は伏字。値そのものは出力しない');

  const token = await getToken();

  for (const uid of UIDS) {
    header(`uid = ${uid}`);
    const u = await get(token, `users/${uid}`);
    if (!u) {
      console.log('  users/{uid} … 存在しない');
      console.log('  → このアカウントはサインアップ未完了、または uid が誤り');
    } else {
      const f = u.fields ?? {};
      console.log('  users/{uid} … 存在する (サインアップ完了)');
      console.log(`    name       = ${mask(val(f.name))}`);
      console.log(`    email      = ${mask(val(f.email))}`);
      console.log(`    createdAt  = ${val(f.createdAt) ?? '(なし)'}`);
      console.log(`    lastSeen   = ${val(f.lastSeen) ?? '(なし)'}`);
      console.log(`    fcmToken   = ${f.fcmToken ? 'あり' : '(なし)'}`);
      console.log(`    interests  = ${JSON.stringify(val(f.interests) ?? [])}`);
      console.log(`    ドキュメント作成時刻 = ${u.createTime}`);
      console.log(`    最終更新時刻         = ${u.updateTime}`);
    }

    const fl = await get(token, `friends/${uid}/friendsList`);
    const docs = fl?.documents ?? [];
    console.log(`  friendsList … ${docs.length} 件`);
    for (const d of docs) {
      const id = d.name.split('/').pop();
      const df = d.fields ?? {};
      console.log(
        `    · ${id} addedAt=${val(df.addedAt) ?? '(なし)'} active=${
          df.active ? val(df.active) : '(未設定=有効)'
        } created=${d.createTime}`,
      );
    }
  }

  header('完了');
  console.log('読み取りのみ実行した。データは一切変更していない。');
}

main().catch((e) => {
  console.error('[fatal]', e?.message ?? e);
  process.exit(1);
});
