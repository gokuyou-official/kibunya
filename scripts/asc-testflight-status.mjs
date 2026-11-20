// App Store Connect API v1 — TestFlight 配布状況の調査 (読み取り専用)
//
// ★ GET のみ。betaGroups の作成・publicLink の有効化などの
//   書き込みは一切行わない。判断材料を出すだけ。
//
// 調べること:
//   1. betaGroups 一覧 (内部 / 外部、公開リンクの有無と URL)
//   2. 各グループのテスター数
//   3. ビルド一覧と、外部配布に必須の Beta App Review の状態
//   4. 外部テスト提出に必要なメタデータ (betaAppReviewDetail /
//      betaAppLocalizations / betaBuildLocalizations) の充足状況
//
// 必須 env: ASC_ISSUER_ID / ASC_KEY_ID / ASC_P8_KEY (or ASC_P8_KEY_PATH)
//           ASC_APP_ID
import { buildAscClient, fmtDate } from './lib/asc-auth.mjs';

const { ASC_APP_ID } = process.env;
if (!ASC_APP_ID) {
  console.error('::error::ASC_APP_ID が未設定');
  process.exit(1);
}

const asc = buildAscClient();

function header(s) {
  console.log(`\n${'='.repeat(64)}\n${s}\n${'='.repeat(64)}`);
}

// ASC の JSON:API は include= を付けないと relationships.data が空で返る。
// 「未設定」と誤読する事故が何度も起きているので、必ず include を明示する。
async function safe(label, fn) {
  try {
    return await fn();
  } catch (e) {
    console.log(`  [${label}] 取得失敗: HTTP ${e.status ?? '?'} ${e.message?.split('\n')[0] ?? e}`);
    return null;
  }
}

async function main() {
  console.log(`ASC_APP_ID = ${ASC_APP_ID}`);
  console.log('MODE       = READ ONLY (GET のみ)');

  header('1. Beta Groups');
  const groups = await asc.get(`/apps/${ASC_APP_ID}/betaGroups`, { limit: 200 });
  const list = groups?.data ?? [];
  if (list.length === 0) console.log('  (グループが1件も無い)');

  for (const g of list) {
    const a = g.attributes ?? {};
    console.log(`\n  - name              = ${a.name}`);
    console.log(`    id                = ${g.id}`);
    console.log(`    isInternalGroup   = ${a.isInternalGroup}`);
    console.log(`    createdDate       = ${fmtDate(a.createdDate)}`);
    console.log(`    hasAccessToAllBuilds = ${a.hasAccessToAllBuilds}`);
    console.log(`    publicLinkEnabled = ${a.publicLinkEnabled}`);
    console.log(`    publicLink        = ${a.publicLink ?? '(なし)'}`);
    console.log(`    publicLinkId      = ${a.publicLinkId ?? '(なし)'}`);
    console.log(`    publicLinkLimitEnabled = ${a.publicLinkLimitEnabled}`);
    console.log(`    publicLinkLimit   = ${a.publicLinkLimit ?? '(なし)'}`);

    const testers = await safe('testers', () =>
      asc.get(`/betaGroups/${g.id}/betaTesters`, { limit: 200 }),
    );
    if (testers) {
      console.log(`    テスター数        = ${testers.data?.length ?? 0}`);
      for (const t of testers.data ?? []) {
        const ta = t.attributes ?? {};
        console.log(`      · ${ta.email ?? '(email不明)'} state=${ta.state ?? '-'}`);
      }
    }

    const gbuilds = await safe('builds', () =>
      asc.get(`/betaGroups/${g.id}/builds`, { limit: 20 }),
    );
    if (gbuilds) {
      const nums = (gbuilds.data ?? []).map((b) => b.attributes?.version).join(', ');
      console.log(`    紐づくビルド      = ${nums || '(なし)'}`);
    }
  }

  header('2. ビルドと Beta App Review の状態');
  // attributes.version はビルド番号 (バージョン文字列ではない)。
  const builds = await asc.get('/builds', {
    'filter[app]': ASC_APP_ID,
    limit: 10,
    sort: '-version',
    include: 'preReleaseVersion,betaAppReviewSubmission',
  });
  const included = builds?.included ?? [];
  const byId = new Map(included.map((i) => [`${i.type}:${i.id}`, i]));

  for (const b of builds?.data ?? []) {
    const a = b.attributes ?? {};
    const pre = b.relationships?.preReleaseVersion?.data;
    const preObj = pre ? byId.get(`${pre.type}:${pre.id}`) : null;
    const sub = b.relationships?.betaAppReviewSubmission?.data;
    const subObj = sub ? byId.get(`${sub.type}:${sub.id}`) : null;

    console.log(`\n  - build番号        = ${a.version}`);
    console.log(`    バージョン       = ${preObj?.attributes?.version ?? '?'}`);
    console.log(`    id               = ${b.id}`);
    console.log(`    processingState  = ${a.processingState}`);
    console.log(`    expired          = ${a.expired}`);
    console.log(`    uploadedDate     = ${fmtDate(a.uploadedDate)}`);
    console.log(`    有効期限         = ${fmtDate(a.expirationDate)}`);
    // ★ 外部テスターに配るには、このビルドが Beta App Review を
    //   通っている必要がある。内部テスターには不要。
    console.log(`    BetaAppReview    = ${subObj?.attributes?.betaReviewState ?? '(未提出)'}`);
  }

  header('3. 外部テスト提出に必要なメタデータ');
  const detail = await safe('betaAppReviewDetail', () =>
    asc.get(`/apps/${ASC_APP_ID}/betaAppReviewDetail`),
  );
  if (detail) {
    const a = detail.data?.attributes ?? {};
    console.log(`  contactFirstName   = ${a.contactFirstName || '(未設定)'}`);
    console.log(`  contactLastName    = ${a.contactLastName || '(未設定)'}`);
    console.log(`  contactEmail       = ${a.contactEmail || '(未設定)'}`);
    console.log(`  contactPhone       = ${a.contactPhone || '(未設定)'}`);
    console.log(`  demoAccountRequired= ${a.demoAccountRequired}`);
    console.log(`  demoAccountName    = ${a.demoAccountName || '(未設定)'}`);
    console.log(`  notes              = ${a.notes ? `${a.notes.slice(0, 60)}…` : '(未設定)'}`);
  }

  const betaLoc = await safe('betaAppLocalizations', () =>
    asc.get(`/apps/${ASC_APP_ID}/betaAppLocalizations`, { limit: 20 }),
  );
  if (betaLoc) {
    console.log(`\n  betaAppLocalizations (${betaLoc.data?.length ?? 0}件)`);
    for (const l of betaLoc.data ?? []) {
      const a = l.attributes ?? {};
      console.log(`    · ${a.locale}: description=${a.description ? 'あり' : '(未設定)'} feedbackEmail=${a.feedbackEmail || '(未設定)'}`);
    }
  }

  header('4. 内部テスター (App Store Connect ユーザー)');
  const internal = await safe('betaTesters', () =>
    asc.get('/betaTesters', { limit: 200, 'filter[apps]': ASC_APP_ID }),
  );
  if (internal) {
    console.log(`  登録済み BetaTester = ${internal.data?.length ?? 0} 件`);
    for (const t of internal.data ?? []) {
      const a = t.attributes ?? {};
      console.log(`    · ${a.email ?? '?'} state=${a.state ?? '-'} invite=${a.inviteType ?? '-'}`);
    }
  }

  header('完了');
  console.log('読み取りのみ実行した。ASC 側の設定は一切変更していない。');
}

main().catch((e) => {
  console.error('[fatal]', e?.message ?? e);
  process.exit(1);
});
