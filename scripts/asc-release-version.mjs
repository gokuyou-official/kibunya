// 審査に通ったバージョンを App Store に公開する。
//
// releaseType=MANUAL のとき、審査通過後は PENDING_DEVELOPER_RELEASE で
// 止まり、開発者が公開操作をするまで店頭に出ない。その最後の一押しだけを行う。
//
// ★ このスクリプトは「公開」以外の書き込みを一切しない。
//   build の紐付け、リリースノート、連絡先、reviewSubmissions には触れない。
//   送るのは appStoreVersionReleaseRequests の POST 1 本だけ。
//
// ガード:
//   1. DRY_RUN 既定 true。
//   2. EXPECT_VERSION_ID でバージョンの取り違えを防ぐ。
//   3. state が PENDING_DEVELOPER_RELEASE でなければ中断する。
//      (審査前・審査中・公開済みに対して誤って叩かない)
//   4. EXPECT_BUILD_NUMBER で、公開されるビルドが意図したものか確かめる。
//   5. 公開後に読み直し、対象バージョンと従来版の state を両方報告する。
//
// 必須 env: ASC_ISSUER_ID / ASC_KEY_ID / ASC_P8_KEY
// 任意 env:
//   ASC_APP_ID            (既定 6766822899)
//   TARGET_VERSION_STRING (既定 1.0.4)
//   EXPECT_VERSION_ID     指定時はバージョン ID の一致も検証する
//   EXPECT_BUILD_NUMBER   指定時は紐付いている build 番号の一致も検証する
//   DRY_RUN               (既定 'true')
import { buildAscClient } from './lib/asc-auth.mjs';

const APP_ID = process.env.ASC_APP_ID || '6766822899';
const TARGET_VERSION_STRING = (process.env.TARGET_VERSION_STRING || '1.0.4').trim();
const EXPECT_VERSION_ID = (process.env.EXPECT_VERSION_ID || '').trim();
const EXPECT_BUILD_NUMBER = (process.env.EXPECT_BUILD_NUMBER || '').trim();
const DRY_RUN = String(process.env.DRY_RUN ?? 'true') !== 'false';

// 公開操作を受け付ける唯一の状態。
const RELEASABLE_STATE = 'PENDING_DEVELOPER_RELEASE';

const asc = buildAscClient();

function header(s) {
  console.log(`\n${'='.repeat(60)}\n${s}\n${'='.repeat(60)}`);
}

function errInfo(e) {
  return (
    e?.json?.errors?.map((x) => `${x.status} ${x.code}: ${x.detail}`).join(' | ') ??
    e?.message
  );
}

function abort(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

function stateOf(v) {
  const a = v?.attributes ?? {};
  return a.appStoreState ?? a.appVersionState;
}

async function listVersions() {
  const resp = await asc.get(`/apps/${APP_ID}/appStoreVersions`, {
    'filter[platform]': 'IOS',
    limit: 50,
  });
  return resp?.data ?? [];
}

async function main() {
  console.log(`APP_ID                = ${APP_ID}`);
  console.log(`TARGET_VERSION_STRING = ${TARGET_VERSION_STRING}`);
  console.log(`EXPECT_BUILD_NUMBER   = ${EXPECT_BUILD_NUMBER || '(検証しない)'}`);
  console.log(`DRY_RUN               = ${DRY_RUN}`);

  header('1. 公開前の全バージョン');
  const before = await listVersions();
  for (const v of before) {
    console.log(
      `  ${v.attributes?.versionString}  state=${stateOf(v)}  releaseType=${v.attributes?.releaseType}  id=${v.id}`,
    );
  }

  const target = before.find(
    (v) => v.attributes?.versionString === TARGET_VERSION_STRING,
  );
  if (!target) abort(`バージョン ${TARGET_VERSION_STRING} が見つからない`);
  const vId = target.id;

  if (EXPECT_VERSION_ID && vId !== EXPECT_VERSION_ID) {
    abort(`バージョン ID が期待値と不一致。期待=${EXPECT_VERSION_ID} 実際=${vId}`);
  }

  const vState = stateOf(target);
  if (vState !== RELEASABLE_STATE) {
    abort(
      `state=${vState} は公開操作を受け付けない。\n` +
        `  公開できるのは ${RELEASABLE_STATE} のときだけ。現状を確認すること。`,
    );
  }
  console.log(`\n  ✓ ${vId} は ${RELEASABLE_STATE}。公開操作を受け付ける状態`);

  header('2. 公開されるビルドの確認');
  const buildRel = await asc.get(`/appStoreVersions/${vId}/build`).catch(() => null);
  const buildId = buildRel?.data?.id;
  if (!buildId) abort('build が紐付いていない');
  const b = await asc.get(`/builds/${buildId}`);
  const ba = b?.data?.attributes ?? {};
  console.log(`  build ${ba.version} id=${buildId} ${ba.processingState} expired=${ba.expired}`);
  if (EXPECT_BUILD_NUMBER && String(ba.version) !== String(EXPECT_BUILD_NUMBER)) {
    abort(`公開されるビルドが期待値と違う。期待=${EXPECT_BUILD_NUMBER} 実際=${ba.version}`);
  }
  console.log('  ✓ 意図したビルド');

  header('3. 公開');
  if (DRY_RUN) {
    console.log('  [DRY_RUN] POST /appStoreVersionReleaseRequests を送らない');
    console.log(`  実行すると ${TARGET_VERSION_STRING} (build ${ba.version}) が App Store に出る`);
    return;
  }

  try {
    const r = await asc.post('/appStoreVersionReleaseRequests', {
      data: {
        type: 'appStoreVersionReleaseRequests',
        relationships: {
          appStoreVersion: { data: { type: 'appStoreVersions', id: vId } },
        },
      },
    });
    console.log(`  ✓ 公開リクエスト送信 id=${r?.data?.id ?? '(id なし)'}`);
  } catch (e) {
    abort(`公開に失敗: ${errInfo(e)}`);
  }

  header('4. 読み直して検証');
  const after = await listVersions();
  for (const v of after) {
    const prev = before.find((p) => p.id === v.id);
    const prevState = prev ? stateOf(prev) : '(なし)';
    const nowState = stateOf(v);
    const changed = prevState !== nowState ? '  ← 変化' : '';
    console.log(
      `  ${v.attributes?.versionString}  ${prevState} → ${nowState}${changed}`,
    );
  }

  const afterTarget = after.find((v) => v.id === vId);
  const afterState = stateOf(afterTarget);
  if (afterState === RELEASABLE_STATE) {
    console.log(
      `\n  ★ state がまだ ${RELEASABLE_STATE} のまま。Apple 側の反映待ちの可能性がある。`,
    );
  } else {
    console.log(`\n  ✓ 公開処理に入った (state=${afterState})`);
  }
}

main().catch((e) => {
  console.error('[fatal]', errInfo(e));
  process.exit(1);
});
