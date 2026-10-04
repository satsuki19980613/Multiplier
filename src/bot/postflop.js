// Postflop: estimate each villain's range from the preflop story and the actions on each street, compute Monte-Carlo
// equity against those ranges, then decide with SPR / pot-odds rules (docs/research/05-bot.md §1).
import { preflopStory, villainPreflopRange, raiseOrJam, jamMove, FOLD } from './preflop.js';
import { removeDead, equity, narrow } from './range.js';
import { drawOuts } from './eval.js';

export const PF = { EQ_SAMPLES: 2000 };

// Replay this hand's postflop actions and narrow each live villain's range accordingly.
function villainRanges(S, st) {
  const view = S.view, me = S.seat;
  const board = view.board;
  const ranges = new Map();
  const dead = S.hole.concat(board);
  for (const o of S.live) {
    const r = villainPreflopRange(S, st, o, true);
    removeDead(r, dead);
    ranges.set(o, r);
  }
  // pot at the start of the first postflop street
  let pot = 0, level = 0;
  const bets = [0, 0, 0];
  let curStreet = 'preflop';
  let streetBoardLen = 0;
  const lens = { flop: 3, turn: 4, river: 5 };
  for (const a of S.acts) {
    if (a.street !== curStreet) {
      curStreet = a.street; bets[0] = bets[1] = bets[2] = 0; level = 0;
    }
    if (a.type === 'sb' || a.type === 'bb') { pot += a.pay; bets[a.seat] += a.pay; level = Math.max(level, bets[a.seat]); continue; }
    const add = a.type === 'call' ? a.pay : (a.type === 'bet' || a.type === 'raise') ? a.to - bets[a.seat] : 0;
    if (a.street !== 'preflop' && a.seat !== me && ranges.has(a.seat)) {
      const b = board.slice(0, lens[a.street]);
      const dd = S.hole;
      const cur = ranges.get(a.seat);
      let nr = null;
      if (a.type === 'bet') nr = narrow(cur, b, 'bet', add / Math.max(pot, 1), dd);
      else if (a.type === 'raise') nr = narrow(cur, b, 'raise', add / Math.max(pot, 1), dd);
      else if (a.type === 'call') nr = narrow(cur, b, 'call', 0, dd);
      else if (a.type === 'check') nr = narrow(cur, b, 'check', 0, dd);
      if (nr) { removeDead(nr, dead); ranges.set(a.seat, nr); }
    }
    pot += add; bets[a.seat] += add;
    if (a.type === 'bet' || a.type === 'raise') level = a.to;
  }
  return ranges;
}

// order of action postflop among live seats: returns true if hero acts last
function heroInPosition(S) {
  const order = S.n === 2 ? [S.bbSeat, S.sbSeat] : [S.sbSeat, S.bbSeat, S.button];
  const idx = (s) => order.indexOf(s);
  return S.live.every((o) => idx(S.seat) > idx(o));
}

const BASE_BLUFF = { flop: 0.5, turn: 0.28, river: 0.2 };

export function postflopMove(S, P, rnd, rng) {
  const L = S.L, me = S.seat, bb = S.bb;
  const st = preflopStory(S);
  const board = S.board, nb = board.length;
  const [h0, h1] = S.hole;
  const ranges = villainRanges(S, st);
  const active = S.live.filter((o) => S.behind[o] > 0 || S.bet[o] > 0);
  const vlist = S.live.map((o) => ranges.get(o));
  const eq = equity(h0, h1, board, vlist.slice(0, 2), nb === 5 ? PF.EQ_SAMPLES * 1.2 : PF.EQ_SAMPLES, rng);
  const nv = S.live.length;
  const nAct = S.live.filter((o) => S.behind[o] > 0).length; // opponents who can still act
  const ip = heroInPosition(S);
  const pot = S.pot, toCall = L.toCall, stack = S.stack;
  const effBehind = Math.min(stack, Math.max(0, ...S.live.map((o) => S.behind[o] + S.bet[o])) - (S.bet[me] > 0 ? 0 : 0));
  const spr = effBehind / Math.max(pot, 1);
  const street = S.street;
  const outs = nb < 5 ? drawOuts(h0, h1, board, nb) : 0;
  const wasAggressor = st.raiser === me;
  const multi = nv > 1;
  // value thresholds (equity vs a narrowed range; more opponents -> lower equity thresholds)
  const strong = multi ? 0.60 : 0.74;
  const good = multi ? 0.48 : 0.60;
  const thin = multi ? 0.40 : 0.53;

  const betTo = (frac) => {
    const amt = Math.max(bb, Math.round(pot * frac));
    return raiseOrJam(S, S.bet[me] + amt);
  };

  // ------------------------------------------------ facing a bet
  if (toCall > 0) {
    const need = toCall / (pot + toCall);
    const allInCall = toCall >= stack;
    let R = street === 'river' || allInCall ? 1 : ip ? 0.96 : 0.88;
    if (spr <= 1.5) R = 1;
    // what bet-size did the villain use? (relative to the pot before the bet)
    const f = toCall / Math.max(1, pot - toCall);
    const bluffCoef = P.bluff;
    // raise for value
    if (L.maxRaiseTo != null && !allInCall) {
      const raiseThr = multi ? 0.72 : 0.82;
      if (eq >= raiseThr && rnd() < 0.85 * Math.min(1, P.aggr)) {
        if (spr <= 3) return jamMove(L);
        return raiseOrJam(S, S.bet[me] + toCall + (pot + toCall) * (0.8 + 0.2 * P.aggr));
      }
      // semi-bluff raise with a strong draw
      if (street !== 'river' && outs >= 9 && eq >= 0.32 && !multi && rnd() < 0.28 * P.aggr * bluffCoef) {
        if (spr <= 2.5) return jamMove(L);
        return raiseOrJam(S, S.bet[me] + toCall + (pot + toCall) * 0.9);
      }
    }
    if (eq * R >= need + P.callMargin) return { type: 'call' };
    // pot-committed with a hand that has real equity
    if (spr <= 1.0 && eq >= need * 0.92) return { type: 'call' };
    return FOLD;
  }

  // ------------------------------------------------ nothing to call: bet or check
  const canBet = L.maxRaiseTo != null;
  if (!canBet) return { type: 'check' };
  const aggr = P.aggr;
  const ipBonus = ip ? 1 : 0.85;

  if (eq >= strong) {
    const slow = street === 'flop' && ip && !multi && spr > 3 && eq > 0.9 && rnd() < 0.18;
    if (slow) return { type: 'check' };
    if (rnd() < Math.min(0.97, 0.88 * aggr + 0.1)) {
      if (spr <= 1.5) return jamMove(L);
      return betTo(street === 'river' ? 0.75 : 0.66 * Math.min(1.15, aggr));
    }
    return { type: 'check' };
  }
  if (eq >= good) {
    if (spr <= 1.2) return jamMove(L);
    if (rnd() < 0.75 * aggr * ipBonus) return betTo(multi ? 0.5 : 0.5);
    return { type: 'check' };
  }
  if (eq >= thin) {
    if (street === 'river') {
      if (ip && rnd() < 0.35 * aggr) return betTo(0.33);
      return { type: 'check' };
    }
    if (ip && !multi && rnd() < 0.3 * aggr) return betTo(0.33);
    return { type: 'check' };
  }
  // weak: draws and bluffs
  if (street !== 'river' && outs >= 8 && !(multi && nAct > 1 && eq < 0.2)) {
    const p = (multi ? 0.22 : 0.5) * aggr * P.bluff * ipBonus;
    if (spr <= 2 && outs >= 12) return jamMove(L);
    if (rnd() < p) return betTo(0.6);
    return { type: 'check' };
  }
  // pure bluffs: c-bet as preflop aggressor, a few turn/river barrels
  let pb = BASE_BLUFF[street] * P.bluff * ipBonus * aggr;
  if (multi) pb *= 0.3;
  if (!wasAggressor && street === 'flop') pb *= 0.4;
  if (street === 'river') {
    // use hands without showdown value; blockers (an overcard to the board) are slightly better bluffs
    if (eq > 0.2) pb *= 0.2;
    const bt = Math.max(...board.map((c) => c >> 2));
    if ((h0 >> 2) >= bt || (h1 >> 2) >= bt) pb *= 1.3;
  }
  if (spr <= 1.0) pb *= 0.3; // no point bluffing tiny stacks into commitment
  if (rnd() < pb) return betTo(street === 'river' ? 0.7 : 0.4);
  return { type: 'check' };
}
