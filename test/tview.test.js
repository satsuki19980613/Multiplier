// 卓のビュー（src/tview.js）：Multiplier のビューを、PrivateMatch から移した卓の画面・ペース・ハンド履歴が読む形に写す。
// 本物の卓（server/game/rules.js）を打ちながら、写したビューの遷移・合法手・記録・ベットサイズの候補を確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTable, applyRequest, tick, viewsOf, commit, MAX_STRIKES } from '../server/game/rules.js';
import { actor, legalActions } from '../src/engine.js';
import { liveView, settledView, tableViews, legalOf, toMove, recordOf, ptOf, kindOf } from '../src/tview.js';
import { PACE, plan, transition, runoutMs, RUNOUT, FX_MS, FX } from '../src/pace.js';
import { sceneOf, sizeTo, quickSizes, defaultSizes, normalizeSizes, makeSize, stepChips, MAX_ITEMS } from '../src/betsize.js';
import { fxSeat } from '../src/fx.js';
import { validHand } from '../src/history/store.js';
import { handStats, gameHandStats } from '../src/history/stats.js';
import { netOfRecord, committedOf, positionsOf } from '../src/history/hand.js';

function mulberry(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const T0 = 1_700_000_000_000;
const humans = () => [0, 1, 2].map(i => ({ uid: 'u' + i, name: 'P' + i, bot: null }));
const mk = (seed = 1, stake = 'low', room = null) => { const t = createTable({ players: humans(), stake, now: T0, rnd: mulberry(seed), room, forceMultiplier: 2 }); return { state: t.state, meta: t.meta }; };
const step = (game, seat, move, now) => { const r = applyRequest(game, seat, { op: 'act', ver: game.state.ver, move }, now); const o = commit(game, r); return { state: o.state, meta: o.meta }; };
const mvOf = (game, seat = 0) => viewsOf(game.state, game.meta)[seat];
const sum = a => a.reduce((x, y) => x + y, 0);

test('liveView: the hand in the shape of the table (street number, commits, bets, actions, blinds, level from 1)', () => {
  const g = mk(), mv = mvOf(g), v = liveView(mv);
  assert.equal(v.ver, mv.ver); assert.equal(v.seat, 0); assert.equal(v.n, 3); assert.equal(v.status, 'running');
  const h = v.hand;
  assert.equal(h.street, 0); assert.equal(h.phase, 'betting'); assert.equal(h.level, mv.level + 1);
  assert.deepEqual(h.commits, mv.total); assert.deepEqual(h.streetBet, mv.bet); assert.deepEqual(h.startStacks, mv.handStart);
  assert.equal(h.btn, mv.button); assert.equal(h.bbSeat, mv.bbSeat); assert.equal(h.streetLastBetTo, mv.bb);
  assert.deepEqual(h.actions, []);
  assert.ok(h.hole[0] && h.hole[1] === null && h.hole[2] === null, 'only my own cards');
  assert.equal(v.room.kind, 'play'); assert.deepEqual(v.config, { mode: 'low', players: 3 });
  assert.equal(kindOf({ room: '123456', stake: 'mid' }), 'private'); assert.equal(kindOf({ room: null, stake: 'free' }), 'free');
  assert.equal(ptOf({ prize: 20, buyIn: 10 }, 1), 10); assert.equal(ptOf({ prize: 20, buyIn: 10 }, 3), -10); assert.equal(ptOf({ prize: 500, buyIn: 0 }, 2), 0);
  assert.equal(ptOf({ prize: 20, buyIn: 10 }, null), null);
});

test('legalOf matches the engine; toMove turns all-in into a raise to the maximum (or a call)', () => {
  const g = mk(2), a = actor(g.state), mv = mvOf(g, a), l = legalOf(mv), L = legalActions(mv);
  assert.equal(l.seat, a); assert.equal(l.minTo, L.minRaiseTo); assert.equal(l.maxTo, L.maxRaiseTo); assert.equal(l.callPut, L.callAmount);
  assert.equal(l.canFold, true); assert.equal(l.canCheck, false); assert.equal(l.aggression, 'raise'); assert.equal(l.streetLastBetTo, mv.bb);
  assert.equal(legalOf(mvOf(g, (a + 1) % 3)), null, 'not my turn');
  assert.deepEqual(toMove({ type: 'allin' }, l), { type: 'raise', to: L.maxRaiseTo });
  assert.deepEqual(toMove({ type: 'allin' }, { ...l, maxTo: null }), { type: 'call' });
  assert.deepEqual(toMove({ type: 'raise', to: 60, junk: 1 }, l), { type: 'raise', to: 60 });
  assert.deepEqual(toMove({ type: 'fold' }, l), { type: 'fold' });
});

test('pace on the table views: action, street, win (fold) and the next deal', () => {
  let g = mk(3);
  const a0 = actor(g.state), v0 = liveView(mvOf(g));
  g = step(g, a0, { type: 'raise', to: 3 * g.state.bb }, T0 + 9000);
  const v1 = liveView(mvOf(g)), p1 = plan(v0, v1);
  assert.equal(p1.kind, 'action'); assert.equal(p1.steps.length, 1); assert.equal(p1.steps[0].bets[a0], 3 * g.state.bb);
  // the two others call: the street closes
  for (let i = 0; i < 2; i++) g = step(g, actor(g.state), { type: 'call' }, T0 + 9500 + i);
  const v2 = liveView(mvOf(g)), p2 = plan(v1, v2);
  assert.equal(p2.kind, 'street'); assert.equal(v2.hand.street, 1); assert.equal(p2.boardFrom ?? transition(v1, v2).boardFrom, 0);
  // a bet and two folds end the hand: the settled view goes before the next deal
  g = step(g, actor(g.state), { type: 'raise', to: g.state.bb * 2 }, T0 + 10000);
  const v3 = liveView(mvOf(g));
  g = step(g, actor(g.state), { type: 'fold' }, T0 + 10100);
  g = step(g, actor(g.state), { type: 'fold' }, T0 + 10200);
  const mv = mvOf(g), { views, settledNo } = tableViews(mv, 0);
  assert.equal(views.length, 2); assert.equal(settledNo, 1);
  const [s, d] = views;
  assert.equal(s.ver, mv.ver - 0.5); assert.equal(s.hand.handNo, 1); assert.equal(s.hand.phase, 'settled'); assert.equal(s.hand.shown, null);
  assert.equal(d.ver, mv.ver); assert.equal(d.hand.handNo, 2);
  assert.equal(plan(v3, s).kind, 'win'); assert.equal(plan(s, d).kind, 'deal');
  assert.equal(sum(s.hand.won), sum(s.hand.commits), 'everything put in is taken back out');
  assert.deepEqual(s.players.map(p => p.stack), mv.lastHand.start.map((x, i) => x + mv.lastHand.net[i]), 'stacks right after the hand');
  // the same view again does not show the hand twice
  assert.equal(tableViews(mv, settledNo).views.length, 1);
});

test('pace on the table views: an all-in preflop is a showdown run out from 0 (runFrom, shown hands, hand names)', () => {
  let g = mk(4);
  const v0 = liveView(mvOf(g));
  g = step(g, actor(g.state), { type: 'raise', to: g.state.seats[actor(g.state)].stack + g.state.bet[actor(g.state)] }, T0 + 9000);
  const v1 = liveView(mvOf(g));
  for (let i = 0; i < 2; i++) { const a = actor(g.state); if (a == null || g.state.handNo !== 1) break; g = step(g, a, { type: 'call' }, T0 + 9100 + i); }
  const { views } = tableViews(mvOf(g), 0), s = views[0];
  assert.equal(s.hand.phase, 'settled'); assert.equal(s.hand.runFrom, 0); assert.ok(s.hand.shown.filter(Boolean).length >= 2);
  assert.ok(s.hand.names.filter(Boolean).length >= 2); assert.equal(s.hand.board.length, 5);
  assert.equal(plan(v1, s).kind, 'showdown');
  assert.equal(runoutMs(0), RUNOUT.preflop + RUNOUT.gather + RUNOUT.reveal + RUNOUT.flop + RUNOUT.street + RUNOUT.river + RUNOUT.latency);
  assert.equal(runoutMs(5), RUNOUT.gather + RUNOUT.show + RUNOUT.latency); assert.equal(runoutMs(null), 0);
  assert.ok(v0);
});

test('game over: the last view is the settled last hand with status finished; a game ended by a retire draws no hand', () => {
  // play a whole table with everybody calling down until it ends
  let g = mk(5), n = 0;
  while (!g.state.over && n++ < 2000) { const a = actor(g.state), L = legalActions(g.state); g = step(g, a, L.canCheck ? { type: 'check' } : { type: 'call' }, T0 + 9000 + n * 1000); }
  assert.ok(g.state.over);
  const mv = mvOf(g), { views } = tableViews(mv, 0), last = views.at(-1);
  assert.equal(last.status, 'finished'); assert.equal(last.ver, mv.ver); assert.equal(last.hand.phase, 'settled'); assert.equal(last.hand.handNo, mv.handNo);
  assert.ok(last.players.every(p => p.place != null)); assert.equal(last.players[mv.winner].pt, mv.meta.prize - mv.meta.buyIn);
  // retire: humans 1 and 2 retire mid-hand -> seat 0 wins; the unfinished hand is not drawn
  let r = mk(6);
  r = (() => { const x = applyRequest(r, 1, { op: 'retire' }, T0 + 9000); const o = commit(r, x); return { state: o.state, meta: o.meta }; })();
  r = (() => { const x = applyRequest(r, 2, { op: 'retire' }, T0 + 9100); const o = commit(r, x); return { state: o.state, meta: o.meta }; })();
  assert.ok(r.state.over);
  const rv = tableViews(mvOf(r), 0).views.at(-1);
  assert.equal(rv.status, 'finished');
  assert.ok(rv.hand === null || rv.hand.handNo === r.state.handNo);
});

test('records: every finished hand gives a valid history record whose numbers add up', () => {
  let g = mk(7), n = 0, seen = 0;
  const recs = [];
  while (!g.state.over && n++ < 3000) {
    const a = actor(g.state), L = legalActions(g.state);
    const move = n % 5 === 0 && L.minRaiseTo != null ? { type: 'raise', to: L.minRaiseTo } : n % 7 === 0 && L.canCall ? { type: 'fold' } : L.canCheck ? { type: 'check' } : { type: 'call' };
    g = step(g, a, move, T0 + 9000 + n * 1000);
    const lh = g.state.lastHand;
    if (lh && lh.handNo > seen) { seen = lh.handNo; recs.push({ ...recordOf(lh), hole: lh.hole[0], roomId: 'g1' }); }
  }
  assert.ok(recs.length > 3);
  for (const r of recs) {
    assert.ok(validHand(r), 'valid record ' + r.handNo);
    for (const s of [0, 1, 2]) if (r.startStacks[s] > 0) assert.equal(netOfRecord(r, s), r.won[s] - committedOf(r, s));
    assert.equal(sum([0, 1, 2].map(s => (r.startStacks[s] > 0 ? committedOf(r, s) : 0))), sum(r.won), 'commits rebuilt from blinds + actions = won');
    assert.ok(positionsOf(r).filter(Boolean).length >= 2);
  }
  const st = handStats(recs, () => 0);
  assert.equal(st.hands, recs.filter(r => r.startStacks[0] > 0).length);
  assert.ok(st.vpip.n <= st.hands && st.pfr.n <= st.vpip.n + st.hands);
  assert.ok(gameHandStats(recs, 0));
});

test('bet sizes on the table views: scenes and amounts (open / vsRaise / bet / vsBet) and the sheet candidates', () => {
  let g = mk(8);
  const at = () => { const mv = mvOf(g, actor(g.state)), v = liveView(mv); return [v.legal, v.hand]; };
  let [l, h] = at();
  const bb = h.bb;
  assert.equal(sceneOf(l, h), 'open'); assert.equal(sizeTo('2.5bb', l, h), 2.5 * bb);
  const q = quickSizes(l, h, { ...defaultSizes(), open: ['2bb', '3bb', '500bb', '1bb'] });
  assert.equal(q[0][0], 'Min'); assert.equal(q[0][1], l.minTo); assert.ok(q.every(([, x]) => x < l.maxTo));
  g = step(g, actor(g.state), { type: 'raise', to: 3 * bb }, T0 + 9000);
  [l, h] = at();
  assert.equal(sceneOf(l, h), 'vsRaise'); assert.equal(sizeTo('3x', l, h), 9 * bb);
  g = step(g, actor(g.state), { type: 'call' }, T0 + 9100); g = step(g, actor(g.state), { type: 'call' }, T0 + 9200);
  [l, h] = at();
  assert.equal(h.street, 1); assert.equal(sceneOf(l, h), 'bet'); assert.equal(sizeTo('50%', l, h), Math.round(l.pot / 2));
  g = step(g, actor(g.state), { type: 'raise', to: 2 * bb }, T0 + 9300);
  [l, h] = at();
  assert.equal(sceneOf(l, h), 'vsBet'); assert.equal(sizeTo('3x', l, h), 6 * bb); assert.equal(sizeTo('100%', l, h), 2 * bb + l.pot + l.toCall);
  assert.equal(stepChips({ step: 0.5 }, 20), 10);
});

test('bet sizes: normalising saved settings', () => {
  assert.deepEqual(normalizeSizes(null), defaultSizes());
  const n = normalizeSizes({ step: 3, open: ['3bb', '2x', 'abc', '2bb', '3bb', '0.5bb'], vsBet: ['50%', '3x', '1x', '2x'] });
  assert.equal(n.step, defaultSizes().step); assert.deepEqual(n.open, ['2bb', '3bb']); assert.deepEqual(n.vsBet, ['2x', '3x', '50%']);
  assert.equal(normalizeSizes({ bet: Array.from({ length: 30 }, (_, i) => (i + 1) * 10 + '%') }).bet.length, MAX_ITEMS);
  assert.equal(makeSize('vsRaise', '2.555', 'x'), '2.56x'); assert.equal(makeSize('open', '3', 'x'), null);
});

test('fxSeat: the one seat that took the most at a showdown, only when it has a GIF; never on a fold or a chop', () => {
  const lh = { shown: [[1, 2], [3, 4], null], runFrom: 5, won: [100, 0, 0], commits: [50, 50, 0] };
  assert.equal(fxSeat(lh, ['a', 'b', null]), 0);
  assert.equal(fxSeat(lh, [null, 'b', null]), null, 'the winner has no GIF');
  assert.equal(fxSeat(lh, null), null);
  assert.equal(fxSeat({ ...lh, runFrom: null }, ['a', 'b', null]), null, 'a fold');
  assert.equal(fxSeat({ ...lh, shown: [null, null, null] }, ['a', 'b', null]), null);
  assert.equal(fxSeat({ ...lh, won: [50, 50, 0] }, ['a', 'b', null]), null, 'a chop takes nothing');
  assert.equal(fxSeat({ ...lh, phase: 'betting' }, ['a', 'b', null]), null);
  assert.equal(FX_MS, FX.wait + FX.in + FX.show + FX.out + FX.gap);
});

test('sitting out: a human with MAX_STRIKES time-outs is shown as sitout', () => {
  let g = mk(9);
  const a = actor(g.state);
  g = { state: g.state, meta: { ...g.meta, clock: { ...g.meta.clock, strikes: [0, 0, 0].map((x, s) => (s === a ? MAX_STRIKES : 0)) } } };
  const v = liveView(mvOf(g));
  assert.equal(v.players[a].status, 'sitout');
  assert.ok(v.players.filter((p, s) => s !== a).every(p => p.status === 'active'));
  // the clock bar is only for a human to act
  assert.equal(v.hand.deadline, g.meta.clock.deadline);
  const t = tick(g, g.meta.clock.deadline + 5000, {});
  assert.ok(t.state.ver > g.state.ver);
  assert.ok(PACE.beat > 0);
});

test('two hands in one step (the next hand all-in from the blinds): both are shown in order, then the next deal or the end', async () => {
  const { newGame, applyAction } = await import('../src/engine.js');
  const { viewFor } = await import('../src/view.js');
  const g = newGame({ stacks: [1000, 25, 0], button: 0, levelMs: 600000, now: 0, rnd: mulberry(11) });
  const meta = { seat: 0, bot: [false, false, false], clock: { strikes: [0, 0, 0] }, stake: 'low', buyIn: 10, prize: 20, room: null };
  const mvAt = () => ({ ...viewFor(g, 0), meta });
  const before = tableViews(mvAt(), 0);
  applyAction(g, 0, { type: 'raise', to: 40 }, 1);
  applyAction(g, 1, { type: 'fold' }, 2);   // seat 1 is left with 5: the next hand is all-in from the small blind
  const mv = mvAt();
  const n = mv.lastHand.handNo;
  assert.ok(n >= 2); assert.deepEqual(mv.prevHands.map(h => h.handNo), Array.from({ length: n - 1 }, (_, i) => i + 1));
  const { views, settledNo } = tableViews(mv, before.settledNo);
  assert.equal(settledNo, n);
  const settled = views.filter(v => v.hand && v.hand.phase === 'settled');
  assert.deepEqual(settled.map(v => v.hand.handNo), Array.from({ length: n }, (_, i) => i + 1), 'every hand of the chain, in order');
  for (let i = 1; i < views.length; i++) assert.ok(views[i].ver > views[i - 1].ver, 'versions go up');
  assert.ok(views[0].ver > mv.ver - 1 && views.at(-1).ver === mv.ver);
  assert.equal(settled[0].players[1].stack, 5); assert.equal(settled[0].status, 'running');
  assert.equal(settled[1].hand.runFrom, 0, 'hand 2 is run out from the deal');
  const p = plan(settled[0], settled[1]);
  assert.equal(p.kind, 'deal-showdown');
  // views.at(-1) is the next hand, or the end of the game
  const last = views.at(-1);
  assert.ok(g.over ? last.status === 'finished' : last.hand.handNo === n + 1);
  // the views hide the other seat's cards of the earlier hand too (the fold in hand 1)
  assert.equal(mv.prevHands[0].hole[1], null);
});

test('a retire inside the deciding hand: won stays the chips taken from the table, and the retired seat keeps its place in the final view', () => {
  // three-handed: seat to act retires preflop with the blinds in → the hand goes on, won never goes negative
  let g = mk(3);
  const r = actor(g.state);
  g = (() => { const o = commit(g, applyRequest(g, r, { op: 'retire' }, T0 + 9000)); return { state: o.state, meta: o.meta }; })();
  // heads-up now: the seat to act retires mid-hand → the game ends with that hand
  while (!g.state.over) {
    const a = actor(g.state), lh0 = g.state.lastHand;
    g = (() => { const o = commit(g, applyRequest(g, a, { op: 'retire' }, T0 + 10000)); return { state: o.state, meta: o.meta }; })();
    if (lh0 !== g.state.lastHand && !g.state.over) continue;
  }
  for (const h of [g.state.lastHand, ...(g.state.prevHands || [])].filter(Boolean)) {
    assert.ok(h.won.every(x => x >= 0), 'won is never negative');
    for (const s of h.retired) assert.ok(h.start[s] > 0);
  }
  for (let s = 0; s < 3; s++) {
    const { views } = tableViews(mvOf(g, s), 0), last = views.at(-1);
    assert.equal(last.status, 'finished');
    last.players.forEach((p, i) => { assert.ok(p.place != null, `seat ${i} has a place`); assert.equal(p.status === 'out', p.place !== 1); });
  }
});

test('a lastHand from the engine before the hand records (no start) is not drawn', () => {
  const g = playOutTo(mk(5));
  const mv = mvOf(g), old = { handNo: mv.lastHand.handNo, board: [], net: [0, 0, 0], busted: [], endedAt: 0 };
  const { views } = tableViews({ ...mv, lastHand: old, prevHands: [] }, 0);
  assert.equal(views.length, 1); assert.equal(views[0].hand, null);
});
function playOutTo(g) {
  let n = 0, now = T0 + 9000;
  while (!g.state.over && n++ < 5000) { const L = legalActions(g.state); g = step(g, actor(g.state), L.canCheck ? { type: 'check' } : { type: 'call' }, now += 1000); }
  return g;
}
