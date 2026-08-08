// 本番で配信中の Firestore セキュリティルールを取得して全文出力する。
//
// ★ 読み取り専用。GET しか行わない。
//   ルールの作成 (createRuleset) / 反映 (updateRelease) は一切実装しない。
//   デプロイは別ワークフローの責務。
//
// 経路:
//   GET /v1/projects/{project}/releases           … リリース一覧
//     → cloud.firestore のリリースが参照する rulesetName を得る
//   GET /v1/{rulesetName}                          … ルール本文
//
// 出力は行指向。後段で機械的に切り出せるよう、本文を
//   ===RULES-BEGIN=== / ===RULES-END===
// で囲んで出す。
//
// 必須 env: FIREBASE_SERVICE_ACCOUNT_KEY (Service Account JSON 本文)
// 任意 env: FIREBASE_PROJECT_ID (既定 kibunyapjt)
//           RELEASE_NAME       (既定 cloud.firestore)
//           OUT_FILE           指定すると取得した本文をそのファイルに保存する。
//                              デプロイ前後の diff を取るために使う。
//                              (Firebase に対しては依然として GET のみ)
import fs from 'node:fs';
import jwt from 'jsonwebtoken';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'kibunyapjt';
const RELEASE_NAME = process.env.RELEASE_NAME || 'cloud.firestore';
const OUT_FILE = (process.env.OUT_FILE || '').trim();
const SA_JSON_STR = process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? '';

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

async function apiGet(token, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${url} failed: HTTP ${res.status}\n${text}`);
  return JSON.parse(text);
}

async function main() {
  console.log(`PROJECT_ID   = ${PROJECT_ID}`);
  console.log(`RELEASE_NAME = ${RELEASE_NAME}`);
  console.log(`SA client    = ${sa.client_email}`);
  console.log('MODE         = READ ONLY (GET のみ)');

  const token = await getAccessToken();

  header('1. リリース一覧');
  const releases = await apiGet(
    token,
    `https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/releases`,
  );
  const list = releases?.releases ?? [];
  if (list.length === 0) {
    console.log('  (リリースが1件も無い = ルールが一度もデプロイされていない)');
  }
  for (const r of list) {
    console.log(`  name=${r.name}`);
    console.log(`    rulesetName=${r.rulesetName}`);
    console.log(`    createTime=${r.createTime} updateTime=${r.updateTime}`);
  }

  // cloud.firestore のリリースを選ぶ。名前は
  // projects/{project}/releases/cloud.firestore の形。
  const target = list.find((r) => r.name?.endsWith(`/releases/${RELEASE_NAME}`));
  if (!target) {
    console.error(`::error::${RELEASE_NAME} のリリースが見つからない`);
    process.exit(1);
  }

  header('2. 配信中の ruleset');
  console.log(`  rulesetName = ${target.rulesetName}`);
  const ruleset = await apiGet(
    token,
    `https://firebaserules.googleapis.com/v1/${target.rulesetName}`,
  );
  console.log(`  createTime  = ${ruleset.createTime}`);

  const files = ruleset?.source?.files ?? [];
  console.log(`  ファイル数  = ${files.length}`);

  header('3. 配信中のルール本文 (全文)');
  for (const f of files) {
    console.log(`--- file: ${f.name} ---`);
    console.log(`===RULES-BEGIN===`);
    // content をそのまま出す。行末の空白等も改変しない。
    process.stdout.write(f.content.endsWith('\n') ? f.content : `${f.content}\n`);
    console.log(`===RULES-END===`);
    console.log(`(${f.content.length} 文字 / ${f.content.split('\n').length} 行)`);
  }

  if (OUT_FILE) {
    // firestore.rules は 1 ファイル構成の前提。複数あれば連結せず先頭を使い、
    // 想定外として警告する (黙って混ぜると diff が意味を失うため)。
    if (files.length !== 1) {
      console.log(`::warning::ファイルが ${files.length} 個ある。先頭のみ OUT_FILE に保存する`);
    }
    const content = files[0]?.content ?? '';
    fs.writeFileSync(OUT_FILE, content.endsWith('\n') ? content : `${content}\n`);
    console.log(`\nOUT_FILE に保存: ${OUT_FILE}`);
  }

  header('完了');
  console.log('読み取りのみ実行した。ルールの変更は行っていない。');
}

main().catch((e) => {
  console.error('[fatal]', e?.message ?? e);
  process.exit(1);
});
