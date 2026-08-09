// App Store Connect API v1 — 外部テスター配布の一式セットアップ
//
// やること (この順序):
//   1. 対象ビルドの解決と検証 (VALID / 期限切れでない)
//   2. 外部 Beta Group の作成 (同名があれば再利用。重複作成しない)
//   3. ビルドをグループに紐付け
//   4. betaAppLocalizations  … アプリ説明 + フィードバックメール
//   5. betaBuildLocalizations … テスト内容 (whatsNew)
//   6. betaAppReviewDetail   … 審査用連絡先
//   7. Beta App Review へ提出
//   8. 公開リンクの有効化 (publicLinkLimit 付き) と最終確認
//
// ■ 安全装置
//   - DRY_RUN が 'false' の時だけ書き込む (既定は dry run)
//   - 既存リソースは作り直さず PATCH で更新する (冪等)
//   - 既に Beta App Review 提出済みなら再提出しない
//   - 連絡先が1つでも欠けていたら開始前に停止する
//
// 必須 env:
//   ASC_ISSUER_ID / ASC_KEY_ID / ASC_P8_KEY (or ASC_P8_KEY_PATH)
//   ASC_APP_ID, BUILD_NUMBER
//   CONTACT_FIRST_NAME / CONTACT_LAST_NAME / CONTACT_PHONE / CONTACT_EMAIL
//   FEEDBACK_EMAIL
// 任意 env:
//   GROUP_NAME        (既定 '外部テスター')
//   PUBLIC_LINK_LIMIT (既定 10)
//   DRY_RUN           (既定 'true')
import fs from 'node:fs';
import { buildAscClient, fmtDate } from './lib/asc-auth.mjs';

const {
  ASC_APP_ID,
  BUILD_NUMBER,
  CONTACT_FIRST_NAME,
  CONTACT_LAST_NAME,
  CONTACT_PHONE,
  CONTACT_EMAIL,
  FEEDBACK_EMAIL,
} = process.env;

const GROUP_NAME = (process.env.GROUP_NAME || '外部テスター').trim();
const PUBLIC_LINK_LIMIT = Number(process.env.PUBLIC_LINK_LIMIT || 10);
const DRY_RUN = (process.env.DRY_RUN ?? 'true').trim() !== 'false';

const DESCRIPTION = fs.readFileSync('scripts/data/beta-app-description-ja.txt', 'utf8').trim();
const TEST_INFO = fs.readFileSync('scripts/data/beta-test-info-ja.txt', 'utf8').trim();

// 連絡先が欠けたまま審査に出すと差し戻される。開始前に止める。
const required = {
  ASC_APP_ID,
  BUILD_NUMBER,
  CONTACT_FIRST_NAME,
  CONTACT_LAST_NAME,
  CONTACT_PHONE,
  CONTACT_EMAIL,
  FEEDBACK_EMAIL,
};
const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`::error::必須 env が未設定: ${missing.join(', ')}`);
  process.exit(1);
}
if (!Number.isFinite(PUBLIC_LINK_LIMIT) || PUBLIC_LINK_LIMIT < 1) {
  console.error('::error::PUBLIC_LINK_LIMIT が不正');
  process.exit(1);
}

const asc = buildAscClient();

function header(s) {
  console.log(`\n${'='.repeat(64)}\n${s}\n${'='.repeat(64)}`);
}
function skip(what) {
  console.log(`  [DRY RUN] ${what} — 実行しない`);
}

async function main() {
  console.log(`ASC_APP_ID        = ${ASC_APP_ID}`);
  console.log(`BUILD_NUMBER      = ${BUILD_NUMBER}`);
  console.log(`GROUP_NAME        = ${GROUP_NAME}`);
  console.log(`PUBLIC_LINK_LIMIT = ${PUBLIC_LINK_LIMIT}`);
  console.log(`FEEDBACK_EMAIL    = ${FEEDBACK_EMAIL}`);
  console.log(`MODE              = ${DRY_RUN ? 'DRY RUN (書き込みなし)' : 'APPLY (書き込む)'}`);

  // ---------------------------------------------------------------- 1
  header('1. 対象ビルドの解決');
  // ★ Build.attributes.version は「ビルド番号」であってバージョン文字列ではない。
  const builds = await asc.get('/builds', {
    'filter[app]': ASC_APP_ID,
    'filter[version]': BUILD_NUMBER,
    include: 'preReleaseVersion',
    limit: 10,
  });
  const build = builds?.data?.[0];
  if (!build) {
    console.error(`::error::ビルド番号 ${BUILD_NUMBER} が見つからない`);
    process.exit(1);
  }
  const pre = builds.included?.find((i) => i.type === 'preReleaseVersions');
  const ba = build.attributes ?? {};
  console.log(`  build id        = ${build.id}`);
  console.log(`  バージョン      = ${pre?.attributes?.version ?? '?'} (build ${ba.version})`);
  console.log(`  processingState = ${ba.processingState}`);
  console.log(`  expired         = ${ba.expired}`);
  console.log(`  有効期限        = ${fmtDate(ba.expirationDate)}`);
  if (ba.processingState !== 'VALID' || ba.expired) {
    console.error('::error::ビルドが VALID でないか期限切れ。配布できない');
    process.exit(1);
  }

  // ---------------------------------------------------------------- 2
  header('2. 外部 Beta Group');
  const groups = await asc.get(`/apps/${ASC_APP_ID}/betaGroups`, { limit: 200 });
  let group = (groups?.data ?? []).find((g) => g.attributes?.name === GROUP_NAME);

  if (group) {
    // 同名グループがあれば作り直さない。内部グループだった場合は
    // 公開リンクを持てないので、黙って進めず止める。
    console.log(`  既存グループを再利用: ${group.id}`);
    if (group.attributes?.isInternalGroup) {
      console.error(`::error::同名グループ「${GROUP_NAME}」は内部グループ。外部グループとして使えない`);
      process.exit(1);
    }
  } else if (DRY_RUN) {
    skip(`外部グループ「${GROUP_NAME}」を作成`);
  } else {
    const created = await asc.post('/betaGroups', {
      data: {
        type: 'betaGroups',
        attributes: {
          name: GROUP_NAME,
          publicLinkEnabled: true,
          publicLinkLimitEnabled: true,
          publicLinkLimit: PUBLIC_LINK_LIMIT,
        },
        relationships: {
          app: { data: { type: 'apps', id: ASC_APP_ID } },
        },
      },
    });
    group = created.data;
    console.log(`  作成した: ${group.id}`);
  }

  // ---------------------------------------------------------------- 3
  header('3. ビルドをグループに紐付け');
  if (!group) {
    skip('ビルドの紐付け (グループ未作成のため)');
  } else {
    const linked = await asc.get(`/betaGroups/${group.id}/builds`, { limit: 200 });
    const already = (linked?.data ?? []).some((b) => b.id === build.id);
    if (already) {
      console.log('  既に紐付け済み');
    } else if (DRY_RUN) {
      skip(`build ${BUILD_NUMBER} をグループに追加`);
    } else {
      await asc.post(`/betaGroups/${group.id}/relationships/builds`, {
        data: [{ type: 'builds', id: build.id }],
      });
      console.log('  紐付けた');
    }
  }

  // ---------------------------------------------------------------- 4
  header('4. betaAppLocalizations (アプリ説明 / フィードバック先)');
  const app = await asc.get(`/apps/${ASC_APP_ID}`);
  const locale = app?.data?.attributes?.primaryLocale || 'ja';
  console.log(`  primaryLocale = ${locale}`);

  const locs = await asc.get(`/apps/${ASC_APP_ID}/betaAppLocalizations`, { limit: 50 });
  const existingLoc = (locs?.data ?? []).find((l) => l.attributes?.locale === locale);
  const locAttrs = { description: DESCRIPTION, feedbackEmail: FEEDBACK_EMAIL };

  if (existingLoc) {
    if (DRY_RUN) skip(`betaAppLocalizations ${existingLoc.id} を更新`);
    else {
      await asc.patch(`/betaAppLocalizations/${existingLoc.id}`, {
        data: { type: 'betaAppLocalizations', id: existingLoc.id, attributes: locAttrs },
      });
      console.log(`  更新した: ${existingLoc.id}`);
    }
  } else if (DRY_RUN) {
    skip(`betaAppLocalizations (${locale}) を作成`);
  } else {
    const c = await asc.post('/betaAppLocalizations', {
      data: {
        type: 'betaAppLocalizations',
        attributes: { locale, ...locAttrs },
        relationships: { app: { data: { type: 'apps', id: ASC_APP_ID } } },
      },
    });
    console.log(`  作成した: ${c.data.id}`);
  }

  // ---------------------------------------------------------------- 5
  header('5. betaBuildLocalizations (テスト内容)');
  const bl = await asc.get(`/builds/${build.id}/betaBuildLocalizations`, { limit: 50 });
  const existingBl = (bl?.data ?? []).find((l) => l.attributes?.locale === locale);
  if (existingBl) {
    if (DRY_RUN) skip(`betaBuildLocalizations ${existingBl.id} を更新`);
    else {
      await asc.patch(`/betaBuildLocalizations/${existingBl.id}`, {
        data: {
          type: 'betaBuildLocalizations',
          id: existingBl.id,
          attributes: { whatsNew: TEST_INFO },
        },
      });
      console.log(`  更新した: ${existingBl.id}`);
    }
  } else if (DRY_RUN) {
    skip(`betaBuildLocalizations (${locale}) を作成`);
  } else {
    const c = await asc.post('/betaBuildLocalizations', {
      data: {
        type: 'betaBuildLocalizations',
        attributes: { locale, whatsNew: TEST_INFO },
        relationships: { build: { data: { type: 'builds', id: build.id } } },
      },
    });
    console.log(`  作成した: ${c.data.id}`);
  }

  // ---------------------------------------------------------------- 6
  header('6. betaAppReviewDetail (審査用連絡先)');
  const detailRes = await asc.get(`/apps/${ASC_APP_ID}/betaAppReviewDetail`);
  const detailId = detailRes?.data?.id;
  // デモアカウントは App Store 審査で既に使われている設定をそのまま引き継ぐ。
  // 「不要」に倒すと審査側がサインインできず差し戻される恐れがあるため、
  // 実績のある構成を変えない。
  // ★ 資格情報はログに出さない (公開リポジトリなので値が残ると事故になる)。
  // ★ このエンドポイントは sort を受け付けない (PARAMETER_ERROR.ILLEGAL)。
  //   複数件取って、連絡先が入っているものを選ぶ。
  const asv = await asc.get(`/apps/${ASC_APP_ID}/appStoreVersions`, {
    limit: 10,
    include: 'appStoreReviewDetail',
  });
  const srcDetail = (asv?.included ?? [])
    .filter((i) => i.type === 'appStoreReviewDetails')
    .find((i) => i.attributes?.contactEmail) ?? null;
  const sd = srcDetail?.attributes ?? {};
  const demo = sd.demoAccountRequired
    ? {
        demoAccountRequired: true,
        demoAccountName: sd.demoAccountName,
        demoAccountPassword: sd.demoAccountPassword,
      }
    : { demoAccountRequired: false };

  console.log(`  デモアカウント = ${demo.demoAccountRequired ? '必要 (App Store 審査の設定を引き継ぐ)' : '不要'}`);
  if (demo.demoAccountRequired && (!demo.demoAccountName || !demo.demoAccountPassword)) {
    // API が伏せて返す場合がある。推測で埋めず、ここで止める。
    console.error('::error::デモアカウントの資格情報が API から取得できない。値を渡してもらう必要がある');
    process.exit(1);
  }

  const detailAttrs = {
    contactFirstName: CONTACT_FIRST_NAME,
    contactLastName: CONTACT_LAST_NAME,
    contactPhone: CONTACT_PHONE,
    contactEmail: CONTACT_EMAIL,
    ...demo,
    notes: TEST_INFO,
  };
  console.log(`  detail id = ${detailId ?? '(なし)'}`);
  if (!detailId) {
    console.error('::error::betaAppReviewDetail が取得できない');
    process.exit(1);
  }
  if (DRY_RUN) skip('betaAppReviewDetail を更新');
  else {
    await asc.patch(`/betaAppReviewDetails/${detailId}`, {
      data: { type: 'betaAppReviewDetails', id: detailId, attributes: detailAttrs },
    });
    console.log('  更新した');
  }

  // ---------------------------------------------------------------- 7
  header('7. Beta App Review へ提出');
  const subs = await asc.get('/betaAppReviewSubmissions', {
    'filter[build]': build.id,
    limit: 10,
  });
  const existingSub = subs?.data?.[0];
  if (existingSub) {
    // 既に出ているものを二重に出さない。状態だけ報告する。
    console.log(`  既に提出済み: ${existingSub.id} state=${existingSub.attributes?.betaReviewState}`);
  } else if (DRY_RUN) {
    skip(`build ${BUILD_NUMBER} を Beta App Review に提出`);
  } else {
    const c = await asc.post('/betaAppReviewSubmissions', {
      data: {
        type: 'betaAppReviewSubmissions',
        relationships: { build: { data: { type: 'builds', id: build.id } } },
      },
    });
    console.log(`  提出した: ${c.data.id} state=${c.data.attributes?.betaReviewState}`);
  }

  // ---------------------------------------------------------------- 8
  header('8. 公開リンクの確認');
  if (!group) {
    skip('公開リンクの有効化 (グループ未作成のため)');
  } else {
    // 作成時に publicLinkEnabled を立てているが、既存グループ再利用の場合や
    // 上限値の変更に備えて明示的に PATCH して揃える。
    const want = {
      publicLinkEnabled: true,
      publicLinkLimitEnabled: true,
      publicLinkLimit: PUBLIC_LINK_LIMIT,
    };
    if (DRY_RUN) {
      skip(`グループ ${group.id} の公開リンク設定を ${JSON.stringify(want)} に更新`);
    } else {
      await asc.patch(`/betaGroups/${group.id}`, {
        data: { type: 'betaGroups', id: group.id, attributes: want },
      });
      const after = await asc.get(`/betaGroups/${group.id}`);
      const aa = after?.data?.attributes ?? {};
      console.log(`  publicLinkEnabled = ${aa.publicLinkEnabled}`);
      console.log(`  publicLinkLimit   = ${aa.publicLinkLimit}`);
      console.log(`  publicLink        = ${aa.publicLink ?? '(未払い出し)'}`);
      if (!aa.publicLink) {
        console.log('  ※ 公開リンクは Beta App Review 承認後に有効になる場合がある');
      }
    }
  }

  header('完了');
  if (DRY_RUN) {
    console.log('DRY RUN のため ASC は一切変更していない。');
  } else {
    console.log('審査の承認は非同期。状態は asc-testflight-status.mjs で確認する。');
  }
}

main().catch((e) => {
  console.error('[fatal]', e?.message ?? e);
  process.exit(1);
});
