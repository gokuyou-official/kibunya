// App Store Connect API v1 — TestFlight 招待メール送信スクリプト
//
// 実行方法:
//   DRY_RUN=true  (デフォルト): どの BetaTester に送るかだけ表示、API は叩かない
//   DRY_RUN=false           : 実際に /v1/betaTesterInvitations を POST して送信
//
// 必須 env:
//   ASC_ISSUER_ID / ASC_KEY_ID / ASC_P8_KEY (or ASC_P8_KEY_PATH)
//   ASC_APP_ID
//   BETA_TESTER_IDS  カンマ区切りで1つ以上の BetaTester ID
// 任意 env:
//   BETA_GROUP_ID    (検証/ログ表示用。招待 API 自体は group を要求しない)
//   DRY_RUN          (default: "true")
//
// API:
//   POST /v1/betaTesterInvitations
//   body: {
//     data: {
//       type: "betaTesterInvitations",
//       relationships: {
//         app:        { data: { type: "apps",        id: "<ASC_APP_ID>" } },
//         betaTester: { data: { type: "betaTesters", id: "<BETA_TESTER_ID>" } }
//       }
//     }
//   }
//
// 注意:
//   - 招待メールは Apple から送信される (差出人: noreply@email.apple.com)
//   - 既に有効な招待が出ている tester に再送した場合の挙動は ASC 仕様依存
//     (一般には 409 Conflict や 422 が返る場合がある — 個別ログで確認)
import { buildAscClient } from './lib/asc-auth.mjs';

const { ASC_APP_ID } = process.env;
const BETA_TESTER_IDS = (process.env.BETA_TESTER_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const BETA_GROUP_ID = (process.env.BETA_GROUP_ID ?? '').trim();
const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

if (!ASC_APP_ID) {
  console.error('[error] ASC_APP_ID が未設定です');
  process.exit(1);
}
if (BETA_TESTER_IDS.length === 0) {
  console.error('[error] BETA_TESTER_IDS が未設定です (カンマ区切りで1つ以上指定)');
  process.exit(1);
}

const client = buildAscClient();

function header(s) {
  console.log('\n=== ' + s + ' ===');
}

async function fetchBetaTester(id) {
  return await client.get(`/betaTesters/${id}`);
}

async function fetchBetaGroup(id) {
  return await client.get(`/betaGroups/${id}`);
}

async function sendInvitation(testerId) {
  return await client.post('/betaTesterInvitations', {
    data: {
      type: 'betaTesterInvitations',
      relationships: {
        app: { data: { type: 'apps', id: ASC_APP_ID } },
        betaTester: { data: { type: 'betaTesters', id: testerId } },
      },
    },
  });
}

(async () => {
  try {
    console.log('DRY_RUN          :', DRY_RUN);
    console.log('ASC_APP_ID       :', ASC_APP_ID);
    console.log('BETA_TESTER_IDS  :', BETA_TESTER_IDS.join(','));
    console.log('BETA_GROUP_ID    :', BETA_GROUP_ID || '(none)');

    // 参考情報: group / tester の表示。失敗しても本処理は続ける。
    if (BETA_GROUP_ID) {
      header('BetaGroup 確認');
      try {
        const g = await fetchBetaGroup(BETA_GROUP_ID);
        const a = g.data?.attributes ?? {};
        console.log(
          `  id=${g.data?.id}  name="${a.name}"  internal=${!!a.isInternalGroup}`,
        );
      } catch (e) {
        console.log('  [warn] group 取得失敗:', e.message.split('\n')[0]);
      }
    }

    header('BetaTester 確認');
    const testers = [];
    for (const id of BETA_TESTER_IDS) {
      try {
        const t = await fetchBetaTester(id);
        const a = t.data?.attributes ?? {};
        console.log(
          `  id=${t.data?.id}  email=${a.email ?? '-'}  firstName=${a.firstName ?? '-'}  lastName=${a.lastName ?? '-'}  inviteType=${a.inviteType ?? '-'}`,
        );
        testers.push({ id: t.data.id, email: a.email ?? '' });
      } catch (e) {
        console.log(`  [warn] tester=${id} 取得失敗:`, e.message.split('\n')[0]);
        // 招待自体は ID だけで試せるので候補には残す
        testers.push({ id, email: '(unknown)' });
      }
    }

    if (DRY_RUN) {
      header('DRY RUN モード — 招待メールは送信しません');
      console.log(`対象 ${testers.length} 名:`);
      for (const t of testers) console.log(`  → ${t.email}  (id=${t.id})`);
      console.log('\n実行する場合は workflow_dispatch で dry_run=false を選んで再実行してください。');
      return;
    }

    header('招待メール送信 (POST /v1/betaTesterInvitations)');
    const results = [];
    for (const t of testers) {
      try {
        const resp = await sendInvitation(t.id);
        const invId = resp?.data?.id ?? '(no id)';
        console.log(`  ✓ ${t.email}  (tester=${t.id})  invitation=${invId}`);
        results.push({ ...t, ok: true, invitationId: invId });
      } catch (e) {
        const first = e.message.split('\n').slice(0, 3).join(' | ');
        console.log(`  ✗ ${t.email}  (tester=${t.id})  ERROR: ${first}`);
        results.push({ ...t, ok: false, error: e.message });
      }
    }

    header('結果サマリ');
    const ok = results.filter((r) => r.ok).length;
    const ng = results.filter((r) => !r.ok).length;
    console.log(`成功: ${ok}件  失敗: ${ng}件`);
    if (ng > 0) {
      console.log('\n失敗詳細:');
      for (const r of results.filter((x) => !x.ok)) {
        console.log(`  - ${r.email} (id=${r.id}): ${r.error.split('\n').slice(0, 3).join(' | ')}`);
      }
      process.exit(1);
    }
  } catch (e) {
    console.error('\n[fatal]', e.message);
    process.exit(1);
  }
})();
