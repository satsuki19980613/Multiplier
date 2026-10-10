// Read-only check of the production servers (GitHub Actions "Live", .github/workflows/live.yml). Nothing is written.
//   node scripts/live-check.mjs
// Env: SITE (https://multiplier-poker.pages.dev), DATA_URL, GAME_URL (VITE_NEON_DATA_API_URL / VITE_GAME_URL of .env.production)
// GitHub's runners are outside Japan, so the site must answer with the Japan-only notice (functions/_middleware.js) and its
// security headers. That notice is also what Mozilla HTTP Observatory sees.
import{appendFileSync}from'node:fs';

const env=n=>{const v=process.env[n];if(!v){console.error(`環境変数 ${n} が必要です`);process.exit(2)}return v.replace(/\/+$/,'')};
const results=[];let failed=0;
function check(name,ok,detail=''){
  results.push({name,ok,detail});if(!ok)failed++;
  console.log(`${ok?'ok  ':'NG  '} ${name}${detail?` — ${detail}`:''}`);
}
async function get(url,init={}){
  const r=await fetch(url,{redirect:'manual',...init});
  const body=await r.text();
  let json=null;try{json=JSON.parse(body)}catch{/* not json */}
  return{status:r.status,headers:r.headers,body,json};
}
function summary(title){
  const lines=[`### ${title}`,'',`${results.length-failed} / ${results.length} 件 OK`,'','| 確認 | 結果 | 詳細 |','|---|---|---|',
    ...results.map(r=>`| ${r.name} | ${r.ok?'OK':'**NG**'} | ${String(r.detail).replace(/[\\|]/g,'\\$&').replace(/\n/g,' ').slice(0,200)} |`),''];
  console.log(lines.join('\n'));
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
}
const FAKE_JWT='Bearer eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ4In0.AAAA';

async function prod(){
  const SITE=env('SITE'),DATA=env('DATA_URL'),GAME=env('GAME_URL')+'/';

  // site (from outside Japan)
  const top=await get(SITE+'/');
  check('日本国外からのサイト / は 403（国内限定）',top.status===403&&/only from Japan/.test(top.body),`${top.status}`);
  const h=n=>top.headers.get(n)||'';
  check('CSP が default-src \'none\' でスクリプトを許さない',/default-src 'none'/.test(h('content-security-policy'))&&!/script-src/.test(h('content-security-policy')),h('content-security-policy'));
  check('CSP で他サイトに埋め込めない（frame-ancestors \'none\'）',/frame-ancestors 'none'/.test(h('content-security-policy')));
  check('Strict-Transport-Security',/max-age=\d{8,}/.test(h('strict-transport-security')),h('strict-transport-security'));
  check('X-Content-Type-Options: nosniff',h('x-content-type-options')==='nosniff');
  check('Referrer-Policy',h('referrer-policy')==='strict-origin-when-cross-origin',h('referrer-policy'));
  check('Cross-Origin-Opener-Policy',h('cross-origin-opener-policy')==='same-origin',h('cross-origin-opener-policy'));
  check('Permissions-Policy',h('permissions-policy')!=='',h('permissions-policy'));
  check('Cookie を出さない',top.headers.getSetCookie().length===0);
  const http=await get(SITE.replace(/^https:/,'http:')+'/');
  check('http は https へ転送される',http.status>=300&&http.status<400&&/^https:/.test(http.headers.get('location')||''),`${http.status} ${http.headers.get('location')}`);
  const auth=await get(SITE+'/api/auth/ok');
  check('ログイン中継 /api/auth も日本国外は 403',auth.status===403,`${auth.status}`);

  // Function "game": CORS and sign-in
  const pre=await get(GAME,{method:'OPTIONS',headers:{Origin:SITE,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}});
  check('Function の preflight がサイトを許す',pre.status===204&&pre.headers.get('access-control-allow-origin')===SITE,`${pre.status} ${pre.headers.get('access-control-allow-origin')}`);
  const evil=await get(GAME,{method:'OPTIONS',headers:{Origin:'https://evil.example','Access-Control-Request-Method':'POST'}});
  check('Function の preflight がほかのサイトを許さない',!evil.headers.get('access-control-allow-origin'),`${evil.headers.get('access-control-allow-origin')}`);
  const g0=await get(GAME,{method:'POST',headers:{Origin:SITE,'Content-Type':'application/json'},body:'{"op":"leave"}'});
  check('Function はトークン無しを 401 で断る',g0.status===401&&g0.json?.error==='not_authenticated',`${g0.status} ${g0.body.slice(0,80)}`);
  const g1=await get(GAME,{method:'POST',headers:{Origin:SITE,'Content-Type':'application/json',Authorization:FAKE_JWT},body:'{"op":"leave"}'});
  check('Function は偽のトークンを 401 で断る',g1.status===401,`${g1.status}`);
  const g2=await get(GAME,{headers:{Origin:SITE}});
  check('Function は POST 以外を 405 で断る',g2.status===405,`${g2.status}`);

  // Data API: sign-in, and the tables are not readable directly
  const d0=await get(DATA+'/rpc/me',{method:'POST',headers:{Origin:SITE,'Content-Type':'application/json'},body:'{}'});
  check('Data API はトークン無しを断る（4xx）',d0.status>=400&&d0.status<500,`${d0.status} ${d0.body.slice(0,160)}`);
  const d1=await get(DATA+'/rpc/me',{method:'POST',headers:{Origin:SITE,'Content-Type':'application/json',Authorization:FAKE_JWT},body:'{}'});
  check('Data API は偽のトークンを断る（4xx）',d1.status>=400&&d1.status<500,`${d1.status} ${d1.body.slice(0,160)}`);
  for(const t of['profiles','games','queue','rooms','seasons','hall_of_fame']){
    const r=await get(`${DATA}/${t}?select=*&limit=1`,{headers:{Origin:SITE}});
    check(`Data API で表 ${t} を直接読めない`,r.status>=400,`${r.status} ${r.body.slice(0,100)}`);
  }
  summary('本番の通信確認（日本国外から・読み取りだけ）');
}

try{await prod()}
catch(e){check('実行',false,e.message);summary('本番の通信確認（途中で止まった）')}
process.exit(failed?1:0);
