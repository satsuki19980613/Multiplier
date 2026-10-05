// Multiplier: shared settings (stakes, prize multipliers, tournament structure, blinds, seasons). Pure data + tiny helpers.
// Spec: docs/ARCHITECTURE.md §2, docs/research/03-economy.md §4.

export const START_CHIPS = 10000;

// key は API でも使う。どのステークスも最初から解放（残高が buy-in 以上なら参加できる。2026-10-05 さつき）
export const STAKES = {
  low:     { buyIn: 10 },
  mid:     { buyIn: 100 },
  high:    { buyIn: 1000 },
  ultra:   { buyIn: 2000 },
  extreme: { buyIn: 3000 },
};

export const FREEROLL = { prize: 500, perDay: 3, eligibleBelow: 10, stack: 500, levelMs: 120000 };

// 1位総取り。各行は [倍率, 1,000万回あたりの出現数]（倍率の大きい順）。合計は 10,000,000、E[倍率] = 3.0
// 最高賞金は 100,000（low〜ultra）。extreme だけはハイリスク・ハイリターンで最高 ×1,000（3,000,000）。代わりに ×2 が 55%
export const MULT_TOTAL = 10000000;
export const MULTIPLIERS = {
  low:  [[10000,30],[1000,300],[100,3000],[25,20000],[10,100000],[5,300000],[4,800000],[3,5346660],[2,3430010]],
  mid:  [[1000,300],[100,3000],[25,20000],[10,100000],[5,300000],[4,800000],[3,5646600],[2,3130100]],
  high: [[100,5000],[25,20000],[10,100000],[5,300000],[4,800000],[3,5750000],[2,3025000]],
  ultra: [[50,10000],[25,20000],[10,100000],[5,300000],[4,800000],[3,5760000],[2,3010000]],
  extreme: [[1000,1000],[100,10000],[25,40000],[10,150000],[5,400000],[4,800000],[3,3102000],[2,5497000]],
};

// rnd: () => [0,1)。倍率（整数）を返す。rnd の値を 1,000万分割した整数 k に直し、累積出現数の表を引く。
export function drawMultiplier(stake, rnd = Math.random) {
  const table = MULTIPLIERS[stake];
  if (!table) throw new Error('unknown stake: ' + stake);
  let k = Math.floor(rnd() * MULT_TOTAL);
  if (!(k >= 0)) k = 0;
  if (k >= MULT_TOTAL) k = MULT_TOTAL - 1;
  for (const [m, c] of table) {
    if (k < c) return m;
    k -= c;
  }
  return table[table.length - 1][0];
}

// => { stack, levelMs }。倍率 null（フリーロール）は FREEROLL の stack/levelMs
//   2x: 300/60s, 3x: 300/120s, 4x: 400/120s, 5x: 400/180s, 10x・25x: 500/180s, 100x 以上: 500/300s
export function structureFor(multiplier) {
  if (multiplier == null) return { stack: FREEROLL.stack, levelMs: FREEROLL.levelMs };
  const m = multiplier;
  if (m >= 100) return { stack: 500, levelMs: 300000 };
  if (m >= 10) return { stack: 500, levelMs: 180000 };
  if (m >= 5) return { stack: 400, levelMs: 180000 };
  if (m >= 4) return { stack: 400, levelMs: 120000 };
  if (m >= 3) return { stack: 300, levelMs: 120000 };
  return { stack: 300, levelMs: 60000 };
}

export const BLINDS = [[10,20],[15,30],[20,40],[30,60],[40,80],[50,100],[60,120],[75,150],[90,180],[100,200],
  [125,250],[150,300],[200,400],[250,500],[300,600],[400,800],[500,1000],[600,1200],[800,1600],[1000,2000],
  [1250,2500],[1500,3000],[2000,4000],[2500,5000],[3000,6000]];   // 最終レベル以降は据え置き。アンテなし

// シーズン（半年）。JST（UTC+9、夏時間なし）の 4/1 〜 9/30 が 'YYYY-H1'、10/1 〜 翌 3/31 が 'YYYY-H2'（1〜3月は前年の H2）。
// date: Date | ミリ秒 | ISO 文字列。startsAt / endsAt は Date（JSON では ISO 文字列になる。pg にもそのまま渡せる）。
const JST_MS = 9 * 3600 * 1000;
export function seasonOf(date = new Date()) {
  const t = new Date(date).getTime();
  if (!Number.isFinite(t)) throw new Error('seasonOf: invalid date');
  const j = new Date(t + JST_MS);               // getUTC* が JST の暦になる
  const y = j.getUTCFullYear(), mo = j.getUTCMonth(); // 0..11
  const jst = (yy, mm) => new Date(Date.UTC(yy, mm, 1) - JST_MS);
  if (mo >= 3 && mo <= 8) return { id: `${y}-H1`, startsAt: jst(y, 3), endsAt: jst(y, 9) };
  const sy = mo >= 9 ? y : y - 1;
  return { id: `${sy}-H2`, startsAt: jst(sy, 9), endsAt: jst(sy + 1, 3) };
}
