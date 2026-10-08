// Multiplier のビュー（server/game/rules.js の viewsOf：エンジンの状態 g から山札などを消したもの + meta）を、
// PrivateMatch から移した卓の画面（src/ui/table.js）・ペース（src/pace.js）・ハンド履歴（src/history/*）が読む形（以下「卓のビュー」）に写す。純関数。
//
// 卓のビュー tv：
//   { ver, seat, n: 3, names, status: 'running' | 'finished', startedAt, levelMs, endedAt, winner, handNo,
//     players: [{ stack, status: 'active' | 'sitout' | 'out', place, pt }],
//     hand: null | { handNo, level（1 始まり）, sb, bb, ante: 0, btn, sbSeat, bbSeat, street（0〜3）, hole, board, startStacks, commits, streetBet,
//                    folded, allIn, toAct, streetLastBetTo, lastBetSize, actions, turnStart, deadline, phase: 'betting' | 'settled',
//                    won, shown, names, pots, eliminated, runFrom, startedAt, endedAt },
//     legal（自分の手番なら卓の形の合法手。無ければ null）, room: { code, kind: 'play' | 'private' | 'free' }, config: { mode: ステークス, players: 3 },
//     fx, rematch, meta（Multiplier の meta：stake / buyIn / multiplier / prize / room / bot / clock / result …） }
//
// Multiplier のエンジンはハンドが終わると同じ手で次のハンドを配る（終わったハンドは g.lastHand）。卓の画面はショーダウンを見せてから
// 次のハンドを配りたいので、新しく終わったハンドがあれば、その精算済みのビュー（ver − 0.5）を今のビューの前に挟む（tableViews）。
import { legalActions } from './engine.js';
import { MAX_STRIKES } from '../server/game/rules.js';

const STREET_NO = { preflop: 0, flop: 1, turn: 2, river: 3 };
const streetOfBoard = n => (n >= 5 ? 3 : n === 4 ? 2 : n === 3 ? 1 : 0);
const copy = x => (x == null ? x : JSON.parse(JSON.stringify(x)));

/** その試合の収支（チップ）。1 位は賞金 − buy-in、それ以外は − buy-in（まだ決まっていなければ null） */
export const ptOf = (meta, place) => (place == null ? null : (place === 1 ? meta.prize : 0) - (meta.buyIn || 0));

/** 卓の部屋の種類 */
export const kindOf = meta => (meta.room ? 'private' : meta.stake === 'free' ? 'free' : 'play');

function players(mv, stacks) {
  const c = mv.meta.clock || {};
  return [0, 1, 2].map(s => {
    const out = !!mv.seats[s].out, place = mv.places[s];
    const sitout = !out && !mv.meta.bot[s] && (c.strikes ? c.strikes[s] >= MAX_STRIKES : false);
    return { stack: stacks ? stacks[s] : mv.seats[s].stack, status: out ? 'out' : sitout ? 'sitout' : 'active', place, pt: ptOf(mv.meta, place) };
  });
}

function base(mv, ver) {
  const m = mv.meta;
  return {
    ver, seat: m.seat, n: 3, names: mv.names.slice(), status: mv.over ? 'finished' : 'running',
    startedAt: mv.startedAt, levelMs: mv.levelMs, endedAt: mv.over && mv.lastHand ? mv.lastHand.endedAt : null, winner: mv.winner, handNo: mv.handNo,
    room: { code: m.room || null, kind: kindOf(m) }, config: { mode: m.stake, players: 3 },
    fx: m.fx || null, rematch: m.rematch || null, meta: m, legal: null, pausedAt: null,
  };
}

/** 精算済みのハンド（lastHand）を卓の hand の形に */
export function settledHand(lh) {
  const shown = lh.runFrom != null ? copy(lh.shown) : null;
  return {
    handNo: lh.handNo, level: lh.level + 1, sb: lh.sb, bb: lh.bb, ante: 0, btn: lh.btn, sbSeat: lh.sbSeat, bbSeat: lh.bbSeat,
    street: streetOfBoard(lh.board.length), hole: copy(lh.hole), board: lh.board.slice(), startStacks: lh.start.slice(),
    commits: lh.commits.slice(), streetBet: [0, 0, 0], folded: lh.folded.slice(), allIn: lh.allIn.slice(), toAct: null,
    streetLastBetTo: 0, lastBetSize: lh.bb, actions: copy(lh.actions), turnStart: null, deadline: null, phase: 'settled',
    won: lh.won.slice(), shown, names: shown ? lh.names.slice() : null, pots: copy(lh.pots), eliminated: copy(lh.eliminated || []),
    runFrom: lh.runFrom, startedAt: lh.startedAt, endedAt: lh.endedAt,
  };
}

/** 卓の形の合法手（自分の手番だけ。src/betsize.js と卓のドックが読む） */
export function legalOf(mv) {
  const L = legalActions(mv);
  if (!L || L.seat !== mv.meta.seat) return null;
  return {
    seat: L.seat, canFold: L.toCall > 0, canCheck: L.canCheck, toCall: L.toCall, callPut: L.canCall ? L.callAmount : null,
    minTo: L.minRaiseTo, maxTo: L.maxRaiseTo, aggression: L.minRaiseTo == null ? null : mv.currentBet > 0 ? 'raise' : 'bet',
    pot: L.pot, streetLastBetTo: mv.currentBet,
  };
}

/** 進行中のハンドの卓のビュー */
export function liveView(mv) {
  const v = base(mv, mv.ver), c = mv.meta.clock || {}, a = mv.toAct, bot = a != null && mv.meta.bot[a];
  v.players = players(mv);
  v.hand = {
    handNo: mv.handNo, level: mv.level + 1, sb: mv.sb, bb: mv.bb, ante: 0, btn: mv.button, sbSeat: mv.sbSeat, bbSeat: mv.bbSeat,
    street: STREET_NO[mv.street], hole: copy(mv.holes), board: mv.board.slice(), startStacks: mv.handStart.slice(),
    commits: mv.total.slice(), streetBet: mv.bet.slice(), folded: mv.folded.slice(), allIn: mv.allIn.slice(), toAct: a,
    streetLastBetTo: mv.currentBet, lastBetSize: mv.minRaise, actions: copy(mv.actions || []),
    // 持ち時間のバーは人間の手番だけ（Bot は考える間だけで、締め切りを見せても意味がない）
    turnStart: a != null && !bot ? c.turnStart ?? null : null, deadline: a != null && !bot ? c.deadline ?? null : null,
    phase: 'betting', won: null, shown: null, names: null, pots: null, eliminated: [], runFrom: mv.runFrom ?? null,
    startedAt: mv.handAt, endedAt: null,
  };
  v.legal = legalOf(mv);
  return v;
}

/** 精算済みのハンド lh（既定は lastHand）を見せる卓のビュー（ver はそのビューの ver）。スタックは精算した直後（次のハンドのブラインドの前）。
 *  席の状態はそのハンドの時点：配られていない席とこのハンドで飛んだ席は out（順位はもう決まっている） */
export function settledView(mv, ver, lh = mv.lastHand) {
  const v = base(mv, ver);
  v.players = players(mv, lh.start.map((x, s) => x + lh.net[s]));
  const gone = new Set((lh.eliminated || []).map(e => e.seat));
  v.players.forEach((p, s) => { if (lh.start[s] <= 0 || gone.has(s)) p.status = 'out'; else if (p.status === 'out') { p.status = 'active'; p.place = null; p.pt = null; } });
  v.hand = settledHand(lh);
  if (lh !== mv.lastHand) { v.status = 'running'; v.endedAt = null; }
  return v;
}

/**
 * 受け取った Multiplier のビューから、卓に当てる卓のビューの列を作る。
 * settledNo = 卓がもう見せた（または見せないことにした）精算済みのハンドの番号。=> { views, settledNo }
 *   - 新しく終わったハンドがあれば、その精算済みのビュー（ver − 0.5）を先に入れる
 *   - 終局していれば、最後のビューは精算済みの最後のハンド（status = 'finished'）。最後のハンドが終わらずに終局した
 *     （Bot だけが残った・リタイアで決着）なら、そのハンドは描かない（hand = null）
 */
export function tableViews(mv, settledNo) {
  const lh = mv.lastHand, views = [];
  // 新しく終わったハンド（古い順）。ふつうは 1 つ。ブラインドだけでオールインになったハンドが同じ手で続けて終わると 2 つ以上
  const fresh = [...(mv.prevHands || []), lh].filter(x => x && x.handNo > settledNo);
  const last = lh ? Math.max(settledNo, lh.handNo) : settledNo;
  // 終局：最後のハンドが終局の手なら、そのハンドの精算済みのビューが最後のビュー
  const endsWithLast = mv.over && lh && lh.handNo === mv.handNo;
  const k = fresh.length - (endsWithLast ? 1 : 0);
  for (let i = 0; i < k; i++) views.push(settledView(mv, mv.ver - 0.5 - (k - 1 - i) * 0.1, fresh[i]));
  if (endsWithLast) views.push(settledView(mv, mv.ver));
  else if (mv.over) { const v = base(mv, mv.ver); v.players = players(mv); v.hand = null; views.push(v); }
  else views.push(liveView(mv));
  return { views, settledNo: last };
}

/** 卓の操作（PrivateMatch の move：allin を含む）を Multiplier のエンジンの move に。l = 卓の形の合法手 */
export function toMove(move, l) {
  if (move.type !== 'allin') return move.type === 'raise' ? { type: 'raise', to: move.to } : { type: move.type };
  if (l && l.maxTo != null) return { type: 'raise', to: l.maxTo };
  return { type: 'call' };
}

/**
 * ハンド履歴の記録（端末の IndexedDB に保存する形。PrivateMatch の engine.handRecord の rec と同じ）。lastHand から作る。
 * サーバー（server/game/db.js）が終わったハンドごとに保存し、game_hands で自分の手札（hole）を足して返す。
 */
export function recordOf(lh) {
  const h = settledHand(lh);
  return {
    handNo: h.handNo, playedAt: h.startedAt, endedAt: h.endedAt, level: h.level, sb: h.sb, bb: h.bb, ante: 0,
    btn: h.btn, sbSeat: h.sbSeat, bbSeat: h.bbSeat, startStacks: h.startStacks,
    shown: h.shown ? h.shown : [null, null, null], names: h.names ? h.names : [null, null, null],
    board: h.board, actions: h.actions, won: h.won, pots: h.pots, eliminated: h.eliminated,
  };
}
