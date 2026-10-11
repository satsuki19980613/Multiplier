// Shared UI helpers and app state (no framework: plain DOM, Web Animations API)
import { STAKES } from '../spin.js';
export const $ = s => document.querySelector(s);
export const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const EASE = 'cubic-bezier(.2,.8,.2,1)';
export const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = n => Math.round(Number(n) || 0).toLocaleString('en-US');
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const setHTML = (el, h) => { if (el._h !== h) { el.innerHTML = h; el._h = h; return true } return false };
export const head = (eye, title, cls = '') => `<div class="eyebrow">${eye}</div><h2${cls ? ` class="${cls}"` : ''}>${title}</h2>`;
export const STAKE_LABEL = { low: 'LOW', mid: 'MID', high: 'HIGH', ultra: 'ULTRA', extreme: 'EXTREME', free: 'FREEROLL' };
/** the label of a stake (the "mode" of the stats and the player modal): 'LOW · 10', 'FREEROLL' */
export const modeLabel = m => (m === 'free' || !STAKES[m] ? STAKE_LABEL[m] || 'LOW' : `${STAKE_LABEL[m]} · ${fmt(STAKES[m].buyIn)}`);
export const MODES = [...Object.keys(STAKES), 'free'];

// shared app state. net is set at boot (net.js or ?fake); nav.* are set by main.js
export const app = {
  net: null, user: null, prof: null, booting: false,
  nav: { toMenu() {}, enterGame() {}, queue() {}, refreshMe: async () => null, logout() {} },
};

export function toast(t) {
  const el = $('#toast'); el.textContent = t; el.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 2000);
}
export function openDlg(id) { const d = $(id); if (!d.open) d.showModal() }
export function closeAllDlg() { document.querySelectorAll('dialog[open]').forEach(d => d.close()) }

// server clock (ms offset: server - local). Updated by every game_poll
export const clock = { offset: 0, now: () => Date.now() + clock.offset };

export function localGet(k) { try { return localStorage.getItem(k) } catch (e) { return null } }
export function localSet(k, v) { try { localStorage.setItem(k, v) } catch (e) { /* private mode */ } }
// this tab only (survives the Google sign-in round trip and reloads). v = null removes
export function sessGet(k) { try { return sessionStorage.getItem(k) } catch (e) { return null } }
export function sessSet(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v) } catch (e) { /* private mode */ } }

// cards: 0..51, rank = c>>2 (0='2'), suit = c&3 (0♠ 1♥ 2♦ 3♣)
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'], SUITS = ['♠', '♥', '♦', '♣'];
const SUIT_EN = ['spades', 'hearts', 'diamonds', 'clubs'];
export function cardHTML(c, opts = {}) {
  if (c === null || c === undefined || opts.back) return '<div class="card back" role="img" aria-label="Hidden card"></div>';
  const s = c & 3, r = c >> 2, red = s === 1 || s === 2;
  return `<div class="card${red ? ' red' : ''}${opts.dim ? ' dim' : ''}${opts.hit ? ' hit' : ''}" role="img" aria-label="${RANKS[r]} of ${SUIT_EN[s]}"><span class="rk">${RANKS[r]}</span><span class="st">${SUITS[s]}</span></div>`;
}
/** a small text card (hand history lists) */
export function cardText(c) {
  if (c == null) return '<span class="ct">?</span>';
  const s = c & 3, red = s === 1 || s === 2;
  return `<span class="ct${red ? ' red' : ''}">${RANKS[c >> 2]}${SUITS[s]}</span>`;
}
export const ordinal = n => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
/** a signed amount (+5 / −1 / ±0; one decimal at most). In Multiplier the stats' "pt" is the chips won or lost */
export function fmtPt(v) {
  if (v == null) return '–';
  if (v === 0) return '±0';
  const a = Math.abs(v), s = a >= 1000 ? fmt(a) : (Math.round(a * 10) / 10).toFixed(1).replace(/\.0$/, '');
  return `${v > 0 ? '+' : '−'}${s}`;
}
/** an amount in BB (one decimal at most) */
export const fmtBb = (chips, bb) => { const v = Math.round((chips / (bb || 1)) * 10) / 10; return (v % 1 === 0 ? String(v) : v.toFixed(1)); };

// one chip label flying between two elements
export function fly(fromEl, toEl, label, cls, delay = 0, done, D = 650) {
  if (REDUCE || !fromEl || !toEl || document.hidden) { done && done(); return }
  const ra = fromEl.getBoundingClientRect(), rb = toEl.getBoundingClientRect();
  const el = document.createElement('div'); el.className = 'fly ' + cls; el.textContent = label; document.body.appendChild(el);
  const w = el.offsetWidth, h = el.offsetHeight, x0 = ra.left + ra.width / 2 - w / 2, y0 = ra.top + ra.height / 2 - h / 2,
    x1 = rb.left + rb.width / 2 - w / 2, y1 = rb.top + rb.height / 2 - h / 2;
  const an = el.animate([
    { transform: `translate(${x0}px,${y0}px) scale(.8)`, opacity: 0 },
    { transform: `translate(${x0}px,${y0}px) scale(1)`, opacity: 1, offset: .15 },
    { transform: `translate(${x1}px,${y1}px) scale(1)`, opacity: 1, offset: .85 },
    { transform: `translate(${x1}px,${y1}px) scale(.7)`, opacity: 0 }], { duration: D, delay, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'both' });
  let ended = false;
  const end = () => { if (ended) return; ended = true; el.remove(); if (toEl.animate) toEl.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 280, easing: 'ease-out' }); done && done() };
  an.onfinish = end; setTimeout(end, D + delay + 150);
}
