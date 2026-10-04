// Multiplier reveal (about 6 s, tap to skip). The strip is drawn from the real odds of the stake, so no near-miss padding:
// what scrolls past is as likely as it really is. Higher multiplier = bigger reveal.
import { MULTIPLIERS, STAKES } from '../spin.js';
import { $, REDUCE, EASE, fmt, STAKE_LABEL } from './util.js';

const tier = m => m >= 1000 ? 4 : m >= 100 ? 3 : m >= 10 ? 2 : m >= 4 ? 1 : 0;
const CELL = 96, N = 44, TARGET = 36, SPIN_MS = 4200, HOLD_MS = 1500;

function pickWeighted(rows) {
  let r = Math.random() * rows.reduce((s, x) => s + x[1], 0);
  for (const [m, n] of rows) { if ((r -= n) < 0) return m }
  return rows[rows.length - 1][0];
}

function confetti(root, count, tc) {
  if (REDUCE) return;
  const colors = [tc, '#FE7A47', '#336B87', '#7DB4CF', '#ffffff'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i'); p.className = 'confetti';
    p.style.background = colors[i % colors.length];
    const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * Math.min(window.innerWidth, 600) * .6, s = 5 + Math.random() * 7;
    p.style.width = p.style.height = s + 'px';
    root.appendChild(p);
    p.animate([
      { transform: 'translate(-50%,-50%) rotate(0) scale(.4)', opacity: 1 },
      { transform: `translate(${Math.cos(a) * d - 4}px,${Math.sin(a) * d * .7 - 40}px) rotate(${Math.random() * 540}deg) scale(1)`, opacity: 1, offset: .6 },
      { transform: `translate(${Math.cos(a) * d * 1.15}px,${Math.sin(a) * d * .7 + 90}px) rotate(${Math.random() * 720}deg) scale(.8)`, opacity: 0 }],
      { duration: 1100 + Math.random() * 700, easing: 'cubic-bezier(.2,.7,.3,1)', delay: Math.random() * 120, fill: 'forwards' }).onfinish = () => p.remove();
  }
}

/** info: { stake, multiplier|null, prize }. Resolves when it is over (or skipped). */
export function playWheel(info) {
  return new Promise(resolve => {
    const el = $('#wheel'), free = info.multiplier == null, m = info.multiplier, t = free ? 0 : tier(m);
    const rows = free ? [] : MULTIPLIERS[info.stake] || [];
    const cells = Array.from({ length: N }, (_, i) => i === TARGET || !rows.length ? m : pickWeighted(rows));
    el.className = 'wheel t' + t;
    el.style.setProperty('--tc', t >= 3 ? '#FE7A47' : t === 2 ? '#FE7A47' : t === 1 ? '#7DB4CF' : 'var(--ink)');
    const buy = (STAKES[info.stake] || {}).buyIn;
    el.innerHTML = `<div class="w-top"><div class="eyebrow">${STAKE_LABEL[info.stake] || ''}${buy ? ' · ' + fmt(buy) : ''}</div></div>
      ${free ? '' : `<div class="w-reel" aria-hidden="true"><div class="w-strip">${cells.map(c => `<div class="w-cell t${tier(c)}"><span><small>×</small>${fmt(c)}</span></div>`).join('')}</div><i class="w-mark"></i></div>`}
      <div class="w-res" role="status"><div class="w-mult" id="wMult">${free ? '<span class="w-free">FREEROLL</span>' : `<small>×</small>${fmt(m)}`}</div>
      <div class="w-prize" id="wPrize"><span id="wPv">0</span><small>CHIPS</small></div></div>
      <div class="w-hint eyebrow">SKIP</div>`;
    el.hidden = false;
    const strip = el.querySelector('.w-strip'), mult = $('#wMult'), prize = $('#wPrize'), pv = $('#wPv');
    let phase = 'spin', done = false, spin = null, holdTimer = 0, raf = 0;

    const finish = () => {
      if (done) return; done = true; cancelAnimationFrame(raf); clearTimeout(holdTimer);
      document.removeEventListener('keydown', onKey);
      const out = () => { el.hidden = true; el.innerHTML = ''; el.className = 'wheel'; resolve() };
      if (REDUCE) return out();
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out' }).onfinish = out;
      setTimeout(out, 300);
    };
    const reveal = () => {
      if (phase !== 'spin') return; phase = 'rev';
      if (spin) { spin.cancel(); spin = null }
      if (strip) { const w = el.querySelector('.w-reel').clientWidth; strip.style.transform = `translateX(${w / 2 - (TARGET + .5) * CELL}px)` }
      el.classList.add('rev');
      mult.style.opacity = 1; prize.style.opacity = 1;
      const to = info.prize || 0;
      if (REDUCE) { pv.textContent = fmt(to); holdTimer = setTimeout(finish, 2200); return }
      mult.animate([{ transform: `scale(${t >= 3 ? .4 : .6})`, opacity: 0 }, { transform: `scale(${1 + t * .04})`, opacity: 1, offset: .6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 520, easing: EASE, fill: 'backwards' });
      if (t >= 4) el.animate([{ transform: 'translate(0,0)' }, { transform: 'translate(-6px,3px)' }, { transform: 'translate(5px,-3px)' }, { transform: 'translate(-3px,2px)' }, { transform: 'none' }], { duration: 420, easing: 'ease-out' });
      if (t >= 2) confetti(el.querySelector('.w-res'), [0, 0, 18, 46, 90][t], getComputedStyle(el).getPropertyValue('--tc').trim() || '#FE7A47');
      const t0 = performance.now(), D = 900 + t * 120;
      const step = now => { const k = Math.max(0, Math.min(1, (now - t0) / D)); pv.textContent = fmt(to * (1 - Math.pow(1 - k, 3))); if (k < 1) raf = requestAnimationFrame(step); else pv.textContent = fmt(to) };
      raf = requestAnimationFrame(step);
      holdTimer = setTimeout(finish, free ? 2200 : HOLD_MS + t * 300);
    };
    const skip = () => { if (phase === 'spin') reveal(); else finish() };
    const onKey = e => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); skip() } };
    el.onclick = skip; document.addEventListener('keydown', onKey);

    if (free || REDUCE) { holdTimer = setTimeout(reveal, free ? 700 : 0); return }
    const w = el.querySelector('.w-reel').clientWidth, end = w / 2 - (TARGET + .5) * CELL;
    spin = strip.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${end}px)` }], { duration: SPIN_MS, easing: 'cubic-bezier(.12,.62,.08,1)', fill: 'forwards' });
    spin.onfinish = () => { holdTimer = setTimeout(reveal, 250) };
  });
}
