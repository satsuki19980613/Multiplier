// Private tables: room rules (server/game/rooms.js), the HTTP routing of the room ops, and the fakeNet flow.
import{test}from'node:test';
import assert from'node:assert/strict';
import{MoveError,createTable,seatPlayers,viewsOf}from'../server/game/rules.js';
import{
  ROOM_SEATS,ROOM_AWAY_MS,ROOM_GONE_MS,ROOM_TTL_MS,ROOM_STAKES,CODE_RE,
  genCode,newRoom,joinRoom,touchRoom,leaveRoom,prune,startReady,roomView,roomPeek,
}from'../server/game/rooms.js';
import{PERSONAS}from'../src/bot.js';
import{createHandler}from'../server/game/handler.js';

const T0=1_700_000_000_000;
const errCode=f=>{try{f()}catch(e){return e.code}return null};
const mk=(now=T0)=>newRoom({id:'r1',code:'123456',stake:'mid',uid:'h',name:'Host',now});

test('genCode: always 6 digits; private tables take the paid stakes only',()=>{
  for(const x of[0,0.5,0.999999999,1-1e-12,0.000001])assert.match(genCode(()=>x),CODE_RE);
  assert.equal(genCode(()=>0),'000000');
  assert.deepEqual(ROOM_STAKES,['low','mid','high','ultra','extreme']);
  assert.equal(errCode(()=>newRoom({id:'r',code:'111111',stake:'free',uid:'h',name:'H',now:T0})),'illegal');
});

test('join: up to three, idempotent for a member, refused when full or closed; the argument is not mutated',()=>{
  const r0=mk(),before=JSON.stringify(r0);
  let r=joinRoom(r0,'a','A',T0+1000);
  assert.equal(JSON.stringify(r0),before);
  assert.deepEqual(r.members.map(m=>m.uid),['h','a']);
  r=joinRoom(r,'a','A2',T0+2000);assert.equal(r.members.length,2);assert.equal(r.members[1].name,'A2');
  r=joinRoom(r,'b','B',T0+2000);assert.equal(r.members.length,ROOM_SEATS);
  assert.equal(errCode(()=>joinRoom(r,'c','C',T0+2000)),'room_full');
  const closed=leaveRoom(r,'h',T0+2000);assert.equal(closed.status,'closed');
  assert.equal(errCode(()=>joinRoom(closed,'c','C',T0+2000)),'room_closed');
});

test('prune: away members stay, gone members are dropped; the host gone or the TTL passed closes the room',()=>{
  let r=joinRoom(mk(),'a','A',T0);
  r=touchRoom(r,'h',T0+ROOM_GONE_MS-1);   // the host keeps polling, a stops
  assert.deepEqual(prune(r,T0+ROOM_GONE_MS).members.map(m=>m.uid),['h'],'a is gone');
  assert.deepEqual(prune(r,T0+ROOM_AWAY_MS).members.map(m=>m.uid),['h','a'],'a is only away');
  assert.equal(prune(mk(),T0+ROOM_GONE_MS).status,'closed','the host gone');
  let k=mk();for(let t=T0;t<T0+ROOM_TTL_MS;t+=ROOM_AWAY_MS/2)k=touchRoom(k,'h',t);
  assert.equal(prune(k,T0+ROOM_TTL_MS).status,'closed','expired');
  assert.equal(errCode(()=>touchRoom(r,'z',T0)),'not_found');
  assert.equal(errCode(()=>touchRoom(r,'a',T0+ROOM_GONE_MS)),'not_found','a dropped member is out');
});

test('leave: a member leaves, the host closes; a started room is not changed',()=>{
  let r=joinRoom(joinRoom(mk(),'a','A',T0),'b','B',T0);
  assert.deepEqual(leaveRoom(r,'a',T0).members.map(m=>m.uid),['h','b']);
  assert.equal(leaveRoom(r,'h',T0).status,'closed');
  const s={...r,status:'started',game:'g1'};
  assert.deepEqual(leaveRoom(s,'h',T0),s);
});

test('startReady: full + everybody here starts by itself; the host may start with two; somebody away waits',()=>{
  const two=joinRoom(mk(),'a','A',T0),three=joinRoom(two,'b','B',T0);
  assert.equal(startReady(two,'a',T0,{auto:true}),false);
  assert.equal(startReady(three,'a',T0,{auto:true}),true);
  assert.equal(startReady(three,'a',T0+ROOM_AWAY_MS,{auto:true}),false,'nobody polled for ROOM_AWAY_MS: wait');
  assert.equal(startReady(two,'h',T0),true);
  assert.equal(errCode(()=>startReady(two,'a',T0)),'not_host');
  assert.equal(errCode(()=>startReady(mk(),'h',T0)),'not_enough');
  assert.equal(errCode(()=>startReady(two,'h',T0+ROOM_AWAY_MS)),'away');
  assert.equal(errCode(()=>startReady({...two,status:'closed'},'h',T0)),'room_closed');
});

test('views: the lobby shows names, host, me, away and the game only to members; the peek shows no uids',()=>{
  let r=joinRoom(mk(),'a','A',T0+ROOM_AWAY_MS);
  const v=roomView(r,'a',T0+ROOM_AWAY_MS);
  assert.deepEqual(v.members,[{name:'Host',host:true,me:false,away:true},{name:'A',host:false,me:true,away:false}]);
  assert.equal(v.isHost,false);assert.equal(v.host,'Host');assert.equal(v.code,'123456');assert.equal(v.expiresAt,T0+ROOM_TTL_MS);
  assert.equal(v.game,null);
  r={...r,status:'started',game:'g1'};
  assert.equal(roomView(r,'a',T0).game,'g1');assert.equal(roomView(r,'z',T0).game,null);
  const p=roomPeek(r,'z',T0);
  assert.deepEqual(p,{code:'123456',stake:'mid',status:'started',host:'Host',seated:2,seats:3,member:false});
  assert.ok(!JSON.stringify(p).includes('"h"'));
});

test('seatPlayers: the humans and bots for the empty seats; a private table carries its code to every view',()=>{
  let n=0;const rnd=()=>((n=(n*9301+49297)%233280)/233280);
  const pl=seatPlayers([{uid:'h',name:'Host'},{uid:'a',name:'A'}],rnd,PERSONAS);
  assert.equal(pl.length,3);
  assert.deepEqual(pl.filter(p=>p.uid).map(p=>p.name).sort(),['A','Host']);
  assert.equal(pl.filter(p=>p.bot).length,1);
  const t=createTable({players:pl,stake:'mid',now:T0,rnd,room:'123456'});
  assert.equal(t.meta.room,'123456');
  assert.ok(viewsOf(t.state,t.meta).every(v=>v.meta.room==='123456'));
  assert.equal(createTable({players:pl,stake:'mid',now:T0,rnd}).meta.room,null,'tables from the queue have none');
});

// ---- HTTP ----
const U='00000000-0000-4000-8000-000000000001',RID='00000000-0000-4000-8000-0000000000aa';
const calls=[];
const handler=createHandler({
  allowedOrigins:[],verifyToken:async t=>t==='good'?U:null,logError:()=>{},
  roomCreate:async(uid,stake)=>{calls.push(['roomCreate',uid,stake]);if(stake==='extreme')throw new MoveError('insufficient_chips');return{room:{id:RID}}},
  roomPeek:async(uid,code)=>{calls.push(['roomPeek',uid,code]);return{room:null}},
  roomJoin:async(uid,code)=>{calls.push(['roomJoin',uid,code]);if(code==='999999')throw new MoveError('room_full');if(code==='888888')throw new MoveError('in_game',{game:RID});return{room:{id:RID}}},
  roomWait:async(uid,room)=>{calls.push(['roomWait',uid,room]);return{room:{id:room}}},
  roomStart:async(uid,room)=>{calls.push(['roomStart',uid,room]);throw new MoveError('away')},
  roomLeave:async(uid,room)=>{calls.push(['roomLeave',uid,room]);return{ok:true}},
});
const req=body=>handler(new Request('https://x/',{method:'POST',headers:{Authorization:'Bearer good'},body:JSON.stringify(body)}));

test('HTTP: room ops are validated before they reach the database, and their errors have statuses',async()=>{
  calls.length=0;
  for(const b of[{op:'room_create'},{op:'room_create',stake:'free'},{op:'room_create',stake:'vip'},{op:'room_join',code:'12345'},{op:'room_join',code:123456},
    {op:'room_join',code:'12345a'},{op:'room_peek'},{op:'room_wait',room:'x'},{op:'room_start'},{op:'room_leave',room:'1234'}])
    assert.equal((await req(b)).status,422,JSON.stringify(b));
  assert.equal(calls.length,0);
  assert.equal((await req({op:'room_create',stake:'mid'})).status,200);assert.deepEqual(calls.at(-1),['roomCreate',U,'mid']);
  const ic=await req({op:'room_create',stake:'extreme'});assert.equal(ic.status,409);assert.deepEqual(await ic.json(),{error:'insufficient_chips'});
  assert.deepEqual(await(await req({op:'room_peek',code:'000001'})).json(),{room:null});assert.deepEqual(calls.at(-1),['roomPeek',U,'000001']);
  assert.equal((await req({op:'room_join',code:'123456',junk:1})).status,200);assert.deepEqual(calls.at(-1),['roomJoin',U,'123456']);
  const full=await req({op:'room_join',code:'999999'});assert.equal(full.status,409);assert.deepEqual(await full.json(),{error:'room_full'});
  const ig=await req({op:'room_join',code:'888888'});assert.equal(ig.status,409);assert.deepEqual(await ig.json(),{error:'in_game',game:RID});
  assert.equal((await req({op:'room_wait',room:RID})).status,200);assert.deepEqual(calls.at(-1),['roomWait',U,RID]);
  const aw=await req({op:'room_start',room:RID});assert.equal(aw.status,409);assert.deepEqual(await aw.json(),{error:'away'});
  assert.deepEqual(await(await req({op:'room_leave',room:RID})).json(),{ok:true});assert.deepEqual(calls.at(-1),['roomLeave',U,RID]);
  const{STATUS}=await import('../server/game/handler.js');
  for(const c of['in_game','room_closed','room_full','not_host','not_enough','away'])assert.equal(STATUS[c],409,c);
});

// ---- fakeNet ----
test('fakeNet: make a room, friends join, the full room starts a table with the code; the buy-in is paid at the start',async()=>{
  const realSet=globalThis.setTimeout,realNow=Date.now;let skew=0;
  globalThis.location={search:'?fake&friend=1000'};
  globalThis.setTimeout=(f,ms,...a)=>realSet(f,ms>=100&&ms<=220?0:ms,...a);
  Date.now=()=>realNow()+skew;
  try{
    const{rpc,game}=await import('../src/fakeNet.js?rooms');
    const chips0=(await rpc('me')).chips;
    await assert.rejects(()=>game({op:'room_create',stake:'free'}),e=>e.code==='illegal');
    const c=await game({op:'room_create',stake:'mid'});
    assert.match(c.room.code,CODE_RE);assert.equal(c.room.isHost,true);assert.equal(c.room.members.length,1);
    assert.equal((await rpc('me')).chips,chips0,'nothing is paid while waiting');
    await assert.rejects(()=>game({op:'room_start',room:c.room.id}),e=>e.code==='not_enough');
    skew+=1000;let w=await game({op:'room_wait',room:c.room.id});assert.equal(w.room.members.length,2);assert.equal(w.room.game,null);
    skew+=1000;w=await game({op:'room_wait',room:c.room.id});
    assert.ok(w.room.game,'the third player starts the table');
    const me=await rpc('me');assert.equal(me.game,w.room.game);assert.equal(me.chips,chips0-100);
    const v=(await rpc('game_poll',{p_game:w.room.game,p_ver:-1})).view;
    assert.equal(v.meta.room,c.room.code);assert.deepEqual(v.meta.bot,[false,false,false],'friends are shown as people');
    await assert.rejects(()=>game({op:'room_create',stake:'low'}),e=>e.code==='in_game');
    const pk=await game({op:'room_peek',code:'000000'});assert.equal(pk.room,null);
  }finally{globalThis.setTimeout=realSet;Date.now=realNow;delete globalThis.location}
});
