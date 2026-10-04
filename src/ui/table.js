// The table: 3 seats, community cards, pot, action dock, hand-end animation, polling and tick, result.
// State comes only from the server views (game_poll / act / tick); nothing here decides rules except legalActions(view).
import { legalActions } from '../engine.js';
import { BLINDS, STAKES } from '../spin.js';
import { $, app, esc, fmt, head, openDlg, toast, setHTML, cardHTML, fly, ordinal, clock, REDUCE, EASE, STAKE_LABEL } from './util.js';

const GRACE_MS = 1500, REVEAL_MS = 3500, TURN_MS = 15000;
const PLATE_MS = 2400, LOCK_MS = 350;
const sum = a => a.reduce((s, x) => s + x, 0);
const net = () => app.net;

let T = null; // the running table (null when none)

/* ===================== entry / exit ===================== */
/** first view of a game (for the multiplier wheel before the table opens) */
export async function peek(id) {
  const r = await net().rpc('game_poll', { p_game: id, p_ver: -1 });
  clock.offset = r.now - Date.now();
  return r.view;
}
export function enter(id) {
  leave();
  T = {
    game: id, ver: -1, v: null, me: 0, busy: false, dead: false, timer: 0, rev: null, tw: null, lockUntil: 0, pre: null,
    plates: [null, null, null], seenHand: 0, rs: null, resultShown: false, tickAt: 0, tickBusy: false, clockCache: null,
    revHole: null, sh: { handNo: -1, board: -1, up: [false, false, false], bet: [0, 0, 0], init: false }, loadedAt: Date.now(),
  };
  $('#dock').innerHTML = '<div id="dockMain" style="display:contents"></div>';
  for (const id of ['#seatL', '#seatR', '#seatM', '#pot', '#boardC', '#tInfo', '#betM']) { const e = $(id); e.innerHTML = ''; e._h = null }
  renderLoading();
  document.body.dataset.screen = 'game';
  refit();
  poll();
  T.tickTimer = setInterval(() => { maybeTick(); tickClock() }, 400);
}
export function leave() {
  if (!T) return;
  const h = $('#rsheet'); if (h) h.remove();
  T.dead = true; clearTimeout(T.timer); clearInterval(T.tickTimer); clearTimeout(T.revTimer); clearTimeout(T.platesTimer); cancelAnimationFrame(T.raf);
  document.querySelectorAll('.fly').forEach(e => e.remove());
  if ($('#overDlg').open) $('#overDlg').close();
  T = null;
}
export const active = () => !!T;
export function resultOpen() { return !!T && T.resultShown }

function renderLoading() {
  setHTML($('#dockMain'), '<span class="dk-title">…</span><span class="dots"><i></i><i></i><i></i></span>');
  $('#dock').classList.add('idle');
}

/* ===================== sync ===================== */
async function poll() {
  const t = T; if (!t || t.dead) return; clearTimeout(t.timer);
  try {
    const r = await net().rpc('game_poll', { p_game: t.game, p_ver: t.ver });
    if (t !== T) return;
    clock.offset = r.now - Date.now();
    if (r.view && !t.busy) apply(r.view);
  } catch (e) {
    if (t !== T) return;
    if (e.code === 'not_found') { toast('卓が見つかりません'); return app.nav.toMenu() }
  }
  if (t !== T || t.dead) return;
  maybeTick();
  if (t.v && t.v.over && !t.rev) return;           // finished: no more polling
  const mine = t.v && t.v.toAct === t.me && !t.rev;
  t.timer = setTimeout(poll, document.hidden ? 4000 : mine ? 2500 : 1000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && T) poll() });

const isBot = s => !!(T && T.v && T.v.meta.bot && T.v.meta.bot[s]);
// advance the table when something is due: a bot past botAt, or someone past deadline + grace (the server decides; 409 not_yet is normal)
async function maybeTick() {
  const t = T, v = t && t.v; if (!v || v.over || t.tickBusy || t.busy || v.toAct == null) return;
  const c = v.meta.clock; if (!c || Date.now() < t.tickAt) return;
  const now = clock.now(), a = v.toAct;
  const due = isBot(a) ? (c.botAt != null && now >= c.botAt) : (c.deadline != null && now > c.deadline + GRACE_MS);
  if (!due) return;
  t.tickBusy = true;
  try {
    const r = await net().game({ op: 'tick', game: t.game });
    if (t === T) { clock.offset = r.now - Date.now(); apply(r.view) }
  } catch (e) {
    if (t === T) t.tickAt = Date.now() + (e.code === 'not_yet' ? 700 : 1500);
  } finally { t.tickBusy = false }
}

/* ===================== applying a view ===================== */
function apply(v) {
  const t = T; if (!v || v.ver <= t.ver) return;
  const prev = t.v, first = !prev;
  t.v = v; t.ver = v.ver; t.me = v.meta.seat;
  if (!first) notePlates(prev, v);
  const lh = v.lastHand;
  if (lh && lh.handNo !== t.seenHand) {
    t.seenHand = lh.handNo;
    if (!first) startReveal(lh, prev);
    else if (v.over && lh.endedAt != null && clock.now() - lh.endedAt < REVEAL_MS) startReveal(lh, null);
  }
  if (!prev || (prev.toAct !== t.me && v.toAct === t.me)) t.lockUntil = Date.now() + LOCK_MS;
  if (t.rs && !(v.toAct === t.me && !t.rev)) closeSheet();
  render();
  autoPre();
  checkResult();
}

function notePlates(prev, cur) {
  if (prev.handNo !== cur.handNo || prev.toAct == null) return;
  const s = prev.toAct; let k = null;
  if (cur.folded[s] && !prev.folded[s]) k = 'fold';
  else {
    const d = cur.total[s] - prev.total[s], toCall = Math.max(0, prev.currentBet - prev.bet[s]);
    if (d > 0) k = cur.allIn[s] && !prev.allIn[s] ? 'allin' : d > toCall ? (prev.currentBet === 0 ? 'bet' : 'raise') : 'call';
    else if (toCall === 0) k = 'check';
  }
  if (k) {
    T.plates[s] = { k, t: Date.now() };
    clearTimeout(T.platesTimer); T.platesTimer = setTimeout(() => { if (T) render() }, PLATE_MS + 60);
  }
}
const plateOn = s => { const p = T.plates[s]; return p && Date.now() - p.t < PLATE_MS ? p : null };

/* ---------- hand-end reveal ---------- */
const revActive = () => !!(T && T.rev);
function startReveal(lh, prev) {
  const t = T, v = t.v;
  const showdown = lh.shown.some(x => x);
  const left = lh.endedAt != null ? lh.endedAt + REVEAL_MS - clock.now() : REVEAL_MS;
  const dur = Math.max(1600, Math.min(REVEAL_MS, left));
  const win = [0, 0, 0];
  for (const p of lh.pots) { const share = Math.floor(p.amount / p.winners.length); p.winners.forEach((s, i) => { win[s] += share + (i < p.amount - share * p.winners.length ? 1 : 0) }) }
  const after = [0, 1, 2].map(s => v.over ? v.seats[s].stack : v.handStart[s]);
  // stack shown before the payout: what is left after the chips went into the pot. A seat that was all-in would show 0 here,
  // so a winner shows its hand-start stack instead and counts up to the final stack
  const pre = after.map((a, s) => { const p = Math.max(0, a - win[s]); return p === 0 && win[s] > 0 ? Math.max(0, a - lh.net[s]) : p });
  const winners = new Set(lh.pots.flatMap(p => p.winners));
  const hole = (prev && prev.holes[t.me]) || null;
  t.rev = { lh, until: Date.now() + dur, stage: 1, showdown, win, after, pre, winners, hole };
  t.tw = null;
  clearTimeout(t.revTimer);
  const at2 = showdown && !REDUCE ? 1000 : 250, at3 = Math.max(at2 + 200, dur - 850);
  t.revTimer = setTimeout(() => { if (T !== t || !t.rev) return; t.rev.stage = 2; render();
    t.revTimer = setTimeout(() => { if (T !== t || !t.rev) return; t.rev.stage = 3; payout();
      t.revTimer = setTimeout(endReveal, Math.max(100, dur - at3)) }, at3 - at2) }, at2);
  closeSheet();
}
function payout() {
  const t = T, r = t.rev;
  t.tw = { from: r.pre, to: r.after, k: 0 };
  render();
  const pot = $('#pot b');
  r.lh.pots.forEach((p, i) => p.winners.forEach(s => {
    const dst = document.querySelector(`[data-stk="${s}"]`);
    const share = Math.floor(p.amount / p.winners.length);
    fly(pot, dst, '+' + fmt(share), s === t.me ? 'y' : 'c', (i + 1) * 60);
  }));
  tween(r.pre, r.after, REDUCE ? 0 : 650);
}
function tween(from, to, D) {
  const t = T; cancelAnimationFrame(t.raf);
  if (!D || document.hidden) { t.tw = null; render(); return }
  const t0 = performance.now();
  const step = now => {
    if (T !== t || !t.tw) return;
    const k = Math.max(0, Math.min(1, (now - t0) / D)), e = 1 - Math.pow(1 - k, 3); t.tw.k = e;
    document.querySelectorAll('[data-stk]').forEach(el => { const s = +el.dataset.stk; el.textContent = fmt(from[s] + (to[s] - from[s]) * e) });
    if (k < 1) t.raf = requestAnimationFrame(step); else { t.tw = null }
  };
  t.raf = requestAnimationFrame(step);
}
function endReveal() {
  const t = T; if (!t) return;
  t.rev = null; t.tw = null; cancelAnimationFrame(t.raf);
  render(); autoPre(); checkResult();
}

/* ---------- result ---------- */
const placeOf = (v, s) => v.places[s] ?? (v.over && v.winner === s ? 1 : null);
function checkResult() {
  const t = T, v = t.v; if (!v || t.rev) return;
  if (v.over ? !t.overShown : (placeOf(v, t.me) != null && !t.resultShown)) showResult();
}
async function showResult() {
  const t = T; t.resultShown = true; if (t.v.over) t.overShown = true;
  const v = t.v, me = t.me, m = v.meta, place = placeOf(v, me), stake = m.stake, buy = m.buyIn || 0;
  const gain = place === 1 ? m.prize : 0, delta = gain - buy;
  const order = [0, 1, 2].map(s => ({ s, p: placeOf(v, s) ?? 9 })).sort((a, b) => a.p - b.p);
  const rows = order.map(({ s, p }) => `<li class="${s === me ? 'me-row' : ''}"><span class="pn">${p < 9 ? p : '–'}</span><span class="nm2">${s === me ? '<span class="me">YOU</span> ' : ''}${esc(v.names[s])}</span><span class="pr">${p === 1 ? fmt(m.prize) : ''}</span></li>`).join('');
  const draw = bal => `${head('RESULT', place === 1 ? 'Winner' : v.over ? 'Game over' : 'Eliminated', place === 1 ? 'c' : '')}
    <div class="over-hd"><span class="place${place === 1 ? ' p1' : ''}">${place ?? '–'}<sup>${place ? ordinal(place).slice(String(place).length) : ''}</sup></span></div>
    <div class="over-gain ${delta > 0 ? 'up' : delta < 0 ? 'down' : 'even'}">${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${fmt(Math.abs(delta))}<small>CHIPS</small></div>
    <ul class="over-rows">${rows}</ul>
    <div class="over-bal"><span>BALANCE</span><b id="ovBal">${bal == null ? '…' : fmt(bal)}</b></div>
    <div class="btns">${v.over ? '' : '<button class="btn ghost" data-act="watch" type="button">Watch</button>'}<button class="btn ${v.over ? 'ghost' : 'ghost'}" data-act="menu" type="button">Menu</button><button class="btn primary" data-act="again" type="button" id="againBtn" ${v.over ? '' : 'disabled'}>Play again</button></div>`;
  $('#overBody').innerHTML = draw(m.result && m.result.after && m.result.after[me] != null ? m.result.after[me] : null);
  const dlg = $('#overDlg'); if (!dlg.open) openDlg('#overDlg');
  $('#overBody').onclick = e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'watch') { dlg.close(); render() }
    if (b.dataset.act === 'menu') { dlg.close(); app.nav.toMenu() }
    if (b.dataset.act === 'again') { dlg.close(); app.nav.playAgain(stake) }
  };
  dlg.oncancel = e => e.preventDefault();
  const p = await app.nav.refreshMe();
  if (T !== t || !p) return;
  const bal = $('#ovBal'); if (bal) bal.textContent = fmt(p.chips);
  if (v.over) {
    const ok = stake === 'free' ? p.freeroll && p.freeroll.eligible : p.chips >= STAKES[stake].minChips && p.chips >= STAKES[stake].buyIn;
    const b = $('#againBtn'); if (b) b.disabled = !ok;
  }
}

/* ===================== model ===================== */
function model() {
  const t = T, v = t.v, r = t.rev, lh = v.lastHand, me = t.me;
  const M = { board: r ? lh.board : v.board, pot: r ? (r.stage >= 3 ? 0 : sum(lh.pots.map(p => p.amount))) : sum(v.total), seats: [] };
  for (let s = 0; s < 3; s++) {
    const busted = r && lh.busted.includes(s);
    const out = v.seats[s].out && !(r && r.stage < 3 && busted);
    let stack = v.seats[s].stack;
    if (r) stack = r.stage >= 3 ? (t.tw ? t.tw.from[s] + (t.tw.to[s] - t.tw.from[s]) * t.tw.k : r.after[s]) : r.pre[s];
    const inHand = r ? (!!lh.shown[s] || r.winners.has(s)) : !v.folded[s] && !v.seats[s].out;
    const folded = r ? (!out && !inHand) : v.folded[s] && !v.seats[s].out;
    let cards = null, up = false;   // cards: array of card ints, 'back' x2, or null
    if (r) {
      if (lh.shown[s]) { cards = lh.shown[s]; up = true }
      else if (s === me && r.hole) cards = r.hole;
      else cards = null;
    } else if (!v.seats[s].out) {
      if (s === me) cards = v.holes[s];
      else if (!v.folded[s] && !v.over) cards = 'back';
    }
    M.seats[s] = {
      s, out, folded, stack, up, cards, bet: r ? 0 : v.bet[s], allIn: !r && v.allIn[s] && !v.seats[s].out,
      win: !!(r && r.stage >= 2 && r.winners.has(s)), place: v.places[s],
      away: !!(v.meta.clock && v.meta.clock.strikes && v.meta.clock.strikes[s] >= 2 && !v.seats[s].out && !isBot(s)),
    };
  }
  return M;
}

/* ===================== rendering ===================== */
function render() {
  const t = T; if (!t || !t.v) return;
  const M = model(), v = t.v, me = t.me, L = (me + 1) % 3, R = (me + 2) % 3;
  let ch = renderInfo();
  ch = setHTML($('#seatL'), seatHTML(L, M, false)) || ch;
  ch = setHTML($('#seatR'), seatHTML(R, M, false)) || ch;
  ch = setHTML($('#seatM'), seatHTML(me, M, true)) || ch;
  const mb = M.seats[me].bet;
  ch = setHTML($('#betM'), `<div class="bchip${mb ? '' : ' none'}"><i></i><b>${fmt(mb)}</b></div>`) || ch;
  ch = setHTML($('#pot'), `<span>POT</span><b>${fmt(M.pot)}</b>`) || ch; $('#pot').classList.toggle('zero', !M.pot);
  ch = setHTML($('#boardC'), Array.from({ length: 5 }, (_, i) => M.board[i] != null ? cardHTML(M.board[i]) : '<div class="slot"></div>').join('')) || ch;
  ch = renderDock(M) || ch;
  afterRender(M);
  tickClock();
  if (ch) refit();
}
function renderInfo() {
  const v = T.v, m = v.meta;
  const free = m.stake === 'free';
  return setHTML($('#tInfo'), `<div class="lv"><b>${fmt(v.sb)}/${fmt(v.bb)}</b><span>LV ${v.level + 1}</span></div>
    <div class="nx" id="nx"><span>NEXT</span><b id="nxv"></b></div>
    <div class="pz">${free ? '<span class="mx free">FREE</span>' : `<span class="mx">×${fmt(m.multiplier)}</span>`}<b>${fmt(m.prize)}</b></div>`);
}
function nextLevelText() {
  const v = T.v; if (v.level >= BLINDS.length - 1) return { t: 'MAX', soon: false };
  const ms = v.startedAt + (v.level + 1) * v.levelMs - clock.now();
  const s = Math.max(0, Math.ceil(ms / 1000));
  return { t: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, soon: s <= 10 };
}

function clockBarHTML(s) {
  const v = T.v, c = v.meta.clock;
  if (!c || c.deadline == null || v.over || T.rev) return '';
  const key = c.deadline + ':' + s + ':' + v.ver;
  if (!T.clockCache || T.clockCache.key !== key) {
    const total = Math.max(1, c.deadline - c.turnStart), left = Math.max(0, c.deadline - clock.now());
    T.clockCache = { key, html: `<div class="clock ${s === T.me ? 'me' : 'op'}" aria-hidden="true"><i style="--from:${Math.min(1, left / total).toFixed(4)};animation-duration:${left}ms"></i></div>` };
  }
  return T.clockCache.html;
}

const PL = { fold: 'FOLD', check: 'CHECK', call: 'CALL', bet: 'BET', raise: 'RAISE', allin: 'ALL-IN' };
function seatHTML(s, M, isMe) {
  const t = T, v = t.v, S = M.seats[s], rv = t.rev;
  const acting = !rv && !v.over && v.toAct === s;
  const pl = acting ? null : plateOn(s);
  const cls = ['sp', isMe ? 'me-s' : 'opp-s', acting ? 'act' : '', S.folded ? 'fold' : '', S.out ? 'out' : '', S.win ? 'win' : ''].filter(Boolean).join(' ');
  const bb = v.bb || 1;
  // hole cards float above the plate (the plate alone fixes the seat position, so the seat never moves when cards come and go)
  let cards = '';
  if (S.cards === 'back') cards = cardHTML(null) + cardHTML(null);
  else if (Array.isArray(S.cards)) cards = S.cards.map(c => cardHTML(c, { dim: S.folded && isMe })).join('');
  // note row: result > last action > status
  let note = '';
  const lh = v.lastHand;
  if (rv && rv.stage >= 2 && S.win) note = `<span class="w up">+${fmt(Math.max(0, lh.net[s]))}</span>${lh.names[s] ? `<span class="hn">${esc(lh.names[s])}</span>` : ''}`;
  else if (rv && rv.stage >= 2 && lh.names[s] && !S.folded) note = `<span class="hn">${esc(lh.names[s])}</span>`;
  else if (S.out) note = S.place ? ordinal(S.place).toUpperCase() : 'OUT';
  else if (pl && !rv) note = `<span class="pl k-${pl.k}">${PL[pl.k]}</span>`;
  else if (S.folded) note = 'FOLD';
  else if (S.allIn) note = '<span class="ai">ALL-IN</span>';
  else if (S.away) note = 'AWAY';
  else if (acting && isBot(s)) note = '<span class="dots" style="margin:0"><i></i><i></i><i></i></span>';
  const name = isMe ? 'YOU' : esc(v.names[s]);
  const dbtn = v.button === s && !S.out ? '<b class="dbtn" title="Dealer">D</b>' : '';
  const clk = acting && !isBot(s) ? clockBarHTML(s) : '';
  const bet = !isMe && S.bet > 0 ? `<div class="bchip"><i></i><b>${fmt(S.bet)}</b></div>` : '';
  return `<div class="hole">${cards}</div><div class="${cls}"><div class="sp-hd"><i class="gem"></i><span class="nm">${name}</span></div>
    <div class="stk"><b data-stk="${s}">${fmt(S.stack)}</b><small>${Math.round(S.stack / bb)} BB</small></div><div class="note">${note}</div>${clk}</div>${dbtn}${bet}`;
}

/* ---------- animations after a render ---------- */
function afterRender(M) {
  const t = T, v = t.v, sh = t.sh, me = t.me;
  if (REDUCE) { sh.init = true; sh.handNo = v.handNo; sh.board = M.board.length; sh.up = M.seats.map(S => S.up); sh.bet = M.seats.map(S => S.bet); return }
  const flip = (el, delay) => el && el.animate([{ transform: 'perspective(600px) rotateY(90deg)' }, { transform: 'none' }], { duration: 420, delay, easing: EASE, fill: 'backwards' });
  // community cards
  const cards = [...document.querySelectorAll('#boardC .card')];
  if (sh.init && M.board.length > sh.board && sh.board >= 0) cards.slice(sh.board).forEach((c, i) => flip(c, i * 110));
  else if (sh.init && M.board.length > sh.board) cards.forEach((c, i) => flip(c, i * 110));
  sh.board = M.board.length;
  // opponents' cards turned face up at showdown
  M.seats.forEach(S => { if (S.s !== me && S.up && !sh.up[S.s]) document.querySelectorAll(`[data-stk="${S.s}"]`).forEach(el => { const hc = el.closest('.seat').querySelectorAll('.hole .card'); hc.forEach((c, i) => flip(c, 250 + i * 130)) }) });
  sh.up = M.seats.map(S => S.up);
  // new hand: deal
  if (!t.rev && sh.handNo !== v.handNo) {
    document.querySelectorAll('.hole .card').forEach((c, i) => c.animate([{ transform: 'translateY(-22px) rotate(-5deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, delay: i * 70, easing: EASE, fill: 'backwards' }));
    sh.handNo = v.handNo;
  }
  // bets placed
  M.seats.forEach(S => {
    if (!(sh.init && S.bet > sh.bet[S.s])) return;
    const el = S.s === me ? $('#betM .bchip') : document.querySelector(`[data-stk="${S.s}"]`)?.closest('.seat').querySelector('.bchip');
    if (el) el.animate([{ transform: 'translateY(-8px) scale(.9)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: EASE });
  });
  sh.bet = M.seats.map(S => S.bet);
  sh.init = true;
}

/* ---------- clock texts (every 400 ms) ---------- */
function tickClock() {
  const t = T; if (!t || !t.v) return;
  const nx = $('#nxv'); if (nx) { const x = nextLevelText(); if (nx.textContent !== x.t) nx.textContent = x.t; $('#nx').classList.toggle('soon', x.soon) }
  const secs = $('#secs'), c = t.v.meta.clock;
  if (secs && c && c.deadline != null) {
    const l = Math.max(0, c.deadline - clock.now()), s = String(Math.ceil(l / 1000));
    if (secs.textContent !== s) secs.textContent = s; secs.classList.toggle('low', +s <= 5);
  }
  const lk = t.lockUntil - Date.now(), d = $('#dock');
  if (d.classList.contains('lock') && lk <= 0) { d.classList.remove('lock') }
}

/* ===================== dock ===================== */
const autoPreKey = () => T.v.handNo + ':' + T.v.street;
function autoPre() {
  const t = T, v = t.v; if (!v || t.rev || v.over || v.toAct !== t.me || !t.pre) return;
  if (t.pre !== autoPreKey()) { t.pre = null; return }
  t.pre = null;
  const l = legalActions(v);
  setTimeout(() => { if (T === t && t.v.ver === v.ver) submit({ type: l.canCheck ? 'check' : 'fold' }) }, 250);
}
function renderDock(M) {
  const t = T, v = t.v, me = t.me, dock = $('#dock'), el = $('#dockMain'), rv = t.rev;
  const S = M.seats[me];
  const mine = !rv && !v.over && v.toAct === me;
  const l = mine ? legalActions(v) : null;
  let html = '', idle = false;
  if (rv) {
    idle = true;
    const lh = rv.lh, ws = [...rv.winners];
    if (rv.stage < 2) html = `<span class="dk-title">${rv.showdown ? 'SHOWDOWN' : '…'}</span><span class="dots"><i></i><i></i><i></i></span>`;
    else {
      const w = ws.length === 1 ? ws[0] : null;
      const who = w === null ? 'SPLIT POT' : w === me ? 'YOU WIN' : esc(v.names[w]) + ' WINS';
      const amt = w === null ? '' : `+${fmt(Math.max(0, lh.net[w]))}`;
      html = `<span class="dk-title ${w === me ? 'y' : w === null ? '' : 'c'}">${who}</span><span class="dk-stats"><b>${amt}</b>${w !== null && lh.names[w] ? esc(lh.names[w]) : ''}</span>`;
    }
  } else if (v.over) {
    idle = true;
    html = `<span class="eyebrow">GAME OVER</span><span class="dk-title ${placeOf(v, me) === 1 ? 'y' : ''}">${placeOf(v, me) ? ordinal(placeOf(v, me)) : ''}</span><button class="btn primary" data-act="result" type="button" style="flex:0 0 40%">Result</button>`;
  } else if (l) {
    const stackMe = v.seats[me].stack, facing = l.canCall, pot = l.pot;
    const callAllin = facing && l.callAmount >= stackMe;
    const canRaise = l.minRaiseTo != null;
    const rLabel = v.currentBet === 0 ? 'Bet' : 'Raise', allinOnly = canRaise && l.minRaiseTo === l.maxRaiseTo;
    const rz = canRaise ? `<button class="btn accent" data-act="raise" type="button">${allinOnly ? 'All-in' : rLabel}<small>${allinOnly ? fmt(l.maxRaiseTo) : fmt(l.minRaiseTo) + '+'}</small></button>` : '';
    html = `<div class="dk-top"><span class="you-act">YOUR TURN</span><span class="dk-stats">POT<b>${fmt(pot)}</b>${facing ? `CALL<b>${fmt(l.callAmount)}</b>` : ''}</span><span class="secs" id="secs"></span></div>
      <div class="dk-row">${facing
        ? `<button class="btn ghost" data-act="fold" type="button">Fold</button><button class="btn primary" data-act="call" type="button">Call<small>${fmt(l.callAmount)}${callAllin ? ' · all-in' : ''}</small></button>${rz}`
        : `<button class="btn primary" data-act="check" type="button">Check</button>${rz}`}</div>`;
  } else {
    idle = true;
    const inHand = !S.folded && !S.out && !v.seats[me].out;
    const a = v.toAct, who = a != null ? esc(v.names[a]) : '';
    if (S.out) html = `<span class="dk-title">${S.place ? ordinal(S.place) : 'OUT'}</span><span class="dots"><i></i><i></i><i></i></span>`;
    else {
      const armed = t.pre === autoPreKey();
      html = `${S.folded ? '<span class="eyebrow">FOLDED</span>' : ''}<span class="dk-title">${who}</span><span class="dots" style="margin-left:0"><i></i><i></i><i></i></span>
        ${inHand && a != null && a !== me ? `<button class="pre" data-act="pre" type="button" aria-pressed="${armed}">Check/Fold</button>` : ''}`;
    }
  }
  dock.classList.toggle('idle', idle);
  const locked = mine && (Date.now() < t.lockUntil || t.busy);
  dock.classList.toggle('lock', locked);
  if (locked && Date.now() < t.lockUntil) { clearTimeout(t.lockT); t.lockT = setTimeout(() => { if (T === t) renderDock(model()) }, t.lockUntil - Date.now() + 20) }
  return setHTML(el, html);
}

$('#dock').addEventListener('click', e => {
  const t = T; if (!t || !t.v) return;
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, v = t.v;
  if (act === 'result') return showResult()
  if (act === 'pre') { t.pre = t.pre === autoPreKey() ? null : autoPreKey(); renderDock(model()); return }
  if (t.busy || t.rev || Date.now() < t.lockUntil || v.toAct !== t.me) return;
  if (act === 'fold' || act === 'check' || act === 'call') return submit({ type: act });
  if (act === 'raise') return openSheet();
  if (act === 'rs-close') return closeSheet();
  if (act === 'rs-ok') { const to = t.rs && t.rs.to; closeSheet(); return submit({ type: 'raise', to }) }
});
async function submit(move) {
  const t = T; if (!t || t.busy) return;
  t.busy = true; renderDock(model());
  try {
    const r = await net().game({ op: 'act', game: t.game, ver: t.ver, move });
    if (t !== T) return;
    t.busy = false; clock.offset = r.now - Date.now(); apply(r.view);
  } catch (e) {
    if (t !== T) return;
    t.busy = false;
    if (['stale', 'not_your_turn', 'game_over'].includes(e.code)) poll();
    else toast(e.code === 'illegal' ? 'その操作はできません' : '通信エラー。もう一度');
    renderDock(model());
  }
}

/* ---------- raise sheet ---------- */
const roundTo = (v, u) => Math.round(v / u) * u;
function quickValues(l, v) {
  const lo = l.minRaiseTo, hi = l.maxRaiseTo, base = v.currentBet, out = [];
  if (v.street === 'preflop') for (const k of [2, 2.5, 3]) out.push([k + 'x', Math.round(base * k)]);
  else for (const [f, label] of [[1 / 3, '1/3'], [1 / 2, '1/2'], [2 / 3, '2/3'], [1, 'Pot']]) out.push([label, base + Math.round(f * (l.pot + l.toCall))]);
  const list = out.filter(([, x]) => x > lo && x < hi);
  list.unshift(['Min', lo]);
  const uniq = []; for (const q of list) if (!uniq.some(u => u[1] === q[1])) uniq.push(q);
  if (hi > lo) uniq.push(['All-in', hi]);
  return uniq;
}
function openSheet() {
  const t = T, v = t.v, l = legalActions(v); if (!l || l.minRaiseTo == null) return;
  const lo = l.minRaiseTo, hi = l.maxRaiseTo, unit = Math.max(1, Math.round(v.bb / 2)), q = quickValues(l, v);
  const vals = [lo]; for (let x = (Math.floor(lo / unit) + 1) * unit; x < hi; x += unit) vals.push(x);
  for (const [, x] of q) if (!vals.includes(x)) vals.push(x);
  if (!vals.includes(hi)) vals.push(hi);
  vals.sort((a, b) => a - b);
  t.rs = { to: lo, vals, q, l };
  const host = document.createElement('div'); host.className = 'rsheet'; host.id = 'rsheet';
  const bet = v.currentBet === 0;
  const mine = (v.holes[t.me] || []).map(c => cardHTML(c)).join('');
  host.innerHTML = `<div class="rs-top"><div class="rs-cards">${mine}</div><div class="grow"><span class="eyebrow">${bet ? 'BET' : 'RAISE TO'}</span><span class="sub">POT ${fmt(l.pot)}</span></div><b id="rsv">${fmt(lo)}</b></div>
    <input type="range" id="rsr" min="0" max="${vals.length - 1}" step="1" value="0" ${vals.length < 2 ? 'disabled' : ''} aria-label="${bet ? 'Bet' : 'Raise'} amount">
    <div class="quick">${q.map(([k, x]) => `<button type="button" data-q="${x}" aria-pressed="false">${k}<b>${fmt(x)}</b></button>`).join('')}</div>
    <div class="rs-btns"><button class="btn ghost" data-act="rs-close" type="button">Back</button><button class="btn accent" data-act="rs-ok" type="button">${bet ? 'Bet' : 'Raise'}<small id="rsv2">${fmt(lo)}</small></button></div>`;
  $('#dock').appendChild(host);
  const r = $('#rsr');
  const sync = () => { $('#rsv').textContent = fmt(t.rs.to); $('#rsv2').textContent = fmt(t.rs.to); r.value = t.rs.vals.indexOf(t.rs.to); r.style.setProperty('--fill', (t.rs.vals.length > 1 ? r.value / (t.rs.vals.length - 1) * 100 : 100) + '%'); host.querySelectorAll('[data-q]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.q === t.rs.to))) };
  r.oninput = () => { t.rs.to = t.rs.vals[+r.value]; sync() };
  host.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { t.rs.to = +b.dataset.q; sync() });
  sync();
}
function closeSheet() { if (T) T.rs = null; const h = $('#rsheet'); if (h) h.remove() }

/* ===================== layout: the largest card size at which everything fits ===================== */
const rectOf = e => { if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 0 ? { l: r.left, r: r.right, t: r.top, b: r.bottom } : null };
const hit = (a, b, m = 3) => a.l < b.r + m && b.l < a.r + m && a.t < b.b + m && b.t < a.b + m;
// everything must fit without overflow, and the table's parts (each seat's hole cards and plate, the pot and board, the hero's bet) must stay inside the table and not overlap
function fits() {
  const st = $('#stage'), tb = $('#table');
  // (no stage scrollWidth check: flipping cards are transformed and would widen it for a moment)
  if (st.scrollHeight > st.clientHeight + 1 || $('#tInfo').scrollWidth > $('#tInfo').clientWidth + 1) return false;
  const T0 = tb.getBoundingClientRect();
  const seat = id => [...$(id).children].filter(e => !e.classList.contains('bchip') && !e.classList.contains('dbtn')).map(rectOf).filter(Boolean);
  const G = [seat('#seatL'), seat('#seatR'), seat('#seatM'), [rectOf($('#pot')), rectOf($('#boardC'))].filter(Boolean), [rectOf($('#betM .bchip'))].filter(Boolean)];
  const all = G.flat();
  for (const g of all) if (g.l < T0.left - 1 || g.r > T0.right + 1 || g.t < T0.top - 1 || g.b > T0.bottom + 1) return false;
  const B = G[3].length ? { l: Math.min(...G[3].map(r => r.l)), r: Math.max(...G[3].map(r => r.r)) } : null;
  if (B && B.r - B.l > (T0.right - T0.left) * .8) return false;
  for (let i = 0; i < G.length; i++) for (let j = i + 1; j < G.length; j++) for (const a of G[i]) for (const b of G[j]) if (hit(a, b)) return false;
  return true;
}
function largest(lo, hi, set) {
  set(lo); if (!fits()) return lo;
  set(hi); if (fits()) return hi;
  while (hi - lo > .5) { const m = (lo + hi) / 2; set(m); if (fits()) lo = m; else hi = m }
  return Math.floor(lo * 2) / 2;
}
let fitKey = '';
export function fitTable(force) {
  const b = document.body; if (b.dataset.screen !== 'game' || !T || !T.v) return;
  const app_ = $('.app'), st = $('#stage'), vw = app_.clientWidth, vh = app_.clientHeight, key = vw + 'x' + vh;
  if (!force && key === fitKey) return; fitKey = key;
  b.classList.add('measuring');
  b.classList.toggle('land', vw > vh * 1.25 && vh < 600);
  const c = largest(16, b.classList.contains('land') ? 52 : 84, x => st.style.setProperty('--cw', x + 'px'));
  st.style.setProperty('--cw', c + 'px');
  b.classList.remove('measuring');
}
let fitT = 0;
export const refit = () => { clearTimeout(fitT); fitT = setTimeout(() => fitTable(true), 30) };
addEventListener('resize', refit);
addEventListener('orientationchange', refit);
if (window.ResizeObserver) new ResizeObserver(refit).observe(document.querySelector('.app'));
if (window.visualViewport) visualViewport.addEventListener('resize', refit);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);

// development only: poke the running table from the console (npm run dev)
if (import.meta.env.DEV) window.__table = { get T() { return T }, showResult, render };
