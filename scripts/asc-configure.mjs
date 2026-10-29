// App Store Connect 設定スクリプト
//
// 機能 (idempotent / 安全側):
//   App Review Information の以下フィールドを設定:
//     demoAccountName     ← reviewUserName
//     demoAccountPassword ← reviewPassword
//     notes               ← reviewNotes
//     demoAccountRequired ← signsInRequired
//   (editable な appStoreVersion の appStoreReviewDetail を PATCH。
//    まだ無ければ POST)
//
// 注意: primaryCategory は ASC API では UPDATE 不可 (Run #1 で 403
//   FORBIDDEN_ERROR を確認)。Console での手動対応とし、このスクリプトの
//   対象外。
//
// 必須 env:
//   ASC_ISSUER_ID / ASC_KEY_ID / ASC_P8_KEY (or ASC_P8_KEY_PATH)
//   ASC_APP_ID
// 任意 env:
//   DRY_RUN   (default: "true")  実書込前にプラン表示で停止
import { buildAscClient, fmtDate } from './lib/asc-auth.mjs';

const { ASC_APP_ID } = process.env;
const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

// Review info の固定 payload。
const REVIEW_INFO = {
  demoAccountName: 'gokuyou.official@gmail.com',
  demoAccountPassword: 'gokuyou',
  demoAccountRequired: true,
  notes:
    '友人同士でちょい飲みの気分を共有するアプリです。フレンド機能はフレンドタブから招待リンクで追加できます。',
};

if (!ASC_APP_ID) {
  console.error('[error] ASC_APP_ID が未設定です');
  process.exit(1);
}

const client = buildAscClient();

function header(s) {
  console.log('\n=== ' + s + ' ===');
}

// editable な appStoreVersion を探す
async function getEditableVersion() {
  const editableStates =
    'PREPARE_FOR_SUBMISSION,DEVELOPER_REJECTED,REJECTED,METADATA_REJECTED,' +
    'WAITING_FOR_REVIEW,IN_REVIEW,PENDING_DEVELOPER_RELEASE';
  const resp = await client.get(`/apps/${ASC_APP_ID}/appStoreVersions`, {
    'filter[appVersionState]': editableStates,
    limit: 20,
  });
  const list = resp?.data ?? [];
  const order = [
    'PREPARE_FOR_SUBMISSION',
    'METADATA_REJECTED',
    'DEVELOPER_REJECTED',
    'REJECTED',
    'WAITING_FOR_REVIEW',
    'IN_REVIEW',
    'PENDING_DEVELOPER_RELEASE',
  ];
  for (const s of order) {
    const hit = list.find((v) => v.attributes?.appVersionState === s);
    if (hit) return hit;
  }
  return list[0];
}

async function getReviewDetail(versionId) {
  try {
    return await client.get(
      `/appStoreVersions/${versionId}/appStoreReviewDetail`,
    );
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

async function createReviewDetail(versionId, attrs) {
  return client.post('/appStoreReviewDetails', {
    data: {
      type: 'appStoreReviewDetails',
      attributes: attrs,
      relationships: {
        appStoreVersion: {
          data: { type: 'appStoreVersions', id: versionId },
        },
      },
    },
  });
}

async function updateReviewDetail(detailId, attrs) {
  return client.patch(`/appStoreReviewDetails/${detailId}`, {
    data: {
      type: 'appStoreReviewDetails',
      id: detailId,
      attributes: attrs,
    },
  });
}

(async () => {
  try {
    console.log('ASC_APP_ID :', ASC_APP_ID);
    console.log('DRY_RUN    :', DRY_RUN);
    console.log(
      '\n[note] primaryCategory は ASC API では更新不可 (Run #1 で 403' +
        ' FORBIDDEN)。Firebase Console / App Store Connect 上で手動対応のこと。',
    );

    // -------- appStoreVersion / reviewDetail 取得 --------
    header('AppStoreVersion (editable) を取得');
    const version = await getEditableVersion();
    if (!version) {
      throw new Error('editable な appStoreVersion が見つかりません');
    }
    const vAttrs = version.attributes ?? {};
    console.log('version.id          :', version.id);
    console.log('versionString       :', vAttrs.versionString ?? '-');
    console.log('appVersionState     :', vAttrs.appVersionState ?? '-');
    console.log('createdDate         :', fmtDate(vAttrs.createdDate));

    header('AppStoreReviewDetail を取得 (無ければ作成、有れば PATCH)');
    const detailResp = await getReviewDetail(version.id);
    const detail = detailResp?.data ?? null;
    if (detail) {
      console.log('reviewDetail.id           :', detail.id);
      const da = detail.attributes ?? {};
      console.log('現在 demoAccountName     :', da.demoAccountName ?? '-');
      console.log('現在 demoAccountRequired :', da.demoAccountRequired ?? '-');
      const curNotes = da.notes ?? '';
      console.log(
        '現在 notes (head)        :',
        curNotes.slice(0, 60) + (curNotes.length > 60 ? '…' : ''),
      );
    } else {
      console.log('reviewDetail なし → 新規作成予定');
    }

    // -------- 適用プラン --------
    header('適用プラン');
    console.log('AppStoreReviewDetail を以下で更新:');
    console.log('   demoAccountName     :', REVIEW_INFO.demoAccountName);
    console.log('   demoAccountPassword :', REVIEW_INFO.demoAccountPassword);
    console.log('   demoAccountRequired :', REVIEW_INFO.demoAccountRequired);
    console.log(
      '   notes (head)        :',
      REVIEW_INFO.notes.slice(0, 60) + '…',
    );

    if (DRY_RUN) {
      header('DRY RUN — 書き込みません');
      console.log(
        '実行する場合は workflow_dispatch で dry_run=false を選んで再実行してください。',
      );
      return;
    }

    // -------- 実書込 --------
    header('AppStoreReviewDetail を保存');
    let updated;
    if (detail) {
      updated = await updateReviewDetail(detail.id, REVIEW_INFO);
      console.log('✓ PATCH 成功 id=', updated?.data?.id);
    } else {
      updated = await createReviewDetail(version.id, REVIEW_INFO);
      console.log('✓ POST 成功 id=', updated?.data?.id);
    }

    // -------- 確認 dump --------
    header('確認: 書込後の値を再取得');
    const verifyDetail = await getReviewDetail(version.id);
    const va = verifyDetail?.data?.attributes ?? {};
    console.log('verified demoAccountName     :', va.demoAccountName ?? '-');
    console.log(
      'verified demoAccountRequired :',
      va.demoAccountRequired ?? '-',
    );
    const vnotes = va.notes ?? '';
    console.log(
      'verified notes (head)        :',
      vnotes.slice(0, 80) + (vnotes.length > 80 ? '…' : ''),
    );
    console.log('\nApp version  :', vAttrs.versionString);
    console.log('Version state:', vAttrs.appVersionState);
  } catch (e) {
    console.error('\n[fatal]', e.message);
    if (e.body) {
      console.error('---response body (head)---');
      console.error(String(e.body).slice(0, 1500));
    }
    process.exit(1);
  }
})();
