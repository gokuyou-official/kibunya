# キブンヤ (KIBUNYA)

気分を置いておくアプリ。
友達がいきますかーしてるかもしれない。誘ってないから大丈夫。気分を置いておくだけ。

## 📱 なにができる? (v2)

### 4アクティビティ対応
ちょい飲み・サウナ・ランチ・麻雀の4つの気分を置いておける。
- 🍺 ちょい飲み → マッチで 🍻
- 🧖‍♀️ サウナ → マッチで ♨️
- 🍜 ランチ → マッチで 🍽️
- 🀄 麻雀 → マッチで 💸

### 興味ベース通知フィルタ
自分が選んだ興味(アクティビティ)に一致する通知だけ届く。
初回ログイン後に選択画面でセットし、プロフィール画面からいつでも変更可能。

### その他
- 🔔 アラートタブで通知一覧+「かー」リアクション
- 👥 招待リンクで友達追加
- 👤 プロフィール編集(名前・活動エリア・一言・気分の種類)
- 🔐 Apple / メールでログイン

## 🏗️ 技術スタック
- **フレームワーク**: Expo (React Native) + TypeScript
- **バックエンド**: Firebase (Auth / Firestore)
- **通知**: Expo Push Notifications
- **認証**: Apple Sign-In / Email

## 📂 ファイル構成

```
kibunya/
├─ App.tsx                  … エントリーポイント(興味ゲート+Profileタブ)
├─ app.json                 … Expo 設定
├─ eas.json                 … EAS Build 設定
├─ package.json             … 依存関係
├─ tsconfig.json
├─ babel.config.js
├─ firestore.rules          … Firestore セキュリティルール
├─ firestore.indexes.json
├─ firebase.json
├─ .gitignore
├─ .env.example
├─ assets/                  … アイコン・スプラッシュ (要追加)
└─ src/
   ├─ config/
   │  ├─ firebase.ts        … Firebase 初期化
   │  ├─ colors.ts          … カラーパレット(藍/山吹/朱)
   │  └─ activities.ts      … 4アクティビティ定義(マッチ絵文字含む)
   ├─ hooks/
   │  ├─ useAuth.ts         … 認証状態+サインイン
   │  ├─ useFriends.ts      … 友達一覧+追加
   │  ├─ useNotifications.ts… 通知購読+リアクション(興味フィルタ)
   │  └─ useProfile.ts      … プロフィール+興味リスト
   ├─ utils/
   │  ├─ pushNotifications.ts … Expo Push + FCMトークン登録
   │  └─ inviteLink.ts      … 招待ディープリンク
   ├─ components/
   │  ├─ SendOverlay.tsx    … 送信完了モーダル
   │  ├─ NotificationCard.tsx … 通知カード
   │  ├─ FriendPill.tsx     … 友達ステータスピル
   │  └─ ActivityTab.tsx    … アクティビティ切替タブ
   └─ screens/
      ├─ OnboardingScreen.tsx       … ログイン(ダーク基調)
      ├─ InterestSelectionScreen.tsx… 興味選択(初回+編集)
      ├─ HomeScreen.tsx             … 4アクティビティ対応ホーム
      ├─ NotificationsScreen.tsx    … アラート一覧(興味フィルタ)
      ├─ FriendsScreen.tsx          … フレンド一覧
      └─ ProfileScreen.tsx          … プロフィール編集
```

---

## 🚀 セットアップ手順

### 0. 前提
- PC (Mac推奨) or Codespaces / クラウドシェル環境
- Node.js 18以上
- iPhone (実機テスト用)

> ⚠️ iPhone のみでのセットアップは `npm install` が重いため現実的でない。
> カネさんは **GitHub Codespaces** か **Replit** のようなクラウドIDEを使うことを推奨。

### 1. リポジトリをクローン
```bash
git clone <kibunyaリポジトリURL>
cd kibunya
```

### 2. 依存関係をインストール
```bash
npm install
npm install -g eas-cli firebase-tools
```

### 3. Firebase プロジェクト作成 & Firestore デプロイ
```bash
firebase login
firebase projects:create kibunya-app --display-name "キブンヤ"
firebase use kibunya-app
firebase deploy --only firestore:rules,firestore:indexes
```
> `firestore.rules` / `firestore.indexes.json` はリポジトリ直下に同梱済みなので `firebase init` は不要。

### 4. Firebase Web アプリ登録 & `.env` 作成
本アプリは Expo (JS バンドル) から Firebase Web SDK を直接叩く構成 (`src/config/firebase.ts`)。したがって **iOS/Android ネイティブアプリではなく Web アプリとして登録** し、その config を `.env` に入れる。

```bash
firebase apps:create WEB kibunya-web
firebase apps:sdkconfig WEB --json
```

出力された `sdkConfig` の各値を `.env` に転記:
```bash
cp .env.example .env
# エディタで .env を開いて実値を貼り付け
```

対応関係:
| firebaseConfig キー | `.env` の変数 | 必須 |
|---|---|---|
| `apiKey` | `EXPO_PUBLIC_FIREBASE_API_KEY` | ✅ |
| `authDomain` | `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | ✅ |
| `projectId` | `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | ✅ |
| `storageBucket` | `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` | ✅ |
| `messagingSenderId` | `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | ✅ |
| `appId` | `EXPO_PUBLIC_FIREBASE_APP_ID` | ✅ |
| `measurementId` | `EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID` | 任意 (Analytics 用) |

> 必須キーが未設定だと `src/config/firebase.ts` が起動時に `console.error` で警告を出す。

#### 4-2. EAS Secrets 登録 (本番ビルド用)

`.env` は **ローカル開発専用** (Expo Go / `npx expo start`)。EAS Build (`eas build ...`) は `.env` を読まないため、本番ビルド向けには **EAS Secrets** に同じ値を別途登録する必要がある。

> EAS Secrets はビルド時に環境変数として `process.env` に注入される。`EXPO_PUBLIC_` プレフィックスがあればクライアントバンドルに含められる。

**登録手順 (1回のみ):**
```bash
eas login
eas init   # 初回のみ。app.json の extra.eas.projectId が自動設定される

# 必須6キー + 任意1キーを登録
eas secret:create --name EXPO_PUBLIC_FIREBASE_API_KEY            --value "AIza..."           --scope project
eas secret:create --name EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN        --value "kibunyapjt.firebaseapp.com" --scope project
eas secret:create --name EXPO_PUBLIC_FIREBASE_PROJECT_ID         --value "kibunyapjt"        --scope project
eas secret:create --name EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET     --value "kibunyapjt.firebasestorage.app" --scope project
eas secret:create --name EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID --value "726312004432"     --scope project
eas secret:create --name EXPO_PUBLIC_FIREBASE_APP_ID             --value "1:726312004432:web:db070d6ba4841cd9019a55" --scope project
eas secret:create --name EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID     --value "G-WVHCNJJK2H"      --scope project
```

> ⚠️ 上記コマンドの `--value` には**実値を直接渡す**。シェル履歴に残るのが嫌なら `--value @secret.txt` のようにファイル経由で渡す方法もある。

**登録確認:**
```bash
eas secret:list --scope project
```

**値の更新 (ローテーション時):**
```bash
eas secret:delete --name EXPO_PUBLIC_FIREBASE_API_KEY --scope project
eas secret:create --name EXPO_PUBLIC_FIREBASE_API_KEY --value "新しい値" --scope project
```

**本番ビルド時に注入されるか確認:**
```bash
eas build --platform ios --profile preview --non-interactive
# ログ冒頭の "Resolved secrets" 行に上記7キーが表示されれば OK
```

| 環境 | `.env` | EAS Secrets |
|---|---|---|
| `npx expo start` (Expo Go / 開発機実行) | ✅ 使う | ✗ 関係なし |
| `eas build --profile development` | ✗ 関係なし | ✅ 使う |
| `eas build --profile preview` (TestFlight) | ✗ 関係なし | ✅ 使う |
| `eas build --profile production` | ✗ 関係なし | ✅ 使う |

### 5. Firebase Console で手動設定 (CLI 非対応)
Firebase CLI では認証プロバイダを有効化できないため、以下は Console (https://console.firebase.google.com/project/kibunya-app) で実施:

#### 5-1. Authentication プロバイダ有効化
**Build → Authentication → Sign-in method** タブを開き、以下を有効化:
- ✅ **メール/パスワード** (「メール/パスワード」を選択 → 有効にする → 保存)
- ✅ **Apple**
  - Services ID: Apple Developer で作成した Service ID (例: `com.kibunya.app.signin`)
  - Apple Team ID / Key ID / 秘密鍵 (`.p8`) を入力
  - 詳細手順: https://firebase.google.com/docs/auth/ios/apple

> Apple Sign In 用の Service ID / Key 発行は Apple Developer Portal (Keys / Identifiers) で事前に行う必要がある。Apple Developer Program ($99/年) への登録が前提。

#### 5-2. 承認済みドメイン
**Authentication → Settings → 承認済みドメイン** に以下を追加:
- `localhost` (開発デフォルトで入っている)
- Expo Go で使う場合は `auth.expo.io`

#### 5-3. Cloud Messaging (iOS プッシュ通知用)
- Apple Developer → Keys → **APNs Authentication Key** を作成 (`.p8`)
- Firebase Console → **Project Settings → Cloud Messaging → Apple app configuration** → APNs 認証キーをアップロード
- Team ID / Key ID も入力

### 6. アセット追加
`assets/` に以下を配置:
- `icon.png` (1024x1024)
- `splash.png` (1284x2778)
- `adaptive-icon.png` (1024x1024) …Android用

### 7. EAS Build 初期化
```bash
eas login
eas build:configure
```
→ `app.json` の `extra.eas.projectId` が自動で書き換わる。

### 8. 開発起動
```bash
npx expo start
```
iPhoneに **Expo Go** アプリを入れて QR コードをスキャン。

---

## 🏗️ ビルドコマンド

```bash
# テストビルド(iOS, TestFlight配布前の内部テスト)
eas build --platform ios --profile preview

# 本番ビルド(iOS)
eas build --platform ios --profile production

# App Store申請
eas submit --platform ios
```

---

## 🧍 人間がやること

| 項目 | 備考 |
|---|---|
| Apple Developer Program 登録 ($99/年) | https://developer.apple.com/programs/enroll/ |
| Apple Developer で Service ID / APNs Key (`.p8`) を発行 | Apple Sign In / プッシュ通知用 |
| Firebase Console で Apple/Email 認証を有効化 | 上記STEP5-1 (CLI 非対応) |
| Firebase Console で APNs キーをアップロード | 上記STEP5-3 |
| アセット画像を `assets/` に置く | 上記STEP6 |
| `.env` に Firebase Web SDK config を記入 | 上記STEP4 |

---

## 🗄️ Firestoreデータ構造

```
users/{userId}
  name: string
  email: string
  area: string               // 主な活動エリア
  bio: string                // 一言
  interests: ActivityId[]    // ["drinking","sauna","lunch","mahjong"]
  fcmToken: string
  lastSeen: timestamp
  createdAt: timestamp

friends/{userId}/friendsList/{friendId}
  addedAt: timestamp

notifications/{notificationId}
  senderId: string
  senderName: string
  receiverId: string
  activityId: ActivityId     // どの気分を送ったか
  type: "kibun" | "reaction"
  createdAt: timestamp
  isRead: boolean
  reactedBy: string | null
```

---

## 🎨 カラーパレット (v2)

ダーク基調(藍ベース)に統一。すべて `src/config/colors.ts` の `colors` 定数を使用。

- `#1A2E55` 藍(あい) … ベース背景 (`colors.ai`)
- `#122041` 濃藍(あいディープ) … タブバー/深層 (`colors.aiDeep`)
- `#F5C518` 山吹(やまぶき) … アクセント (`colors.yamabuki`)
- `#D94829` 朱(しゅ) … CTA (`colors.shu`)
- `#FFF9EC` 生成(クリーム) … テキスト (`colors.cream`)
- `#3BB273` オンライン緑 (`colors.online`)

---

## 📝 今後の展開
- Android リリース
- カスタム気分メッセージ
- グループ機能(家族グループ等)
- 位置情報ベースの近距離通知
