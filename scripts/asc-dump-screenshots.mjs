// スクリーンショットの縮小プレビューを取得し、base64 でログに出力する。
//
// なぜ必要か:
//   Apple の画像 CDN (mzstatic.com) は開発環境のプロキシに遮断されており、
//   templateUrl を手元から直接 fetch できない。GitHub Actions ランナーからは
//   到達できるので、そこで縮小版を取得し base64 としてログに載せて持ち出す。
//   これにより「どの画像が壊れているか」を実際に目視して判断できる。
//
// 出力形式 (行指向。後段で機械的に切り出せるようにする):
//   ===SHOT-BEGIN <id> | <displayType> | <locale> | position=<n> | <fileName>===
//   <base64 を 200 文字ごとに改行したもの>
//   ===SHOT-END <id>===
//
// 読み取り専用。削除も更新も行わない。
import { buildAscClient } from './lib/asc-auth.mjs';

const APP_ID = process.env.ASC_APP_ID || '6766822899';
// 目視判定できる最小限のサイズに抑える (ログ肥大を防ぐ)
const PREVIEW_WIDTH = Number(process.env.PREVIEW_WIDTH || 300);
const CHUNK = 200;
// 絞り込み (未指定なら全件)。バージョンが増えると全件 dump は
// ログが肥大して扱えなくなるため、対象を 1 枚に絞れるようにする。
const FILTER_VERSION = (process.env.FILTER_VERSION || '').trim();
const FILTER_FILE_NAME = (process.env.FILTER_FILE_NAME || '').trim();

const asc = buildAscClient();

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
    console.log(`[GET ${path}] ${errInfo(e)}`);
    return null;
  }
}

function buildPreviewUrl(templateUrl, srcW, srcH, width) {
  if (!templateUrl) return null;
  const h = srcW && srcH ? Math.round((srcH / srcW) * width) : width * 2;
  return templateUrl
    .replace('{w}', String(width))
    .replace('{h}', String(h))
    .replace('{c}', 'bb')
    .replace('{f}', 'png');
}

async function main() {
  console.log(`APP_ID=${APP_ID} PREVIEW_WIDTH=${PREVIEW_WIDTH}`);
  console.log(`FILTER_VERSION=${FILTER_VERSION || '(全件)'}`);
  console.log(`FILTER_FILE_NAME=${FILTER_FILE_NAME || '(全件)'}`);

  const versionsResp = await get(`/apps/${APP_ID}/appStoreVersions`, {
    'filter[platform]': 'IOS',
    limit: 50,
  });

  for (const v of versionsResp?.data ?? []) {
    if (FILTER_VERSION && v.attributes?.versionString !== FILTER_VERSION) continue;
    const locsResp = await get(
      `/appStoreVersions/${v.id}/appStoreVersionLocalizations`,
      { limit: 50 },
    );
    for (const loc of locsResp?.data ?? []) {
      const locale = loc.attributes?.locale;
      const setsResp = await get(
        `/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`,
        { limit: 50 },
      );
      for (const set of setsResp?.data ?? []) {
        const displayType = set.attributes?.screenshotDisplayType;
        const shotsResp = await get(
          `/appScreenshotSets/${set.id}/appScreenshots`,
          { limit: 50 },
        );
        const shots = shotsResp?.data ?? [];

        for (let i = 0; i < shots.length; i++) {
          const s = shots[i];
          const a = s.attributes ?? {};
          if (FILTER_FILE_NAME && a.fileName !== FILTER_FILE_NAME) continue;
          const asset = a.imageAsset ?? {};
          const url = buildPreviewUrl(
            asset.templateUrl,
            asset.width,
            asset.height,
            PREVIEW_WIDTH,
          );
          const label = `${s.id} | ${displayType} | ${locale} | position=${i + 1} | ${a.fileName}`;

          if (!url) {
            console.log(`===SHOT-SKIP ${label} (templateUrl なし)===`);
            continue;
          }

          try {
            const res = await fetch(url);
            if (!res.ok) {
              console.log(`===SHOT-SKIP ${label} (HTTP ${res.status})===`);
              continue;
            }
            const buf = Buffer.from(await res.arrayBuffer());
            const b64 = buf.toString('base64');
            console.log(`===SHOT-BEGIN ${label}===`);
            for (let p = 0; p < b64.length; p += CHUNK) {
              console.log(b64.slice(p, p + CHUNK));
            }
            console.log(`===SHOT-END ${s.id}===`);
            console.log(`(${buf.length} bytes / base64 ${b64.length} 文字)`);
          } catch (e) {
            console.log(`===SHOT-SKIP ${label} (fetch 失敗: ${e.message})===`);
          }
        }
      }
    }
  }
}

main().catch((e) => {
  console.error('[fatal]', errInfo(e));
  process.exit(1);
});
