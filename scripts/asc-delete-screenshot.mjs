// 指定したスクリーンショットを 1 枚だけ削除する。
//
// 誤削除を防ぐための多重ガード:
//   1. DRY_RUN 既定 true。実削除は明示的に DRY_RUN=false が必要。
//   2. 削除前に GET /v1/appScreenshots/{id} で対象の実体を取得し、
//      fileName / サイズ / 所属セットを必ず表示する。
//   3. EXPECT_FILE_NAME を指定した場合、実際の fileName と完全一致
//      しなければ中断する (ID の取り違え防止)。
//   4. EXPECT_VERSION を指定した場合、その画像が属する appStoreVersion の
//      versionString と完全一致しなければ中断する。
//      ★ これが無いと fileName ガードだけでは不十分。同じ fileName の
//        スクリーンショットは各バージョンに複製されて存在するため
//        (例: 1.0.3 と 1.0.4 の双方に 03_alert.png がある)、
//        ID を取り違えると公開済みバージョン側を触ってしまう。
//   5. 対象が存在しない場合は 404 で中断 (何も消さない)。
//
// 必須 env: ASC_ISSUER_ID / ASC_KEY_ID / ASC_P8_KEY / SCREENSHOT_ID
// 任意 env: EXPECT_FILE_NAME / EXPECT_VERSION / DRY_RUN (既定 'true')
import { buildAscClient } from './lib/asc-auth.mjs';

const SCREENSHOT_ID = (process.env.SCREENSHOT_ID || '').trim();
const EXPECT_FILE_NAME = (process.env.EXPECT_FILE_NAME || '').trim();
const EXPECT_VERSION = (process.env.EXPECT_VERSION || '').trim();
const DRY_RUN = String(process.env.DRY_RUN ?? 'true') !== 'false';

const asc = buildAscClient();

function header(s) {
  console.log(`\n=== ${s} ===`);
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

// スクリーンショット → セット → ローカライゼーション → バージョン と辿り、
// 所属する appStoreVersion の versionString を返す。
//
// NOTE: JSON:API の relationships.data は include= を指定しないと空になる。
// (このプロジェクトで何度も踏んだ罠。指定しないと「未設定」に見えてしまう)
// そのため各ホップで include を明示し、included 配列から実体を取り出す。
async function resolveOwningVersion(screenshotId) {
  const pick = (resp, type) =>
    (resp?.included ?? []).find((x) => x.type === type);

  const shotResp = await asc.get(`/appScreenshots/${screenshotId}`, {
    include: 'appScreenshotSet',
  });
  const set = pick(shotResp, 'appScreenshotSets');
  if (!set) return null;

  const setResp = await asc.get(`/appScreenshotSets/${set.id}`, {
    include: 'appStoreVersionLocalization',
  });
  const loc = pick(setResp, 'appStoreVersionLocalizations');
  if (!loc) return null;

  const locResp = await asc.get(`/appStoreVersionLocalizations/${loc.id}`, {
    include: 'appStoreVersion',
  });
  const version = pick(locResp, 'appStoreVersions');
  if (!version) return null;

  return {
    versionString: version.attributes?.versionString,
    state: version.attributes?.appStoreState ?? version.attributes?.appVersionState,
    locale: loc.attributes?.locale,
    displayType: set.attributes?.screenshotDisplayType,
  };
}

async function main() {
  if (!SCREENSHOT_ID) abort('SCREENSHOT_ID が未指定');

  console.log(`SCREENSHOT_ID   = ${SCREENSHOT_ID}`);
  console.log(`EXPECT_FILE_NAME= ${EXPECT_FILE_NAME || '(未指定)'}`);
  console.log(`EXPECT_VERSION  = ${EXPECT_VERSION || '(未指定)'}`);
  console.log(`DRY_RUN         = ${DRY_RUN}`);

  header('1. 削除対象の実体を確認');
  let shot;
  try {
    const resp = await asc.get(`/appScreenshots/${SCREENSHOT_ID}`);
    shot = resp?.data;
  } catch (e) {
    abort(`対象を取得できない (存在しない ID の可能性): ${errInfo(e)}`);
  }
  if (!shot) abort('対象が見つからない');

  const a = shot.attributes ?? {};
  const asset = a.imageAsset ?? {};
  console.log(`  id            : ${shot.id}`);
  console.log(`  fileName      : ${a.fileName}`);
  console.log(`  size          : ${asset.width}x${asset.height} (${a.fileSize} bytes)`);
  console.log(`  deliveryState : ${a.assetDeliveryState?.state}`);
  console.log(`  所属セット    : ${shot.relationships?.appScreenshotSet?.data?.id ?? '(不明)'}`);

  if (EXPECT_FILE_NAME) {
    if (a.fileName !== EXPECT_FILE_NAME) {
      abort(
        `fileName が期待値と一致しない。中断する。\n` +
          `  期待: ${EXPECT_FILE_NAME}\n  実際: ${a.fileName}`,
      );
    }
    console.log('  ✓ fileName が期待値と一致');
  }

  // 所属バージョンは fileName ガードでは区別できないので必ず表示する。
  // EXPECT_VERSION が指定されていれば不一致で中断。
  const owner = await resolveOwningVersion(SCREENSHOT_ID);
  if (!owner) {
    if (EXPECT_VERSION) {
      abort('所属バージョンを解決できなかった。EXPECT_VERSION を検証できないので中断する。');
    }
    console.log('  所属バージョン: (解決できず)');
  } else {
    console.log(
      `  所属バージョン: ${owner.versionString} (state=${owner.state}) / ${owner.locale} / ${owner.displayType}`,
    );
    if (EXPECT_VERSION && owner.versionString !== EXPECT_VERSION) {
      abort(
        `所属バージョンが期待値と一致しない。中断する。\n` +
          `  期待: ${EXPECT_VERSION}\n  実際: ${owner.versionString}`,
      );
    }
    if (EXPECT_VERSION) console.log('  ✓ 所属バージョンが期待値と一致');
  }

  if (DRY_RUN) {
    header('DRY_RUN のため削除しない');
    console.log('実削除するには DRY_RUN=false で再実行すること。');
    return;
  }

  header('2. DELETE を実行');
  try {
    await asc.delete(`/appScreenshots/${SCREENSHOT_ID}`);
  } catch (e) {
    abort(`削除失敗: ${errInfo(e)}`);
  }
  console.log('✓ DELETE 成功');

  header('3. 削除されたことを検証');
  try {
    await asc.get(`/appScreenshots/${SCREENSHOT_ID}`);
    console.error('::error::まだ取得できてしまう。削除が反映されていない可能性');
    process.exit(1);
  } catch (e) {
    if (e.status === 404) {
      console.log('✓ 404 を確認。削除完了。');
    } else {
      console.log(`  (想定外の応答だが GET は失敗している: ${errInfo(e)})`);
    }
  }
}

main().catch((e) => {
  console.error('[fatal]', errInfo(e));
  process.exit(1);
});
