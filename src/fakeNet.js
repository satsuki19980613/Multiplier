// Development only (npm run dev, http://localhost:5180/?fake): a stand-in for the backend so every screen can be checked without
// signing in or running a server. The real table rules (server/game/rules.js) and the real bot (src/bot.js) run here in the browser.
// Same exports as net.js: online, onSessionLost, currentUser, signIn, signOut, rpc, game.
// Options (query string):
//   &wait=ms   how long until bots fill the table (default 2000; the real value is BOT_WAIT_MS = 15000)
//   &chips=n   starting balance (default 10000). e.g. &chips=5 to see the free-roll
//   &mult=n    fix the prize multiplier (e.g. &mult=100 to check the big-prize wheel). The free-roll has no multiplier.
//   &idle      the bots never move (the human's turn clock / sit-out can be checked)
import{
  MoveError,STAKE_KEYS,botName,buyInOf,checkEntry,shuffle,createTable,applyRequest,tick,viewsOf,commit,
}from'../server/game/rules.js';
import{actor}from'./engine.js';
import{botMove,PERSONAS}from'./bot.js';
import{FREEROLL,seasonOf}from'./spin.js';

const q=new URLSearchParams(location.search);
const WAIT=q.has('wait')?Math.max(0,+q.get('wait')||0):2000;
const MULT=q.has('mult')?Math.round(+q.get('mult')):null;
const IDLE=q.has('idle');

const me={nickname:'Satsuki',chips:q.has('chips')?Math.max(0,Math.round(+q.get('chips')||0)):10000,played:0};
const fr={day:'',used:0};
let Q=null;   // { stake, since }
let G=null;   // { id, seat, game: { state, meta }, views, status }

const lag=v=>new Promise(r=>setTimeout(()=>r(structuredClone(v)),100+Math.random()*120));
const jstDay=()=>new Date(Date.now()+9*3600*1000).toISOString().slice(0,10);
const frUsed=()=>fr.day===jstDay()?fr.used:0;
const season=()=>{const s=seasonOf(new Date());return{id:s.id,endsAt:+new Date(s.endsAt)}};
// the table the player is still playing at (once eliminated, the player is free to queue again)
const active=()=>G&&G.status==='active'&&G.game.state.places[G.seat]===null?G:null;

export const online=true;
export const onSessionLost=()=>{};
export async function currentUser(){return{id:'fake-user'}}
export async function signIn(){}
export async function signOut(){}

function store(game,step,seat){
  const out=commit(game,step);
  if(out.payouts){
    me.chips+=out.payouts[seat];me.played++;
    const after=[null,null,null];after[seat]=me.chips;
    out.meta.result={...out.meta.result,after};
  }
  G.game={state:out.state,meta:out.meta};
  G.views=viewsOf(out.state,out.meta);
  if(out.state.over)G.status='over';
}
const reply=()=>({ver:G.game.state.ver,now:Date.now(),view:structuredClone(G.views[G.seat])});

function makeTable(stake){
  const rnd=Math.random,botPersonas=shuffle(PERSONAS,rnd).slice(0,2);
  const players=shuffle([{uid:'me',name:me.nickname,bot:null},...botPersonas.map(p=>({uid:null,name:botName(p),bot:{persona:p}}))],rnd);
  const t=createTable({players,stake,now:Date.now(),rnd,forceMultiplier:MULT||null});
  if(stake==='free'){fr.day=jstDay();fr.used=frUsed()+1}else me.chips-=buyInOf(stake);
  G={id:crypto.randomUUID(),seat:players.findIndex(p=>p.uid==='me'),game:t,views:null,status:'active'};
  G.views=viewsOf(t.state,t.meta);
  Q=null;
  return G.id;
}

const waiting=stake=>{const w={low:0,mid:0,high:0,free:0};if(stake)w[stake]=1;return w};

const NAMES=['Kei','Mio','Ren','Aoi','Sora','Hina','Yuto','Nana','Haru','Riku','Mei','Sho'];
function rankingRows(){
  const rows=NAMES.map((n,i)=>({nickname:n,chips:Math.round(190000/(i+1)**0.8+3000)}));
  if(me.played)rows.push({nickname:me.nickname,chips:me.chips,me:true});
  rows.sort((a,b)=>b.chips-a.chips);rows.forEach((r,i)=>r.rank=i+1);
  return rows;
}

export async function rpc(name,args={}){
  if(name==='me'){
    const used=frUsed();
    return lag({nickname:me.nickname,chips:me.chips,freeroll:{used,left:Math.max(0,FREEROLL.perDay-used),eligible:me.chips<FREEROLL.eligibleBelow&&used<FREEROLL.perDay},
      game:active()?G.id:null,season:season()});
  }
  if(name==='set_nickname'){
    const v=String(args.p_name??'').trim();
    if(!v||[...v].length>16||v.includes('🤖'))throw new MoveError('nickname_invalid');
    if(NAMES.some(n=>n.toLowerCase()===v.toLowerCase()))throw new MoveError('nickname_taken');
    me.nickname=v;return lag({nickname:v});
  }
  if(name==='game_poll'){
    if(!G||args.p_game!==G.id)throw new MoveError('not_found');
    const ver=G.game.state.ver;
    return lag({ver,now:Date.now(),view:ver>(args.p_ver??-1)?G.views[G.seat]:null});
  }
  if(name==='ranking'){
    const rows=rankingRows();
    return lag({season:season(),top:rows,me:rows.find(r=>r.me)||null});
  }
  if(name==='hall_of_fame'){
    const mk=(off)=>NAMES.slice(0,10).map((n,i)=>({rank:i+1,nickname:n,chips:Math.round((520000-off)/(i+1)**0.9)}));
    return lag([{season:'2026-H1',top:mk(0)},{season:'2025-H2',top:mk(90000)}]);
  }
  throw new MoveError('unknown_rpc');
}

export async function game(body){
  await lag(null);
  switch(body.op){
    case'queue':{
      if(!STAKE_KEYS.includes(body.stake))throw new MoveError('illegal');
      if(active())return{waiting:waiting(null),since:null,game:G.id,now:Date.now()};
      checkEntry({chips:me.chips,frUsedToday:frUsed()},body.stake);
      if(!Q||Q.stake!==body.stake)Q={stake:body.stake,since:Date.now()};
      if(Date.now()-Q.since>=WAIT)return{waiting:waiting(null),since:null,game:makeTable(body.stake),now:Date.now()};
      return{waiting:waiting(body.stake),since:Q.since,game:null,now:Date.now()};
    }
    case'leave':Q=null;return{ok:true};
    case'act':case'tick':{
      if(!G||body.game!==G.id)throw new MoveError('not_found');
      if(G.status!=='active')throw new MoveError('game_over');
      const cur={state:G.game.state,meta:G.game.meta};
      let step;
      if(body.op==='act')step=applyRequest(cur,G.seat,{op:'act',ver:body.ver,move:body.move},Date.now());
      else{
        if(IDLE&&G.game.meta.bots[actor(cur.state)])throw new MoveError('not_yet');
        step=tick(cur,Date.now(),{botMove,rnd:Math.random});
      }
      store(cur,step,G.seat);
      return reply();
    }
  }
  throw new MoveError('illegal');
}
