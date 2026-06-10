// App Store Connect 審査提出スクリプト
//
// 流れ:
//   (1) /v1/builds?filter[app]=<id>&sort=-uploadedDate で最新ビルド一覧取得
//   (2) /v1/appStoreVersions/<verId>/relationships/build で現在紐付ビルド確認
//   (3) PATCH /v1/appStoreVersions/<verId>/relationships/build で
//       最新の VALID ビルド (processingState='VALID') を version に紐付け
//   (4) POST /v1/reviewSubmissions で新規 reviewSubmission 作成
//       (app との relationship, platform: 'IOS')
//   (5) POST /v1/reviewSubmissionItems で version を submission に紐付け
//   (6) PATCH /v1/reviewSubmissions/<subId> で submitted: true を立てて提出
//
// 必須 env:
//   ASC_ISSUER_ID / ASC_KEY_ID / ASC_P8_KEY (or ASC_P8_KEY_PATH)
//   ASC_APP_ID
// 任意 env:
//   ASC_VERSION_ID   (default: '0a4eb599-86f1-4517-a2c4-8ed22281c5ef')
//                    対象の appStoreVersion ID。未指定なら editable な
//                    最新を自動探索する。
//   DRY_RUN          (default: "true")
import { buildAscClient, fmtDate } from './lib/asc-auth.mjs';

const { ASC_APP_ID } = process.env;
const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
const TARGET_VERSION_ID =
  (process.env.ASC_VERSION_ID ?? '').trim() ||
  '0a4eb599-86f1-4517-a2c4-8ed22281c5ef'; // 既存の editable version

if (!ASC_APP_ID) {
  console.error('[error] ASC_APP_ID が未設定です');
  process.exit(1);
}

const client = buildAscClient();

function header(s) {
  console.log('\n=== ' + s + ' ===');
}

async function listRecentBuilds() {
  const resp = await client.get('/builds', {
    'filter[app]': ASC_APP_ID,
    sort: '-uploadedDate',
    limit: 20,
  });
  return resp?.data ?? [];
}

async function getAttachedBuild(versionId) {
  try {
    const resp = await client.get(
      `/appStoreVersions/${versionId}/relationships/build`,
    );
    return resp?.data ?? null; // { type, id } or null
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

async function attachBuild(versionId, buildId) {
  return client.patch(`/appStoreVersions/${versionId}/relationships/build`, {
    data: { type: 'builds', id: buildId },
  });
}

async function listOpenReviewSubmissions() {
  // submitted 前 (COMPLETING / READY_FOR_REVIEW) のものを探す。
  // ASC API は state filter を組合せ複数受けるので、新しめのものから順に
  // 取得して呼び出し側で state を見る。
  const resp = await client.get('/reviewSubmissions', {
    'filter[app]': ASC_APP_ID,
    'filter[platform]': 'IOS',
    limit: 10,
  });
  return resp?.data ?? [];
}

async function createReviewSubmission() {
  return client.post('/reviewSubmissions', {
    data: {
      type: 'reviewSubmissions',
      attributes: { platform: 'IOS' },
      relationships: {
        app: { data: { type: 'apps', id: ASC_APP_ID } },
      },
    },
  });
}

async function addVersionToSubmission(submissionId, versionId) {
  return client.post('/reviewSubmissionItems', {
    data: {
      type: 'reviewSubmissionItems',
      relationships: {
        reviewSubmission: {
          data: { type: 'reviewSubmissions', id: submissionId },
        },
        appStoreVersion: {
          data: { type: 'appStoreVersions', id: versionId },
        },
      },
    },
  });
}

// reviewSubmission 配下の items を取得。Step 5 の事後検証で必須。
// include=appStoreVersion で各 item の relationships.appStoreVersion.data
// (target version の id) を確実に取れるようにする。
async function getSubmissionItems(submissionId) {
  const resp = await client.get(
    `/reviewSubmissions/${submissionId}/items`,
    { include: 'appStoreVersion', limit: 25 },
  );
  return resp?.data ?? [];
}

async function submitReview(submissionId) {
  return client.patch(`/reviewSubmissions/${submissionId}`, {
    data: {
      type: 'reviewSubmissions',
      id: submissionId,
      attributes: { submitted: true },
    },
  });
}

(async () => {
  try {
    console.log('ASC_APP_ID        :', ASC_APP_ID);
    console.log('TARGET_VERSION_ID :', TARGET_VERSION_ID);
    console.log('DRY_RUN           :', DRY_RUN);

    // -------- (1) Build 一覧 --------
    header('Step 1: ビルド一覧 (最新 20 件)');
    const builds = await listRecentBuilds();
    if (builds.length === 0) {
      throw new Error('ビルドが 1 件も見つかりません');
    }
    console.log(['id (head)', 'version', 'build#', 'state', 'uploaded'].join('\t'));
    for (const b of builds) {
      const a = b.attributes ?? {};
      console.log(
        [
          b.id.slice(0, 8) + '…',
          a.version ?? '-',
          a.buildNumber ?? '-',
          a.processingState ?? '-',
          fmtDate(a.uploadedDate),
        ].join('\t'),
      );
    }

    const latestValid = builds.find(
      (b) => b.attributes?.processingState === 'VALID',
    );
    if (!latestValid) {
      throw new Error(
        'VALID 状態のビルドが見つかりません (processing 完了待ち / Invalid の可能性)',
      );
    }
    console.log(`\n最新 VALID ビルド: ${latestValid.id} (${latestValid.attributes?.version} #${latestValid.attributes?.buildNumber})`);

    // -------- (2) 現在紐付け確認 --------
    header(`Step 2: version ${TARGET_VERSION_ID.slice(0, 8)}… の現在の紐付ビルド`);
    const attached = await getAttachedBuild(TARGET_VERSION_ID);
    if (attached) {
      console.log(`現在紐付  : ${attached.id}`);
    } else {
      console.log('現在紐付  : (未設定)');
    }
    const needsAttach = !attached || attached.id !== latestValid.id;
    console.log(`紐付け要否: ${needsAttach ? '必要' : '不要 (同じビルドを紐付け済)'}`);

    // -------- 既存 reviewSubmissions の確認 --------
    header('Step 3: 既存 reviewSubmissions (app + IOS) を確認');
    const openSubs = await listOpenReviewSubmissions();
    if (openSubs.length === 0) {
      console.log('(既存なし → 新規作成予定)');
    } else {
      console.log(['id (head)', 'state', 'submittedDate', 'platform'].join('\t'));
      for (const s of openSubs) {
        const a = s.attributes ?? {};
        console.log(
          [
            s.id.slice(0, 8) + '…',
            a.state ?? '-',
            fmtDate(a.submittedDate),
            a.platform ?? '-',
          ].join('\t'),
        );
      }
    }
    // 提出前 (= まだ submitted されていない) の submission を再利用候補とする。
    // state COMPLETING や READY_FOR_REVIEW は新規アイテム追加可能。
    // IN_REVIEW / WAITING_FOR_REVIEW などはもう触れない。
    const reusable = openSubs.find((s) =>
      ['COMPLETING', 'READY_FOR_REVIEW'].includes(s.attributes?.state),
    );
    if (reusable) {
      console.log(`\n再利用候補: ${reusable.id} (state=${reusable.attributes?.state})`);
    }

    // -------- 適用プラン --------
    header('適用プラン');
    if (needsAttach) {
      console.log(
        `1. attach build:  ${
          attached?.id ?? '(なし)'
        } → ${latestValid.id}`,
      );
    } else {
      console.log('1. attach build:  skip (同じビルド既に紐付け済)');
    }
    if (reusable) {
      console.log(`2. reviewSubmission: 既存 ${reusable.id} を再利用`);
    } else {
      console.log('2. reviewSubmission: 新規作成');
    }
    console.log(`3. reviewSubmissionItem: version ${TARGET_VERSION_ID.slice(0, 8)}… を追加`);
    console.log('4. PATCH submitted: true で審査提出');

    if (DRY_RUN) {
      header('DRY RUN — 書き込みません');
      console.log(
        '実行する場合は workflow_dispatch で dry_run=false を選んで再実行してください。',
      );
      return;
    }

    // -------- (3) Build 紐付け --------
    header('Exec Step 1: build を version に紐付け');
    if (needsAttach) {
      await attachBuild(TARGET_VERSION_ID, latestValid.id);
      console.log(`✓ attached build ${latestValid.id} → version ${TARGET_VERSION_ID}`);
    } else {
      console.log('skip (同じビルド既に紐付け済)');
    }

    // -------- (4) reviewSubmission 用意 --------
    header('Exec Step 2: reviewSubmission 用意');
    let submission;
    if (reusable) {
      submission = reusable;
      console.log(`既存を再利用: ${submission.id}`);
    } else {
      const created = await createReviewSubmission();
      submission = created?.data;
      console.log(`✓ created reviewSubmission ${submission.id}`);
    }

    // -------- (5) Item 追加 --------
    // ⚠️ 旧実装は 409/422 を「既に追加済」とみなして silent skip していたが、
    // 実際は別原因 (version 紐付け不正 / state 不適合 等) で失敗していても
    // skip され、Step 6 で 409 ENTITY_ERROR.RELATIONSHIP.REQUIRED
    // ("appStoreVersionForReview must be set") の遠隔エラーになっていた。
    //
    // 新実装は:
    //   1. POST item を実行。成功時はレスポンス全体をログ。
    //   2. エラー時は status + body を完全に出力し、throw せず続行する
    //      (既に item が登録済の benign ケースを排除しないため)。
    //   3. 直後に GET items?include=appStoreVersion で再検証。target
    //      version の id を含む item が存在しなければ throw して PATCH
    //      submitted=true に絶対に進ませない。
    header('Exec Step 3: reviewSubmissionItem を作成 (version を紐付け)');
    let itemPostError = null;
    try {
      const itemResp = await addVersionToSubmission(
        submission.id,
        TARGET_VERSION_ID,
      );
      console.log('POST /reviewSubmissionItems response (head 1KB):');
      console.log(JSON.stringify(itemResp, null, 2).slice(0, 1000));
      console.log(`✓ created reviewSubmissionItem ${itemResp?.data?.id}`);
    } catch (e) {
      itemPostError = e;
      console.log(`POST /reviewSubmissionItems failed (status=${e.status}):`);
      console.log(String(e.body ?? '').slice(0, 2000));
      console.log('continuing to verification step...');
    }

    // -------- (5.5) Item 検証 --------
    header('Exec Step 3.5: items 検証 (Step 6 に進むための gate)');
    const items = await getSubmissionItems(submission.id);
    console.log(`items count: ${items.length}`);
    for (const it of items) {
      const verId = it.relationships?.appStoreVersion?.data?.id ?? '(none)';
      console.log(`  item ${it.id} → appStoreVersion ${verId}`);
    }
    const includesTarget = items.some(
      (it) => it.relationships?.appStoreVersion?.data?.id === TARGET_VERSION_ID,
    );
    if (!includesTarget) {
      const why = itemPostError
        ? `(POST item が status=${itemPostError.status} で失敗していた)`
        : '(POST item は成功したように見えたが verifying GET に target version が含まれていない)';
      throw new Error(
        `submission ${submission.id} に target version ${TARGET_VERSION_ID} の item が無い。${why} submitted=true は実行しません。`,
      );
    }
    console.log(`✓ target version ${TARGET_VERSION_ID} が items に含まれる`);

    // -------- (6) Submit --------
    header('Exec Step 4: PATCH submitted=true で審査提出');
    const submitted = await submitReview(submission.id);
    console.log('PATCH /reviewSubmissions response (head 1KB):');
    console.log(JSON.stringify(submitted, null, 2).slice(0, 1000));
    const sa = submitted?.data?.attributes ?? {};
    console.log('✓ submitted');
    console.log('  state         :', sa.state ?? '-');
    console.log('  submittedDate :', fmtDate(sa.submittedDate));

    header('完了');
    console.log('App Store Connect の Submissions で進捗を確認できます。');
  } catch (e) {
    console.error('\n[fatal]', e.message);
    if (e.body) {
      console.error('---response body (head)---');
      console.error(String(e.body).slice(0, 2000));
    }
    process.exit(1);
  }
})();
