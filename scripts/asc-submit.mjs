// App Store Connect 審査提出スクリプト (clean-slate 版)
//
// 過去の試行錯誤で reviewSubmissions の下書きが複数残った状態 +
// 不可解な 409 が続いていた問題への対処。常に既存 reviewSubmissions を
// 全削除してまっさらにし、legacy submission API → fallback で
// reviewSubmissions API を順に試す。
//
// ステップ:
//   1. 既存 reviewSubmissions (app filter + IOS) を全 DELETE
//   2. 最新 VALID build を target version に PATCH で紐付け
//   3. POST /v1/appStoreVersionSubmissions (legacy) を試す
//      - 2xx → 完了
//      - 4xx/5xx → fallback (reviewSubmissions フロー):
//        a. POST /v1/reviewSubmissions
//        b. POST /v1/reviewSubmissionItems
//        c. PATCH /v1/reviewSubmissions/{id} { submitted: true }
//
// 全 API call で request body + response body / error body を完全ログ。
// dry_run は廃止 (旧版にあった分岐は撤去)。常に実行する。
//
// 必須 env:
//   ASC_ISSUER_ID / ASC_KEY_ID / ASC_P8_KEY (or ASC_P8_KEY_PATH)
//   ASC_APP_ID
// 任意 env:
//   ASC_VERSION_ID  (default: '0a4eb599-86f1-4517-a2c4-8ed22281c5ef')
import { buildAscClient, fmtDate } from './lib/asc-auth.mjs';

const { ASC_APP_ID } = process.env;
const TARGET_VERSION_ID =
  (process.env.ASC_VERSION_ID ?? '').trim() ||
  '0a4eb599-86f1-4517-a2c4-8ed22281c5ef';

if (!ASC_APP_ID) {
  console.error('[error] ASC_APP_ID が未設定です');
  process.exit(1);
}

const client = buildAscClient();

function header(s) {
  console.log('\n=== ' + s + ' ===');
}

function logBody(label, value) {
  console.log(label + ':');
  if (value === undefined || value === null) {
    console.log('(none)');
  } else if (typeof value === 'string') {
    console.log(value);
  } else {
    console.log(JSON.stringify(value, null, 2));
  }
}

// API call ラッパー: request body / response body / error body を全文ログする。
async function call(method, path, body) {
  console.log(`\n→ ${method} ${path}`);
  if (body !== undefined) logBody('request body', body);
  try {
    let resp;
    if (method === 'GET') {
      resp = await client.get(path, body);
    } else if (method === 'POST') {
      resp = await client.post(path, body);
    } else if (method === 'PATCH') {
      resp = await client.patch(path, body);
    } else if (method === 'DELETE') {
      resp = await client.delete(path);
    } else {
      throw new Error(`unsupported method: ${method}`);
    }
    logBody('response', resp);
    return resp;
  } catch (e) {
    console.log(`✗ ${method} ${path} failed (status=${e.status ?? '(none)'})`);
    console.log('  message:', e.message);
    logBody('  body (raw)', e.body || '(empty)');
    if (e.json) logBody('  body (parsed)', e.json);
    throw e;
  }
}

// ---------- main ----------
(async () => {
  try {
    console.log('ASC_APP_ID        :', ASC_APP_ID);
    console.log('TARGET_VERSION_ID :', TARGET_VERSION_ID);

    // -------------------------------------------------------------------
    // Step 1: 既存 reviewSubmissions を全 DELETE
    // -------------------------------------------------------------------
    header('Step 1: 既存 reviewSubmissions (app + IOS) を全削除');
    const subList = await call(
      'GET',
      '/reviewSubmissions',
      { 'filter[app]': ASC_APP_ID, 'filter[platform]': 'IOS', limit: 50 },
    );
    const existing = subList?.data ?? [];
    console.log(`\n対象 ${existing.length} 件の reviewSubmission を順次 DELETE する`);
    for (const s of existing) {
      const id = s.id;
      const state = s.attributes?.state ?? '-';
      try {
        await call('DELETE', `/reviewSubmissions/${id}`);
        console.log(`✓ deleted ${id} (was state=${state})`);
      } catch (e) {
        // 既に submitted されたもの (state=WAITING_FOR_REVIEW 等) は DELETE
        // 不可で 409 を返す可能性が高い。サイレント失敗で続行 (削除できない
        // ものは触らず、新規 submission で上書きする方針)。
        console.log(
          `[warn] DELETE ${id} 失敗 (state=${state}, status=${e.status})。続行。`,
        );
      }
    }

    // -------------------------------------------------------------------
    // Step 1.5: 価格スケジュール (App Store Connect UI 上 ¥0 でも API では
    // baseTerritory=(none) / manualPrices count=0 になっている疑い濃厚
    // なので、ここで強制的に正規化する)
    // -------------------------------------------------------------------
    header('Step 1.5: 価格スケジュール正規化 (free / JPN)');
    {
      let curSched = null;
      try {
        const schedResp = await call(
          'GET',
          `/apps/${ASC_APP_ID}/appPriceSchedule`,
          { include: 'manualPrices,baseTerritory' },
        );
        curSched = schedResp?.data ?? null;
      } catch (e) {
        if (e.status === 404) {
          console.log('[info] appPriceSchedule 未存在 (404)。新規作成へ。');
        } else {
          throw e;
        }
      }
      const baseTerrId = curSched?.relationships?.baseTerritory?.data?.id;
      const mpCount = curSched?.relationships?.manualPrices?.data?.length ?? 0;
      const needsFix = !curSched || !baseTerrId || mpCount === 0;
      console.log(
        `現状: baseTerritory=${baseTerrId ?? '(none)'} ` +
          `manualPrices=${mpCount} → ${needsFix ? '修正実施' : 'OK、skip'}`,
      );

      if (needsFix) {
        // free pricePoint を探索。priceTier filter は deprecated 化済の
        // 可能性があるので、まず付けて試し、失敗時は territory のみで
        // 全件取得 → customerPrice='0' を JS 側で抽出。
        let pricePointsResp;
        try {
          pricePointsResp = await call('GET', `/apps/${ASC_APP_ID}/appPricePoints`, {
            'filter[territory]': 'JPN',
            'filter[priceTier]': '0',
            limit: 50,
          });
        } catch (e) {
          console.log(
            `[info] priceTier filter 失敗 (status=${e.status})。territory のみで再取得。`,
          );
          pricePointsResp = await call('GET', `/apps/${ASC_APP_ID}/appPricePoints`, {
            'filter[territory]': 'JPN',
            limit: 200,
          });
        }
        const points = pricePointsResp?.data ?? [];
        const free = points.find((p) => p.attributes?.customerPrice === '0');
        if (!free) {
          throw new Error(
            'JPN territory に customerPrice="0" の appPricePoint が見つからない',
          );
        }
        console.log(`free pricePoint: ${free.id}`);

        // 既存スケジュールがあれば DELETE (失敗してもサイレント続行)
        if (curSched?.id) {
          try {
            await call('DELETE', `/appPriceSchedules/${curSched.id}`);
            console.log(`✓ deleted existing schedule ${curSched.id}`);
          } catch (e) {
            console.log(
              `[info] DELETE /appPriceSchedules/${curSched.id} 失敗 (status=${e.status})、続行`,
            );
          }
        }

        // 新規 POST
        const placeholder = 'free-price-1';
        await call('POST', '/appPriceSchedules', {
          data: {
            type: 'appPriceSchedules',
            relationships: {
              app: { data: { type: 'apps', id: ASC_APP_ID } },
              baseTerritory: {
                data: { type: 'territories', id: 'JPN' },
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
              attributes: { startDate: null },
              relationships: {
                appPricePoint: {
                  data: { type: 'appPricePoints', id: free.id },
                },
              },
            },
          ],
        });
        console.log('✓ price schedule POST 成功。Apple 側の伝播待ちで 5 秒 sleep。');
        await new Promise((r) => setTimeout(r, 5000));

        // 反映確認 (verifying GET)
        try {
          await call(
            'GET',
            `/apps/${ASC_APP_ID}/appPriceSchedule`,
            { include: 'manualPrices,baseTerritory' },
          );
        } catch (e) {
          console.log(
            `[warn] verifying GET 失敗 (status=${e.status})。Apple 反映遅延の可能性、続行。`,
          );
        }
      }
    }

    // -------------------------------------------------------------------
    // Step 2: 最新 VALID build を target version に紐付け
    // -------------------------------------------------------------------
    header('Step 2: 最新 VALID ビルドを取得 → version に紐付け');
    const buildsResp = await call('GET', '/builds', {
      'filter[app]': ASC_APP_ID,
      sort: '-uploadedDate',
      limit: 20,
    });
    const builds = buildsResp?.data ?? [];
    if (builds.length === 0) {
      throw new Error('ビルドが 1 件もない');
    }
    console.log('\n--- builds 一覧 ---');
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
      throw new Error('VALID 状態のビルドが無い (processing 中 / Invalid)');
    }
    console.log(
      `\n最新 VALID ビルド: ${latestValid.id} (${latestValid.attributes?.version} #${latestValid.attributes?.buildNumber})`,
    );

    // 現在の紐付け状況を表示してから PATCH (差分が無くても上書きは無害)。
    try {
      await call(
        'GET',
        `/appStoreVersions/${TARGET_VERSION_ID}/relationships/build`,
      );
    } catch (e) {
      console.log(`[info] 現在紐付ビルドの GET で status=${e.status}。続行。`);
    }
    await call(
      'PATCH',
      `/appStoreVersions/${TARGET_VERSION_ID}/relationships/build`,
      { data: { type: 'builds', id: latestValid.id } },
    );
    console.log(`✓ attached build ${latestValid.id} → version ${TARGET_VERSION_ID}`);

    // -------------------------------------------------------------------
    // Step 3: 審査提出 - まず legacy API を試す
    // -------------------------------------------------------------------
    header(
      'Step 3a: legacy POST /v1/appStoreVersionSubmissions を試行',
    );
    let legacyOK = false;
    try {
      const legacyResp = await call('POST', '/appStoreVersionSubmissions', {
        data: {
          type: 'appStoreVersionSubmissions',
          relationships: {
            appStoreVersion: {
              data: { type: 'appStoreVersions', id: TARGET_VERSION_ID },
            },
          },
        },
      });
      console.log(`✓ legacy submission 成功 id=${legacyResp?.data?.id}`);
      legacyOK = true;
    } catch (e) {
      console.log(
        '[info] legacy submission が失敗 → reviewSubmissions フォールバックへ。',
      );
    }

    if (legacyOK) {
      header('完了 (legacy)');
      console.log('App Store Connect の Submissions で進捗確認可。');
      return;
    }

    // -------------------------------------------------------------------
    // Step 4: フォールバック - 新 reviewSubmissions フロー
    // -------------------------------------------------------------------
    header('Step 3b-i: POST /v1/reviewSubmissions (新規作成)');
    const created = await call('POST', '/reviewSubmissions', {
      data: {
        type: 'reviewSubmissions',
        attributes: { platform: 'IOS' },
        relationships: {
          app: { data: { type: 'apps', id: ASC_APP_ID } },
        },
      },
    });
    const submission = created?.data;
    if (!submission?.id) {
      throw new Error('reviewSubmissions POST のレスポンスから id を抽出不能');
    }
    console.log(`✓ created reviewSubmission ${submission.id}`);

    // 直前確認: target version と submission の state を Apple から GET。
    header('Step 3b-ii: 両端の state を確認');
    const verResp = await call(
      'GET',
      `/appStoreVersions/${TARGET_VERSION_ID}`,
    );
    const subResp = await call(
      'GET',
      `/reviewSubmissions/${submission.id}`,
    );
    console.log(
      '  appVersionState :',
      verResp?.data?.attributes?.appVersionState ?? '(none)',
    );
    console.log(
      '  submission state:',
      subResp?.data?.attributes?.state ?? '(none)',
    );

    header('Step 3b-iii: POST /v1/reviewSubmissionItems で version を紐付け');
    try {
      const itemResp = await call('POST', '/reviewSubmissionItems', {
        data: {
          type: 'reviewSubmissionItems',
          relationships: {
            reviewSubmission: {
              data: { type: 'reviewSubmissions', id: submission.id },
            },
            appStoreVersion: {
              data: { type: 'appStoreVersions', id: TARGET_VERSION_ID },
            },
          },
        },
      });
      console.log(`✓ created reviewSubmissionItem ${itemResp?.data?.id}`);
    } catch (e) {
      // POST が失敗しても続行: items を GET して実態を確認する。
      console.log('[info] item POST 失敗。items を GET で確認後 verification へ。');
    }

    header('Step 3b-iv: items を verifying GET で確認');
    const itemsResp = await call(
      'GET',
      `/reviewSubmissions/${submission.id}/items`,
      { include: 'appStoreVersion', limit: 25 },
    );
    const items = itemsResp?.data ?? [];
    console.log(`items count: ${items.length}`);
    const includesTarget = items.some(
      (it) =>
        it.relationships?.appStoreVersion?.data?.id === TARGET_VERSION_ID,
    );
    if (!includesTarget) {
      throw new Error(
        `submission ${submission.id} に target version ${TARGET_VERSION_ID} の item が存在しない。submitted=true は実行せず停止。`,
      );
    }
    console.log('✓ target version が items に含まれる');

    header('Step 3b-v: PATCH /v1/reviewSubmissions/{id} submitted=true');
    const submitted = await call('PATCH', `/reviewSubmissions/${submission.id}`, {
      data: {
        type: 'reviewSubmissions',
        id: submission.id,
        attributes: { submitted: true },
      },
    });
    const sa = submitted?.data?.attributes ?? {};
    console.log('✓ submitted');
    console.log('  state         :', sa.state ?? '-');
    console.log('  submittedDate :', fmtDate(sa.submittedDate));

    header('完了 (reviewSubmissions フロー)');
    console.log('App Store Connect の Submissions で進捗確認可。');
  } catch (e) {
    console.error('\n[fatal]', e.message);
    if (e.body) {
      console.error('---response body (head 3KB)---');
      console.error(String(e.body).slice(0, 3000));
    }
    process.exit(1);
  }
})();
