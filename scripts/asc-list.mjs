// App Store Connect API v1 — TestFlight tester / build 一覧表示スクリプト
//
// 実行方法:
//   ローカル: node --env-file=.env scripts/asc-list.mjs
//   CI:       node scripts/asc-list.mjs (env 変数は workflow から注入)
//
// 認証ロジックは scripts/lib/asc-auth.mjs に集約。
import { buildAscClient, fmtDate } from './lib/asc-auth.mjs';

const { ASC_APP_ID, ASC_BUNDLE_ID } = process.env;
if (!ASC_APP_ID) {
  console.error('[error] ASC_APP_ID が未設定です');
  process.exit(1);
}

const client = buildAscClient();

async function listBuilds() {
  console.log('\n=== Builds (app=' + ASC_APP_ID + ') ===');
  const data = await client.get('/builds', {
    'filter[app]': ASC_APP_ID,
    sort: '-uploadedDate',
    limit: 20,
  });
  if (!data.data?.length) {
    console.log('(ビルド無し)');
    return;
  }
  console.log(['version', 'build#', 'state', 'uploaded', 'expired'].join('\t'));
  for (const b of data.data) {
    const a = b.attributes ?? {};
    console.log(
      [
        a.version ?? '-',
        a.buildNumber ?? '-',
        a.processingState ?? '-',
        fmtDate(a.uploadedDate),
        a.expired ? 'expired' : '-',
      ].join('\t'),
    );
  }
}

async function listBetaGroups() {
  console.log('\n=== Beta Groups (app=' + ASC_APP_ID + ') ===');
  const data = await client.get('/betaGroups', {
    'filter[app]': ASC_APP_ID,
    limit: 50,
  });
  if (!data.data?.length) {
    console.log('(ベータグループ無し)');
    return;
  }
  console.log(['id', 'name', 'internal?', 'publicLink'].join('\t'));
  for (const g of data.data) {
    const a = g.attributes ?? {};
    console.log(
      [
        g.id,
        a.name ?? '-',
        a.isInternalGroup ? 'internal' : 'external',
        a.publicLinkEnabled ? 'public' : '-',
      ].join('\t'),
    );
  }
}

async function listBetaTesters() {
  console.log('\n=== Beta Testers (app=' + ASC_APP_ID + ') ===');
  const data = await client.get('/betaTesters', {
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

(async () => {
  try {
    console.log('Bundle ID :', ASC_BUNDLE_ID ?? '-');
    console.log('App ID    :', ASC_APP_ID);
    await listBuilds();
    await listBetaGroups();
    await listBetaTesters();
  } catch (e) {
    console.error('[error]', e.message);
    process.exit(1);
  }
})();
