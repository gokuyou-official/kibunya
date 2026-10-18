// expo-modules-core 55.0.25 の Xcode 16.x ビルド失敗対策パッチ。
//
// 何をやっているか:
//   (a) ExpoModulesCore.podspec の swift_version を '6.0' → '5.0' に降格。
//       Swift 6 language mode の strict concurrency を解除し、
//       "main actor-isolated property cannot be referenced from nonisolated"
//       "non-sendable type" 系のエラーを warning に落とす。
//   (b) Swift 6 only の isolated conformance 構文
//         extension X: @MainActor Y { ... }
//       を Swift 5 互換の
//         @MainActor extension X: Y { ... }
//       に書き換える。意味的にほぼ等価 (実装側からは @MainActor が
//       extension 全体に伝播するため、外部から見ると同じ)。
//
// 適用対象は 2 ファイルのみ:
//   - ios/Core/Views/ViewDefinition.swift (UIView: AnyArgument)
//   - ios/Core/Views/SwiftUI/SwiftUIVirtualView.swift
//
// 既にパッチ済みなら no-op。対象文字列が見つからなければ exit 1
// (=expo-modules-core 側の構造変化を検知できる)。
import fs from 'node:fs';
import path from 'node:path';

const PMC = path.resolve(
  'node_modules/expo/node_modules/expo-modules-core',
);

if (!fs.existsSync(PMC)) {
  console.error(`::error::${PMC} が存在しません`);
  process.exit(1);
}

function patch(rel, oldStr, newStr) {
  const file = path.join(PMC, rel);
  const s = fs.readFileSync(file, 'utf8');
  if (!s.includes(oldStr) && s.includes(newStr)) {
    console.log(`(skip) ${rel} は既にパッチ済`);
    return;
  }
  if (!s.includes(oldStr)) {
    console.error(`::error::${rel} に対象文字列が見つかりません`);
    process.exit(1);
  }
  fs.writeFileSync(file, s.replace(oldStr, newStr));
  console.log(`(ok)   ${rel} patched`);
}

// (a) podspec の swift_version 降格 (空白2つ "  " で podspec に書かれている)
patch(
  'ExpoModulesCore.podspec',
  "s.swift_version  = '6.0'",
  "s.swift_version  = '5.0'",
);

// (b1) UIView の isolated conformance を classic 形に
patch(
  'ios/Core/Views/ViewDefinition.swift',
  'extension UIView: @MainActor AnyArgument {',
  '@MainActor\nextension UIView: AnyArgument {',
);

// (b2) SwiftUIVirtualView の isolated conformance を classic 形に
patch(
  'ios/Core/Views/SwiftUI/SwiftUIVirtualView.swift',
  'extension ExpoSwiftUI.SwiftUIVirtualView: @MainActor ExpoSwiftUI.ViewWrapper {',
  '@MainActor\nextension ExpoSwiftUI.SwiftUIVirtualView: ExpoSwiftUI.ViewWrapper {',
);

console.log('\n--- verification: swift_version line ---');
console.log(
  fs
    .readFileSync(path.join(PMC, 'ExpoModulesCore.podspec'), 'utf8')
    .split('\n')
    .find((l) => l.includes('swift_version')),
);
