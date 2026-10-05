// Rules modal: all explanations live here (the screens themselves carry no explanatory text)
import { BLINDS, STAKES, MULTIPLIERS, FREEROLL, START_CHIPS, structureFor } from '../spin.js';
import { $, fmt, head, openDlg, STAKE_LABEL } from './util.js';

const TOTAL = 10_000_000;
const pct = n => { const p = n / TOTAL * 100; return (p >= 1 ? p.toFixed(2).replace(/\.?0+$/, '') : p.toFixed(4).replace(/\.?0+$/, '')) + '%' };
const oneIn = n => { const x = TOTAL / n; return '1/' + (x >= 100 ? Math.round(x).toLocaleString('en-US') : x.toFixed(1).replace(/\.0$/, '')) };
const mins = ms => ms % 60000 === 0 ? `${ms / 60000} min` : `${ms / 1000} s`;

function multTable(stake) {
  const buy = STAKES[stake].buyIn;
  const rows = MULTIPLIERS[stake].map(([m, n]) => `<tr><td>×${fmt(m)}</td><td>${fmt(m * buy)}</td><td>${pct(n)}</td><td>${oneIn(n)}</td></tr>`).join('');
  return `<table class="tbl"><thead><tr><th>Multiplier</th><th>Prize</th><th>Chance</th><th>Odds</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function structTable() {
  const rows = [2, 3, 4, 5, 10, 25, 100].map(m => {
    const s = structureFor(m), label = m === 10 ? '×10 / ×25' : m === 25 ? null : m === 100 ? '×100+' : '×' + m;
    if (label === null) return '';
    const bb = Math.round(s.stack / BLINDS[0][1]);
    return `<tr><td>${label}</td><td>${fmt(s.stack)}</td><td>${bb} BB</td><td>${mins(s.levelMs)}</td></tr>`;
  }).join('');
  return `<table class="tbl"><thead><tr><th>Multiplier</th><th>Stack</th><th>Start</th><th>Level</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function openRules() {
  const fr = FREEROLL;
  $('#rulesBody').innerHTML = head('RULES', 'Multiplier') + `
  <h3>Basics</h3>
  <dl class="spec">
    <dt>Format</dt><dd>3人の No Limit Hold'em トーナメント。1位が賞金を総取りし、2位・3位は 0。</dd>
    <dt>Multiplier</dt><dd>開始時に賞金の倍率がランダムに決まる。賞金 = buy-in × 倍率。</dd>
    <dt>Blinds</dt><dd>時間で上がる（Ante なし）。レベルが変わるのは次の hand から。最終レベルは据え置き。</dd>
    <dt>Turn</dt><dd>1手 15 秒＋タイムバンク。時間切れは Check、できなければ Fold。</dd>
    <dt>Seats</dt><dd>2人そろったらすぐに始まり、空いた席は Bot が埋める。1人のときは 15 秒後に Bot 2人と始まる。Bot の席には「Bot」と表示される。</dd>
    <dt>Retire</dt><dd>テーブルの Retire ボタンでいつでも卓を抜けられる（確認あり）。その場で最下位として扱われ、buy-in は戻らない。着席中はメニューに戻れず、抜けるのは Retire か決着のときだけ。</dd>
    <dt>Heads-up</dt><dd>2人になったらボタンが SB。プリフロップは先に、ポストフロップは後に行動する。</dd>
    <dt>Ranking</dt><dd>Straight Flush &gt; Four of a Kind &gt; Full House &gt; Flush &gt; Straight &gt; Three of a Kind &gt; Two Pair &gt; Pair &gt; High Card</dd>
  </dl>

  <h3>Stakes<span>buy-in</span></h3>
  <dl class="spec">
    ${Object.entries(STAKES).map(([k, s]) => `<dt>${STAKE_LABEL[k]}</dt><dd>buy-in ${fmt(s.buyIn)}（最大 ${fmt(s.buyIn * MULTIPLIERS[k][0][0])}）</dd>`).join('')}
  </dl>

  <h3>Structure<span>倍率ごとのスタックとレベル時間</span></h3>
  ${structTable()}
  <h3>Blind levels</h3>
  <div class="blinds">${BLINDS.map((b, i) => `<span><i>${i + 1}</i>${fmt(b[0])}/${fmt(b[1])}</span>`).join('')}</div>

  <h3>Multipliers<span>確率は buy-in ごとに異なる</span></h3>
  <div class="seg" id="multSeg">${Object.keys(STAKES).map((k, i) => `<button type="button" data-k="${k}" aria-pressed="${i === 0}">${STAKE_LABEL[k]}</button>`).join('')}</div>
  <div id="multTbl">${multTable('low')}</div>

  <h3>Freeroll</h3>
  <dl class="spec">
    <dt>Entry</dt><dd>残高が ${fmt(fr.eligibleBelow)} 未満のときだけ。1日 ${fr.perDay} 回まで（日本時間 0 時にリセット）。</dd>
    <dt>Prize</dt><dd>1位に ${fmt(fr.prize)}（倍率の抽選はなし）。参加費は 0。</dd>
    <dt>Structure</dt><dd>スタック ${fmt(fr.stack)}、レベル ${mins(fr.levelMs)}。</dd>
  </dl>

  <h3>Season</h3>
  <dl class="spec">
    <dt>Period</dt><dd>半年ごと（4/1 と 10/1、日本時間）。ランキングは所有チップ数の順。</dd>
    <dt>Reset</dt><dd>シーズンの終わりに上位10人を Hall of Fame に記録し、全員のチップを ${fmt(START_CHIPS)} に戻す。フリーロールの回数も戻る。</dd>
  </dl>

  <h3>Chips</h3>
  <p>チップは無料のプレイマネーで、配布以外に増やす方法はありません。購入・換金・譲渡・景品との交換はできず、実際のお金や賞品を賭けることもできません。18歳以上の方を対象としています。</p>`;
  const seg = $('#multSeg');
  seg.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    $('#multTbl').innerHTML = multTable(b.dataset.k);
  };
  openDlg('#rulesDlg');
}
