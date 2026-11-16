// KIBUNYA の利用状況を「件数だけ」集計する (読み取り専用)
// ★ GET のみ。作成・更新・削除は行わない。
// ★ public リポジトリなので、個人を特定できる情報 (uid・名前・メール) は一切出力しない。
// 必須 env: FIREBASE_SERVICE_ACCOUNT_KEY
import jwt from 'jsonwebtoken';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'kibunyapjt';
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? '{}');
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function getToken() {
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 },
    sa.private_key, { algorithm: 'RS256' });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  if (!res.ok) throw new Error(`token failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function listAll(token, col) {
  const docs = []; let pageToken = '';
  do {
    const url = `${BASE}/${col}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`list ${col}: ${res.status}`);
    const j = await res.json();
    docs.push(...(j.documents ?? []));
    pageToken = j.nextPageToken ?? '';
  } while (pageToken);
  return docs;
}

const DAY = 86400000;
const now = Date.now();
const ageDays = (d) => (now - Date.parse(d.createTime)) / DAY;
const within = (docs, days) => docs.filter((d) => ageDays(d) <= days).length;
const str = (d, k) => d.fields?.[k]?.stringValue ?? '';

async function main() {
  const token = await getToken();
  const out = [];
  for (const col of ['users', 'moods', 'friends', 'notifications']) {
    try {
      const docs = await listAll(token, col);
      out.push(`${col}: 累計 ${docs.length}件 / 直近7日 ${within(docs, 7)}件 / 直近30日 ${within(docs, 30)}件` +
        (docs.length ? ` / 最新 ${docs.map((d) => d.createTime).sort().at(-1).slice(0, 10)}` : ''));
      if (col === 'moods') {
        const active = (days) => new Set(docs.filter((d) => ageDays(d) <= days).map((d) => str(d, 'senderId')).filter(Boolean)).size;
        out.push(`気分を送った人数: 直近7日 ${active(7)}人 / 直近30日 ${active(30)}人`);
      }
      if (col === 'users') {
        const byMonth = {};
        for (const d of docs) { const m = d.createTime.slice(0, 7); byMonth[m] = (byMonth[m] ?? 0) + 1; }
        out.push('登録した人の月別: ' + Object.entries(byMonth).sort().map(([m, c]) => `${m} ${c}人`).join(', '));
      }
    } catch (e) { out.push(`${col}: 取得失敗 ${e.message}`); }
  }
  for (const line of out) { console.log(line); console.log(`::notice::${line}`); }
}
main().catch((e) => { console.error(`::error::${e.message}`); process.exit(1); });
