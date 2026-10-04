# CLAUDE.md — Multiplier

このリポジトリで作業するセッションが最初に読む文書。

## 1. 概要

- **アプリ**: Multiplier（表示は「Multiplier — 3人ポーカートーナメント」）。3人 NLHE のハイパーターボ SNG で、開始時に賞金の倍率を抽選し、1位が総取りする。完全無料・広告なし・課金なしのプレイマネー。
- **メニュー**: PLAY（ステークス 10 / 100 / 1,000）／ FREEROLL（残高 10 未満の人だけ。1日3回、賞金 500）／ RANKING（所有チップ数。半年ごとのシーズン制で、殿堂入りあり）。Google ログインが必須。
- **リポジトリ**: https://github.com/satsuki19980613/Spin-Go.git（リポジトリ名は内部名。公開名に「Spin & Go」は使わない）
- **体制**: さつき＝デザイナー兼意思決定者。実装は Claude。判断が分かれる点は推測で進めず、さつきに確認する。
- 技術構成は grid-holdem（`../grid-holdem`）を踏襲する。
- **実装契約（モジュール間のインターフェース）**: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。調査と仕様の根拠: [docs/research/](docs/research/README.md)。

## 2. 決定事項（さつき）

| 日付 | 決定 |
|---|---|
| 2026-10-04 | アプリ名は Multiplier |
| 2026-10-04 | 空席は Bot で埋める。弱すぎると拍子抜けするので、ある程度強くする（Nash 表＋レンジ推定 MC＋ルール。docs/research/05-bot.md） |
| 2026-10-04 | アクセスは日本国内に限定する |
| 2026-10-04 | 倍率表は推奨案を使う（RTP 100%・1位総取り・最高賞金は全ステークスで 100,000。docs/research/03-economy.md §4） |
| 2026-10-04 | ランキングは半年ごとにシーズンを更新する。上位者を殿堂入りとして記録したあと、全員のチップを 10,000 に戻す。殿堂入りは記録のみ |
| 2026-10-04 | 卓は WWYD の配置を参考にした楕円テーブル（色や UI コンセプトは Multiplier のまま）。タイトルに × は付けない |
| 2026-10-04 | バトル画面には注意書き・規約リンクを出さない。Bot は 🤖 ではなく「Bot」のテキスト表記で、名前はありそうな外国人名（性格は名前に出さない） |
| 2026-10-04 | 倍率ルーレットは円形。X の告知画像と同じピンク×青の2色刷り（リソグラフ風）で、アプリの配色から浮いてもよい（`src/ui/wheel.js`） |
| 2026-10-04 | 利用規約・プライバシーポリシーは WWYD と同程度の分量に絞る（チップの扱い・禁止事項・18歳以上・国内向けは必ず残す）。連絡先は WWYD と同じメールアドレス |

## 3. 法務のガードレール（崩す変更はさつき＋専門家の確認が必要）

1. チップは購入できない。課金・広告視聴報酬・寄付と連動した付与もしない。
2. チップを換金・景品交換できない。ランキングの賞品も出さない。
3. チップを譲渡できない。送金機能・プライベート卓・相手を選べるマッチングは作らない。
4. 収益化しない（広告・寄付・アフィリエイトなし）。
5. 実在の賭博サイトに誘導しない。他社のポーカーサイト名、外部リンク、「本番」「稼ぐ」などの語を画面に出さない。
- 日本国内からのアクセスに限定する（`functions/_middleware.js`）。利用規約・プライバシーポリシーを置き、注意書きを常に表示し、18 歳以上であることを確認する。

## 4. コマンド

| 目的 | コマンド |
|---|---|
| セットアップ | `npm install` |
| 開発サーバー | `npm run dev`（http://localhost:5180。**`?fake` でサーバー無しに全画面を確認できる**） |
| 単体テスト | `npm test` |
| ビルド | `npm run build` |
| マイグレーション | `npm run db:migrate -- --branch dev`（Neon プロジェクトの作成後。本番は**さつきの確認後**） |
| Function の配備 | `npm run deploy:game -- --branch dev`（同上） |

### インフラ（2026-10-04 作成）
| 区分 | 内容 |
|---|---|
| Neon | プロジェクト `multiplier`（`summer-hat-89673886`、シンガポール、Postgres 18）。ブランチ `production`（本番）・`dev`（開発） |
| ログイン | Neon Auth（Google。**Neon の共有キー**＝同意画面に Neon の表示が出る。本番公開前に自前の Google OAuth クライアントへ切り替えを検討）。信頼ドメイン: production は https://multiplier-poker.pages.dev、dev は localhost を許可 |
| Data API | 両ブランチで有効（neon_auth、既定の権限付与なし）。マイグレーション後は `neonctl data-api refresh-schema` |
| Function `game` | production: https://br-autumn-bar-b33acvo1-game.compute.c-4.ap-southeast-1.aws.neon.tech/ ・ dev: https://br-shy-boat-b3fs4jmg-game.compute.c-4.ap-southeast-1.aws.neon.tech/ |
| ホスティング | Cloudflare Pages `multiplier-poker`（https://multiplier-poker.pages.dev。`multiplier.pages.dev` は他者が使用中）。GitHub 連携でビルド `npm run build`・出力 `dist` |

URL を変えたら `.env.*`・`functions/api/auth/[[path]].js` の `UPSTREAM`・`public/_headers` の connect-src・`scripts/deploy-game.mjs` の許可 Origin を合わせる。

## 5. 規約

- ルールを変えるときは `src/engine.js` だけを直し（設定は `src/spin.js`）、`npm test` を通す。サーバーとブラウザで二重に実装しない。
- 山札と他席のホールカードはブラウザに送らない（`src/view.js` の `viewFor`）。Bot もビューだけを見て判断する。
- 画面に説明文を出さない。説明はルールのモーダルに集める。ポーカー用語は英語（Fold / Call / Raise）。
- 角は直角。色は YOU #336B87・相手 #FE7A47。トークンは `src/style.css` の `:root`。
- 秘密情報（DB の接続文字列など）はコミットしない。`.env.development` / `.env.production` には公開の住所だけを書く。
- マイグレーションは追加のみ（適用済みのファイルは書き換えない）。
- コミットメッセージは `feat(scope): …` / `fix(...)` / `docs(...)` / `chore(...)` の形で、日本語で書く。

## 6. さつきに確認が必要な操作

`git push`、本番（`production`）へのマイグレーション・Function の配備、Neon・Cloudflare・Google の設定変更、依存ライブラリの追加、データの削除。
