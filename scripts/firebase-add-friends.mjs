// Firestore に 2 ユーザーを双方向フレンド登録するスクリプト
//
// 認証: Service Account (Firebase Console → プロジェクトの設定 → サービスアカウント
//       → 新しい秘密鍵の生成 で JSON ダウンロード)。
//       JSON 本文を GitHub Secret FIREBASE_SERVICE_ACCOUNT_KEY に貼り付ける。
//
// 必須 env: FIREBASE_SERVICE_ACCOUNT_KEY  (Service Account JSON 本文)
// 任意 env:
//   USER_A    (email または uid)
//   USER_B    (email または uid)
//   DRY_RUN   (default "true". USER_A/B 両方が指定済の場合のみ意味を持つ)
//
// 動作:
//   1. /v1/projects/<pid>/databases/(default)/documents/users で全 user 一覧
//   2. USER_A / USER_B を email または uid で resolve
//   3. DRY_RUN なら書き込み計画だけ表示して終了
//   4. 実行モードなら以下 2 件を PATCH:
//        friends/<uidA>/friendsList/<uidB>  body: {addedAt: <now ISO>}
//        friends/<uidB>/friendsList/<uidA>  body: {addedAt: <now ISO>}
//
// Firestore Security Rules では各 friends doc に auth.uid == userId 要求があるが、
// Service Account はルールをバイパスするので双方向書き込み可能。
import jwt from 'jsonwebtoken';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'kibunyapjt';
const SA_JSON_STR = process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? '';
const USER_A = (process.env.USER_A ?? '').trim();
const USER_B = (process.env.USER_B ?? '').trim();
const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

if (!SA_JSON_STR) {
  console.error(
    '[error] FIREBASE_SERVICE_ACCOUNT_KEY が未設定です。\n' +
      'Firebase Console → プロジェクトの設定 → サービスアカウント → ' +
      '新しい秘密鍵の生成 で JSON をダウンロードし、本文を GitHub Secret ' +
      'FIREBASE_SERVICE_ACCOUNT_KEY に登録してください。',
  );
  process.exit(1);
}

let sa;
try {
  sa = JSON.parse(SA_JSON_STR);
} catch (e) {
  console.error('[error] FIREBASE_SERVICE_ACCOUNT_KEY が JSON として parse できません:', e.message);
  process.exit(1);
}

function header(s) {
  console.log('\n=== ' + s + ' ===');
}

// Google OAuth 2.0 access token を Service Account から取得。
// scope: Firestore データ操作 (datastore)
async function getAccessToken() {
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
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OAuth token exchange failed: HTTP ${res.status} ${text}`);
  }
  return JSON.parse(text).access_token;
}

const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function fsRequest(method, pathname, { token, body, query } = {}) {
  const url = new URL(FS_BASE + pathname);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Firestore ${method} ${url} → HTTP ${res.status}\n${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// Firestore Document → {uid, email, name, lastSeen} の素直な形に
function unwrap(doc) {
  const name = doc.name; // 'projects/.../documents/users/<uid>'
  const uid = name.split('/').pop();
  const fields = doc.fields ?? {};
  const get = (f) => {
    if (!f) return undefined;
    if ('stringValue' in f) return f.stringValue;
    if ('integerValue' in f) return Number(f.integerValue);
    if ('booleanValue' in f) return f.booleanValue;
    if ('timestampValue' in f) return f.timestampValue;
    return undefined;
  };
  return {
    uid,
    email: get(fields.email) ?? '',
    name: get(fields.name) ?? '',
    area: get(fields.area) ?? '',
  };
}

async function listAllUsers(token) {
  // pageSize 最大 1000 (まず一発で取りに行く)
  const data = await fsRequest('GET', '/users', { token, query: { pageSize: 1000 } });
  const docs = data?.documents ?? [];
  return docs.map(unwrap);
}

async function writeFriendDoc(token, ownerUid, friendUid, nowIso) {
  // PATCH (= upsert)。currentDocument を付けないことで既存上書きも許容。
  await fsRequest(
    'PATCH',
    `/friends/${encodeURIComponent(ownerUid)}/friendsList/${encodeURIComponent(friendUid)}`,
    {
      token,
      body: {
        fields: {
          addedAt: { timestampValue: nowIso },
        },
      },
    },
  );
}

(async () => {
  try {
    console.log('Project ID :', PROJECT_ID);
    console.log('SA client  :', sa.client_email);
    console.log('USER_A     :', USER_A || '(unset)');
    console.log('USER_B     :', USER_B || '(unset)');
    console.log('DRY_RUN    :', DRY_RUN);

    header('Google OAuth (Service Account JWT bearer)');
    const token = await getAccessToken();
    console.log('access_token: ' + token.slice(0, 20) + '... (length=' + token.length + ')');

    header('users コレクション一覧');
    const users = await listAllUsers(token);
    if (users.length === 0) {
      console.log('(空)');
    } else {
      console.log(['uid', 'email', 'name'].join('\t'));
      for (const u of users) {
        console.log([u.uid, u.email || '-', u.name || '-'].join('\t'));
      }
      console.log(`合計: ${users.length}名`);
    }

    if (!USER_A || !USER_B) {
      header('USER_A / USER_B が未指定のため終了 (一覧表示のみ)');
      console.log('再実行時に workflow の inputs で 2 ユーザーの email または uid を指定してください。');
      return;
    }

    const matchA = users.find((u) => u.uid === USER_A || u.email.toLowerCase() === USER_A.toLowerCase());
    const matchB = users.find((u) => u.uid === USER_B || u.email.toLowerCase() === USER_B.toLowerCase());

    header('解決結果');
    console.log('USER_A:', matchA ? `${matchA.uid} (${matchA.email})` : '✗ 見つかりません');
    console.log('USER_B:', matchB ? `${matchB.uid} (${matchB.email})` : '✗ 見つかりません');
    if (!matchA || !matchB) {
      throw new Error('USER_A / USER_B のいずれかが users コレクションに存在しません');
    }
    if (matchA.uid === matchB.uid) {
      throw new Error('USER_A と USER_B が同一ユーザーです');
    }

    header('書き込み計画');
    const nowIso = new Date().toISOString();
    console.log(`  PATCH friends/${matchA.uid}/friendsList/${matchB.uid}  body: {addedAt: ${nowIso}}`);
    console.log(`  PATCH friends/${matchB.uid}/friendsList/${matchA.uid}  body: {addedAt: ${nowIso}}`);

    if (DRY_RUN) {
      header('DRY RUN モード — 書き込みません');
      console.log('実行する場合は workflow_dispatch で dry_run=false を選んで再実行してください。');
      return;
    }

    header('実行 (DRY_RUN=false)');
    await writeFriendDoc(token, matchA.uid, matchB.uid, nowIso);
    console.log(`  ✓ friends/${matchA.uid}/friendsList/${matchB.uid}`);
    await writeFriendDoc(token, matchB.uid, matchA.uid, nowIso);
    console.log(`  ✓ friends/${matchB.uid}/friendsList/${matchA.uid}`);
    console.log('\n双方向のフレンド登録が完了しました。');
  } catch (e) {
    console.error('\n[fatal]', e.message);
    process.exit(1);
  }
})();
