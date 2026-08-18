// App Store Connect に新しい appStoreVersion (App Store 掲載バージョン) を作る。
//
// 背景:
//   app.json の expo.version を上げて TestFlight にビルドを上げても、
//   作られるのは「プレリリーストレイン」であって App Store 掲載情報を持つ
//   appStoreVersion レコードではない。後者は明示的に作成する必要がある。
//   (1.0.4 のビルド 82 が TestFlight にあるのに appStoreVersion 1.0.4 が
//    存在しなかったのはこのため)
//
// 作成すると、ASC が直前のバージョンからメタデータ (ローカライゼーション・
// スクリーンショット等) を複製する。掲載画像の差し替え/削除は、この
// 新バージョン配下の複製に対して行う。公開済みバージョンの画像は Apple が
// ロックしていて触れない (409 STATE_ERROR)。
//
// ガード:
//   1. DRY_RUN 既定 true。実作成には DRY_RUN=false が必要。
//   2. 同じ versionString が既にあれば作成せず終了 (冪等)。
//   3. 作成後に GET し直して state と ID を表示する。
//
// 必須 env: ASC_ISSUER_ID / ASC_KEY_ID / ASC_P8_KEY
// 任意 env: ASC_APP_ID (既定 6766822899) / VERSION_STRING (既定 1.0.4)
//           PLATFORM (既定 IOS) / DRY_RUN (既定 'true')
import { buildAscClient } from './lib/asc-auth.mjs';

const APP_ID = process.env.ASC_APP_ID || '6766822899';
const VERSION_STRING = (process.env.VERSION_STRING || '1.0.4').trim();
const PLATFORM = (process.env.PLATFORM || 'IOS').trim();
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

async function listVersions() {
  const resp = await asc.get(`/apps/${APP_ID}/appStoreVersions`, {
    'filter[platform]': PLATFORM,
    limit: 50,
  });
  return (resp?.data ?? []).map((v) => ({
    id: v.id,
    versionString: v.attributes?.versionString,
    state: v.attributes?.appStoreState ?? v.attributes?.appVersionState,
  }));
}

async function main() {
  console.log(`APP_ID         = ${APP_ID}`);
  console.log(`VERSION_STRING = ${VERSION_STRING}`);
  console.log(`PLATFORM       = ${PLATFORM}`);
  console.log(`DRY_RUN        = ${DRY_RUN}`);

  header('1. 既存バージョンを確認');
  let existing;
  try {
    existing = await listVersions();
  } catch (e) {
    abort(`バージョン一覧の取得に失敗: ${errInfo(e)}`);
  }
  for (const v of existing) {
    console.log(`  ${v.versionString} (state=${v.state}) id=${v.id}`);
  }

  const already = existing.find((v) => v.versionString === VERSION_STRING);
  if (already) {
    console.log(
      `\n→ ${VERSION_STRING} は既に存在する (id=${already.id}, state=${already.state})。作成不要。`,
    );
    return;
  }

  if (DRY_RUN) {
    header('DRY_RUN のため作成しない');
    console.log(`実作成するには DRY_RUN=false で再実行すること。`);
    return;
  }

  header('2. appStoreVersion を作成');
  let created;
  try {
    const resp = await asc.post('/appStoreVersions', {
      data: {
        type: 'appStoreVersions',
        attributes: { platform: PLATFORM, versionString: VERSION_STRING },
        relationships: { app: { data: { type: 'apps', id: APP_ID } } },
      },
    });
    created = resp?.data;
  } catch (e) {
    abort(`作成失敗: ${errInfo(e)}`);
  }
  console.log(`✓ 作成成功 id=${created?.id}`);

  header('3. 作成後の状態を検証');
  const after = await listVersions();
  for (const v of after) {
    const mark = v.versionString === VERSION_STRING ? ' ←今回作成' : '';
    console.log(`  ${v.versionString} (state=${v.state}) id=${v.id}${mark}`);
  }
  if (!after.find((v) => v.versionString === VERSION_STRING)) {
    abort('作成したはずのバージョンが一覧に現れない');
  }
}

main().catch((e) => {
  console.error('[fatal]', errInfo(e));
  process.exit(1);
});
