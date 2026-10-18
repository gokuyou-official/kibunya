// Metro 設定
//
// 目的: Firebase JS SDK (10.x) を React Native (Expo SDK 55) で正しく解決させる。
//
// 背景:
//   Expo SDK 51+ 以降 Metro の package exports 解決がデフォルト ON になっており、
//   `firebase/auth` の `exports` フィールド条件付き解決が壊れて web/browser エントリ
//   に解決されてしまう。結果、`getReactNativePersistence` が auth component を
//   登録できず、ランタイムで "Component auth has not been registered yet" が発生する。
//
// 対策:
//   1. `unstable_enablePackageExports = false` で旧 main fields 解決に戻す
//      (`react-native` -> `browser` -> `main` の順)。
//   2. Firebase の一部サブモジュールが `.cjs` で配布されているため、sourceExts に
//      'cjs' を追加して Metro が解決できるようにする。
//
// 参考: Firebase 公式 Expo ガイド推奨設定。
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts.push('cjs');
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
