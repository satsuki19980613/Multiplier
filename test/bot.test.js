// Bot: evaluator agreement with the engine, Nash table sanity, legal-move fuzzing, view-only decisions, determinism, speed.
// Heavy strength evaluation lives in tools/arena.mjs (not run here).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, actor, legalActions, applyAction, eval7, RANKCH } from '../src/engine.js';
import { viewFor } from '../src/view.js';
import { botMove, PERSONAS, PERSONA_PARAMS } from '../src/bot.js';
import { evalCards } from '../src/bot/eval.js';
import { classIndex, HANDS, twProb, huPush, huCall } from '../src/bot/tables.js';

function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const c = (s) => RANKCH.indexOf(s[0]) * 4 + 'shdc'.indexOf(s[1]);
const cs = (a) => a.split(' ').map(c);

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}

test('bot evaluator gives exactly the same scores as the engine eval7', () => {
  const r = mulberry(1);
  for (let i = 0; i < 20000; i++) {
    const n = 5 + Math.floor(r() * 3);
    const deck = Array.from({ length: 52 }, (_, k) => k);
    const hand = [];
    for (let k = 0; k < n; k++) hand.push(deck.splice(Math.floor(r() * deck.length), 1)[0]);
    assert.equal(evalCards(hand, n), eval7(hand), hand.join(','));
  }
});

test('hand classes and Nash tables look right', () => {
  assert.equal(HANDS[classIndex(c('As'), c('Ah'))], 'AA');
  assert.equal(HANDS[classIndex(c('As'), c('Ks'))], 'AKs');
  assert.equal(HANDS[classIndex(c('Ad'), c('Kc'))], 'AKo');
  assert.equal(HANDS[classIndex(c('2c'), c('7d'))], '72o');
  const aa = classIndex(c('As'), c('Ah')), s72 = classIndex(c('7s'), c('2d'));
  for (const st of [3, 6, 10, 15, 20]) {
    assert.ok(twProb('a', aa, st) > 0.99, 'AA jams BTN at ' + st);
    assert.ok(twProb('a', s72, st) < 0.05, '72o folds BTN at ' + st);
  }
  assert.ok(huPush(aa, 8) > 0.99 && huCall(aa, 8) > 0.99);
  assert.ok(huCall(s72, 12) < 0.05);
});

// ---- helpers to build specific spots
function spot({ stack = 200, button = 0, seed = 7 } = {}) {
  return newGame({ stack, levelMs: 600000, now: 0, rnd: mulberry(seed), names: ['A', 'B', 'C'], button });
}
const jamTo = (g) => legalActions(g).maxRaiseTo;

test('AA: BTN at 10bb jams, and calls a jam from every seat (all personas, many dice rolls)', () => {
  for (const persona of PERSONAS) {
    for (let k = 0; k < 40; k++) {
      const rnd = mulberry(k + 100);
      // BTN first to act
      const g = spot({ stack: 200, button: 0 });
      const s = actor(g);
      assert.equal(s, 0);
      g.holes[s] = cs('As Ah');
      const mv = botMove(viewFor(g, s), s, { persona, rnd });
      assert.equal(mv.type, 'raise');
      assert.equal(mv.to, jamTo(g));
      // BTN jams, SB (with AA) must call, and so must the BB after a SB fold
      applyAction(g, s, mv, 0);
      const sb = actor(g);
      g.holes[sb] = cs('Ac Ad');
      const m2 = botMove(viewFor(g, sb), sb, { persona, rnd });
      assert.equal(m2.type, 'call', 'SB AA vs BTN jam');
      applyAction(g, sb, { type: 'fold' }, 0);
      const bbs = actor(g);
      g.holes[bbs] = cs('Ac Ad');
      const m3 = botMove(viewFor(g, bbs), bbs, { persona, rnd });
      assert.equal(m3.type, 'call', 'BB AA vs BTN jam');
    }
  }
});

test('72o: BTN at 10bb folds (all personas, many dice rolls)', () => {
  for (const persona of PERSONAS) {
    for (let k = 0; k < 60; k++) {
      const g = spot({ stack: 200, button: 0, seed: k + 1 });
      const s = actor(g);
      g.holes[s] = cs('7s 2d');
      const mv = botMove(viewFor(g, s), s, { persona, rnd: mulberry(k * 13 + 5) });
      assert.equal(mv.type, 'fold', persona);
    }
  }
});

test('72o with the option to check (BB, limped pot) checks; AA 25bb BTN raises', () => {
  const g = spot({ stack: 500, button: 0 });
  applyAction(g, 0, { type: 'call' }, 0);
  applyAction(g, 1, { type: 'call' }, 0);
  const bb = actor(g);
  g.holes[bb] = cs('7s 2d');
  assert.equal(botMove(viewFor(g, bb), bb, { persona: 'tight', rnd: mulberry(3) }).type, 'check');
  const g2 = spot({ stack: 500, button: 0 });
  g2.holes[0] = cs('Ks Kd');
  const mv = botMove(viewFor(g2, 0), 0, { persona: 'loose', rnd: mulberry(3) });
  assert.equal(mv.type, 'raise');
});

// ---- legality fuzz over whole tournaments (also exercises postflop code) and timing
function playFuzz(seed, struct, lineup, hooks = {}) {
  const g = newGame({ stack: struct.stack, levelMs: struct.levelMs, now: 0, rnd: mulberry(seed), names: lineup.map((p, i) => p + i) });
  const rnd = mulberry(seed * 3 + 1);
  let now = 0, n = 0;
  while (!g.over && n < 1500) {
    const s = actor(g);
    const view = viewFor(g, s);
    const before = JSON.stringify(view);
    const t0 = performance.now();
    const mv = botMove(deepFreeze(view), s, { persona: lineup[s], rnd });
    const dt = performance.now() - t0;
    assert.equal(JSON.stringify(view), before, 'view must not be mutated');
    if (hooks.times) hooks.times.push(dt);
    const L = legalActions(g);
    assert.ok(['fold', 'check', 'call', 'raise'].includes(mv.type), JSON.stringify(mv));
    if (mv.type === 'check') assert.ok(L.canCheck);
    if (mv.type === 'call') assert.ok(L.canCall);
    if (mv.type === 'raise') { assert.ok(Number.isInteger(mv.to) && mv.to >= L.minRaiseTo && mv.to <= L.maxRaiseTo, JSON.stringify([mv, L])); }
    applyAction(g, s, mv, now); // throws on illegal
    now += 7000; n++;
  }
  return g;
}

test('bot only plays legal moves, never mutates the view, and tournaments finish (fuzz)', () => {
  const structs = [{ stack: 300, levelMs: 60000 }, { stack: 400, levelMs: 120000 }, { stack: 500, levelMs: 300000 }];
  let seed = 1;
  for (const st of structs) {
    for (let k = 0; k < 4; k++) {
      const lineup = [PERSONAS[k % 3], PERSONAS[(k + 1) % 3], PERSONAS[(k + 2) % 3]];
      const g = playFuzz(seed++, st, lineup);
      assert.ok(g.over, 'tournament should finish');
    }
  }
});

test('botMove is deterministic for the same view and the same random stream', () => {
  const g = newGame({ stack: 500, levelMs: 300000, now: 0, rnd: mulberry(5), names: ['a', 'b', 'c'] });
  let now = 0;
  for (let i = 0; i < 40 && !g.over; i++) {
    const s = actor(g);
    const view = viewFor(g, s);
    for (const persona of PERSONAS) {
      const a = botMove(view, s, { persona, rnd: mulberry(i + 9) });
      const b = botMove(structuredClone(view), s, { persona, rnd: mulberry(i + 9) });
      assert.deepEqual(a, b);
    }
    applyAction(g, s, botMove(view, s, { persona: 'tight', rnd: mulberry(i) }), now);
    now += 5000;
  }
});

test('botMove does not depend on hidden information (other seats\' holes / deck)', () => {
  const g = newGame({ stack: 500, levelMs: 300000, now: 0, rnd: mulberry(11), names: ['a', 'b', 'c'] });
  const s = actor(g);
  const v1 = viewFor(g, s);
  const g2 = structuredClone(g);
  for (let i = 0; i < 3; i++) if (i !== s) g2.holes[i] = [g.deck[0], g.deck[1]];
  g2.deck.reverse();
  const v2 = viewFor(g2, s);
  assert.deepEqual(botMove(v1, s, { persona: 'aggro', rnd: mulberry(4) }), botMove(v2, s, { persona: 'aggro', rnd: mulberry(4) }));
});

test('postflop sanity: never folds a set, folds air to a large bet', () => {
  const build = (hero, board, villainBet) => {
    const g = spot({ stack: 1000, button: 0, seed: 21 });
    applyAction(g, 0, { type: 'call' }, 0);
    applyAction(g, 1, { type: 'call' }, 0);
    applyAction(g, 2, { type: 'check' }, 0);
    assert.equal(g.street, 'flop');
    const first = actor(g); // SB acts first postflop
    g.board = cs(board);
    return { g, first, hero };
  };
  // hero = BB (seat 2) facing SB's bet
  for (const persona of PERSONAS) {
    {
      const { g } = build(null, 'Ks 7d 2c');
      applyAction(g, 1, { type: 'raise', to: 50 }, 0);
      assert.equal(actor(g), 2);
      g.holes[2] = cs('Kh Kd'); // top set... (trips)
      assert.notEqual(botMove(viewFor(g, 2), 2, { persona, rnd: mulberry(2) }).type, 'fold');
    }
    {
      const { g } = build(null, 'As Kd Qc');
      applyAction(g, 1, { type: 'raise', to: 150 }, 0);
      g.holes[2] = cs('7h 2d');
      assert.equal(botMove(viewFor(g, 2), 2, { persona, rnd: mulberry(2) }).type, 'fold');
    }
  }
});

test('speed: median decision <= 50ms and worst case <= 300ms (full tournaments incl. postflop)', () => {
  const times = [];
  const lineup = ['tight', 'loose', 'aggro'];
  for (let k = 0; k < 6; k++) playFuzz(500 + k, { stack: 500, levelMs: 300000 }, lineup, { times });
  times.sort((a, b) => a - b);
  const med = times[times.length >> 1], max = times[times.length - 1];
  assert.ok(times.length > 100);
  assert.ok(med <= 50, 'median ' + med);
  assert.ok(max <= 300, 'max ' + max);
});

test('persona table is complete', () => {
  for (const p of PERSONAS) assert.ok(PERSONA_PARAMS[p]);
  assert.deepEqual([...PERSONAS], ['tight', 'loose', 'aggro']);
});
