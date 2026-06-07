// Expo config plugin: Swift 6 strict concurrency workaround for Xcode 16.x
//
// 背景:
//   expo-modules-core 55.0.25 のソースが Swift 6 language mode 前提で
//   書かれており (s.swift_version = '6.0' + isolated conformance 構文)、
//   Xcode 16.x の Swift 6.x コンパイラが strict concurrency を強制して
//   ビルド失敗する (Run #1〜#4 で確認)。
//
//   workflow 内で scripts/patch-expo-modules-core.mjs を走らせても、
//   `eas build --local` は project を temp dir に展開して
//   `npm install` を再実行するため、外側 node_modules への patch が
//   build に反映されない。
//
// このプラグインは prebuild 中に temp dir の中で動くため、
// (a) Podfile に post_install hook を注入して全 Pod target の
//     SWIFT_VERSION='5.0' / SWIFT_STRICT_CONCURRENCY='minimal' を強制
// (b) expo-modules-core の Swift 6-only 構文 (isolated conformance) を
//     Swift 5 互換に書き換え (Swift 5 mode で parse 可能にする)
// の両方を temp dir の正しい場所で適用する。
//
// (a) だけだと parse error ("unknown attribute 'MainActor'")、
// (b) だけだと strict concurrency error が残るため、両方必須。
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

const SOURCE_PATCHES = [
  {
    rel: 'node_modules/expo/node_modules/expo-modules-core/ios/Core/Views/ViewDefinition.swift',
    from: 'extension UIView: @MainActor AnyArgument {',
    to: '@MainActor\nextension UIView: AnyArgument {',
  },
  {
    rel: 'node_modules/expo/node_modules/expo-modules-core/ios/Core/Views/SwiftUI/SwiftUIVirtualView.swift',
    from: 'extension ExpoSwiftUI.SwiftUIVirtualView: @MainActor ExpoSwiftUI.ViewWrapper {',
    to: '@MainActor\nextension ExpoSwiftUI.SwiftUIVirtualView: ExpoSwiftUI.ViewWrapper {',
  },
  // Swift 6 のみで通る「class 宣言の inheritance リスト内 @MainActor」構文。
  // Run #5 で SwiftUIHostingView.swift:45 が未パッチで "unknown attribute 'MainActor'"
  // が再発したため追加。`@MainActor` を class 宣言の前に置く形 (Swift 5 valid) に書換。
  {
    rel: 'node_modules/expo/node_modules/expo-modules-core/ios/Core/Views/SwiftUI/SwiftUIHostingView.swift',
    from: '  public final class HostingView<Props: ViewProps, ContentView: View<Props>>: ExpoView, @MainActor AnyExpoSwiftUIHostingView {',
    to: '  @MainActor\n  public final class HostingView<Props: ViewProps, ContentView: View<Props>>: ExpoView, AnyExpoSwiftUIHostingView {',
  },
];

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

function patchSources(projectRoot) {
  for (const { rel, from, to } of SOURCE_PATCHES) {
    const file = path.join(projectRoot, rel);
    if (!fs.existsSync(file)) {
      console.warn(`[${SENTINEL}] source not found: ${rel}`);
      continue;
    }
    const s = fs.readFileSync(file, 'utf8');
    if (!s.includes(from) && s.includes(to)) {
      console.log(`[${SENTINEL}] ${rel} already patched`);
      continue;
    }
    if (!s.includes(from)) {
      console.warn(
        `[${SENTINEL}] target string not found in ${rel} (expo-modules-core structure may have changed)`,
      );
      continue;
    }
    fs.writeFileSync(file, s.replace(from, to));
    console.log(`[${SENTINEL}] ${rel} patched (Swift 6 → 5 syntax)`);
  }
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
