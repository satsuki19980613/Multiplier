// Synthesized sound for the multiplier reveal (Web Audio API only: no audio files). Moderate volume, default ON, the header
// toggle (#soundToggle) persists in localStorage. The AudioContext is only created after a user gesture (first tap / key anywhere,
// so the PLAY / stake tap counts). Every function is a safe no-op when sound is off or unavailable.
const KEY = 'mp-sound';
let on = true;
try { on = localStorage.getItem(KEY) !== '0' } catch (e) { /* private mode: stay on */ }

let ctx = null, master = null, noiseBuf = null, lastTick = 0;

export const isOn = () => on;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = .004; comp.release.value = .2;
    master = ctx.createGain(); master.gain.value = .6;
    master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // iOS: a silent buffer inside the gesture unlocks output
    const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0);
  } catch (e) { ctx = null }
  return ctx;
}
/** call from a user gesture (it is also hooked to the first tap / key automatically) */
export function unlock() { if (!on) return; if (ensure() && ctx.state !== 'running') ctx.resume().catch(() => {}) }
const ready = () => { if (!on || !ensure()) return false; if (ctx.state !== 'running') ctx.resume().catch(() => {}); return true };
export const resume = () => { ready() };
['pointerdown', 'touchend', 'keydown'].forEach(ev => addEventListener(ev, () => { if (!ctx || ctx.state !== 'running') unlock() }, { capture: true, passive: true }));

/* ---------- primitives ---------- */
function tone({ f = 440, f2 = 0, type = 'sine', t = 0, a = .004, d = .2, v = .2, lp = 0 }) {
  const t0 = ctx.currentTime + t, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + a + d);
  g.gain.setValueAtTime(.0001, t0); g.gain.exponentialRampToValueAtTime(v, t0 + a); g.gain.exponentialRampToValueAtTime(.0001, t0 + a + d);
  let n = o;
  if (lp) { const b = ctx.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = lp; o.connect(b); n = b }
  n.connect(g); g.connect(master); o.start(t0); o.stop(t0 + a + d + .05);
}
function noise({ t = 0, a = .003, d = .2, v = .2, type = 'lowpass', f = 1200, f2 = 0, q = .8 }) {
  const t0 = ctx.currentTime + t, s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; s.loop = true; b.type = type; b.Q.value = q; b.frequency.setValueAtTime(f, t0);
  if (f2) b.frequency.exponentialRampToValueAtTime(f2, t0 + a + d);
  g.gain.setValueAtTime(.0001, t0); g.gain.exponentialRampToValueAtTime(v, t0 + a); g.gain.exponentialRampToValueAtTime(.0001, t0 + a + d);
  s.connect(b); b.connect(g); g.connect(master); s.start(t0, Math.random() * .5); s.stop(t0 + a + d + .05);
}
const NOTE = { C4: 261.6, E4: 329.6, G4: 392, C5: 523.3, D5: 587.3, E5: 659.3, G5: 784, A5: 880, C6: 1046.5, D6: 1174.7, E6: 1318.5, G6: 1568 };

/* ---------- reel ---------- */
/** a ratchet click. s = reel speed 0..1 (fast = light and short, slow = heavier and lower: the "will it stop?" tension) */
export function tick(s = .5) {
  if (!ready()) return;
  const now = ctx.currentTime; if (now - lastTick < .03) return; lastTick = now;
  const slow = 1 - Math.min(1, Math.max(0, s));
  tone({ f: 760 + s * 1100, f2: 300 + s * 300, type: 'square', d: .018 + slow * .045, v: .045 + slow * .07, lp: 2600 });
  noise({ d: .012, v: .05 + slow * .05, type: 'bandpass', f: 2400, q: 1.5 });
}
/** the reel stops (tier 0..4) */
export function thunk(t = 0) {
  if (!ready()) return;
  const big = t >= 2;
  tone({ f: 190, f2: 48, d: big ? .2 : .13, v: big ? .75 : t ? .5 : .38 });
  noise({ d: .045, v: big ? .32 : .2, f: 3000 });
  if (big) noise({ d: .38, v: t >= 3 ? .45 : .28, f: 2200, f2: 120, a: .005 });
}
/** an ascending sweep that builds while the reel spins up (tier 3) */
export function swell(ms = 700) { if (ready()) noise({ a: ms / 1000 * .8, d: ms / 1000 * .4, v: .16, type: 'bandpass', f: 300, f2: 2600, q: 2 }) }
/** a drone whose pitch follows the reel speed (tier 2/3). returns { set(speed01), stop() } */
export function drone(t = 2) {
  if (!ready()) return { set() {}, stop() {} };
  const o = ctx.createOscillator(), o2 = ctx.createOscillator(), b = ctx.createBiquadFilter(), g = ctx.createGain(), top = t >= 3 ? .075 : .045;
  o.type = 'sawtooth'; o2.type = 'square'; b.type = 'lowpass'; b.frequency.value = 500; g.gain.value = 0;
  o.connect(b); o2.connect(b); b.connect(g); g.connect(master); o.start(); o2.start();
  let dead = false;
  return {
    set(s) {
      if (dead || !ctx) return; if (!on) { g.gain.setTargetAtTime(0, ctx.currentTime, .05); return }
      const n = ctx.currentTime, f = 55 + s * 170;
      o.frequency.setTargetAtTime(f, n, .06); o2.frequency.setTargetAtTime(f * 1.005 * 2, n, .06);
      b.frequency.setTargetAtTime(280 + s * 900, n, .08); g.gain.setTargetAtTime(top * (.25 + .75 * s), n, .08);
    },
    stop(fast) {
      if (dead) return; dead = true;
      const n = ctx.currentTime; g.gain.cancelScheduledValues(n); g.gain.setTargetAtTime(0, n, fast ? .015 : .12);
      o.stop(n + .5); o2.stop(n + .5);
    },
  };
}
/** a heartbeat thump (k 0..1 = intensity) */
export function heartbeat(k = .5) {
  if (!ready()) return;
  const v = .35 + .4 * k;
  tone({ f: 70, f2: 38, d: .16, v }); tone({ f: 64, f2: 36, d: .15, v: v * .75, t: .17 });
}
/** count-up tick (k 0..1 = progress) */
export function blip(k = 0, t = 1) {
  if (!ready()) return;
  tone({ f: 520 + k * 1100, type: t >= 3 ? 'triangle' : 'sine', d: .05, v: .035 + k * .045 });
}

/* ---------- stingers (beat 0 = the stop, beat 1/2 = the extra beats of x1000 / x10000) ---------- */
export function stinger(t = 0, beat = 0) {
  if (!ready()) return;
  if (t <= 0) { // subtle
    tone({ f: NOTE.G5, d: .16, v: .05, t: .05 }); tone({ f: NOTE.D6, d: .2, v: .04, t: .12 }); return;
  }
  if (t === 1) {
    [NOTE.C5, NOTE.E5, NOTE.G5].forEach((f, i) => tone({ f, type: 'triangle', d: .34, v: .08, t: .04 + i * .06 }));
    tone({ f: NOTE.G6, d: .5, v: .03, t: .16 }); return;
  }
  const r = [1, 1.5, 2][Math.min(2, beat)] || 1;
  if (t === 2) {
    [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6].forEach((f, i) => tone({ f, type: 'triangle', d: .5, v: .1, t: .04 + i * .075 }));
    [NOTE.C4, NOTE.E4, NOTE.G4].forEach(f => tone({ f, type: 'sawtooth', a: .02, d: 1.1, v: .05, lp: 1300, t: .05 }));
    noise({ type: 'highpass', f: 5000, f2: 9000, d: .6, v: .05, t: .08 }); return;
  }
  // tier 3+ : sub boom, explosion, a wide chord, a fast pentatonic run and a shimmer
  if (beat === 0) {
    tone({ f: 95, f2: 28, d: .95, v: .9 });
    noise({ d: 1.3, v: .55, f: 3200, f2: 90, a: .006 });
  } else {
    tone({ f: 130 * r, f2: 50 * r, d: .5, v: .55 });
    noise({ d: .7, v: .35, f: 4200, f2: 200, a: .006 });
  }
  const chord = [130.8, 196, 261.6, 329.6, 392, 523.3].map(f => f * r);
  chord.forEach(f => tone({ f, type: 'sawtooth', a: .02, d: beat ? 1.5 : 2.2, v: .045, lp: 2000, t: .03 }));
  [NOTE.C5, NOTE.D5, NOTE.E5, NOTE.G5, NOTE.A5, NOTE.C6, NOTE.D6, NOTE.E6].forEach((f, i) => tone({ f: f * r, type: 'triangle', d: .6, v: .085, t: .05 + i * .06 }));
  tone({ f: 2093 * r, d: 1.4, v: .03, t: .3 }); tone({ f: 3136 * r, d: 1.2, v: .022, t: .36 });
  noise({ type: 'highpass', f: 4500, f2: 10000, d: .9, v: .07, t: .1 });
}

/** vibration (tier 1+ stops where supported); follows the sound toggle */
export function haptic(p) { if (on && p && p.length && navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) { try { navigator.vibrate(p) } catch (e) { /* unsupported */ } } }

/* ---------- header toggle ---------- */
function bind() {
  const b = document.getElementById('soundToggle'); if (!b) return;
  const paint = () => { b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('off', !on); b.title = on ? 'Sound ON' : 'Sound OFF' };
  paint();
  b.addEventListener('click', () => {
    on = !on; try { localStorage.setItem(KEY, on ? '1' : '0') } catch (e) { /* private mode */ }
    paint();
    if (on) { unlock(); if (ready()) { tone({ f: NOTE.E5, type: 'triangle', d: .1, v: .06 }); tone({ f: NOTE.A5, type: 'triangle', d: .14, v: .06, t: .07 }) } }
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
