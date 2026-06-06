// App Store Connect API v1 — チームメンバー (Users) を内部 Beta Group に一括追加
//
// 実行方法:
//   DRY_RUN=true  (デフォルト): 計画のみ表示、何もしない
//   DRY_RUN=false           : 実際に追加実行
//
// 必須 env:
//   ASC_ISSUER_ID / ASC_KEY_ID / ASC_P8_KEY (or ASC_P8_KEY_PATH)
//   ASC_APP_ID
// 任意 env:
//   GROUP_NAME       (default: "キブンヤ テスト")
//   EXCLUDE_EMAILS   (default: "sk19880328@gmail.com"  カンマ区切り)
//   DRY_RUN          (default: "true")
//
// 流れ:
//   1. /v1/users で ASC チームメンバー全員を取得
//   2. /v1/betaGroups?filter[app]=<id> から GROUP_NAME 一致 & isInternalGroup=true を選択
//   3. /v1/betaGroups/<id>/betaTesters で現在のメンバー email 集合を取得
//   4. 追加候補 = 全 user - 既存 - EXCLUDE_EMAILS
//   5. DRY_RUN=true なら計画表示で終了
//   6. DRY_RUN=false なら 候補 user ごとに:
//        POST /v1/betaTesters (email + name + relationships.betaGroups=[group])
//        - 既に BetaTester として存在する場合 (409) → /v1/betaTesters?filter[email] で
//          ID を取得し POST /v1/betaGroups/<id>/relationships/betaTesters で関連追加
import { buildAscClient } from './lib/asc-auth.mjs';

const { ASC_APP_ID } = process.env;
const GROUP_NAME = process.env.GROUP_NAME ?? 'キブンヤ テスト';
const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
const EXCLUDE_EMAILS = new Set(
  (process.env.EXCLUDE_EMAILS ?? 'sk19880328@gmail.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

if (!ASC_APP_ID) {
  console.error('[error] ASC_APP_ID が未設定です');
  process.exit(1);
}

const client = buildAscClient();

function header(s) {
  console.log('\n=== ' + s + ' ===');
}

async function fetchAllUsers() {
  header('Team Users (/v1/users)');
  const resp = await client.get('/users', { limit: 200 });
  const users = (resp.data ?? []).map((u) => ({
    id: u.id,
    email: (u.attributes?.username ?? '').toLowerCase(),
    firstName: u.attributes?.firstName ?? '',
    lastName: u.attributes?.lastName ?? '',
    roles: u.attributes?.roles ?? [],
    allAppsVisible: !!u.attributes?.allAppsVisible,
  }));
  console.log(['email', 'firstName', 'lastName', 'roles'].join('\t'));
  for (const u of users) {
    console.log(
      [u.email || '-', u.firstName || '-', u.lastName || '-', u.roles.join(',') || '-'].join('\t'),
    );
  }
  console.log(`合計: ${users.length}名`);
  return users;
}

async function findInternalGroup() {
  header(`Beta Group "${GROUP_NAME}" (internal) を検索`);
  const resp = await client.get('/betaGroups', {
    'filter[app]': ASC_APP_ID,
    limit: 50,
  });
  const groups = resp.data ?? [];
  console.log('検出 BetaGroup (app=' + ASC_APP_ID + '):');
  for (const g of groups) {
    const a = g.attributes ?? {};
    console.log(`  - id=${g.id}  name="${a.name}"  internal=${!!a.isInternalGroup}`);
  }
  const target = groups.find(
    (g) =>
      g.attributes?.name === GROUP_NAME &&
      g.attributes?.isInternalGroup === true,
  );
  if (!target) {
    throw new Error(
      `[error] 内部 BetaGroup "${GROUP_NAME}" が見つかりません。ASC で先にグループを作成してください。`,
    );
  }
  console.log(`\n選択: id=${target.id}  name="${target.attributes.name}"`);
  return target;
}

async function fetchGroupMembers(groupId) {
  header(`現在のメンバー (/v1/betaGroups/${groupId}/betaTesters)`);
  const resp = await client.get(`/betaGroups/${groupId}/betaTesters`, {
    limit: 200,
  });
  const members = (resp.data ?? []).map((t) => ({
    id: t.id,
    email: (t.attributes?.email ?? '').toLowerCase(),
    firstName: t.attributes?.firstName ?? '',
    lastName: t.attributes?.lastName ?? '',
  }));
  if (members.length === 0) {
    console.log('(現在メンバーなし)');
  } else {
    for (const m of members) {
      console.log(`  - ${m.email}  ${m.firstName} ${m.lastName}`);
    }
  }
  console.log(`合計: ${members.length}名`);
  return members;
}

async function findBetaTesterByEmail(email) {
  const resp = await client.get('/betaTesters', {
    'filter[email]': email,
    limit: 5,
  });
  return resp.data?.[0] ?? null;
}

async function addUserAsTester(groupId, user) {
  // 1st attempt: 新規 BetaTester 作成 + その時点で group にも参加させる
  try {
    const resp = await client.post('/betaTesters', {
      data: {
        type: 'betaTesters',
        attributes: {
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
        relationships: {
          betaGroups: {
            data: [{ type: 'betaGroups', id: groupId }],
          },
        },
      },
    });
    return { method: 'created', id: resp?.data?.id };
  } catch (e) {
    // 既に存在するなら 409 で落ちる → 既存を引いて関連だけ追加
    if (e.status === 409) {
      const existing = await findBetaTesterByEmail(user.email);
      if (!existing) {
        throw new Error(
          `409 received but BetaTester not found by email=${user.email}: ${e.message}`,
        );
      }
      await client.post(`/betaGroups/${groupId}/relationships/betaTesters`, {
        data: [{ type: 'betaTesters', id: existing.id }],
      });
      return { method: 'linked-existing', id: existing.id };
    }
    throw e;
  }
}

(async () => {
  try {
    console.log('DRY_RUN        :', DRY_RUN);
    console.log('GROUP_NAME     :', GROUP_NAME);
    console.log('EXCLUDE_EMAILS :', [...EXCLUDE_EMAILS].join(','));
    console.log('ASC_APP_ID     :', ASC_APP_ID);

    const users = await fetchAllUsers();
    const group = await findInternalGroup();
    const current = await fetchGroupMembers(group.id);

    const currentEmails = new Set(current.map((m) => m.email).filter(Boolean));
    const toAdd = users
      .filter((u) => u.email)
      .filter((u) => !EXCLUDE_EMAILS.has(u.email))
      .filter((u) => !currentEmails.has(u.email));

    header('追加候補 (= all users − 既存 − 除外)');
    if (toAdd.length === 0) {
      console.log('(追加対象なし)');
    } else {
      for (const u of toAdd) {
        console.log(`  + ${u.email}  ${u.firstName} ${u.lastName}`);
      }
      console.log(`合計: ${toAdd.length}名`);
    }

    if (DRY_RUN) {
      header('DRY RUN モード — 何も変更しません');
      console.log('実行する場合は workflow_dispatch で dry_run=false を選んで再実行してください。');
      return;
    }

    header('実行 (DRY_RUN=false)');
    const results = [];
    for (const u of toAdd) {
      try {
        const r = await addUserAsTester(group.id, u);
        console.log(`  ✓ ${u.email}  -> ${r.method}  (id=${r.id})`);
        results.push({ email: u.email, ok: true, method: r.method });
      } catch (e) {
        console.log(`  ✗ ${u.email}  ERROR: ${e.message.split('\n')[0]}`);
        results.push({ email: u.email, ok: false, error: e.message });
      }
    }

    header('結果サマリ');
    const ok = results.filter((r) => r.ok).length;
    const ng = results.filter((r) => !r.ok).length;
    console.log(`成功: ${ok}件  失敗: ${ng}件`);
    if (ng > 0) {
      console.log('\n失敗詳細:');
      for (const r of results.filter((x) => !x.ok)) {
        console.log(`  - ${r.email}: ${r.error.split('\n').slice(0, 3).join(' | ')}`);
      }
      process.exit(1);
    }
  } catch (e) {
    console.error('\n[fatal]', e.message);
    process.exit(1);
  }
})();
