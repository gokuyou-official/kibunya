// firestore.rules の回帰テスト (Firestore エミュレータ上で実際にルールを評価する)。
//
// 目的:
//   ルールは「読んで正しそう」では担保できない。本番が全開放のまま気づかず
//   運用されていた事故 (2026-05-18 のルールが 8 月まで残っていた) を踏まえ、
//   デプロイ前に実挙動で検証する。
//
// 実行:
//   cd test/rules && npm install && npm test
//   CI ではデプロイワークフローがデプロイ前に実行し、失敗したらデプロイを中止する。
//
// 対象ルールはリポジトリ直下の firestore.rules をそのまま読む
// (テスト用のコピーを持たない。乖離を防ぐため)。
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = path.resolve(HERE, '../../firestore.rules');
const INVITE_SRC = path.resolve(HERE, '../../src/utils/inviteLink.ts');
const FRIENDS_SRC = path.resolve(HERE, '../../src/hooks/useFriends.ts');

// 実装が friendsList に書き込むペイロード。
// ★ 手書きのサンプルではなく実装と同じものを使う。serverTimestamp() は
//   FieldValue センチネルで、通常の値と rules 上での見え方が違いうるため
//   (keys() に現れるか等)、必ずこれでテストする。
//   実装との乖離は下の「実装ドリフト検査」で機械的に検出する。
const friendPayload = () => ({ addedAt: serverTimestamp() });

const env = await initializeTestEnvironment({
  projectId: 'demo-kibunya',
  firestore: {
    rules: fs.readFileSync(RULES_PATH, 'utf8'),
    host: '127.0.0.1',
    port: 8080,
  },
});

const A = 'uidA'; // リストの持ち主 / 送信者
const B = 'uidB'; // 相手 / 受信者
const C = 'uidC'; // 無関係の第三者
const dbA = env.authenticatedContext(A).firestore();
const dbB = env.authenticatedContext(B).firestore();
const dbC = env.authenticatedContext(C).firestore();

const FL = ['friends', A, 'friendsList', B]; // friends/A/friendsList/B

let pass = 0;
const failures = [];
async function t(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    pass++;
  } catch (e) {
    console.log(`  ❌ ${name}\n       → ${String(e.message).split('\n')[0]}`);
    failures.push(name);
  }
}
function section(s) {
  console.log(`\n${s}`);
}

// ルールを無効化して初期データを仕込む
async function seed(pathArr, data) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), ...pathArr), data);
  });
}
async function readRaw(pathArr) {
  let out;
  await env.withSecurityRulesDisabled(async (ctx) => {
    out = (await getDoc(doc(ctx.firestore(), ...pathArr))).data();
  });
  return out;
}

// ───────────────────────────────── friendsList

section('実装ドリフト検査: friendsList に書き込むキーが addedAt のみか');

// allow create の keys().hasOnly(['addedAt']) は、実装が addedAt 以外を
// 1 つでも書くと招待リンクによるフレンド追加を完全に壊す。
// 実装側にキーが増えたらここで落として気づけるようにする。
for (const [label, srcPath] of [
  ['inviteLink.ts', INVITE_SRC],
  ['useFriends.ts', FRIENDS_SRC],
]) {
  await t(`${label} の friendsList への setDoc ペイロードが { addedAt } のみ`, async () => {
    const src = fs.readFileSync(srcPath, 'utf8');
    // friendsList を指す setDoc の第2引数 (オブジェクトリテラル) を全部拾う
    const calls = [...src.matchAll(/setDoc\(\s*\n\s*doc\([^)]*friendsList[^)]*\),\s*\n\s*\{([^}]*)\}/g)];
    if (calls.length === 0) throw new Error('friendsList への setDoc が見つからない (正規表現の見直しが必要)');
    for (const m of calls) {
      const keys = m[1]
        .split(',')
        .map((s) => s.split(':')[0].trim())
        .filter(Boolean);
      const extra = keys.filter((k) => k !== 'addedAt');
      if (extra.length > 0) {
        throw new Error(`addedAt 以外のキーがある: ${extra.join(', ')} (rules の hasOnly と不整合)`);
      }
    }
    console.log(`       (${calls.length} 箇所を検査)`);
  });
}

section('friendsList: 相手側からの作成 (招待リンクの相互登録)');

await env.clearFirestore();
await t('B が実装と同じペイロード (serverTimestamp + merge) で新規作成できる', async () => {
  await assertSucceeds(setDoc(doc(dbB, ...FL), friendPayload(), { merge: true }));
});

await env.clearFirestore();
await t('serverTimestamp() でも keys() に addedAt として現れる (= hasOnly を通る)', async () => {
  // merge なし・create でも通ることを確認。センチネルがキーとして
  // 現れなければ hasOnly([]) 扱いになり、逆に通ってしまう / 落ちる。
  await assertSucceeds(setDoc(doc(dbB, ...FL), friendPayload()));
  const d = await readRaw(FL);
  if (!d || d.addedAt === undefined) throw new Error('addedAt が保存されていない');
});

await env.clearFirestore();
await t('create 時は merge の有無で結果が変わらない (既存ドキュメントが無いため)', async () => {
  await assertSucceeds(setDoc(doc(dbB, ...FL), friendPayload(), { merge: true }));
  await env.clearFirestore();
  await assertSucceeds(setDoc(doc(dbB, ...FL), friendPayload()));
});

await env.clearFirestore();
await t('serverTimestamp + active 混在の作成は拒否される', async () => {
  await assertFails(
    setDoc(doc(dbB, ...FL), { ...friendPayload(), active: false }, { merge: true }),
  );
});

await env.clearFirestore();
await t('B が active を混ぜて作成しようとすると拒否される (ミュート仕込みの防止)', async () => {
  await assertFails(setDoc(doc(dbB, ...FL), { addedAt: new Date(), active: false }, { merge: true }));
});

await env.clearFirestore();
await t('B が addedAt 以外のフィールドを混ぜて作成しようとすると拒否される', async () => {
  await assertFails(setDoc(doc(dbB, ...FL), { addedAt: new Date(), nickname: 'x' }, { merge: true }));
});

section('friendsList: 相手側からの再書き込み (招待リンクを踏み直した場合)');

await seed(FL, { addedAt: new Date('2026-01-01'), active: false });
await t('merge: true なら許可される (実装と同じ serverTimestamp ペイロード)', async () => {
  await assertSucceeds(setDoc(doc(dbB, ...FL), friendPayload(), { merge: true }));
});
await t('  → A の active: false が保持されている', async () => {
  const d = await readRaw(FL);
  if (d?.active !== false) throw new Error(`active が ${JSON.stringify(d?.active)} になった`);
});

await seed(FL, { addedAt: new Date('2026-01-01'), active: false });
await t('merge なし setDoc は拒否される (active の削除が affectedKeys に乗るため)', async () => {
  await assertFails(setDoc(doc(dbB, ...FL), { addedAt: new Date() }));
});

await seed(FL, { addedAt: new Date('2026-01-01'), active: false });
await t('B が active を書き換えようとすると拒否される', async () => {
  await assertFails(setDoc(doc(dbB, ...FL), { addedAt: new Date(), active: true }, { merge: true }));
});

await seed(FL, { addedAt: new Date('2026-01-01'), active: false });
await t('B が addedAt 以外を足そうとすると拒否される', async () => {
  await assertFails(setDoc(doc(dbB, ...FL), { addedAt: new Date(), nickname: 'x' }, { merge: true }));
});

section('friendsList: 持ち主の権限');

await seed(FL, { addedAt: new Date('2026-01-01'), active: false });
await t('A は自分のリストに active を書ける', async () => {
  await assertSucceeds(updateDoc(doc(dbA, ...FL), { active: true }));
});

await seed(FL, { addedAt: new Date('2026-01-01'), active: false });
await t('A の merge: true 書き込みで active が保持される', async () => {
  await assertSucceeds(setDoc(doc(dbA, ...FL), { addedAt: new Date() }, { merge: true }));
  const d = await readRaw(FL);
  if (d?.active !== false) throw new Error(`active が ${JSON.stringify(d?.active)} になった`);
});

await seed(FL, { addedAt: new Date('2026-01-01'), active: false });
await t('第三者 C は読めない', async () => {
  await assertFails(getDoc(doc(dbC, ...FL)));
});
await t('第三者 C は書けない', async () => {
  await assertFails(setDoc(doc(dbC, ...FL), { addedAt: new Date() }, { merge: true }));
});

section('friendsList: アカウント削除の逆参照');

await seed(FL, { addedAt: new Date('2026-01-01') });
await t('B は friends/A/friendsList/B (自分の逆参照) を削除できる', async () => {
  await assertFails(getDoc(doc(dbB, ...FL))); // 読めはしない
});
await seed(FL, { addedAt: new Date('2026-01-01') });
await t('  → 削除自体は許可される', async () => {
  const { deleteDoc } = await import('firebase/firestore');
  await assertSucceeds(deleteDoc(doc(dbB, ...FL)));
});

// ───────────────────────────────── users

section('users');

await env.clearFirestore();
await env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), 'users', B), { name: 'B', interests: ['drinking'] });
});
await t('A は B の users ドキュメントを get できる (interests 参照に必要)', async () => {
  await assertSucceeds(getDoc(doc(dbA, 'users', B)));
});
await t('users コレクションの一覧取得は拒否される (list: false)', async () => {
  await assertFails(getDocs(collection(dbA, 'users')));
});
await t('A は B の users ドキュメントを書き換えられない', async () => {
  await assertFails(setDoc(doc(dbA, 'users', B), { name: 'hacked' }, { merge: true }));
});

// ───────────────────────────────── notifications

section('notifications');

const NOTIF = ['notifications', 'n1'];
const notifData = {
  senderId: A, senderName: 'A', receiverId: B,
  type: 'kibun', activity: 'drinking', area: null,
  createdAt: new Date(), isRead: false, reactedBy: null,
};

await seed(NOTIF, notifData);
await t('受信者 B は isRead を更新できる', async () => {
  await assertSucceeds(updateDoc(doc(dbB, ...NOTIF), { isRead: true }));
});

await seed(NOTIF, notifData);
await t('受信者 B は reactedBy + isRead を更新できる', async () => {
  await assertSucceeds(updateDoc(doc(dbB, ...NOTIF), { reactedBy: B, isRead: true }));
});

await seed(NOTIF, notifData);
await t('受信者 B が本文 (activity) を書き換えようとすると拒否される', async () => {
  await assertFails(updateDoc(doc(dbB, ...NOTIF), { activity: 'sauna' }));
});

await seed(NOTIF, notifData);
await t('送信者 A は update できない (isRead は受信者の概念)', async () => {
  await assertFails(updateDoc(doc(dbA, ...NOTIF), { isRead: true }));
});

await seed(NOTIF, notifData);
await t('第三者 C は読めない', async () => {
  await assertFails(getDoc(doc(dbC, ...NOTIF)));
});

await seed(NOTIF, notifData);
await t('送信者 A / 受信者 B はどちらも読める', async () => {
  await assertSucceeds(getDoc(doc(dbA, ...NOTIF)));
  await assertSucceeds(getDoc(doc(dbB, ...NOTIF)));
});

await seed(NOTIF, notifData);
await t('senderId を詐称した作成は拒否される', async () => {
  await assertFails(setDoc(doc(dbC, 'notifications', 'n2'), { ...notifData, senderId: A }));
});

await seed(NOTIF, notifData);
await t('アカウント削除向け: 送信者・受信者いずれも削除できる', async () => {
  const { deleteDoc } = await import('firebase/firestore');
  await assertSucceeds(deleteDoc(doc(dbB, ...NOTIF)));
});

await seed(NOTIF, notifData);
await t('アカウント削除向け: senderId / receiverId での query が通る', async () => {
  await assertSucceeds(getDocs(query(collection(dbA, 'notifications'), where('senderId', '==', A))));
  await assertSucceeds(getDocs(query(collection(dbB, 'notifications'), where('receiverId', '==', B))));
});

await seed(NOTIF, notifData);
await t('絞り込み無しの notifications 全件取得は拒否される', async () => {
  await assertFails(getDocs(collection(dbC, 'notifications')));
});

// ───────────────────────────────── 結果

console.log(`\n${'='.repeat(56)}`);
if (failures.length === 0) {
  console.log(`全 ${pass} ケース pass`);
} else {
  console.log(`pass=${pass} fail=${failures.length}`);
  for (const f of failures) console.log(`  - ${f}`);
}
console.log('='.repeat(56));

await env.cleanup();
process.exit(failures.length === 0 ? 0 : 1);
