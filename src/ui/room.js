// Private table lobby: room code, invite URL (/?room=123456), members. Polls room_wait every ROOM_POLL_MS (a member who stops
// polling is away, then gone); the table starts when three are here, or when the host starts it with two.
import { STAKES } from '../spin.js';
import { ROOM_POLL_MS } from '../../server/game/rooms.js';
import { $, app, esc, fmt, head, openDlg, toast, clock, sessGet, sessSet, STAKE_LABEL } from './util.js';
import { paint, setPane } from './menu.js';

const LOBBY_KEY = 'mp-lobby';   // the room being waited in, to come back after a reload (sessionStorage)
let R = null;                   // { id, v, timer, ui, busy }

export const active = () => !!R;
export const savedLobby = () => sessGet(LOBBY_KEY);
// openExternalBrowser=1: LINE opens the link in the phone's browser instead of its in-app one, so on Android an installed app
// (its scope is the whole site) can take the link
export const inviteUrl = code => `${location.origin}/?room=${code}&openExternalBrowser=1`;
const spaced = code => String(code).replace(/(\d{3})(\d{3})/, '$1 $2');

/** wait in a room. first = the reply of room_create / room_join ({ room, now }) when there is one */
export function enter(id, first) {
  stop();
  R = { id, v: null, timer: 0, ui: 0, busy: false };
  sessSet(LOBBY_KEY, id);
  setPane('room');
  if (first && apply(R, first)) return;
  poll();
  R.ui = setInterval(() => { if (R && R.v) render($('#menuIn')) }, 1000);
}
export function stop() { if (!R) return; clearTimeout(R.timer); clearInterval(R.ui); R = null }
function quit(msg) { stop(); sessSet(LOBBY_KEY, null); if (msg) toast(msg); app.nav.toMenu() }

// a reply of the server; true when the lobby is over (the table started or the room closed)
function apply(r0, x) {
  if (x.now) clock.offset = x.now - Date.now();
  const v = x.room; if (!v) return false;
  r0.v = v;
  if (v.game) { stop(); sessSet(LOBBY_KEY, null); app.nav.enterGame(v.game, { wheel: true }); return true }
  if (v.status !== 'waiting') { quit('部屋は閉じられました'); return true }
  render($('#menuIn'));
  return false;
}

async function poll() {
  const r0 = R; if (!r0) return;
  clearTimeout(r0.timer);
  try {
    const x = await app.net.game({ op: 'room_wait', room: r0.id });
    if (R !== r0 || apply(r0, x)) return;
  } catch (e) {
    if (R !== r0) return;
    if (['not_found', 'room_closed'].includes(e.code)) return quit('部屋から外れました');
  }
  r0.timer = setTimeout(poll, ROOM_POLL_MS);
}
// phones suspend the page while the invite is shared in another app: poll at once when it comes back
document.addEventListener('visibilitychange', () => { if (!document.hidden && R) poll() });

export function render(el) {
  if (!R || !R.v) return paint(el, '<div class="qbox"><span class="dots" style="margin:14px 0"><i></i><i></i><i></i></span></div>');
  const v = R.v, n = v.members.length, url = inviteUrl(v.code);
  const left = Math.max(0, Math.ceil((v.expiresAt - clock.now()) / 1000));
  const slots = Array.from({ length: v.seats }, (_, i) => {
    const m = v.members[i];
    if (!m) return '<li><span class="sl-n">' + (i + 1) + '</span><span class="sl-name">…</span></li>';
    return `<li class="on${m.away ? ' away' : ''}"><span class="sl-n">${i + 1}</span><span class="sl-name">${m.me ? '<span class="me">YOU</span> ' : ''}${esc(m.name)}</span>${m.host ? '<span class="sl-tag">HOST</span>' : ''}</li>`;
  }).join('');
  const canStart = v.isHost && n >= 2 && n < v.seats && !v.members.some(m => m.away);
  paint(el, `<div class="qbox room-box">
      <div class="q-stake">PRIVATE · ${STAKE_LABEL[v.stake]} · ${fmt(STAKES[v.stake].buyIn)}</div>
      <div class="code-big" aria-label="部屋番号 ${esc(v.code)}"><small>ROOM</small>${esc(spaced(v.code))}</div>
      <div class="invite"><span class="inv-url">${esc(url)}</span><button class="btn ghost" id="copyUrl" type="button">Copy</button><button class="btn primary" id="shareUrl" type="button">招待</button></div>
      <div class="q-n"><b>${n}</b> / ${v.seats}</div>
      <ol class="slots">${slots}</ol>
      <div class="q-exp" role="timer">${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</div>
      <div class="btns room-btns">
        <button class="btn ghost" id="roomLeave" type="button">${v.isHost ? '部屋を閉じる' : '退出する'}</button>
        ${v.isHost ? `<button class="btn primary" id="roomStart" type="button" ${canStart && !R.busy ? '' : 'disabled'}>Start</button>` : ''}
      </div>
    </div>`, bind);
}
function bind(el) {
  const v = R.v;
  el.querySelector('#copyUrl').onclick = () => copyText(inviteUrl(v.code));
  el.querySelector('#shareUrl').onclick = () => share(v.code);
  el.querySelector('#roomLeave').onclick = () => askLeave(v.isHost);
  const st = el.querySelector('#roomStart');
  if (st) st.onclick = startNow;
}

async function startNow() {
  const r0 = R; if (!r0 || r0.busy) return;
  r0.busy = true; render($('#menuIn'));
  try { const x = await app.net.game({ op: 'room_start', room: r0.id }); if (R === r0) { r0.busy = false; apply(r0, x) } }
  catch (e) {
    if (R !== r0) return;
    r0.busy = false; render($('#menuIn'));
    toast({ away: '全員がそろうまで待ってください', not_enough: 'もう1人必要です', room_closed: '部屋は閉じられました' }[e.code] || '開始できませんでした');
  }
}

function askLeave(isHost) {
  const r0 = R; if (!r0) return;
  $('#leaveBody').innerHTML = head('PRIVATE', isHost ? '部屋を閉じますか？' : '退出しますか？') +
    `<div class="btns"><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" id="leaveOk" type="button">${isHost ? '閉じる' : '退出'}</button></div>`;
  openDlg('#leaveDlg');
  $('#leaveOk').onclick = async () => {
    $('#leaveOk').disabled = true;
    try { await app.net.game({ op: 'room_leave', room: r0.id }) } catch (e) { /* a room that is gone is left anyway */ }
    $('#leaveDlg').close();
    if (R === r0) quit(null);
  };
}

async function share(code) {
  const url = inviteUrl(code), text = `Multiplier のプライベート卓に招待します（部屋番号 ${code}）`;
  if (navigator.share) { try { await navigator.share({ title: 'Multiplier', text, url }); return } catch (e) { if (e && e.name === 'AbortError') return } }
  copyText(url);
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('コピーしました') }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('コピーしました') } catch (e2) { toast('コピーできませんでした') }
    ta.remove();
  }
}

/* ---------- joining: the code typed in the menu, or an invite URL ---------- */
export async function openJoin(code) {
  const body = $('#joinBody'), title = head('PRIVATE', `ROOM ${esc(spaced(code))}`);
  body.innerHTML = title + '<div class="empty-note"><span class="dots" style="justify-content:center"><i></i><i></i><i></i></span></div>';
  openDlg('#joinDlg');
  let r;
  try { r = (await app.net.game({ op: 'room_peek', code })).room }
  catch (e) { body.innerHTML = title + '<p class="err">読み込めませんでした</p>'; return }
  if (r && r.member && r.status === 'waiting') { $('#joinDlg').close(); return enterById(code) }
  const chips = app.prof ? app.prof.chips : 0, buy = r ? STAKES[r.stake].buyIn : 0;
  const why = !r ? '部屋が見つかりません' : r.status === 'started' ? 'この部屋はもう始まっています' : r.status !== 'waiting' ? 'この部屋は閉じられています'
    : r.seated >= r.seats ? '満員です' : chips < buy ? `残高 ${fmt(buy)} 以上で参加できます` : '';
  body.innerHTML = title + (r ? `<dl class="spec"><dt>Host</dt><dd>${esc(r.host || '')}</dd><dt>Buy-in</dt><dd>${STAKE_LABEL[r.stake]} · ${fmt(buy)}</dd><dt>Players</dt><dd>${r.seated} / ${r.seats}</dd></dl>` : '') +
    (why ? `<p class="err">${why}</p>` : '') +
    `<div class="btns"><button class="btn ghost" data-close type="button">Cancel</button><button class="btn primary" id="joinGo" type="button" ${why ? 'disabled' : ''}>Join</button></div>`;
  const go = $('#joinGo');
  go.onclick = async () => {
    go.disabled = true;
    try { const x = await app.net.game({ op: 'room_join', code }); $('#joinDlg').close(); enter(x.room.id, x) }
    catch (e) { go.disabled = false; $('#joinDlg').close(); showRoomError(e) }
  };
}
// already a member of the room with this code (e.g. opened the invite again): join is idempotent and answers the room
async function enterById(code) {
  try { const x = await app.net.game({ op: 'room_join', code }); enter(x.room.id, x) } catch (e) { showRoomError(e) }
}

export function showRoomError(e) {
  const code = e && e.code;
  if (code === 'in_game') { app.nav.refreshMe(); return toast('進行中の卓があります') }
  toast({ room_full: '満員です', room_closed: 'この部屋には参加できません', not_found: '部屋が見つかりません', insufficient_chips: '残高が足りません',
    busy: '混み合っています。もう一度' }[code] || '通信エラー。もう一度');
}
