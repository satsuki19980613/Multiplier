// Multiplier — entry point: boot, screen switching, account. Screens live in src/ui/*.
import './ui/viewport.js';
import * as realNet from './net.js';
import { app, $, toast, closeAllDlg, localSet, REDUCE } from './ui/util.js';
import { renderMenu, setPane, startQueue, cancelQueue, inQueue } from './ui/menu.js';
import * as table from './ui/table.js';
import { playWheel } from './ui/wheel.js';
import { openRules } from './ui/rules.js';

app.net = realNet; // replaced by src/fakeNet.js on http://localhost:<port>/?fake (development only)

/* ---------- screens ---------- */
function showScreen(n) {
  document.body.dataset.screen = n;
  if (n !== 'game') document.body.classList.remove('land');
}
function toMenu() {
  table.leave(); closeAllDlg();
  showScreen('menu'); setPane('main');
  if (app.user) refreshMe();
}
let entering = false;
async function enterGame(id, opts = {}) {
  if (entering) return;
  entering = true;
  try {
    closeAllDlg();
    if (opts.wheel) {
      try {
        const v = await table.peek(id);
        if (v && v.meta) await playWheel({ stake: v.meta.stake, multiplier: v.meta.multiplier, prize: v.meta.prize });
      } catch (e) { /* the wheel is only a show: go to the table anyway */ }
    }
    table.enter(id);
  } finally { entering = false }
}
function playAgain(stake) {
  table.leave(); closeAllDlg(); showScreen('menu'); startQueue(stake);
}

/* ---------- account ---------- */
async function refreshMe() {
  try { app.prof = await app.net.rpc('me') }
  catch (e) { if (e.code === 'not_authenticated') { app.user = null; app.prof = null } }
  // still seated at a running table (e.g. after a reload): there is no way back to the menu except Retire or finishing, so go straight to the table
  if (app.prof && app.prof.game && !table.active() && !inQueue() && !entering) { enterGame(app.prof.game, { wheel: false }); return app.prof }
  renderMenu();
  return app.prof;
}
async function logout() {
  try { await app.net.signOut() } catch (e) { /* ignore */ }
  app.user = null; app.prof = null; renderMenu();
}
Object.assign(app.nav, { toMenu, enterGame, playAgain, refreshMe, logout });

/* ---------- header / dialogs ---------- */
$('#rulesBtn').addEventListener('click', openRules);
$('#retireBtn').addEventListener('click', table.askRetire);
$('#themeToggle').addEventListener('click', () => {
  const r = document.documentElement, cur = r.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'), next = cur === 'dark' ? 'light' : 'dark';
  r.dataset.theme = next; localSet('mp-theme', next);
  const t = $('#themeToggle'); if (t.animate && !REDUCE) t.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(180deg)' }], { duration: 500, easing: 'cubic-bezier(.2,.8,.2,1)' });
});
document.addEventListener('click', e => { const cl = e.target.closest('[data-close]'); if (cl) cl.closest('dialog').close() });
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d && d.id !== 'overDlg') d.close() }));

/* ---------- boot ---------- */
async function boot() {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('fake')) { app.net = await import('./fakeNet.js') }
  app.booting = app.net.online;   // until the session check below has answered: the loader, not the sign-in screen
  showScreen('menu'); renderMenu();
  if (!app.net.online) return;
  realNet.onSessionLost(() => { cancelQueue(); table.leave(); app.user = null; app.prof = null; showScreen('menu'); renderMenu(); toast('ログインし直してください') });
  const u = new URL(location.href);
  try { app.user = await app.net.currentUser() } catch (e) { app.user = null }
  app.booting = false;
  if (!app.user) return renderMenu();
  await refreshMe();   // (goes straight to the table when the player is still seated at one)
}
boot();
// installable as an app (home screen). The worker caches nothing (public/sw.js)
if ('serviceWorker' in navigator && !import.meta.env.DEV) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
