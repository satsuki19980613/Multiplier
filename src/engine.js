// Multiplier rules engine: 3-handed No-Limit Hold'em tournament. Pure logic shared by the browser (fake net) and the game server.
// Spec: docs/ARCHITECTURE.md §3. The state `g` is a JSON-serialisable plain object; every random decision comes from a ChaCha20
// stream whose key lives in the state (g.seed, g.ctr), so the same seed always gives the same deals and a saved game can resume.
// Functions mutate `g` in place (and return it); an illegal call throws EngineError and leaves `g` untouched.
import { BLINDS } from './spin.js';

export const RANKCH = '23456789TJQKA';
export const SUITCH = ['♠', '♥', '♦', '♣'];
export const cardStr = c => RANKCH[c >> 2] + SUITCH[c & 3];

export class EngineError extends Error {
  constructor(code, message) { super(message || code); this.name = 'EngineError'; this.code = code; }
}

/* ---------------- hand evaluation (bit tricks, no lookup tables) ---------------- */
// score = category << 20 | five 4-bit rank slots (rank 0='2' … 12='A'; the wheel counts as 5-high = 3).
// category: 0 High Card, 1 Pair, 2 Two Pair, 3 Three of a Kind, 4 Straight, 5 Flush, 6 Full House, 7 Four of a Kind, 8 Straight Flush.
const hb = m => 31 - Math.clz32(m);                       // index of the highest set bit
function take(m, n) { let v = 0; for (let i = 0; i < n; i++) { const h = hb(m); v = (v << 4) | h; m ^= 1 << h; } return v; }
function straightTop(m) {                                  // m: 13-bit rank mask => top rank of the best straight, or -1
  const x = (m << 1) | (m >> 12);                          // bit 0 = ace as the low card, bit r+1 = rank r
  const t = x & (x >> 1) & (x >> 2) & (x >> 3) & (x >> 4);
  return t ? hb(t) + 3 : -1;
}
export function eval7(cards) {                             // 5 to 7 cards => integer score (bigger is stronger)
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, n0 = 0, n1 = 0, n2 = 0, n3 = 0, one = 0, two = 0, three = 0, four = 0;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i], b = 1 << (c >> 2);
    switch (c & 3) { case 0: s0 |= b; n0++; break; case 1: s1 |= b; n1++; break; case 2: s2 |= b; n2++; break; default: s3 |= b; n3++; }
    four |= three & b; three |= two & b; two |= one & b; one |= b;
  }
  const fm = n0 >= 5 ? s0 : n1 >= 5 ? s1 : n2 >= 5 ? s2 : n3 >= 5 ? s3 : 0;
  if (fm) { const t = straightTop(fm); if (t >= 0) return (8 << 20) | (t << 16); }
  if (four) { const q = hb(four); return (7 << 20) | (q << 16) | (hb(one & ~(1 << q)) << 12); }
  if (three) {
    const t = hb(three), rest = two & ~(1 << t);
    if (rest) return (6 << 20) | (t << 16) | (hb(rest) << 12);
  }
  if (fm) return (5 << 20) | take(fm, 5);
  const st = straightTop(one);
  if (st >= 0) return (4 << 20) | (st << 16);
  if (three) { const t = hb(three); return (3 << 20) | (t << 16) | (take(one & ~(1 << t), 2) << 8); }
  if (two) {
    const p1 = hb(two), r = two ^ (1 << p1);
    if (r) { const p2 = hb(r); return (2 << 20) | (p1 << 16) | (p2 << 12) | (hb(one & ~(1 << p1) & ~(1 << p2)) << 8); }
    return (1 << 20) | (p1 << 16) | (take(one & ~(1 << p1), 3) << 4);
  }
  return take(one, 5);
}
const HAND_NAMES = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];
export function handName(score) {
  const c = score >>> 20;
  if (c === 8 && ((score >>> 16) & 15) === 12) return 'Royal Flush';
  return HAND_NAMES[c];
}

/* ---------------- RNG: ChaCha20 keystream (key = g.seed, 8 words; block counter = g.ctr) ---------------- */
const rotl = (x, n) => (x << n) | (x >>> (32 - n));
function qr(x, a, b, c, d) {
  x[a] = (x[a] + x[b]) | 0; x[d] = rotl(x[d] ^ x[a], 16);
  x[c] = (x[c] + x[d]) | 0; x[b] = rotl(x[b] ^ x[c], 12);
  x[a] = (x[a] + x[b]) | 0; x[d] = rotl(x[d] ^ x[a], 8);
  x[c] = (x[c] + x[d]) | 0; x[b] = rotl(x[b] ^ x[c], 7);
}
export function chachaBlock(inp) {                         // 16 input words => 16 output words (RFC 7539 block function)
  const x = Int32Array.from(inp);
  for (let i = 0; i < 10; i++) {
    qr(x, 0, 4, 8, 12); qr(x, 1, 5, 9, 13); qr(x, 2, 6, 10, 14); qr(x, 3, 7, 11, 15);
    qr(x, 0, 5, 10, 15); qr(x, 1, 6, 11, 12); qr(x, 2, 7, 8, 13); qr(x, 3, 4, 9, 14);
  }
  const out = new Uint32Array(16);
  for (let i = 0; i < 16; i++) out[i] = (x[i] + inp[i]) >>> 0;
  return out;
}
function stream(g) {
  const st = new Uint32Array(16);
  st[0] = 0x61707865; st[1] = 0x3320646e; st[2] = 0x79622d32; st[3] = 0x6b206574;
  for (let i = 0; i < 8; i++) st[4 + i] = g.seed[i];
  let blk = g.ctr, buf = null, i = 16;
  const next = () => {
    if (i === 16) { st[12] = blk >>> 0; st[13] = Math.floor(blk / 4294967296); buf = chachaBlock(st); blk++; i = 0; }
    return buf[i++];
  };
  return {
    below(n) { const lim = 4294967296 - (4294967296 % n); let w; do { w = next(); } while (w >= lim); return w % n; },
    done() { g.ctr = blk; },
  };
}
function freshDeck(g) {
  const s = stream(g), d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) { const j = s.below(i + 1); const t = d[i]; d[i] = d[j]; d[j] = t; }
  s.done();
  return d;
}

/* ---------------- helpers ---------------- */
const SEATS = [0, 1, 2];
const MAX_LOG = 400;
function log(g, text) { g.log.push({ text }); if (g.log.length > MAX_LOG) g.log.splice(0, g.log.length - MAX_LOG); }
const sum = a => a.reduce((s, x) => s + x, 0);
function nextAlive(g, s) { do { s = (s + 1) % 3; } while (g.seats[s].out); return s; }

export function levelAt(g, now) {
  const l = Math.floor((now - g.startedAt) / g.levelMs);
  return l <= 0 ? 0 : l >= BLINDS.length ? BLINDS.length - 1 : l;
}
export function actor(g) { return g.over ? null : g.toAct; }

/* ---------------- creation ---------------- */
// opts: { stack, levelMs, now, rnd, names } as in the contract, plus optional { stacks: [s0,s1,s2] (a 0 means the seat is out, for tests),
// button } to start from a given position.
export function newGame({ stack, levelMs, now = 0, rnd, names, stacks, button } = {}) {
  const st = stacks ? stacks.slice() : [stack, stack, stack];
  if (st.length !== 3 || !st.every(x => Number.isInteger(x) && x >= 0) || st.filter(x => x > 0).length < 2) throw new Error('newGame: bad stacks');
  if (!(levelMs > 0)) throw new Error('newGame: levelMs required');
  const seed = [];
  if (rnd) for (let i = 0; i < 8; i++) seed.push(Math.floor(rnd() * 4294967296) >>> 0);
  else seed.push(...globalThis.crypto.getRandomValues(new Uint32Array(8)));
  const g = {
    ver: 0, startedAt: now, levelMs, level: 0, sb: BLINDS[0][0], bb: BLINDS[0][1], handAt: now,
    names: names ? names.slice(0, 3) : ['Player 1', 'Player 2', 'Player 3'],
    seats: st.map(s => ({ stack: s, out: s <= 0 })),
    button: 0, handNo: 0, seed, ctr: 0, deck: [], holes: [null, null, null], board: [], street: 'preflop', toAct: null,
    bet: [0, 0, 0], total: [0, 0, 0], folded: [false, false, false], allIn: [false, false, false],
    currentBet: 0, minRaise: BLINDS[0][1], handStart: st.slice(), seen: [null, null, null], needAct: [false, false, false],
    sbSeat: null, bbSeat: 0, actions: [], runFrom: null,
    lastHand: null, prevHands: [], places: [null, null, null], over: false, winner: null, log: [], forfeited: 0,
  };
  let b = button;
  if (b == null) { const s = stream(g); b = s.below(3); s.done(); }
  while (g.seats[b].out) b = (b + 1) % 3;
  // seats that start with no chips (only used to set up test positions) are already out: they take the worst places
  SEATS.filter(s => g.seats[s].out).sort((x, y) => y - x).forEach((s, i) => { g.places[s] = 3 - i; });
  dealHand(g, now, b);
  return g;
}

/* ---------------- dealing a hand ---------------- */
function post(g, seat, amount, label) {
  const pay = Math.min(amount, g.seats[seat].stack);
  g.seats[seat].stack -= pay; g.bet[seat] += pay; g.total[seat] += pay;
  if (g.seats[seat].stack === 0) g.allIn[seat] = true;
  log(g, `{${seat}} posts ${label} ${pay}${g.allIn[seat] ? ' (all-in)' : ''}`);
}
function dealHand(g, now, firstButton) {
  const alive = SEATS.filter(i => !g.seats[i].out);
  let button = firstButton;
  if (button == null) button = nextAlive(g, g.button);
  const prevLevel = g.level;
  g.button = button; g.handNo++; g.handAt = now;
  g.level = levelAt(g, now); [g.sb, g.bb] = BLINDS[g.level];
  if (g.handNo > 1 && g.level > prevLevel) log(g, `Blinds up to ${g.sb}/${g.bb}`);
  log(g, `Hand ${g.handNo} · Blinds ${g.sb}/${g.bb} · Button {${button}}`);
  g.deck = freshDeck(g);
  g.holes = [null, null, null]; g.board = []; g.street = 'preflop';
  g.bet = [0, 0, 0]; g.total = [0, 0, 0];
  g.folded = SEATS.map(i => g.seats[i].out); g.allIn = [false, false, false];
  g.handStart = g.seats.map(s => s.stack);
  g.seen = [null, null, null]; g.actions = []; g.runFrom = null;
  const order = []; for (let k = 1; k <= 3; k++) { const s = (button + k) % 3; if (!g.seats[s].out) order.push(s); }
  for (const s of order) g.holes[s] = [g.deck.pop(), g.deck.pop()];
  const sbSeat = alive.length === 2 ? button : nextAlive(g, button);
  const bbSeat = nextAlive(g, sbSeat);
  g.sbSeat = sbSeat; g.bbSeat = bbSeat;
  post(g, sbSeat, g.sb, 'SB'); post(g, bbSeat, g.bb, 'BB');
  g.currentBet = g.bb; g.minRaise = g.bb;
  g.needAct = SEATS.map(i => !g.folded[i] && !g.allIn[i]);
  g.toAct = null;
  progress(g, now, bbSeat);
}

/* ---------------- betting flow ---------------- */
// The seat that must act next (searching after `from`), or -1 when the betting round is complete.
function findActor(g, from) {
  const live = SEATS.filter(i => !g.folded[i] && !g.allIn[i]);
  if (live.length === 0) return -1;
  if (live.length === 1) {
    const s = live[0];
    let maxOther = 0; for (const o of SEATS) if (o !== s && !g.folded[o]) maxOther = Math.max(maxOther, g.bet[o]);
    if (g.bet[s] >= maxOther) return -1;                   // nobody left to bet against and everything is matched
    return s;
  }
  for (let k = 1; k <= 3; k++) { const s = (from + k) % 3; if (g.needAct[s] && !g.folded[s] && !g.allIn[s]) return s; }
  return -1;
}
function nextStreet(g) {
  const order = ['preflop', 'flop', 'turn', 'river'], i = order.indexOf(g.street) + 1;
  g.street = order[i];
  g.deck.pop();                                            // burn
  const n = i === 1 ? 3 : 1, cs = [];
  for (let k = 0; k < n; k++) cs.push(g.deck.pop());
  g.board.push(...cs);
  log(g, `${i === 1 ? 'Flop' : i === 2 ? 'Turn' : 'River'}: ${cs.map(cardStr).join(' ')}`);
  g.bet = [0, 0, 0]; g.currentBet = 0; g.minRaise = g.bb; g.seen = [null, null, null];
  g.needAct = SEATS.map(s => !g.folded[s] && !g.allIn[s]);
}
function progress(g, now, from) {
  for (;;) {
    if (SEATS.filter(i => !g.folded[i]).length < 2) return finishHand(g, now);
    const a = findActor(g, from);
    if (a >= 0) { g.toAct = a; return; }
    // nobody (or only one seat) can still bet: the hole cards go face up here and the rest of the board is dealt (the screen runs it out from here)
    if (g.runFrom == null && SEATS.filter(i => !g.folded[i] && !g.allIn[i]).length <= 1) g.runFrom = g.board.length;
    if (g.street === 'river') return finishHand(g, now);
    nextStreet(g); from = g.button;
  }
}

function canRaiseNow(g, s) { return g.seen[s] == null || g.currentBet - g.seen[s] >= g.minRaise; }

export function legalActions(g) {
  const s = g.toAct;
  if (g.over || s == null) return null;
  const stack = g.seats[s].stack, bet = g.bet[s], toCall = Math.max(0, g.currentBet - bet);
  let minRaiseTo = null, maxRaiseTo = null;
  const opp = SEATS.some(o => o !== s && !g.folded[o] && !g.allIn[o]);
  if (opp && stack > toCall && canRaiseNow(g, s)) {
    maxRaiseTo = bet + stack;
    minRaiseTo = Math.min(g.currentBet + g.minRaise, maxRaiseTo);
  }
  return {
    seat: s, street: g.street, toCall, canCheck: toCall === 0, canCall: toCall > 0, callAmount: Math.min(toCall, stack),
    minRaiseTo, maxRaiseTo, pot: sum(g.total),
  };
}

// One record per action of the hand in g.actions (blinds are not actions): { seat, kind, betTo, put, auto, street }.
// kind: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin' (any action that puts the seat's last chip in); betTo: the seat's total for the
// street after it (fold / check: the bet faced); put: chips added; auto: a substitute move (time-out, retire); street: 0 preflop … 3 river.
const STREET_NO = { preflop: 0, flop: 1, turn: 2, river: 3 };
function record(g, seat, kind, betTo, put, auto) { (g.actions ||= []).push({ seat, kind, betTo, put, auto: !!auto, street: STREET_NO[g.street] }); }

// auto = a substitute move (autoAction): only marks the record
export function applyAction(g, seat, move, now, auto = false) {
  if (g.over) throw new EngineError('game_over');
  if (g.toAct !== seat) throw new EngineError('not_your_turn');
  const L = legalActions(g), type = move && move.type;
  const bad = m => new EngineError('illegal', m);
  const st = g.seats[seat];
  if (type === 'fold') {
    g.folded[seat] = true; g.needAct[seat] = false;
    record(g, seat, 'fold', g.currentBet, 0, auto);
    log(g, `{${seat}} folds`);
  } else if (type === 'check') {
    if (!L.canCheck) throw bad('cannot check');
    g.needAct[seat] = false; g.seen[seat] = g.currentBet;
    record(g, seat, 'check', g.currentBet, 0, auto);
    log(g, `{${seat}} checks`);
  } else if (type === 'call') {
    if (!L.canCall) throw bad('nothing to call');
    const pay = L.callAmount;
    st.stack -= pay; g.bet[seat] += pay; g.total[seat] += pay;
    if (st.stack === 0) g.allIn[seat] = true;
    g.needAct[seat] = false; g.seen[seat] = g.currentBet;
    record(g, seat, g.allIn[seat] ? 'allin' : 'call', g.bet[seat], pay, auto);
    log(g, `{${seat}} calls ${pay}${g.allIn[seat] ? ' (all-in)' : ''}`);
  } else if (type === 'raise') {
    const to = move.to;
    if (L.minRaiseTo == null) throw bad('cannot raise');
    if (!Number.isInteger(to) || to < L.minRaiseTo || to > L.maxRaiseTo) throw bad('raise out of range');
    const add = to - g.bet[seat], prev = g.currentBet, open = prev === 0;
    st.stack -= add; g.bet[seat] = to; g.total[seat] += add;
    if (st.stack === 0) g.allIn[seat] = true;
    if (to - prev >= g.minRaise) g.minRaise = to - prev;   // a full raise; an incomplete all-in leaves the minimum untouched
    g.currentBet = to; g.seen[seat] = to; g.needAct[seat] = false;
    for (const o of SEATS) if (o !== seat && !g.folded[o] && !g.allIn[o]) g.needAct[o] = true;
    record(g, seat, g.allIn[seat] ? 'allin' : open ? 'bet' : 'raise', to, add, auto);
    log(g, `{${seat}} ${open ? 'bets' : 'raises to'} ${to}${g.allIn[seat] ? ' (all-in)' : ''}`);
  } else throw bad('unknown move');
  g.ver++;
  progress(g, now, seat);
  return g;
}

export function autoAction(g, seat, now) {
  if (g.over) throw new EngineError('game_over');
  if (g.toAct !== seat) throw new EngineError('not_your_turn');
  return applyAction(g, seat, { type: legalActions(g).canCheck ? 'check' : 'fold' }, now, true);
}

/* ---------------- retiring ---------------- */
// The seat leaves the tournament at once, at any moment (also when it is not its turn, or it is all-in). Its hand is folded (chips already in
// the pot stay there as dead money), its remaining stack leaves play into g.forfeited, and it takes the worst place still open.
// Chip invariant: sum(stacks) + sum(total) + forfeited === 3 * the starting stack. Throws EngineError('game_over' | 'illegal' (already out)).
export function forfeit(g, seat, now) {
  if (g.over) throw new EngineError('game_over');
  if (!SEATS.includes(seat) || g.seats[seat].out) throw new EngineError('illegal', 'seat is already out');
  const st = g.seats[seat], inHand = !g.folded[seat], wasTurn = g.toAct === seat, turn = g.toAct;
  log(g, `{${seat}} retires`);
  if (inHand) record(g, seat, 'fold', g.currentBet, 0, true);
  g.folded[seat] = true; g.needAct[seat] = false;
  g.forfeited = (g.forfeited || 0) + st.stack; st.stack = 0;
  g.places[seat] = SEATS.filter(s => !g.seats[s].out).length;   // 3rd if all three were alive, 2nd when heads-up
  st.out = true;
  g.ver++;
  if (inHand) {
    // finishHand deals the next hand itself, so the seat is already marked out above
    if (wasTurn) progress(g, now, seat);
    else if (turn != null) progress(g, now, (turn + 2) % 3);   // keep the seat to act where it is, unless the hand is now decided
  }
  const left = SEATS.filter(s => !g.seats[s].out);
  if (!g.over && left.length === 1) {                           // (only reachable if no hand was running)
    const w = left[0];
    g.over = true; g.winner = w; g.places[w] = 1; g.holes = [null, null, null]; g.toAct = null;
    log(g, `{${w}} wins the tournament`);
  }
  return g;
}

/* ---------------- end of hand ---------------- */
function finishHand(g, now) {
  const start = g.handStart, alive = SEATS.filter(i => !g.folded[i]), commits = g.total.slice();
  // uncalled part of the biggest contribution goes back to its owner (only a seat still in the hand: chips of a folded or retired seat stay in the pot)
  let uncalled = null;
  const top = alive.slice().sort((a, b) => g.total[b] - g.total[a])[0];
  const over0 = g.total[top] - Math.max(...SEATS.filter(s => s !== top).map(s => g.total[s]));
  if (over0 > 0) {
    g.seats[top].stack += over0; g.total[top] -= over0; uncalled = { seat: top, amount: over0 };
    log(g, `Uncalled bet ${over0} returned to {${top}}`);
  }
  // pots: one layer per distinct contribution level, adjacent layers with the same eligible seats are merged
  const levels = [...new Set(g.total.filter(t => t > 0))].sort((a, b) => a - b);
  const pots = []; let prev = 0;
  for (const lvl of levels) {
    let amount = 0; for (const s of SEATS) amount += Math.min(g.total[s], lvl) - Math.min(g.total[s], prev);
    let eligible = alive.filter(s => g.total[s] >= lvl);
    if (!eligible.length) eligible = alive.slice();
    const last = pots[pots.length - 1];
    if (last && last.eligible.join() === eligible.join()) last.amount += amount;
    else pots.push({ amount, eligible, winners: [] });
    prev = lvl;
  }
  // showdown
  const showdown = alive.length > 1;
  const shown = [null, null, null], names = [null, null, null], score = [null, null, null];
  if (showdown) {
    for (const s of alive) {
      shown[s] = g.holes[s].slice(); score[s] = eval7([...g.holes[s], ...g.board]); names[s] = handName(score[s]);
      log(g, `{${s}} shows ${shown[s].map(cardStr).join(' ')} (${names[s]})`);
    }
  }
  const win = [0, 0, 0], order = [1, 2, 3].map(k => (g.button + k) % 3);
  pots.forEach((p, idx) => {
    let ws = p.eligible;
    if (showdown) { const best = Math.max(...p.eligible.map(s => score[s])); ws = p.eligible.filter(s => score[s] === best); }
    p.winners = ws.slice();
    const share = Math.floor(p.amount / ws.length); let rem = p.amount - share * ws.length;
    const tag = pots.length > 1 ? (idx === 0 ? ' (main pot)' : ' (side pot)') : '';
    for (const s of order) if (ws.includes(s)) {          // odd chips go one by one from the seat left of the button
      const got = share + (rem > 0 ? 1 : 0); if (rem > 0) rem--;
      win[s] += got; log(g, `{${s}} wins ${got}${tag}${ws.length > 1 ? ' (split)' : ''}`);
    }
  });
  for (const s of SEATS) g.seats[s].stack += win[s];
  const net = SEATS.map(s => g.seats[s].stack - start[s]);
  const busted = SEATS.filter(s => !g.seats[s].out && g.seats[s].stack === 0);
  // the finished hand as the screen and the hand history need it. hole: everybody's cards (viewFor keeps only the seat's own and the shown ones);
  // commits: chips put in (before the uncalled part went back); won: chips taken from the table (the uncalled part included, so net = won - commits,
  // except for a seat that retired during the hand: its net also has the forfeited stack); runFrom: board size when the cards went face up
  // (null when the hand ended with a fold); retired: the seats that retired during the hand (already out, but not in eliminated).
  // prevHands keeps the four hands before it: with short stacks the next hands can be all-in from the blinds and finish in the same step
  // (a short stack that keeps winning can chain several), and the screen / the hand history must still see every hand
  if (g.lastHand) g.prevHands = [...(g.prevHands || []), g.lastHand].slice(-4);
  g.lastHand = {
    handNo: g.handNo, board: g.board.slice(), shown, pots, names, net, busted, endedAt: now, uncalled,
    startedAt: g.handAt, level: g.level, sb: g.sb, bb: g.bb, btn: g.button, sbSeat: g.sbSeat, bbSeat: g.bbSeat,
    start: start.slice(), commits, won: SEATS.map(s => win[s] + (uncalled && uncalled.seat === s ? uncalled.amount : 0)),
    hole: g.holes.map(h => (h ? h.slice() : null)), folded: g.folded.slice(), allIn: g.allIn.slice(), actions: (g.actions || []).map(a => ({ ...a })),
    runFrom: showdown ? g.runFrom ?? g.board.length : null, eliminated: [], retired: SEATS.filter(s => start[s] > 0 && g.seats[s].out),
  };
  g.total = [0, 0, 0]; g.bet = [0, 0, 0]; g.currentBet = 0; g.needAct = [false, false, false]; g.toAct = null;
  // eliminations: a bigger starting stack ranks higher; equal stacks: the lower seat number ranks higher
  const left = SEATS.filter(s => !g.seats[s].out).length;
  busted.sort((a, b) => start[a] - start[b] || b - a);
  busted.forEach((s, i) => {
    g.seats[s].out = true; g.places[s] = left - i; g.lastHand.eliminated.push({ seat: s, place: left - i });
    log(g, `{${s}} is eliminated (place ${left - i})`);
  });
  const survivors = SEATS.filter(s => !g.seats[s].out);
  if (survivors.length === 1) {
    const w = survivors[0];
    g.over = true; g.winner = w; g.places[w] = 1; g.holes = [null, null, null];
    log(g, `{${w}} wins the tournament`);
    return;
  }
  dealHand(g, now);
}
