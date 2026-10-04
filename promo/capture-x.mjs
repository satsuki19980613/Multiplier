// Three phone screenshots for the X post (390×844 at 3× = 1170×2532), played on the dev server with the fake backend:
//   1-wheel.png  the ×10,000 wheel right after it lands
//   2-table.png  the player's turn facing a bet, on the flop or later (Fold / Call / Raise)
//   3-win.png    the result after winning (shoves every hand from then on; plays again until it wins)
// npm run dev, then: node promo/capture-x.mjs   (THEME=light SHOTS=shots-light for the light theme)
import{mkdirSync}from'node:fs';
import{resolve}from'node:path';
import{pathToFileURL}from'node:url';
const mod=process.env.PLAYWRIGHT_MODULE??resolve(import.meta.dirname,'../../WWYD/node_modules/@playwright/test/index.mjs');
const{chromium}=await import(pathToFileURL(mod).href);
const THEME=process.env.THEME??'dark',OUT=resolve(import.meta.dirname,process.env.SHOTS??'shots'),MULT=process.env.MULT??'10000';
const URL=(process.env.APP_URL??'http://localhost:5180/')+`?fake&wait=400&mult=${MULT}`;
mkdirSync(OUT,{recursive:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const browser=await chromium.launch();
try{
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,hasTouch:true,isMobile:true,colorScheme:THEME});
  await ctx.addInitScript(t=>{try{localStorage.setItem('mp-theme',t)}catch{}},THEME);
  const page=await ctx.newPage();
  const shot=async name=>{await page.mouse.move(1,1);await page.screenshot({path:resolve(OUT,name+'.png')});console.log('saved',name)};
  const state=()=>page.evaluate(()=>{const b=a=>{const e=document.querySelector(`#dock [data-act="${a}"]`);return!!e&&!e.disabled};
    const w=document.querySelector('.wheel');
    return{wheel:!!w&&!w.hidden&&!!w.querySelector('.w-reel'),over:document.querySelector('#overDlg').open,
      overText:document.querySelector('#overDlg').open?document.querySelector('#overBody').textContent:'',
      fold:b('fold'),check:b('check'),call:b('call'),raise:b('raise'),sheet:!!document.querySelector('[data-act="rs-ok"]'),
      board:document.querySelectorAll('#boardC .card').length}});
  await page.goto(URL);await wait(1200);
  await page.click('#playBtn');await wait(500);
  await page.click('.stk-row[data-k="low"]');

  // 1. the wheel: once the prize has counted up to its final value
  for(let i=0;i<200;i++){
    const done=await page.evaluate(()=>{const w=document.querySelector('.wheel'),pv=document.querySelector('#wPv');return!!w&&w.classList.contains('rev')&&!!pv&&pv.textContent==='100,000'});
    if(done){await wait(250);await shot('1-wheel');break}
    await wait(60);
  }

  // 2. the table: check / call until facing a bet on the flop or later
  let tableShot=false,wins=false;
  for(let k=0;k<4000&&!wins;k++){
    const s=await state();
    if(s.wheel){await page.click('.wheel').catch(()=>{});await wait(500);continue}   // later games: skip the wheel
    if(s.over){
      if(/Winner/.test(s.overText)){await wait(1600);await shot('3-win');wins=true;break}
      await page.click('#overBody [data-act="again"]').catch(()=>{});await wait(800);continue;
    }
    if(s.sheet){ // the raise sheet: all-in
      await page.evaluate(()=>{const q=[...document.querySelectorAll('.quick button')];if(q.length)q[q.length-1].click()});await wait(200);
      await page.click('[data-act="rs-ok"]').catch(()=>{});await wait(500);continue;
    }
    if(s.fold||s.check){
      if(!tableShot){
        if(s.fold&&s.raise&&s.board>=3){await wait(1100);await shot('2-table');tableShot=true;continue}
        await page.click(`#dock [data-act="${s.check?'check':'call'}"]`).catch(()=>{});await wait(500);continue;
      }
      // 3. after the table shot: shove every hand
      if(s.raise){await page.click('#dock [data-act="raise"]').catch(()=>{});await wait(400);continue}
      await page.click(`#dock [data-act="${s.call?'call':'check'}"]`).catch(()=>{});await wait(500);continue;
    }
    await wait(200);
  }
  if(!wins)console.log('no win in time');
}finally{await browser.close()}
