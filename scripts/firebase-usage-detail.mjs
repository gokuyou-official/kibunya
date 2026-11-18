// KIBUNYA 登録アカウントの「使われ方」を件数だけで集計する (読み取り専用)
// ★ GET のみ。作成・更新・削除は行わない。
// ★ 公開リポジトリなので、uid・名前・メールなど個人を特定できる情報は一切出力しない。
import jwt from 'jsonwebtoken';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'kibunyapjt';
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? '{}');
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
let token = '';
async function getToken() {
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }, sa.private_key, { algorithm: 'RS256' });
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  if (!res.ok) throw new Error(`token failed: ${res.status}`);
  return (await res.json()).access_token;
}
async function listAll(path) {
  const docs = []; let pt = '';
  do {
    const res = await fetch(`${BASE}/${path}?pageSize=300${pt ? `&pageToken=${pt}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) return docs;
    if (!res.ok) throw new Error(`list ${path}: ${res.status}`);
    const j = await res.json(); docs.push(...(j.documents ?? [])); pt = j.nextPageToken ?? '';
  } while (pt);
  return docs;
}
const id = (d) => d.name.split('/').pop();
const str = (d, k) => d.fields?.[k]?.stringValue ?? '';
const ts = (d, k) => d.fields?.[k]?.timestampValue ?? '';
const arr = (d, k) => (d.fields?.[k]?.arrayValue?.values ?? []).map((v) => v.stringValue).filter(Boolean);

async function main() {
  token = await getToken();
  const users = await listAll('users');
  const moods = await listAll('moods');
  const notes = await listAll('notifications');
  const uids = new Set(users.map(id));
  const friendCount = new Map();
  for (const u of uids) friendCount.set(u, (await listAll(`friends/${u}/friendsList`)).length);
  const sent = new Set(moods.map((d) => str(d, 'senderId')).filter(Boolean));
  const gotMood = new Set(moods.flatMap((d) => arr(d, 'recipientIds')));
  const noteSent = new Set(notes.map((d) => str(d, 'senderId')).filter(Boolean));
  const noteRecv = new Set(notes.map((d) => str(d, 'receiverId')).filter(Boolean));
  const named = users.filter((d) => { const n = str(d, 'name'); return n && n !== 'ゲスト'; }).length;
  const now = Date.now(); const ago = (t) => t ? (now - Date.parse(t)) / 86400000 : Infinity;
  const seen = (days) => users.filter((d) => ago(ts(d, 'lastSeen')) <= days).length;
  const withFriend = [...uids].filter((u) => friendCount.get(u) > 0).length;
  const sameDayPairs = (() => { // 同じ日に作られたアカウントの塊（テスト・審査用の目安）
    const c = {}; for (const d of users) { const day = d.createTime.slice(0, 10); c[day] = (c[day] ?? 0) + 1; }
    return Object.entries(c).filter(([, n]) => n >= 2).map(([day, n]) => `${day.slice(5)} ${n}件`).join(', ') || 'なし';
  })();
  const levels = [...uids].map((u) => (sent.has(u) ? 3 : friendCount.get(u) > 0 ? 2 : 1));
  const lines = [
    `登録アカウント: ${users.length}件（名前を設定済み ${named}件 / 「ゲスト」のまま ${users.length - named}件）`,
    `友だちが1人以上いる: ${withFriend}件（友だちの数: ${[...friendCount.values()].sort((a, b) => b - a).join(',')}）`,
    `気分を1回以上送った: ${sent.size}件 / 気分を受け取った: ${[...gotMood].filter((u) => uids.has(u)).length}件`,
    `通知を送った: ${[...noteSent].filter((u) => uids.has(u)).length}件 / 通知を受け取った: ${[...noteRecv].filter((u) => uids.has(u)).length}件`,
    `最後にアプリを開いた: 7日以内 ${seen(7)}件 / 30日以内 ${seen(30)}件 / 90日以内 ${seen(90)}件`,
    `使われ方: 登録だけ ${levels.filter((l) => l === 1).length}件 / 友だち追加まで ${levels.filter((l) => l === 2).length}件 / 気分を送ったことがある ${levels.filter((l) => l === 3).length}件`,
    `同じ日に2件以上作られたアカウント: ${sameDayPairs}`,
  ];
  for (const l of lines) { console.log(l); console.log(`::notice::${l}`); }
}
main().catch((e) => { console.error(`::error::${e.message}`); process.exit(1); });
