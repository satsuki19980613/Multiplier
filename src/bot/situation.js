// Turns a seat's view (viewFor) into a decision context: positions, stacks in bb, who did what this hand (parsed from the log).
// Uses only fields that are visible in the view.
import { legalActions } from '../engine.js';

const RE_ACT = /^\{(\d)\} (folds|checks|calls (\d+)|bets (\d+)|raises to (\d+))( \(all-in\))?$/;
const RE_POST = /^\{(\d)\} posts (SB|BB) (\d+)/;

const textOf = (e) => (e.text !== undefined ? e.text : e);
const streetOf = (t) => {
  if (t.startsWith('Flop:')) return 'flop';
  if (t.startsWith('Turn:')) return 'turn';
  if (t.startsWith('River:')) return 'river';
  return null;
};
// one log line of `street` => { seat, street, type, to, pay, allIn }, or null when it is not an action
function parseLine(t, street) {
  let m = RE_POST.exec(t);
  if (m) return { seat: +m[1], street, type: m[2] === 'SB' ? 'sb' : 'bb', to: +m[3], pay: +m[3], allIn: t.includes('(all-in)') };
  m = RE_ACT.exec(t);
  if (!m) return null;
  const seat = +m[1], allIn = !!m[6];
  if (m[2] === 'folds') return { seat, street, type: 'fold', allIn: false };
  if (m[2] === 'checks') return { seat, street, type: 'check', allIn: false };
  if (m[3] !== undefined) return { seat, street, type: 'call', pay: +m[3], allIn };
  if (m[4] !== undefined) return { seat, street, type: 'bet', to: +m[4], allIn };
  return { seat, street, type: 'raise', to: +m[5], allIn };
}

// Parse the current hand's actions from view.log. => [{ seat, street, type, to, pay, allIn }]
export function parseHand(view) {
  const log = view.log || [];
  let start = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    const t = textOf(log[i]);
    if (typeof t === 'string' && t.startsWith('Hand ' + view.handNo + ' ')) { start = i + 1; break; }
  }
  const acts = [];
  let street = 'preflop';
  for (let i = start; i < log.length; i++) {
    const t = textOf(log[i]);
    if (typeof t !== 'string') continue;
    const s = streetOf(t);
    if (s) { street = s; continue; }
    const a = parseLine(t, street);
    if (a) acts.push(a);
  }
  return acts;
}

// Build the context. Throws if it is not `seat`'s turn.
export function analyze(view, seat) {
  const L = legalActions(view);
  if (!L || L.seat !== seat) throw new Error('bot: not my turn');
  const bb = view.bb;
  const alive = [0, 1, 2].filter((i) => !view.seats[i].out);
  const n = alive.length;
  const button = view.button;
  const nextAlive = (s) => { do { s = (s + 1) % 3; } while (view.seats[s].out); return s; };
  const sbSeat = n === 2 ? button : nextAlive(button);
  const bbSeat = nextAlive(sbSeat);
  const hu = n === 2;
  const posOf = (s) => {                                // in HU the button is the sb
    if (s === bbSeat) return 'bb';
    return s === sbSeat ? 'sb' : 'btn';
  };
  const start = view.handStart || view.seats.map((s, i) => s.stack + view.total[i]);
  const startBB = start.map((x) => x / bb);
  const behind = view.seats.map((s) => s.stack);
  const acts = parseHand(view);
  const opps = alive.filter((s) => s !== seat);
  const live = opps.filter((s) => !view.folded[s]);
  const pot = L.pot;
  const hole = view.holes[seat];
  // max stack among live opponents (hand-start) -> effective stack vs the biggest opponent still in the hand
  let effBehind = 0;
  for (const o of live) effBehind = Math.max(effBehind, behind[o] + view.bet[o]);
  const myTotalStack = behind[seat] + view.bet[seat];
  const effNow = Math.min(myTotalStack, effBehind); // chips (this street's start) the two can still fight for
  return {
    view, seat, hole, board: view.board, street: view.street, bb, sb: view.sb, n, hu, alive, opps, live,
    posOf, pos: posOf(seat), sbSeat, bbSeat, button,
    start, startBB, behind, stack: behind[seat], bet: view.bet, total: view.total, pot, L,
    toCall: L.toCall, acts, effNow, effNowBB: effNow / bb, names: view.names,
  };
}
