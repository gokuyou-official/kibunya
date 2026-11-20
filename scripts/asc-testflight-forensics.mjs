// App Store Connect API v1 — TestFlight 参加経路の深掘り調査 (読み取り専用)
//
// 「メールアドレス個別登録ではなく、LINE で送られたリンクから参加できた」
// という報告と、先の調査結果 (外部グループ無し / 公開リンク無し) の
// 食い違いを詰めるための調査。
//
// ★ GET のみ。
//
// 調べること:
//   1. アプリに紐づく Beta Group 全件 (氏名・publicLink 属性を全部出す)
//   2. アカウント全体の Beta Group (アプリ紐付けを問わない)
//   3. Beta Tester 全件 (氏名込み。所属グループを include で解決)
//   4. 各ビルドの individualTesters (グループ経由でない個別追加)
//   5. App Store 配信状態 (公開済みなら TestFlight 以外の入手経路がある)
//
// 必須 env: ASC_ISSUER_ID / ASC_KEY_ID / ASC_P8_KEY, ASC_APP_ID
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
async function safe(label, fn) {
  try {
    return await fn();
  } catch (e) {
    console.log(`  [${label}] 取得失敗: HTTP ${e.status ?? '?'} ${String(e.message).split('\n')[0]}`);
    return null;
  }
}

async function main() {
  console.log(`ASC_APP_ID = ${ASC_APP_ID}`);
  console.log('MODE       = READ ONLY (GET のみ)');

  header('1. このアプリの Beta Group 全件 (属性を全出力)');
  const groups = await asc.get(`/apps/${ASC_APP_ID}/betaGroups`, { limit: 200 });
  console.log(`  件数 = ${groups?.data?.length ?? 0}`);
  for (const g of groups?.data ?? []) {
    console.log(`\n  --- ${g.id} ---`);
    // 属性を丸ごと出す。個別に拾うと見落とすため。
    console.log(JSON.stringify(g.attributes, null, 2).split('\n').map((l) => `    ${l}`).join('\n'));
  }

  header('2. アカウント全体の Beta Group (アプリ紐付けを問わない)');
  const allGroups = await safe('betaGroups', () =>
    asc.get('/betaGroups', { limit: 200, include: 'app' }),
  );
  if (allGroups) {
    console.log(`  件数 = ${allGroups.data?.length ?? 0}`);
    for (const g of allGroups.data ?? []) {
      const a = g.attributes ?? {};
      const appId = g.relationships?.app?.data?.id ?? '?';
      console.log(
        `    · ${a.name} id=${g.id} app=${appId} internal=${a.isInternalGroup} publicLinkEnabled=${a.publicLinkEnabled} publicLink=${a.publicLink ?? '-'}`,
      );
    }
  }

  header('3. Beta Tester 全件 (氏名込み / 所属グループ)');
  const testers = await safe('betaTesters', () =>
    asc.get('/betaTesters', {
      limit: 200,
      'filter[apps]': ASC_APP_ID,
      include: 'betaGroups',
    }),
  );
  if (testers) {
    const groupById = new Map(
      (testers.included ?? [])
        .filter((i) => i.type === 'betaGroups')
        .map((i) => [i.id, i.attributes?.name]),
    );
    console.log(`  件数 = ${testers.data?.length ?? 0}`);
    for (const t of testers.data ?? []) {
      const a = t.attributes ?? {};
      const gs = (t.relationships?.betaGroups?.data ?? [])
        .map((g) => groupById.get(g.id) ?? g.id)
        .join(', ');
      console.log(
        `    · ${a.firstName ?? ''} ${a.lastName ?? ''} <${a.email ?? '?'}> state=${a.state} inviteType=${a.inviteType} groups=[${gs || 'なし'}]`,
      );
    }
  }

  header('4. 各ビルドの individualTesters (グループ経由でない個別追加)');
  const builds = await asc.get('/builds', {
    'filter[app]': ASC_APP_ID,
    limit: 10,
    sort: '-version',
  });
  for (const b of builds?.data ?? []) {
    const it = await safe(`build ${b.attributes?.version}`, () =>
      asc.get(`/builds/${b.id}/individualTesters`, { limit: 200 }),
    );
    const n = it?.data?.length ?? 0;
    console.log(`  build ${b.attributes?.version}: individualTesters = ${n}`);
    for (const t of it?.data ?? []) {
      const a = t.attributes ?? {};
      console.log(`      · ${a.firstName ?? ''} ${a.lastName ?? ''} <${a.email ?? '?'}> state=${a.state}`);
    }
  }

  header('5. App Store 配信状態 (TestFlight 以外の入手経路)');
  const app = await asc.get(`/apps/${ASC_APP_ID}`);
  console.log(`  name=${app?.data?.attributes?.name} bundleId=${app?.data?.attributes?.bundleId}`);
  const versions = await asc.get(`/apps/${ASC_APP_ID}/appStoreVersions`, { limit: 10 });
  for (const v of versions?.data ?? []) {
    const a = v.attributes ?? {};
    console.log(
      `    · ${a.versionString} state=${a.appStoreState ?? a.state} released=${fmtDate(a.createdDate)}`,
    );
  }

  header('完了');
  console.log('読み取りのみ実行した。ASC の設定は一切変更していない。');
}

main().catch((e) => {
  console.error('[fatal]', e?.message ?? e);
  process.exit(1);
});
