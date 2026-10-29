// Expo config plugin: Swift 6 strict concurrency workaround for Xcode 16.x
//
// 背景:
//   expo-modules-core 55.0.25 のソースが Swift 6 language mode 前提で
//   書かれており (s.swift_version = '6.0' + isolated conformance 構文)、
//   Xcode 16.x の Swift 6.x コンパイラが strict concurrency を強制して
//   ビルド失敗する。
//
//   workflow 内で外側 node_modules を patch しても、`eas build --local` は
//   project を temp dir に展開して `npm install` を再実行するため反映されない。
//
// このプラグインは prebuild 中 (temp dir 内) に動くため、
//   (a) Podfile に post_install hook を注入して全 Pod target の
//       SWIFT_VERSION='5.0' / SWIFT_STRICT_CONCURRENCY='minimal' を強制
//   (b) node_modules 配下の全 .swift ファイルを regex スキャンし、
//       Swift 6 only の isolated conformance 構文
//         (class|extension|struct|protocol|enum) X: ... @MainActor Y ... {
//       を Swift 5 互換の
//         @MainActor
//         (class|extension|struct|protocol|enum) X: ... Y ... {
//       に書き換える (@MainActor が declaration 全体に伝播するため意味は等価)。
//
// (a) だけだと SWIFT_VERSION=5.0 で Swift 6-only 構文が parse error、
// (b) だけだと strict concurrency error が残るため、両方必須。
//
// 注意:
//   regex scan は per-line 処理。Multi-line 宣言は対応外。
//   今のところ expo-modules-core 55.0.25 では single-line のみ使われている。
const fs = require('fs');
const path = require('path');

// @expo/config-plugins は通常 expo 配下に nested install されているため、
// 単純な require だと解決できない。require.resolve に paths を渡して
// expo/node_modules も探索対象に含める。
const configPluginsPath = require.resolve('@expo/config-plugins', {
  paths: [
    path.join(__dirname, '..', 'node_modules', 'expo', 'node_modules'),
    path.join(__dirname, '..', 'node_modules'),
  ],
});
const { withDangerousMod } = require(configPluginsPath);

const SENTINEL = 'withSwiftConcurrencyWorkaround';

const POST_INSTALL_BLOCK = `
  # === ${SENTINEL} ===
  # 全 Pod target の Swift build settings を上書きし、
  # Swift 6 language mode / strict concurrency をオフにする。
  # podspec の s.swift_version が何であっても build settings が最終的。
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings['SWIFT_VERSION'] = '5.0'
      config.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'minimal'
    end
  end
  # === end ${SENTINEL} ===
`;

// 走査対象: node_modules 配下の .swift ファイル全部。
// ただし速度上 NODE_MODULES_SCAN_ROOTS で絞る (expo 系のみで十分)。
// 万一他パッケージで Swift 6 構文が混入したら追加すれば良い。
const NODE_MODULES_SCAN_ROOTS = [
  'node_modules/expo',
  'node_modules/@expo',
];

// per-line transformation:
//   declaration line で inheritance list 内の `(: |, )@MainActor ` を除去し、
//   declaration の直前に `@MainActor` 行を追加する。
//   - declaration keyword は class/extension/struct/protocol/enum
//   - `@MainActor ` (trailing space) を `: ` または `, ` の直後で検出
//   - 関数型注釈の `@escaping @MainActor (...)` は declaration ではないので
//     regex がマッチせず無視される
function transformSwift6IsolatedConformance(content) {
  const lines = content.split('\n');
  const out = [];
  let patches = 0;

  for (const line of lines) {
    if (!line.includes('@MainActor')) {
      out.push(line);
      continue;
    }
    // 必要条件: indent + 任意 modifiers + (class|extension|struct|protocol|enum)
    //           + 任意の文字 + `:` (inheritance 開始) + 任意の文字 + `@MainActor `
    //           + 任意の文字 + `{`
    const m = line.match(
      /^(\s*)((?:(?:@?\w+|public|internal|private|fileprivate|open|final|indirect)\s+)*(?:class|extension|struct|protocol|enum)\b.*?:.*?@MainActor\s+.*\{)\s*$/,
    );
    if (!m) {
      out.push(line);
      continue;
    }
    const indent = m[1];
    let decl = m[2];
    // inheritance list 内の `(: |, ) @MainActor ` を除去。
    // generic constraint の `<T: U>` 等は `<...>` 内なので影響しない
    // (`@MainActor` が generic constraint に出ることは Swift 6 仕様上無い)。
    decl = decl.replace(/([:,])\s*@MainActor\s+/g, '$1 ');
    out.push(`${indent}@MainActor`);
    out.push(`${indent}${decl}`);
    patches += 1;
  }

  return { content: out.join('\n'), patches };
}

function walkSwiftFiles(dir, callback) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue; // 安全のため symlink は辿らない
    if (e.isDirectory()) {
      walkSwiftFiles(full, callback);
    } else if (e.isFile() && e.name.endsWith('.swift')) {
      callback(full);
    }
  }
}

function patchSources(projectRoot) {
  let scanned = 0;
  let modified = 0;
  let totalPatches = 0;
  for (const root of NODE_MODULES_SCAN_ROOTS) {
    const absRoot = path.join(projectRoot, root);
    if (!fs.existsSync(absRoot)) continue;
    walkSwiftFiles(absRoot, (file) => {
      scanned += 1;
      const orig = fs.readFileSync(file, 'utf8');
      if (!orig.includes('@MainActor')) return;
      const { content: next, patches } = transformSwift6IsolatedConformance(orig);
      if (patches > 0 && next !== orig) {
        fs.writeFileSync(file, next);
        modified += 1;
        totalPatches += patches;
        const rel = path.relative(projectRoot, file);
        console.log(`[${SENTINEL}] patched (${patches}x) ${rel}`);
      }
    });
  }
  console.log(
    `[${SENTINEL}] scan summary: ${scanned} .swift files scanned, ${modified} files modified, ${totalPatches} sites patched`,
  );
}

function patchPodfile(podfilePath) {
  if (!fs.existsSync(podfilePath)) {
    console.warn(`[${SENTINEL}] Podfile not found: ${podfilePath}`);
    return;
  }
  let contents = fs.readFileSync(podfilePath, 'utf8');
  if (contents.includes(SENTINEL)) {
    console.log(`[${SENTINEL}] Podfile already patched`);
    return;
  }
  if (contents.includes('post_install do |installer|')) {
    contents = contents.replace(
      'post_install do |installer|',
      `post_install do |installer|${POST_INSTALL_BLOCK}`,
    );
  } else {
    contents += `\npost_install do |installer|${POST_INSTALL_BLOCK}\nend\n`;
  }
  fs.writeFileSync(podfilePath, contents);
  console.log(`[${SENTINEL}] Podfile patched (post_install override)`);
}

module.exports = function withSwiftConcurrencyWorkaround(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        'Podfile',
      );
      console.log(`[${SENTINEL}] projectRoot=${projectRoot}`);
      console.log(`[${SENTINEL}] podfilePath=${podfilePath}`);
      patchSources(projectRoot);
      patchPodfile(podfilePath);
      return config;
    },
  ]);
};
