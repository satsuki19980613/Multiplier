// Settings: multiplier tables, drawMultiplier, structure, blinds, seasons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAKES, MULTIPLIERS, MULT_TOTAL, FREEROLL, START_CHIPS, BLINDS, drawMultiplier, structureFor, seasonOf } from '../src/spin.js';

test('each stake: occurrences sum to 10,000,000 and E[multiplier] is exactly 3 (integer arithmetic)', () => {
  assert.equal(MULT_TOTAL, 10000000);
  for (const [stake, rows] of Object.entries(MULTIPLIERS)) {
    let n = 0, weighted = 0;
    for (const [m, c] of rows) { n += c; weighted += m * c; assert.ok(Number.isInteger(m) && Number.isInteger(c) && c > 0); }
    assert.equal(n, 10000000, stake + ' total');
    assert.equal(weighted, 30000000, stake + ' E = 3.0 exactly (sum m*c = 3 * 10^7)');
    // sorted by multiplier, descending, no duplicates
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1][0] > rows[i][0]);
    // the biggest prize is 100,000 at every stake (docs/research/03-economy.md §4)
    assert.equal(rows[0][0] * STAKES[stake].buyIn, 100000, stake + ' top prize');
  }
});

test('4x and above have the same probability at every stake (except the 100x/1000x/10000x jackpots)', () => {
  const p = (stake, m) => (MULTIPLIERS[stake].find(r => r[0] === m) || [0, 0])[1];
  for (const m of [25, 10, 5, 4]) { assert.equal(p('low', m), p('mid', m)); assert.equal(p('mid', m), p('high', m)); }
});

test('stakes and constants', () => {
  assert.deepEqual(STAKES, { low: { buyIn: 10, minChips: 10 }, mid: { buyIn: 100, minChips: 100 }, high: { buyIn: 1000, minChips: 20000 } });
  assert.deepEqual(FREEROLL, { prize: 500, perDay: 3, eligibleBelow: 10, stack: 500, levelMs: 120000 });
  assert.equal(START_CHIPS, 10000);
});

test('drawMultiplier: cumulative boundaries', () => {
  for (const [stake, rows] of Object.entries(MULTIPLIERS)) {
    // rnd values are (k + 0.5) / 1e7, which floor back to exactly k
    const at = k => drawMultiplier(stake, () => (k + 0.5) / MULT_TOTAL);
    let cum = 0;
    rows.forEach(([m, c], i) => {
      assert.equal(at(cum), m, `${stake}: first slot of ${m}x`);
      assert.equal(at(cum + c - 1), m, `${stake}: last slot of ${m}x`);
      if (i + 1 < rows.length) assert.equal(at(cum + c), rows[i + 1][0], `${stake}: first slot after ${m}x`);
      cum += c;
    });
    assert.equal(drawMultiplier(stake, () => 0), rows[0][0], 'rnd 0 = the biggest multiplier');
    assert.equal(drawMultiplier(stake, () => 0.9999999999999999), rows.at(-1)[0], 'rnd just below 1 = 2x');
    assert.equal(drawMultiplier(stake, () => 1), rows.at(-1)[0], 'rnd 1 is clamped');
  }
  assert.throws(() => drawMultiplier('nope', Math.random));
});

test('drawMultiplier: empirical mean is near 3 with a seeded RNG', () => {
  let a = 12345; const rnd = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let s = 0; const N = 200000;
  for (let i = 0; i < N; i++) s += drawMultiplier('high', rnd);
  assert.ok(Math.abs(s / N - 3) < 0.1, 'mean ' + s / N);
});

test('structureFor', () => {
  const T = { 2: [300, 60000], 3: [300, 120000], 4: [400, 120000], 5: [400, 180000], 10: [500, 180000], 25: [500, 180000], 100: [500, 300000], 1000: [500, 300000], 10000: [500, 300000] };
  for (const [m, [stack, levelMs]] of Object.entries(T)) assert.deepEqual(structureFor(+m), { stack, levelMs }, m + 'x');
  assert.deepEqual(structureFor(null), { stack: 500, levelMs: 120000 }, 'freeroll');
  for (const rows of Object.values(MULTIPLIERS)) for (const [m] of rows) assert.ok(structureFor(m).stack > 0, 'every table multiplier has a structure');
});

test('BLINDS table', () => {
  assert.equal(BLINDS.length, 25);
  assert.deepEqual(BLINDS[0], [10, 20]);
  assert.deepEqual(BLINDS.at(-1), [3000, 6000]);
  for (const [sb, bb] of BLINDS) assert.equal(bb, sb * 2);
});

test('seasonOf: JST boundaries on 4/1 and 10/1', () => {
  const S = iso => seasonOf(new Date(iso));
  assert.equal(S('2026-09-30T14:59:59Z').id, '2026-H1');   // 2026-09-30 23:59:59 JST
  assert.equal(S('2026-09-30T15:00:00Z').id, '2026-H2');   // 2026-10-01 00:00:00 JST
  assert.equal(S('2026-03-31T14:59:59Z').id, '2025-H2');   // 2026-03-31 23:59:59 JST
  assert.equal(S('2026-03-31T15:00:00Z').id, '2026-H1');   // 2026-04-01 00:00:00 JST
  assert.equal(S('2027-01-15T00:00:00Z').id, '2026-H2');   // January belongs to the previous year's H2
  assert.equal(S('2026-10-04T12:00:00Z').id, '2026-H2');
  assert.equal(S('2026-12-31T20:00:00Z').id, '2026-H2');   // 2027-01-01 05:00 JST
  const h2 = S('2026-10-04T12:00:00Z');
  assert.equal(h2.startsAt.toISOString(), '2026-09-30T15:00:00.000Z');
  assert.equal(h2.endsAt.toISOString(), '2027-03-31T15:00:00.000Z');
  const h1 = S('2026-05-01T00:00:00Z');
  assert.equal(h1.startsAt.toISOString(), '2026-03-31T15:00:00.000Z');
  assert.equal(h1.endsAt.toISOString(), '2026-09-30T15:00:00.000Z');
  // the end of one season is the start of the next, and a date is always inside its own season
  assert.equal(S('2026-09-30T14:59:59Z').endsAt.getTime(), S('2026-09-30T15:00:00Z').startsAt.getTime());
  for (const iso of ['2026-04-01T00:00:00Z', '2026-12-25T10:00:00Z', '2027-03-31T14:59:59Z', '2028-02-29T00:00:00Z']) {
    const s = S(iso), t = new Date(iso).getTime();
    assert.ok(s.startsAt.getTime() <= t && t < s.endsAt.getTime(), iso);
  }
  // numbers and ISO strings are accepted as well
  assert.equal(seasonOf(Date.parse('2026-09-30T15:00:00Z')).id, '2026-H2');
  assert.equal(seasonOf('2026-09-30T14:59:59Z').id, '2026-H1');
});
