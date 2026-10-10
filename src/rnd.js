// Random numbers for room codes, seating and deck shuffles (never Math.random). Shared by the server (server/game/db.js) and the
// development stand-in (src/fakeNet.js).
// => 0 <= x < 1 (53 bits)
export const secureRnd=()=>{const a=crypto.getRandomValues(new Uint32Array(2));return((a[0]>>>5)*67108864+(a[1]>>>6))/9007199254740992};
