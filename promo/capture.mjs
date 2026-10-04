// Real screenshots of the app for the X post: the ×10,000 wheel (a burst of frames, pick the best) and the table.
// npm run dev, then: node promo/capture.mjs   (Playwright from the WWYD checkout, like grid-holdem/promo/capture.mjs)
import{mkdirSync}from'node:fs';
import{resolve}from'node:path';
import{pathToFileURL}from'node:url';
const mod=process.env.PLAYWRIGHT_MODULE??resolve(import.meta.dirname,'../../WWYD/node_modules/@playwright/test/index.mjs');
const{chromium}=await import(pathToFileURL(mod).href);
const THEME=process.env.THEME??'dark',OUT=resolve(import.meta.dirname,process.env.SHOTS??'shots'),MULT=process.env.MULT??'10000';
const URL=(process.env.APP_URL??'http://localhost:5180/')+`?fake&wait=400&mult=${MULT}`;
mkdirSync(resolve(OUT,'frames'),{recursive:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const browser=await chromium.launch();
try{
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,hasTouch:true,isMobile:true,colorScheme:THEME});
  await ctx.addInitScript(t=>{try{localStorage.setItem('mp-theme',t)}catch{}},THEME);
  const page=await ctx.newPage();
  await page.goto(URL);await wait(1200);
  await page.click('#playBtn');await wait(500);
  await page.click('.stk-row[data-k="low"]');
  // the wheel: one frame every 150 ms until it closes
  let seen=false;
  for(let i=0;i<120;i++){
    const on=await page.evaluate(()=>{const w=document.querySelector('.wheel');return!!w&&!w.hidden&&!!w.querySelector('.w-reel')});
    if(on){seen=true;await page.screenshot({path:resolve(OUT,'frames',`w-${String(i).padStart(3,'0')}.png`)})}
    else if(seen)break;
    await wait(150);
  }
  // the table: the player's turn on the flop or later (call / check through earlier streets)
  for(let k=0;k<1200;k++){
    const s=await page.evaluate(()=>{const b=a=>{const e=document.querySelector(`#dock [data-act="${a}"]`);return!!e&&!e.disabled};
      return{fold:b('fold'),check:b('check'),call:b('call'),board:document.querySelectorAll('#boardC .card').length,over:!!document.querySelector('#dock [data-act="result"]')}});
    if(s.over)break;
    if(s.fold||s.check){
      if(s.board>=3){await wait(1200);await page.screenshot({path:resolve(OUT,'table.png')});console.log('saved table, board',s.board);break}
      await page.click(`#dock [data-act="${s.check?'check':'call'}"]`).catch(()=>{});await wait(600);continue;
    }
    await wait(250);
  }
}finally{await browser.close()}
