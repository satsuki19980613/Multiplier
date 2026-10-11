// Menu screens: sign-in, main menu, stake select, waiting room, private tables (create / join; the lobby is room.js), profile, ranking
import { STAKES, FREEROLL, MULTIPLIERS } from '../spin.js';
import { $, app, esc, fmt, head, openDlg, toast, localGet, localSet, STAKE_LABEL } from './util.js';
import * as room from './room.js';
import * as stats from './stats.js';
import { getFx } from './gif.js';

const GSVG = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>';
const NOTICE = '本アプリは無料の娯楽ゲームです。チップは無償配布のみで、購入・換金・譲渡・景品交換はできません。実際のお金や賞品を賭けることはできません。18歳以上の方を対象としています。';
const QUEUE_MAX_S = 15, QUEUE_POLL_MS = 2000;
const AGE_KEY = 'mp-age18';

let pane = 'main';           // 'main' | 'stakes' | 'queue' | 'private' | 'room' | 'stats' | 'history'
let Q = null;                // { stake, t0, waiting, timer, gen }
const root = () => $('#menuIn');

export const inQueue = () => !!Q;
export function setPane(p) { pane = p; renderMenu() }

/* ---------- rendering ---------- */
export function renderMenu() {
  const el = root(); if (!el) return;
  if (!app.net.online) return paint(el, loginHTML(false));
  // while the session is still being checked at start-up, show the loader, not the sign-in screen (it would flash on every reopen)
  if (app.booting || (app.user && !app.prof)) return paint(el, loadingHTML);
  if (!app.user) return paint(el, loginHTML(true), bindLogin);
  if (pane === 'queue' && Q) return paint(el, queueHTML());
  if (pane === 'room' && room.active()) return room.render(el);
  if (pane === 'stakes') return paint(el, stakesHTML(), bindStakes);
  if (pane === 'private') return paint(el, privateHTML(), bindPrivate);
  if (pane === 'stats' || pane === 'history') return stats.render(el, pane);
  paint(el, mainHTML(), bindMain);
}
export function paint(el, html, bind) {
  if (el._h === html) return;
  el._h = html; el.innerHTML = html; if (bind) bind(el);
}
const wordmark = '<div class="wordmark">Multiplier</div>';
const loadingHTML = `${wordmark}<div class="acct"><span class="dots" style="margin:14px 0"><i></i><i></i><i></i></span></div>`;

function loginHTML(online) {
  const agreed = localGet(AGE_KEY) === '1';
  return `${wordmark}<p class="tagline">3人ポーカートーナメント</p>
    <div class="notice">${NOTICE}</div>
    ${agreed ? '' : `<label class="agree"><input type="checkbox" id="ageChk"><span>18歳以上であり、<a href="/terms.html" target="_blank" rel="noopener">利用規約</a>と<a href="/privacy.html" target="_blank" rel="noopener">プライバシーポリシー</a>に同意します。</span></label>`}
    <button class="gbtn" id="loginBtn" type="button" ${online && agreed ? '' : 'disabled'}>${GSVG}Google でログイン</button>`;
}
function bindLogin(el) {
  const chk = el.querySelector('#ageChk'), btn = el.querySelector('#loginBtn');
  if (chk) chk.onchange = () => { btn.disabled = !chk.checked };
  btn.onclick = async () => {
    if (chk && !chk.checked) return;
    localSet(AGE_KEY, '1');
    try { await app.net.signIn(location.origin + '/') } catch (e) { toast('ログインを開始できませんでした') }
  };
}

function seasonLeft() {
  const s = app.prof && app.prof.season; if (!s || !s.endsAt) return '';
  const d = Math.ceil((new Date(s.endsAt).getTime() - Date.now()) / 86400000);
  return d > 0 ? `${d} DAYS LEFT` : 'LAST DAY';
}
function freeState() {
  const f = (app.prof && app.prof.freeroll) || { used: 0, left: 0, eligible: false };
  const chips = app.prof ? app.prof.chips : 0;
  let why = '';
  if (chips >= FREEROLL.eligibleBelow) why = `残高が ${FREEROLL.eligibleBelow} 未満のときだけ`;
  else if (f.left <= 0) why = '今日の分は使い切りました';
  return { left: f.left, ok: !why && f.eligible !== false, why };
}
function mainHTML() {
  const p = app.prof, fr = freeState();
  return `${wordmark}
    <div class="acct"><button class="who-me" id="meBtn" type="button" aria-label="Profile"><i class="gem" style="width:9px;height:9px;transform:rotate(45deg);background:linear-gradient(135deg,#fff,var(--you) 65%)"></i><span class="nick">${esc(p.nickname)}</span><span class="bal"><small>CHIPS</small>${fmt(p.chips)}</span></button></div>
    <button class="mbtn" id="playBtn" type="button"><span>PLAY</span></button>
    <button class="mbtn" id="privBtn" type="button"><span>PRIVATE</span></button>
    <button class="mbtn" id="freeBtn" type="button" ${fr.ok ? '' : 'disabled'}><span>FREEROLL${fr.why ? `<small>${fr.why}</small>` : ''}</span><span class="rt">${fr.left}/${FREEROLL.perDay}</span></button>
    <button class="mbtn" id="rankBtn" type="button"><span>RANKING</span></button>
    <button class="mbtn" id="statsBtn" type="button"><span>STATS</span></button>
    <div class="season">${seasonLeft()}</div>`;
}
function bindMain(el) {
  el.querySelector('#meBtn').onclick = openProfile;
  el.querySelector('#playBtn').onclick = () => setPane('stakes');
  el.querySelector('#privBtn').onclick = () => setPane('private');
  el.querySelector('#freeBtn').onclick = () => startQueue('free');
  el.querySelector('#rankBtn').onclick = openRanking;
  el.querySelector('#statsBtn').onclick = () => setPane('stats');
}

function stakeRows() {
  const chips = app.prof.chips;
  return Object.entries(STAKES).map(([k, s]) => {
    const maxM = MULTIPLIERS[k][0][0];
    const why = chips < s.buyIn ? `残高 ${fmt(s.buyIn)} 以上で参加` : '';
    return `<button class="mbtn stk-row${s.buyIn >= 1000 ? ' hi' : ''}" data-k="${k}" type="button" ${why ? 'disabled' : ''}>
      <span class="nm3"><b>${STAKE_LABEL[k]}</b></span>
      <span style="text-align:right"><span class="buy">${fmt(s.buyIn)}</span><small>${why || `最大 ${fmt(s.buyIn * maxM)}`}</small></span></button>`;
  }).join('');
}
function stakesHTML() {
  return `<button class="back" id="backBtn" type="button">← BACK</button>${stakeRows()}`;
}
function bindStakes(el) {
  el.querySelector('#backBtn').onclick = () => setPane('main');
  el.querySelectorAll('.stk-row').forEach(b => b.onclick = () => startQueue(b.dataset.k));
}

/* ---------- private tables: make a room (pick the buy-in) or join one by its code ---------- */
function privateHTML() {
  return `<button class="back" id="backBtn" type="button">← BACK</button>
    <div class="pv-h eyebrow">CREATE</div>${stakeRows()}
    <div class="pv-h eyebrow">JOIN</div>
    <div class="pv-join"><input class="tin code-in" id="codeIn" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="000000" aria-label="部屋番号"><button class="btn primary" id="codeGo" type="button" disabled>Join</button></div>`;
}
function bindPrivate(el) {
  el.querySelector('#backBtn').onclick = () => setPane('main');
  el.querySelectorAll('.stk-row').forEach(b => b.onclick = async () => {
    if (b.disabled) return;
    el.querySelectorAll('.stk-row').forEach(x => x.disabled = true);
    try { const x = await app.net.game({ op: 'room_create', stake: b.dataset.k, fx: getFx() }); room.enter(x.room.id, x) }
    catch (e) { el._h = null; renderMenu(); room.showRoomError(e) }
  });
  const inp = el.querySelector('#codeIn'), go = el.querySelector('#codeGo');
  inp.oninput = () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 6); go.disabled = inp.value.length !== 6 };
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (!go.disabled) go.click() } };
  go.onclick = () => room.openJoin(inp.value);
}

/* ---------- waiting room ---------- */
function queueHTML() {
  const w = Math.max(1, Math.min(3, Q.waiting || 1)), left = Math.max(0, QUEUE_MAX_S - Math.floor((Date.now() - Q.t0) / 1000));
  const off = 289 * (1 - left / QUEUE_MAX_S);
  const buy = Q.stake === 'free' ? 'FREEROLL' : `${STAKE_LABEL[Q.stake]} · ${fmt(STAKES[Q.stake].buyIn)}`;
  return `<div class="qbox"><div class="q-stake">${buy}</div>
    <div class="q-slots" aria-label="${w} / 3">${[0, 1, 2].map(i => `<i class="${i < w ? 'on' : ''}">${i < w ? (i === 0 ? 'YOU' : '●') : ''}</i>`).join('')}</div>
    <div class="q-n"><b>${w}</b> / 3</div>
    <div class="q-count" role="timer" aria-label="${left}s"><svg viewBox="0 0 100 100"><circle class="bgc" cx="50" cy="50" r="46"/><circle class="fg" cx="50" cy="50" r="46" style="stroke-dashoffset:${off.toFixed(1)}"/></svg><b>${left}</b></div>
    <button class="btn ghost" id="qCancel" type="button" style="min-height:44px;min-width:140px;flex:none">Cancel</button></div>`;
}
export async function startQueue(stake) {
  if (Q) return;
  const gen = Math.random();
  Q = { stake, t0: Date.now(), waiting: 1, timer: 0, gen };
  pane = 'queue'; renderMenu(); bindQueue();
  const tick = async () => {
    if (!Q || Q.gen !== gen) return;
    try {
      const r = await app.net.game({ op: 'queue', stake });
      if (!Q || Q.gen !== gen) return;
      if (r && r.game) { stopQueueLocal(); return app.nav.enterGame(r.game, { wheel: true, stake }) }
      if (r && r.waiting) Q.waiting = r.waiting[stake] || Q.waiting;
      Q.since = r && r.since;
    } catch (e) {
      if (!Q || Q.gen !== gen) return;
      if (e.code !== 'network') { stopQueueLocal(); setPane(app.prof ? 'stakes' : 'main'); toast(stake === 'free' ? 'フリーロールは今は参加できません' : 'この卓には参加できません'); app.nav.refreshMe(); return }
    }
    repaintQueue();
    Q.timer = setTimeout(tick, QUEUE_POLL_MS);
  };
  Q.ui = setInterval(repaintQueue, 1000);
  tick();
}
function repaintQueue() { if (Q && pane === 'queue') { const el = root(); const h = queueHTML(); if (el._h !== h) { el._h = h; el.innerHTML = h; bindQueue() } } }
function bindQueue() { const b = $('#qCancel'); if (b) b.onclick = cancelQueue }
function stopQueueLocal() { if (!Q) return; clearTimeout(Q.timer); clearInterval(Q.ui); Q = null }
export function cancelQueue() {
  if (!Q) return; stopQueueLocal();
  app.net.game({ op: 'leave' }).catch(() => {});
  setPane('main');
}

/* ---------- profile ---------- */
export function openProfile() {
  const p = app.prof; if (!p) return;
  $('#profBody').innerHTML = head('PROFILE', 'Nickname') +
    `<input class="tin" id="nickIn" maxlength="16" value="${esc(p.nickname)}" autocomplete="off" spellcheck="false" aria-label="Nickname">
    <div class="err" id="nickErr" role="alert" hidden></div>
    <div class="stats"><span>CHIPS<b>${fmt(p.chips)}</b></span></div>
    <div class="btns"><button class="btn ghost" id="logoutBtn" type="button">ログアウト</button><button class="btn primary" id="nickSave" type="button">保存</button></div>`;
  openDlg('#profDlg');
  $('#nickSave').onclick = saveNick;
  $('#logoutBtn').onclick = async () => { $('#profDlg').close(); cancelQueue(); await app.nav.logout() };
  $('#nickIn').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); saveNick() } };
}
async function saveNick() {
  const v = $('#nickIn').value.trim(), err = $('#nickErr');
  if (v === app.prof.nickname) return $('#profDlg').close();
  try { await app.net.rpc('set_nickname', { p_name: v }); await app.nav.refreshMe(); $('#profDlg').close() }
  catch (e) { err.hidden = false; err.textContent = e.code === 'nickname_taken' ? 'その名前は使われています' : e.code === 'nickname_invalid' ? '1〜16文字で入力してください' : '保存できませんでした' }
}

/* ---------- ranking ---------- */
let rankTab = 'season';
export function openRanking() { rankTab = 'season'; paintRank(); openDlg('#rankDlg'); loadRank() }
const rankHead = () => head('RANKING', 'Ranking') + `<div class="seg" id="rankSeg"><button type="button" data-t="season" aria-pressed="${rankTab === 'season'}">Season</button><button type="button" data-t="hof" aria-pressed="${rankTab === 'hof'}">Hall of Fame</button></div>`;
function paintRank(body = '<div class="empty-note"><span class="dots" style="justify-content:center"><i></i><i></i><i></i></span></div>') {
  const el = $('#rankBody'); el.innerHTML = rankHead() + body;
  el.querySelector('#rankSeg').onclick = e => { const b = e.target.closest('button'); if (!b || b.dataset.t === rankTab) return; rankTab = b.dataset.t; paintRank(); loadRank() };
}
async function loadRank() {
  const tab = rankTab, row = x => `<li class="${x.me ? 'me' : ''}${x.rank === 1 ? ' top1' : ''}"><span class="rk">${x.rank}</span><span class="nm2">${esc(x.nickname)}</span><span class="rt">${fmt(x.chips)}</span></li>`;
  try {
    if (tab === 'season') {
      const r = await app.net.rpc('ranking'); if (rankTab !== tab) return;
      const days = r.season && r.season.endsAt ? Math.ceil((new Date(r.season.endsAt).getTime() - Date.now()) / 86400000) : null;
      paintRank((r.season ? `<div class="rk-sub">${esc(r.season.id || '')}${days != null ? ` · ${Math.max(0, days)} DAYS LEFT` : ''}</div>` : '') +
        (r.top.length ? `<ol class="rank">${r.top.map(row).join('')}</ol>` : '<div class="empty-note">まだ記録がありません</div>') +
        (r.me && !r.top.some(x => x.me) ? `<ol class="rank rank-me">${row({ ...r.me, me: true })}</ol>` : ''));
      const me = $('#rankBody .rank li.me'); if (me) me.scrollIntoView({ block: 'nearest' });
    } else {
      const r = await app.net.rpc('hall_of_fame'); if (rankTab !== tab) return;
      paintRank(r.length ? `<div class="hof">${r.map(s => `<h4>${esc(s.season)}</h4><ol class="rank">${s.top.map(row).join('')}</ol>`).join('')}</div>` : '<div class="empty-note">まだ記録がありません</div>');
    }
  } catch (e) { if (rankTab === tab) paintRank('<div class="empty-note">読み込めませんでした</div>') }
}
