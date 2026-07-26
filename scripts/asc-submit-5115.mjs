// Guideline 5.1.1(v) 対応版の App Store 審査提出スクリプト。
//
// 既存 asc-submit.mjs との違い:
//   - 対象 appStoreVersion を versionString (1.0.3) で解決する
//     (ID 固定だと App Store Connect 上の表示が 1.0 のままズレる問題に対応)。
//     見つからなければ versionString を PATCH、それも無理なら新規作成。
//   - 紐付ける build を「ビルド番号」で明示指定できる (BUILD_NUMBER)。
//   - appStoreReviewDetails.notes に 5.1.1(v) の説明を「既存文言を残して」追記。
//   - 提出は legacy appStoreVersionSubmissions を先に試し、駄目なら
//     reviewSubmissions フロー (ドラフト上限に当たったら DELETE してリトライ)。
//   - 最後に state を検証する。
//
// 必須 env: ASC_ISSUER_ID / ASC_KEY_ID / ASC_P8_KEY / ASC_APP_ID
// 任意 env: TARGET_VERSION_STRING (既定 1.0.3) / BUILD_NUMBER (既定 最新VALID)
import { buildAscClient } from './lib/asc-auth.mjs';

const APP_ID = process.env.ASC_APP_ID || '6766822899';
const TARGET_VERSION_STRING = process.env.TARGET_VERSION_STRING || '1.0.3';
const BUILD_NUMBER = (process.env.BUILD_NUMBER || '').trim();

// 審査メモに追記する 5.1.1(v) 対応の説明。
// 同じ内容が既に入っている場合は二重に足さない (冪等)。
const REVIEW_NOTE_5115 = `Regarding Guideline 5.1.1(v): Account deletion is available in this build. Open the "Profile" tab (bottom navigation, rightmost icon), scroll down and tap "アカウントを削除" (Delete Account) below the "Log Out" link, then confirm by tapping "削除する" (Delete). This permanently deletes the account and all associated data (profile, friend connections, notification history) as well as the authentication record. For accounts created with Sign in with Apple, the app also revokes the Apple sign-in token as part of the deletion flow. No customer service contact is required.`;

const NOTE_MARKER = 'Regarding Guideline 5.1.1(v)';

// buildAscClient は { token, get, post, patch, delete } を返す
// (汎用 request は export されていない) ため、method 名でディスパッチする。
const asc = buildAscClient();

function header(s) {
  console.log(`\n=== ${s} ===`);
}

async function call(method, path, { query, body } = {}) {
  try {
    switch (method) {
      case 'GET':
        return await asc.get(path, query);
      case 'POST':
        return await asc.post(path, body);
      case 'PATCH':
        return await asc.patch(path, body);
      case 'DELETE':
        return await asc.delete(path);
      default:
        throw new Error(`unsupported method: ${method}`);
    }
  } catch (e) {
    e.__path = `${method} ${path}`;
    throw e;
  }
}

// asc-auth の request は err.body に生テキスト、err.json にパース済みを載せる。
function errInfo(e) {
  const detail =
    e?.json?.errors
      ?.map((x) => `${x.status} ${x.code}: ${x.detail}`)
      .join(' | ') ?? e?.message;
  return `[${e.__path ?? ''}] status=${e.status ?? '?'} ${detail}`;
}

async function resolveVersion() {
  header('Step 1: appStoreVersions を取得');
  const resp = await call('GET', `/apps/${APP_ID}/appStoreVersions`, {
    query: { 'filter[platform]': 'IOS', limit: 50 },
  });
  const versions = resp?.data ?? [];
  for (const v of versions) {
    console.log(
      `  id=${v.id} versionString=${v.attributes?.versionString} state=${v.attributes?.appStoreState ?? v.attributes?.appVersionState}`,
    );
  }

  // 編集可能な状態 (= まだ審査に出せる状態) の判定に使う。
  const EDITABLE = new Set([
    'PREPARE_FOR_SUBMISSION',
    'DEVELOPER_REJECTED',
    'REJECTED',
    'METADATA_REJECTED',
    'INVALID_BINARY',
  ]);
  const stateOf = (v) =>
    v.attributes?.appStoreState ?? v.attributes?.appVersionState ?? '';

  // 1) versionString が一致するものを最優先
  let target = versions.find(
    (v) => v.attributes?.versionString === TARGET_VERSION_STRING,
  );
  if (target) {
    console.log(`\n→ versionString=${TARGET_VERSION_STRING} の既存バージョンを使用 (id=${target.id})`);
    return target;
  }

  // 2) 編集可能な却下済みバージョンがあれば versionString を書き換えて再利用
  const editable = versions.find((v) => EDITABLE.has(stateOf(v)));
  if (editable) {
    console.log(
      `\n→ 編集可能なバージョン id=${editable.id} (${editable.attributes?.versionString}, ${stateOf(editable)}) の versionString を ${TARGET_VERSION_STRING} に PATCH`,
    );
    const patched = await call('PATCH', `/appStoreVersions/${editable.id}`, {
      body: {
        data: {
          type: 'appStoreVersions',
          id: editable.id,
          attributes: { versionString: TARGET_VERSION_STRING },
        },
      },
    });
    console.log('✓ versionString 更新成功');
    return patched.data;
  }

  // 3) 無ければ新規作成
  console.log(`\n→ 編集可能なバージョンが無いため ${TARGET_VERSION_STRING} を新規作成`);
  const created = await call('POST', '/appStoreVersions', {
    body: {
      data: {
        type: 'appStoreVersions',
        attributes: {
          platform: 'IOS',
          versionString: TARGET_VERSION_STRING,
        },
        relationships: { app: { data: { type: 'apps', id: APP_ID } } },
      },
    },
  });
  console.log(`✓ 新規作成 id=${created.data.id}`);
  return created.data;
}

async function attachBuild(versionId) {
  header('Step 2: build を紐付け');
  const resp = await call('GET', '/builds', {
    query: {
      'filter[app]': APP_ID,
      limit: 30,
      sort: '-uploadedDate',
      'fields[builds]': 'version,uploadedDate,processingState,expired',
    },
  });
  const builds = resp?.data ?? [];
  for (const b of builds.slice(0, 10)) {
    console.log(
      `  id=${b.id} build=${b.attributes?.version} state=${b.attributes?.processingState} expired=${b.attributes?.expired} uploaded=${b.attributes?.uploadedDate}`,
    );
  }

  let build;
  if (BUILD_NUMBER) {
    build = builds.find((b) => String(b.attributes?.version) === BUILD_NUMBER);
    if (!build) {
      throw new Error(
        `指定ビルド番号 ${BUILD_NUMBER} が見つかりません (処理中の可能性)。`,
      );
    }
    if (build.attributes?.processingState !== 'VALID') {
      throw new Error(
        `build ${BUILD_NUMBER} は processingState=${build.attributes?.processingState}。VALID になるまで待つ必要があります。`,
      );
    }
  } else {
    build = builds.find(
      (b) => b.attributes?.processingState === 'VALID' && !b.attributes?.expired,
    );
    if (!build) throw new Error('VALID な build が見つかりません');
  }
  console.log(`\n→ build ${build.attributes?.version} (id=${build.id}) を紐付け`);

  await call('PATCH', `/appStoreVersions/${versionId}/relationships/build`, {
    body: { data: { type: 'builds', id: build.id } },
  });
  console.log('✓ 紐付け成功');
  return build;
}

async function updateReviewNotes(versionId) {
  header('Step 3: appStoreReviewDetails の notes を更新');
  let detail = null;
  try {
    const resp = await call(
      'GET',
      `/appStoreVersions/${versionId}/appStoreReviewDetail`,
    );
    detail = resp?.data ?? null;
  } catch (e) {
    if (e.status !== 404) throw e;
  }

  const existingNotes = detail?.attributes?.notes ?? '';
  console.log(`既存 notes (${existingNotes.length} 文字):`);
  console.log(existingNotes ? `  "${existingNotes.slice(0, 300)}"` : '  (空)');

  if (existingNotes.includes(NOTE_MARKER)) {
    console.log('\n→ 既に 5.1.1(v) の説明が含まれているため追記しない (冪等)');
    return;
  }

  const newNotes = existingNotes.trim()
    ? `${existingNotes.trim()}\n\n${REVIEW_NOTE_5115}`
    : REVIEW_NOTE_5115;

  if (detail) {
    await call('PATCH', `/appStoreReviewDetails/${detail.id}`, {
      body: {
        data: {
          type: 'appStoreReviewDetails',
          id: detail.id,
          attributes: { notes: newNotes },
        },
      },
    });
    console.log('✓ notes を PATCH で追記');
  } else {
    await call('POST', '/appStoreReviewDetails', {
      body: {
        data: {
          type: 'appStoreReviewDetails',
          attributes: { notes: newNotes },
          relationships: {
            appStoreVersion: {
              data: { type: 'appStoreVersions', id: versionId },
            },
          },
        },
      },
    });
    console.log('✓ appStoreReviewDetails を新規作成して notes を設定');
  }
}

async function submitLegacy(versionId) {
  header('Step 4a: legacy POST /appStoreVersionSubmissions を試行');
  await call('POST', '/appStoreVersionSubmissions', {
    body: {
      data: {
        type: 'appStoreVersionSubmissions',
        relationships: {
          appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
        },
      },
    },
  });
  console.log('✓ legacy 提出成功');
}

async function purgeDraftReviewSubmissions() {
  const resp = await call('GET', '/reviewSubmissions', {
    query: { 'filter[app]': APP_ID, 'filter[platform]': 'IOS', limit: 50 },
  });
  const subs = resp?.data ?? [];
  const drafts = subs.filter((s) => s.attributes?.state === 'READY_FOR_REVIEW');
  console.log(
    `reviewSubmissions ${subs.length} 件 (うち未提出ドラフト ${drafts.length} 件)`,
  );
  for (const s of subs) {
    const state = s.attributes?.state;
    if (state === 'WAITING_FOR_REVIEW' || state === 'IN_REVIEW') {
      console.log(`  skip ${s.id} (state=${state} / 既に審査中)`);
      continue;
    }
    try {
      await call('DELETE', `/reviewSubmissions/${s.id}`);
      console.log(`  DELETE ${s.id} (state=${state}) ✓`);
    } catch (e) {
      console.log(`  DELETE ${s.id} 失敗 (state=${state}): ${errInfo(e)}`);
    }
  }
}

async function submitViaReviewSubmissions(versionId) {
  header('Step 4b: reviewSubmissions フロー');
  await purgeDraftReviewSubmissions();

  const created = await call('POST', '/reviewSubmissions', {
    body: {
      data: {
        type: 'reviewSubmissions',
        attributes: { platform: 'IOS' },
        relationships: { app: { data: { type: 'apps', id: APP_ID } } },
      },
    },
  });
  const subId = created.data.id;
  console.log(`✓ reviewSubmission 作成 id=${subId}`);

  await call('POST', '/reviewSubmissionItems', {
    body: {
      data: {
        type: 'reviewSubmissionItems',
        relationships: {
          reviewSubmission: {
            data: { type: 'reviewSubmissions', id: subId },
          },
          appStoreVersion: {
            data: { type: 'appStoreVersions', id: versionId },
          },
        },
      },
    },
  });
  console.log('✓ reviewSubmissionItem 追加');

  await call('PATCH', `/reviewSubmissions/${subId}`, {
    body: {
      data: {
        type: 'reviewSubmissions',
        id: subId,
        attributes: { submitted: true },
      },
    },
  });
  console.log('✓ submitted=true にして提出');
}

async function verify(versionId) {
  header('Step 5: 提出後の状態を検証');
  const resp = await call('GET', `/appStoreVersions/${versionId}`);
  const attrs = resp?.data?.attributes ?? {};
  const state = attrs.appStoreState ?? attrs.appVersionState;
  console.log(`versionString : ${attrs.versionString}`);
  console.log(`state         : ${state}`);
  const ok = state === 'WAITING_FOR_REVIEW' || state === 'IN_REVIEW';
  if (ok) {
    console.log('\n🎉 審査提出完了 (WAITING_FOR_REVIEW)');
  } else {
    console.log(`\n⚠️ 期待した状態ではありません (state=${state})`);
  }
  return ok;
}

async function main() {
  console.log(`APP_ID=${APP_ID} TARGET_VERSION=${TARGET_VERSION_STRING} BUILD_NUMBER=${BUILD_NUMBER || '(最新VALID)'}`);

  const version = await resolveVersion();
  const versionId = version.id;

  const build = await attachBuild(versionId);
  await updateReviewNotes(versionId);

  try {
    await submitLegacy(versionId);
  } catch (e) {
    console.log(`legacy 提出は失敗: ${errInfo(e)}`);
    await submitViaReviewSubmissions(versionId);
  }

  const ok = await verify(versionId);
  console.log(
    `\n--- サマリ ---\nversion=${TARGET_VERSION_STRING} (id=${versionId})\nbuild=${build.attributes?.version} (id=${build.id})`,
  );
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error('\n[fatal]', errInfo(e));
  if (e?.body) console.error(String(e.body).slice(0, 3000));
  process.exit(1);
});
