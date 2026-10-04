// Preflop decisions: Nash push/fold tables (<= ~12bb, plus a jam/fold zone up to ZONE_A), then percentile bands and
// range-vs-range equity for deeper stacks.
import { classIndex, CLASS_PCT, CLASS_ORDER, CLASS_COMBOS, huPush, huCall, twProb, TW_MAX, HU_MAX, HANDS } from './tables.js';
import { bandRange, classWeightsRange, removeDead, equity, NC } from './range.js';
import { oppStats } from './opp.js';

export const CFG = {
  NASH_MAX: 12,     // Nash table decisions up to this many bb (node stack)
  ZONE_A_MAX: 12,   // jam-or-fold with the same tables a little deeper
  EQ_SAMPLES: 1600,
};

// ---------- helpers on move construction
export const FOLD = { type: 'fold' };
export function clampRaise(L, to) {
  if (L.minRaiseTo == null) return null;
  to = Math.round(to);
  return Math.max(L.minRaiseTo, Math.min(L.maxRaiseTo, to));
}
export function jamMove(L) {
  if (L.maxRaiseTo != null) return { type: 'raise', to: L.maxRaiseTo };
  if (L.canCall) return { type: 'call' };
  return { type: 'check' };
}
export function raiseOrJam(S, to) {
  const L = S.L;
  if (L.minRaiseTo == null) return L.canCall ? { type: 'call' } : { type: 'check' };
  const t = clampRaise(L, to);
  // leave nothing awkward behind: a raise that commits most of the stack is a jam
  if (t >= S.bet[S.seat] + S.stack * 0.62) return { type: 'raise', to: L.maxRaiseTo };
  return { type: 'raise', to: t };
}
export const passive = (L) => (L.canCheck ? { type: 'check' } : FOLD);

// ---------- Nash probability with a persona width shift (delta in percentage points of all hands)
export function shiftedProb(probs, cls, delta) {
  const p = probs[cls];
  if (!delta) return p;
  let mass = 0;
  for (let c = 0; c < 169; c++) mass += probs[c] * CLASS_COMBOS[c];
  const target = mass + (delta / 100) * NC;
  if (target <= 0) return 0;
  if (delta > 0) {
    if (p > 0) return p;
    let add = target - mass;
    for (const c of CLASS_ORDER) {
      if (probs[c] > 0) continue;
      const m = CLASS_COMBOS[c];
      if (c === cls) return Math.max(0, Math.min(1, add / m));
      add -= m;
      if (add <= 0) return 0;
    }
    return 0;
  }
  // shrink: drop mass from the weakest included classes
  let drop = mass - target;
  for (let i = CLASS_ORDER.length - 1; i >= 0; i--) {
    const c = CLASS_ORDER[i];
    if (probs[c] <= 0) continue;
    const m = probs[c] * CLASS_COMBOS[c];
    if (c === cls) return drop >= m ? 0 : (m - drop) / CLASS_COMBOS[c];
    drop -= m;
    if (drop <= 0) return p;
  }
  return p;
}

const _cache = new Map();
export function nodeProbs(node, stack) {
  // returns Float64Array(169) of probabilities (0..1) for the node at that stack (bb)
  const key = node + ':' + Math.round(stack * 4);
  let v = _cache.get(key);
  if (v) return v;
  v = new Float64Array(169);
  for (let c = 0; c < 169; c++) {
    v[c] = node === 'hp' ? huPush(c, Math.min(stack, HU_MAX)) : node === 'hc' ? huCall(c, Math.min(stack, HU_MAX)) : twProb(node, c, Math.min(stack, TW_MAX));
  }
  if (_cache.size > 4000) _cache.clear();
  _cache.set(key, v);
  return v;
}

// ---------- preflop story from the action log
export function preflopStory(S) {
  const bb = S.bb;
  let level = bb, raises = 0, raiser = -1, raiseTo = bb, lastRaiseAllIn = false;
  const limpers = [];
  const role = {};
  const raiseSeq = [];
  for (const a of S.acts) {
    if (a.street !== 'preflop') break;
    if (a.type === 'sb' || a.type === 'bb') { continue; }
    if (a.type === 'fold') { role[a.seat] = 'fold'; continue; }
    if (a.type === 'check') { role[a.seat] = 'check'; continue; }
    if (a.type === 'call') { if (raises === 0) { limpers.push(a.seat); role[a.seat] = 'limp'; } else role[a.seat] = 'call'; continue; }
    if (a.type === 'raise' || a.type === 'bet') {
      raises++; raiser = a.seat; raiseTo = a.to; level = a.to; lastRaiseAllIn = a.allIn;
      raiseSeq.push({ seat: a.seat, to: a.to, allIn: a.allIn });
      role[a.seat] = raises === 1 ? 'open' : raises === 2 ? '3bet' : '4bet';
    }
  }
  return { raises, raiser, raiseTo, level, limpers, role, lastRaiseAllIn, raiseSeq };
}

// is this raise effectively a jam? (all-in, or it commits most of the raiser's starting stack)
export function jamLike(S, seat, to) {
  if (S.view.allIn[seat]) return true;
  return to >= 0.55 * S.start[seat];
}

// stack (bb) to look up for a 3-handed node. B,S,K = hand-start stacks of btn/sb/bb in bb.
function nodeStack3(node, B, Sx, K) {
  switch (node) {
    case 'a': return (Math.min(B, Sx) + Math.min(B, K)) / 2;
    case 'sp': case 'b1': return Math.min(Sx, K);
    case 'sc': return Math.min(B, Sx);
    case 'b2': return Math.min(B, K);
    case 'b3': return Math.min(K, (B + Sx) / 2);
  }
  return Math.min(B, Sx, K);
}

// Which Nash node (if any) describes my decision? => { node, stack } | null
export function nashNode(S, st, forceJam = false) {
  const me = S.seat;
  if (S.n === 3) {
    const btn = S.button, sbS = S.sbSeat, bbS = S.bbSeat;
    const B = S.startBB[btn], Sx = S.startBB[sbS], K = S.startBB[bbS];
    const acted = S.acts.filter((a) => a.street === 'preflop' && a.type !== 'sb' && a.type !== 'bb');
    if (st.raises === 0 && st.limpers.length === 0) {
      if (me === btn && acted.length === 0) return { node: 'a', stack: nodeStack3('a', B, Sx, K), kind: 'jam' };
      if (me === sbS && acted.length === 1 && acted[0].seat === btn && acted[0].type === 'fold') return { node: 'sp', stack: nodeStack3('sp', B, Sx, K), kind: 'jam' };
      return null;
    }
    if (st.raises !== 1) return null;
    const rs = st.raiseSeq[0];
    if (!forceJam && !jamLike(S, rs.seat, rs.to)) return null;
    const rseat = rs.seat;
    if (me === sbS && rseat === btn && st.limpers.length === 0) return { node: 'sc', stack: nodeStack3('sc', B, Sx, K), kind: 'call' };
    if (me === bbS) {
      const others = acted.filter((a) => a.seat !== rseat);
      const callers = acted.filter((a) => a.type === 'call' || a.type === 'raise');
      if (rseat === sbS && acted.length === 2 && acted[0].seat === btn && acted[0].type === 'fold') return { node: 'b1', stack: nodeStack3('b1', B, Sx, K), kind: 'call' };
      if (rseat === btn) {
        const sbAct = acted.find((a) => a.seat === sbS);
        if (acted.length === 2 && sbAct && sbAct.type === 'fold') return { node: 'b2', stack: nodeStack3('b2', B, Sx, K), kind: 'call' };
        if (acted.length === 2 && sbAct && sbAct.type === 'call') return { node: 'b3', stack: nodeStack3('b3', B, Sx, K), kind: 'call' };
      }
    }
    return null;
  }
  // heads-up
  const opp = S.opps[0];
  const stack = Math.min(S.startBB[me], S.startBB[opp]);
  const acted = S.acts.filter((a) => a.street === 'preflop' && a.type !== 'sb' && a.type !== 'bb');
  if (S.pos === 'btn' && acted.length === 0) return { node: 'hp', stack, kind: 'jam' };
  if (S.pos === 'bb' && st.raises === 1 && st.limpers.length === 0) {
    const rs = st.raiseSeq[0];
    if (forceJam || jamLike(S, rs.seat, rs.to)) return { node: 'hc', stack, kind: 'call' };
  }
  return null;
}

const massPct = (probs) => { let m = 0; for (let c = 0; c < 169; c++) m += probs[c] * CLASS_COMBOS[c]; return (m / NC) * 100; };
function statsOf(S) { return S.stats || (S.stats = oppStats(S.view)); }

// Observed jam width (percent) of seat v if it deviates clearly from the Nash width `nashPct`, else null.
export function observedJamWidth(S, v, nashPct) {
  const sv = statsOf(S)[v];
  if (!sv || sv.n < 1) return null;
  const k = 4;
  const w = ((sv.jam + (k * nashPct) / 100) / (sv.n + k)) * 100;
  if (w > nashPct + 7 || w < nashPct - 10) return Math.max(2, Math.min(100, w));
  return null;
}

// range (Float32Array NC) that a jam from seat `raiserSeat` at stack `stack` (bb) represents
function jamRange(S, raiserSeat, stack) {
  let probs;
  if (S.n === 2) probs = nodeProbs('hp', stack);
  else if (raiserSeat === S.button) probs = nodeProbs('a', Math.min(stack, TW_MAX));
  else probs = nodeProbs('sp', Math.min(stack, TW_MAX));
  const w = observedJamWidth(S, raiserSeat, massPct(probs));
  if (w != null) { const r = bandRange(0, w); r.exploit = true; return r; }
  const cw = new Float32Array(169);
  for (let c = 0; c < 169; c++) cw[c] = probs[c];
  return classWeightsRange(cw);
}

// base opening width by position (percent of hands) for a sized raise
function raiseWidth(S, pos, toBB) {
  let w = S.n === 2 ? 62 : pos === 'btn' ? 40 : pos === 'sb' ? 34 : 22;
  w *= toBB <= 2.4 ? 1.1 : toBB <= 3.4 ? 1 : toBB <= 4.6 ? 0.75 : 0.55;
  return Math.min(95, w);
}

// estimate a villain's preflop range at the start of the flop (or now) from the story
export function villainPreflopRange(S, st, v, atFlop) {
  const bb = S.bb;
  const pos = S.posOf(v);
  const r = st.role[v];
  const eff = Math.min(S.startBB[v], S.startBB[S.seat]);
  let range;
  if (r === 'open' || r === '3bet' || r === '4bet') {
    const rs = st.raiseSeq.find((x) => x.seat === v);
    const toBB = rs.to / bb;
    if (jamLike(S, v, rs.to) && st.raiseSeq.length === 1 && eff <= 25) {
      range = jamRange(S, v, eff);
    } else if (r === 'open') {
      let w = raiseWidth(S, pos, toBB);
      const sv = statsOf(S)[v];
      if (sv && sv.n >= 3) w = Math.min(100, ((sv.raise + (6 * w) / 100) / (sv.n + 6)) * 100 * (toBB > 4.6 ? 0.8 : 1));
      range = bandRange(0, w);
    } else {
      const w = r === '3bet' ? (rs.allIn ? 14 : 9) : 5;
      range = bandRange(0, Math.max(3, w * (eff < 12 ? 1.2 : 1)));
    }
  } else if (r === 'call') {
    // called a raise: not the strongest (they would 3-bet), not the weakest
    const raiser = st.raiseSeq[0] ? st.raiseSeq[0].seat : -1;
    const lo = pos === 'bb' ? 8 : 9, hi = pos === 'bb' ? 58 : 38;
    range = bandRange(lo, hi);
  } else if (r === 'limp') {
    range = bandRange(6, 80);
  } else { // 'check' / blind that saw the flop for free, or no action yet (BB with the option)
    range = bandRange(S.n === 2 ? 0 : 12, 100);
  }
  return range;
}

// persona width tweaks: delta (pt) for a decision kind, with a fixed per-bot quirk
export function shifts(P, quirk) {
  return {
    jam: P.jamD + quirk * 1.5,
    call: P.callD + quirk * 1.5,
    open: P.openD + quirk * 2,
    iso: P.isoD + quirk * 2,
  };
}

// realisation factor for equity -> required equity
function realization(S, effBB, oop) {
  let r = oop ? 0.66 : 0.82;
  if (effBB < 12) r += 0.08;
  if (effBB < 8) r += 0.06;
  if (S.n === 3 && S.live.length === 2) r -= 0.05;
  return Math.min(1, r);
}

export function preflopMove(S, P, rnd, rng) {
  const L = S.L, bb = S.bb;
  const me = S.seat;
  const [h0, h1] = S.hole;
  const cls = classIndex(h0, h1);
  const pct = CLASS_PCT[cls];
  const st = preflopStory(S);
  const sh = shifts(P, P.quirk);
  const node = nashNode(S, st);

  // ---- Nash tables / jam-or-fold zone
  if (node) {
      if (node.stack <= CFG.ZONE_A_MAX) {
      if (node.kind === 'call' && node.node !== 'b3') {
        // exploit: if the jammer's observed jam frequency differs a lot from Nash, call by equity against what he really jams
        const rs = st.raiseSeq[0];
        const rng2 = jamRange(S, rs.seat, node.stack);
        if (rng2.exploit) {
          removeDead(rng2, S.hole);
          const eq = equity(h0, h1, [], [rng2], CFG.EQ_SAMPLES, rng);
          const need = L.callAmount / (S.pot + L.callAmount);
          return eq >= need + 0.004 - sh.call * 0.0008 ? { type: 'call' } : FOLD;
        }
      }
      if (node.kind === 'jam') {
        const ex = exploitJam(S, h0, h1, node.stack, rng, sh);
        if (ex !== null) return ex ? jamMove(L) : passive(L);
      }
      const probs = nodeProbs(node.node, node.stack);
      const p = shiftedProb(probs, cls, node.kind === 'jam' ? sh.jam : sh.call);
      const go = rnd() < p;
      if (node.kind === 'jam') return go ? jamMove(L) : (L.canCheck ? { type: 'check' } : FOLD);
      return go ? { type: 'call' } : FOLD;
    }
  }

  const effBB = Math.min(S.startBB[me], Math.max(...S.live.map((o) => S.startBB[o]), 0.1));
  const depth = effBB;

  // ---- facing a raise (not a table node)
  if (st.raises > 0) {
    return facingRaise(S, st, P, sh, cls, pct, depth, rnd, rng);
  }

  // ---- no raise yet: open / iso / limp-check decisions
  const limped = st.limpers.length > 0;
  if (!limped) {
    // first to act (BTN, or HU SB) or SB after BTN fold (3-handed) at depth
    if (depth <= CFG.NASH_MAX + 0.01 || depth <= CFG.ZONE_A_MAX) {
      // jam or fold with the nearest table node (non-table situations at shallow depth)
      const nd = S.n === 2 ? 'hp' : (S.pos === 'btn' ? 'a' : 'sp');
      const ex = exploitJam(S, h0, h1, depth, rng, sh);
      if (ex !== null) return ex ? jamMove(L) : passive(L);
      const probs = nodeProbs(nd, depth);
      const go = rnd() < shiftedProb(probs, cls, sh.jam);
      return go ? jamMove(L) : passive(L);
    }
    const openTop = (S.n === 2 ? 56 : S.pos === 'btn' ? 36 : 30) + sh.open;
    if (pct <= openTop) {
      const mult = P.openSize;
      const to = bb * (S.pos === 'sb' && S.n === 3 ? mult + 0.6 : mult);
      return raiseOrJam(S, to);
    }
    if (S.pos === 'sb') {
      // complete from the small blind with a decent chunk of hands
      const limpTop = (S.n === 2 ? 80 : 62) + sh.open;
      if (pct <= limpTop && L.canCall) return { type: 'call' };
    }
    return passive(L);
  }
  // facing limp(s): I can iso-raise or take a cheap flop
  const isoTop = 20 + sh.iso;
  if (pct <= isoTop || (pct <= isoTop + 8 && rnd() < 0.5 * P.aggr)) {
    if (depth <= CFG.ZONE_A_MAX && pct <= isoTop - 4) return jamMove(L);
    return raiseOrJam(S, bb * (3 + st.limpers.length));
  }
  if (S.pos === 'sb') {
    const limpTop = 62 + sh.open;
    if (pct <= limpTop && L.canCall) return { type: 'call' };
    return FOLD;
  }
  return passive(L);
}

function facingRaise(S, st, P, sh, cls, pct, depth, rnd, rng) {
  const L = S.L, bb = S.bb, me = S.seat;
  const [h0, h1] = S.hole;
  const raiser = st.raiser;
  const pay = L.callAmount;
  const potAfter = S.pot + pay;
  const need = pay / potAfter;
  const raiseToBB = st.raiseTo / bb;
  const jam = jamLike(S, raiser, st.raiseTo) || pay >= S.stack;
  // villain ranges: raiser plus other live players that already put money in
  const vr = [];
  const base = villainPreflopRange(S, st, raiser, false);
  vr.push(base);
  for (const o of S.live) {
    if (o === raiser) continue;
    const r = st.role[o];
    if (r === 'call' || r === 'limp') vr.push(villainPreflopRange(S, st, o, false));
  }
  for (const r of vr) removeDead(r, S.hole);
  const eq = equity(h0, h1, [], vr.slice(0, 2), CFG.EQ_SAMPLES, rng);
  if (jam) {
    // calling a jam: no realisation issue, just pot odds (+ a little margin for the field behind / persona)
    const margin = 0.01 - (sh.call / 100) * 0.12;
    return eq >= need + margin ? { type: 'call' } : FOLD;
  }
  // sized raise: 3-bet shove with strong hands (and a few bluffs), call with realised equity, else fold
  const oop = S.pos !== 'btn' || S.n === 2 && S.pos === 'bb';
  const R = realization(S, depth, oop);
  const shoveTop = 6 + Math.max(0, (22 - depth)) * 0.45 + sh.jam * 0.5;
  const canShove = L.maxRaiseTo != null && depth <= 26;
  if (canShove && pct <= shoveTop) return jamMove(L);
  if (canShove && depth <= 20 && pct > shoveTop && pct <= shoveTop + 14) {
    // bluff candidates: suited aces / suited connectors, and the occasional blocker hand
    const bluffy = isBluffCandidate(cls);
    if (bluffy && rnd() < 0.5 * P.bluff * P.aggr) return jamMove(L);
  }
  if (eq * R >= need + (S.live.length > 1 ? 0.02 : 0) - sh.call * 0.0015) return { type: 'call' };
  return FOLD;
}

const NAMES_SUITED_BLUFF = new Set(['A5s', 'A4s', 'A3s', 'A2s', 'KQs', 'K9s', '76s', '65s', '54s', 'QJs', 'JTs', 'T9s']);
function isBluffCandidate(cls) { return NAMES_SUITED_BLUFF.has(HANDS[cls]); }

// ---------- exploiting how often the opponents fold to jams (observed in this tournament's log)
// Returns true/false (jam / don't) when an opponent's observed call rate differs clearly from the Nash call rate, else null.
function exploitJam(S, h0, h1, stackBB, rng, sh) {
  const stats = statsOf(S);
  const me = S.seat;
  const opps = S.live;
  const info = [];
  let deviates = false;
  for (const v of opps) {
    let node;
    if (S.n === 2) node = 'hc';
    else if (me === S.button) node = v === S.sbSeat ? 'sc' : 'b2';
    else node = 'b1';
    const p0 = massPct(nodeProbs(node, Math.min(stackBB, node === 'hc' ? HU_MAX : TW_MAX))) / 100;
    const sv = stats[v];
    const k = 4;
    const calls = sv ? sv.faceJam - sv.faceJamFold : 0, nJ = sv ? sv.faceJam : 0;
    const c = (calls + k * p0) / (nJ + k);
    if (nJ >= 1 && Math.abs(c - p0) >= 0.12) deviates = true;
    info.push({ v, c, p0 });
  }
  if (!deviates) return null;
  const H = S.start[me], bh = S.bet[me];
  const [a, b] = [info[0], info[1]];
  const mk = (x) => { const r = bandRange(0, Math.min(100, Math.max(3, x.c * 100))); removeDead(r, S.hole); return r; };
  const R1 = mk(a), R2 = b ? mk(b) : null;
  const E1 = Math.min(H, S.start[a.v]);
  const d1 = S.bet[a.v];
  const N = 700;
  const eq1 = equity(h0, h1, [], [R1], N, rng);
  let ev = 0;
  if (!b) {
    ev = (1 - a.c) * d1 + a.c * (eq1 * 2 * E1 - E1);
  } else {
    const E2 = Math.min(H, S.start[b.v]), d2 = S.bet[b.v];
    const eq2 = equity(h0, h1, [], [R2], N, rng);
    const eq12 = equity(h0, h1, [], [R1, R2], N, rng);
    const Hm = Math.min(H, Math.max(S.start[a.v], S.start[b.v]));
    ev = (1 - a.c) * (1 - b.c) * (d1 + d2)
      + a.c * (1 - b.c) * (eq1 * (2 * E1 + d2) - E1)
      + (1 - a.c) * b.c * (eq2 * (2 * E2 + d1) - E2)
      + a.c * b.c * (eq12 * (E1 + E2 + Hm) - Hm);
  }
  const delta = ev + bh; // versus folding (losing the blind already posted)
  return delta > (-sh.jam * 0.01) * S.bb * 0.5;
}
