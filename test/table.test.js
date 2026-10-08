// The server side of the play screen from PrivateMatch (server/game/rules.js): the reveal time after a hand (run-out + winner GIF), Away /
// I'm back, winner GIFs (private tables), the rematch after a private table, chat, and the HTTP routing of those ops.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actor, legalActions } from '../src/engine.js';
import { runoutMs, FX_MS } from '../src/pace.js';
import { CHAT_MIN_INTERVAL_MS, CHAT_MAX_UNITS } from '../src/chat.js';
import {
  MoveError, TURN_MS, REVEAL_MS, SITOUT_MS, MAX_STRIKES, REMATCH_MS, REMATCH_HOST_WAIT_MS,
  createTable, applyRequest, commit, viewsOf, revealMsOf, finishedHands, rematchLeader, rematchSeats, rematchStarted, rematchOpen, postChat,
} from '../server/game/rules.js';
import { createHandler, STATUS } from '../server/game/handler.js';

function mulberry(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const T0 = 1_700_000_000_000;
const errCode = f => { try { f(); } catch (e) { return e.code; } return null; };
const people = (fx = [null, null, null]) => [0, 1, 2].map(i => ({ uid: 'u' + i, name: 'P' + i, bot: null, fx: fx[i], host: i === 0 }));
const mk = ({ room = null, seed = 1, fx, players } = {}) => { const t = createTable({ players: players || people(fx), stake: 'low', now: T0, rnd: mulberry(seed), room, forceMultiplier: 2 }); return { state: t.state, meta: t.meta }; };
const run = (g, seat, req, now) => { const o = commit(g, applyRequest(g, seat, req, now)); return { state: o.state, meta: o.meta }; };
const act = (g, move, now) => run(g, actor(g.state), { op: 'act', ver: g.state.ver, move }, now);
// play until the game is over, everybody calling (and the first human folding now and then)
function playOut(g, now = T0 + 10000) {
  let n = 0;
  while (!g.state.over && n++ < 5000) { const L = legalActions(g.state); g = act(g, L.canCheck ? { type: 'check' } : { type: 'call' }, now += 1000); }
  return g;
}

test('reveal time: the next turn waits for the result, the run-out and (private tables) the winner GIF', () => {
  let g = mk({ room: '123456', fx: ['dance-1', 'cheer-2', null] });
  g = act(g, { type: 'raise', to: g.state.seats[actor(g.state)].stack + g.state.bet[actor(g.state)] }, T0 + 9000);
  for (let i = 0; i < 2 && g.state.handNo === 1; i++) g = act(g, { type: 'call' }, T0 + 9100 + i);
  const before = { handNo: 1, lastHand: null }, hs = finishedHands(before, g.state);
  assert.ok(hs.length >= 1 && hs[0].handNo === 1);
  const lh = g.state.lastHand;
  assert.equal(revealMsOf(lh, null), REVEAL_MS + runoutMs(lh.runFrom));
  const withFx = revealMsOf(lh, g.meta.fx), w = lh.won.map((x, s) => x - lh.commits[s]), top = w.indexOf(Math.max(...w));
  assert.equal(withFx - revealMsOf(lh, null), g.meta.fx[top] && w.filter(x => x === w[top]).length === 1 ? FX_MS : 0);
  if (!g.state.over) assert.ok(g.meta.clock.turnStart >= T0 + 9100 + REVEAL_MS + runoutMs(lh.runFrom), 'the clock starts after the run-out');
  // a fold: only the result time
  let f = mk();
  f = act(f, { type: 'fold' }, T0 + 9000); f = act(f, { type: 'fold' }, T0 + 9100);
  assert.equal(f.meta.clock.turnStart, T0 + 9100 + REVEAL_MS);
});

test('Away / I\'m back: away plays the turn after SITOUT_MS; back gives the turn its time again; versions go up', () => {
  let g = mk();
  const a = actor(g.state), v0 = g.state.ver;
  g = run(g, a, { op: 'sitout' }, T0 + 9000);
  assert.equal(g.meta.clock.strikes[a], MAX_STRIKES); assert.ok(g.state.ver > v0);
  assert.equal(g.meta.clock.deadline, T0 + 9000 + SITOUT_MS);
  assert.equal(viewsOf(g.state, g.meta)[a].meta.clock.strikes[a], MAX_STRIKES);
  g = run(g, a, { op: 'sitin' }, T0 + 9500);
  assert.equal(g.meta.clock.strikes[a], 0);
  assert.ok(g.meta.clock.deadline >= T0 + 9500 + TURN_MS);
  // a seat that is not to act: only the strikes change
  const b = (a + 1) % 3, d = g.meta.clock.deadline;
  g = run(g, b, { op: 'sitout' }, T0 + 9600);
  assert.equal(g.meta.clock.strikes[b], MAX_STRIKES); assert.equal(g.meta.clock.deadline, d);
  assert.equal(errCode(() => applyRequest(mk({ players: [people()[0], { uid: null, name: 'B', bot: { persona: 'tight' } }, people()[2]] }), 1, { op: 'sitout' }, T0)), 'not_found', 'not for a bot');
});

test('winner GIFs: only a private table keeps them; the seat can change its own; bad slugs become null', () => {
  const play = mk({ fx: ['a-1', 'b-2', null] });
  assert.equal(play.meta.fx, null, 'a table from the queue has no GIFs');
  let g = mk({ room: '123456', fx: ['a-1', 'bad slug!', null] });
  assert.deepEqual(g.meta.fx, ['a-1', null, null]);
  assert.equal(g.meta.hostSeat, 0);
  const v0 = g.state.ver;
  g = run(g, 2, { op: 'fx', fx: 'c-3' }, T0);
  assert.deepEqual(g.meta.fx, ['a-1', null, 'c-3']); assert.ok(g.state.ver > v0);
  assert.deepEqual(viewsOf(g.state, g.meta)[1].meta.fx, ['a-1', null, 'c-3'], 'everybody sees the GIFs');
  const p2 = run(play, 0, { op: 'fx', fx: 'x' }, T0);
  assert.equal(p2.meta.fx, null, 'nothing happens on a table from the queue');
});

test('rematch: a private table that ended opens it; the host leads (or the first who stayed after the host waits too long)', () => {
  let g = playOut(mk({ room: '123456' }));
  assert.ok(g.state.over);
  const rm = g.meta.rematch, end = rm.endedAt;
  assert.deepEqual([rm.stay, rm.gone, rm.next, rm.hostSeat], [[], [], null, 0]);
  assert.equal(rm.closesAt, end + REMATCH_MS);
  assert.equal(playOut(mk()).meta.rematch, null, 'not after a table from the queue');
  assert.equal(rematchLeader(rm, end + 1000), 0, 'the host may still come');
  g = run(g, 2, { op: 'stay' }, end + 2000);
  assert.deepEqual(g.meta.rematch.stay, [2]);
  assert.equal(errCode(() => rematchSeats(g, 2, end + 3000)), 'not_host');
  assert.equal(rematchLeader(g.meta.rematch, end + REMATCH_HOST_WAIT_MS + 1), 2, 'the host did not come: the first who stayed leads');
  assert.equal(errCode(() => rematchSeats(g, 0, end + 3000)), null);
  assert.deepEqual(rematchSeats(g, 0, end + 3000).sort(), [0, 2], 'the host counts as staying');
  // seat 1 leaves: out of the rematch for good
  g = run(g, 1, { op: 'depart' }, end + 4000);
  assert.deepEqual(g.meta.rematch.gone, [1]);
  assert.equal(errCode(() => applyRequest(g, 1, { op: 'stay' }, end + 5000)), 'room_closed');
  // started: no more staying; the view points everybody to the new table
  g = (() => { const o = commit(g, rematchStarted(g, 'g2', [0, 2])); return { state: o.state, meta: o.meta }; })();
  assert.deepEqual(g.meta.rematch.next, { id: 'g2', seats: [0, 2] });
  assert.equal(rematchOpen(g.meta.rematch, end + 6000), false);
  assert.equal(errCode(() => rematchSeats(g, 0, end + 6000)), 'room_closed');
  assert.deepEqual(viewsOf(g.state, g.meta)[2].meta.rematch.next, { id: 'g2', seats: [0, 2] });
  // nothing is paid again by these steps
  const o = commit(g, applyRequest(g, 0, { op: 'fx', fx: 'z-1' }, end + 7000));
  assert.equal(o.payouts, null);
  // the rematch window closes
  let h = playOut(mk({ room: '654321', seed: 3 }));
  assert.equal(errCode(() => applyRequest(h, 1, { op: 'stay' }, h.meta.rematch.closesAt)), 'room_closed');
  h = run(h, 1, { op: 'stay' }, h.meta.rematch.endedAt + 1);
  assert.equal(errCode(() => rematchSeats(h, 0, h.meta.rematch.endedAt + 2)), null);
  const lone = playOut(mk({ room: '111111', seed: 4 }));
  assert.equal(errCode(() => rematchSeats(lone, 0, lone.meta.rematch.endedAt + 1)), 'not_enough', 'the host alone');
});

test('chat: private tables only, normalised text, one message a second per seat', () => {
  const g = mk({ room: '123456' });
  assert.equal(postChat(g, 1, '  こんにちは\n ', null, T0), 'こんにちは');
  assert.equal(errCode(() => postChat(mk(), 1, 'hi', null, T0)), 'chat_closed');
  assert.equal(errCode(() => postChat(g, 1, '   ', null, T0)), 'malformed');
  assert.equal(errCode(() => postChat(g, 1, 'あ'.repeat(CHAT_MAX_UNITS), null, T0)), 'malformed', 'too long');
  assert.equal(errCode(() => postChat(g, 1, 'hi', T0, T0 + CHAT_MIN_INTERVAL_MS - 1)), 'too_fast');
  assert.equal(postChat(g, 1, 'hi', T0, T0 + CHAT_MIN_INTERVAL_MS), 'hi');
  const b = mk({ room: '123456', players: [people()[0], { uid: null, name: 'B', bot: { persona: 'tight' } }, people()[2]] });
  assert.equal(errCode(() => postChat(b, 1, 'hi', null, T0)), 'not_found', 'a bot seat');
});

// ---- HTTP ----
const U = '00000000-0000-4000-8000-000000000001', GID = '00000000-0000-4000-8000-0000000000aa';
const calls = [];
const rec = name => async (...a) => { calls.push([name, ...a]); if (a[1] === GID.replace('aa', 'bb')) throw new MoveError(name === 'chat' ? 'too_fast' : 'room_closed'); return { ok: name }; };
const handler = createHandler({
  allowedOrigins: [], verifyToken: async t => (t === 'good' ? U : null), logError: () => {},
  ...Object.fromEntries(['sitout', 'sitin', 'fx', 'stay', 'depart', 'rematch', 'chat', 'roomCreate', 'roomJoin'].map(n => [n, rec(n)])),
});
const req = body => handler(new Request('https://x/', { method: 'POST', headers: { Authorization: 'Bearer good' }, body: JSON.stringify(body) }));

test('HTTP: the table ops are validated and routed; their errors have statuses', async () => {
  calls.length = 0;
  for (const b of [{ op: 'sitout' }, { op: 'stay', game: 'x' }, { op: 'fx', game: GID, fx: 5 }, { op: 'chat', game: GID }, { op: 'chat', game: GID, text: 'x'.repeat(401) },
    { op: 'room_create', stake: 'low', fx: {} }, { op: 'room_join', code: '123456', fx: 1 }])
    assert.equal((await req(b)).status, 422, JSON.stringify(b));
  assert.equal(calls.length, 0, 'nothing reached the database');
  for (const op of ['sitout', 'sitin', 'stay', 'depart', 'rematch']) {
    assert.equal((await req({ op, game: GID, junk: 1 })).status, 200);
    assert.deepEqual(calls.at(-1), [op, U, GID]);
  }
  await req({ op: 'fx', game: GID, fx: 'party-1' }); assert.deepEqual(calls.at(-1), ['fx', U, GID, 'party-1']);
  await req({ op: 'fx', game: GID }); assert.deepEqual(calls.at(-1), ['fx', U, GID, null], 'no fx = no GIF');
  await req({ op: 'chat', game: GID, text: 'hi' }); assert.deepEqual(calls.at(-1), ['chat', U, GID, 'hi']);
  await req({ op: 'room_create', stake: 'mid', fx: 'a-1' }); assert.deepEqual(calls.at(-1), ['roomCreate', U, 'mid', 'a-1']);
  await req({ op: 'room_join', code: '123456', fx: 'a-1' }); assert.deepEqual(calls.at(-1), ['roomJoin', U, '123456', 'a-1']);
  const tf = await req({ op: 'chat', game: GID.replace('aa', 'bb'), text: 'hi' });
  assert.equal(tf.status, 429); assert.deepEqual(await tf.json(), { error: 'too_fast' });
  const rc = await req({ op: 'stay', game: GID.replace('aa', 'bb') });
  assert.equal(rc.status, 409); assert.deepEqual(await rc.json(), { error: 'room_closed' });
  for (const c of ['chat_closed', 'chat_full', 'not_host', 'not_enough', 'room_closed']) assert.equal(STATUS[c], 409, c);
});

test('steps that only change meta do not make the move of the seat to act stale', () => {
  let g = mk({ room: '123456', fx: ['dance-1', null, null] });
  const a = actor(g.state), b = (a + 1) % 3, v = g.state.ver;
  g = run(g, b, { op: 'sitout' }, T0 + 9000);
  g = run(g, b, { op: 'fx', fx: null }, T0 + 9100);
  assert.ok(g.state.ver > v);
  assert.equal(errCode(() => applyRequest(g, a, { op: 'act', ver: v, move: { type: 'call' } }, T0 + 9200)), null, 'the old version is still taken');
  g = run(g, a, { op: 'act', ver: v, move: { type: 'call' } }, T0 + 9200);
  // after a real move the old version is stale
  const c = actor(g.state);
  assert.equal(errCode(() => applyRequest(g, c, { op: 'act', ver: v, move: { type: 'fold' } }, T0 + 9300)), 'stale');
  assert.equal(errCode(() => applyRequest(g, c, { op: 'act', ver: g.state.ver + 1, move: { type: 'fold' } }, T0 + 9300)), 'stale');
});

test('going away while the result is still shown keeps the turn until the reveal is over', () => {
  let g = mk();
  g = act(g, { type: 'fold' }, T0 + 9000); g = act(g, { type: 'fold' }, T0 + 9100);
  const a = actor(g.state), ts = g.meta.clock.turnStart;
  assert.ok(ts > T0 + 9200);
  g = run(g, a, { op: 'sitout' }, T0 + 9200);
  assert.equal(g.meta.clock.deadline, ts + SITOUT_MS);
});

test('a private table ended inside an unfinished hand times the rematch from the end, not from the hand before', () => {
  let g = mk({ room: '123456' });
  g = act(g, { type: 'fold' }, T0 + 9000); g = act(g, { type: 'fold' }, T0 + 9100);   // hand 1 finished
  const end = T0 + 60_000;
  g = run(g, 1, { op: 'retire' }, end - 1000);
  g = run(g, actor(g.state) === 2 ? 0 : 2, { op: 'retire' }, end);
  assert.ok(g.state.over);
  if (g.state.lastHand.handNo !== g.state.handNo) assert.ok(g.meta.rematch.endedAt >= end - 1000);
  assert.equal(g.meta.rematch.closesAt, g.meta.rematch.endedAt + REMATCH_MS);
});
