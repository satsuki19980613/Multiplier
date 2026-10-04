// Runtime lookup prototype (Node.js). card = rank*4+suit, rank 0='2'..12='A'
const hu = require('./hu_pushfold.json');
const tw = require('./threeway_equal_stacks.json');
function classIndex(c1, c2) {            // 0..168, same order as json "hands"
  let r1 = c1 >> 2, r2 = c2 >> 2, s1 = c1 & 3, s2 = c2 & 3;
  const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
  if (hi === lo) return (12 - hi) * 14;
  return s1 === s2 ? (12 - hi) * 13 + (12 - lo)   // suited: above diagonal
                   : (12 - lo) * 13 + (12 - hi);  // offsuit: below diagonal
}
function nearest(arr, x) { let b = 0; for (let i = 1; i < arr.length; i++) if (Math.abs(arr[i] - x) < Math.abs(arr[b] - x)) b = i; return b; }
function lerpProb(rows, stacks, x, h) {   // linear interpolation between stack grid points
  if (x <= stacks[0]) return rows[0][h] / 100;
  if (x >= stacks[stacks.length - 1]) return rows[rows.length - 1][h] / 100;
  let i = 0; while (stacks[i + 1] < x) i++;
  const t = (x - stacks[i]) / (stacks[i + 1] - stacks[i]);
  return ((1 - t) * rows[i][h] + t * rows[i + 1][h]) / 100;
}
// HU: SB jam prob / BB call prob given effective stack in bb
const huPush = (c1, c2, eff) => lerpProb(hu.push, hu.stacks, eff, classIndex(c1, c2));
const huCall = (c1, c2, eff) => lerpProb(hu.call, hu.stacks, eff, classIndex(c1, c2));
// 3-way equal-stack table, node in {a,sp,sc,b1,b2,b3}; stack = rounded average/min stack in bb
const twRows = {}; for (const n of ['a','sp','sc','b1','b2','b3']) twRows[n] = tw.stacks.map(s => tw.tables[String(s)][n]);
function twProb(node, c1, c2, stack) {
  const rows = twRows[node];
  return lerpProb(rows, tw.stacks, stack, classIndex(c1, c2));
}
const decide = p => Math.random() < p ? 1 : 0;   // mixed strategy sampling
module.exports = { classIndex, huPush, huCall, twProb, decide, hu, tw };
if (require.main === module) {
  const c = (r, s) => r * 4 + s;
  const names = hu.hands;
  // check indexing for a few hands
  const tests = [[c(12,0),c(11,0),'AKs'],[c(12,0),c(11,1),'AKo'],[c(12,0),c(12,1),'AA'],[c(5,0),c(0,1),'72o'],[c(2,0),c(0,0),'42s'],[c(7,2),c(6,2),'98s']];
  // (rank idx: 0='2',...,5='7',7='9',6='8')
  for (const [a,b,n] of tests) console.log(n, names[classIndex(a,b)]);
  console.log('HU 10bb: AKo push', huPush(c(12,0),c(11,1),10), ' 72o push', huPush(c(5,0),c(0,1),10), ' K5o push@15', huPush(c(11,0),c(3,1),15), 'BB call K9o @12.25bb', huCall(c(11,0),c(7,1),12.25));
  console.log('3-way 10bb BTN push A2o', twProb('a',c(12,0),c(0,1),10), ' T7s', twProb('a',c(8,0),c(5,0),10), ' 9.5bb K5s', twProb('a',c(11,0),c(3,0),9.5));
  let t = process.hrtime.bigint(); let s = 0;
  for (let i = 0; i < 1e5; i++) s += twProb('b3', c(12,0), c(10,1), 7 + (i % 10));
  console.log('1e5 lookups (incl. rebuilding rows each call) ms:', Number(process.hrtime.bigint() - t) / 1e6);
}
