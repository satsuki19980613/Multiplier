// viewFor / logText: what a seat may see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, applyAction, legalActions, actor } from '../src/engine.js';
import { viewFor, logText } from '../src/view.js';

function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mk = () => newGame({ stack: 300, levelMs: 120000, now: 0, rnd: mulberry(7), names: ['Ann', 'Bob', 'Cy'] });

test('viewFor removes deck, seed and the RNG counter, and the other seats\' hole cards', () => {
  const g = mk();
  for (const seat of [0, 1, 2]) {
    const v = viewFor(g, seat);
    assert.ok(!('deck' in v) && !('seed' in v) && !('ctr' in v));
    v.holes.forEach((h, i) => { if (i === seat) assert.deepEqual(h, g.holes[i]); else assert.equal(h, null); });
    const json = JSON.stringify(v);
    assert.ok(!json.includes('"deck"') && !json.includes('"seed"'));
  }
  assert.ok(g.deck.length > 0 && g.seed.length === 8, 'the original state is untouched');
  assert.ok(g.holes.every(h => h && h.length === 2));
  // a spectator sees no hole cards at all
  assert.deepEqual(viewFor(g, null).holes, [null, null, null]);
});

test('viewFor is a deep copy', () => {
  const g = mk(), v = viewFor(g, 0);
  v.seats[0].stack = 1; v.log.push({ text: 'x' }); v.holes[0][0] = 99; v.board.push(5);
  assert.notEqual(g.seats[0].stack, 1);
  assert.ok(g.log.every(e => e.text !== 'x'));
  assert.notEqual(g.holes[0][0], 99);
  assert.equal(g.board.length, 0);
});

test('legalActions works on a view (no deck needed) and matches the real state', () => {
  const g = mk();
  const a = actor(g), v = viewFor(g, a);
  assert.deepEqual(legalActions(v), legalActions(g));
  const w = viewFor(g, (a + 1) % 3); // someone else's view also gives the same answer for the actor
  assert.deepEqual(legalActions(w), legalActions(g));
});

test('lastHand.shown survives viewFor (showdown hands are public)', () => {
  const g = mk();
  // everybody calls / checks down to a showdown
  let guard = 0;
  while (!g.lastHand && guard++ < 50) {
    const l = legalActions(g);
    applyAction(g, l.seat, { type: l.canCheck ? 'check' : 'call' }, 1000);
  }
  assert.ok(g.lastHand, 'a hand finished');
  assert.ok(g.lastHand.shown.filter(Boolean).length >= 2, 'showdown');
  for (const seat of [0, 1, 2]) {
    const v = viewFor(g, seat);
    assert.deepEqual(v.lastHand.shown, g.lastHand.shown);
    assert.deepEqual(v.lastHand.pots, g.lastHand.pots);
    assert.deepEqual(v.lastHand.names, g.lastHand.names);
    assert.deepEqual(v.lastHand.board, g.lastHand.board);
  }
  // the new hand's hole cards are still hidden from the other seats
  const v = viewFor(g, 0);
  assert.equal(v.holes[1], null); assert.equal(v.holes[2], null); assert.ok(Array.isArray(v.holes[0]));
});

test('logText replaces placeholders with YOU or the name', () => {
  const names = ['Ann', 'Bob', 'Cy'];
  assert.equal(logText({ text: '{1} raises to 60' }, 1, names), 'YOU raises to 60');
  assert.equal(logText({ text: '{1} raises to 60' }, 0, names), 'Bob raises to 60');
  assert.equal(logText({ text: '{0} wins 90 · {2} folds' }, 2, names), 'Ann wins 90 · YOU folds');
  assert.equal(logText({ text: 'Flop: A♠ K♥ 3♦' }, 0, names), 'Flop: A♠ K♥ 3♦');
  assert.equal(logText('{2} calls', 0, names), 'Cy calls');
  const g = mk();
  assert.ok(g.log.every(e => /\{\d\}|^[A-Z]/.test(e.text)), 'log entries are placeholder-based');
  assert.ok(g.log.every(e => !/Ann|Bob|Cy|YOU/.test(e.text)), 'no names in the shared log');
});
