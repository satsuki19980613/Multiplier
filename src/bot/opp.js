// Opponent statistics from the visible log of the current tournament (view.log keeps the last ~400 lines).
// Only preflop first-in behaviour and responses to raises are tracked; used to widen/narrow ranges and to exploit.
const RE_ACT = /^\{(\d)\} (folds|checks|calls \d+|bets \d+|raises to \d+)( \(all-in\))?$/;

export function oppStats(view) {
  const st = [0, 1, 2].map(() => ({ n: 0, raise: 0, jam: 0, limp: 0, face: 0, faceFold: 0, faceJam: 0, faceJamFold: 0, hands: 0 }));
  const log = view.log || [];
  let raises = 0, limps = 0, inPre = false, lastJam = false;
  for (const e of log) {
    const t = e.text !== undefined ? e.text : e;
    if (typeof t !== 'string') continue;
    if (t.startsWith('Hand ')) { raises = 0; limps = 0; inPre = true; lastJam = false; continue; }
    if (/^(Flop|Turn|River):/.test(t)) { inPre = false; continue; }
    if (!inPre) continue;
    const m = RE_ACT.exec(t);
    if (!m) continue;
    const seat = +m[1], a = m[2], allIn = !!m[3];
    const s = st[seat];
    if (raises === 0 && limps === 0) {
      // first-in decision
      if (a === 'folds') s.n++;
      else if (a.startsWith('calls')) { s.n++; s.limp++; limps++; }
      else if (a.startsWith('raises') || a.startsWith('bets')) { s.n++; s.raise++; if (allIn) s.jam++; raises++; lastJam = allIn; }
    } else if (raises > 0) {
      s.face++;
      if (a === 'folds') { s.faceFold++; }
      if (lastJam) { s.faceJam++; if (a === 'folds') s.faceJamFold++; }
      if (a.startsWith('raises')) { raises++; lastJam = allIn; }
    }
  }
  return st;
}
