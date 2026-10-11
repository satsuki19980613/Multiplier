# Multiplier

[![CI](https://github.com/satsuki19980613/Multiplier/actions/workflows/ci.yml/badge.svg)](https://github.com/satsuki19980613/Multiplier/actions/workflows/ci.yml)
[![Live](https://github.com/satsuki19980613/Multiplier/actions/workflows/live.yml/badge.svg)](https://github.com/satsuki19980613/Multiplier/actions/workflows/live.yml)
[![CodeQL](https://github.com/satsuki19980613/Multiplier/actions/workflows/codeql.yml/badge.svg)](https://github.com/satsuki19980613/Multiplier/actions/workflows/codeql.yml)

3 人制 No-Limit Hold'em のハイパーターボ SIT & GO。開始前に賞金の倍率を抽選し、1 位が総取りする。

完全無料のプレイマネーである。チップの購入・換金・譲渡・景品交換はできない。課金・広告は無い。

**公開サイト**：https://multiplier-poker.pages.dev/ （日本国内からのみ。18 歳以上）

## 機能

- **PLAY** — ステークス 10 / 100 / 1,000 / 2,000 / 3,000 から選んで着席する。人間が 2 人そろった時点で開始し、空席は Bot が埋める。
- **PRIVATE** — バイインを選んで部屋を作成すると、6 桁の部屋番号と招待 URL が発行される。番号か URL で参加し、3 人そろうと開始する。
- **FREEROLL** — 残高 10 未満のユーザー限定。1 日 3 回、賞金 500。
- **RANKING** — 所持チップ数のランキング。半年ごとのシーズン制で、上位者を殿堂入りとして記録する。

## セキュリティとプライバシー

### 要約

- **メールアドレス・氏名・プロフィール画像・IP アドレスを保存しない。** 運営者も閲覧できない。
- **他の参加者には、自分の手札と山札が見えない**（ショーダウンで公開された札を除く）。
- **チップの残高や対局の結果は、ブラウザから改ざんできない。** ルールの判定と配札はサーバーが行う。
- **課金・広告・アクセス解析は無い。** 自サイト以外のスクリプトは実行されない設定である。
- **日本国内からのアクセスのみ受け付ける。**
- **以上の内容は自動検証で継続的に確認している。** 結果は上部のバッジで公開している。

**制約**：運営者は対局の内容（山札・全員の手札・PRIVATE のチャット）を閲覧できる。サーバーが対局を進行させる設計のためである。運営者を信頼できる利用者に向けたアプリである。

### 取り扱う情報

| 情報 | サーバーへの保存 | 運営者による閲覧 | 他の参加者への表示 |
|---|---|---|---|
| メールアドレス | **保存しない**（実在しない宛先 `<ランダムな ID>@multiplier.invalid` に置換。メールアドレスを扱う招待機能も使わない） | 不可 | 不可 |
| Google の表示名（氏名） | **保存しない**（全員 `Player` に置換） | 不可 | 不可 |
| プロフィール画像 | **保存しない** | 不可 | 不可 |
| IP アドレス・ブラウザの種類 | **保存しない** | 不可 | 不可 |
| Google のトークン（メールアドレスを含む） | **保存しない** | 不可 | 不可 |
| Google のアカウント識別子 | 保存（再ログイン時の本人識別のため） | 可 | 不可 |
| ニックネーム（初期値はランダム。変更可） | 保存 | 可 | 可（卓・ランキング・殿堂入り） |
| チップの残高・当日の FREEROLL の回数 | 保存 | 可 | 残高のみランキングに表示 |
| 対局記録（進行中の山札・全員の手札を含む） | 保存（最終更新から 7 日で削除） | 可 | 自分の手札と公開済みの札のみ |
| PRIVATE の部屋（部屋番号・参加者） | 保存（1 日で削除。参加受付は作成から 10 分まで） | 可 | 同じ部屋の参加者 |
| チャット（PRIVATE の卓のみ） | 保存（対局記録とともに 7 日で削除） | 可 | 同じ卓の参加者 |
| 選択した演出 GIF（PRIVATE の卓のみ） | 保存（同上） | 可 | 同じ卓の参加者 |
| 殿堂入り（シーズン上位者のニックネームと残高） | 保存（削除しない） | 可 | 可 |
| 成績・ハンド履歴・プレイヤーのメモ | **保存しない**（端末内のみ） | 不可 | 不可 |
| 18 歳以上の確認・テーマ・音・ベットサイズの設定 | **保存しない**（端末内のみ） | 不可 | 不可 |

外部サービスに送信される情報：

- **Google** — ログイン時。
- **Cloudflare**（サイト配信）・**Neon**（サーバー・データベース・認証基盤） — 通信を中継するため、接続情報（IP アドレスなど）が送信される。Cloudflare は接続元の国を判定し、日本国外からの接続を拒否する。
- **KLIPY** — 演出 GIF の検索・表示時。検索語と端末ごとのランダムな識別子が送信される（ログイン ID やメールアドレスは送信しない）。
- フォントは自サイトから配信しており、ページを開くだけで Google に通信することはない。

### 保証範囲と制約

保証する事項：

- 他の参加者に、山札や自分の手札を見られない。Bot も、人間と同じく自席から見える情報だけで判断する。
- 自分のチップ残高・対局結果を、他人や自分のブラウザから改ざんできない。
- 他人へのなりすましによる操作を受けない（本人のトークンが無ければ、サーバーは処理しない）。
- 他サイトへの埋め込みによるクリックジャッキングを受けない。
- メールアドレス・氏名・画像・IP アドレスを運営者に知られない。

制約：

- **運営者は対局の内容を閲覧できる。** 山札・全員の手札・PRIVATE のチャットはサーバーのデータベースに保存される。
- **ログインの瞬間は、メールアドレスなどがサーバーを経由する。** Google からの応答を Neon Auth が受け取り、データベースへの書き込み直前に置換する。経由中の値を運営者が記録する仕組みは無いが、Neon 内部での取り扱いは Neon の規約に従う。
- **部屋番号か招待 URL を知っていれば、誰でも参加できる。** 番号は 6 桁で、パスワードは無い。番号の総当たりに対するレート制限は未実装である（参加受付が 10 分で締め切られるのみ）。
- **レート制限は未実装である。** 連打への対策は、外部サービス（Cloudflare・Neon）が提供する仕組みに依存する。
- **国内限定は接続元の国の判定に基づく。** VPN などによる国外からのアクセスは防げない。
- **参加者同士が共謀し、意図的に負けてチップを移すことは、システムでは完全には防げない。** 利用規約で禁止している。
- **外部サービス（Google・Cloudflare・Neon・KLIPY）における取り扱いは、各社の規約に従う。**
- **第三者による監査は受けていない。** 個人による運営であり、検証は下記の自動検証に限られる。

### 脅威モデルと対策

想定する脅威は、手札の覗き見やチップの不正な増加を試みる参加者、部屋への侵入を試みる第三者、個人情報を過剰に保持してしまう運営者自身、および一般的な Web 攻撃である。ブラウザは信頼しない。ルールの判定と配札はサーバーが行い、ブラウザには本人が閲覧してよい情報だけを送る。

| 対策目標 | 実装 | 根拠 |
|---|---|---|
| 個人情報を保持しない | データベースのトリガーが、書き込みの直前に値を置換する。アプリや認証基盤がどの経路で書き込んでも、置換前の値は保存されない | [20261011000000_auth_scrub.sql](db/migrations/20261011000000_auth_scrub.sql)。本番の残存を毎週検査する [scripts/auth-audit.mjs](scripts/auth-audit.mjs) |
| 手札と山札の秘匿 | 他人の手札と山札はブラウザに送らない。Bot も同じビューだけで判断する | [src/view.js](src/view.js)（`viewFor`）・[src/bot.js](src/bot.js) |
| チップと結果の改ざん防止 | テーブルはブラウザから直接読み書きできない。ブラウザが呼べるのは所定の関数だけで、本人の分だけを返す。対局を進行させるのはサーバー（Function "game"）だけである | [20261004000000_init.sql](db/migrations/20261004000000_init.sql)・[server/game/db.js](server/game/db.js)。本番で直接読めないことを検証する [scripts/live-check.mjs](scripts/live-check.mjs) |
| 本人以外による操作の防止 | サーバーがリクエストごとに、トークンの署名・発行者・有効期限を検証する。トークンはページ表示中のみメモリに保持し、ブラウザのストレージには保存しない | [server/game/index.js](server/game/index.js)・[src/net.js](src/net.js) |
| 他オリジンからの API 利用の防止 | サーバーは自サイトのオリジンからのリクエストだけを受け付ける（CORS） | [server/game/handler.js](server/game/handler.js)・[scripts/deploy-game.mjs](scripts/deploy-game.mjs) |
| XSS の防止 | 表示前にエスケープする。加えて、自サイト以外のスクリプトを実行させない | [src/ui/util.js](src/ui/util.js)（`esc`）・[public/_headers](public/_headers) |
| 配札・倍率・部屋番号の予測防止 | 暗号論的乱数を使う | [src/rnd.js](src/rnd.js) |
| 日本国内に限定したアクセス | 接続元の国が日本でなければ、案内（403）だけを返す。案内にも同じセキュリティヘッダーを付与する | [functions/_middleware.js](functions/_middleware.js) |
| ログイン Cookie のファーストパーティ化 | 認証の通信を自サイト経由で中継し、Cookie を自サイトのものに書き換える。中継対象は所定の 5 パスに限定する | [src/authProxy.js](src/authProxy.js)・[functions/api/auth/[[path]].js](functions/api/auth/%5B%5Bpath%5D%5D.js) |
| 秘密情報の管理 | リポジトリには置かず、GitHub の Secrets で管理する。データベースの接続文字列は使用時に取得し、表示しない | [scripts/neon.mjs](scripts/neon.mjs) |

### 自動検証

上部のバッジは、次の検証の結果を示す（安全性を保証するものではない）。

| 検証 | 内容 | 実行タイミング |
|---|---|---|
| [CI](https://github.com/satsuki19980613/Multiplier/actions/workflows/ci.yml) | テストとビルド。データベースを使う結合テスト（ブラウザからテーブルを読めないこと、個人情報の置換、マッチング、対局、賞金、ランキング、シーズン更新）を含む | コード変更時 |
| [Live](https://github.com/satsuki19980613/Multiplier/actions/workflows/live.yml) | 本番：日本国外からの接続が拒否され、その応答にセキュリティヘッダーが付与されていること。サーバーがトークン無し・不正なトークン・他オリジンからのリクエストを拒否すること。テーブルを直接読めないこと。本番のデータベースに個人情報が残っていないこと。開発環境：実データベースでの結合テスト | 毎週・手動 |
| [CodeQL](https://github.com/satsuki19980613/Multiplier/actions/workflows/codeql.yml) | GitHub CodeQL による静的解析 | コード変更時・毎週 |
| [Mozilla HTTP Observatory](https://developer.mozilla.org/en-US/observatory/analyze?host=multiplier-poker.pages.dev) | 公開サイトのセキュリティヘッダー。**A+**（2026-10-10 測定） | リンク先で随時再測定できる |

### 脆弱性の報告

[SECURITY.md](SECURITY.md) を参照。リポジトリの Security タブから非公開で報告できる。

### 記載方針

本節は次の指針に基づいて構成している。

- 要点を先に、詳細を後に示す（英国 ICO の[段階的な情報提供](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-methods-can-we-use-to-provide-privacy-information/)）
- 取り扱う情報を定型の表で示す（カーネギーメロン大学の[プライバシーの「栄養成分表示」の研究](https://doi.org/10.1145/1753326.1753561)。Apple・Google のアプリストアの表示も同じ考え方）
- 保証範囲と制約、想定する脅威と対策の根拠を示す（[OpenSSF Best Practices](https://www.bestpractices.dev/en/criteria/1)）
- 報告窓口と実施中の検証を示す（[GitHub のリポジトリのベストプラクティス](https://docs.github.com/en/repositories/creating-and-managing-repositories/best-practices-for-repositories)）

## 開発

### 必要環境

- Node.js 22.12 以上

### コマンド

| コマンド | 内容 |
|---|---|
| `npm install` | 依存パッケージのインストール |
| `npm run dev` | 開発サーバー（http://localhost:5180/）。`?fake` でサーバー無しに全画面を確認できる |
| `npm test` | 単体テスト |
| `npm run build` | 本番ビルド |

サーバーの更新（GitHub Actions → Neon）は、Actions の「Deploy server」から Run workflow で実行する（[.github/workflows/deploy-server.yml](.github/workflows/deploy-server.yml)）。

### 関連資料

- 設計：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 調査と仕様の根拠：[docs/research/](docs/research/README.md)
- 構成・コマンド・規約の詳細：[CLAUDE.md](CLAUDE.md)
