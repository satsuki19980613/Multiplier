// Fast self-contained 5-7 card evaluator for the bot (no tables, no allocation).
// card = rank*4+suit (rank 0='2'..12='A'). Higher score = stronger.
// score = category<<20 | five 4-bit tiebreak nibbles.  Ordering matches src/engine.js eval7 (checked in test/bot.test.js).
// 0 high card, 1 pair, 2 two pair, 3 trips, 4 straight, 5 flush, 6 full house, 7 quads, 8 straight flush
const hi = (m) => 31 - Math.clz32(m);

function top(m, n) {
  let r = 0;
  for (let i = 0; i < n; i++) {
    if (m === 0) { r <<= 4; continue; }
    const h = hi(m);
    r = (r << 4) | h;
    m &= ~(1 << h);
  }
  return r;
}

function straightHigh(m) {
  // returns highest rank index of a straight in rank mask m, or -1. Wheel (A2345) -> 3.
  let s = m & (m >> 1) & (m >> 2) & (m >> 3) & (m >> 4);
  if (s) return hi(s) + 4;
  if ((m & 0x100f) === 0x100f) return 3;
  return -1;
}

export function evalCards(cs, n = cs.length) {
  let m1 = 0, m2 = 0, m3 = 0, m4 = 0;
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, c0 = 0, c1 = 0, c2 = 0, c3 = 0;
  for (let i = 0; i < n; i++) {
    const c = cs[i], b = 1 << (c >> 2);
    if (m3 & b) m4 |= b; else if (m2 & b) m3 |= b; else if (m1 & b) m2 |= b; else m1 |= b;
    switch (c & 3) {
      case 0: s0 |= b; c0++; break;
      case 1: s1 |= b; c1++; break;
      case 2: s2 |= b; c2++; break;
      default: s3 |= b; c3++;
    }
  }
  let fm = 0;
  if (c0 >= 5) fm = s0; else if (c1 >= 5) fm = s1; else if (c2 >= 5) fm = s2; else if (c3 >= 5) fm = s3;
  if (fm) {
    const sf = straightHigh(fm);
    if (sf >= 0) return (8 << 20) | (sf << 16);
  }
  if (m4) {
    const q = hi(m4);
    return (7 << 20) | (q << 16) | (top(m1 & ~(1 << q), 1) << 12);
  }
  if (m3) {
    const t = hi(m3);
    const rest = m2 & ~(1 << t);
    if (rest) return (6 << 20) | (t << 16) | (hi(rest) << 12);
  }
  if (fm) return (5 << 20) | top(fm, 5);
  const st = straightHigh(m1);
  if (st >= 0) return (4 << 20) | (st << 16);
  if (m3) {
    const t = hi(m3);
    return (3 << 20) | (t << 16) | (top(m1 & ~(1 << t), 2) << 8);
  }
  if (m2) {
    const p1 = hi(m2);
    const r2 = m2 & ~(1 << p1);
    if (r2) {
      const p2 = hi(r2);
      return (2 << 20) | (p1 << 16) | (p2 << 12) | (top(m1 & ~(1 << p1) & ~(1 << p2), 1) << 8);
    }
    return (1 << 20) | (p1 << 16) | (top(m1 & ~(1 << p1), 3) << 4);
  }
  return top(m1, 5);
}

export const CATEGORY = (score) => score >> 20;

// Draw helper: approximate outs (flush 9 / straight 4 per completing rank, max 8) for hole+board (3-4 board cards).
// Only draws that use a hole card count. Returns outs 0..15.
export function drawOuts(h0, h1, board, nb) {
  let rm = 0, brm = 0;
  const cnt = [0, 0, 0, 0];
  for (let i = 0; i < nb; i++) { const c = board[i]; cnt[c & 3]++; brm |= 1 << (c >> 2); }
  rm = brm | (1 << (h0 >> 2)) | (1 << (h1 >> 2));
  const hs0 = h0 & 3, hs1 = h1 & 3;
  cnt[hs0]++; cnt[hs1]++;
  let fd = 0;
  for (let s = 0; s < 4; s++) if (cnt[s] === 4 && (hs0 === s || hs1 === s)) fd = 9;
  let st = 0;
  if (straightHigh(rm) < 0) {
    for (let r = 0; r < 13; r++) {
      if (rm & (1 << r)) continue;
      if (straightHigh(rm | (1 << r)) >= 0 && straightHigh(brm | (1 << r)) < 0) st++;
    }
    st = Math.min(st * 4, 8);
  }
  return Math.min(fd + st, 15);
}
