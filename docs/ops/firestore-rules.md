# Firestore セキュリティルール 運用メモ

## 反映の仕組み

`firestore.rules` は GitHub Actions の `Firestore Rules Deploy`
(`.github/workflows/firestore-rules-deploy.yml`) で本番 (`kibunyapjt`) に反映する。
手元の `firebase deploy` は使わない。

| トリガー | 挙動 |
| --- | --- |
| `main` への push で `firestore.rules` が変わった時 | 自動反映 |
| 手動実行 (workflow_dispatch) | `dry_run=true` (既定) なら比較のみ。反映するには `false` |

順序は **エミュレータテスト32ケース → 配信中ルール取得 → diff → 反映 → 反映後の全文検証**。
テストが落ちるとデプロイステップに到達しない。反映後の内容がリポジトリと
1文字でも違えばワークフローが失敗する。

反映は `firebase-tools` ではなく Firebase Rules API を直接叩く
(`scripts/firebase-deploy-rules.mjs`)。`firebase deploy` は事前に
Service Usage API へ「firestore API が有効か」を問い合わせるが、
デプロイ用サービスアカウントにその閲覧権限が無く 403 で落ちるため。
ルール反映自体にその権限は不要なので、権限を増やさずに回避している。

## 反映履歴

| 日時 (UTC) | rulesetName | 内容 |
| --- | --- | --- |
| 2026-05-18 13:12 | `ca8abff5-c184-412b-a8df-95686770246f` | 全開放 (`match /{document=**}` に `allow read, write: if request.auth != null`) |
| 2026-08-09 07:27 | `12572366-3059-4ddd-b70c-372b421a9bfe` | users / friendsList / notifications をパス単位で制限 (現行) |

2026-05-18 から 2026-08-09 までの間、リポジトリの `firestore.rules` は
更新されていたが本番には一度も反映されていなかった。

## 切り戻し手順

### 一次手段: git revert して再デプロイ (推奨)

ルールの中身に問題があった場合はこれ。検証ゲートを全部通るので安全。所要 3〜4 分。

```bash
git revert --no-edit 36c0752      # ルール厳格化のコミット
git push origin main               # firestore.rules が変わるので自動デプロイが走る
```

revert 先 (`b2c26fe` 時点のルール) も全開放ではなくパス単位の制限が入っている。
そのため一次手段を採っても「誰でも全部読み書きできる」状態には戻らない。

反映されたか確認するには `Firebase Rules Check (read only)` ワークフローを
手動実行する。読み取りだけなので何度実行しても副作用は無い。

### 緊急手段: 直前の ruleset に release を戻す

アプリが完全に機能不全になり、git revert を待つ余裕も無い場合のみ。

戻し先は `projects/kibunyapjt/rulesets/ca8abff5-c184-412b-a8df-95686770246f` だが、
**これは 2026-05-18 の全開放ルールであり、実行するとセキュリティが当時の状態まで下がる**。
ログイン済みなら誰でも全ドキュメントを読み書きできる状態に戻ることを意味する。

この手段はセキュリティを下げる方向なので、**必ず事前に承認を取ること**。
実行するには deploy ワークフローに ruleset 指定の入力を足す必要がある
(現時点では未実装。緊急時に慌てて実装しないよう、必要になった時点で先に相談する)。

## 既知のクライアント互換性

`friends/{userId}/friendsList/{friendId}` の update は `addedAt` のみ許可される。
招待リンクの相互登録で `setDoc` に `{ merge: true }` が無いとドキュメント全体の
置換になり、既存の `active` の削除が `affectedKeys` に乗って拒否される。

`merge: true` はコミット `36c0752` で入った。**それより前のビルド
(TestFlight Build 85 / App Store 配信中の版を含む) には入っていない。**

そのため古いビルドでは次の 1 ケースだけ失敗する:

- B が A の通知トグルを OFF (`active: false`) にしている状態で、
  A が B の招待リンクを踏み直す
  → A から B のリストへの書き込みが拒否され、
    「招待リンクの処理に失敗しました」が出る

ルール反映前は、この操作は成功する代わりに B の `active: false` を黙って
消していた (= ミュートが勝手に解除される)。データが壊れる挙動が
目に見えるエラーに変わっただけで、悪化ではない。次のビルドで解消する。

上記以外のケース (新規の相互登録、`active` が付いていない相手への踏み直し、
送信・受信・かー・アカウント削除) は古いビルドでもそのまま動く。
