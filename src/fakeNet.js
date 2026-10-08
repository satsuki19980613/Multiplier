// Development only (npm run dev, http://localhost:5180/?fake): a stand-in for the backend so every screen can be checked without
// signing in or running a server. The real table rules (server/game/rules.js) and the real bot (src/bot.js) run here in the browser.
// Same exports as net.js: online, onSessionLost, currentUser, signIn, signOut, rpc, game.
// Options (query string):
//   &wait=ms   how long until bots fill the table (default 2000; the real value is BOT_WAIT_MS = 15000)
//   &chips=n   starting balance (default 10000). e.g. &chips=5 to see the free-roll
//   &mult=n    fix the prize multiplier (e.g. &mult=100 to check the big-prize wheel). The free-roll has no multiplier.
//   &idle      the bots never move (the human's turn clock / sit-out can be checked)
//   &friend=ms private tables: how long until each simulated friend joins (default 3000). Two friends join a room you make (the
//              third player starts it). Any code joins a room of Mio's (MID) where one more friend comes later; 000000 is not found.
//              The friends are played by the bot but shown as people. Most of them have a winner GIF (the local samples of src/fxDemo.js);
//              after the end they stay for a rematch, and they answer a chat message now and then.
import{
  MoveError,STAKE_KEYS,buyInOf,checkEntry,seatPlayers,shuffle,createTable,applyRequest,tick,viewsOf,commit,
  finishedHands,rematchSeats,rematchStarted,rematchLeader,rematchOpen,postChat,
}from'../server/game/rules.js';
import{ROOM_STAKES,genCode,newRoom,joinRoom,touchRoom,leaveRoom,startReady,roomView,roomPeek,roomHumans}from'../server/game/rooms.js';
import{recordOf}from'./tview.js';
import{DEMO_SLUGS}from'./fxDemo.js';
import{actor}from'./engine.js';
import{botMove,PERSONAS}from'./bot.js';
import{FREEROLL,seasonOf}from'./spin.js';

const q=new URLSearchParams(location.search);
const WAIT=q.has('wait')?Math.max(0,+q.get('wait')||0):2000;
const MULT=q.has('mult')?Math.round(+q.get('mult')):null;
const IDLE=q.has('idle');
const FRIEND=q.has('friend')?Math.max(0,+q.get('friend')||0):3000;

const me={nickname:'Satsuki',chips:q.has('chips')?Math.max(0,Math.round(+q.get('chips')||0)):10000,played:0};
const fr={day:'',used:0};
let Q=null;   // { stake, since }
let G=null;   // the current table: { id, seat, game: { state, meta }, views, status, friends: [seats], hands: [{ rec, holes }], chat: [], endAt }
const GAMES=new Map();   // every table of this page (id -> G): the history and an old table after a rematch stay readable
let R=null;   // a private room: rooms.js room + { due: [{ at, uid, name }] } (friends still to come)

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

function store(game,step,seat,T=G){
  const out=commit(game,step);
  for(const h of finishedHands(game.state,out.state))T.hands.push({rec:recordOf(h),holes:h.hole.map(x=>(x?x.slice():null))});
  if(out.payouts){
    me.chips+=out.payouts[seat];me.played++;
    const after=[null,null,null];after[seat]=me.chips;
    out.meta.result={...out.meta.result,after};
  }
  T.game={state:out.state,meta:out.meta};
  T.views=views(T);
  if(out.state.over&&T.status!=='over'){T.status='over';T.endAt=Date.now()}
}
const reply=(T=G)=>({ver:T.game.state.ver,now:Date.now(),view:structuredClone(T.views[T.seat])});
// the friends of a private table are played by the bot here, but are people on the real server: show them as such
function views(T=G){
  const vs=viewsOf(T.game.state,T.game.meta);
  for(const v of vs)for(const s of T.friends)v.meta.bot[s]=false;
  return vs;
}
const tableOf=id=>{const T=GAMES.get(id);if(!T)throw new MoveError('not_found');return T};

// after the end of a private table the friends stay (FRIEND ms later); a friend who leads starts the rematch once I stay.
// (The friends are bots in meta here, so their steps are made directly instead of through applyRequest, which only takes people.)
function friendStep(T,patch){const g=structuredClone(T.game.state);g.ver++;store(T.game,{state:g,clock:T.game.meta.clock,meta:patch},T.seat,T)}
function friendsAfterEnd(T){
  const rm=T.game.meta.rematch;
  if(!rm||!rematchOpen(rm,Date.now())||Date.now()-T.endAt<FRIEND)return;
  for(const s of T.friends)if(!rm.stay.includes(s)&&!rm.gone.includes(s)){friendStep(T,{rematch:{...rm,stay:[...rm.stay,s]}});return}
  const lead=rematchLeader(T.game.meta.rematch,Date.now());
  if(lead!=null&&lead!==T.seat&&T.game.meta.rematch.stay.includes(T.seat)&&Date.now()-T.endAt>FRIEND*2)startRematch(T,lead);
}
function startRematch(T,by){
  const rm=T.game.meta.rematch,m=T.game.meta;
  const seats=T.friends.includes(by)?(rematchOpen(rm,Date.now())?[...new Set([...rm.stay,by])]:[]):rematchSeats(T.game,by,Date.now());
  if(seats.length<2)throw new MoveError('not_enough');
  if(seats.includes(T.seat))checkEntry({chips:me.chips,frUsedToday:0},m.stake);
  const friends=seats.filter(s=>s!==T.seat).map(s=>({uid:'f'+s,name:T.game.state.names[s],fx:m.fx?m.fx[s]:null,host:s===by}));
  const id=makeTable(m.stake,friends,m.room,{fx:m.fx?m.fx[T.seat]:null,host:by===T.seat},!seats.includes(T.seat));
  if(T.friends.includes(by))friendStep(T,{rematch:{...rm,next:{id,seats}}});else store(T.game,rematchStarted(T.game,id,seats),T.seat,T);
  return id;
}
const LINES=['nice hand','gg','👀','もう一回！','強すぎ','それはずるい','ナイス'];
function friendChat(T){
  if(!T.friends.length||Math.random()<0.4)return;
  setTimeout(()=>{const s=T.friends[Math.floor(Math.random()*T.friends.length)];T.chat.push({seq:T.chat.length+1,seat:s,text:LINES[Math.floor(Math.random()*LINES.length)],at:Date.now()})},1200+Math.random()*1500);
}

// friends: the other people of a private table ([{ uid, name, fx?, host? }]); room: its code; mine: { fx, host } of my seat on a private table.
// A friend without a GIF of their own gets one of the local samples 3 times in 4. away = I am not at the new table (a rematch without me: not used)
function makeTable(stake,friends=[],room=null,mine={},away=false){
  const rnd=Math.random;
  const players=seatPlayers([{uid:'me',name:me.nickname,fx:mine.fx??null,host:!!mine.host},
    ...friends.map(f=>({...f,fx:f.fx!==undefined?f.fx:rnd()<0.75?DEMO_SLUGS[Math.floor(rnd()*DEMO_SLUGS.length)]:null}))],rnd,PERSONAS);
  const fp=shuffle(PERSONAS,rnd);
  const fseats=players.map((p,i)=>p.uid&&p.uid!=='me'?i:-1).filter(i=>i>=0);
  fseats.forEach((s,i)=>{players[s]={...players[s],bot:{persona:fp[i%fp.length]}}});
  const t=createTable({players,stake,now:Date.now(),rnd,room,forceMultiplier:MULT||null});
  // the friends are bots under the hood, and createTable gives bots no GIF: put theirs back (a private table only)
  if(t.meta.fx)fseats.forEach(s=>{t.meta.fx[s]=players[s].fx??null});
  if(!away){if(stake==='free'){fr.day=jstDay();fr.used=frUsed()+1}else me.chips-=buyInOf(stake)}
  G={id:crypto.randomUUID(),seat:players.findIndex(p=>p.uid==='me'),game:t,views:null,status:'active',friends:fseats,hands:[],chat:[],endAt:0};
  G.views=views();
  GAMES.set(G.id,G);
  Q=null;
  return G.id;
}

/* ---------- private tables ---------- */
const FRIENDS=['Kei','Mio','Ren','Aoi','Sora','Hina'];
function roomNow(){
  const now=Date.now();
  for(const d of R.due.filter(d=>d.at<=now)){R.due=R.due.filter(x=>x!==d);try{Object.assign(R,joinRoom(R,d.uid,d.name,now))}catch{/* full or closed */}}
  for(const m of R.members)if(m.uid!=='me')m.seenAt=now;   // the friends keep polling
}
function roomStart(auto){
  if(R.status!=='waiting'||!startReady(R,'me',Date.now(),{auto}))return;
  checkEntry({chips:me.chips,frUsedToday:0},R.stake);
  const hs=roomHumans(R),mine=hs.find(h=>h.uid==='me');
  R.game=makeTable(R.stake,hs.filter(h=>h.uid!=='me').map(h=>({...h,fx:h.fx??undefined})),R.code,{fx:mine.fx,host:mine.host});
  R.status='started';R.due=[];
}
const roomReply=()=>({room:roomView(R,'me',Date.now()),now:Date.now()});
function roomFor(code){
  // any code but 000000 is a room of Mio's that one more friend joins later
  if(code==='000000')return null;
  const now=Date.now();
  return{...newRoom({id:crypto.randomUUID(),code,stake:'mid',uid:'f-host',name:'Mio',now,fx:DEMO_SLUGS[0]}),due:[{at:now+FRIEND*2,uid:'f2',name:'Kei'}]};
}
function noRoomGame(){if(active())throw new MoveError('in_game',{game:G.id})}

const waiting=stake=>{const w=Object.fromEntries(STAKE_KEYS.map(k=>[k,0]));if(stake)w[stake]=1;return w};

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
      game:active()?G.id:null,season:season(),recent:[...GAMES.keys()].reverse().map(id=>({id}))});
  }
  if(name==='set_nickname'){
    const v=String(args.p_name??'').trim();
    if(!v||[...v].length>16||v.includes('🤖'))throw new MoveError('nickname_invalid');
    if(NAMES.some(n=>n.toLowerCase()===v.toLowerCase()))throw new MoveError('nickname_taken');
    me.nickname=v;return lag({nickname:v});
  }
  if(name==='game_poll'){
    const T=tableOf(args.p_game);
    if(T.status==='over')friendsAfterEnd(T);
    const ver=T.game.state.ver;
    return lag({ver,now:Date.now(),view:ver>(args.p_ver??-1)?T.views[T.seat]:null,chat:T.chat.length});
  }
  if(name==='game_hands'){
    const T=tableOf(args.p_game);
    return lag(T.hands.filter(h=>h.rec.handNo>(args.p_after??0)).slice(0,200).map(h=>({...h.rec,hole:h.holes[T.seat]})));
  }
  if(name==='game_chat'){
    const T=tableOf(args.p_game);
    if(!T.game.meta.room)return lag([]);
    return lag(T.chat.filter(m=>m.seq>(args.p_after??0)).slice(-200));
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
    case'room_create':{
      if(!ROOM_STAKES.includes(body.stake))throw new MoveError('illegal');
      noRoomGame();checkEntry({chips:me.chips,frUsedToday:0},body.stake);
      const now=Date.now(),names=shuffle(FRIENDS,Math.random);
      R={...newRoom({id:crypto.randomUUID(),code:genCode(Math.random),stake:body.stake,uid:'me',name:me.nickname,now,fx:body.fx??null}),
        due:[{at:now+FRIEND,uid:'f1',name:names[0]},{at:now+FRIEND*2,uid:'f2',name:names[1]}]};
      Q=null;return roomReply();
    }
    case'room_peek':{
      if(R&&R.code===body.code)return{room:roomPeek(R,'me',Date.now()),now:Date.now()};
      const r=roomFor(body.code);
      return{room:r&&roomPeek(r,'me',Date.now()),now:Date.now()};
    }
    case'room_join':{
      const r=R&&R.code===body.code&&R.status==='waiting'?R:roomFor(body.code);
      if(!r)throw new MoveError('not_found');
      noRoomGame();checkEntry({chips:me.chips,frUsedToday:0},r.stake);
      R={...joinRoom(r,'me',me.nickname,Date.now(),body.fx),due:r.due};
      roomNow();roomStart(true);
      return roomReply();
    }
    case'room_wait':case'room_start':{
      if(!R||body.room!==R.id)throw new MoveError('not_found');
      if(R.status==='waiting')roomNow();
      R={...touchRoom(R,'me',Date.now()),due:R.due};
      roomStart(body.op==='room_wait');
      return roomReply();
    }
    case'room_leave':{
      if(R&&body.room===R.id)R={...leaveRoom(R,'me',Date.now()),due:[]};
      return{ok:true};
    }
    case'act':case'tick':case'retire':case'sitout':case'sitin':{
      const T=tableOf(body.game);
      if(T.status!=='active')throw new MoveError('game_over');
      const cur={state:T.game.state,meta:T.game.meta};
      let step;
      if(body.op==='act')step=applyRequest(cur,T.seat,{op:'act',ver:body.ver,move:body.move},Date.now());
      else if(body.op==='tick'){
        if(IDLE&&T.game.meta.bots[actor(cur.state)])throw new MoveError('not_yet');
        step=tick(cur,Date.now(),{botMove,rnd:Math.random});
      }else step=applyRequest(cur,T.seat,{op:body.op},Date.now());
      store(cur,step,T.seat,T);
      return reply(T);
    }
    case'fx':case'stay':case'depart':{
      const T=tableOf(body.game);
      store(T.game,applyRequest(T.game,T.seat,{op:body.op,fx:body.fx},Date.now()),T.seat,T);
      return reply(T);
    }
    case'rematch':{
      const T=tableOf(body.game);
      return{game:startRematch(T,T.seat),now:Date.now()};
    }
    case'chat':{
      const T=tableOf(body.game),mine=T.chat.filter(m=>m.seat===T.seat).at(-1);
      const text=postChat(T.game,T.seat,body.text,mine?mine.at:null,Date.now());
      const msg={seq:T.chat.length+1,seat:T.seat,text,at:Date.now()};
      T.chat.push(msg);friendChat(T);
      return{now:Date.now(),msg};
    }
  }
  throw new MoveError('illegal');
}
