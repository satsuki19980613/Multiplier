# X 投稿

- 告知画像: `promo/out/x-d-wheel.png`（縦長 3:4、1800×2400）。元は `promo/x-d-wheel.html`、書き出しは `node promo/render.mjs`。
- スクショ（スマホ、1170×2532）: `promo/shots-light/`（ライト）と `promo/shots/`（ダーク）の `1-wheel.png`・`2-table.png`・`3-win.png`。撮影は `npm run dev` のあと `node promo/capture-x.mjs`（ライトは `THEME=light SHOTS=shots-light`）。開発用の仮サーバー（`?fake`）で倍率を ×10,000 に固定して撮っている。

## Alt テキスト

### 告知画像　x-d-wheel.png

```
Multiplier の告知画像。ピンクと青の2色刷りの版画風。右に倍率のルーレット（14マス。×10,000・×1,000・×100・×25・×10・×5・×4 の間に ×3 と ×2 が交互に入る）があり、左を向いた針が×10,000を指している。左に「PRIZE ×2 — ×10,000」。左下にAとKのカード。下に「PLAYERS 3 / GAME Hold'em / FORMAT Hyper Turbo / PRICE Free」、「プレイマネー・購入なし・換金なし」とURL。
```

### 1-wheel.png

```
ゲーム開始時のルーレット画面。倍率が ×10,000 に止まり、1位が受け取るチップは 100,000。
```

### 2-table.png

```
3人のテーブルでの自分の手番。フロップが開いていて、相手のbetに対してFold・Call・Raiseを選ぶ場面。上部に倍率 ×10,000 と 100,000 の表示。
```

### 3-win.png

```
結果画面。1位（Winner）で +99,990 チップ。順位は YOU が1位、Bot 2人が2位と3位。
```
