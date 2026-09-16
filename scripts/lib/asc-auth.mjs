// App Store Connect API v1 共通モジュール
//
// 認証 (ES256 JWT) と HTTP ヘルパーをここに集約。
// ASC スクリプトはこれを import して使う。
//
// 必要な環境変数:
//   - ASC_ISSUER_ID
//   - ASC_KEY_ID
//   - ASC_P8_KEY (PEM 本文) または ASC_P8_KEY_PATH (ファイルパス) のいずれか
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';

export const ASC_BASE = 'https://api.appstoreconnect.apple.com/v1';

function assertEnv(name, value) {
  if (!value) {
    throw new Error(
      `[asc-auth] 環境変数 ${name} が未設定です (.env または workflow secrets を確認)`,
    );
  }
}

function loadPrivateKey({ ASC_P8_KEY, ASC_P8_KEY_PATH }) {
  if (ASC_P8_KEY && ASC_P8_KEY.includes('BEGIN PRIVATE KEY')) {
    return ASC_P8_KEY;
  }
  if (ASC_P8_KEY_PATH) {
    const keyPath = path.resolve(ASC_P8_KEY_PATH);
    if (!fs.existsSync(keyPath)) {
      throw new Error(`[asc-auth] P8 キーが見つかりません: ${keyPath}`);
    }
    return fs.readFileSync(keyPath, 'utf8');
  }
  throw new Error('[asc-auth] ASC_P8_KEY か ASC_P8_KEY_PATH のいずれかを設定してください');
}

export function buildAscClient(env = process.env) {
  const { ASC_ISSUER_ID, ASC_KEY_ID } = env;
  assertEnv('ASC_ISSUER_ID', ASC_ISSUER_ID);
  assertEnv('ASC_KEY_ID', ASC_KEY_ID);
  const privateKey = loadPrivateKey(env);

  // JWT 1個を 20 分使い回す (ASC 仕様上限)。
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    {
      iss: ASC_ISSUER_ID,
      iat: now,
      exp: now + 20 * 60,
      aud: 'appstoreconnect-v1',
    },
    privateKey,
    {
      algorithm: 'ES256',
      header: { alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' },
    },
  );

  async function request(method, pathname, { query, body } = {}) {
    const url = new URL(ASC_BASE + pathname);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    const init = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(url, init);
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(
        `HTTP ${res.status} ${res.statusText} for ${method} ${url}\n${text}`,
      );
      err.status = res.status;
      err.body = text;
      try {
        err.json = JSON.parse(text);
      } catch {}
      throw err;
    }
    if (!text) return null;
    return JSON.parse(text);
  }

  return {
    token,
    get: (p, query) => request('GET', p, { query }),
    post: (p, body) => request('POST', p, { body }),
    patch: (p, body) => request('PATCH', p, { body }),
    delete: (p) => request('DELETE', p),
  };
}

export function fmtDate(s) {
  if (!s) return '-';
  return new Date(s).toISOString().replace('T', ' ').slice(0, 19);
}
