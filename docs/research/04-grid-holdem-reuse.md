# 04. grid-holdem の解析と流用計画

対象: `C:\Users\sa641.SATSUKIPC\OneDrive\ドキュメント\一時ツール\grid-holdem`（2026-10-04 に解析。`npm test` は45件すべて成功）

## 0. 最重要の前提
- **grid-holdem は通常のホールデムではなく「Grid Poker」**。5×5盤面の行5本と列5本、計10ラインで勝負する**2人専用**のゲーム。
- そのためゲームエンジン `src/engine.js` は2席前提で書かれている（`1-p`、`stacks[2]`、`contrib[L]=[a,b]`、DBの `p0/p1`、`view0/view1` など）。**3人NLHEのベッティング・状態機械・サイドポットは新しく作る必要がある。**
- そのまま流用できるのは次の部分。
  - 周辺アーキテクチャ（認証、DB、Neon Function、ポーリング同期、UI基盤、開発規約）
  - カード表現、5枚役判定（`eval5`）、シャッフル（crypto + Fisher–Yates）

## 1. 技術構成（そのまま踏襲する）

| 区分 | 内容 |
|---|---|
| フロント | Vite + 素のJavaScript（フレームワークなし、TypeScriptなし）。文字列テンプレートと差分更新ヘルパー（`setHTML`/`setCls`/`setAttr`） |
| ホスティング | Cloudflare Pages。`public/_headers` でCSPを設定 |
| サーバー | ① Cloudflare Pages Functions は認証リレーのみ（`functions/api/auth/[[path]].js`）<br>② ゲーム処理は **Neon Functions**（`server/game/index.js`、`@neon/functions`、nodejs24）<br>③ 読み取りは **Neon Data API の RPC**（PostgREST互換、RLS + security definer 関数） |
| DB | Neon Postgres。ブランチは `production` と `dev`。マイグレーションは自作ランナー（`scripts/db.mjs`）で、ファイルは追加のみ |
| 認証 | **Neon Auth（Managed Better Auth）の Google ログイン**<br>・Cookieをファーストパーティにするため、自サイトの `/api/auth/*` を経由して中継する（`src/authProxy.js`）<br>・JWTの有効期限は15分<br>・トークンの検証は Function 側（jose + JWKS）と Data API 側（`current_uid()`）の2か所 |
| 同期 | **HTTPポーリングのみ**（WebSocketは使わない）。相手の手番は1秒、自分の手番は2.5秒、タブが非表示なら4秒間隔 |
| テスト | `node:test`。エンジンの不変条件ファズ（チップ総量の保存）、ビューの秘匿、HTTP層のテスト。dev ブランチでは結合テスト `scripts/itest.mjs` |
| 依存 | `@neon/functions`、`jose`、`pg`（dev は `neonctl`、`vite`）。フロントのランタイム依存はゼロ |
| サウンド | なし |

## 2. 流用分類

### A. ほぼコピーで使えるもの
- 認証一式: `src/net.js`、`src/authProxy.js`、`functions/api/auth/[[path]].js`、`vite.config.js` の proxy と pagesHeaders
- Function の HTTP 層: `server/game/handler.js`（CORS、Bearer、本文の上限、エラーとHTTPステータスの対応）、`server/game/index.js`（JWKS 検証）
- DB 基盤
  - `current_uid()`、`fail()`
  - RLS + 権限剥奪 + security definer RPC のパターン
  - `me()`、`set_nickname()`、`ranking()` の骨格
  - 「呼び出しのついでに古いゲームを掃除する」方式の purge
- スクリプト: `scripts/db.mjs`、`neon.mjs`、`deploy-game.mjs`、`itest.mjs` の枠組み
- エンジンの汎用部分: カード表現（0..51 の整数）、`rnd`/`shuffle`、`eval5`/`catOf`/`handName`
- UI 基盤
  - CSS トークン、ライト／ダーク、直角デザイン、ガラス質感
  - カードの CSS 描画（画像アセットは不要）
  - dialog 群、トースト、確認ダイアログ
  - アニメーションヘルパー（`fly`/`tweenStacks`/`flipFx`）
  - ターンタイマー（サーバー時刻の補正付き）
  - PWA（manifest、sw、theme.js）
  - 「実測してフィットさせる」レイアウト手法
- 時間切れの扱い: 時間切れはクライアントが申告し、サーバーが deadline + 猶予時間を検証する。strikes で連続回数を数える。
- 開発用: `?fake` で使う fakeNet（本物の rules.js をブラウザで動かす）

### B. 改修が必要なもの
| 対象 | 改修内容 |
|---|---|
| ハンド評価 | `eval5` を使って、**7枚からベスト5枚を選ぶ処理（21通り）を追加する**。`bestHole`（手札2枚＋ボード3枚の固定）は Grid 専用なので捨てる |
| `view.js` | 他の**2席**の手札を隠す。ショーダウンでの公開ルールを入れる |
| `server/game/rules.js` | move の検証を NLHE 用にする。`eloDelta` を廃止し、チップ精算に置き換える。設定値を Spin 用にする |
| `server/game/db.js` | `match` を「2人を指名」から「3人が揃ったら成立（Bot 補充あり）」に変える。`play` で終局時にチップを精算する |
| DB スキーマ | `games` を3席にする（`players uuid[3]`、`views jsonb`、`strikes '{0,0,0}'`）。`lobby` をステークごとの待機キューにする。`profiles` に `chips` を追加し、Elo と勝敗の列はなくす |
| `src/main.js` | 2席と5×5盤面を前提にした描画を、3席のテーブル UI に作り直す |
| `src/cpu.js` | モンテカルロで勝率を見積もる考え方は流用する（相手2人分をサンプリングし、7枚で評価）。ベット判断は作り直す。サーバー側でも import できる |
| `guide.js` | ガイドアニメの基盤は流用し、中身を Spin 用のルール説明に書き直す |

### C. 新規に作るもの
- 3人NLHEエンジン: ボタン／SB／BB、ストリート、アクション順、最小レイズ、オールイン、**サイドポット**、複数勝者と端数、ヘッズアップ時のブラインド
- トーナメント層: 倍率別の初期スタック、時間で上がるブラインド（常駐する時計がないため、ハンド開始時に経過時間からレベルを決める遅延評価）、脱落順、終局と賞金の付与
- 倍率抽選（サーバーの RNG）と、ホイール演出
- 自動マッチング（待機キュー → 3人揃ったら卓を作る、タイムアウトしたら Bot を補充）
- サーバー側の Bot（ポーリングを契機に遅延評価で動かす）
- チップ経済: バイインの引き落とし、賞金の付与、フリーロール（回数と日付の管理）、High卓の解放条件
- 3席テーブル UI: コミュニティカード5枚、ポット、ディーラーボタン、ブラインドレベルと次のレベルまでの時間、倍率表示
- 利用規約、プライバシーポリシー、日本限定アクセス（`functions/_middleware.js`）

## 3. 流用時に差し替える直書き箇所
- `scripts/neon.mjs:5` の Neon プロジェクト id
- `functions/api/auth/[[path]].js:8` の本番 Neon Auth URL
- `public/_headers` の CSP `connect-src`
- `scripts/deploy-game.mjs` の許可 Origin
- `.env.development` / `.env.production`
- package.json の name、index.html の title、manifest、localStorage のキー `gp-theme`、CLAUDE.md
- `scripts/gen-icons.mjs` と `promo/*` は `../WWYD/node_modules/@playwright/test` に依存しているので注意

## 4. 引き継ぐ開発規約（grid-holdem の CLAUDE.md より）
- **ルールは engine にだけ実装し、サーバーとブラウザで二重に実装しない。** ルールを変えたら `npm test` と結合テストを通す。
- 画面に説明文を出さず、説明はルールモーダルに集める。ポーカー用語は英語で書く（Fold/Call/Raise）。
- 角は直角。色は YOU が `#336B87`、相手が `#FE7A47`。
- 秘密情報はコミットしない（`.env.*` には公開アドレスだけを書く）。
- マイグレーションは追加のみ。
- 次の操作はさつきさんの確認が必要: git push、本番へのマイグレーションと Function 配備、Neon・Cloudflare・Google の設定変更、依存ライブラリの追加、データの削除。
- 仕様を決めたら、日付と決定者を付けて CLAUDE.md に記録する。

## 5. 注意: 「サーバーはプレイヤー名とチップ数のみ」との差分
要件を満たしつつ動かすには、次のデータは最低限必要になる。
1. **Neon Auth が `neon_auth.user` にメールアドレスと氏名を自動で保存する**（Better Auth の仕様）。これはアプリ側の profiles とは別の場所。プライバシーポリシーにはこの保存も書く必要がある。
2. フリーロールの1日の回数制限: profiles に `freeroll_date` と `freeroll_used` の2列が必要。
3. 進行中のゲーム状態（`games` テーブル）: 一時データで、終局後は purge する。
