// 「Version is not ready to be submitted yet」の残り要因を確定させ、
// API で安全に直せるものだけ直すスクリプト。
//
// 前回診断の反省: relationships は include を付けないと data が返らないため
// 「未設定」と誤検出しうる (reviewSubmissionItems で同じ罠を踏んだ)。
// ここでは必ず include 付きで取得し、実体を確認してから書き込む。
//
// 確認・修正対象:
//   - app.contentRightsDeclaration (未宣言だと提出をブロックする)
//   - appInfo.primaryCategory (未設定なら PATCH /v1/appInfos/{id} で設定。
//     過去に /relationships/primaryCategory サブリソースへの PATCH が 403 に
//     なったが、正しい書き方はリソース本体の PATCH に relationships を載せる)
//   - ageRatingDeclaration の中身 (未設定項目があれば列挙する。値の決定は
//     製品判断を伴うため、ここでは自動で埋めず報告に留める)
import { buildAscClient } from './lib/asc-auth.mjs';

const APP_ID = process.env.ASC_APP_ID || '6766822899';
const TARGET_VERSION_STRING = process.env.TARGET_VERSION_STRING || '1.0.3';
const PRIMARY_CATEGORY_ID = process.env.PRIMARY_CATEGORY_ID || 'SOCIAL_NETWORKING';
const DRY_RUN = String(process.env.DRY_RUN ?? 'false') === 'true';

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

async function get(path, query) {
  try {
    return await asc.get(path, query);
  } catch (e) {
    console.log(`  [GET ${path}] ${errInfo(e)}`);
    return null;
  }
}

const todo = [];

async function main() {
  header('1. app 本体の宣言事項');
  const appResp = await get(`/apps/${APP_ID}`);
  const appAttrs = appResp?.data?.attributes ?? {};
  console.log(`  name=${appAttrs.name} bundleId=${appAttrs.bundleId}`);
  console.log(`  contentRightsDeclaration=${JSON.stringify(appAttrs.contentRightsDeclaration)}`);

  if (!appAttrs.contentRightsDeclaration) {
    console.log('  ★ contentRightsDeclaration が未宣言 → 提出をブロックする');
    if (!DRY_RUN) {
      try {
        await asc.patch(`/apps/${APP_ID}`, {
          data: {
            type: 'apps',
            id: APP_ID,
            attributes: {
              contentRightsDeclaration: 'DOES_NOT_USE_THIRD_PARTY_CONTENT',
            },
          },
        });
        console.log('  ✓ DOES_NOT_USE_THIRD_PARTY_CONTENT を設定した');
      } catch (e) {
        console.log(`  [warn] 設定失敗: ${errInfo(e)}`);
        todo.push('contentRightsDeclaration の設定に失敗');
      }
    }
  } else {
    console.log('  → 宣言済み。問題なし');
  }

  header('2. appInfo (include でリレーションを確実に取得)');
  const infosResp = await get(`/apps/${APP_ID}/appInfos`, {
    include: 'primaryCategory,secondaryCategory,ageRatingDeclaration',
    limit: 10,
  });
  const infos = infosResp?.data ?? [];
  const included = infosResp?.included ?? [];

  for (const info of infos) {
    const st = info.attributes?.appStoreState ?? info.attributes?.state;
    const primary = info.relationships?.primaryCategory?.data?.id;
    const secondary = info.relationships?.secondaryCategory?.data?.id;
    const ageDeclId = info.relationships?.ageRatingDeclaration?.data?.id;
    console.log(`  appInfo id=${info.id} state=${st}`);
    console.log(`    primaryCategory   = ${primary ?? '(未設定)'}`);
    console.log(`    secondaryCategory = ${secondary ?? '(なし)'}`);
    console.log(`    ageRatingDeclaration = ${ageDeclId ?? '(なし)'}`);

    // 編集可能な appInfo だけが書き込み対象
    const editable = st === 'PREPARE_FOR_SUBMISSION' || st === 'READY_FOR_DISTRIBUTION';

    if (!primary && editable) {
      console.log(`  ★ primaryCategory 未設定 → ${PRIMARY_CATEGORY_ID} を設定する`);
      if (!DRY_RUN) {
        // 注意: /appInfos/{id}/relationships/primaryCategory への PATCH は
        // 403 になる (過去に確認済)。リソース本体の PATCH に relationships を
        // 載せるのが正しい。
        try {
          await asc.patch(`/appInfos/${info.id}`, {
            data: {
              type: 'appInfos',
              id: info.id,
              relationships: {
                primaryCategory: {
                  data: { type: 'appCategories', id: PRIMARY_CATEGORY_ID },
                },
              },
            },
          });
          console.log('  ✓ primaryCategory を設定した');
        } catch (e) {
          console.log(`  [warn] 設定失敗: ${errInfo(e)}`);
          todo.push(
            `primaryCategory の設定に失敗 (${errInfo(e)})。App Store Connect の App 情報ページでの設定が必要かもしれない`,
          );
        }
      }
    }

    // 年齢レーティングの中身を確認 (値の決定は製品判断なので自動では埋めない)
    if (ageDeclId) {
      const decl = included.find(
        (x) => x.type === 'ageRatingDeclarations' && x.id === ageDeclId,
      );
      const da = decl?.attributes ?? {};
      const keys = Object.keys(da);
      if (keys.length === 0) {
        console.log('    (ageRatingDeclaration の属性を取得できず)');
      } else {
        const unset = keys.filter((k) => da[k] === null || da[k] === undefined);
        console.log(`    宣言済み項目 ${keys.length - unset.length}/${keys.length}`);
        console.log(
          `    alcoholTobaccoOrDrugUseOrReferences = ${JSON.stringify(da.alcoholTobaccoOrDrugUseOrReferences)}`,
        );
        if (unset.length > 0) {
          console.log(`    ★ 未設定項目: ${unset.join(', ')}`);
          todo.push(`ageRatingDeclaration の未設定項目: ${unset.join(', ')}`);
        }
      }
    } else {
      todo.push('ageRatingDeclaration が存在しない');
    }
  }

  header('3. 対象バージョンの状態を再確認');
  const vResp = await get(`/apps/${APP_ID}/appStoreVersions`, {
    'filter[platform]': 'IOS',
    'filter[versionString]': TARGET_VERSION_STRING,
    include: 'build,appStoreVersionLocalizations',
    limit: 5,
  });
  for (const v of vResp?.data ?? []) {
    const a = v.attributes ?? {};
    console.log(
      `  id=${v.id} versionString=${a.versionString} state=${a.appStoreState ?? a.appVersionState}`,
    );
    console.log(`    build=${v.relationships?.build?.data?.id ?? '(未紐付け)'}`);
  }

  header('まとめ');
  if (todo.length === 0) {
    console.log('API 側で対応が必要な残件は無し。提出を再試行できる状態。');
  } else {
    console.log('残件:');
    todo.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  }
}

main().catch((e) => {
  console.error('[fatal]', errInfo(e));
  process.exit(1);
});
