// Multiplier bot (docs/ARCHITECTURE.md §5, docs/research/05-bot.md).
// botMove(view, seat, { persona, rnd }) => move for applyAction. Pure: the only inputs are the seat's view and `rnd`.
//  - <= ~12bb (and a jam/fold zone to ~17bb): Nash push/fold tables (src/bot/nashdata.js), mixed by rnd
//  - deeper: strength bands + range-vs-range equity; postflop: range estimate -> Monte-Carlo equity -> SPR/pot-odds rules
import { analyze } from './bot/situation.js';
import { preflopMove } from './bot/preflop.js';
import { postflopMove } from './bot/postflop.js';
import { makeLocalRng } from './bot/range.js';

export const PERSONAS = ['tight', 'loose', 'aggro'];

// Width shifts are in percentage points of all hands; all personas stay in the "medium to strong" zone (±10pt costs little).
export const PERSONA_PARAMS = {
  tight: { jamD: -3, callD: -2.5, openD: -6, isoD: -5, aggr: 0.9, bluff: 0.7, openSize: 2.2, callMargin: 0.02 },
  loose: { jamD: 5, callD: 4, openD: 9, isoD: 4, aggr: 1.0, bluff: 1.0, openSize: 2.2, callMargin: -0.015 },
  aggro: { jamD: 4, callD: 1, openD: 7, isoD: 10, aggr: 1.3, bluff: 1.5, openSize: 2.5, callMargin: -0.005 },
};

// fixed per-bot quirk in [-1, 1] derived from the display name (stable across hands, no per-decision noise)
function quirkOf(name) {
  let h = 2166136261;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 2001) / 1000 - 1;
}

function legalFallback(L) {
  if (L.canCheck) return { type: 'check' };
  return { type: 'fold' };
}

// make sure the move is legal; repair if not
function sanitize(move, L) {
  if (!move || !move.type) return legalFallback(L);
  switch (move.type) {
    case 'fold': return L.canCheck ? { type: 'check' } : { type: 'fold' };
    case 'check': return L.canCheck ? { type: 'check' } : { type: 'fold' };
    case 'call': return L.canCall ? { type: 'call' } : { type: 'check' };
    case 'raise': {
      if (L.minRaiseTo == null) return L.canCall ? { type: 'call' } : { type: 'check' };
      let to = Math.round(Number(move.to));
      if (!Number.isFinite(to)) to = L.minRaiseTo;
      to = Math.max(L.minRaiseTo, Math.min(L.maxRaiseTo, to));
      return { type: 'raise', to };
    }
    default: return legalFallback(L);
  }
}

export function botMove(view, seat, { persona = 'tight', rnd = Math.random } = {}) {
  const S = analyze(view, seat); // throws if it is not this seat's turn
  const L = S.L;
  try {
    const base = PERSONA_PARAMS[persona] || PERSONA_PARAMS.tight;
    const P = { ...base, quirk: quirkOf(S.names && S.names[seat]) };
    const rng = makeLocalRng(rnd);
    const move = S.street === 'preflop' ? preflopMove(S, P, rnd, rng) : postflopMove(S, P, rnd, rng);
    return sanitize(move, L);
  } catch (e) {
    if (typeof process !== 'undefined' && process.env && process.env.BOT_DEBUG) throw e;
    return legalFallback(L);
  }
}
