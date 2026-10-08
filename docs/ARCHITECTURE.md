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
              src/tview.js（卓のビューへの写し）/ src/pace.js（遷移・演出の間）/ src/fx.js・src/chat.js（演出 GIF・チャットの決まり）
卓の画面: PrivateMatch（satsuki19980613/privatematch）から移した（src/ui/table.js・chat.js・player.js・ingame.js・stats.js・settings.js・gif.js・fxshow.js、
          src/history/*。2026-10-08 さつき「プレイ画面を完全に移植」）
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

### ハンドの記録（2026-10-08。卓の画面・ハンド履歴のため）
- `g.actions`：今のハンドのアクション `[{ seat, kind, betTo, put, auto, street }]`（ブラインドは含めない）。kind は fold / check / call / bet / raise / allin
  （最後のチップを入れたアクションは allin）。betTo はその街の自分の合計（fold / check は直面していた額）、put は足した額、auto は代打（時間切れ・リタイア）、street は 0〜3。
- `g.sbSeat` / `g.bbSeat`、`g.runFrom`（動ける席が 1 人以下になって残りのボードを配り始めたときのボードの枚数）。
- `g.lastHand` に足したもの：`startedAt, level, sb, bb, btn, sbSeat, bbSeat, start（開始スタック）, commits（拠出。返却前）, won（取り分。返却分を含むので net = won − commits。ハンド中にリタイアした席だけは net に没収したスタックも入る）,
  hole（全員の手札。viewFor が隠す）, folded, allIn, actions, runFrom（ショーダウンのとき。普通のショーダウンは 5、フォールドで終われば null）, eliminated: [{ seat, place }], retired（このハンド中にリタイアした席）`。
- `g.prevHands`：lastHand の前の 4 ハンド（古い順）。短いスタックではブラインドだけでオールインになったハンドが同じ手で続けて終わるので、画面と記録が全部のハンドを拾えるように残す。

## 4. `src/view.js`

```js
export function viewFor(g, seat)   // 削除するもの：deck、seed、他席の holes（null にする）。lastHand.shown はそのまま。
                                   // lastHand.hole と prevHands[].hole は自分の札と公開された札だけ
export function logText(entry, mySeat, names)  // '{n}' を自分なら 'YOU'、他なら名前に置換
```

## 4.5 `src/tview.js` — 卓のビュー（2026-10-08）
Multiplier のビュー（viewsOf）を、PrivateMatch から移した卓の画面・ペース・ハンド履歴が読む形（卓のビュー）に写す。純関数。
```js
export function tableViews(mv, settledNo)  // => { views, settledNo }。新しく終わったハンドごとに精算済みのビュー（ver − 0.5、2 つ以上なら 0.1 刻みで小さく）を
                                            //    今のビューの前に挟む。終局なら最後は精算済みの最後のハンド（status 'finished'）。決着せずに終局した（リタイア・Bot だけ）なら hand = null
export function liveView(mv) / settledView(mv, ver, lh) / settledHand(lh)
export function legalOf(mv)                 // 卓の形の合法手 { canFold, canCheck, toCall, callPut, minTo, maxTo, aggression, pot, streetLastBetTo }
export function toMove(move, legal)         // 卓の操作（allin を含む）→ エンジンの move（allin は最大額への raise、できなければ call）
export function recordOf(lh)                // ハンド履歴の記録（PrivateMatch の handRecord の rec と同じ形）。サーバーが game_hands に保存する
export const ptOf = (meta, place)           // その試合の収支（1 位は賞金 − buy-in、ほかは − buy-in）。STATS の「pt」
```
卓のビュー：`{ ver, seat, n: 3, names, status: 'running'|'finished', startedAt, levelMs, endedAt, winner, handNo, players: [{ stack, status: 'active'|'sitout'|'out', place, pt }],
hand: { handNo, level（1 始まり）, sb, bb, ante: 0, btn, sbSeat, bbSeat, street, hole, board, startStacks, commits, streetBet, folded, allIn, toAct, streetLastBetTo, lastBetSize,
actions, turnStart, deadline, phase: 'betting'|'settled', won, shown, names, pots, eliminated, runFrom, startedAt, endedAt }, legal, room: { code, kind: 'play'|'private'|'free' },
config: { mode: ステークス, players: 3 }, fx, rematch, meta }`。sitout は strikes ≥ MAX_STRIKES。持ち時間のバーは人の手番だけ。

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
export const MATCH_HUMANS = 2;
export const BOT_WAIT_MS = 15000, QUEUE_FRESH_MS = 6000, SITOUT_MS = 1500, MAX_STRIKES = 2;
export const BOT_THINK_MS = [900, 2600];             // Bot の思考時間（一様乱数）
export class MoveError extends Error { code, extra }
export function createTable({ players, stake, now, rnd, room })   // room: プライベート卓の部屋番号（キューからは null）
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

### 卓の画面のための追加（2026-10-08）
- **見せる時間**：ハンドが終わったら、次の手番の持ち時間は `revealMsOf(h, fx) = REVEAL_MS + runoutMs(h.runFrom) + (勝者の GIF があれば FX_MS)` の合計だけ遅れて始まる
  （同じ手で終わった全部のハンドの分。`finishedHands(before, state)`）。`src/pace.js` の RUNOUT / FX は卓の演出と同じ値。
- **離席**：`{ op:'sitout' }` は strikes を MAX_STRIKES に（手番中なら SITOUT_MS で代打）、`{ op:'sitin' }` は 0 に戻し、手番中なら持ち時間を戻す。どちらも ver + 1。
- meta だけを変える手（離席・GIF・stay / depart・再戦の開始）も ver + 1 するが、`act` は `meta.moveVer`（最後にプレイが変わった ver。`commit` が持つ）以上の ver なら受け付ける（離席やチャットで手番の人の操作が stale にならない）。
- **演出 GIF**（PRIVATE の卓だけ）：`meta.fx = [slug|null ×3]`（部屋の作成・参加で送った値。Bot は null）。`{ op:'fx', fx }` で自分の分を変える（ほかの卓では何もしない）。
  勝者の席は `src/fx.js` の `fxSeat`（ショーダウンで取り分がいちばん多い 1 人。チョップ・フォールドは無し）。
- **再戦**（PRIVATE の卓だけ）：終局で `meta.rematch = { stay, gone, next: null | { id, seats（新しい卓に着いた席）}, hostSeat, endedAt（最後のハンドの終わり。ハンドの途中で決着したらその時刻）, closesAt（+10 分）}`。`{ op:'stay' }` / `{ op:'depart' }`。
  始められるのは `rematchLeader`（作成者が残っているか、終局から 1 分以内でまだ去っていなければ作成者。そうでなければ最初に残った人）。`rematchSeats` が 2 人以上を確かめる。
- **チャット**（PRIVATE の卓だけ）：`postChat(game, seat, text, lastAt, now)` → 正規化した文（`src/chat.js`）。`chat_closed` / `malformed` / `too_fast`（同じ席は 1 秒に 1 回）。
- 終局後の meta だけの変更（stay / depart / fx / 再戦の開始）は払い戻しをしない（`commit` は払い戻しを 1 回だけ）。

### HTTP（`server/game/handler.js`。POST のみ、Bearer JWT 必須）
| op | body | 返り値 |
|---|---|---|
| `queue` | `{ stake: 'low'\|'mid'\|'high'\|'ultra'\|'extreme'\|'free' }` | `{ waiting: {low,mid,high,ultra,extreme,free}, since, game: id\|null }`。待機登録（同じ stake のキューを更新）を行い、成立すれば卓を作る |
| `leave` | `{}` | `{ ok: true }`。キューから抜ける |
| `act` | `{ game, ver, move }` | `{ ver, now, view }` |
| `retire` | `{ game }` | `{ ver, now, view }`。自分の席をリタイア（手番でなくても可。バイインは戻らず、賞金なし）。終局済みは 409 `game_over`、自席の順位が確定済みは 409 `already_out`、席が無ければ 404 `not_found` |
| `tick` | `{ game }` | `{ ver, now, view }`（何も進まなければ 409 `not_yet`） |
| `sitout` / `sitin` | `{ game }` | `{ ver, now, view }` |
| `fx` | `{ game, fx }` | `{ ver, now, view }`（終局後も可） |
| `stay` / `depart` | `{ game }` | `{ ver, now, view }`（PRIVATE の終局後。`room_closed`） |
| `rematch` | `{ game }` | `{ game: 新しい卓, now }`（残った人の profiles をロックし、別の卓に着いている人・残高不足の人を除いて 2 人以上。buy-in を引く。`not_host`・`not_enough`・`room_closed`・`in_game`） |
| `chat` | `{ game, text }` | `{ now, msg: { seq, seat, text, at } }`（ゲームの ver は変えない。`chat_closed`・`chat_full`（2000 件）409、`too_fast` 429） |

**マッチング**（`queue` の中で、stake 単位の advisory lock を取る）：
1. 参加資格を確認する。
   - low / mid / high / ultra / extreme：残高 ≥ buyIn。
   - free：残高 < 10 かつ今日（JST）の使用回数 < 3。
   - 進行中の卓があればその id を返す。
2. 新鮮な（seen_at が 6 秒以内の）待機者が MATCH_HUMANS（= 2）人以上いれば、すぐに卓を作る（到着順に最大 3人。足りない席は Bot）。
3. 呼び出した人の待機時間が BOT_WAIT_MS を超えたら（1人のまま）、Bot 2人を足して 3人にする。
4. 卓を作るときは、同じトランザクションで次を行う。
   - バイインを引き落とす。
   - free の場合は使用回数を +1 する。
   - 待機者をキューから削除する。
   - `games` に INSERT する。

**終局**：`settle` の払い戻しを profiles.chips に加算する（同じトランザクション内で）。

### プライベート卓（`server/game/rooms.js`。純粋関数。fakeNet からも使う。2026-10-08）
```js
export const ROOM_SEATS = 3, ROOM_MIN_START = 2;
export const ROOM_POLL_MS = 2000, ROOM_AWAY_MS = 8000, ROOM_GONE_MS = 120000, ROOM_TTL_MS = 600000;
export const CODE_RE = /^\d{6}$/, ROOM_STAKES = ['low','mid','high','ultra','extreme'];   // free は不可
// room = { id, code, stake, host, members: [{ uid, name, seenAt }]（入った順、作成者が先頭）, status: 'waiting'|'started'|'closed', game, createdAt }
export function genCode(rnd) / newRoom({ id, code, stake, uid, name, now }) / prune(room, now) / joinRoom(room, uid, name, now)
export function touchRoom(room, uid, now) / leaveRoom(room, uid, now) / startReady(room, uid, now, { auto })
export function roomView(room, uid, now)   // 待機室：{ id, code, stake, status, host, members: [{ name, host, me, away }], seats, isHost, expiresAt, game }
export function roomPeek(room, uid, now)   // 参加前：{ code, stake, status, host, seated, seats, member }（uid は出さない）
```
- 待機室は `room_wait` を 2 秒ごとに呼ぶ（これが在席の印）。最後の呼び出しから 8 秒で「離席中」（スマホで招待を別アプリに共有している間はページが止まるため、すぐには外さない）、2 分で部屋から外れる。作成者が外れる・退出する、または作成から 10 分たつと部屋は閉じる。
- 卓が始まるのは、全員が在席していて (a) 3人そろったとき（自動。参加・待機のどちらの呼び出しでも）、または (b) 2人以上で作成者が Start を押したとき（空席は Bot）。始める直前に、別の卓に着席中の人と残高がバイインに足りない人を部屋から外す（作成者が外れたら部屋を閉じ、人数が足りなくなったら待つ）。
- バイインは卓が始まるときに引き落とし、賞金・倍率・ストラクチャーは PLAY と同じ。`meta.room` に部屋番号を入れる（ビューにも出る）。
- 部屋を作る・入るときは、別の卓に着席中なら 409 `in_game`（`game` 付き）、残高不足なら 409 `insufficient_chips`。キューに居れば抜ける。

| op | body | 返り値 |
|---|---|---|
| `room_create` | `{ stake }` | `{ room: roomView, now }`。待機中の部屋の中で一意な番号を引く（衝突したら引き直し） |
| `room_peek` | `{ code }` | `{ room: roomPeek \| null, now }` |
| `room_join` | `{ code }` | `{ room, now }`（すでに居れば今の部屋。3人目なら卓が始まり `room.game` が入る）。`not_found`・`room_full`・`room_closed` |
| `room_wait` | `{ room }` | `{ room, now }`。部屋に居なければ 404 `not_found` |
| `room_start` | `{ room }` | `{ room, now }`。`not_host`・`not_enough`・`away`（409） |
| `room_leave` | `{ room }` | `{ ok: true }` |

## 7. DB（`db/migrations/*.sql`、追加のみ）

| 表 | 列 |
|---|---|
| `profiles` | uid（PK、neon_auth.user を参照）、nickname（1〜16、大文字小文字を無視して一意）、chips bigint default 10000、freeroll_day date、freeroll_used int、created_at |
| `queue` | uid（PK）、stake text、since、seen_at |
| `games` | id、players uuid[3]（Bot の席は null）、stake、multiplier、prize、status（'active'\|'over'）、state jsonb、ver、views jsonb（3要素の配列）、deadline_ms、bot_at_ms、winner、created_at、updated_at |
| `rooms` | id、code（6 桁。status = 'waiting' の中で一意）、stake、host、members jsonb、status（'waiting'\|'started'\|'closed'）、game、created_at、updated_at（待機室の呼び出しごと。2 分呼ばれない部屋は次の room_create で閉じ、1 日で消す） |
| `game_hands` | game（games を参照、一緒に消える）、hand_no、rec jsonb（公開してよい記録）、holes jsonb（全員の手札。RPC は本人の分だけ） |
| `game_chat` | game（同上）、seq、seat、text、created_at。`games.chat_seq` が最新の seq |
| `seasons` | id text（'2026-H2' など）、starts_at、ends_at、closed bool |
| `hall_of_fame` | season、rank、nickname、chips（上位10人。記録のみ） |

Data API RPC（`authenticated` にのみ公開。表は直接触らせない）：
- `me()` → `{ nickname, chips, freeroll: { used, left, eligible }, game, season: { id, endsAt } }`。初回呼び出しでプロフィールを作る。古いゲームの削除と `season_rollover()` も行う。
- `set_nickname(p_name)` → `{ nickname }`
- `game_poll(p_game, p_ver)` → `{ ver, now, view|null, chat }`（chat = 最新の発言の seq）
- `game_hands(p_game, p_after)` → `[rec + { hole（自分の手札）}]`（hand_no > p_after を古い順に 200 件まで）
- `game_chat(p_game, p_after)` → `[{ seq, seat, text, at }]`（新しい方から 200 件を古い順。PRIVATE でなければ []）
- `me()` には `recent: [{ id }]`（3 日以内に打った卓。端末への同期用）も入る
- マイグレーションの後は Data API のスキーマを読み直す（`scripts/db.mjs` が毎回 `neonctl data-api refresh-schema` を実行する）
- `ranking()` → `{ season, top: [{ rank, nickname, chips, me }], me }`（上位100人。チップの多い順）
- `hall_of_fame()` → `[{ season, top: [{ rank, nickname, chips }] }]`
- `season_rollover()`（内部用）：ends_at を過ぎていたら、上位10人を hall_of_fame に記録する。次に全員の chips を 10000 に戻し、freeroll の回数を 0 に戻す。最後に次のシーズンを作る。advisory lock で1回だけ実行する。

## 8. UI（`index.html` / `src/main.js` / `src/style.css`）

- **メニュー**：PLAY / PRIVATE / FREEROLL / RANKING / STATS の5つ。ヘッダの歯車で設定（ベットサイズ・演出 GIF）。上部にアカウント（ニックネーム、チップ）を出す。未ログイン時は Google ログインと注意書きを出す。
- **PRIVATE**：CREATE（ステークスを選ぶ → 待機室）と JOIN（6 桁の部屋番号 → 確認ダイアログ → 待機室）。待機室（`src/ui/room.js`）は部屋番号・招待 URL（Copy / 共有シート）・参加者（HOST・YOU・離席中は薄く）・残り時間・作成者の Start（2人以上・全員が在席）・退出（作成者は部屋を閉じる）。招待 URL `/?room=123456` は sessionStorage に預けてログインの往復をまたぎ、ログイン後に確認ダイアログを開く。待機中にリロードしたら同じ部屋の待機室に戻る。結果の「Play again」は PRIVATE のメニューへ戻る。
- **PLAY**：ステークス（10 / 100 / 1,000）を選ぶ → 待機画面（待機人数、最大 15 秒のカウントダウン、キャンセル）→ ルーレット（倍率と賞金、約 6 秒、タップでスキップ）→ テーブル。
- **テーブル**（PrivateMatch の卓。仕様の詳細は PrivateMatch の docs/ARCHITECTURE.md §8 と同じ）：3席の楕円（自分は下）、金額は BB（スタックを押すとチップ数）、
  情報の行（ブラインドとレベル・NEXT・倍率と賞金）、Bot は「Bot」の印。遷移は `src/pace.js` の順に 1 拍ずつ見せる（action / street / win / showdown / deal）。
  ショーダウンは勝率を出しながらランアウトし、PRIVATE の卓で勝者が GIF を選んでいれば中央に出す（`src/ui/fxshow.js`）。
- **操作**：Fold / Check / Call / Bet・Raise（シート：Min と設定の候補・スライダー・All-in）、Check/Fold の予約、離席 / I'm back。
  ヘッダは着席中 Retire、飛んだ後・終局後は Leave（確かめてからメニューへ）。チャット履歴（PRIVATE だけ）とこの試合のハンド履歴のボタン。
- **プレイヤー**：席を押すと VPIP・PFR・生存ターン（そのステークスの終わった試合）とこの試合の分、相手ならメモと色の印。Bot はこの試合の分だけ。
- **結果**：順位、収支（チップ）、全員の順位、残高。PRIVATE の終局後は「席に残る」→ ドックで REMATCH（始められる人に Rematch）。それ以外は Play again（PLAY は同じステークス、PRIVATE はメニューの PRIVATE）。
- **STATS**：ステークスごとに試合数・平均順位・1位率・収支・平均倍率・直近の成績・HANDS・VPIP・PFR・生存ターン・順位分布・累計収支のグラフ、HAND HISTORY、EXPORT / IMPORT。
  記録はこの端末の IndexedDB `multiplier`（`?fake` は `multiplier-fake`）。卓ではハンドが終わるたびに `game_hands` を差分で読み、起動時は `me().recent` で取りこぼしを埋める。
- **RANKING**：今シーズン（残り日数）と殿堂入りのタブ。
- **ルールのモーダル**：ストラクチャー、倍率と確率の表、フリーロールの条件、卓の操作（Table）、PRIVATE（チャット・GIF・再戦）。
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
  - ビューの `meta` は `{ stake, buyIn, multiplier, prize, room, bot:[bool×3], clock, result, seat }`。
  - `result` は `{ places, winner, payouts, after:[残高|null×3], ... }`。
  - `queue` の返り値に `now` を含める。
  - `profiles.played`: 今シーズンに1戦以上したか。ランキングの対象条件で、シーズンが変わると 0 に戻る。
  - 「自分の進行中の卓」は、status が active で、かつ自分の順位が未確定の卓に限る。人間が全員脱落したら、その卓はすぐに終局させる。
  - フリーロールの閾値は `me()` の SQL にも書いてある。`spin.js` の値を変えたら SQL も合わせる。
- **ビルド**: フォルダ名の `&` が npm の .cmd ラッパーを壊すため、npm scripts は vite を `node node_modules/vite/bin/vite.js` で直接起動する。
