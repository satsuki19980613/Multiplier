// Self-play arena for the bot (3-handed hyper-turbo SNG, winner-take-all => win rate is the metric).
//
//   node tools/arena.mjs                       # default: each persona vs 2x each baseline, 300 seeds (x3 seat rotations)
//   node tools/arena.mjs --n 1000 --workers 24 # 1,000 seeds = 3,000 tournaments per row
//   node tools/arena.mjs --vs random,call --bots tight
//   node tools/arena.mjs --rr                  # persona round-robin (all 6 seatings of tight/loose/aggro, plus pairs vs nash)
//   node tools/arena.mjs --hands 'tight,loose,nash' # one custom lineup (all 6 permutations)
//   options: --struct mixed|2x|3x|4x|5x|10x|100x  --ms 7000 (simulated ms per action) --seed 1 --timing
//
// Duplicate format: one "seed" fixes the deck stream and the button; the match is replayed with the 3 cyclic seat rotations
// (or all 6 permutations for a lineup of 3 different players), so every player gets every seat's cards.
// The unit of the confidence interval is the seed (rotations are correlated). 95% CI = mean ± 1.96 SE.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { newGame, actor, applyAction, legalActions, eval7 } from '../src/engine.js';
import { viewFor } from '../src/view.js';
import { structureFor } from '../src/spin.js';
import { botMove, PERSONAS } from '../src/bot.js';
import { classIndex, CLASS_PCT } from '../src/bot/tables.js';
import { analyze } from '../src/bot/situation.js';
import { preflopStory, nashNode, nodeProbs, jamMove } from '../src/bot/preflop.js';

// ---------------------------------------------------------------- seeded rng
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- baselines
const checkOrFold = (L) => (L.canCheck ? { type: 'check' } : { type: 'fold' });
const checkOrCall = (L) => (L.canCheck ? { type: 'check' } : { type: 'call' });
const BASELINES = {
  random(view, seat, rnd) {
    const L = legalActions(view);
    const opts = [];
    if (L.canCheck) opts.push({ type: 'check' }); else { opts.push({ type: 'fold' }); opts.push({ type: 'call' }); }
    if (L.minRaiseTo != null) opts.push('raise');
    const o = opts[Math.floor(rnd() * opts.length)];
    if (o === 'raise') {
      const to = Math.round(L.minRaiseTo + rnd() * (L.maxRaiseTo - L.minRaiseTo));
      return { type: 'raise', to };
    }
    return o;
  },
  call(view, seat) { return checkOrCall(legalActions(view)); },
  jam(view, seat) { return jamMove(legalActions(view)); },
  tight15(view, seat) {
    const L = legalActions(view);
    const h = view.holes[seat];
    if (view.street === 'preflop') {
      const pct = CLASS_PCT[classIndex(h[0], h[1])];
      return pct <= 15 ? jamMove(L) : checkOrFold(L);
    }
    const cat = eval7([...h, ...view.board]) >>> 20;
    return cat >= 1 ? checkOrCall(L) : checkOrFold(L);
  },
  nash(view, seat, rnd) { return nashBot(view, seat, rnd, 2); },     // postflop: check/fold, call with two pair or better
  nashcall(view, seat, rnd) { return nashBot(view, seat, rnd, 1); }, // postflop: check, call with any pair or better
};
function nashBot(view, seat, rnd, minCat) { // preflop Nash tables at every depth (jam/fold)
  {
    const L = legalActions(view);
    const h = view.holes[seat];
    if (view.street !== 'preflop') {
      const cat = eval7([...h, ...view.board]) >>> 20;
      return cat >= minCat ? checkOrCall(L) : checkOrFold(L);
    }
    const S = analyze(view, seat);
    const st = preflopStory(S);
    const node = nashNode(S, st, true);
    const cls = classIndex(h[0], h[1]);
    if (node) {
      const p = nodeProbs(node.node, node.stack)[cls];
      const go = rnd() < p;
      if (node.kind === 'jam') return go ? jamMove(L) : checkOrFold(L);
      return go ? { type: 'call' } : { type: 'fold' };
    }
    // not a table situation (limp / sized raise): play tight
    const pct = CLASS_PCT[cls];
    if (L.canCheck) return { type: 'check' };
    return pct <= 8 ? { type: 'call' } : { type: 'fold' };
  }
}
// ARENA_PREV=<dir containing src/> lets you pit the current bot against a snapshot of an older version ('prev-tight' ...)
let prevBot = null;
if (process.env.ARENA_PREV) {
  const { pathToFileURL } = await import('node:url');
  prevBot = (await import(pathToFileURL(process.env.ARENA_PREV.replace(/[\/]$/, '') + '/src/bot.js').href)).botMove;
}
const isPersona = (n) => PERSONAS.includes(n);
function playerFn(name) {
  if (isPersona(name)) return (view, seat, rnd) => botMove(view, seat, { persona: name, rnd });
  if (name.startsWith('prev-')) return (view, seat, rnd) => prevBot(view, seat, { persona: name.slice(5), rnd });
  const f = BASELINES[name];
  if (!f) throw new Error('unknown player ' + name);
  return f;
}

// ---------------------------------------------------------------- one tournament
const STRUCT_MIX = [2, 2, 3, 3, 3, 4, 5, 10, 25, 100];
function pickStructure(spec, seed) {
  if (spec === 'mixed') return structureFor(STRUCT_MIX[seed % STRUCT_MIX.length]);
  return structureFor(parseInt(spec, 10));
}

export function playTournament(lineup, seed, opts = {}) {
  const { struct = 'mixed', ms = 7000, timing = null, maxActions = 6000 } = opts;
  const { stack, levelMs } = pickStructure(struct, seed);
  const rnd = mulberry(seed * 7919 + 17);
  const g = newGame({ stack, levelMs, now: 0, rnd: mulberry(seed * 104729 + 3), names: lineup.map((n, i) => n + '#' + i) });
  const fns = lineup.map(playerFn);
  const drnd = mulberry(seed * 31337 + 5);
  let now = 0, actions = 0;
  while (!g.over && actions < maxActions) {
    const seat = actor(g);
    const view = viewFor(g, seat);
    const t0 = timing ? performance.now() : 0;
    const mv = fns[seat](view, seat, drnd);
    if (timing && isPersona(lineup[seat])) timing.push(performance.now() - t0);
    if (opts.trace) opts.trace(g, seat, mv);
    applyAction(g, seat, mv, now);
    now += ms;
    actions++;
  }
  if (!g.over) { // stalled: rank by chips
    const order = [0, 1, 2].sort((a, b) => g.seats[b].stack - g.seats[a].stack);
    order.forEach((s, i) => { g.places[s] = i + 1; });
  }
  return { places: g.places.slice(), hands: g.handNo };
}

// ---------------------------------------------------------------- matches
const ROT = [[0, 1, 2], [1, 2, 0], [2, 0, 1]];
const PERM6 = [[0, 1, 2], [1, 2, 0], [2, 0, 1], [0, 2, 1], [2, 1, 0], [1, 0, 2]];

// lineup: array of 3 player names (hero first). Returns per-seed results.
function runSeeds(job) {
  const { players, seeds, perms, opts } = job;
  const out = [];
  const timing = opts.timing ? [] : null;
  for (const seed of seeds) {
    const res = players.map(() => ({ wins: 0, place: 0, n: 0 }));
    let hands = 0;
    for (const p of perms) {
      const lineup = p.map((i) => players[i]);
      const r = playTournament(lineup, seed, { ...opts, timing });
      hands += r.hands;
      p.forEach((pi, seat) => { const pl = r.places[seat]; res[pi].wins += pl === 1 ? 1 : 0; res[pi].place += pl; res[pi].n++; });
    }
    out.push({ seed, res, hands });
  }
  return { out, timing };
}

function stats(vals) {
  const n = vals.length, mean = vals.reduce((a, b) => a + b, 0) / n;
  const v = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
  const se = Math.sqrt(v / n);
  return { mean, se, lo: mean - 1.96 * se, hi: mean + 1.96 * se, n };
}

function parseArgs() {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const k = a[i].slice(2);
      if (i + 1 < a.length && !a[i + 1].startsWith('--')) o[k] = a[++i]; else o[k] = true;
    }
  }
  return o;
}

async function runParallel(players, nSeeds, perms, opts, workers, seedBase) {
  const seeds = Array.from({ length: nSeeds }, (_, i) => seedBase + i);
  const chunks = Array.from({ length: workers }, () => []);
  seeds.forEach((s, i) => chunks[i % workers].push(s));
  const parts = await Promise.all(chunks.filter((c) => c.length).map((c) => new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { players, seeds: c, perms, opts } });
    w.on('message', resolve); w.on('error', reject);
  })));
  const all = parts.flatMap((p) => p.out);
  const timing = parts.flatMap((p) => p.timing || []);
  return { all, timing };
}

const pct = (x) => (x * 100).toFixed(1) + '%';
function fmtRow(label, st, extra = '') {
  return `${label.padEnd(26)} win ${pct(st.mean).padStart(6)}  95%CI [${pct(st.lo)}, ${pct(st.hi)}]  n=${st.n}${extra}`;
}

async function main() {
  const o = parseArgs();
  const nSeeds = parseInt(o.n || '300', 10);
  const workers = parseInt(o.workers || '20', 10);
  const seedBase = parseInt(o.seed || '1', 10) * 100000;
  const opts = { struct: o.struct || 'mixed', ms: parseInt(o.ms || '7000', 10), timing: !!o.timing };
  const bots = (o.bots ? String(o.bots).split(',') : PERSONAS);
  const vs = (o.vs ? String(o.vs).split(',') : ['random', 'call', 'jam', 'tight15', 'nash']);
  const t0 = Date.now();
  const allTiming = [];

  if (o.hands) { // custom lineup
    const players = String(o.hands).split(',');
    const { all } = await runParallel(players, nSeeds, PERM6, opts, workers, seedBase);
    console.log(`lineup ${players.join(' / ')}  (${all.length} seeds x 6 seatings)`);
    players.forEach((p, i) => console.log(fmtRow(`${p}#${i}`, stats(all.map((r) => r.res[i].wins / r.res[i].n)))));
  } else if (o.rr) {
    const players = PERSONAS.slice();
    const { all } = await runParallel(players, nSeeds, PERM6, opts, workers, seedBase);
    console.log(`persona round-robin: ${players.join(' / ')} at one table (${all.length} seeds x 6 seatings, chance = 33.3%)`);
    players.forEach((p, i) => console.log(fmtRow(p, stats(all.map((r) => r.res[i].wins / r.res[i].n)), `  avg place ${stats(all.map((r) => r.res[i].place / r.res[i].n)).mean.toFixed(2)}`)));
    // each persona with two copies of another persona (1 vs 2)
    for (const a of PERSONAS) for (const b of PERSONAS) {
      if (a === b) continue;
      const r = await runParallel([a, b, b], nSeeds, ROT, opts, workers, seedBase);
      console.log(fmtRow(`${a} vs 2x ${b}`, stats(r.all.map((x) => x.res[0].wins / x.res[0].n))));
    }
  } else {
    for (const hero of bots) {
      for (const v of vs) {
        const r = await runParallel([hero, v, v], nSeeds, ROT, opts, workers, seedBase);
        const st = stats(r.all.map((x) => x.res[0].wins / x.res[0].n));
        const hands = r.all.reduce((a, x) => a + x.hands, 0) / (r.all.length * 3);
        console.log(fmtRow(`${hero} vs 2x ${v}`, st, `  hands/t ${hands.toFixed(1)}`));
        allTiming.push(...r.timing);
      }
    }
  }
  if (opts.timing && allTiming.length) {
    allTiming.sort((a, b) => a - b);
    const q = (p) => allTiming[Math.min(allTiming.length - 1, Math.floor(allTiming.length * p))];
    console.log(`bot decision time ms: median ${q(0.5).toFixed(2)}  p90 ${q(0.9).toFixed(2)}  p99 ${q(0.99).toFixed(2)}  max ${allTiming[allTiming.length - 1].toFixed(1)}  (n=${allTiming.length})`);
  }
  console.log(`elapsed ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

import { fileURLToPath } from 'node:url';
const norm = (p) => String(p).split('\\').join('/').toLowerCase();
if (!isMainThread) parentPort.postMessage(runSeeds(workerData));
else if (process.argv[1] && norm(fileURLToPath(import.meta.url)) === norm(process.argv[1])) await main();
