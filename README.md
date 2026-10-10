# Multiplier

[![CI](https://github.com/satsuki19980613/Multiplier/actions/workflows/ci.yml/badge.svg)](https://github.com/satsuki19980613/Multiplier/actions/workflows/ci.yml)
[![Live](https://github.com/satsuki19980613/Multiplier/actions/workflows/live.yml/badge.svg)](https://github.com/satsuki19980613/Multiplier/actions/workflows/live.yml)
[![CodeQL](https://github.com/satsuki19980613/Multiplier/actions/workflows/codeql.yml/badge.svg)](https://github.com/satsuki19980613/Multiplier/actions/workflows/codeql.yml)

3 人で遊ぶ No-Limit Hold'em のハイパーターボ SIT & GO。始まる前に賞金の倍率を抽選し、1 位が総取りする。

サイト：https://multiplier-poker.pages.dev/ （日本国内からのみ。18 歳以上）

- **PLAY** — ステークス 10 / 100 / 1,000 / 2,000 / 3,000 から選んで卓に着く。人が 2 人そろえば始まり、空いた席は Bot が埋める。
- **PRIVATE** — バイインを選んで部屋を作ると、6 桁の部屋番号と招待 URL が出る。番号か URL で友だちが入り、3 人そろうと始まる。
- **FREEROLL** — 残高が 10 未満の人だけ。1 日 3 回、賞金 500。
- **RANKING** — 持っているチップの数。半年ごとのシーズン制で、上位は殿堂入りとして残る。

完全無料のプレイマネーです。チップは購入・換金・譲渡・景品交換ができません。課金・広告はありません。

## 安全とプライバシー

### ひと目で

- **ほかの人に、あなたの手札は見えません。** 山札も見えません（ショーダウンで公開された札を除く）。
- **チップの残高や対局の結果を、ブラウザから書き換えることはできません。** ルールの判定も札を配るのもサーバーが行います。
- **課金・広告・アクセス解析はありません。** このサイト以外のスクリプトは動かない設定です。
- **日本国内からのアクセスだけを受け付けます。**
- **ここに書いたことは、自動の確認で確かめ続けています。** 結果は誰でも見られます（上のバッジ）。

一方で、**運営者は Google アカウントの情報（メールアドレス・氏名・プロフィール画像）と、対局の中身（山札・全員の手札）を見ることができます。** ログインの仕組み（Neon Auth）がアカウントの情報をサーバーのデータベースに保存し、サーバーが対局を進めるためです。運営者を信頼できる相手と遊ぶアプリです。

以下は、その詳しい中身と根拠です。

### 扱う情報の一覧

| 情報 | サーバーに保存されるもの | 運営者が見られるか | ほかの参加者に見えるか |
|---|---|---|---|
| メールアドレス・Google の表示名（氏名）・プロフィール画像 | 保存する（ログインの仕組み Neon Auth が保存する） | 見られる | 見えない（画面にはニックネームだけを出す） |
| Google のトークン | 保存する（同上） | 見られる | 見えない |
| ログインしたときの IP アドレス・ブラウザの種類 | 保存する（同上。ログインのセッションの記録） | 見られる | 見えない |
| Google がアカウントごとに発行する番号 | 保存する（次のログインで同じ人だと見分けるため） | 見られる | 見えない |
| ニックネーム（最初はランダム。自分で変えられる） | 保存する | 見られる | 見える（卓・ランキング・殿堂入り） |
| チップの残高・その日の FREEROLL の回数 | 保存する | 見られる | ランキングに残高が出る |
| 対局の記録（進行中の山札・全員の手札を含む） | 保存する（最後の動きから 7 日で消える） | 見られる | 自分の手札と、公開された札だけ |
| PRIVATE の部屋（部屋番号・参加者） | 保存する（1 日で消える。参加の受付は作ってから 10 分まで） | 見られる | 同じ部屋の人に見える |
| 殿堂入り（シーズンの上位のニックネームと残高） | 保存する（消さない） | 見られる | 見える |
| 18 歳以上の確認・テーマ・音の設定 | **保存しない**（自分の端末にだけ置く） | 見られない | 見えない |

外部のサービスに届くもの：

- **Google** — ログインするとき。画面の文字（フォント）を Google Fonts から読み込むので、開いたときに接続の情報（IP アドレスなど）が Google に届く。
- **Cloudflare**（サイト）・**Neon**（サーバーとデータベース・ログインの仕組み） — 通信を中継するので、接続の情報（IP アドレスなど）が届く。Cloudflare は接続元の国を判定し、日本以外からの接続を断る。

### 期待できること・できないこと

期待できること：

- ほかの参加者に、山札や自分の手札を見られない。Bot も、人と同じく自分の席から見えるものだけで判断する。
- 自分のチップの残高・対局の結果を、ほかの人や自分のブラウザから書き換えられない。
- 他人になりすまして操作されない（ログインした本人のトークンが無いと、サーバーは何もしない）。
- ほかのサイトに埋め込まれて、気づかないうちに操作させられることがない。

期待できないこと（限界）：

- **運営者はアカウントの情報と対局の中身を見られる。** メールアドレス・氏名・画像・ログインの IP アドレス、山札・全員の手札はサーバーのデータベースにあり、運営者は読める。
- **部屋番号か招待 URL を知っている人は、誰でも入れる。** 番号は 6 桁で、合言葉は無い。番号を総当たりで試すことへの回数の制限はまだ無い（受付が 10 分で閉じるだけ）。
- **リクエストの回数の制限はまだ無い。** 連打への備えは、外部のサービス（Cloudflare・Neon）の側にあるものだけ。
- **国内限定は、接続元の国の判定による。** VPN などで国外から入ることは防げない。
- **知り合い同士が示し合わせて、わざと負けてチップを移すことは、仕組みでは止めきれない。** 利用規約で禁止している。
- **外部のサービス（Google・Cloudflare・Neon）がどう扱うかは、それぞれの規約による。**
- **第三者による監査は受けていない。** 個人で運営していて、確かめているのは下の自動の確認だけ。

### 仕組みと根拠

想定している相手は、手札を覗こうとしたりチップを増やそうとしたりするほかの参加者、部屋に入り込もうとする知らない人、そして Web の一般的な攻撃です。ブラウザは信用しません。ルールの判定も札を配るのもサーバーが行い、ブラウザには本人が見てよいものだけを送ります。

| 守ること | 仕組み | 根拠 |
|---|---|---|
| 手札と山札を見せない | ほかの人の手札と山札はブラウザに送らない。Bot もこの見え方だけで判断する | [src/view.js](src/view.js)（`viewFor`）・[src/bot.js](src/bot.js) |
| チップと結果を書き換えさせない | データベースの表はブラウザから直接読み書きできない。ブラウザが呼べるのは決まった関数だけで、本人の分だけを返す。対局を進めるのはサーバー（Function "game"）だけ | [20261004000000_init.sql](db/migrations/20261004000000_init.sql)・[server/game/db.js](server/game/db.js)。本番で表を直接読めないことを確かめる [scripts/live-check.mjs](scripts/live-check.mjs) |
| ログインした本人だけが操作できる | サーバーがリクエストごとに、ログインの署名・発行元・期限を確かめる。通信に使うトークンは、ページを開いている間だけメモリに持ち、ブラウザの保存領域には置かない | [server/game/index.js](server/game/index.js)・[src/net.js](src/net.js) |
| ほかのサイトからサーバーを使わせない | サーバーはこのサイトからの通信だけを受け付ける（CORS） | [server/game/handler.js](server/game/handler.js)・[scripts/deploy-game.mjs](scripts/deploy-game.mjs) |
| ほかの人の名前で画面を乗っ取られない | 表示する前に無害化する。さらに、このサイト以外のスクリプトは動かない設定にしている | [src/ui/util.js](src/ui/util.js)（`esc`）・[public/_headers](public/_headers) |
| 札の並び・倍率・部屋番号を予測されない | 予測できない乱数を使う | [src/rnd.js](src/rnd.js) |
| 日本国内からだけ受け付ける | 接続元の国が日本でなければ、案内（403）だけを返す。案内にも同じ保護ヘッダを付ける | [functions/_middleware.js](functions/_middleware.js) |
| ログインの Cookie をこのサイトのものにする | ログインの通信をこのサイト経由で中継し、Cookie をこのサイトのものに書き換える。中継するのは決まった 5 つの道だけ | [src/authProxy.js](src/authProxy.js)・[functions/api/auth/[[path]].js](functions/api/auth/%5B%5Bpath%5D%5D.js) |
| 鍵やパスワードを漏らさない | リポジトリには置かず、GitHub の Secrets に置く。データベースの接続文字列は、使うときに取り出して表示しない | [scripts/neon.mjs](scripts/neon.mjs) |

### 自動の確認

このページの上のバッジは、次の確認に通っていることを示します（安全を保証するものではありません）。

| 確認 | 何を確かめているか | いつ |
|---|---|---|
| [CI](https://github.com/satsuki19980613/Multiplier/actions/workflows/ci.yml) | テストとビルド。データベースを使う結合テスト（ブラウザから表を読めないこと・マッチング・対局・賞金・ランキング・シーズンの更新）も含む | コードを変えるたび |
| [Live](https://github.com/satsuki19980613/Multiplier/actions/workflows/live.yml) | 本番：日本国外からの接続が断られ、その応答に保護ヘッダが付いているか。サーバーがトークン無し・偽のトークン・ほかのサイトからの通信を断るか。データベースの表を直接読めないか。開発用の環境：本物のデータベースで結合テスト | 毎週と、手動で |
| [CodeQL](https://github.com/satsuki19980613/Multiplier/actions/workflows/codeql.yml) | GitHub 公式のコードスキャン（危ない書き方が無いか） | コードを変えるたびと毎週 |
| [Mozilla HTTP Observatory](https://developer.mozilla.org/en-US/observatory/analyze?host=multiplier-poker.pages.dev) | 公開しているサイトの保護ヘッダ | リンク先でいつでも測り直せる |

### 問題を見つけたら

[SECURITY.md](SECURITY.md) を見てください。このリポジトリの Security タブから、公開されない形で運営者に知らせることができます。

### この節の書き方について

読む人が確かめやすいよう、次の考え方に沿って書いています。

- **大事なことを先に短く、詳しいことは後ろに**（英国の個人情報保護機関 ICO の「[段階的に示す](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-methods-can-we-use-to-provide-privacy-information/)」考え方）
- **扱う情報を決まった形の表にする**（カーネギーメロン大学の[プライバシーの「栄養成分表示」の研究](https://doi.org/10.1145/1753326.1753561)。Apple や Google のアプリストアの表示も同じ考え方）
- **期待できること・できないことを両方書き、想定する相手と対策の根拠を示す**（[OpenSSF Best Practices](https://www.bestpractices.dev/en/criteria/1) の基準）
- **知らせ方を用意し、動かしている検査を示す**（[GitHub のリポジトリのベストプラクティス](https://docs.github.com/en/repositories/creating-and-managing-repositories/best-practices-for-repositories)）

## 開発

- 開発：`npm install && npm run dev` → http://localhost:5180/?fake （サーバー無しで全画面を確認）
- テスト：`npm test`
- サーバーの更新（GitHub Actions → Neon）：Actions の「Deploy server」→ Run workflow（[.github/workflows/deploy-server.yml](.github/workflows/deploy-server.yml)）
- 設計：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)・調査と仕様の根拠：[docs/research/](docs/research/README.md)
