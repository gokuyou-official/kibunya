// moods コレクションの中身をそのまま出す調査スクリプト (読み取り専用)
//
// ★ GET のみ。作成・更新・削除は行わない。
// ★ public リポジトリなので個人情報は伏字。uid は調査に必要なので出す。
//
// 見たいこと:
//   - そもそも moods ドキュメントが作られているか
//   - closedAt が null のままか (null なら「生きている」判定になるはず)
//   - expiresAt が未来か
//   - recipientIds が空配列になっていないか
//   - フィールドの「型」(クライアントの判定は toMillis() に依存している)
//
// 必須 env: FIREBASE_SERVICE_ACCOUNT_KEY
// 任意 env: SENDER_UID (指定するとその人の分だけ絞る)
import jwt from 'jsonwebtoken';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'kibunyapjt';
const SA_JSON_STR = process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? '';
const SENDER_UID = (process.env.SENDER_UID ?? '').trim();

if (!SA_JSON_STR) {
  console.error('::error::FIREBASE_SERVICE_ACCOUNT_KEY が未設定');
  process.exit(1);
}
const sa = JSON.parse(SA_JSON_STR);
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

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

// フィールドの「型」も一緒に出す。判定は toMillis() 依存なので、
// timestampValue でないと壊れる。
function describe(f) {
  if (!f) return '(undefined)';
  const [type] = Object.keys(f);
  if (type === 'nullValue') return 'null (nullValue)';
  if (type === 'timestampValue') return `${f.timestampValue} (timestamp)`;
  if (type === 'stringValue') return `"${f.stringValue}" (string)`;
  if (type === 'arrayValue') {
    const vs = f.arrayValue.values ?? [];
    return `[${vs.length}件] (array)`;
  }
  return `${JSON.stringify(f[type])} (${type})`;
}

async function main() {
  console.log(`PROJECT_ID = ${PROJECT_ID}`);
  console.log(`SENDER_UID = ${SENDER_UID || '(絞り込みなし)'}`);
  console.log('MODE       = READ ONLY (GET のみ)');

  const token = await getToken();
  const res = await get(token, 'moods?pageSize=100');
  const docs = res?.documents ?? [];
  console.log(`\nmoods ドキュメント総数 = ${docs.length}`);

  const now = Date.now();
  for (const d of docs) {
    const id = d.name.split('/').pop();
    const f = d.fields ?? {};
    const senderId = f.senderId?.stringValue ?? '(なし)';
    if (SENDER_UID && senderId !== SENDER_UID) continue;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`moods/${id}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  senderId      = ${describe(f.senderId)}`);
    console.log(`  activity      = ${describe(f.activity)}`);
    console.log(`  area          = ${describe(f.area)}`);
    console.log(`  recipientIds  = ${describe(f.recipientIds)}`);
    for (const v of f.recipientIds?.arrayValue?.values ?? []) {
      console.log(`      · ${v.stringValue}`);
    }
    console.log(`  createdAt     = ${describe(f.createdAt)}`);
    console.log(`  expiresAt     = ${describe(f.expiresAt)}`);
    console.log(`  closedAt      = ${describe(f.closedAt)}`);
    console.log(`  (フィールド一覧 = ${Object.keys(f).join(', ')})`);
    console.log(`  doc createTime = ${d.createTime}`);
    console.log(`  doc updateTime = ${d.updateTime}`);

    // クライアントの判定を再現する
    const closedAtIsNull = 'nullValue' in (f.closedAt ?? {});
    const expMs = f.expiresAt?.timestampValue
      ? Date.parse(f.expiresAt.timestampValue)
      : null;
    console.log('  --- クライアント判定の再現 ---');
    console.log(`    closedAt == null で拾えるか : ${closedAtIsNull ? 'YES' : 'NO ★'}`);
    console.log(
      `    expiresAt は未来か          : ${
        expMs === null ? '判定不能 (timestamp でない) ★' : expMs > now ? 'YES' : 'NO (期限切れ)'
      }`,
    );
    if (expMs !== null) {
      const diff = Math.round((expMs - now) / 60000);
      console.log(`    残り                        : ${diff} 分`);
    }

    const reacts = await get(token, `moods/${id}/reactions?pageSize=100`);
    const rd = reacts?.documents ?? [];
    console.log(`  reactions = ${rd.length} 件`);
    for (const r of rd) console.log(`      · ${r.name.split('/').pop()}`);
  }

  console.log('\n完了 (読み取りのみ。データは変更していない)');
}

main().catch((e) => {
  console.error('[fatal]', e?.message ?? e);
  process.exit(1);
});
