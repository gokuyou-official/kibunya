// EU のトレーダーステータス (DSA) と年齢レーティングの現状を調べる。
//
// ★ 読み取り専用。GET のみ。書き込みは一切しない。
//
// 何を見たいか:
//   1. トレーダーステータスを表すリソースが ASC API に存在するか。
//      Apple は DSA 対応で「取引業者 (trader) かどうか」の申告を求めるが、
//      API で読めるのか、ASC の画面でしか扱えないのかが分からない。
//      候補のエンドポイントを順に叩き、存在するものだけを報告する。
//   2. 配信先の地域。EU を外す案を検討するため、いま何カ国に出ていて
//      そのうち EU が何カ国かを数える。
//   3. 年齢レーティングの未回答項目。どのキーが必須で何が入るのか、
//      実際の値を見てから直す (当てずっぽうで PATCH しない)。
//
// 必須 env: ASC_ISSUER_ID / ASC_KEY_ID / ASC_P8_KEY
// 任意 env: ASC_APP_ID (既定 6766822899)
import { buildAscClient } from './lib/asc-auth.mjs';

const APP_ID = process.env.ASC_APP_ID || '6766822899';
const asc = buildAscClient();

// EU 加盟 27 カ国の ISO コード。DSA の適用範囲を数えるために持つ。
const EU = new Set([
  'AUT', 'BEL', 'BGR', 'HRV', 'CYP', 'CZE', 'DNK', 'EST', 'FIN', 'FRA',
  'DEU', 'GRC', 'HUN', 'IRL', 'ITA', 'LVA', 'LTU', 'LUX', 'MLT', 'NLD',
  'POL', 'PRT', 'ROU', 'SVK', 'SVN', 'ESP', 'SWE',
]);

function header(s) {
  console.log(`\n${'='.repeat(60)}\n${s}\n${'='.repeat(60)}`);
}

function errInfo(e) {
  return (
    e?.json?.errors?.map((x) => `${x.status} ${x.code}: ${x.detail}`).join(' | ') ??
    e?.message
  );
}

async function probe(path, query) {
  try {
    const r = await asc.get(path, query);
    return { ok: true, data: r };
  } catch (e) {
    return { ok: false, status: e?.status, detail: errInfo(e) };
  }
}

async function main() {
  console.log(`APP_ID = ${APP_ID}`);
  console.log('MODE   = READ ONLY (GET のみ)');

  // ---------------------------------------------- 1. トレーダーステータス
  header('1. トレーダーステータス (DSA) を表すリソースを探す');

  // Apple がどの名前で公開しているか確定していないので、ありそうな順に叩く。
  // 404 PATH_ERROR なら「その関連自体が存在しない」= API では扱えない。
  const candidates = [
    [`/apps/${APP_ID}`, { 'fields[apps]': 'name,bundleId,streamlinedPurchasingEnabled' }],
    [`/apps/${APP_ID}/appStoreVersions`, { limit: 1 }],
    [`/apps/${APP_ID}/marketplaceSearchDetail`, undefined],
    [`/apps/${APP_ID}/alternativeDistributionKey`, undefined],
    [`/apps/${APP_ID}/appEncryptionDeclarations`, { limit: 1 }],
    [`/apps/${APP_ID}/endUserLicenseAgreement`, undefined],
    [`/apps/${APP_ID}/appAvailabilityV2`, undefined],
  ];
  for (const [p, q] of candidates) {
    const r = await probe(p, q);
    if (r.ok) {
      const d = r.data?.data;
      const kind = Array.isArray(d) ? `配列 ${d.length}件` : d?.type ?? '(型不明)';
      console.log(`  ✓ ${p}  → ${kind}`);
      if (!Array.isArray(d) && d?.attributes) {
        for (const [k, v] of Object.entries(d.attributes)) {
          console.log(`      ${k} = ${JSON.stringify(v)}`);
        }
      }
    } else {
      console.log(`  × ${p}  → ${r.status} ${r.detail}`);
    }
  }

  // app 本体の attributes を全部出す。trader 関連のキーが紛れていないか。
  const appResp = await probe(`/apps/${APP_ID}`);
  if (appResp.ok) {
    console.log('\n  --- /apps/{id} の attributes 全キー ---');
    const attrs = appResp.data?.data?.attributes ?? {};
    for (const [k, v] of Object.entries(attrs)) {
      console.log(`    ${k} = ${JSON.stringify(v)}`);
    }
    console.log('\n  --- /apps/{id} の relationships 全キー ---');
    const rels = appResp.data?.data?.relationships ?? {};
    console.log(`    ${Object.keys(rels).join(', ') || '(なし)'}`);
  }

  // ---------------------------------------------------- 2. 配信先の地域
  header('2. 配信先の地域 (EU を外す案の検討材料)');
  const availHead = await probe(`/apps/${APP_ID}/appAvailabilityV2`);
  if (!availHead.ok) {
    console.log(`  取得できず: ${availHead.status} ${availHead.detail}`);
  } else {
    const availId = availHead.data?.data?.id;
    const a = availHead.data?.data?.attributes ?? {};
    console.log(`  appAvailabilityV2 id=${availId}`);
    console.log(`  availableInNewTerritories = ${JSON.stringify(a.availableInNewTerritories)}`);

    // ★ limit の上限は 50。それ以上を渡すと 400 になるので cursor で回す。
    let cursor;
    let page = 0;
    let total = 0;
    let available = 0;
    const euList = [];
    const unavailableEu = [];
    for (;;) {
      const q = { limit: 50, include: 'territory' };
      if (cursor) q.cursor = cursor;
      const r = await probe(`/appAvailabilitiesV2/${availId}/territoryAvailabilities`, q);
      if (!r.ok) {
        console.log(`  ページ取得に失敗: ${r.status} ${r.detail}`);
        break;
      }
      const rows = r.data?.data ?? [];
      for (const t of rows) {
        total++;
        const code = t.relationships?.territory?.data?.id ?? '???';
        if (t.attributes?.available) {
          available++;
          if (EU.has(code)) euList.push(code);
        } else if (EU.has(code)) {
          unavailableEu.push(code);
        }
      }
      page++;
      // links.next があれば cursor を取り出して続ける。
      const next = r.data?.links?.next;
      if (!next || rows.length === 0) break;
      try {
        cursor = new URL(next).searchParams.get('cursor') ?? undefined;
      } catch {
        cursor = undefined;
      }
      if (!cursor) break;
      if (page > 20) break; // 保険
    }
    console.log(`  territoryAvailabilities = ${total}件 (${page}ページ)`);
    console.log(`  配信中 = ${available}カ国`);
    console.log(`  うち EU 27カ国のうち配信中 = ${euList.length}カ国`);
    if (euList.length) console.log(`    配信中の EU: ${euList.sort().join(', ')}`);
    if (unavailableEu.length) {
      console.log(`    配信していない EU: ${unavailableEu.sort().join(', ')}`);
    }
  }

  // -------------------------------------------------- 3. 年齢レーティング
  header('3. 年齢レーティングの現状 (未回答キーの実値)');
  const infos = await probe(`/apps/${APP_ID}/appInfos`, {
    include: 'ageRatingDeclaration',
  });
  if (!infos.ok) {
    console.log(`  取得できず: ${infos.status} ${infos.detail}`);
  } else {
    const included = infos.data?.included ?? [];
    for (const info of infos.data?.data ?? []) {
      const ia = info.attributes ?? {};
      const ardId = info.relationships?.ageRatingDeclaration?.data?.id;
      console.log(`\n  appInfo ${info.id} state=${ia.appStoreState ?? ia.state}`);
      const ard = included.find(
        (x) => x.type === 'ageRatingDeclarations' && x.id === ardId,
      );
      if (!ard) {
        console.log('    ageRatingDeclaration が取得できない');
        continue;
      }
      console.log(`    ageRatingDeclaration id=${ard.id}`);
      const attrs = ard.attributes ?? {};
      const nulls = [];
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined) nulls.push(k);
      }
      console.log(`    属性 ${Object.keys(attrs).length}件 / null ${nulls.length}件`);
      console.log(`    null のキー: ${nulls.join(', ') || '(なし)'}`);
      // 韓国 GRAC まわりだけ値を出す (今回の対象)。
      for (const k of Object.keys(attrs)) {
        if (/grac|korea|kids|ageRatingOverride|developerAgeRating/i.test(k)) {
          console.log(`      ${k} = ${JSON.stringify(attrs[k])}`);
        }
      }
    }
  }

  console.log('\n完了 (読み取りのみ。ASC は一切変更していない)');
}

main().catch((e) => {
  console.error('[fatal]', errInfo(e));
  process.exit(1);
});
