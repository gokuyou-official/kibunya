// リポジトリの firestore.rules を本番 (Firebase) に反映する。
//
// ■ なぜ firebase-tools を使わないか
//   `firebase deploy --only firestore:rules` は実行前に
//     GET https://serviceusage.googleapis.com/v1/projects/{p}/services/firestore.googleapis.com
//   を叩いて「API が有効か」を確認する。デプロイ用のサービスアカウントには
//   Service Usage の閲覧権限が無く、ここで 403 になって本題に入れない。
//     Permission denied to get service [firestore.googleapis.com]
//   ルール反映そのものに Service Usage 権限は要らないので、
//   Firebase Rules API を直接叩いて回避する。付与する権限も増えない。
//
// ■ 経路 (この 2 つだけ)
//   POST  /v1/projects/{project}/rulesets              … ruleset を作る
//   PATCH /v1/projects/{project}/releases/{release}    … 配信を差し替える
//   ※ firestore:rules 以外 (functions / hosting / indexes) には一切触れない。
//     そもそもこの API で触れるのはルールだけ。
//
// ■ 安全装置
//   1. DRY_RUN != 'false' なら書き込みを一切行わない (既定は dry run)。
//   2. 反映前の配信中 ruleset 名を出力する (切り戻し先の記録)。
//   3. 配信中とリポジトリが同一なら何もしない。
//   4. 反映後に GET し直し、リポジトリの中身と完全一致するか検証する。
//      一致しなければ exit 1。
//
// 必須 env: FIREBASE_SERVICE_ACCOUNT_KEY (Service Account JSON 本文)
//           DRY_RUN ('false' の時だけ書き込む)
// 任意 env: FIREBASE_PROJECT_ID (既定 kibunyapjt)
//           RELEASE_NAME       (既定 cloud.firestore)
//           RULES_FILE         (既定 firestore.rules)
import fs from 'node:fs';
import jwt from 'jsonwebtoken';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'kibunyapjt';
const RELEASE_NAME = process.env.RELEASE_NAME || 'cloud.firestore';
const RULES_FILE = process.env.RULES_FILE || 'firestore.rules';
// 既定は dry run。'false' という明示的な文字列の時だけ書き込む。
const DRY_RUN = (process.env.DRY_RUN ?? 'true').trim() !== 'false';
const SA_JSON_STR = process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? '';

const API = 'https://firebaserules.googleapis.com/v1';

if (!SA_JSON_STR) {
  console.error('::error::FIREBASE_SERVICE_ACCOUNT_KEY が未設定');
  process.exit(1);
}

let sa;
try {
  sa = JSON.parse(SA_JSON_STR);
} catch (e) {
  console.error('::error::FIREBASE_SERVICE_ACCOUNT_KEY の JSON parse に失敗:', e.message);
  process.exit(1);
}

function header(s) {
  console.log(`\n${'='.repeat(60)}\n${s}\n${'='.repeat(60)}`);
}

// ルール本文は末尾改行の有無だけで不一致になりうる。比較・送信の前に正規化する。
function normalize(s) {
  return s.endsWith('\n') ? s : `${s}\n`;
}

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
  if (!res.ok) throw new Error(`OAuth token exchange failed: HTTP ${res.status} ${text}`);
  return JSON.parse(text).access_token;
}

async function api(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} failed: HTTP ${res.status}\n${text}`);
  return text ? JSON.parse(text) : {};
}

// 配信中のルール本文と ruleset 名を返す
async function fetchDeployed(token) {
  const releases = await api(token, 'GET', `${API}/projects/${PROJECT_ID}/releases`);
  const list = releases?.releases ?? [];
  const target = list.find((r) => r.name?.endsWith(`/releases/${RELEASE_NAME}`));
  if (!target) return { rulesetName: null, content: null };
  const ruleset = await api(token, 'GET', `${API}/${target.rulesetName}`);
  const files = ruleset?.source?.files ?? [];
  if (files.length !== 1) {
    console.log(`::warning::配信中の ruleset のファイル数が ${files.length} 個 (想定は 1)`);
  }
  return {
    rulesetName: target.rulesetName,
    content: files[0]?.content != null ? normalize(files[0].content) : null,
  };
}

async function main() {
  const local = normalize(fs.readFileSync(RULES_FILE, 'utf8'));

  console.log(`PROJECT_ID   = ${PROJECT_ID}`);
  console.log(`RELEASE_NAME = ${RELEASE_NAME}`);
  console.log(`RULES_FILE   = ${RULES_FILE} (${local.length} 文字 / ${local.split('\n').length} 行)`);
  console.log(`SA client    = ${sa.client_email}`);
  console.log(`MODE         = ${DRY_RUN ? 'DRY RUN (書き込みなし)' : 'DEPLOY (書き込む)'}`);

  const token = await getAccessToken();

  header('1. 反映前の配信中ルール');
  const before = await fetchDeployed(token);
  console.log(`  rulesetName = ${before.rulesetName ?? '(リリース無し)'}`);
  console.log('  ★ 切り戻し先はこの rulesetName');

  if (before.content === local) {
    header('完了 (変更なし)');
    console.log('配信中のルールとリポジトリは既に一致している。何もしない。');
    return;
  }

  if (DRY_RUN) {
    header('DRY RUN のため終了');
    console.log('書き込みは行っていない。反映するには DRY_RUN=false で実行する。');
    return;
  }

  header('2. ruleset を作成');
  // ここで構文エラーがあれば API 側が 400 を返す。不正なルールが
  // release に載ることはない (作成と配信が別段階なので安全)。
  const created = await api(token, 'POST', `${API}/projects/${PROJECT_ID}/rulesets`, {
    source: { files: [{ name: RULES_FILE, content: local }] },
  });
  console.log(`  新 rulesetName = ${created.name}`);
  console.log(`  createTime     = ${created.createTime}`);

  header('3. リリースを差し替え');
  const releaseFullName = `projects/${PROJECT_ID}/releases/${RELEASE_NAME}`;
  const updated = await api(token, 'PATCH', `${API}/${releaseFullName}`, {
    release: { name: releaseFullName, rulesetName: created.name },
  });
  console.log(`  release     = ${updated.name}`);
  console.log(`  rulesetName = ${updated.rulesetName}`);

  header('4. 反映後の検証 (GET し直して全文比較)');
  const after = await fetchDeployed(token);
  console.log(`  rulesetName = ${after.rulesetName}`);
  if (after.content !== local) {
    console.error('::error::反映後の配信ルールがリポジトリの内容と一致しない');
    console.error('--- 配信中 ---');
    console.error(after.content ?? '(取得できず)');
    console.error('--- リポジトリ ---');
    console.error(local);
    process.exit(1);
  }
  console.log('  ✓ 配信中のルールがリポジトリと完全一致した');

  header('完了');
  console.log(`切り戻し先 (反映前の ruleset): ${before.rulesetName ?? '(無し)'}`);
}

main().catch((e) => {
  console.error('[fatal]', e?.message ?? e);
  process.exit(1);
});
