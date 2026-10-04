# 05. Bot（空席補充用AI）の調査と推奨構成

調査日: 2026-10-04。Sonnet 5.5 のサブエージェント2体が担当した。1体はライブラリ・ソルバーの調査、もう1体は戦略データの調査と**実際の均衡計算**。整理は Opus 5.5。

決定事項（2026-10-04 さつき）: Botで空席を埋める。弱すぎると拍子抜けするので、**ある程度強く**する。

## 0. 結論

1. **既製のBotで、そのまま使えるものは見つからなかった**
   - Pluribus の再実装（noregrets）: 学習済みモデルが 4.3GB で、しかも商用ライセンス限定。
   - TexasSolver / postflop-solver: AGPL で、ヘッズアップのポストフロップ専用。
   - OpenSpiel / RLCard: 研究用フレームワークで、強い学習済みモデルが付いていない。
   - 「3人・浅いスタック・サーバーレスで動く・ライセンスに問題がない」という条件を満たす完成品はない。
2. **このゲームは浅いスタックのため、勝敗の大半はプリフロップのプッシュ/フォールドで決まる**
   - 開始時は15〜25bbだが、20/40 で 7.5〜12.5bb、30/60 以降は 8bb 以下になる。
   - 1位総取り（ICMなし）なので、チップの期待値（chipEV）を最大化する戦略がそのまま正解になる。
   - 学術研究（Miltersen & Sørensen 2007）では、浅いスタックのヘッズアップで、プッシュ/フォールドだけの戦略と、ポストフロップまで含めた最適戦略との勝率差は 1.4pp 以内。
3. **プッシュ/フォールドの均衡（Nash）表は、今回自分たちで計算済み**（`tools/bot-solver/`）
   - **ヘッズアップ（1〜30bb）**: 公開値と一致した。PokerStrategy の 20bb BB コールレンジは完全一致。cgpoker の 10bb 値（SB プッシュ 58.3% / BB コール 37.5%、SB の EV −0.045bb）とも一致。
   - **3人（2〜25bb、全員同じスタック）**: 無料で公開されている表は存在しなかったので、自前で計算した。
     - 方法は、169×169×169 の3人エクイティ表と fictitious play。
     - 4億ハンドの独立シミュレーションと照合し、EV の差は 0.003bb 以内だった。
     - 搾取可能性（exploitability）の代理指標は 0.4〜1.5 mbb/hand。
   - **スタックが違う場合**: 判断ノードごとの「実効スタック」で、同スタック表を引けば十分だった（未知の6構成で損失は 0〜8 mbb/hand）。全組合せの表は不要。
   - **サイズ**: HU 表は gzip 後 1.8KB、3人表は gzip 後 4.2KB。参照（ルックアップ）10万回が約4ms。
4. **ポストフロップは、ルールと実行時のモンテカルロ計算で十分**
   - 相手のレンジを推定し、そのレンジに対するエクイティをモンテカルロで計算し、SPR とポットオッズのルールで判断する。
   - 実測で、7枚役判定は JS で約 5.8M 評価/秒。2,000 サンプルなら約1ms で終わる。

## 1. 推奨アーキテクチャ（案A ＋ 案B-lite）

| 局面 | 方式 | 強さの見込み |
|---|---|---|
| **12bb以下（ほぼ全局面）** | 3人 Nash 表を引く（脱落後は HU 表）。実効スタックの間で線形補間し、出てきた頻度でサイコロを振る（混合戦略） | **ほぼ Nash 水準** |
| **12〜25bb（最初の1〜2レベル）** | ハンドの強さ順に並べたパーセンタイル帯で、ミニレイズ / リンプ / ジャム / フォールドを決める。公開値（GTO Gecko、BitB、GTO Wizard の記事）に合わせて調整する。BB のディフェンスは「必要エクイティ ÷ 実現率R（≈0.65）」で判断する | 中上級（近似） |
| **ポストフロップ** | ① プリフロップの行動から各相手のレンジ（1,326コンボの重み）を作る<br>② ストリートごとにレンジを絞る<br>③ モンテカルロでエクイティを計算<br>④ ルールで判断（下表） | 中級〜中上級（未検証） |

### ポストフロップのルール（浅いスタック向け）
- **SPR ≤ 1.5**: トップペア以上、またはエクイティ約 35〜40% 以上のドローなら、スタックを全部入れる。それ以外はポットオッズで判断する。
- **コール判定**: 必要エクイティ ＝ コール額 ÷（ポット＋コール額）。OOP（後手）のときは実現率で割り引く。
- **ベット**: 低 SPR では 1/3〜2/3 ポット、SPR < 1 ならジャム。リバーは 70% ポットのポラライズで、ブラフ比率は b/(p+2b)。
- **Cベット**: ドライなボードでは高頻度・小さめに打つ。連結したボードやモノトーンのボードでは頻度を下げる。3人で入ったポットではベット頻度を大きく下げる。
- **セミブラフ**: 9アウト以上の強いドローは、レイズかジャムを優先する。

## 2. 性格・強さ調整（人間らしさ）

計算で確認した性質: **プッシュ/フォールド域では、レンジ幅を ±10pt ずらしても損失は 0.03bb/hand 程度に収まる。** つまり、人間らしい癖を入れてもほとんど弱くならない。崩れるのは ±20pt 以上ずらしたときから。

| 調整方法 | 内容 |
|---|---|
| 性格（Botごとに固定） | ノードごとにパーセンタイル幅をシフトする（Tight −δ / Loose +δ）、攻撃性の係数、ブラフ頻度の係数 |
| 混合戦略 | 表の頻度でサイコロを振る。常に同じ選択をすると人間に読まれる |
| 難易度 | softmax（QRE）の λ を変える。HU 10bb の SB で λ=30 なら 1.6 mbb、λ=10 なら 12 mbb、λ=3 なら 54 mbb の損失 |
| 癖 | 毎回独立のノイズを入れるより、Botごとに「ハンドごとの固定オフセット」を持たせる方が人間らしい |
| 思考時間 | ゆらぎを入れる。難しい判断ほど長く考える |

**推奨: 全Botを「中〜強」に揃え、性格だけ変える**（例: 🤖 Tight / 🤖 Loose / 🤖 Aggro）。極端に弱い設定は作らない。

## 3. サーバーレス実装上の注意（Neon Functions）
- Neon Functions の制約: メモリは 2GiB 固定、1リクエスト最大15分、モジュールスコープのキャッシュはアイソレート内で共有される。出典: https://neon.com/docs/compute/functions/reference/runtime-limits
  - バンドルサイズの上限とコールドスタートの時間は公式に記載がなく、未確認。
- **Botの判断は冪等にする**: ポーリングのたびに同じ手番が再計算され得る。対策は2つ。
  - 乱数のシードを `hash(gameId, handNo, actionIndex, seat)` で決定論的に作る。
  - 確定した判断は DB（games.state）に保存する。
- 表と役判定は、モジュールスコープで一度だけ読み込む。
- **ルールは engine に一元化する（grid-holdem の規約）**: Bot は engine の合法手 API だけを使う。同じ `bot.js` を、サーバーとブラウザ（オフラインの VS CPU）の両方で動かせる。

## 4. ライブラリの候補（すべて商用利用可のライセンス）

| 用途 | 候補 | ライセンス | 備考 |
|---|---|---|---|
| 7枚役判定 | **phe**（thlorenz）／**poker-utils**（conradbkay、TypeScript） | MIT | テーブルは 144〜500KB。現在の `eval5`×21通りより大幅に速い |
| エクイティ（必要なら） | poker-wasm | MIT | レンジ対レンジ 約11µs |
| HU表の検算 | nuts（`pushfold.json`） | MIT | HU 1〜20bb |
| 169×169 エクイティ表 | poker-math | コードは MIT、データは CC0 | 再配布自由 |
| 3人均衡の研究 | Ganzfried & Sandholm, AAMAS 2008 | 論文 | 3人の jam/fold を fictitious play で解いている |
| **避けるもの** | TexasSolver / postflop-solver / wasm-postflop | AGPL | 同梱やサービス提供にはライセンスの問題がある |
| **避けるもの** | DeepHoldem / JsPoker / cgpoker | ライセンス不明 | 設計の参考にとどめる |

**依存ライブラリの追加には、さつきの確認が必要**（grid-holdem の規約）。自前の役判定を高速化（ルックアップテーブル化）して依存を増やさない選択肢もある。

## 5. 強さの評価方法
- **厳密な EV（回帰テスト）**: プッシュ/フォールド域では、戦略の組に対する各席の EV をテンソル計算で厳密に出せる（`lineup.py`、`sim_check.py`）。数 mbb 単位の差まで比較できる。
- **デュプリケート方式のシミュレーション**: 同じ配牌で席を6通り入れ替えて対戦させる。オールイン時は EV で補正する（分散が約1/5になる）。
- **ベースライン**: ランダム、Always-call、Always-jam、Tight（上位15%）、Nash表のみ、前バージョンの自分。
- **必要サンプル数**: SNG の勝率で 5pt の差を検出するには約700戦、2pt の差なら約4,350戦。
- **目標**: 「Nash表のみの Bot」と「ランダム／Tight の Bot」に、統計的に有意に勝つこと。

## 6. 開発ステップ
1. 7枚役判定を高速化する（自前のテーブル化か、phe/poker-utils の導入。導入する場合はさつきの確認が必要）。
2. 3人 NLHE エンジンを作り、アリーナ（Bot 同士の自己対戦・デュプリケート）を作る。
3. Nash 表の Bot（12bb 以下）を作る。テーブルは `tools/bot-solver/export/` のものを使う。
4. 12〜25bb のパーセンタイル帯を作る。
5. ポストフロップのルール Bot を作る。
6. 性格パラメータを入れ、強さを較正する。
7. 必要に応じて、相手モデル（VPIP や fold-to-jam を Nash 寄りに縮約推定する）を追加する。

## 7. 成果物（`tools/bot-solver/`）
- `export/hu_pushfold.json`: HU の SB プッシュと BB コールの頻度。1〜30bb を 0.5 刻み、169クラス。
- `export/threeway_equal_stacks.json`: 3人で同じスタックの場合。2〜25bb、6ノード（a=BTN プッシュ、sp=SB プッシュ、sc=SB コール、b1/b2/b3=BB コール）。
- `export/threeway_asym_examples.json`: スタックが違う6構成の厳密解（近似ルールの検証用）。
- `export/hand_rank_by_btn_push_depth.json`: ハンドの強さ順位。
- `export/lookup.js`: Node 版の参照実装。カード表現は `rank*4+suit` で grid-holdem と同じ。
- `*.py`: 計算コード（Python + numpy + numba）。巨大な中間データ（`*.npy`、各約19MB）はコミットしていない。必要なら再生成できる（3人エクイティ表は 28 スレッドで約7分）。

### スタックが違う場合の実効スタック（B=BTN, S=SB, K=BB）
| ノード | 引くスタック |
|---|---|
| a（BTN プッシュ） | (min(B,S)+min(B,K))/2 |
| sp, b1 | min(S,K) |
| sc | min(B,S) |
| b2 | min(B,K) |
| b3 | min(K,(B+S)/2) |

### 3人 Nash（同じスタック・chipEV）の抜粋
| スタック | BTN プッシュ | SB プッシュ（BTN フォールド後） | SB コール（BTN プッシュに対して） | BB コール vs SB | BB コール vs BTN | BB コール vs BTN+SB |
|---|---|---|---|---|---|---|
| 5bb | 40.9% | 70.8 | 31.3 | 60.6 | 45.7 | 38.3 |
| 10bb | 32.9 | 57.6 | 18.1 | 36.6 | 24.2 | 13.3 |
| 15bb | 27.7 | 44.9 | 13.2 | 27.6 | 16.5 | 8.5 |
| 20bb | 21.6 | 39.2 | 10.0 | 21.6 | 11.5 | 5.9 |

## 主な出典
- Neon Functions の制約: https://neon.com/docs/compute/functions/reference/runtime-limits
- 3人 jam/fold: https://aamas.csc.liv.ac.uk/Proceedings/aamas08/proceedings/pdf/paper/AAMAS08_0313.pdf
- HU jam/fold の近似性（Miltersen & Sørensen）: https://dl.acm.org/doi/10.1145/1329125.1329357
- HoldemResources HU Nash: https://www.holdemresources.net/hune
- PokerStrategy Nash ranges: https://www.pokerstrategy.com/strategy/sit-and-go/push-fold-play-nash-ranges/
- cgpoker: https://github.com/nathanWolo/cgpoker
- zolik PR（HU Nash + マルチウェイ近似の設計）: https://github.com/dbeasty/zolik/pull/238
- GTO Gecko Spin&Go: https://gtogecko.com/blog/spin-and-go-strategy
- AIVAT: https://ojs.aaai.org/index.php/AAAI/article/view/11481
- phe: https://github.com/thlorenz/phe ／ poker-utils: https://github.com/conradbkay/poker-utils ／ poker-math: https://github.com/poker-yoga/poker-math ／ nuts: https://github.com/ZorigoKH/nuts
