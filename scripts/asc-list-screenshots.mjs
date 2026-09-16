// App Store に登録されている全スクリーンショットを一覧化する (読み取り専用)。
//
// たどる順序:
//   /v1/apps/{id}/appStoreVersions
//     → /v1/appStoreVersions/{id}/appStoreVersionLocalizations
//       → /v1/appStoreVersionLocalizations/{id}/appScreenshotSets
//         → /v1/appScreenshotSets/{id}/appScreenshots
//
// 出力する情報:
//   - スクリーンショット ID (削除時に指定する値)
//   - position (セット内の表示順。API が返す配列順 = App Store 上の並び)
//   - fileName / サイズ / assetDeliveryState
//   - imageAsset.templateUrl (プレビュー用。{w}x{h}{f} を実サイズに置換して使う)
//
// 一切書き込みを行わないので何度でも安全に実行できる。
import { buildAscClient } from './lib/asc-auth.mjs';

const APP_ID = process.env.ASC_APP_ID || '6766822899';
// プレビュー URL を組み立てる際の幅 (高さは元の縦横比から算出)
const PREVIEW_WIDTH = Number(process.env.PREVIEW_WIDTH || 400);

const asc = buildAscClient();

function header(s) {
  console.log(`\n${'='.repeat(64)}\n${s}\n${'='.repeat(64)}`);
}

function errInfo(e) {
  return (
    e?.json?.errors?.map((x) => `${x.status} ${x.code}: ${x.detail}`).join(' | ') ??
    e?.message
  );
}

async function get(path, query) {
  try {
    return await asc.get(path, query);
  } catch (e) {
    console.log(`  [GET ${path}] ${errInfo(e)}`);
    return null;
  }
}

// templateUrl は "https://.../{w}x{h}{c}.{f}" の形。
// {w}/{h} を実寸に、{f} を png に置換して取得可能な URL にする。
function buildPreviewUrl(templateUrl, srcW, srcH, width = PREVIEW_WIDTH) {
  if (!templateUrl) return null;
  const w = width;
  const h = srcW && srcH ? Math.round((srcH / srcW) * width) : width * 2;
  return templateUrl
    .replace('{w}', String(w))
    .replace('{h}', String(h))
    .replace('{c}', 'bb')
    .replace('{f}', 'png');
}

async function main() {
  console.log(`APP_ID=${APP_ID} PREVIEW_WIDTH=${PREVIEW_WIDTH}`);

  const versionsResp = await get(`/apps/${APP_ID}/appStoreVersions`, {
    'filter[platform]': 'IOS',
    limit: 50,
  });
  const versions = versionsResp?.data ?? [];

  // 機械可読な形でも出しておく (後続の削除スクリプトへの受け渡し用)
  const inventory = [];

  for (const v of versions) {
    const va = v.attributes ?? {};
    header(
      `appStoreVersion ${va.versionString} (state=${va.appStoreState ?? va.appVersionState}) id=${v.id}`,
    );

    const locsResp = await get(
      `/appStoreVersions/${v.id}/appStoreVersionLocalizations`,
      { limit: 50 },
    );
    for (const loc of locsResp?.data ?? []) {
      const locale = loc.attributes?.locale;
      console.log(`\n--- locale=${locale} (localization id=${loc.id}) ---`);

      const setsResp = await get(
        `/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`,
        { limit: 50 },
      );
      const sets = setsResp?.data ?? [];
      if (sets.length === 0) {
        console.log('  (スクリーンショットセットなし)');
        continue;
      }

      for (const set of sets) {
        const displayType = set.attributes?.screenshotDisplayType;
        console.log(`\n  [${displayType}] set id=${set.id}`);

        const shotsResp = await get(`/appScreenshotSets/${set.id}/appScreenshots`, {
          limit: 50,
        });
        const shots = shotsResp?.data ?? [];
        if (shots.length === 0) {
          console.log('    (画像なし)');
          continue;
        }

        shots.forEach((s, idx) => {
          const a = s.attributes ?? {};
          const asset = a.imageAsset ?? {};
          const position = idx + 1; // API の配列順 = App Store 上の表示順
          const preview = buildPreviewUrl(
            asset.templateUrl,
            asset.width,
            asset.height,
          );
          console.log(`    position=${position}`);
          console.log(`      id            : ${s.id}`);
          console.log(`      fileName      : ${a.fileName}`);
          console.log(`      size          : ${asset.width}x${asset.height} (${a.fileSize} bytes)`);
          console.log(`      deliveryState : ${a.assetDeliveryState?.state}`);
          console.log(`      previewUrl    : ${preview ?? '(templateUrl なし)'}`);

          inventory.push({
            versionString: va.versionString,
            locale,
            displayType,
            setId: set.id,
            position,
            id: s.id,
            fileName: a.fileName,
            width: asset.width,
            height: asset.height,
            previewUrl: preview,
          });
        });
      }
    }
  }

  header('機械可読サマリ (JSON)');
  console.log(JSON.stringify(inventory, null, 2));

  header('合計');
  console.log(`スクリーンショット ${inventory.length} 件`);
}

main().catch((e) => {
  console.error('[fatal]', errInfo(e));
  process.exit(1);
});
