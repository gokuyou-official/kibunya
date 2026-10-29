// 審査提出の準備として、appStoreVersion に対して以下を行う:
//   1. リリースノート (whatsNew) の入力
//   2. build の紐付け
// いずれも実行後に読み直して検証する。
//
// リリースノートをファイルから読むのは、ワークフローの input やシェル経由だと
// 改行が潰れたり中黒がエスケープされたりする事故が起きうるため。
// リポジトリ内のテキストファイルを唯一の正とし、末尾の改行 1 つだけを落として
// そのまま送る。
//
// ガード:
//   1. DRY_RUN 既定 true。実書き込みには DRY_RUN=false が必要。
//   2. 対象バージョンの versionString と編集可能な state を検証してから書く。
//      公開済み (READY_FOR_SALE) には触れない。
//   3. build は「番号」で指定し、VALID かつ未期限であることを確認してから紐付ける。
//   4. 書き込み後に必ず GET し直し、whatsNew は完全一致、build は番号一致で検証する。
//
// 必須 env: ASC_ISSUER_ID / ASC_KEY_ID / ASC_P8_KEY
// 任意 env:
//   ASC_APP_ID (既定 6766822899)
//   TARGET_VERSION_STRING (既定 1.0.4)
//   EXPECT_VERSION_ID     指定時はバージョン ID の一致も検証する
//   LOCALE                (既定 ja)
//   WHATSNEW_FILE         (既定 scripts/data/whatsnew-1.0.4-ja.txt)。空文字でスキップ
//   BUILD_NUMBER          (既定 85)。空文字でスキップ
//   DRY_RUN               (既定 'true')
import fs from 'node:fs';
import { buildAscClient } from './lib/asc-auth.mjs';

const APP_ID = process.env.ASC_APP_ID || '6766822899';
const TARGET_VERSION_STRING = (process.env.TARGET_VERSION_STRING || '1.0.4').trim();
const EXPECT_VERSION_ID = (process.env.EXPECT_VERSION_ID || '').trim();
const LOCALE = (process.env.LOCALE || 'ja').trim();
const WHATSNEW_FILE =
  process.env.WHATSNEW_FILE === undefined
    ? 'scripts/data/whatsnew-1.0.4-ja.txt'
    : process.env.WHATSNEW_FILE.trim();
const BUILD_NUMBER =
  process.env.BUILD_NUMBER === undefined ? '85' : process.env.BUILD_NUMBER.trim();
const DRY_RUN = String(process.env.DRY_RUN ?? 'true') !== 'false';

// 編集を許す state。公開済みや審査中には触らない。
const EDITABLE_STATES = new Set([
  'PREPARE_FOR_SUBMISSION',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
  'INVALID_BINARY',
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

async function main() {
  console.log(`APP_ID                = ${APP_ID}`);
  console.log(`TARGET_VERSION_STRING = ${TARGET_VERSION_STRING}`);
  console.log(`LOCALE                = ${LOCALE}`);
  console.log(`WHATSNEW_FILE         = ${WHATSNEW_FILE || '(スキップ)'}`);
  console.log(`BUILD_NUMBER          = ${BUILD_NUMBER || '(スキップ)'}`);
  console.log(`DRY_RUN               = ${DRY_RUN}`);

  header('0. 対象バージョンの確認');
  const versionsResp = await asc.get(`/apps/${APP_ID}/appStoreVersions`, {
    'filter[platform]': 'IOS',
    limit: 50,
  });
  const target = (versionsResp?.data ?? []).find(
    (v) => v.attributes?.versionString === TARGET_VERSION_STRING,
  );
  if (!target) abort(`バージョン ${TARGET_VERSION_STRING} が見つからない`);
  const vId = target.id;
  const vState = target.attributes?.appStoreState ?? target.attributes?.appVersionState;
  console.log(`  versionId=${vId} versionString=${TARGET_VERSION_STRING} state=${vState}`);

  if (EXPECT_VERSION_ID && vId !== EXPECT_VERSION_ID) {
    abort(`バージョン ID が期待値と不一致。期待=${EXPECT_VERSION_ID} 実際=${vId}`);
  }
  if (!EDITABLE_STATES.has(vState)) {
    abort(`state=${vState} は編集可能な状態ではない。中断する。`);
  }
  console.log('  ✓ 編集可能な state');

  // ---------------------------------------------------------------- whatsNew
  if (WHATSNEW_FILE) {
    header('1. リリースノート (whatsNew) の入力');

    if (!fs.existsSync(WHATSNEW_FILE)) abort(`${WHATSNEW_FILE} が存在しない`);
    // 末尾の改行 1 つだけを落とす。行間の改行はそのまま送る。
    const expected = fs.readFileSync(WHATSNEW_FILE, 'utf8').replace(/\n$/, '');
    console.log(`  送信する本文 (${expected.length}文字, ${expected.split('\n').length}行):`);
    for (const line of expected.split('\n')) console.log(`    | ${line}`);
    console.log(`  raw = ${JSON.stringify(expected)}`);

    const locsResp = await asc.get(
      `/appStoreVersions/${vId}/appStoreVersionLocalizations`,
      { limit: 50 },
    );
    const loc = (locsResp?.data ?? []).find((l) => l.attributes?.locale === LOCALE);
    if (!loc) abort(`locale=${LOCALE} のローカライゼーションが無い`);
    console.log(`  localizationId=${loc.id}`);
    console.log(`  現在の whatsNew = ${JSON.stringify(loc.attributes?.whatsNew ?? null)}`);

    if (DRY_RUN) {
      console.log('  [DRY_RUN] 書き込まない');
    } else {
      try {
        await asc.patch(`/appStoreVersionLocalizations/${loc.id}`, {
          data: {
            type: 'appStoreVersionLocalizations',
            id: loc.id,
            attributes: { whatsNew: expected },
          },
        });
      } catch (e) {
        abort(`whatsNew の書き込みに失敗: ${errInfo(e)}`);
      }
      console.log('  ✓ PATCH 成功');

      // 読み直して完全一致を検証する。改行が潰れる / エスケープされる等の
      // 事故はここでしか検出できない。
      const after = await asc.get(`/appStoreVersionLocalizations/${loc.id}`);
      const actual = after?.data?.attributes?.whatsNew ?? '';
      console.log(`  反映後 (${actual.length}文字, ${actual.split('\n').length}行):`);
      for (const line of actual.split('\n')) console.log(`    | ${line}`);
      console.log(`  raw = ${JSON.stringify(actual)}`);
      if (actual === expected) {
        console.log('  ✓ 送信した本文と完全一致');
      } else {
        abort(
          '反映された本文が送信内容と一致しない。\n' +
            `  期待: ${JSON.stringify(expected)}\n  実際: ${JSON.stringify(actual)}`,
        );
      }
    }
  }

  // ------------------------------------------------------------------- build
  if (BUILD_NUMBER) {
    header('2. build の紐付け');

    const current = await asc.get(`/appStoreVersions/${vId}/build`).catch(() => null);
    console.log(`  現在の紐付け: ${current?.data?.id ?? '(なし)'}`);

    // NOTE: filter[preReleaseVersion.version] は /apps/{id}/builds では使えない。
    const cands = await asc.get('/builds', {
      'filter[app]': APP_ID,
      'filter[preReleaseVersion.version]': TARGET_VERSION_STRING,
      limit: 50,
    });
    const list = cands?.data ?? [];
    console.log(`  候補 ${list.length}件:`);
    for (const c of list) {
      const ca = c.attributes ?? {};
      console.log(
        `    build ${ca.version} id=${c.id} ${ca.processingState} expired=${ca.expired}`,
      );
    }

    const picked = list.find((c) => String(c.attributes?.version) === String(BUILD_NUMBER));
    if (!picked) abort(`build ${BUILD_NUMBER} が候補に無い`);
    const pa = picked.attributes ?? {};
    if (pa.processingState !== 'VALID') abort(`build ${BUILD_NUMBER} が VALID でない (${pa.processingState})`);
    if (pa.expired) abort(`build ${BUILD_NUMBER} は期限切れ`);
    console.log(`  → build ${BUILD_NUMBER} (id=${picked.id}) を紐付ける`);

    if (DRY_RUN) {
      console.log('  [DRY_RUN] 書き込まない');
    } else {
      try {
        await asc.patch(`/appStoreVersions/${vId}`, {
          data: {
            type: 'appStoreVersions',
            id: vId,
            relationships: { build: { data: { type: 'builds', id: picked.id } } },
          },
        });
      } catch (e) {
        abort(`build 紐付けに失敗: ${errInfo(e)}`);
      }
      console.log('  ✓ PATCH 成功');

      const after = await asc.get(`/appStoreVersions/${vId}/build`);
      const linkedId = after?.data?.id;
      if (!linkedId) abort('紐付け後も build が読めない');
      const b = await asc.get(`/builds/${linkedId}`);
      const ba = b?.data?.attributes ?? {};
      console.log(`  紐付け後: build ${ba.version} id=${linkedId} ${ba.processingState}`);
      if (String(ba.version) !== String(BUILD_NUMBER)) {
        abort(`紐付いた build 番号が違う。期待=${BUILD_NUMBER} 実際=${ba.version}`);
      }
      console.log(`  ✓ build ${BUILD_NUMBER} の紐付けを確認`);

      // 輸出コンプライアンス。null だと提出をブロックする。
      // 値の決定は法務判断を伴うのでここでは埋めず、状態の報告に留める。
      console.log(`  usesNonExemptEncryption = ${JSON.stringify(ba.usesNonExemptEncryption)}`);
      if (ba.usesNonExemptEncryption === false) {
        console.log('  ✓ 輸出コンプライアンス回答済み (false)');
      } else if (ba.usesNonExemptEncryption === true) {
        console.log('  ⚠️ true。暗号化ありの申告になっている');
      } else {
        console.log(
          '  ★ 未回答 (null)。これは提出をブロックする。ここでは埋めないので別途対応が必要',
        );
      }
    }
  }

  header('完了');
  if (DRY_RUN) {
    console.log('DRY_RUN のため何も変更していない。実行するには DRY_RUN=false。');
  } else {
    console.log('書き込みと検証が完了した。審査提出は行っていない。');
  }
}

main().catch((e) => {
  console.error('[fatal]', errInfo(e));
  process.exit(1);
});
