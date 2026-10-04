# bot-solver

Bot のプリフロップ用のプッシュ/フォールド Nash 表を作る、オフラインの計算ツール群。chipEV、アンテなし。

経緯と検証結果は [docs/research/05-bot.md](../../docs/research/05-bot.md) にまとめている。

## 成果物（`export/`）
| ファイル | 内容 |
|---|---|
| `hu_pushfold.json` | ヘッズアップ。SB のプッシュ頻度と BB のコール頻度。1〜30bb を 0.5 刻み、169 クラス |
| `threeway_equal_stacks.json` | 3人で全員同じスタック。2〜25bb。6 ノード（`a` BTN プッシュ / `sp` SB プッシュ / `sc` SB コール / `b1` `b2` `b3` BB コール） |
| `threeway_asym_examples.json` | スタックが異なる 6 構成の厳密解（近似ルールの検証用） |
| `hand_rank_by_btn_push_depth.json` | 169 クラスのハンド強さ順位 |
| `lookup.js` | Node 用の参照実装。カード表現 `rank*4+suit`（rank 0 が '2'）は grid-holdem と同じ |

## 再生成
Python 3、numpy、numba を使う。中間データ（`*.npy`、`*.npz`）はコミットしていない。
1. `hu_equity.py`: 169×169 のエクイティ表 → `hu_eq.npy`
2. `hu_run.py`: HU Nash（fictitious play） → `hu_P.npy`、`hu_Q.npy`
3. `eq3.py`: 3人のエクイティ表（169³、N=3000 で 28 スレッド約 7 分） → `T3.npy`、`W3.npy`
4. `nash3.py`、`batch3.py`、`grid3.py`: 3人 Nash → `nash3_*.npz`
5. `export.py`: JSON を出力
6. 検証: `sim_check.py`（独立したモンテカルロで EV を照合）、`asym_test.py`、`lineup.py`
