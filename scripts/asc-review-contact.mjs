// 審査用連絡先 (appStoreReviewDetail) のメールアドレスだけを差し替える。
//
// なぜ専用スクリプトなのか:
//   appStoreReviewDetail には氏名・電話・デモアカウント・審査メモが同居する。
//   既存スクリプト (asc-submit-5115.mjs) は notes を書き足す作りなので、
//   「メールだけ変えたい」用途には使えない。ここでは attributes を
//   1 つだけ送り、他のフィールドには触れない。
//
// ガード:
//   1. DRY_RUN 既定 true。
//   2. 対象バージョンの versionString と state を検証してから書く
//      (公開済みには触れない)。EXPECT_VERSION_ID で取り違えも防ぐ。
//   3. 変更前の氏名・電話を控え、PATCH 後に読み直して
//      「メールだけが変わり、氏名・電話は元のまま」を検証する。
//      1 つでもズレたら異常終了する。
//   4. 既に目的の値なら何もしない (no-op)。
//
// 必須 env: ASC_ISSUER_ID / ASC_KEY_ID / ASC_P8_KEY
// 任意 env:
//   ASC_APP_ID            (既定 6766822899)
//   TARGET_VERSION_STRING (既定 1.0.4)
//   EXPECT_VERSION_ID     指定時はバージョン ID の一致も検証する
//   NEW_CONTACT_EMAIL     設定する連絡先メール (必須)
//   DRY_RUN               (既定 'true')
import { buildAscClient } from './lib/asc-auth.mjs';

const APP_ID = process.env.ASC_APP_ID || '6766822899';
const TARGET_VERSION_STRING = (process.env.TARGET_VERSION_STRING || '1.0.4').trim();
const EXPECT_VERSION_ID = (process.env.EXPECT_VERSION_ID || '').trim();
const NEW_CONTACT_EMAIL = (process.env.NEW_CONTACT_EMAIL || '').trim();
const DRY_RUN = String(process.env.DRY_RUN ?? 'true') !== 'false';

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
  console.log(`NEW_CONTACT_EMAIL     = ${NEW_CONTACT_EMAIL || '(未指定)'}`);
  console.log(`DRY_RUN               = ${DRY_RUN}`);

  if (!NEW_CONTACT_EMAIL) abort('NEW_CONTACT_EMAIL が未指定');

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

  header('1. 現在の審査用連絡先');
  const detailResp = await asc.get(`/appStoreVersions/${vId}/appStoreReviewDetail`);
  const detail = detailResp?.data;
  if (!detail?.id) abort('appStoreReviewDetail が取得できない');
  const before = detail.attributes ?? {};
  console.log(`  detail id      = ${detail.id}`);
  console.log(`  contactFirstName = ${JSON.stringify(before.contactFirstName)}`);
  console.log(`  contactLastName  = ${JSON.stringify(before.contactLastName)}`);
  console.log(`  contactPhone     = ${JSON.stringify(before.contactPhone)}`);
  console.log(`  contactEmail     = ${JSON.stringify(before.contactEmail)}`);
  console.log(`  demoAccountRequired = ${JSON.stringify(before.demoAccountRequired)}`);
  console.log(`  notes            = ${before.notes ? `${String(before.notes).length}文字` : '(空)'}`);

  if (before.contactEmail === NEW_CONTACT_EMAIL) {
    console.log('\n  既に目的の値。何もしない (no-op)。');
    return;
  }

  header('2. 差し替え');
  console.log(`  contactEmail: ${JSON.stringify(before.contactEmail)} → ${JSON.stringify(NEW_CONTACT_EMAIL)}`);
  console.log('  ※ contactEmail 以外の attributes は送らない');

  if (DRY_RUN) {
    console.log('  [DRY_RUN] 書き込まない');
    return;
  }

  try {
    await asc.patch(`/appStoreReviewDetails/${detail.id}`, {
      data: {
        type: 'appStoreReviewDetails',
        id: detail.id,
        attributes: { contactEmail: NEW_CONTACT_EMAIL },
      },
    });
  } catch (e) {
    abort(`contactEmail の書き込みに失敗: ${errInfo(e)}`);
  }
  console.log('  ✓ PATCH 成功');

  header('3. 読み直して検証');
  const afterResp = await asc.get(`/appStoreVersions/${vId}/appStoreReviewDetail`);
  const after = afterResp?.data?.attributes ?? {};
  console.log(`  contactFirstName = ${JSON.stringify(after.contactFirstName)}`);
  console.log(`  contactLastName  = ${JSON.stringify(after.contactLastName)}`);
  console.log(`  contactPhone     = ${JSON.stringify(after.contactPhone)}`);
  console.log(`  contactEmail     = ${JSON.stringify(after.contactEmail)}`);
  console.log(`  notes            = ${after.notes ? `${String(after.notes).length}文字` : '(空)'}`);

  const problems = [];
  if (after.contactEmail !== NEW_CONTACT_EMAIL) {
    problems.push(`contactEmail が反映されていない (実際=${JSON.stringify(after.contactEmail)})`);
  }
  // 巻き添えで消えていないことを確かめる。氏名・電話は変更対象外。
  for (const k of ['contactFirstName', 'contactLastName', 'contactPhone']) {
    if (after[k] !== before[k]) {
      problems.push(`${k} が変わってしまった: ${JSON.stringify(before[k])} → ${JSON.stringify(after[k])}`);
    }
  }
  if (String(before.notes ?? '') !== String(after.notes ?? '')) {
    problems.push('notes (審査メモ) が変わってしまった');
  }
  if (problems.length) abort(`検証に失敗:\n  - ${problems.join('\n  - ')}`);

  console.log('  ✓ contactEmail のみが変わり、氏名・電話・審査メモは元のまま');
}

main().catch((e) => {
  console.error('[fatal]', errInfo(e));
  process.exit(1);
});
