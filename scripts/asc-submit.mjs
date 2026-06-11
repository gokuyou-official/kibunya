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
//   ASC_BASE_TERRITORY (default: 'JPN') 価格スケジュールの baseTerritory
//   DRY_RUN          (default: "true")
import { buildAscClient, fmtDate } from './lib/asc-auth.mjs';

const { ASC_APP_ID } = process.env;
const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
const TARGET_VERSION_ID =
  (process.env.ASC_VERSION_ID ?? '').trim() ||
  '0a4eb599-86f1-4517-a2c4-8ed22281c5ef'; // 既存の editable version
const BASE_TERRITORY =
  (process.env.ASC_BASE_TERRITORY ?? '').trim() || 'JPN';

if (!ASC_APP_ID) {
  console.error('[error] ASC_APP_ID が未設定です');
  process.exit(1);
}

const client = buildAscClient();

function header(s) {
  console.log('\n=== ' + s + ' ===');
}

// ==============================
// 価格スケジュール関連 (Pricing v3 = appPricePoint ベース)
// ==============================
//
// Apple は 2023 末で priceTier (= 旧 tier 番号、'0' が free) を廃止し
// appPricePoint (= app × territory × tier の固有 ID) に移行。
// 本スクリプトは新方式で書く。
//
// 流れ:
//   1) GET /v1/apps/{id}/appPriceSchedule で既存スケジュール確認
//   2) 未設定なら GET /v1/apps/{id}/appPricePoints?filter[territory]=JPN
//      から customerPrice='0' (= 無料) の appPricePoint を取得
//   3) POST /v1/appPriceSchedules で manualPrices に上記 pricePoint を
//      参照する appPrices を含める

async function getCurrentPriceSchedule() {
  try {
    return await client.get(`/apps/${ASC_APP_ID}/appPriceSchedule`);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

async function findFreeAppPricePoint(territoryId) {
  // app に紐付く appPricePoints から territory で filter。
  // customerPrice は文字列 ('0' / '120' 等) で返る。
  const resp = await client.get(`/apps/${ASC_APP_ID}/appPricePoints`, {
    'filter[territory]': territoryId,
    limit: 200,
  });
  const points = resp?.data ?? [];
  return points.find((p) => p.attributes?.customerPrice === '0') ?? null;
}

async function createFreePriceSchedule(territoryId, pricePointId) {
  // included の placeholder id は POST body 内でのみ意味を持つ参照キー。
  // Apple は POST 完了後に real な appPrices id を返す。
  const placeholder = 'free-price-1';
  return client.post('/appPriceSchedules', {
    data: {
      type: 'appPriceSchedules',
      relationships: {
        app: { data: { type: 'apps', id: ASC_APP_ID } },
        baseTerritory: {
          data: { type: 'territories', id: territoryId },
        },
        manualPrices: {
          data: [{ type: 'appPrices', id: placeholder }],
        },
      },
    },
    included: [
      {
        type: 'appPrices',
        id: placeholder,
        attributes: {
          startDate: null, // 即時適用
        },
        relationships: {
          appPricePoint: {
            data: { type: 'appPricePoints', id: pricePointId },
          },
        },
      },
    ],
  });
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
  const body = {
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
  };
  // 送信前に request body を全文ログ (Apple 側の rejection 原因解析のため)
  console.log('POST /reviewSubmissionItems request body:');
  console.log(JSON.stringify(body, null, 2));
  return client.post('/reviewSubmissionItems', body);
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
    console.log('BASE_TERRITORY    :', BASE_TERRITORY);
    console.log('DRY_RUN           :', DRY_RUN);

    // -------- (0) 価格スケジュール確認 --------
    header('Step 0: 価格スケジュール (現状確認)');
    const schedResp = await getCurrentPriceSchedule();
    const sched = schedResp?.data ?? null;
    let freePricePoint = null;
    let needsPriceSetup = false;
    if (sched) {
      // 既存スケジュール有り。relationships から baseTerritory 等を表示。
      // manualPrices の中身までは別 GET が必要なのでここでは id だけ。
      console.log('appPriceSchedule.id :', sched.id);
      const baseTerrRef =
        sched.relationships?.baseTerritory?.data?.id ?? '(none)';
      console.log('baseTerritory       :', baseTerrRef);
      const mpRefs = sched.relationships?.manualPrices?.data ?? [];
      console.log('manualPrices count  :', mpRefs.length);
      console.log('→ 既設定。設定 step は skip。');
    } else {
      console.log('(価格スケジュール未設定)');
      // free price point を探索しておく (DRY_RUN でもプラン表示で使う)
      freePricePoint = await findFreeAppPricePoint(BASE_TERRITORY);
      if (freePricePoint) {
        console.log(
          `free appPricePoint (${BASE_TERRITORY}): id=${freePricePoint.id}` +
            `  customerPrice=${freePricePoint.attributes?.customerPrice ?? '-'}`,
        );
        needsPriceSetup = true;
      } else {
        console.log(
          `[warn] ${BASE_TERRITORY} 領域の free (customerPrice='0') appPricePoint が見つからない。` +
            ' 価格設定は skip し、ASC Console で手動対応推奨。',
        );
      }
    }

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
    let reusable = openSubs.find((s) =>
      ['COMPLETING', 'READY_FOR_REVIEW'].includes(s.attributes?.state),
    );
    // 再利用候補が見つかっても items=0 で stuck している場合がある
    // (過去の失敗回で残った gemini submission)。次の POST item で 409 を
    // 返し続け、PATCH submitted も "appStoreVersionForReview required" で
    // 詰まる。事前に items を確認し、空なら DELETE して再生成対象にする。
    let staleSubmission = null;
    if (reusable) {
      const existingItems = await getSubmissionItems(reusable.id);
      console.log(
        `再利用候補: ${reusable.id} (state=${reusable.attributes?.state}, items=${existingItems.length})`,
      );
      if (existingItems.length === 0) {
        console.log(
          '  → items=0 で stuck。Exec で DELETE → 新規作成に切替。',
        );
        staleSubmission = reusable;
        reusable = null;
      }
    }

    // -------- 適用プラン --------
    header('適用プラン');
    if (needsPriceSetup && freePricePoint) {
      console.log(
        `0. 価格スケジュール: POST appPriceSchedules (free, baseTerritory=${BASE_TERRITORY})`,
      );
    } else if (sched) {
      console.log('0. 価格スケジュール: skip (既設定)');
    } else {
      console.log('0. 価格スケジュール: skip (free price point 未発見)');
    }
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
    } else if (staleSubmission) {
      console.log(
        `2. reviewSubmission: DELETE ${staleSubmission.id} (items=0 stuck) → 新規作成`,
      );
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

    // -------- (Exec 0) 価格スケジュール設定 --------
    header('Exec Step 0: 価格スケジュール (未設定なら free を設定)');
    if (sched) {
      console.log('skip (既設定)');
    } else if (!freePricePoint) {
      console.log('skip (free price point 未発見、Console で手動対応推奨)');
    } else {
      try {
        const created = await createFreePriceSchedule(
          BASE_TERRITORY,
          freePricePoint.id,
        );
        console.log('POST /appPriceSchedules response (head 1KB):');
        console.log(JSON.stringify(created, null, 2).slice(0, 1000));
        console.log(
          `✓ created appPriceSchedule ${created?.data?.id} (free / ${BASE_TERRITORY})`,
        );
      } catch (e) {
        console.log(`POST /appPriceSchedules failed (status=${e.status}):`);
        console.log(String(e.body ?? '').slice(0, 2000));
        throw new Error(
          `価格スケジュール設定に失敗。次の build 紐付け / 審査提出は実行しません: ${e.message}`,
        );
      }
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
      // stale (items=0) があれば先に DELETE。同じ App + Platform で複数の
      // 提出前 submission を保持できない可能性があるため、生成前に掃除する。
      if (staleSubmission) {
        try {
          await client.delete(`/reviewSubmissions/${staleSubmission.id}`);
          console.log(
            `✓ deleted stale reviewSubmission ${staleSubmission.id} (items=0)`,
          );
        } catch (e) {
          console.log(
            `[warn] stale submission ${staleSubmission.id} の DELETE 失敗 (status=${e.status}):`,
          );
          console.log(String(e.body ?? '').slice(0, 1500));
          // 失敗しても新規 POST を試みる (Apple 側の状態次第で通る場合あり)。
        }
      }
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
      // 成功時もレスポンス全文をログ (id 確認 + 後続検証のため)
      console.log('POST /reviewSubmissionItems response (full):');
      console.log(JSON.stringify(itemResp, null, 2));
      console.log(`✓ created reviewSubmissionItem ${itemResp?.data?.id}`);
    } catch (e) {
      itemPostError = e;
      // 失敗時は status / body / parsed JSON / 完全 message を全部出す。
      // 旧実装は `e.body?.slice(0, 2000)` だったが、e.body が空文字や
      // 短文だと「status=409 だけ表示」に見えていた。
      console.log('POST /reviewSubmissionItems failed:');
      console.log(`  status       : ${e.status ?? '(none)'}`);
      console.log(`  message      : ${e.message ?? '(none)'}`);
      console.log('  body (raw)   :');
      console.log(e.body ? String(e.body) : '(empty)');
      if (e.json) {
        console.log('  body (parsed JSON):');
        console.log(JSON.stringify(e.json, null, 2));
      } else if (e.body) {
        console.log('  body (parsed JSON): (parse 失敗)');
      }
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
