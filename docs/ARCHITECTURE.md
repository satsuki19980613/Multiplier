# Multiplier — アーキテクチャと実装契約

モジュール間のインターフェースはこの文書で固定する。実装を並列で進めるときはこれに従い、変える場合はこの文書を先に更新する。
仕様の根拠は [docs/research/](research/README.md) を参照。

## 0. 全体像

```
ブラウザ (Vite + 素のJS)                         Cloudflare Pages
  index.html / src/main.js / src/style.css        functions/_middleware.js   … 日本国内以外のアクセスを遮断（JP限定）
  src/net.js  ── /api/auth/* ──────────────────▶  functions/api/auth/[[path]].js … Neon Auth への中継
             ── Data API RPC (読み取り) ──────▶  Neon Postgres（RLS有効・RPC関数のみ公開）
             ── Function "game" (書き込み) ───▶  Neon Function server/game/index.js
共有ロジック: src/engine.js（ルール）/ src/spin.js（設定・倍率）/ src/view.js（見せてよい情報）/ src/bot.js（Bot）
開発専用: src/fakeNet.js（?fake でサーバー無しに全画面を確認。本物の server/game/rules.js と bot をブラウザで動かす）
```

- ルールは `src/engine.js` にだけ実装する（サーバーとブラウザで二重に実装しない）。
- サーバーが権威を持つ。山札と他席のホールカードはブラウザに送らない（`viewFor`）。
- 同期は HTTP ポーリング。常駐プロセスは無いので、ブラインドの上昇・Bot の手番・時間切れはすべて遅延評価で処理する。

## 1. カード

- 整数 `0..51` で表す。`rank = c >> 2`（0='2' … 12='A'）、`suit = c & 3`（0♠ 1♥ 2♦ 3♣）。grid-holdem・`tools/bot-solver` と同じ。
- 文字列表記は `'A♠'` など。`RANKCH='23456789TJQKA'`。

## 2. `src/spin.js` — 共通の設定（エンジン担当）

```js
export const START_CHIPS = 10000;
export const STAKES = {            // key は API でも使う。どれも最初から解放（残高 ≥ buyIn で参加できる）
  low:     { buyIn: 10 },
  mid:     { buyIn: 100 },
  high:    { buyIn: 1000 },
  ultra:   { buyIn: 2000 },
  extreme: { buyIn: 3000 },
};
export const FREEROLL = { prize: 500, perDay: 3, eligibleBelow: 10, stack: 500, levelMs: 120000 };
// 1位総取り。各行は [倍率, 1,000万回あたりの出現数]。合計は 10,000,000、E[倍率] = 3.0（docs/research/03-economy.md §4）
// 最高賞金は low〜ultra が 100,000、extreme だけ 3,000,000（ハイリスク・ハイリターン）
export const MULTIPLIERS = {
  low:  [[10000,30],[1000,300],[100,3000],[25,20000],[10,100000],[5,300000],[4,800000],[3,5346660],[2,3430010]],
  mid:  [[1000,300],[100,3000],[25,20000],[10,100000],[5,300000],[4,800000],[3,5646600],[2,3130100]],
  high: [[100,5000],[25,20000],[10,100000],[5,300000],[4,800000],[3,5750000],[2,3025000]],
  ultra: [[50,10000],[25,20000],[10,100000],[5,300000],[4,800000],[3,5760000],[2,3010000]],
  extreme: [[1000,1000],[100,10000],[25,40000],[10,150000],[5,400000],[4,800000],[3,3102000],[2,5497000]],
};
export function drawMultiplier(stake, rnd)   // rnd: () => [0,1)。倍率（整数）を返す
export function structureFor(multiplier)     // => { stack, levelMs }。倍率 null（フリーロール）は FREEROLL の stack/levelMs
//   2x: 300/60s, 3x: 300/120s, 4x: 400/120s, 5x: 400/180s, 10x・25x: 500/180s, 100x 以上: 500/300s
export const BLINDS = [[10,20],[15,30],[20,40],[30,60],[40,80],[50,100],[60,120],[75,150],[90,180],[100,200],
  [125,250],[150,300],[200,400],[250,500],[300,600],[400,800],[500,1000],[600,1200],[800,1600],[1000,2000],
  [1250,2500],[1500,3000],[2000,4000],[2500,5000],[3000,6000]];   // 最終レベル以降は据え置き。アンテなし
export function seasonOf(date)               // => { id: 'YYYY-H1'|'YYYY-H2', startsAt, endsAt }（JST の 4/1・10/1 で区切る）
```

## 3. `src/engine.js` — 3人 NLHE トーナメントのエンジン（純粋関数・決定論的）

### 公開 API

```js
export class EngineError extends Error { code }          // code: 'illegal' | 'not_your_turn' | 'game_over'
export function newGame({ stack, levelMs, now, rnd, names }) // => g。3席。ボタンは rnd で決める。第1ハンドを配る（ブラインドは levelAt(now) で決まる）
export function actor(g)                                  // => 行動する席 | null（終局時）
export function legalActions(g)                           // => null | { seat, street, toCall, canCheck, canCall, callAmount,
                                                          //             minRaiseTo, maxRaiseTo, pot }（raise 不可なら min/max は null）
                                                          //    ※ 山札（g.deck）を使わずに計算できること（ビューでも呼ぶため）
export function applyAction(g, seat, move, now)          // move: { type: 'fold'|'check'|'call'|'raise', to?: int }
                                                          //   to = そのストリートで自分が出す合計額（「to」方式）。all-in は to = 自分の残り全部
                                                          //   違法なら EngineError を投げる。成功したら g.ver++
export function autoAction(g, seat, now)                  // 時間切れの代打：check できれば check、できなければ fold
export function forfeit(g, seat, now)                    // リタイア：その席は即座に卓から抜ける（いつでも・手番でなくても可。違法なら EngineError 'game_over' | 'illegal'(すでに脱落)）
export function levelAt(g, now)                           // => その時刻のブラインドレベル番号（BLINDS の添字）
export function eval7(cards)                              // 5〜7枚 => 整数スコア（大きいほど強い）
export function handName(score)                           // => 'Full House' など（英語）
export { RANKCH, SUITCH, cardStr }                        // 表記用
```

### 状態 `g`（JSON で保存できる plain object）

```js
{
  ver,                         // 状態が変わるたびに +1
  startedAt, levelMs,          // レベル = floor((ハンド開始時刻 - startedAt) / levelMs)。レベルが変わるのは次のハンドから
  level, sb, bb,               // 現在のハンドのブラインド
  names: [n0, n1, n2],
  seats: [{ stack, out }],     // out = 脱落済み
  button, handNo,
  deck,                        // サーバーのみ（viewFor で削除）
  holes: [[c,c] | null, ...],  // 他席の分は viewFor で null にする
  board: [],                   // 0, 3, 4, 5 枚
  street,                      // 'preflop' | 'flop' | 'turn' | 'river'
  toAct,                       // 行動する席 | null
  bet: [b0,b1,b2],             // このストリートで出した額
  total: [t0,t1,t2],           // このハンドで出した合計（ポット計算用）
  folded: [bool x3], allIn: [bool x3],
  currentBet, minRaise,        // 現在の最高額 / 最小レイズ幅（直前のフルレイズ幅。最低 bb）
  lastHand: null | {           // 直前に終わったハンド（UI の演出用）
    handNo, board, shown: [[c,c]|null x3],      // showdown まで残った席のホールのみ
    pots: [{ amount, eligible: [seats], winners: [seats] }],
    names: [handName|null x3], net: [delta x3], busted: [seats], endedAt
  },
  places: [p0,p1,p2],          // 確定した順位（1〜3）。未確定は null
  forfeited,                   // リタイアした席の持ち越しスタックの合計（卓から消えたチップ）。不変条件: sum(stacks)+sum(total)+forfeited === 3*startStack
  over, winner,                // 終局フラグと優勝した席
  log: [{ text }],             // '{0}' '{1}' '{2}' は席番号のプレースホルダ（view.js の logText で名前に置換）
}
```

### ルール（標準の NLHE トーナメント）
- 席は時計回りに 0→1→2。脱落した席は飛ばす。3人：ボタン→SB→BB。BB の次の席（＝ボタン）からプリフロップを始める。ポストフロップは SB から（ボタンの次の生存席）。
- **ヘッズアップ**：ボタンが SB を払い、プリフロップは先に行動し、ポストフロップは後に行動する。ボタンは毎ハンド次の生存席へ移る。
- ブラインドを払えない場合は全額を出して all-in。
- No Limit。最小レイズ額＝直前のフルレイズ幅（最低 bb）。all-in が最小レイズに満たない場合は、すでに行動した席にレイズの権利を再び与えない。
- 全員 all-in（または1人以外が all-in）になったら、ボードを最後まで自動で配る。
- **サイドポット**を正しく分ける。同点は等分し、端数のチップはボタンの左から順に配る。コールされなかった超過分は本人に返す。
- ハンドが終わったら `lastHand` を記録し、スタック 0 の席を脱落させる。同じハンドで2人が飛んだ場合は、ハンド開始時のスタックが多い方を上位にする（同じなら席番号の若い方）。生存者が1人になったら `over=true` と `winner` を立てる。そうでなければ次のハンドを自動で配る（その時点の `now` でレベルを決める）。
- `rnd` は `newGame` の引数でのみ受け取り、状態にシードを持たせて続きを再現できるようにする（例：`g.seed` から xorshift で次の山札を作る）。テストで固定シードを使えるようにするため。

## 4. `src/view.js`

```js
export function viewFor(g, seat)   // 削除するもの：deck、seed、他席の holes（null にする）。lastHand.shown はそのまま
export function logText(entry, mySeat, names)  // '{n}' を自分なら 'YOU'、他なら名前に置換
```

## 5. `src/bot.js` — Bot（Bot 担当。スタブから差し替える）

```js
export const PERSONAS = ['tight', 'loose', 'aggro'];
export function botMove(view, seat, { persona, rnd })   // => move（applyAction に渡せる形）。必ず合法手を返す
```
- 見てよいのは `view`（`viewFor(g, seat)`）だけ。他席のカードは見ない。
- 戦略：12bb 以下は `tools/bot-solver/export` の Nash 表を使う（`src/bot/` にコピーして同梱）。12bb 超は強さ順の帯で判断し、ポストフロップはレンジ推定とモンテカルロ計算とルールで判断する（docs/research/05-bot.md）。

## 6. サーバー（Neon Function `game`）

### `server/game/rules.js`（純粋関数。fakeNet からも使う）
```js
export const TURN_MS = 15000, TIMEBANK_MS = 30000, GRACE_MS = 1500, REVEAL_MS = 3500, WHEEL_MS = 6000;
export const BOT_WAIT_MS = 15000, QUEUE_FRESH_MS = 6000, SITOUT_MS = 1500, MAX_STRIKES = 2;
export const BOT_THINK_MS = [900, 2600];             // Bot の思考時間（一様乱数）
export class MoveError extends Error { code, extra }
export function createTable({ players, stake, now, rnd })
//   players: [{ uid|null, name, bot: null | { persona } } x3]。stake: 'low'|'mid'|'high'|'ultra'|'extreme'|'free'
//   => { state, meta }。倍率は drawMultiplier（free は null）、prize = buyIn * multiplier（free は FREEROLL.prize）
export function applyRequest(game, seat, req, now)   // req: { op:'act', ver, move }。=> { state, clock }
export function tick(game, now, { botMove, rnd })    // Bot の手番で botAt を過ぎていれば Bot を1手進める。人間の deadline+GRACE を過ぎていれば autoAction（strike+1）
                                                    //   何も進まなければ MoveError('not_yet')。=> { state, clock }
export function viewsOf(state, meta)                 // => 3席分のビュー（各 { ...viewFor(state, seat), meta: { ...meta, seat } }）
export function settle(state, meta)                  // 終局時：=> { payouts: [chips x3], result }（人間の優勝者に prize。Bot の分は 0）
```
- `clock`（meta に入れる）：`{ turnStart, deadline, timebank: [ms x3], strikes: [x3], botAt }`
  - 締め切り（deadline）＝ turnStart + TURN_MS + timebank[seat]。実際の行動で TURN_MS を超えた分を timebank から引く。
  - ハンドが終わった直後は REVEAL_MS を、開始直後はルーレット演出の WHEEL_MS を、締め切りに足す。
  - strikes が MAX_STRIKES に達した席は sit-out になり、手番が来たら SITOUT_MS 後に代打で処理する（本人が行動すれば strikes は 0 に戻る）。

### HTTP（`server/game/handler.js`。POST のみ、Bearer JWT 必須）
| op | body | 返り値 |
|---|---|---|
| `queue` | `{ stake: 'low'\|'mid'\|'high'\|'ultra'\|'extreme'\|'free' }` | `{ waiting: {low,mid,high,ultra,extreme,free}, since, game: id\|null }`。待機登録（同じ stake のキューを更新）を行い、成立すれば卓を作る |
| `leave` | `{}` | `{ ok: true }`。キューから抜ける |
| `act` | `{ game, ver, move }` | `{ ver, now, view }` |
| `retire` | `{ game }` | `{ ver, now, view }`。自分の席をリタイア（手番でなくても可。バイインは戻らず、賞金なし）。終局済みは 409 `game_over`、自席の順位が確定済みは 409 `already_out`、席が無ければ 404 `not_found` |
| `tick` | `{ game }` | `{ ver, now, view }`（何も進まなければ 409 `not_yet`） |

**マッチング**（`queue` の中で、stake 単位の advisory lock を取る）：
1. 参加資格を確認する。
   - low / mid / high / ultra / extreme：残高 ≥ buyIn。
   - free：残高 < 10 かつ今日（JST）の使用回数 < 3。
   - 進行中の卓があればその id を返す。
2. 新鮮な（seen_at が 6 秒以内の）待機者が 3人いれば、到着順に 3人で卓を作る。
3. 呼び出した人の待機時間が BOT_WAIT_MS を超えたら、いる人間に Bot を足して 3人にする。
4. 卓を作るときは、同じトランザクションで次を行う。
   - バイインを引き落とす。
   - free の場合は使用回数を +1 する。
   - 待機者をキューから削除する。
   - `games` に INSERT する。

**終局**：`settle` の払い戻しを profiles.chips に加算する（同じトランザクション内で）。

## 7. DB（`db/migrations/*.sql`、追加のみ）

| 表 | 列 |
|---|---|
| `profiles` | uid（PK、neon_auth.user を参照）、nickname（1〜16、大文字小文字を無視して一意）、chips bigint default 10000、freeroll_day date、freeroll_used int、created_at |
| `queue` | uid（PK）、stake text、since、seen_at |
| `games` | id、players uuid[3]（Bot の席は null）、stake、multiplier、prize、status（'active'\|'over'）、state jsonb、ver、views jsonb（3要素の配列）、deadline_ms、bot_at_ms、winner、created_at、updated_at |
| `seasons` | id text（'2026-H2' など）、starts_at、ends_at、closed bool |
| `hall_of_fame` | season、rank、nickname、chips（上位10人。記録のみ） |

Data API RPC（`authenticated` にのみ公開。表は直接触らせない）：
- `me()` → `{ nickname, chips, freeroll: { used, left, eligible }, game, season: { id, endsAt } }`。初回呼び出しでプロフィールを作る。古いゲームの削除と `season_rollover()` も行う。
- `set_nickname(p_name)` → `{ nickname }`
- `game_poll(p_game, p_ver)` → `{ ver, now, view|null }`
- `ranking()` → `{ season, top: [{ rank, nickname, chips, me }], me }`（上位100人。チップの多い順）
- `hall_of_fame()` → `[{ season, top: [{ rank, nickname, chips }] }]`
- `season_rollover()`（内部用）：ends_at を過ぎていたら、上位10人を hall_of_fame に記録する。次に全員の chips を 10000 に戻し、freeroll の回数を 0 に戻す。最後に次のシーズンを作る。advisory lock で1回だけ実行する。

## 8. UI（`index.html` / `src/main.js` / `src/style.css`）

- **メニュー**：PLAY / FREEROLL / RANKING の3つ。上部にアカウント（ニックネーム、チップ）を出す。未ログイン時は Google ログインと注意書きを出す。
- **PLAY**：ステークス（10 / 100 / 1,000）を選ぶ → 待機画面（待機人数、最大 15 秒のカウントダウン、キャンセル）→ ルーレット（倍率と賞金、約 6 秒、タップでスキップ）→ テーブル。
- **テーブル**：3席（自分は下、相手は左上と右上）、コミュニティカード、ポット、ディーラーボタン、各席のスタックとベット、ブラインドレベルと次のレベルまでの時間、倍率と賞金の表示、ターンタイマー、Bot は 🤖 で表示。
- **操作**：Fold / Check / Call / Raise。Raise はスライダーに加えて、プリフロップは 2x / 2.5x / 3x / All-in、ポストフロップは 1/3 / 1/2 / 2/3 / Pot / All-in のクイックボタン。
- **結果**：順位、獲得チップ、残高。「もう一度」で同じステークスの待機に入る。
- **RANKING**：今シーズン（残り日数）と殿堂入りのタブ。
- **ルールのモーダル**：ストラクチャー、倍率と確率の表、フリーロールの条件。
- **フッター**：常に注意書きを表示し、利用規約・プライバシーポリシーへのリンクを置く。初回は 18 歳以上であることの確認を求める。
- grid-holdem のデザイン規約を引き継ぐ：直角、YOU #336B87、相手 #FE7A47、ライト／ダーク、ガラス質感、`fitTable` による実測フィット。

## 9. 法務の実装（docs/research/02-legal.md）
- `functions/_middleware.js`：`request.cf.country` が `JP` 以外なら 403 と日英の案内を返す（`cf` が無い開発環境では通す）。
- `public/terms.html`、`public/privacy.html`：運営者名や連絡先など、さつきが決める部分は【】のプレースホルダにする。
- アプリ内には、他社のポーカーサイトの名称、外部の賭博サイトへのリンク、「本番」「稼ぐ」のような語を一切出さない。

## 10. 実装で確定した細部（2026-10-04 結合時に追記）

- **engine**
  - `applyAction` / `autoAction` は `g` をその場で書き換え、`g` を返す。違法な手は `EngineError` を投げ、このとき状態は変わらない。
  - `newGame` は任意の `stacks`・`button` を受け取る。
  - 状態に `seed`（ChaCha20 の鍵、uint32×8）・`ctr`・`handAt`・`handStart`・`needAct`・`seen`・`lastHand.uncalled` を追加した。`viewFor` は `deck`・`seed`・`ctr` を消す。
  - `handName` は役名だけを返す。
- **spin**: `seasonOf(...)` の `startsAt` / `endsAt` は `Date`。1〜3月は前年の H2 として扱う。
- **リタイア**（2026-10-04）: `forfeit(g, seat, now)` はその席のハンドを即 fold（手番なら通常の fold。すでに出したチップはデッドマネーとして他の席に残り、コールされなかった超過分は生きている席にだけ返す）、残りスタックを `g.forfeited` に移し、`seats[seat].out = true`・順位は「まだ空いている一番下」（3人生存なら3位、ヘッズアップなら2位）。生存者が1人になれば終局。UI はテーブルからメニューへ戻る導線を持たず（着席中に抜けられるのは Retire か決着のみ）、`me().game` がある（着席中の）ときはメニューを描かずに卓へ自動復帰する。
- **server**
  - DB の `games.state` は `{ g, meta }`。Bot の persona は meta にだけ持ち、ビューには出さない。
  - ビューの `meta` は `{ stake, buyIn, multiplier, prize, bot:[bool×3], clock, result, seat }`。
  - `result` は `{ places, winner, payouts, after:[残高|null×3], ... }`。
  - `queue` の返り値に `now` を含める。
  - `profiles.played`: 今シーズンに1戦以上したか。ランキングの対象条件で、シーズンが変わると 0 に戻る。
  - 「自分の進行中の卓」は、status が active で、かつ自分の順位が未確定の卓に限る。人間が全員脱落したら、その卓はすぐに終局させる。
  - フリーロールの閾値は `me()` の SQL にも書いてある。`spin.js` の値を変えたら SQL も合わせる。
- **ビルド**: フォルダ名の `&` が npm の .cmd ラッパーを壊すため、npm scripts は vite を `node node_modules/vite/bin/vite.js` で直接起動する。
