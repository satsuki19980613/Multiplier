// サーバー（game_hands / game_poll）から端末の IndexedDB へ、終わったハンドと試合の結果を写す（PrivateMatch から移した）。
// 卓ではハンドが終わるたびに、起動時には me().recent（3 日以内に打った卓）について呼ぶ。同じ卓の同期は直列にする。
import { app } from '../ui/util.js';
import * as store from './store.js';
import { tableViews } from '../tview.js';

const chains = new Map();

/** 卓のビュー（src/tview.js）から試合の記録（store の games の形）を作る。roomId = games.id */
export function gameSummary(view, roomId, hands) {
  const me = view.seat, p = view.players[me], m = view.meta || {};
  return {
    roomId, code: view.room.code, kind: view.room.kind, config: view.config, seat: me, names: view.names.slice(),
    players: view.players.map((x, s) => ({ name: view.names[s], place: x.place, pt: x.pt, bot: !!(m.bot && m.bot[s]) })),
    place: p.place, pt: p.pt, status: view.status, startedAt: view.startedAt, endedAt: view.endedAt, hands,
    stake: m.stake ?? null, buyIn: m.buyIn ?? null, multiplier: m.multiplier ?? null, prize: m.prize ?? null,
  };
}

async function run(roomId, view) {
  if (!view) {
    const mv = (await app.net.rpc('game_poll', { p_game: roomId, p_ver: -1 })).view;
    view = mv ? tableViews(mv, Infinity).views.at(-1) : null;
  }
  if (!view) return;
  let after = await store.lastHandNo(roomId);
  for (let i = 0; i < 50; i++) {
    const list = await app.net.rpc('game_hands', { p_game: roomId, p_after: after });
    if (!Array.isArray(list) || !list.length) break;
    await store.putHands(roomId, list);
    after = list[list.length - 1].handNo;
    if (list.length < 200) break;
  }
  await store.putGame(gameSummary(view, roomId, after));
}

/** 1 卓を同期する（失敗しても投げない。=> 成功したか） */
export function syncRoom(roomId, view = null) {
  const prev = chains.get(roomId) || Promise.resolve();
  const p = prev.then(() => run(roomId, view)).then(() => true, () => false);
  chains.set(roomId, p);
  p.finally(() => { if (chains.get(roomId) === p) chains.delete(roomId); });
  return p;
}

/** 起動時：最近の卓のうち、端末にまだ最後まで写っていないものを同期する */
export async function syncRecent(recent) {
  for (const r of recent || []) {
    try {
      const g = await store.getGame(r.id);
      if (g && g.status === 'finished') continue;
      await syncRoom(r.id);
    } catch (e) { /* IndexedDB が使えない環境など */ }
  }
}
