// 「Version is not ready to be submitted yet」の原因を特定する読み取り専用診断。
//
// 提出をブロックしうる要素を片端から GET して可視化する:
//   - appStoreVersion の状態 / build 紐付け
//   - build の輸出コンプライアンス (usesNonExemptEncryption が null だと提出不可)
//   - ローカライズ (description / keywords / whatsNew / supportUrl)
//   - スクリーンショット (必須サイズが空だと提出不可)
//   - appInfo (カテゴリ / プライバシーポリシー) と年齢レーティング
//   - 価格スケジュール (未設定だと提出不可。過去の asc-submit で問題化した箇所)
//
// 一切書き込みを行わないので安全に何度でも実行できる。
import { buildAscClient } from './lib/asc-auth.mjs';

const APP_ID = process.env.ASC_APP_ID || '6766822899';
const TARGET_VERSION_STRING = process.env.TARGET_VERSION_STRING || '1.0.3';

const asc = buildAscClient();

function header(s) {
  console.log(`\n${'='.repeat(60)}\n${s}\n${'='.repeat(60)}`);
}

async function get(path, query) {
  try {
    return await asc.get(path, query);
  } catch (e) {
    const detail =
      e?.json?.errors?.map((x) => `${x.status} ${x.code}: ${x.detail}`).join(' | ') ??
      e?.message;
    console.log(`  [GET ${path}] エラー: ${detail}`);
    return null;
  }
}

const problems = [];
function flag(msg) {
  problems.push(msg);
  console.log(`  ★ ${msg}`);
}

async function main() {
  header('1. appStoreVersions');
  const versionsResp = await get(`/apps/${APP_ID}/appStoreVersions`, {
    'filter[platform]': 'IOS',
    limit: 50,
  });
  const versions = versionsResp?.data ?? [];
  for (const v of versions) {
    const a = v.attributes ?? {};
    console.log(
      `  id=${v.id}\n    versionString=${a.versionString} state=${a.appStoreState ?? a.appVersionState} releaseType=${a.releaseType} createdDate=${a.createdDate}`,
    );
  }
  const target = versions.find(
    (v) => v.attributes?.versionString === TARGET_VERSION_STRING,
  );
  if (!target) {
    console.log(`\n対象 ${TARGET_VERSION_STRING} が見つからない`);
    return;
  }
  const vId = target.id;
  console.log(`\n→ 対象 versionId = ${vId}`);

  header('2. 紐付いている build と輸出コンプライアンス');
  const buildRel = await get(`/appStoreVersions/${vId}/build`);
  const build = buildRel?.data;
  if (!build) {
    flag('build が紐付いていない');
  } else {
    console.log(`  build id=${build.id}`);
    const b = await get(`/builds/${build.id}`);
    const ba = b?.data?.attributes ?? {};
    console.log(
      `  version=${ba.version} processingState=${ba.processingState} expired=${ba.expired}`,
    );
    console.log(`  usesNonExemptEncryption=${JSON.stringify(ba.usesNonExemptEncryption)}`);
    if (ba.usesNonExemptEncryption === null || ba.usesNonExemptEncryption === undefined) {
      flag(
        '輸出コンプライアンス未回答 (usesNonExemptEncryption=null)。これは提出をブロックする',
      );
    }
    if (ba.processingState !== 'VALID') {
      flag(`build が VALID でない (${ba.processingState})`);
    }
  }

  header('3. バージョンのローカライズ (説明文など)');
  const locResp = await get(`/appStoreVersions/${vId}/appStoreVersionLocalizations`, {
    limit: 20,
  });
  const locs = locResp?.data ?? [];
  if (locs.length === 0) flag('appStoreVersionLocalizations が 0 件');
  for (const l of locs) {
    const a = l.attributes ?? {};
    console.log(
      `  locale=${a.locale} description=${a.description ? `${a.description.length}文字` : '★空'} keywords=${a.keywords ? 'あり' : '★空'} whatsNew=${a.whatsNew ? 'あり' : '(空)'} supportUrl=${a.supportUrl ?? '★空'} marketingUrl=${a.marketingUrl ?? '(空)'}`,
    );
    if (!a.description) flag(`locale=${a.locale} の description が空`);
    if (!a.keywords) flag(`locale=${a.locale} の keywords が空`);
    if (!a.supportUrl) flag(`locale=${a.locale} の supportUrl が空`);

    // スクリーンショット
    const ssResp = await get(
      `/appStoreVersionLocalizations/${l.id}/appScreenshotSets`,
      { limit: 20 },
    );
    const sets = ssResp?.data ?? [];
    if (sets.length === 0) {
      flag(`locale=${a.locale} にスクリーンショットセットが無い`);
    } else {
      for (const s of sets) {
        const shots = await get(`/appScreenshotSets/${s.id}/appScreenshots`, {
          limit: 10,
        });
        const n = shots?.data?.length ?? 0;
        const states = (shots?.data ?? [])
          .map((x) => x.attributes?.assetDeliveryState?.state)
          .join(',');
        console.log(
          `    screenshotSet ${s.attributes?.screenshotDisplayType}: ${n}枚 [${states}]`,
        );
        if (n === 0) {
          flag(`${a.locale} / ${s.attributes?.screenshotDisplayType} が 0 枚`);
        }
      }
    }
  }

  header('4. appInfo (カテゴリ / プライバシーポリシー / 年齢レーティング)');
  const infosResp = await get(`/apps/${APP_ID}/appInfos`, { limit: 10 });
  for (const info of infosResp?.data ?? []) {
    const a = info.attributes ?? {};
    console.log(
      `  appInfo id=${info.id} state=${a.appStoreState ?? a.state} ageRatingDeclaration=${info.relationships?.ageRatingDeclaration?.data?.id ?? '(なし)'}`,
    );
    const cats = info.relationships ?? {};
    console.log(
      `    primaryCategory=${cats.primaryCategory?.data?.id ?? '★未設定'} secondaryCategory=${cats.secondaryCategory?.data?.id ?? '(なし)'}`,
    );
    if (!cats.primaryCategory?.data?.id) flag('primaryCategory が未設定');

    const ilResp = await get(`/appInfos/${info.id}/appInfoLocalizations`, {
      limit: 20,
    });
    for (const il of ilResp?.data ?? []) {
      const ia = il.attributes ?? {};
      console.log(
        `    locale=${ia.locale} name=${ia.name ?? '★空'} subtitle=${ia.subtitle ?? '(空)'} privacyPolicyUrl=${ia.privacyPolicyUrl ?? '★空'}`,
      );
      if (!ia.privacyPolicyUrl) flag(`locale=${ia.locale} の privacyPolicyUrl が空`);
    }
  }

  header('5. 価格スケジュール');
  const sched = await get(`/apps/${APP_ID}/appPriceSchedule`);
  if (!sched?.data) {
    flag('appPriceSchedule が未設定 (提出をブロックしうる)');
  } else {
    console.log(`  appPriceSchedule id=${sched.data.id}`);
  }

  header('6. 利用可能地域 (availability)');
  const avail = await get(`/apps/${APP_ID}/appAvailabilityV2`);
  if (!avail?.data) {
    console.log('  取得できず (この API を使えないプランの可能性)');
  } else {
    console.log(`  availability id=${avail.data.id} ${JSON.stringify(avail.data.attributes ?? {})}`);
  }

  header('7. reviewSubmissions の現状');
  const subsResp = await get('/reviewSubmissions', {
    'filter[app]': APP_ID,
    'filter[platform]': 'IOS',
    limit: 50,
  });
  for (const s of subsResp?.data ?? []) {
    console.log(`  id=${s.id} state=${s.attributes?.state} submitted=${s.attributes?.submittedDate ?? '-'}`);
  }

  header('診断結果まとめ');
  if (problems.length === 0) {
    console.log(
      '明確な欠落は検出されなかった。Apple 側の伝播待ち (build 紐付け直後) の可能性が高い。',
    );
  } else {
    console.log(`提出をブロックしうる項目 ${problems.length} 件:`);
    problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  }
}

main().catch((e) => {
  console.error('[fatal]', e?.message ?? e);
  process.exit(1);
});
