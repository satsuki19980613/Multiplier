// Turns a seat's view (viewFor) into a decision context: positions, stacks in bb, who did what this hand (parsed from the log).
// Uses only fields that are visible in the view.
import { legalActions } from '../engine.js';

const RE_ACT = /^\{(\d)\} (folds|checks|calls (\d+)|bets (\d+)|raises to (\d+))( \(all-in\))?$/;
const RE_POST = /^\{(\d)\} posts (SB|BB) (\d+)/;

// Parse the current hand's actions from view.log. => [{ seat, street, type, to, pay, allIn }]
export function parseHand(view) {
  const log = view.log || [];
  let start = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    const t = log[i].text !== undefined ? log[i].text : log[i];
    if (typeof t === 'string' && t.startsWith('Hand ' + view.handNo + ' ')) { start = i + 1; break; }
  }
  const acts = [];
  let street = 'preflop';
  for (let i = start; i < log.length; i++) {
    const t = log[i].text !== undefined ? log[i].text : log[i];
    if (typeof t !== 'string') continue;
    if (t.startsWith('Flop:')) { street = 'flop'; continue; }
    if (t.startsWith('Turn:')) { street = 'turn'; continue; }
    if (t.startsWith('River:')) { street = 'river'; continue; }
    let m = RE_POST.exec(t);
    if (m) { acts.push({ seat: +m[1], street, type: m[2] === 'SB' ? 'sb' : 'bb', to: +m[3], pay: +m[3], allIn: t.includes('(all-in)') }); continue; }
    m = RE_ACT.exec(t);
    if (!m) continue;
    const seat = +m[1], allIn = !!m[6];
    if (m[2] === 'folds') acts.push({ seat, street, type: 'fold', allIn: false });
    else if (m[2] === 'checks') acts.push({ seat, street, type: 'check', allIn: false });
    else if (m[3] !== undefined) acts.push({ seat, street, type: 'call', pay: +m[3], allIn });
    else if (m[4] !== undefined) acts.push({ seat, street, type: 'bet', to: +m[4], allIn });
    else acts.push({ seat, street, type: 'raise', to: +m[5], allIn });
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
  const posOf = (s) => (s === bbSeat ? 'bb' : s === sbSeat ? 'sb' : 'btn'); // in HU the button is the sb
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
