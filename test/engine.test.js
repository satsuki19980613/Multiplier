// Rules engine: hand evaluation, RNG, betting rules, side pots, eliminations, and whole-tournament invariant fuzzing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, actor, legalActions, applyAction, autoAction, levelAt, eval7, handName, EngineError, RANKCH, cardStr, chachaBlock,
} from '../src/engine.js';
import { viewFor } from '../src/view.js';
import { BLINDS } from '../src/spin.js';

function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const c = s => RANKCH.indexOf(s[0]) * 4 + 'shdc'.indexOf(s[1]);       // 'As' = ace of spades
const cs = a => (typeof a === 'string' ? a.split(' ') : a).map(c);
const sum = a => a.reduce((x, y) => x + y, 0);

/* ---------------- hand evaluation ---------------- */
// An independent, deliberately plain eval5 (sort + group counting) with the same score layout as eval7.
function ref5(cards) {
  const r = cards.map(x => x >> 2).sort((a, b) => b - a), s0 = cards[0] & 3;
  const flush = cards.every(x => (x & 3) === s0);
  const cnt = new Map(); for (const x of r) cnt.set(x, (cnt.get(x) || 0) + 1);
  const g = [...cnt.entries()].map(([k, v]) => [v, k]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  let sh = -1;
  if (cnt.size === 5) { if (r[0] - r[4] === 4) sh = r[0]; else if (r[0] === 12 && r[1] === 3) sh = 3; }
  let cat, k;
  if (sh >= 0 && flush) { cat = 8; k = [sh]; } else if (g[0][0] === 4) { cat = 7; k = [g[0][1], g[1][1]]; }
  else if (g[0][0] === 3 && g[1][0] === 2) { cat = 6; k = [g[0][1], g[1][1]]; } else if (flush) { cat = 5; k = r; }
  else if (sh >= 0) { cat = 4; k = [sh]; } else if (g[0][0] === 3) { cat = 3; k = g.map(x => x[1]); }
  else if (g[0][0] === 2 && g[1][0] === 2) { cat = 2; k = g.map(x => x[1]); } else if (g[0][0] === 2) { cat = 1; k = g.map(x => x[1]); }
  else { cat = 0; k = r; }
  let v = cat; for (let i = 0; i < 5; i++) v = v * 16 + (k[i] || 0);
  return v;
}
function bestOfSubsets(cards, size) {                    // best ref5 over all 5-card subsets
  let best = -1;
  const n = cards.length;
  const rec = (start, pick) => {
    if (pick.length === 5) { best = Math.max(best, ref5(pick)); return; }
    for (let i = start; i < n; i++) { pick.push(cards[i]); rec(i + 1, pick); pick.pop(); }
  };
  rec(0, []);
  return best;
}
const randomCards = (rnd, n) => { const d = []; while (d.length < n) { const x = Math.floor(rnd() * 52); if (!d.includes(x)) d.push(x); } return d; };

test('eval7 matches the plain eval5 on random 5-card hands', () => {
  const rnd = mulberry(1);
  for (let n = 0; n < 150000; n++) { const d = randomCards(rnd, 5); assert.equal(eval7(d), ref5(d), d.map(cardStr).join(' ')); }
});

test('eval7 equals the best of the five-card subsets (random 7- and 6-card hands)', () => {
  const rnd = mulberry(2);
  for (let n = 0; n < 20000; n++) { const d = randomCards(rnd, 7); assert.equal(eval7(d), bestOfSubsets(d), d.map(cardStr).join(' ')); }
  for (let n = 0; n < 3000; n++) { const d = randomCards(rnd, 6); assert.equal(eval7(d), bestOfSubsets(d), d.map(cardStr).join(' ')); }
});

test('eval7: all 2,598,960 five-card hands fall into the known category counts', () => {
  const counts = new Array(9).fill(0), h = [0, 0, 0, 0, 0];
  for (let a = 0; a < 48; a++) for (let b = a + 1; b < 49; b++) for (let d = b + 1; d < 50; d++) for (let e = d + 1; e < 51; e++) for (let f = e + 1; f < 52; f++) {
    h[0] = a; h[1] = b; h[2] = d; h[3] = e; h[4] = f;
    counts[eval7(h) >>> 20]++;
  }
  assert.deepEqual(counts, [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]);
});

test('eval7: representative hands, category order and tie-breaks', () => {
  const E = s => eval7(cs(s));
  const name = s => handName(E(s));
  assert.equal(name('As Ks Qs Js Ts 2d 3c'), 'Royal Flush');
  assert.equal(name('9s 8s 7s 6s 5s Ad Ac'), 'Straight Flush');
  assert.equal(name('As 2s 3s 4s 5s Kd Kc'), 'Straight Flush');             // the steel wheel
  assert.equal(name('Ah Ad Ac As 2d 3c 4h'), 'Four of a Kind');
  assert.equal(name('Ah Ad Ac Ks Kd 3c 4h'), 'Full House');
  assert.equal(name('Ah Ad Ac Ks Kd Kc 4h'), 'Full House');                  // two trips: the lower trips plays as the pair
  assert.equal(name('Ah 9h 7h 4h 2h Kd Kc'), 'Flush');
  assert.equal(name('9h 8d 7c 6s 5h 2d 2c'), 'Straight');
  assert.equal(name('Ah 2d 3c 4s 5h Kd Kc'), 'Straight');                     // the wheel
  assert.equal(name('Ah Ad Ac 4s 5h 9d Kc'), 'Three of a Kind');
  assert.equal(name('Ah Ad Kc Ks 5h 9d 3c'), 'Two Pair');
  assert.equal(name('Ah Ad Kc Ks 5h 5d 3c'), 'Two Pair');                      // three pairs
  assert.equal(name('Ah Ad 2c 7s 5h 9d 3c'), 'Pair');
  assert.equal(name('Ah Jd 2c 7s 5h 9d 3c'), 'High Card');
  assert.equal(name('9h 8h 7h 6h 2h 5d 4c'), 'Flush');                        // flush beats the straight in the same 7 cards
  const order = ['As Ks Qs Js Ts 2d 3c', '9s 8s 7s 6s 5s Ad Ac', 'Ah Ad Ac As 2d 3c 4h', 'Ah Ad Ac Ks Kd 3c 4h', 'Ah 9h 7h 4h 2h Kd Kc',
    '9h 8d 7c 6s 5h 2d 2c', 'Ah Ad Ac 4s 5h 9d Kc', 'Ah Ad Kc Ks 5h 9d 3c', 'Ah Ad 2c 7s 5h 9d 3c', 'Ah Jd 2c 7s 5h 9d 3c'].map(E);
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] > order[i], 'category ' + i);
  assert.ok(E('Ah 2d 3c 4s 5h Kd Kc') < E('2h 3d 4c 5s 6h Kd Kc'), 'wheel < 6-high straight');
  assert.ok(E('As 2s 3s 4s 5s Kd Kc') > E('Ah Ad Ac As Kd 3c 4h'), 'straight flush > quads');
  assert.ok(E('Ah Ad Kc 7s 5h 9d 3c') > E('Ah Ad Qc 7s 5h 9d 3c'), 'pair: first kicker');
  assert.equal(E('Ah Ad Kc 9s 5h 7d 3c'), E('Ah Ad Kc 9s 7h 5d 2c'), 'the 6th and 7th cards never count');
  assert.ok(E('Ah Ad Kc Ks Qh 9d 3c') > E('Ah Ad Kc Ks Jh 9d 3c'), 'two pair kicker');
  assert.ok(E('Ah Ad Kc Ks 2h 2d 4c') > E('Ah Ad Kc Ks 3h 3d 2c'), 'three pairs: the kicker is the best remaining card (4 > 3)');
  assert.ok(E('Ah Ad Kc Ks 3h 3d 4c') < E('Ah Ad Kc Ks 5h 3d 4c'), 'a kicker 5 beats a kicker 4');
  assert.ok(E('Ah Ad Ac Ks Kd 3c 4h') > E('Kh Kd Kc As Ad 3c 4h'), 'full house: trips first');
  assert.ok(E('Ah Ad Ac Ks Kd 3c 4h') > E('Ah Ad Ac Qs Qd 3c 4h'), 'full house: then the pair');
  assert.ok(E('Ah Kh 9h 4h 2h Qd Jc') > E('Ah Qh 9h 4h 2h Kd Jc'), 'flush: second card decides');
  assert.ok(E('Ah Ad Ac Ks 2d 3c 4h') > E('Ah Ad Ac Qs 2d 3c 4h'), 'trips kicker');
  assert.ok(E('Ah Ad Ac As Ks 3c 4h') > E('Ah Ad Ac As Qs 3c 4h'), 'quads kicker');
  assert.equal(E('2h 2d 2c 2s Ks Kd Kc'), E('2h 2d 2c 2s Ks Qd Jc'), 'quads with trips on the side: the kicker is the K');
  assert.equal(E('Ah Kd Qc Js 9h 3d 2c'), E('As Kh Qd Jc 9d 4s 2h'), 'suits never break ties');
  assert.equal(E('Ah Kh Qh Jh 9h 8h 7h'), E('Ah Kh Qh Jh 9h 2d 3c'), 'a flush uses the 5 best suited cards');
  assert.equal(handName(0), 'High Card');
});

/* ---------------- RNG ---------------- */
test('ChaCha20 block function matches RFC 7539 §2.3.2', () => {
  const key = []; for (let i = 0; i < 8; i++) { const b = i * 4; key.push((b | ((b + 1) << 8) | ((b + 2) << 16) | ((b + 3) << 24)) >>> 0); }
  const st = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574, ...key, 1, 0x09000000, 0x4a000000, 0];
  const out = Array.from(chachaBlock(st)).map(x => x.toString(16).padStart(8, '0'));
  assert.deepEqual(out, ['e4e7f110', '15593bd1', '1fdd0f50', 'c47120a3', 'c7f4d1c7', '0368c033', '9aaa2204', '4e6cd4c3',
    '466482d2', '09aa9f07', '05d7c214', 'a2028bd9', 'd19c12b5', 'b94e16de', 'e883d0cb', '4e3c50a2']);
});

test('same seed = same game; different seed = different deal; the default rnd uses crypto', () => {
  const mk0 = seed => newGame({ stack: 300, levelMs: 60000, now: 0, rnd: mulberry(seed) });
  assert.equal(JSON.stringify(mk0(5)), JSON.stringify(mk0(5)));
  assert.notEqual(JSON.stringify(mk0(5).holes), JSON.stringify(mk0(6).holes));
  const g = newGame({ stack: 300, levelMs: 60000, now: 0 });
  assert.equal(g.seed.length, 8); assert.equal(g.deck.length, 52 - 6);
  assert.notEqual(JSON.stringify(newGame({ stack: 300, levelMs: 60000, now: 0 }).seed), JSON.stringify(g.seed));
  const all = [...g.deck, ...g.holes.flat()].sort((a, b) => a - b);
  assert.deepEqual(all, Array.from({ length: 52 }, (_, i) => i), 'hole cards + deck = a permutation of 52 cards');
});

test('deals are roughly uniform (frequency of the top deck card over many seeds)', () => {
  const f = new Array(52).fill(0), N = 5200;
  for (let i = 0; i < N; i++) f[newGame({ stack: 300, levelMs: 1, now: 0, rnd: mulberry(i + 1000) }).deck.at(-1)]++;
  for (const x of f) assert.ok(x > 50 && x < 170, 'frequency ' + x);   // mean 100
});

/* ---------------- helpers ---------------- */
// Put chosen hole cards (for every seat still in the hand) and a 5-card board into a freshly dealt hand.
function rig(g, holes, board) {
  for (const [s, h] of Object.entries(holes)) g.holes[s] = cs(h);
  const used = new Set(g.holes.filter(Boolean).flat());
  assert.equal(used.size, 2 * g.holes.filter(Boolean).length, 'rigged hole cards are distinct');
  const b = board ? cs(board) : [];
  b.forEach(x => assert.ok(!used.has(x), 'board card duplicates a hole card'));
  const rest = Array.from({ length: 52 }, (_, i) => i).filter(x => !used.has(x) && !b.includes(x));
  if (b.length === 5) g.deck = [...rest, ...[rest.pop(), b[0], b[1], b[2], rest.pop(), b[3], rest.pop(), b[4]].reverse()];
  else g.deck = rest;
}
const A = (g, seat, type, to, now = 0) => applyAction(g, seat, to == null ? { type } : { type, to }, now);
const mk = (stacks, button, extra = {}) => newGame({ stacks, button, levelMs: 60000, now: 0, rnd: mulberry(99), ...extra });
const conserved = (g, total) => sum(g.seats.map(s => s.stack)) + sum(g.total) === total;
const BOARD = '2c 7h 9d Jc 3s';

/* ---------------- blinds, order of action ---------------- */
test('3-handed: button, SB, BB and the order of action', () => {
  const g = mk([1000, 1000, 1000], 0);
  assert.equal(g.button, 0); assert.deepEqual(g.bet, [0, 10, 20]); assert.equal(g.currentBet, 20);
  assert.equal(actor(g), 0, 'the button acts first preflop');
  assert.deepEqual([g.sb, g.bb, g.handNo, g.street, g.board.length], [10, 20, 1, 'preflop', 0]);
  A(g, 0, 'call'); A(g, 1, 'call');
  assert.equal(actor(g), 2, 'BB has the option'); assert.ok(legalActions(g).canCheck);
  A(g, 2, 'check');
  assert.equal(g.street, 'flop'); assert.equal(g.board.length, 3);
  assert.equal(actor(g), 1, 'postflop starts with the SB (first seat after the button)');
  A(g, 1, 'check'); A(g, 2, 'check'); assert.equal(actor(g), 0, 'button acts last postflop'); A(g, 0, 'check');
  assert.equal(g.street, 'turn'); assert.equal(g.board.length, 4);
  for (const s of [1, 2, 0]) A(g, s, 'check');
  assert.equal(g.street, 'river'); assert.equal(g.board.length, 5);
  for (const s of [1, 2, 0]) A(g, s, 'check');
  assert.equal(g.lastHand.handNo, 1); assert.equal(g.handNo, 2); assert.equal(g.button, 1, 'the button moved');
  assert.equal(g.lastHand.shown.filter(Boolean).length, 3);
  assert.equal(sum(g.lastHand.net), 0);
  assert.ok(conserved(g, 3000));
});

test('heads-up: the button is the SB, acts first preflop and last postflop', () => {
  const g = mk([1000, 1000, 0], 0);
  assert.ok(g.seats[2].out && g.folded[2] && g.holes[2] === null);
  assert.deepEqual(g.bet, [10, 20, 0], 'button (seat 0) posts the small blind, seat 1 the big blind');
  assert.equal(actor(g), 0);
  const l = legalActions(g);
  assert.deepEqual([l.toCall, l.callAmount, l.canCheck, l.canCall, l.minRaiseTo, l.maxRaiseTo, l.pot], [10, 10, false, true, 40, 1000, 30]);
  A(g, 0, 'call');
  assert.equal(actor(g), 1); assert.ok(legalActions(g).canCheck);
  A(g, 1, 'check');
  assert.equal(g.street, 'flop'); assert.equal(actor(g), 1, 'BB (non-button) acts first postflop');
  A(g, 1, 'check'); assert.equal(actor(g), 0, 'button acts last postflop'); A(g, 0, 'check');
  for (let i = 0; i < 4; i++) A(g, actor(g), 'check');
  assert.equal(g.handNo, 2); assert.equal(g.button, 1, 'the button moves to the next surviving seat');
  assert.deepEqual(g.bet, [20, 10, 0], 'now seat 1 is the button/SB');
  assert.equal(actor(g), 1);
  // the same positions when the button seat is 2 and seat 0 is out
  const h = mk([0, 500, 500], 2);
  assert.deepEqual(h.bet, [0, 20, 10]); assert.equal(actor(h), 2);
});

test('3 to heads-up: the dead seat is skipped and the button keeps moving', () => {
  const g = mk([1000, 1000, 1000], 1);               // button 1, SB seat 2, BB seat 0
  assert.deepEqual(g.bet, [20, 0, 10]); assert.equal(actor(g), 1);
  rig(g, { 0: 'As Ad', 1: 'Ks Kd', 2: 'Qs Qd' }, BOARD);
  A(g, 1, 'raise', 1000); A(g, 2, 'fold'); A(g, 0, 'call');   // seat 2 folds its SB; AA beats KK
  assert.ok(!g.over); assert.ok(g.seats[1].out); assert.deepEqual(g.places, [null, 3, null]);
  assert.equal(g.button, 2, 'seat 1 (the old button) is gone: the button goes to the next surviving seat');
  assert.deepEqual(g.bet, [20, 0, 10], 'heads-up: the button (seat 2) is the SB, seat 0 the BB');
  assert.equal(actor(g), 2);
  assert.ok(conserved(g, 3000));
});

/* ---------------- raising rules ---------------- */
test('NL minimum raise and illegal actions', () => {
  const g = mk([1000, 1000, 1000], 0);
  const before = JSON.stringify(g);
  assert.throws(() => A(g, 1, 'call'), e => e instanceof EngineError && e.code === 'not_your_turn');
  assert.throws(() => A(g, 0, 'check'), e => e.code === 'illegal');
  assert.throws(() => A(g, 0, 'raise', 39), e => e.code === 'illegal');
  assert.throws(() => A(g, 0, 'raise', 1001), e => e.code === 'illegal');
  assert.throws(() => A(g, 0, 'raise', 40.5), e => e.code === 'illegal');
  assert.throws(() => A(g, 0, 'raise'), e => e.code === 'illegal');
  assert.throws(() => A(g, 0, 'bogus'), e => e.code === 'illegal');
  assert.equal(JSON.stringify(g), before, 'illegal actions leave the state untouched');
  A(g, 0, 'raise', 40);                                   // +20 over the big blind
  let l = legalActions(g);
  assert.equal(l.seat, 1); assert.equal(l.toCall, 30); assert.equal(l.minRaiseTo, 60);
  A(g, 1, 'raise', 100);                                  // +60: the next minimum is another 60
  l = legalActions(g);
  assert.equal(l.seat, 2); assert.equal(l.minRaiseTo, 160); assert.equal(l.callAmount, 80); assert.equal(l.maxRaiseTo, 1000);
  A(g, 2, 'call');
  assert.equal(actor(g), 0); l = legalActions(g);
  assert.equal(l.toCall, 60); assert.equal(l.minRaiseTo, 160);
  A(g, 0, 'call');
  assert.equal(g.street, 'flop'); assert.equal(sum(g.total), 300);
  assert.equal(legalActions(g).minRaiseTo, 20, 'postflop a bet must be at least the big blind');
  assert.throws(() => A(g, 1, 'raise', 19), e => e.code === 'illegal');
  A(g, 1, 'raise', 20);
  assert.equal(g.log.at(-1).text, '{1} bets 20');
  assert.equal(legalActions(g).minRaiseTo, 40);
  A(g, 2, 'fold'); A(g, 0, 'call');
  assert.equal(g.street, 'turn'); assert.equal(g.minRaise, 20, 'the minimum resets each street');
});

test('an incomplete all-in raise does not reopen the betting for players who already acted', () => {
  const g = mk([1000, 130, 400], 0);                     // seat 1 (SB) has 130 in total, seat 2 is the BB
  A(g, 0, 'raise', 100);                                 // full raise (+80)
  assert.equal(g.minRaise, 80);
  const l1 = legalActions(g);
  assert.deepEqual([l1.seat, l1.minRaiseTo, l1.maxRaiseTo], [1, 130, 130], 'the SB can only shove 130');
  A(g, 1, 'raise', 130);                                 // +30 only: incomplete
  assert.equal(g.minRaise, 80, 'an incomplete raise does not change the minimum');
  assert.ok(g.allIn[1]);
  const l2 = legalActions(g);
  assert.equal(l2.seat, 2); assert.equal(l2.minRaiseTo, 210, 'the BB has not acted yet and may still raise');
  A(g, 2, 'call');                                       // 130 total
  assert.equal(actor(g), 0);
  const l3 = legalActions(g);
  assert.equal(l3.toCall, 30); assert.equal(l3.callAmount, 30); assert.ok(l3.canCall);
  assert.equal(l3.minRaiseTo, null); assert.equal(l3.maxRaiseTo, null);
  assert.throws(() => A(g, 0, 'raise', 300), e => e.code === 'illegal');
  A(g, 0, 'call');
  assert.equal(g.street, 'flop'); assert.equal(sum(g.total), 390);
  assert.equal(actor(g), 2, 'only seats 0 and 2 are live; the SB is all-in');
});

test('a full raise after an incomplete one reopens the action', () => {
  const g = mk([1000, 130, 1000], 0);
  A(g, 0, 'raise', 100); A(g, 1, 'raise', 130);
  A(g, 2, 'raise', 210);                                 // +80 over 130: a full raise
  assert.equal(g.minRaise, 80);
  const l = legalActions(g);
  assert.equal(l.seat, 0); assert.equal(l.toCall, 110); assert.equal(l.minRaiseTo, 290);
});

test('no raise when every other player is all-in', () => {
  const g = mk([1000, 300, 1000], 0);
  A(g, 0, 'raise', 100); A(g, 1, 'raise', 300); A(g, 2, 'fold');
  const l = legalActions(g);
  assert.equal(l.seat, 0); assert.equal(l.minRaiseTo, null, 'nobody left to bet against');
  assert.equal(l.callAmount, 200);
});

test('fold is always allowed; autoAction checks when it can and folds otherwise', () => {
  const g = mk([1000, 1000, 1000], 0);
  autoAction(g, 0, 0);                                    // facing the BB: fold
  assert.ok(g.folded[0]);
  assert.equal(actor(g), 1);
  autoAction(g, 1, 0);                                    // SB faces the BB: fold -> hand over
  assert.equal(g.handNo, 2);
  assert.equal(g.lastHand.pots[0].winners[0], 2);
  // BB can check: autoAction checks
  const h = mk([1000, 1000, 1000], 0);
  A(h, 0, 'call'); A(h, 1, 'call');
  assert.ok(legalActions(h).canCheck);
  autoAction(h, 2, 0);
  assert.equal(h.street, 'flop'); assert.ok(!h.folded[2]);
  assert.throws(() => autoAction(h, 0, 0), e => e.code === 'not_your_turn');
});

/* ---------------- pots ---------------- */
test('side pots: three different stacks all in', () => {
  const g = mk([100, 300, 500], 0);
  rig(g, { 0: 'As Ad', 1: 'Ks Kd', 2: 'Qs Qd' }, BOARD);
  A(g, 0, 'raise', 100); A(g, 1, 'raise', 300); A(g, 2, 'call');
  const h = g.lastHand;
  assert.deepEqual(h.pots, [
    { amount: 300, eligible: [0, 1, 2], winners: [0] },
    { amount: 400, eligible: [1, 2], winners: [1] },
  ]);
  assert.deepEqual(h.net, [200, 100, -300]);
  assert.deepEqual(h.busted, []);
  assert.deepEqual(h.shown.map(x => x && x.length), [2, 2, 2]);
  assert.equal(h.names[0], 'Pair'); assert.equal(h.uncalled, null);
  assert.ok(conserved(g, 900));
});

test('side pots: the short stack has the second best hand and the big stack the best', () => {
  const g = mk([100, 300, 500], 0);
  rig(g, { 0: 'Ks Kd', 1: 'Qs Qd', 2: 'As Ad' }, BOARD);
  A(g, 0, 'raise', 100); A(g, 1, 'raise', 300); A(g, 2, 'call');
  assert.deepEqual(g.lastHand.pots.map(p => p.winners), [[2], [2]]);
  assert.deepEqual(g.lastHand.net, [-100, -300, 400]);
  assert.deepEqual(g.lastHand.busted, [0, 1]);
});

test('uncalled bet is returned (heads-up shove against a short stack)', () => {
  const g = mk([1000, 300, 0], 0);
  rig(g, { 0: 'As Ad', 1: 'Ks Kd' }, BOARD);
  A(g, 0, 'raise', 500);
  const l = legalActions(g);
  assert.equal(l.callAmount, 280); assert.equal(l.minRaiseTo, null, 'the BB can only call all-in');
  A(g, 1, 'call');
  const h = g.lastHand;
  assert.deepEqual(h.uncalled, { seat: 0, amount: 200 });
  assert.deepEqual(h.pots, [{ amount: 600, eligible: [0, 1], winners: [0] }]);
  assert.deepEqual(h.net, [300, -300, 0]);
  assert.ok(g.over && g.winner === 0 && g.seats[0].stack === 1300);
  assert.deepEqual(g.places, [1, 2, 3]);
});

test('uncalled bet is returned when everybody folds', () => {
  const g = mk([1000, 1000, 0], 0);
  A(g, 0, 'raise', 100); A(g, 1, 'fold');
  assert.deepEqual(g.lastHand.uncalled, { seat: 0, amount: 80 });
  assert.deepEqual(g.lastHand.net, [20, -20, 0]);
  assert.deepEqual(g.lastHand.shown, [null, null, null]);
  assert.deepEqual(g.lastHand.names, [null, null, null]);
  assert.deepEqual(g.lastHand.board, []);
  assert.ok(g.log.some(e => e.text === 'Uncalled bet 80 returned to {0}'));
});

test('dead money from a folded player goes into the pot', () => {
  const g = mk([1000, 1000, 1000], 0);
  rig(g, { 0: 'As Ad', 1: 'Ks Kd', 2: 'Qs Qd' }, BOARD);
  A(g, 0, 'raise', 60); A(g, 1, 'call'); A(g, 2, 'fold');   // seat 2 folds its 20 BB
  for (let i = 0; i < 6; i++) A(g, actor(g), 'check');
  const h = g.lastHand;
  assert.deepEqual(h.pots, [{ amount: 140, eligible: [0, 1], winners: [0] }]);
  assert.deepEqual(h.net, [80, -60, -20]);
});

test('odd chip goes to the first winner left of the button', () => {
  const board = 'Ad Kc Qd Js 9h';
  const play = button => {
    const g = mk([51, 51, 51], button);
    rig(g, { 0: 'Tc 2c', 1: 'Th 3c', 2: '5c 6s' }, board);   // seats 0 and 1 tie with an ace-high straight, seat 2 loses
    const first = actor(g);
    A(g, first, 'raise', 51);
    A(g, actor(g), 'call'); A(g, actor(g), 'call');
    return g.lastHand;
  };
  let h = play(0);                                         // order from the button: 1, 2, 0
  assert.deepEqual(h.pots, [{ amount: 153, eligible: [0, 1, 2], winners: [0, 1] }]);
  assert.deepEqual(h.net, [25, 26, -51], 'seat 1 is first left of button 0 and gets the odd chip');
  h = play(1);                                             // order: 2, 0, 1
  assert.deepEqual(h.net, [26, 25, -51], 'seat 0 gets the odd chip when the button is seat 1');
  h = play(2);                                             // order: 0, 1, 2
  assert.deepEqual(h.net, [26, 25, -51]);
});

test('odd chips in a split side pot', () => {
  // seat 0 is short (31) and loses; seats 1 and 2 hold the same straight and split both pots; the main pot 93 is odd
  const g = mk([31, 200, 200], 0);
  rig(g, { 0: '5c 6s', 1: 'Th 3c', 2: 'Tc 2c' }, 'Ad Kc Qd Js 9h');
  A(g, 0, 'raise', 31); A(g, 1, 'raise', 200); A(g, 2, 'call');
  const h = g.lastHand;
  assert.deepEqual(h.pots, [
    { amount: 93, eligible: [0, 1, 2], winners: [1, 2] },
    { amount: 338, eligible: [1, 2], winners: [1, 2] },
  ]);
  assert.deepEqual(h.net, [-31, 16, 15], 'seat 1 (first left of the button) gets the odd chip of the main pot');
});

/* ---------------- eliminations ---------------- */
test('two players bust in the same hand: the bigger starting stack ranks higher', () => {
  const g = mk([200, 300, 500], 0);
  rig(g, { 0: 'Ks Kd', 1: 'Qs Qd', 2: 'As Ad' }, BOARD);
  A(g, 0, 'raise', 200); A(g, 1, 'raise', 300); A(g, 2, 'call');
  assert.ok(g.over); assert.equal(g.winner, 2);
  assert.deepEqual(g.places, [3, 2, 1]);
  assert.deepEqual(g.lastHand.busted.sort(), [0, 1]);
  assert.equal(g.seats[2].stack, 1000); assert.deepEqual(g.total, [0, 0, 0]); assert.equal(actor(g), null);
});

test('two players bust in the same hand with equal starting stacks: the lower seat number ranks higher', () => {
  const g = mk([300, 300, 400], 0);
  rig(g, { 0: 'Ks Kd', 1: 'Qs Qd', 2: 'As Ad' }, BOARD);
  A(g, 0, 'raise', 300); A(g, 1, 'call'); A(g, 2, 'call');
  assert.deepEqual(g.places, [2, 3, 1]);
  assert.equal(g.winner, 2);
});

test('one bust leaves a heads-up game that continues; later bust takes place 2', () => {
  const g = mk([200, 500, 500], 0);
  rig(g, { 0: 'Ks Kd', 1: 'Qs Qd', 2: 'As Ad' }, BOARD);
  A(g, 0, 'raise', 200); A(g, 1, 'fold'); A(g, 2, 'call');
  assert.ok(!g.over); assert.deepEqual(g.places, [3, null, null]); assert.ok(g.seats[0].out);
  assert.deepEqual(g.lastHand.busted, [0]);
  assert.equal(g.button, 1, 'the button moved to the next surviving seat (seat 0 is out)');
  assert.ok(g.folded[0] && g.holes[0] === null);
  assert.deepEqual(g.bet.map((b, i) => (g.seats[i].out ? 0 : b > 0 ? 1 : 0)), [0, 1, 1]);
  assert.ok(conserved(g, 1200));
});

/* ---------------- short stacks ---------------- */
test('a player who cannot cover the blind posts what is left and is all-in', () => {
  const g = mk([5, 1000, 1000], 2);                      // SB seat 0 has only 5
  assert.deepEqual(g.bet, [5, 20, 0]); assert.ok(g.allIn[0]); assert.equal(g.seats[0].stack, 0);
  assert.equal(actor(g), 2);
  assert.ok(g.log.some(e => e.text === '{0} posts SB 5 (all-in)'));
  A(g, 2, 'call'); A(g, 1, 'check');
  assert.equal(g.street, 'flop'); assert.equal(actor(g), 1, 'the all-in seat is skipped');
  assert.ok(conserved(g, 2005));
  // short big blind in a heads-up game: the excess is returned
  const h = mk([1000, 15, 0], 0);
  assert.deepEqual(h.bet, [10, 15, 0]); assert.ok(h.allIn[1]);
  assert.equal(actor(h), 0);
  rig(h, { 0: 'As Ad', 1: 'Ks Kd' }, BOARD);
  A(h, 0, 'call');
  assert.ok(h.over); assert.equal(h.winner, 0); assert.equal(h.seats[0].stack, 1015);
  assert.deepEqual(h.lastHand.uncalled, { seat: 0, amount: 5 });
  // everybody all-in on the blinds: straight to showdown with no action
  const k = mk([5, 8, 1000], 2);
  rig(k, { 0: 'As Ad', 1: 'Ks Kd', 2: 'Qs Qd' }, BOARD);
  assert.ok(sum(k.total) === 13 && k.allIn[0] && k.allIn[1]);
  assert.equal(actor(k), 2);
  A(k, 2, 'call');
  assert.equal(k.lastHand.net[0] > 0, true);
  assert.ok(conserved(k, 1013));
});

test('all-in everywhere: the board runs out automatically', () => {
  const g = mk([400, 400, 400], 0);
  rig(g, { 0: 'As Ad', 1: 'Ks Kd', 2: 'Qs Qd' }, BOARD);
  A(g, 0, 'raise', 400); A(g, 1, 'call'); A(g, 2, 'call');
  assert.equal(g.lastHand.board.length, 5);
  assert.deepEqual(g.lastHand.board, cs(BOARD));
  assert.deepEqual(g.lastHand.net, [800, -400, -400]);
  assert.deepEqual(g.log.filter(e => /^(Flop|Turn|River)/.test(e.text)).length, 3);
});

/* ---------------- blind levels ---------------- */
test('levels: evaluated at the start of each hand', () => {
  const g = newGame({ stacks: [1000, 1000, 1000], button: 0, levelMs: 60000, now: 1000, rnd: mulberry(3) });
  assert.deepEqual([g.level, g.sb, g.bb], [0, 10, 20]);
  assert.equal(levelAt(g, 1000), 0); assert.equal(levelAt(g, 60999), 0); assert.equal(levelAt(g, 61000), 1);
  assert.equal(levelAt(g, 0), 0, 'before the start counts as level 0');
  assert.equal(levelAt(g, 1e12), BLINDS.length - 1, 'the last level stays');
  // the hand finishes after the level changed: the next hand uses the new blinds, this one kept the old ones
  A(g, 0, 'fold', undefined, 70000); A(g, 1, 'fold', undefined, 70000);
  assert.equal(g.handNo, 2); assert.deepEqual([g.level, g.sb, g.bb], [1, 15, 30]);
  assert.ok(g.log.some(e => e.text === 'Blinds up to 15/30'));
  assert.equal(g.handAt, 70000);
  assert.deepEqual(g.bet.filter(b => b > 0).sort((a, b) => a - b), [15, 30]);
  // an action taken 5 minutes later does not change the blinds of the running hand
  const a = actor(g);
  A(g, a, 'call', undefined, 400000);
  assert.deepEqual([g.level, g.sb, g.bb], [1, 15, 30]);
  A(g, actor(g), 'fold', undefined, 400000); A(g, actor(g), 'fold', undefined, 400000);
  assert.equal(g.handNo, 3); assert.equal(g.level, levelAt(g, 400000)); assert.equal(g.level, 6);
  assert.deepEqual([g.sb, g.bb], BLINDS[6]);
});

/* ---------------- state is plain JSON, views work, game over ---------------- */
test('the state survives a JSON round trip mid-game and play continues identically', () => {
  const g = mk([1000, 1000, 1000], 0), h = JSON.parse(JSON.stringify(g));
  for (const x of [g, h]) { A(x, 0, 'raise', 60); A(x, 1, 'call'); A(x, 2, 'fold'); A(x, 1, 'raise', 20); A(x, 0, 'call'); }
  assert.equal(JSON.stringify(g), JSON.stringify(h));
});

test('legalActions on a view equals legalActions on the full state', () => {
  const g = mk([1000, 700, 400], 1);
  for (let i = 0; i < 30 && !g.over; i++) {
    const a = actor(g);
    assert.deepEqual(legalActions(viewFor(g, a)), legalActions(g));
    assert.deepEqual(legalActions(viewFor(g, (a + 1) % 3)), legalActions(g));
    const l = legalActions(g);
    A(g, a, l.canCheck ? 'check' : 'call');
  }
});

test('after the game is over nothing can be played', () => {
  const g = mk([1000, 1000, 0], 0);
  rig(g, { 0: 'As Ad', 1: 'Ks Kd' }, BOARD);
  A(g, 0, 'raise', 1000); A(g, 1, 'call');
  assert.ok(g.over); assert.equal(actor(g), null); assert.equal(legalActions(g), null);
  assert.throws(() => A(g, 0, 'check'), e => e.code === 'game_over');
  assert.throws(() => autoAction(g, 0, 0), e => e.code === 'game_over');
  assert.deepEqual(g.places, [1, 2, 3]);
});

test('ver increases with every applied action', () => {
  const g = mk([1000, 1000, 1000], 0);
  const v0 = g.ver;
  A(g, 0, 'call'); assert.equal(g.ver, v0 + 1);
  A(g, 1, 'call'); assert.equal(g.ver, v0 + 2);
  assert.throws(() => A(g, 1, 'call'));
  assert.equal(g.ver, v0 + 2);
});

/* ---------------- invariant fuzzing ---------------- */
function playTournament(i, check = true) {
  const rnd = mulberry(i * 7919 + 13), stack = [300, 500, 2000][i % 3];
  let now = i * 1000;
  const g = newGame({ stack, levelMs: [60000, 120000][i % 2], now, rnd: mulberry(i + 1) });
  let gg = g, steps = 0;
  const total = 3 * stack;
  while (!gg.over) {
    assert.ok(steps++ < 40000, 'tournament must finish');
    const a = actor(gg), l = legalActions(gg);
    if (check) {
      assert.ok(conserved(gg, total), 'chips are conserved');
      assert.ok(gg.seats.every(s => s.stack >= 0) && gg.total.every(t => t >= 0));
      assert.ok(a != null && l.seat === a);
      assert.ok(!gg.folded[a] && !gg.allIn[a] && !gg.seats[a].out && gg.seats[a].stack > 0, 'the actor can act');
      assert.ok(l.canCheck !== l.canCall, 'exactly one of check/call');
      assert.ok(l.callAmount <= gg.seats[a].stack);
      if (l.minRaiseTo != null) assert.ok(l.minRaiseTo > gg.currentBet && l.minRaiseTo <= l.maxRaiseTo && l.maxRaiseTo === gg.bet[a] + gg.seats[a].stack);
      assert.equal(gg.deck.length + gg.holes.filter(Boolean).length * 2 + gg.board.length + (gg.board.length ? 1 + (gg.board.length - 3) : 0), 52, 'cards accounted for');
      if (steps % 7 === 0) assert.deepEqual(legalActions(viewFor(gg, a)), l, 'view gives the same legal actions');
    }
    // choose a move: mostly random legal moves, sometimes the timeout action, sometimes shoves
    const r = rnd(); let move;
    if (r < 0.12) move = null;
    else if (r < 0.30) move = { type: 'fold' };
    else if (r < 0.62) move = { type: l.canCheck ? 'check' : 'call' };
    else if (l.minRaiseTo != null) move = { type: 'raise', to: rnd() < 0.25 ? l.maxRaiseTo : l.minRaiseTo + Math.floor(rnd() * (l.maxRaiseTo - l.minRaiseTo + 1)) };
    else move = { type: l.canCheck ? 'check' : 'call' };
    now += Math.floor(rnd() * [400, 1500, 4000][i % 3]);     // slow, medium and fast blind growth
    const lh = gg.lastHand;
    if (move) applyAction(gg, a, move, now); else autoAction(gg, a, now);
    if (steps % 40 === 0) gg = JSON.parse(JSON.stringify(gg));        // keep going from a serialised copy
    if (check && gg.lastHand !== lh && gg.lastHand && (!lh || gg.lastHand.handNo !== lh.handNo)) {
      const h = gg.lastHand;
      assert.equal(sum(h.net), 0, 'a hand is zero-sum');
      for (const p of h.pots) { assert.ok(p.winners.length > 0 && p.winners.every(w => p.eligible.includes(w))); assert.ok(p.amount > 0); }
    }
  }
  if (check) {
    assert.deepEqual(gg.places.slice().sort(), [1, 2, 3], 'places 1, 2, 3 are all filled');
    assert.equal(gg.places[gg.winner], 1);
    assert.equal(gg.seats[gg.winner].stack, total, 'the winner has all the chips');
    assert.ok(gg.seats.every((s, k) => k === gg.winner || (s.stack === 0 && s.out)));
    assert.deepEqual(gg.total, [0, 0, 0]); assert.equal(actor(gg), null);
    assert.ok(gg.log.every(e => !/\b(YOU|Player)\b/.test(e.text)), 'the shared log uses seat placeholders only');
  }
  return gg;
}

test('fuzz: 1500 tournaments with random legal actions and timeouts keep every invariant', () => {
  const t0 = Date.now();
  let hands = 0, hu = 0;
  for (let i = 0; i < 1500; i++) { const g = playTournament(i); hands += g.handNo; hu += g.places.includes(2) ? 1 : 0; }
  assert.equal(hu, 1500);
  assert.ok(hands > 1500 * 5, 'tournaments last several hands (' + hands + ')');
  assert.ok(Date.now() - t0 < 40000, 'fast enough');
});

test('fuzz: same seeds replay to exactly the same tournament', () => {
  for (const i of [1, 2, 3, 77, 123]) assert.equal(JSON.stringify(playTournament(i, false)), JSON.stringify(playTournament(i, false)));
});
