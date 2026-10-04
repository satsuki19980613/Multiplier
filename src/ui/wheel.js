// Multiplier reveal on a round wheel in the app's own look (glass disc, hairlines, square pegs, the orange pointer). The segments
// alternate: every multiplier of the stake once (orange), x3 / x2 between them (so x10000 gets 14 segments, x1000 12, x100 10), all
// labels facing the same way, so the wheel is regular all round. It stops with the server's multiplier under the pointer (top).
// The segments are not the odds (those are in the rules). Only the *show* scales with the result, in five steps:
//   t0  x2 x3        crisp ~2.4 s: ratchet wheel, detent bounce, segment flash, small stinger
//   t1  x4 x5        ~4.1 s: slower "will it stop?" crawl, ring + glow, haptic
//   t2  x10 x25      ~5.3 s: dim + drone, long creep, flash + shake, sparks, prize rolls up with acceleration
//   t3  x100         ~7.6 s: build-up (rays, scanlines, heartbeat vignette, speeding drone), hard cut, stamp, burst, embers
//   t4  x1000+       ~7.9 s: t3 + a second burst with a colour shift (x10000: a third)
// Tap / Enter / Esc skips: the first tap jumps to the final state (multiplier + prize), the next one leaves. Reduced motion: no
// spin, shake, particles or rays, only a short fade.
import { MULTIPLIERS, STAKES } from '../spin.js';
import { $, REDUCE, fmt, STAKE_LABEL } from './util.js';
import * as snd from './sound.js';

const tier = m => m >= 1000 ? 4 : m >= 100 ? 3 : m >= 10 ? 2 : m >= 4 ? 1 : 0;
const CELL = 96;   // the motion profiles below are in "cells"; one cell = one segment of the wheel
const lerp = (a, b, k) => a + (b - a) * k, clamp01 = k => k < 0 ? 0 : k > 1 ? 1 : k;
const E = { in2: k => k * k, lin: k => k, out: p => k => 1 - Math.pow(1 - k, p) };
// reel motion per tier: segments of { ms, d: px (relative weights), e: easing }. Speeds join up (2d/ms for ease-in, p*d/ms for ease-out).
const PROFILE = [
  [{ ms: 1200, d: 2300, e: E.out(3) }],
  [{ ms: 2400, d: 3100, e: E.out(3.2) }],
  [{ ms: 350, d: 420, e: E.in2 }, { ms: 500, d: 1200, e: E.lin }, { ms: 2150, d: 1290, e: E.out(4) }],
  [{ ms: 700, d: 1120, e: E.in2 }, { ms: 1100, d: 3520, e: E.lin }, { ms: 2800, d: 1792, e: E.out(5) }],
  [{ ms: 700, d: 1120, e: E.in2 }, { ms: 1200, d: 3840, e: E.lin }, { ms: 2900, d: 1856, e: E.out(5) }],
];
const OVER = [14, 8, 0, 0, 0], SETTLE = [170, 210, 0, 0, 0];          // detent overshoot (px) and the time to settle back
const AFTER = [1000, 1700, 2100, 2900, 2960];                          // ms from the stop to the end of the reveal
const COUNT = [420, 750, 1000, 1700, 1900], BOOM = [0, 0, 0, 160, 160]; // prize roll-up; the hard-cut pause before the boom
const FREE_MS = { reveal: 600, count: 500, hold: 1500 };

/* ---------- the wheel (SVG, viewBox -200..200, pointer at the top = -90°; colours come from the theme via CSS classes) ---------- */
// rare multipliers (x4 and up) on the even segments, largest first clockwise; x3 / x2 alternate on the odd ones
function wheelSegments(stake) {
  const rare = (MULTIPLIERS[stake] || []).map(r => r[0]).filter(x => x >= 4);
  return rare.flatMap((m, i) => [m, i % 2 ? 2 : 3]);
}
const at = (r, a) => `${(r * Math.cos(a * Math.PI / 180)).toFixed(2)} ${(r * Math.sin(a * Math.PI / 180)).toFixed(2)}`;
const wedge = (a0, a1, r0, r1) => `M${at(r0, a0)}L${at(r1, a0)}A${r1} ${r1} 0 0 1 ${at(r1, a1)}L${at(r0, a1)}A${r0} ${r0} 0 0 0 ${at(r0, a0)}Z`;
const R = 172, RIM = 160, HUB = 54;
const ICON = `<g transform="rotate(45) scale(.5)"><rect x="-31.5" y="-31.5" width="27" height="27" class="wd-b"/><rect x="4.5" y="4.5" width="27" height="27" class="wd-b"/><rect x="4.5" y="-31.5" width="27" height="27" class="wd-o"/><rect x="-31.5" y="4.5" width="27" height="27" class="wd-o"/></g>`;
function wheelDisc(segs, target) {
  const n = segs.length, seg = 360 / n;
  let faces = '', lines = '', labels = '', pegs = '';
  // the flash and the outline of the segment that will stop under the pointer (they turn with it)
  const t0 = -90 + target * seg - seg / 2, hd = wedge(t0, t0 + seg, HUB, RIM), hit = `<path class="w-win" d="${hd}" opacity="0"/><path class="w-hitl" d="${hd}"/>`;
  segs.forEach((m, i) => {
    const a = -90 + i * seg, a0 = a - seg / 2;
    faces += `<path d="${wedge(a0, a0 + seg, HUB, RIM)}" class="${i % 2 ? 'wd-f2' : 'wd-f1'}"/>`;
    lines += `<path d="M${at(HUB, a0)}L${at(RIM, a0)}"/>`;
    const [x, y] = at(107, a).split(' '), fs = m >= 1000 ? 19 : 23;
    labels += `<text x="${x}" y="${y}" transform="rotate(${a} ${x} ${y})" class="${m >= 4 ? 'wd-hi' : 'wd-lo'}" font-size="${fs}"><tspan font-size="${fs * .58}">×</tspan>${fmt(m)}</text>`;
    const [px, py] = at((R + RIM) / 2, a0).split(' ');
    pegs += `<rect x="${(+px - 2.6).toFixed(2)}" y="${(+py - 2.6).toFixed(2)}" width="5.2" height="5.2" transform="rotate(${a0 + 45} ${px} ${py})"/>`;
  });
  return `<svg class="w-disc" viewBox="-200 -200 400 400">
    <circle r="${R}" class="wd-base"/>${faces}<g class="wd-ln">${lines}</g>${hit}
    <circle r="${RIM}" class="wd-ring"/><circle r="${R}" class="wd-ring"/><g class="wd-peg">${pegs}</g>
    <g class="wd-tx">${labels}</g>
    <circle r="${HUB}" class="wd-hub"/><circle r="${HUB - 7}" class="wd-ring"/>${ICON}</svg>`;
}
// what does not turn: the pointer (a square on a line, like the old mark)
const wheelFront = () => `<svg class="w-front" viewBox="-200 -200 400 400">
    <rect class="w-ptr" x="-1.2" y="-188" width="2.4" height="34"/><rect class="w-ptr" x="-8" y="-200" width="16" height="16" transform="rotate(45 0 -192)"/></svg>`;

/* ---------- sparks / embers on a canvas ---------- */
const WARM = ['#FE7A47', '#FF9F73', '#FFD2B8', '#ffffff'], COOL = ['#7DB4CF', '#5FA3C6', '#BFE3F5', '#ffffff'], ALL = [...WARM, ...COOL];
function makeFx(canvas, host) {
  const c = canvas.getContext('2d'); if (!c) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const hr = host.getBoundingClientRect(); canvas.width = Math.round(hr.width * dpr); canvas.height = Math.round(hr.height * dpr);
  let parts = [], raf = 0, last = 0, emit = null, dead = false;
  const loop = now => {
    if (dead) return;
    const dt = Math.min(.05, (now - last) / 1000 || .016); last = now;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, hr.width, hr.height); c.globalCompositeOperation = 'lighter';
    if (emit) { emit.acc += dt * emit.rate; while (emit.acc >= 1) { emit.acc--; parts.push({ x: emit.x + (Math.random() - .5) * emit.w, y: emit.y + (Math.random() - .5) * 40, vx: (Math.random() - .5) * 40, vy: -30 - Math.random() * 90, g: -8, drag: .6, life: 1.2 + Math.random() * 1.2, max: 2.4, size: 1.5 + Math.random() * 1.8, color: emit.colors[(Math.random() * emit.colors.length) | 0], dot: true }) } }
    for (const p of parts) {
      p.px = p.x; p.py = p.y; p.vy += p.g * dt; const dr = Math.pow(p.drag, dt); p.vx *= dr; p.vy *= dr; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      c.globalAlpha = Math.max(0, Math.min(1, p.life / p.max * 1.6)); c.strokeStyle = c.fillStyle = p.color;
      if (p.dot) { c.fillRect(p.x, p.y, p.size, p.size) } else { c.lineWidth = p.size; c.lineCap = 'round'; c.beginPath(); c.moveTo(p.px, p.py); c.lineTo(p.x, p.y); c.stroke() }
    }
    parts = parts.filter(p => p.life > 0); c.globalAlpha = 1;
    if (parts.length || emit) raf = requestAnimationFrame(loop); else raf = 0;
  };
  const kick = () => { if (!raf && !dead) { last = performance.now(); raf = requestAnimationFrame(loop) } };
  return {
    burst(x, y, n, colors, [s0, s1], g = 700) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = lerp(s0, s1, Math.random() ** 1.6), life = .7 + Math.random() * .9;
        parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - s * .25, g, drag: .16, life, max: life, size: 2 + Math.random() * 3, color: colors[(Math.random() * colors.length) | 0] });
      }
      kick();
    },
    embers(x, y, w, rate, colors) { emit = { x, y, w, rate, colors, acc: 0 }; kick() },
    calm() { emit = null },
    stop() { dead = true; cancelAnimationFrame(raf); parts = []; emit = null; c.clearRect(0, 0, canvas.width, canvas.height) },
  };
}

/** info: { stake, multiplier|null, prize }. Resolves when it is over (or skipped). */
export function playWheel(info) {
  return new Promise(resolve => {
    const el = $('#wheel'), free = info.multiplier == null, m = info.multiplier, t = free ? 0 : tier(m), to = info.prize || 0;
    const buy = (STAKES[info.stake] || {}).buyIn;
    const tok = el._tok = {};
    el.className = 'wheel t' + t;
    el.style.setProperty('--tc', t >= 2 ? '#FE7A47' : t === 1 ? 'var(--you-text)' : 'var(--ink)');

    // ---- geometry: how far the wheel turns (degrees) so that the segment under the pointer is the server's multiplier ----
    const prof = PROFILE[t].map(s => ({ ...s })), S = prof.reduce((s, x) => s + x.ms, 0), D0 = prof.reduce((s, x) => s + x.d, 0);
    const segs = free ? [] : wheelSegments(info.stake);
    if (!free && !segs.includes(m)) segs[0] = m;
    const SEG = free ? 360 : 360 / segs.length;
    const hits = segs.map((x, i) => x === m ? i : -1).filter(i => i >= 0), TARGET = hits[(Math.random() * hits.length) | 0] || 0;
    // segment i sits at the pointer when the rotation is -i·SEG (mod 360); land a little off its centre, like a real wheel
    const A0 = Math.random() * 360, base = D0 * SEG / CELL, land = -TARGET * SEG + (Math.random() - .5) * SEG * .5;
    const D = base + ((((land - A0 - base) % 360) + 360) % 360), O = OVER[t] * SEG / CELL, sc = (D + O) / D0;
    el.hidden = false;

    el.innerHTML = `<div class="w-in">
      <div class="w-bg"></div><div class="w-rays"></div><div class="w-scan"></div><div class="w-vig"></div><div class="w-glow"></div>
      <div class="w-stack">
        <div class="w-top"><div class="eyebrow">${STAKE_LABEL[info.stake] || ''}${buy ? ' · ' + fmt(buy) : ''}</div></div>
        ${free ? '' : `<div class="w-reel" aria-hidden="true"><div class="w-rot" style="transform:rotate(${A0}deg)">${wheelDisc(segs, TARGET)}</div>${wheelFront()}<i class="w-ring"></i></div>`}
        <div class="w-res" role="status"><div class="w-mult" id="wMult">${free ? '<span class="w-free">FREEROLL</span>' : `<small>×</small>${fmt(m)}`}</div>
        <div class="w-prize" id="wPrize"><span id="wPv">0</span><small>CHIPS</small></div></div>
      </div>
      <canvas class="w-fx"></canvas><div class="w-flash"></div></div>
      <div class="w-hint eyebrow">SKIP</div>`;
    const q = s => el.querySelector(s);
    const inEl = q('.w-in'), stack = q('.w-stack'), rot = q('.w-rot'), reel = q('.w-reel'), mult = q('#wMult'), prize = q('#wPrize'), pv = q('#wPv');
    const bg = q('.w-bg'), rays = q('.w-rays'), scan = q('.w-scan'), vig = q('.w-vig'), flash = q('.w-flash'), win = q('.w-win'), ring = q('.w-ring');
    // a long multiplier (x10,000) must fit a phone: shrink the type, never wrap
    const fit = () => { mult.style.fontSize = ''; const avail = mult.parentElement.clientWidth - 8, w = mult.offsetWidth; if (w > avail) mult.style.fontSize = (parseFloat(getComputedStyle(mult).fontSize) * avail / w) + 'px' };
    fit();
    // light sources follow the real layout: rays/vignette on the reel, the glow behind the result
    const place = () => {
      const hr = el.getBoundingClientRect(), rr = (reel || stack).getBoundingClientRect(), mr = mult.getBoundingClientRect();
      el.style.setProperty('--rx', (rr.left + rr.width / 2 - hr.left) + 'px'); el.style.setProperty('--ry', (rr.top + rr.height / 2 - hr.top) + 'px');
      el.style.setProperty('--gx', (mr.left + mr.width / 2 - hr.left) + 'px'); el.style.setProperty('--gy', (mr.top + mr.height / 2 - hr.top) + 'px');
    };
    place();

    let phase = 'spin', done = false, counting = false, reelOn = false, raf = 0, rayAnim = null, drone = null, fx = null, holdTimer = 0;
    const timers = [], born = performance.now();
    const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id };
    const cancelAnims = () => { try { el.getAnimations({ subtree: true }).forEach(a => a.cancel()) } catch (e) { /* old engine */ } };
    const kill = () => { cancelAnimationFrame(raf); reelOn = false; timers.forEach(clearTimeout); timers.length = 0; if (drone) { drone.stop(true); drone = null } if (fx) { fx.stop(); fx = null } };

    const finish = () => {
      if (done) return; done = true; const lingering = fx; fx = null; if (lingering) lingering.calm(); kill(); clearTimeout(holdTimer);
      document.removeEventListener('keydown', onKey);
      let closed = false;
      const out = () => { if (closed) return; closed = true; if (lingering) lingering.stop(); if (el._tok !== tok) return resolve(); el.hidden = true; el.innerHTML = ''; el.className = 'wheel'; el.onclick = null; el.style.removeProperty('--tc'); resolve() };
      if (REDUCE) return out();
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out' }).onfinish = out;
      setTimeout(out, 300);
    };

    /* ---------- effects ---------- */
    const origin = () => { const hr = el.getBoundingClientRect(), r = q('.w-res').getBoundingClientRect(); return { x: r.left + r.width / 2 - hr.left, y: r.top + mult.offsetHeight * .5 - hr.top, w: Math.min(r.width, mult.offsetWidth * 1.4) } };
    const shake = (amp, ms) => {
      if (REDUCE) return;
      const n = Math.max(6, Math.round(ms / 45)), kf = [{ transform: 'translate(0,0)' }];
      for (let i = 1; i <= n; i++) { const d = Math.pow(1 - i / n, 1.5) * amp; kf.push({ transform: `translate(${((Math.random() * 2 - 1) * d).toFixed(1)}px,${((Math.random() * 2 - 1) * d).toFixed(1)}px)` }) }
      kf.push({ transform: 'none' }); inEl.animate(kf, { duration: ms, easing: 'linear' });
    };
    const flashAll = (color, peak, ms) => { if (REDUCE) return; flash.style.background = color; flash.animate([{ opacity: peak }, { opacity: 0 }], { duration: ms, easing: 'ease-out' }) };
    const flashWin = peak => { if (REDUCE || !win) return; win.animate([{ opacity: peak }, { opacity: 0 }], { duration: 260, easing: 'ease-out' }) };
    const pulseRing = (x = 3.6, ms = 520) => { if (REDUCE || !ring) return; ring.animate([{ transform: 'scale(1)', opacity: .95 }, { transform: `scale(${1 + (x - 1) * .12})`, opacity: 0 }], { duration: ms, easing: 'cubic-bezier(.1,.7,.2,1)' }) };
    const stamp = () => {
      if (REDUCE) return;
      const kf = t >= 3 ? [{ transform: 'scale(3.4)', opacity: 0, filter: 'blur(14px)' }, { transform: 'scale(.9)', opacity: 1, filter: 'blur(0)', offset: .3 }, { transform: 'scale(1.05)', offset: .55 }, { transform: 'scale(1)', opacity: 1, filter: 'blur(0)' }]
        : t === 2 ? [{ transform: 'scale(1.9)', opacity: 0 }, { transform: 'scale(.93)', opacity: 1, offset: .4 }, { transform: 'scale(1.03)', offset: .7 }, { transform: 'scale(1)', opacity: 1 }]
        : t === 1 ? [{ transform: 'scale(.55)', opacity: 0 }, { transform: 'scale(1.08)', opacity: 1, offset: .6 }, { transform: 'scale(1)', opacity: 1 }]
        : [{ transform: 'scale(.7)', opacity: 0 }, { transform: 'scale(1.04)', opacity: 1, offset: .6 }, { transform: 'scale(1)', opacity: 1 }];
      mult.animate(kf, { duration: [260, 380, 460, 620, 620][t], easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    };
    const rollUp = () => {
      if (!to) { pv.textContent = fmt(0); return }
      counting = true; const ms = free ? FREE_MS.count : COUNT[t], t1 = performance.now(), pw = t >= 3 ? 2.4 : t === 2 ? 2 : 0;
      let nextB = 0;
      const step = now => {
        if (done || !counting) return;
        const k = clamp01((now - t1) / ms), e = pw ? Math.pow(k, pw) : 1 - Math.pow(1 - k, 3);
        if (k < 1) {
          let v = to * e; if (t >= 2 && to >= 100) v = Math.min(to - 1, Math.floor(v / 10) * 10 + ((Math.random() * 10) | 0)); // the last digit rolls
          pv.textContent = fmt(v);
          if (t >= 1 && now >= nextB) { snd.blip(k, t); nextB = now + Math.max(26, 105 - 80 * k) }
          raf2 = requestAnimationFrame(step);
        } else endCount(true);
      };
      raf2 = requestAnimationFrame(step);
    };
    let raf2 = 0;
    const endCount = pop => {
      cancelAnimationFrame(raf2); counting = false; pv.textContent = fmt(to);
      if (pop && t >= 2 && !REDUCE) prize.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.1)', offset: .4 }, { transform: 'scale(1)' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
    };

    const hitCell = () => { if (reel) reel.classList.add('hit') };
    const turn = p => { rot.style.transform = `rotate(${(A0 + p).toFixed(3)}deg)` };
    const showResult = () => { el.classList.add('rev'); mult.style.opacity = 1; prize.style.opacity = 1 };

    // the moment of impact (after the hard-cut pause on tier 3+)
    const boom = () => {
      if (done) return;
      showResult(); stamp(); snd.thunk(t); snd.stinger(t, 0);
      snd.haptic([[], [18], [30, 40, 30], [60, 50, 60, 50, 140], [60, 50, 60, 50, 60, 50, 200]][t]);
      if (t >= 1 && ring) pulseRing(t >= 3 ? 5 : 3.6, t >= 3 ? 700 : 520);
      if (t === 0) { flashWin(.4); reel.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(3px)' }, { transform: 'translateY(0)' }], { duration: 170, easing: 'ease-out' }) }
      if (t === 1) { flashWin(.5); reel.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(5px)' }, { transform: 'translateY(0)' }], { duration: 220, easing: 'ease-out' }) }
      if (t >= 2) flashWin(.7);
      if (!REDUCE && t >= 2) {
        const o = origin(); fx = fx || makeFx(q('.w-fx'), el);
        if (t === 2) { flashAll('#ffb894', .5, 260); shake(5, 380); fx && fx.burst(o.x, o.y, 72, WARM, [280, 900]) }
        else {
          flashAll('#ffffff', 1, 560); shake(14, 720);
          if (fx) { fx.burst(o.x, o.y, 150, WARM, [300, 1300]); fx.embers(o.x, o.y, o.w, 38, WARM) }
          if (t >= 4) {
            later(() => { // second beat: colour shift to cool white
              if (done) return; const p = origin(); mult.style.color = '#fff'; el.style.setProperty('--tc', '#9ED0EA');
              flashAll('#BFE3F5', .85, 480); shake(8, 480); pulseRing(6, 700); snd.stinger(3, 1); snd.haptic([40, 40, 80]);
              if (fx) { fx.burst(p.x, p.y, 100, COOL, [260, 1000]); fx.embers(p.x, p.y, p.w, 38, ALL) }
            }, 700);
            if (m >= 10000) later(() => { // third beat
              if (done) return; const p = origin(); el.style.setProperty('--tc', '#FE7A47'); mult.style.color = '';
              flashAll('#ffffff', 1, 620); shake(12, 640); pulseRing(7, 800); snd.stinger(3, 2); snd.haptic([80, 40, 80, 40, 220]);
              if (fx) fx.burst(p.x, p.y, 140, ALL, [300, 1300]);
            }, 1400);
          }
        }
      }
      rollUp();
      holdTimer = later(finish, AFTER[t] - BOOM[t]);
    };

    // the reel has just stopped on the target cell
    const impact = () => {
      if (phase !== 'spin') return; phase = 'rev';
      hitCell();
      if (drone) { drone.stop(true); drone = null }
      if (rayAnim) { rayAnim.cancel(); rayAnim = null }
      if (t >= 3) { // hard cut: the lights and the sound drop out, then the boom
        [rays, scan, vig].forEach(x => { x.style.transition = 'none'; x.style.opacity = 0 });
        later(boom, BOOM[t]);
      } else boom();
    };

    // final state without animation (skip / reduced motion)
    const showFinal = reduced => {
      cancelAnimationFrame(raf); cancelAnimationFrame(raf2); reelOn = false; counting = false; phase = 'rev';
      timers.forEach(clearTimeout); timers.length = 0; clearTimeout(holdTimer);
      if (drone) { drone.stop(true); drone = null } if (fx) { fx.stop(); fx = null }
      cancelAnims();
      if (rot) turn(D);
      if (t >= 2 && !reduced) { el.classList.add('dk'); bg.style.transition = 'none'; bg.style.opacity = 1 }
      [rays, scan, vig].forEach(x => { x.style.transition = 'none'; x.style.opacity = 0 });
      if (t >= 4) { mult.style.color = ''; el.style.setProperty('--tc', '#FE7A47') }
      hitCell(); showResult(); pv.textContent = fmt(to);
      if (reduced) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 }); snd.stinger(Math.min(t, 1), 0) }
      else { snd.thunk(0); snd.stinger(Math.min(t, 2), 0) }
      holdTimer = later(finish, reduced ? 2200 : 1300);
    };

    const skip = () => {
      if (done || performance.now() - born < 350) return;
      if (phase === 'spin') showFinal(false);
      else if (counting) { endCount(false); clearTimeout(holdTimer); holdTimer = later(finish, 700) }
      else finish();
    };
    const onKey = e => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); skip() } };
    el.onclick = skip; document.addEventListener('keydown', onKey);
    snd.resume();

    if (REDUCE) { showFinal(true); return }

    /* ---------- freeroll: short and clean ---------- */
    if (free) {
      later(() => {
        if (done) return; phase = 'rev'; showResult(); stamp(); snd.thunk(0); snd.stinger(1, 0); flashAll('#ffffff', .16, 300); rollUp();
        holdTimer = later(finish, FREE_MS.hold);
      }, FREE_MS.reveal);
      return;
    }

    /* ---------- build-up lighting (follows the reel; it is tension, the reel itself is untouched) ---------- */
    const t12 = prof[0].ms + prof[1 < prof.length ? 1 : 0].ms; // end of the cruise = start of the long slowdown (t2/t3)
    const darken = (ms, color) => { bg.style.background = color; bg.style.transition = `opacity ${ms}ms ease-out`; bg.style.opacity = 1; later(() => el.classList.add('dk'), ms * .45) };
    if (t === 2) later(() => {
      darken(520, '#0b0c10'); vig.style.transition = 'opacity .6s'; vig.style.opacity = .5; snd.swell(520);
      if (!done) drone = snd.drone(2);
    }, 650);
    if (t >= 3) {
      later(() => {
        darken(450, '#05060a'); snd.swell(900);
        rays.style.transition = 'opacity .8s'; rays.style.opacity = .9; scan.style.transition = 'opacity .8s'; scan.style.opacity = 1; vig.style.transition = 'opacity .6s'; vig.style.opacity = .55;
        rayAnim = rays.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 7000, iterations: Infinity });
        drone = snd.drone(3);
      }, 250);
      // heartbeat through the long slowdown, quickening as the reel crawls
      later(function beat() {
        if (done || phase !== 'spin') return;
        const p = clamp01((performance.now() - tStart - t12) / (S - t12));
        snd.heartbeat(p); vig.animate([{ opacity: .55 }, { opacity: 1 }, { opacity: .55 }], { duration: 300, easing: 'ease-out' });
        later(beat, 1000 - 460 * p);
      }, t12);
    }

    /* ---------- the reel ---------- */
    const posAt = e => {
      if (e >= S) return D + O - O * (1 - Math.pow(1 - clamp01((e - S) / (SETTLE[t] || 1)), 3));
      let acc = 0;
      for (const s of prof) { if (e <= s.ms) return acc + s.d * s.e(e / s.ms) * sc; e -= s.ms; acc += s.d * sc }
      return acc;
    };
    let tStart = performance.now(), prevP = 0, prevT = tStart, lastIdx = -1;
    reelOn = true;
    const frame = now => {
      if (!reelOn || done) return;
      const e = Math.max(0, now - tStart), p = posAt(e), v = (p - prevP) / Math.max(1, now - prevT);
      turn(p);
      const s01 = clamp01(Math.abs(v) * CELL / SEG / 3.4), idx = Math.floor((A0 + p) / SEG + .5);   // a tick per segment boundary
      if (idx !== lastIdx) { lastIdx = idx; if (e < S) snd.tick(s01) }
      if (e < S) {
        if (drone) drone.set(s01);
        if (rayAnim) rayAnim.playbackRate = .35 + s01 * 2.4;
      }
      prevP = p; prevT = now;
      if (e >= S && phase === 'spin') impact();
      if (e < S + (SETTLE[t] || 0)) raf = requestAnimationFrame(frame); else reelOn = false;
    };
    raf = requestAnimationFrame(now => { tStart = now; prevT = now; frame(now) });
  });
}
