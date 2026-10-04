// Range (1326-combo weight vectors), Monte-Carlo equity and range narrowing helpers.
import { evalCards, drawOuts } from './eval.js';
import { classIndex, CLASS_ORDER, CLASS_COMBOS } from './tables.js';

export const NC = 1326;
export const C0 = new Uint8Array(NC);
export const C1 = new Uint8Array(NC);
export const CCLS = new Uint8Array(NC);
const MLO = new Int32Array(NC), MHI = new Int32Array(NC);
{
  let k = 0;
  for (let a = 0; a < 52; a++) {
    for (let b = a + 1; b < 52; b++) {
      C0[k] = a; C1[k] = b; CCLS[k] = classIndex(a, b);
      MLO[k] = (a < 26 ? 1 << a : 0) | (b < 26 ? 1 << b : 0);
      MHI[k] = (a >= 26 ? 1 << (a - 26) : 0) | (b >= 26 ? 1 << (b - 26) : 0);
      k++;
    }
  }
}
export const comboIndex = (a, b) => {
  if (a > b) { const t = a; a = b; b = t; }
  // index of pair (a,b) a<b in lexicographic order
  return a * 51 - ((a * (a - 1)) >> 1) + (b - a - 1);
};

// class span [start,end] in percent of all combos, strongest first
const CL_START = new Float64Array(169), CL_END = new Float64Array(169);
{
  let acc = 0;
  for (const c of CLASS_ORDER) {
    CL_START[c] = acc;
    acc += (CLASS_COMBOS[c] * 100) / NC;
    CL_END[c] = acc;
  }
}

export function newRange(fill = 0) {
  const r = new Float32Array(NC);
  if (fill) r.fill(fill);
  return r;
}

// weights by preflop hand-strength percentile band [lo, hi] (0 = best, 100 = worst); boundary classes are partial
export function bandRange(lo, hi, out) {
  const r = out || new Float32Array(NC);
  const cw = new Float32Array(169);
  for (let c = 0; c < 169; c++) {
    const s = CL_START[c], e = CL_END[c];
    cw[c] = Math.max(0, Math.min(e, hi) - Math.max(s, lo)) / (e - s);
  }
  for (let k = 0; k < NC; k++) r[k] = cw[CCLS[k]];
  return r;
}

export function classWeightsRange(cw, out) {
  const r = out || new Float32Array(NC);
  for (let k = 0; k < NC; k++) r[k] = cw[CCLS[k]];
  return r;
}

// mask out combos that collide with dead cards
export function removeDead(r, dead) {
  let lo = 0, hi = 0;
  for (const c of dead) { if (c < 26) lo |= 1 << c; else hi |= 1 << (c - 26); }
  for (let k = 0; k < NC; k++) if ((MLO[k] & lo) || (MHI[k] & hi)) r[k] = 0;
  return r;
}

export function rangeMass(r) { let s = 0; for (let k = 0; k < NC; k++) s += r[k]; return s; }
export function rangePct(r) { return rangeMass(r) / NC * 100; }

// ---- small fast PRNG seeded from caller's rnd
export function makeLocalRng(rnd) {
  let s = (Math.floor(rnd() * 4294967296) >>> 0) || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// ---- Monte-Carlo equity of hero (h0,h1) vs one or two weighted villain ranges.
// board: array of known cards (0..5). Returns equity in [0,1] (ties split). samples ~ 1500-3000.
const deck = new Int8Array(52);
const hs = new Array(7);
const v1s = new Array(7);
const v2s = new Array(7);
export function equity(h0, h1, board, ranges, samples, rng) {
  const nb = board.length;
  let dlo = 0, dhi = 0;
  const mark = (c) => { if (c < 26) dlo |= 1 << c; else dhi |= 1 << (c - 26); };
  mark(h0); mark(h1); for (let i = 0; i < nb; i++) mark(board[i]);
  const nv = ranges.length;
  const lists = [], cums = [];
  for (let v = 0; v < nv; v++) {
    const r = ranges[v];
    const idx = [], cum = [];
    let acc = 0;
    for (let k = 0; k < NC; k++) {
      const w = r[k];
      if (w > 0 && !(MLO[k] & dlo) && !(MHI[k] & dhi)) { idx.push(k); acc += w; cum.push(acc); }
    }
    if (!idx.length) return 0.5;
    lists.push(idx); cums.push(cum);
  }
  const pick = (v) => {
    const cum = cums[v];
    const x = rng() * cum[cum.length - 1];
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; }
    return lists[v][lo];
  };
  let sum = 0, n = 0;
  const need = 5 - nb;
  hs[0] = h0; hs[1] = h1;
  for (let i = 0; i < nb; i++) { hs[2 + i] = board[i]; v1s[2 + i] = board[i]; v2s[2 + i] = board[i]; }
  for (let s = 0; s < samples; s++) {
    const k1 = pick(0);
    let k2 = -1;
    if (nv > 1) {
      let tries = 0;
      do { k2 = pick(1); tries++; } while (((MLO[k1] & MLO[k2]) || (MHI[k1] & MHI[k2])) && tries < 12);
      if ((MLO[k1] & MLO[k2]) || (MHI[k1] & MHI[k2])) continue;
    }
    let used0 = dlo | MLO[k1] | (k2 >= 0 ? MLO[k2] : 0);
    let used1 = dhi | MHI[k1] | (k2 >= 0 ? MHI[k2] : 0);
    for (let i = 0; i < need; i++) {
      let c;
      do { c = (rng() * 52) | 0; } while (c < 26 ? (used0 & (1 << c)) : (used1 & (1 << (c - 26))));
      if (c < 26) used0 |= 1 << c; else used1 |= 1 << (c - 26);
      hs[2 + nb + i] = c; v1s[2 + nb + i] = c; v2s[2 + nb + i] = c;
    }
    v1s[0] = C0[k1]; v1s[1] = C1[k1];
    const sh = evalCards(hs, 7), s1 = evalCards(v1s, 7);
    let sc;
    if (k2 >= 0) {
      v2s[0] = C0[k2]; v2s[1] = C1[k2];
      const s2 = evalCards(v2s, 7);
      const mx = s1 > s2 ? s1 : s2;
      if (sh > mx) sc = 1;
      else if (sh < mx) sc = 0;
      else sc = 1 / (1 + (s1 === sh ? 1 : 0) + (s2 === sh ? 1 : 0));
    } else {
      sc = sh > s1 ? 1 : sh < s1 ? 0 : 0.5;
    }
    sum += sc; n++;
  }
  return n ? sum / n : 0.5;
}

// ---- Board-dependent strength of each combo in a range (for narrowing).
// Returns { q: Float32Array(NC) weighted percentile 0..1 (1 = strongest), draw: Uint8Array(NC) outs }
const tmpIdx = new Int32Array(NC);
export function boardStrength(range, board, extraDead) {
  const nb = board.length;
  let dlo = 0, dhi = 0;
  const mark = (c) => { if (c < 26) dlo |= 1 << c; else dhi |= 1 << (c - 26); };
  for (let i = 0; i < nb; i++) mark(board[i]);
  if (extraDead) for (const c of extraDead) mark(c);
  const score = new Int32Array(NC);
  const q = new Float32Array(NC);
  const draw = new Uint8Array(NC);
  const cs = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < nb; i++) cs[2 + i] = board[i];
  let m = 0;
  for (let k = 0; k < NC; k++) {
    if (range[k] <= 0 || (MLO[k] & dlo) || (MHI[k] & dhi)) continue;
    cs[0] = C0[k]; cs[1] = C1[k];
    score[k] = evalCards(cs, 2 + nb);
    if (nb >= 3 && nb <= 4) draw[k] = drawOuts(C0[k], C1[k], board, nb);
    tmpIdx[m++] = k;
  }
  const order = Array.from(tmpIdx.subarray(0, m)).sort((a, b) => score[a] - score[b]);
  let tot = 0;
  for (const k of order) tot += range[k];
  let acc = 0;
  for (let i = 0; i < order.length; ) {
    let j = i, w = 0;
    while (j < order.length && score[order[j]] === score[order[i]]) { w += range[order[j]]; j++; }
    const qv = tot > 0 ? (acc + w / 2) / tot : 0.5;
    for (let t = i; t < j; t++) q[order[t]] = qv;
    acc += w; i = j;
  }
  return { q, draw, score };
}

// Narrow a villain range given his action on this street. kind: 'bet' | 'raise' | 'call' | 'check'
// f = bet size / pot-before-bet (for bet/raise). river: no draws. Returns a new Float32Array.
export function narrow(range, board, kind, f, extraDead, tight = 1) {
  const nb = board.length;
  const { q, draw } = boardStrength(range, board, extraDead);
  const out = new Float32Array(NC);
  const river = nb >= 5;
  if (kind === 'check') {
    for (let k = 0; k < NC; k++) if (range[k] > 0) out[k] = range[k] * (q[k] >= 0.88 ? 0.5 : 1);
    return out;
  }
  if (kind === 'call') {
    for (let k = 0; k < NC; k++) {
      const w = range[k]; if (w <= 0) continue;
      let m;
      if (q[k] >= 0.92) m = 0.55;
      else if (q[k] >= 0.35) m = 1;
      else m = !river && draw[k] >= 6 ? 0.8 : 0.12;
      out[k] = w * m;
    }
    return out;
  }
  // bet / raise: value (q >= thr), semi-bluffs (draws), pure bluffs sized by the bluff/value ratio
  const thr = kind === 'raise' ? 0.78 : 0.62;
  let valueMass = 0, airMass = 0;
  for (let k = 0; k < NC; k++) {
    const w = range[k]; if (w <= 0) continue;
    if (q[k] >= thr) valueMass += w;
    else if (q[k] < 0.5 && !(draw[k] >= 6 && !river)) airMass += w;
  }
  const bluffTarget = valueMass * (f / (1 + f)) * 0.8 * tight;
  const airW = airMass > 0 ? Math.min(1, bluffTarget / airMass) : 0;
  for (let k = 0; k < NC; k++) {
    const w = range[k]; if (w <= 0) continue;
    let m;
    if (q[k] >= thr) m = 1;
    else if (!river && draw[k] >= 6) m = kind === 'raise' ? 0.5 : 0.7;
    else if (q[k] >= 0.5) m = kind === 'raise' ? 0.08 : 0.35;
    else m = airW;
    out[k] = w * m;
  }
  // never empty
  if (rangeMass(out) < 1) return Float32Array.from(range);
  return out;
}
