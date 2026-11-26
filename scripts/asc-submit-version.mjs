// App Store 本審査への提出 (非破壊版)。
//
// 既存の asc-submit.mjs / asc-submit-5115.mjs との決定的な違い:
//   ★ reviewSubmissions を 1 件も削除しない。
//     既存スクリプトは「まっさらにする」ために全 DELETE してから作り直す。
//     過去の試行錯誤の残骸を消す前提の作りで、他バージョンの提出物を
//     巻き添えで消しうる。ここでは消さずに、使えるものは再利用し、
//     使えない場合は理由を報告して止まる。判断は人に返す。
//
// 手順:
//   1. 対象 appStoreVersion を versionString で解決し、state と ID を検証
//   2. 紐付いている build を確認 (提出前の最終確認)
//   3. 既存 reviewSubmissions を一覧し、items が何を指しているか出す
//   4. 提出方針を決める
//        a. 未提出の submission が対象バージョンを含む → それを提出する
//        b. 未提出の submission が別のものを指している → ★中断して報告
//        c. 未提出の submission が無い → 新規作成 → item 追加 → 提出
//   5. legacy appStoreVersionSubmissions を先に試し、駄目なら 4 の方針で実行
//   6. 読み直して state を検証
//
// releaseType には触れない (MANUAL のまま維持する)。
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

// 提出可能な (= まだ審査に出していない) 状態。
const SUBMITTABLE_STATES = new Set([
  'PREPARE_FOR_SUBMISSION',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
  'INVALID_BINARY',
]);

// reviewSubmission のうち「まだ開いている」状態。
// COMPLETE は終わったもの。READY_FOR_REVIEW は作っただけで未提出。
const OPEN_SUBMISSION_STATES = new Set([
  'READY_FOR_REVIEW',
  'WAITING_FOR_REVIEW',
  'IN_REVIEW',
  'UNRESOLVED_ISSUES',
]);

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

// 中断だが「異常」ではないケース。人の判断に返す。
function stopAndReport(msg) {
  console.log(`\n${'!'.repeat(60)}`);
  console.log('提出を実行せずに中断した。判断が必要。');
  console.log('!'.repeat(60));
  console.log(msg);
  process.exit(0);
}

async function main() {
  console.log(`APP_ID                = ${APP_ID}`);
  console.log(`TARGET_VERSION_STRING = ${TARGET_VERSION_STRING}`);
  console.log(`EXPECT_BUILD_NUMBER   = ${EXPECT_BUILD_NUMBER || '(検証しない)'}`);
  console.log(`DRY_RUN               = ${DRY_RUN}`);

  // ------------------------------------------------------- 1. 対象バージョン
  header('1. 対象バージョン');
  const versionsResp = await asc.get(`/apps/${APP_ID}/appStoreVersions`, {
    'filter[platform]': 'IOS',
    limit: 50,
  });
  const target = (versionsResp?.data ?? []).find(
    (v) => v.attributes?.versionString === TARGET_VERSION_STRING,
  );
  if (!target) abort(`バージョン ${TARGET_VERSION_STRING} が見つからない`);
  const vId = target.id;
  const va = target.attributes ?? {};
  const vState = va.appStoreState ?? va.appVersionState;
  console.log(`  versionId   = ${vId}`);
  console.log(`  state       = ${vState}`);
  console.log(`  releaseType = ${va.releaseType}  (変更しない)`);

  if (EXPECT_VERSION_ID && vId !== EXPECT_VERSION_ID) {
    abort(`バージョン ID が期待値と不一致。期待=${EXPECT_VERSION_ID} 実際=${vId}`);
  }
  if (!SUBMITTABLE_STATES.has(vState)) {
    stopAndReport(
      `state=${vState} は提出できる状態ではない。\n` +
        '既に審査へ出ている / 公開済みの可能性がある。現状を確認すること。',
    );
  }
  console.log('  ✓ 提出できる state');

  // ------------------------------------------------------------- 2. build
  header('2. 紐付いている build');
  const buildRel = await asc.get(`/appStoreVersions/${vId}/build`).catch(() => null);
  const buildId = buildRel?.data?.id;
  if (!buildId) abort('build が紐付いていない。提出できない。');
  const b = await asc.get(`/builds/${buildId}`);
  const ba = b?.data?.attributes ?? {};
  console.log(`  build ${ba.version} id=${buildId} ${ba.processingState} expired=${ba.expired}`);
  console.log(`  usesNonExemptEncryption = ${JSON.stringify(ba.usesNonExemptEncryption)}`);
  if (EXPECT_BUILD_NUMBER && String(ba.version) !== String(EXPECT_BUILD_NUMBER)) {
    abort(`紐付いている build が期待値と違う。期待=${EXPECT_BUILD_NUMBER} 実際=${ba.version}`);
  }
  if (ba.processingState !== 'VALID') abort(`build が VALID でない (${ba.processingState})`);
  if (ba.expired) abort('build が期限切れ');
  if (ba.usesNonExemptEncryption === null || ba.usesNonExemptEncryption === undefined) {
    abort('輸出コンプライアンスが未回答 (null)。これは提出をブロックする。');
  }
  console.log('  ✓ build は提出可能');

  // --------------------------------------------- 3. 既存 reviewSubmissions
  header('3. 既存 reviewSubmissions');
  const subsResp = await asc.get('/reviewSubmissions', {
    'filter[app]': APP_ID,
    'filter[platform]': 'IOS',
    limit: 50,
  });
  const subs = subsResp?.data ?? [];
  console.log(`  ${subs.length}件`);

  // 各 submission が「何を提出しようとしているか」を items から読む。
  // ID だけ見ても中身が分からないため、必ず展開する。
  const detailed = [];
  for (const s of subs) {
    const sa = s.attributes ?? {};
    const itemsResp = await asc
      .get(`/reviewSubmissions/${s.id}/items`, { limit: 50 })
      .catch(() => null);
    const items = itemsResp?.data ?? [];
    const versionIds = [];
    for (const it of items) {
      const rel = it.relationships?.appStoreVersion?.data;
      if (rel?.id) versionIds.push(rel.id);
    }
    detailed.push({ id: s.id, state: sa.state, submitted: sa.submittedDate, items, versionIds });
    console.log(
      `\n  - id=${s.id}\n    state=${sa.state} submitted=${sa.submittedDate ?? '-'} items=${items.length}`,
    );
    if (items.length === 0) {
      console.log('    items: (空。何も入っていない下書き)');
    }
    for (const it of items) {
      const rel = it.relationships ?? {};
      const kinds = Object.entries(rel)
        .filter(([, v]) => v?.data?.id)
        .map(([k, v]) => `${k}=${v.data.id}`);
      console.log(`    item ${it.id} state=${it.attributes?.state ?? '-'} ${kinds.join(' ') || '(関連なし)'}`);
    }
    if (versionIds.includes(vId)) {
      console.log('    ★ この submission は対象バージョンを含む');
    }
  }

  const open = detailed.filter((d) => OPEN_SUBMISSION_STATES.has(d.state));
  const openWithTarget = open.filter((d) => d.versionIds.includes(vId));
  const openWithoutTarget = open.filter((d) => !d.versionIds.includes(vId));
  // 空の下書きは「別のものを指している」わけではないので再利用できる。
  const openEmpty = openWithoutTarget.filter((d) => d.items.length === 0);
  const openOther = openWithoutTarget.filter((d) => d.items.length > 0);

  // ------------------------------------------------------------- 4. 方針
  header('4. 提出方針');
  let plan;
  if (openWithTarget.length > 0) {
    plan = { kind: 'submit-existing', sub: openWithTarget[0] };
    console.log(`  既に対象バージョンを含む submission がある: ${plan.sub.id}`);
    console.log('  → これをそのまま提出する (新規作成しない)');
  } else if (openOther.length > 0) {
    stopAndReport(
      `未提出の reviewSubmission が、対象バージョン以外を指している:\n` +
        openOther
          .map((d) => `  - ${d.id} (state=${d.state}) → versions: ${d.versionIds.join(', ') || '(不明)'}`)
          .join('\n') +
        '\n\nApple は同時に開ける submission を 1 件に制限するため、これがあると\n' +
        '新しい提出を作れない。削除は指示なしに行わない。方針の指示を待つ。',
    );
  } else if (openEmpty.length > 0) {
    plan = { kind: 'fill-existing', sub: openEmpty[0] };
    console.log(`  中身が空の未提出 submission を再利用する: ${plan.sub.id}`);
    console.log('  → item を足してから提出する (削除も新規作成もしない)');
  } else {
    plan = { kind: 'create-new' };
    console.log('  未提出の submission は無い → 新規作成して提出する');
  }

  if (DRY_RUN) {
    console.log('\n  [DRY_RUN] ここで停止。実行するには DRY_RUN=false。');
    return;
  }

  // ------------------------------------------------------------- 5. 実行
  header('5. 提出');

  // まず legacy API を試す。成功すれば reviewSubmissions に触らずに済む。
  let submitted = false;
  try {
    console.log('  legacy appStoreVersionSubmissions を試す');
    const r = await asc.post('/appStoreVersionSubmissions', {
      data: {
        type: 'appStoreVersionSubmissions',
        relationships: {
          appStoreVersion: { data: { type: 'appStoreVersions', id: vId } },
        },
      },
    });
    console.log(`  ✓ legacy 提出成功 id=${r?.data?.id}`);
    submitted = true;
  } catch (e) {
    console.log(`  legacy は使えなかった: ${errInfo(e)}`);
    console.log('  → reviewSubmissions フローに切り替える');
  }

  if (!submitted) {
    let subId;
    if (plan.kind === 'create-new') {
      try {
        const r = await asc.post('/reviewSubmissions', {
          data: {
            type: 'reviewSubmissions',
            relationships: { app: { data: { type: 'apps', id: APP_ID } } },
            attributes: { platform: 'IOS' },
          },
        });
        subId = r?.data?.id;
        console.log(`  ✓ reviewSubmission 作成 id=${subId}`);
      } catch (e) {
        abort(`reviewSubmission の作成に失敗: ${errInfo(e)}`);
      }
    } else {
      subId = plan.sub.id;
      console.log(`  既存の submission を使う id=${subId}`);
    }

    // item がまだ無ければ足す。既にあるなら二重に足さない。
    const needsItem = plan.kind !== 'submit-existing';
    if (needsItem) {
      try {
        const r = await asc.post('/reviewSubmissionItems', {
          data: {
            type: 'reviewSubmissionItems',
            relationships: {
              reviewSubmission: { data: { type: 'reviewSubmissions', id: subId } },
              appStoreVersion: { data: { type: 'appStoreVersions', id: vId } },
            },
          },
        });
        console.log(`  ✓ item 追加 id=${r?.data?.id}`);
      } catch (e) {
        abort(`reviewSubmissionItem の追加に失敗: ${errInfo(e)}`);
      }
    } else {
      console.log('  item は既にあるので追加しない');
    }

    try {
      await asc.patch(`/reviewSubmissions/${subId}`, {
        data: {
          type: 'reviewSubmissions',
          id: subId,
          attributes: { submitted: true },
        },
      });
      console.log('  ✓ submitted=true を送信');
      submitted = true;
    } catch (e) {
      abort(`提出 (submitted=true) に失敗: ${errInfo(e)}`);
    }
  }

  // ------------------------------------------------------------- 6. 検証
  header('6. 読み直して検証');
  const afterV = await asc.get(`/appStoreVersions/${vId}`);
  const av = afterV?.data?.attributes ?? {};
  const afterState = av.appStoreState ?? av.appVersionState;
  console.log(`  appStoreVersion state = ${afterState}`);
  console.log(`  releaseType           = ${av.releaseType}`);

  const afterSubs = await asc.get('/reviewSubmissions', {
    'filter[app]': APP_ID,
    'filter[platform]': 'IOS',
    limit: 50,
  });
  for (const s of afterSubs?.data ?? []) {
    const sa = s.attributes ?? {};
    console.log(`  reviewSubmission ${s.id} state=${sa.state} submitted=${sa.submittedDate ?? '-'}`);
  }

  if (av.releaseType !== 'MANUAL') {
    console.log(`  ★ releaseType が MANUAL でない (${av.releaseType})。確認が必要。`);
  }
  if (SUBMITTABLE_STATES.has(afterState)) {
    console.log('  ★ state がまだ提出前のまま。Apple 側の反映待ちの可能性がある。');
  } else {
    console.log('  ✓ 提出後の state に遷移した');
  }
}

main().catch((e) => {
  console.error('[fatal]', errInfo(e));
  process.exit(1);
});
