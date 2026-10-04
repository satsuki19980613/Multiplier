// Nash push/fold lookups (HU + 3-handed equal stacks) and hand-class helpers.
// card = rank*4+suit, rank 0='2'..12='A'.
import { HANDS, HU, TW, HAND_RANK } from './nashdata.js';

export { HANDS };

// 169 class index, same order as HANDS
export function classIndex(c1, c2) {
  const r1 = c1 >> 2, r2 = c2 >> 2, s1 = c1 & 3, s2 = c2 & 3;
  const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
  if (hi === lo) return (12 - hi) * 14;
  return s1 === s2 ? (12 - hi) * 13 + (12 - lo) : (12 - lo) * 13 + (12 - hi);
}

// strength percentile per class (0..100, smaller = stronger; the middle of the class's combo span)
export const CLASS_PCT = new Float64Array(169);
export const CLASS_COMBOS = new Int16Array(169);
export const CLASS_ORDER = []; // class indices from strongest to weakest
{
  const idx = new Map(HANDS.map((h, i) => [h, i]));
  let prev = 0;
  for (const [name, combos, cum] of HAND_RANK) {
    const i = idx.get(name);
    CLASS_COMBOS[i] = combos;
    CLASS_PCT[i] = (prev + cum) / 2;
    CLASS_ORDER.push(i);
    prev = cum;
  }
}
// representative hole cards (indices 0..51) for a class, used by tests
export function classCards(cls) {
  const name = HANDS[cls];
  const R = '23456789TJQKA';
  const r1 = R.indexOf(name[0]), r2 = R.indexOf(name[1]);
  if (name.length === 2) return [r1 * 4, r1 * 4 + 1];
  return name[2] === 's' ? [r1 * 4, r2 * 4] : [r1 * 4, r2 * 4 + 1];
}

function lerp(rows, stacks, x, h) {
  const n = stacks.length;
  if (x <= stacks[0]) return rows[0][h] / 100;
  if (x >= stacks[n - 1]) return rows[n - 1][h] / 100;
  let i = 0;
  while (stacks[i + 1] < x) i++;
  const t = (x - stacks[i]) / (stacks[i + 1] - stacks[i]);
  return ((1 - t) * rows[i][h] + t * rows[i + 1][h]) / 100;
}

const NODES = ['a', 'sp', 'sc', 'b1', 'b2', 'b3'];
const twRows = {};
for (const n of NODES) twRows[n] = TW.stacks.map((s) => TW.tables[String(s)][n]);

// HU: SB jam prob / BB call prob; eff = effective stack in bb
export const huPush = (cls, eff) => lerp(HU.push, HU.stacks, eff, cls);
export const huCall = (cls, eff) => lerp(HU.call, HU.stacks, eff, cls);
// 3-handed, node in a|sp|sc|b1|b2|b3; stack in bb (table range 2..25, clamped)
export const twProb = (node, cls, stack) => lerp(twRows[node], TW.stacks, stack, cls);

export const TW_MAX = TW.stacks[TW.stacks.length - 1];
export const HU_MAX = HU.stacks[HU.stacks.length - 1];
