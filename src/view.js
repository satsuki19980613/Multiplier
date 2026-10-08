// What a seat is allowed to see. Shared by the server (viewsOf) and the bots (they decide from the view only).
// Spec: docs/ARCHITECTURE.md §4.

// Copy of the state without the deck and the RNG key/counter; the hole cards of the other seats become null.
// lastHand.shown (hands that reached showdown) is kept as is; lastHand.hole keeps the seat's own cards and the shown ones.
// `seat` null/undefined = a spectator who sees no hole cards.
export function viewFor(g, seat) {
  const { deck, seed, ctr, holes, ...rest } = g;
  const v = structuredClone(rest);
  v.holes = holes.map((h, i) => (i === seat && h ? h.slice() : null));
  const lh = v.lastHand;
  if (lh && lh.hole) lh.hole = lh.hole.map((h, i) => (h && (i === seat || (lh.shown && lh.shown[i])) ? h : null));
  return v;
}

// Replace '{n}' placeholders with 'YOU' (my seat) or the player's name.
export function logText(entry, mySeat, names) {
  const text = typeof entry === 'string' ? entry : entry.text;
  return text.replace(/\{(\d)\}/g, (_, n) => (+n === mySeat ? 'YOU' : names[+n] ?? `Seat ${+n + 1}`));
}
