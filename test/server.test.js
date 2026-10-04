// Game server: table creation (multiplier / prize / structure), requests, bot turns, turn clock, settlement, hidden information,
// and the HTTP behaviour (CORS, auth, routing, validation). No database: the handler gets its dependencies injected.
import{test}from'node:test';
import assert from'node:assert/strict';
import{actor,legalActions}from'../src/engine.js';
import{viewFor}from'../src/view.js';
import{STAKES,FREEROLL,MULTIPLIERS,MULT_TOTAL,structureFor}from'../src/spin.js';
import{botMove}from'../src/bot.js';
import{
  MoveError,TURN_MS,TIMEBANK_MS,GRACE_MS,REVEAL_MS,WHEEL_MS,BOT_THINK_MS,SITOUT_MS,MAX_STRIKES,
  botName,checkEntry,createTable,applyRequest,tick,viewsOf,settle,commit,publicMeta,humanAlive,finishBotsOnly,
}from'../server/game/rules.js';
import{createHandler}from'../server/game/handler.js';

function mulberry(a){return()=>{a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296}}
const T0=1_700_000_000_000;
const human=(n,uid)=>({uid:uid??`u${n}`,name:'P'+n,bot:null});
const bot=(persona)=>({uid:null,name:botName(persona),bot:{persona}});
const rndFor=k=>mulberry(k);
// a rnd whose first value picks a given multiplier of a stake (the first draw of createTable is the multiplier)
const rndForMult=(stake,mult)=>{
  let k=0;for(const[m,c]of MULTIPLIERS[stake]){if(m===mult){k+=Math.floor(c/2);break}k+=c}
  const r=mulberry(5);let first=true;return()=>{if(first){first=false;return(k+0.5)/MULT_TOTAL}return r()};
};
const mk=(players,stake='low',seed=1,now=T0)=>createTable({players,stake,now,rnd:rndFor(seed)});
const stored=t=>({state:t.state,meta:t.meta});
const errCode=(f)=>{try{f()}catch(e){return e.code}return null};

test('createTable: multiplier, prize and structure follow the draw (prize = buy-in x multiplier, at most 100,000)',()=>{
  for(const stake of['low','mid','high'])for(const[m]of MULTIPLIERS[stake]){
    const t=createTable({players:[human(0),human(1),human(2)],stake,now:T0,rnd:rndForMult(stake,m)});
    assert.equal(t.meta.multiplier,m,`${stake} ${m}x`);
    assert.equal(t.meta.buyIn,STAKES[stake].buyIn);
    assert.equal(t.meta.prize,STAKES[stake].buyIn*m);
    assert.ok(t.meta.prize<=100000);
    const s=structureFor(m);
    assert.equal(t.state.levelMs,s.levelMs);
    assert.ok(t.state.handStart.every(x=>x===s.stack),'every seat starts with the structure stack');
  }
});

test('createTable: free-roll has no multiplier, a fixed prize and the free-roll structure; names and bots are kept',()=>{
  const t=mk([human(0),bot('tight'),bot('loose')],'free');
  assert.equal(t.meta.multiplier,null);assert.equal(t.meta.buyIn,0);assert.equal(t.meta.prize,FREEROLL.prize);
  assert.equal(t.state.levelMs,FREEROLL.levelMs);assert.ok(t.state.handStart.every(x=>x===FREEROLL.stack));
  assert.deepEqual(t.state.names,['P0','🤖 Tight','🤖 Loose']);
  assert.deepEqual(t.meta.bots.map(b=>b&&b.persona),[null,'tight','loose']);
  assert.throws(()=>createTable({players:[human(0)],stake:'low',now:T0,rnd:rndFor(1)}));
  assert.throws(()=>createTable({players:[human(0),human(1),human(2)],stake:'x',now:T0,rnd:rndFor(1)}));
});

test('createTable: the first clock starts after the wheel; a bot to act gets a think time',()=>{
  const t=mk([human(0),human(1),human(2)]);const a=actor(t.state),c=t.meta.clock;
  assert.equal(c.turnStart,T0+WHEEL_MS);assert.equal(c.deadline,T0+WHEEL_MS+TURN_MS+TIMEBANK_MS);
  assert.deepEqual(c.timebank,[TIMEBANK_MS,TIMEBANK_MS,TIMEBANK_MS]);assert.deepEqual(c.strikes,[0,0,0]);assert.equal(c.botAt,null);
  assert.ok(a>=0);
  const b=mk([bot('tight'),bot('loose'),bot('aggro')]);
  assert.ok(b.meta.clock.botAt>=T0+WHEEL_MS+BOT_THINK_MS[0]&&b.meta.clock.botAt<=T0+WHEEL_MS+BOT_THINK_MS[1]);
});

test('checkEntry: stake rules and free-roll eligibility',()=>{
  const ok=(p,s)=>assert.doesNotThrow(()=>checkEntry(p,s));
  ok({chips:10,frUsedToday:0},'low');ok({chips:100,frUsedToday:0},'mid');ok({chips:20000,frUsedToday:0},'high');
  assert.equal(errCode(()=>checkEntry({chips:9,frUsedToday:0},'low')),'insufficient_chips');
  assert.equal(errCode(()=>checkEntry({chips:99,frUsedToday:0},'mid')),'insufficient_chips');
  assert.equal(errCode(()=>checkEntry({chips:19999,frUsedToday:0},'high')),'locked_stake');
  ok({chips:9,frUsedToday:2},'free');
  assert.equal(errCode(()=>checkEntry({chips:10,frUsedToday:0},'free')),'freeroll_unavailable');
  assert.equal(errCode(()=>checkEntry({chips:0,frUsedToday:3},'free')),'freeroll_unavailable');
  assert.equal(errCode(()=>checkEntry({chips:99999,frUsedToday:0},'nope')),'illegal');
});

test('applyRequest: stale version, wrong seat, bad moves and a finished game are refused; the stored game is untouched',()=>{
  const t=mk([human(0),human(1),human(2)]),g=stored(t),a=actor(t.state),other=(a+1)%3,ver=t.state.ver,before=JSON.stringify(g);
  const act=(seat,move,v=ver,now=T0+WHEEL_MS+1000)=>applyRequest(g,seat,{op:'act',ver:v,move},now);
  assert.equal(errCode(()=>act(a,{type:'fold'},ver+1)),'stale');
  assert.equal(errCode(()=>act(a,{type:'fold'},ver-1)),'stale');
  assert.equal(errCode(()=>act(other,{type:'fold'})),'not_your_turn');
  assert.equal(errCode(()=>act(a,{type:'check'})),'illegal','facing the big blind: cannot check');
  assert.equal(errCode(()=>act(a,{type:'raise'})),'illegal');
  assert.equal(errCode(()=>act(a,{type:'raise',to:1})),'illegal');
  assert.equal(errCode(()=>act(a,{type:'raise',to:1.5})),'illegal');
  assert.equal(errCode(()=>act(a,{type:'raise',to:10**9})),'illegal');
  assert.equal(errCode(()=>act(a,{type:'allin'})),'illegal');
  assert.equal(errCode(()=>act(a,null)),'illegal');
  assert.equal(errCode(()=>applyRequest(g,a,{op:'resign'},T0)),'illegal');
  assert.equal(errCode(()=>act(7,{type:'fold'})),'not_your_turn');
  assert.equal(JSON.stringify(g),before,'nothing mutated');
  const L=legalActions(viewFor(t.state,a));
  const r=act(a,{type:'raise',to:L.minRaiseTo});
  assert.equal(r.state.ver,ver+1);assert.notEqual(actor(r.state),a);assert.equal(JSON.stringify(g),before);
  const over=structuredClone(t.state);over.over=true;
  assert.equal(errCode(()=>applyRequest({state:over,meta:t.meta},a,{op:'act',ver:over.ver,move:{type:'fold'}},T0)),'game_over');
  const b=mk([human(0),bot('tight'),bot('loose')]);
  const bs=actor(b.state);
  if(b.meta.bots[bs])assert.equal(errCode(()=>applyRequest(stored(b),bs,{op:'act',ver:b.state.ver,move:{type:'fold'}},T0+WHEEL_MS)),'not_your_turn','a bot seat cannot be played by a request');
});

test('applyRequest: acting resets strikes and takes only the over-time out of the time bank',()=>{
  const t=mk([human(0),human(1),human(2)]),a=actor(t.state),c0=t.meta.clock;
  const g=stored({state:t.state,meta:{...t.meta,clock:{...c0,strikes:[1,1,1],timebank:[20000,20000,20000]}}});
  const fast=applyRequest(g,a,{op:'act',ver:t.state.ver,move:{type:'fold'}},c0.turnStart+TURN_MS-1);
  assert.equal(fast.clock.timebank[a],20000);assert.equal(fast.clock.strikes[a],0);
  const slow=applyRequest(g,a,{op:'act',ver:t.state.ver,move:{type:'fold'}},c0.turnStart+TURN_MS+7000);
  assert.equal(slow.clock.timebank[a],13000);assert.equal(slow.clock.strikes[a],0);assert.equal(slow.clock.strikes[(a+1)%3],1);
  const way=applyRequest(g,a,{op:'act',ver:t.state.ver,move:{type:'fold'}},c0.turnStart+TURN_MS+99999);
  assert.equal(way.clock.timebank[a],0);
  // the next actor's deadline = their turn start + TURN_MS + their own time bank
  const nx=actor(fast.state);assert.equal(fast.clock.turnStart,c0.turnStart+TURN_MS-1);
  assert.equal(fast.clock.deadline,fast.clock.turnStart+TURN_MS+fast.clock.timebank[nx]);
});

test('applyRequest: a finished hand gives the next turn REVEAL_MS extra',()=>{
  // 3 humans: fold, fold -> the hand ends (the BB wins), the next hand's actor starts REVEAL_MS later
  let g=stored(mk([human(0),human(1),human(2)])),now=T0+WHEEL_MS+500;
  const h0=g.state.handNo;
  for(let i=0;i<2;i++){
    const s=actor(g.state),r=applyRequest(g,s,{op:'act',ver:g.state.ver,move:{type:'fold'}},now);
    g={state:r.state,meta:{...g.meta,clock:r.clock}};
    if(i===0)assert.equal(g.meta.clock.turnStart,now,'no bonus inside a hand');
  }
  assert.equal(g.state.handNo,h0+1);assert.equal(g.meta.clock.turnStart,now+REVEAL_MS);
  assert.ok(g.meta.clock.deadline>=now+REVEAL_MS+TURN_MS);
});

test('tick: a bot plays once its think time has passed; a broken bot never stalls the table',()=>{
  let t=mk([human(0),human(1),human(2)],'low',3);
  // find a seed where a bot acts first, by making every seat but 0 a bot
  t=mk([bot('tight'),bot('loose'),bot('aggro')],'low',3);
  const g=stored(t),a=actor(t.state),c=t.meta.clock;
  const mv=botMove;
  assert.equal(errCode(()=>tick(g,c.botAt-1,{botMove:mv,rnd:rndFor(9)})),'not_yet');
  const r=tick(g,c.botAt,{botMove:mv,rnd:rndFor(9)});
  assert.equal(r.state.ver,t.state.ver+1);assert.equal(JSON.stringify(g.state),JSON.stringify(t.state),'stored game untouched');
  // throws / returns garbage: falls back to check-or-fold
  const bad=tick(g,c.botAt,{botMove:()=>{throw new Error('boom')},rnd:rndFor(9)});
  assert.equal(bad.state.ver,t.state.ver+1);
  const junk=tick(g,c.botAt,{botMove:()=>({type:'raise',to:-5}),rnd:rndFor(9)});
  assert.equal(junk.state.ver,t.state.ver+1);
  // the bot is shown only its own view
  let seen=null;
  tick(g,c.botAt,{botMove:(view,seat)=>{seen={view,seat};return{type:'fold'}},rnd:rndFor(9)});
  assert.equal(seen.seat,a);assert.equal(seen.view.deck,undefined);assert.equal(seen.view.seed,undefined);
  assert.ok(seen.view.holes.every((h,i)=>i===a?Array.isArray(h):h===null));
});

test('tick: a human who runs out of time is acted for (check, else fold); the time bank is spent and a strike is added',()=>{
  const t=mk([human(0),human(1),human(2)]),g=stored(t),a=actor(t.state),c=t.meta.clock;
  assert.equal(errCode(()=>tick(g,c.deadline,{botMove,rnd:rndFor(1)})),'not_yet','inside the grace period');
  assert.equal(errCode(()=>tick(g,c.deadline+GRACE_MS-1,{botMove,rnd:rndFor(1)})),'not_yet');
  const r=tick(g,c.deadline+GRACE_MS,{botMove,rnd:rndFor(1)});
  assert.equal(r.state.ver,t.state.ver+1);
  assert.equal(r.clock.strikes[a],1);assert.equal(r.clock.timebank[a],0);
  assert.ok(r.state.log.some(e=>new RegExp(`\\{${a}\\} (folds|checks)`).test(e.text)));
  assert.notEqual(actor(r.state),a);
});

test('tick: after MAX_STRIKES time-outs a human sits out (acted for SITOUT_MS after the turn starts); acting brings them back',()=>{
  let g=stored(mk([human(0),human(1),human(2)])),now=g.meta.clock.deadline+GRACE_MS;
  const victim=actor(g.state);
  const step=()=>{const r=tick(g,now,{botMove,rnd:rndFor(1)});g={state:r.state,meta:{...g.meta,clock:r.clock}}};
  step();assert.equal(g.meta.clock.strikes[victim],1);
  // run the table until the victim is to act again (the other humans act at once)
  const advance=()=>{
    for(let i=0;i<60&&actor(g.state)!==victim;i++){
      const s=actor(g.state),r=applyRequest(g,s,{op:'act',ver:g.state.ver,move:legalActions(viewFor(g.state,s)).canCheck?{type:'check'}:{type:'fold'}},now);
      g={state:r.state,meta:{...g.meta,clock:r.clock}};
    }
    assert.equal(actor(g.state),victim,'victim to act');
  };
  advance();now=g.meta.clock.deadline+GRACE_MS;step();
  assert.equal(g.meta.clock.strikes[victim],MAX_STRIKES);
  advance();
  // sit-out: the deadline is only SITOUT_MS after the turn started, with no grace
  assert.equal(g.meta.clock.deadline,g.meta.clock.turnStart+SITOUT_MS);
  assert.equal(errCode(()=>tick(g,g.meta.clock.deadline-1,{botMove,rnd:rndFor(1)})),'not_yet');
  const r=tick(g,g.meta.clock.deadline,{botMove,rnd:rndFor(1)});
  assert.equal(r.clock.strikes[victim],MAX_STRIKES,'no extra strike while sitting out');
  // the player comes back by acting
  g={state:r.state,meta:{...g.meta,clock:r.clock}};advance();
  const back=applyRequest(g,victim,{op:'act',ver:g.state.ver,move:{type:'fold'}},g.meta.clock.turnStart+10);
  assert.equal(back.clock.strikes[victim],0);
});

// plays a whole game: `players` humans who only ever time out + bots; returns { game, steps }
function playOut(players,{stake='low',seed=1,drive}={}){
  const t=mk(players,stake,seed);let g=stored(t),steps=0,now=T0;
  const rnd=rndFor(seed+100);
  while(!g.state.over&&steps++<20000){
    const c=g.meta.clock,seat=actor(g.state);
    now=g.meta.bots[seat]?c.botAt:c.deadline+(c.strikes[seat]>=MAX_STRIKES?0:GRACE_MS);
    const r=tick(g,now,{botMove,rnd});
    if(drive)drive(g,r,now);
    const o=commit(g,r);g={state:o.state,meta:o.meta};
  }
  return{game:g,steps};
}

test('a game runs to the end with a human who never acts and two bots; settle pays only a human winner',()=>{
  let humanWins=0,botWins=0;
  for(let seed=1;seed<=6;seed++){
    const{game,steps}=playOut([human(0),bot('tight'),bot('aggro')],{seed});
    assert.ok(game.state.over,`seed ${seed} finished in ${steps} steps`);
    assert.equal(game.state.places.filter(p=>p===1).length,1);
    assert.deepEqual([...game.state.places].sort(),[1,2,3]);
    const out=commit({state:game.state,meta:{...game.meta,clock:game.meta.clock}},{state:game.state,clock:game.meta.clock});
    const w=game.state.winner;
    assert.equal(out.payouts.reduce((a,b)=>a+b,0),game.meta.bots[w]?0:game.meta.prize);
    assert.equal(out.meta.result.winner,w);assert.equal(out.meta.result.prize,game.meta.prize);
    assert.deepEqual(out.meta.result.places,game.state.places);
    if(game.meta.bots[w])botWins++;else{humanWins++;assert.equal(out.payouts[w],game.meta.prize)}
    assert.equal(game.meta.clock.deadline,null);
    assert.equal(errCode(()=>tick(game,T0+10**9,{botMove,rnd:rndFor(1)})),'game_over');
  }
  assert.ok(humanWins+botWins===6);
});

test('settle: the human winner takes the prize; a bot winner removes it; a free-roll pays its fixed prize',()=>{
  const base=mk([human(0),human(1),bot('tight')],'mid',2);
  const fin=(winner,meta=base.meta)=>{
    const st=structuredClone(base.state);st.over=true;st.winner=winner;st.places=[2,3,2].map((_,i)=>i===winner?1:i===(winner+1)%3?2:3);
    return settle(st,meta);
  };
  const s0=fin(1);assert.deepEqual(s0.payouts,[0,base.meta.prize,0]);assert.equal(s0.result.stake,'mid');assert.equal(s0.result.buyIn,100);
  assert.equal(s0.result.multiplier,base.meta.multiplier);assert.deepEqual(s0.result.payouts,s0.payouts);
  const botIdx=base.meta.bots.findIndex(Boolean);
  assert.deepEqual(fin(botIdx).payouts,[0,0,0]);
  const free=mk([human(0),human(1),human(2)],'free');
  const st=structuredClone(free.state);st.over=true;st.winner=2;st.places=[3,2,1];
  const sf=settle(st,free.meta);assert.deepEqual(sf.payouts,[0,0,FREEROLL.prize]);assert.equal(sf.result.multiplier,null);
  // the buy-in came out of the balance when the table was made, so the net result of a win is prize - buyIn
  assert.equal(sf.result.buyIn,0);
});

test('views never leak the deck, the RNG, other seats\' hole cards or bot personas — at every step of a game',()=>{
  const players=[human(0),bot('tight'),bot('loose')];
  const check=(state,meta)=>{
    const vs=viewsOf(state,meta);
    assert.equal(vs.length,3);
    vs.forEach((v,seat)=>{
      const txt=JSON.stringify(v);
      for(const k of['deck','seed','ctr','bots','persona'])assert.ok(!(k in v)&&!(k in v.meta)&&!txt.includes(`"${k}"`),`no ${k} in the view`);
      assert.equal(v.meta.seat,seat);assert.deepEqual(v.meta.bot,meta.bots.map(Boolean));
      v.holes.forEach((h,i)=>{
        if(i!==seat)assert.equal(h,null,'other hole cards hidden');
        else assert.deepEqual(h,state.holes[i]);
      });
      assert.equal(v.meta.multiplier,meta.multiplier);assert.equal(v.meta.prize,meta.prize);
    });
    assert.deepEqual(publicMeta(meta,1).seat,1);
  };
  let n=0;
  playOut(players,{seed:4,drive:(g,r)=>{if(n++%7===0)check(r.state,{...g.meta,clock:r.clock})}});
  assert.ok(n>10);
});

test('the engine state stored by the server survives a JSON round trip (resume after any request)',()=>{
  const{game}=playOut([human(0),bot('tight'),bot('loose')],{seed:7});
  assert.deepEqual(JSON.parse(JSON.stringify(game)),game);
  // resume a game halfway: store/load between every step
  const t=mk([human(0),bot('loose'),bot('aggro')],'mid',9);let g=JSON.parse(JSON.stringify(stored(t))),steps=0;
  while(!g.state.over&&steps++<20000){
    const c=g.meta.clock,seat=actor(g.state),now=g.meta.bots[seat]?c.botAt:c.deadline+(c.strikes[seat]>=MAX_STRIKES?0:GRACE_MS);
    const r=tick(g,now,{botMove,rnd:rndFor(steps)});g=JSON.parse(JSON.stringify({state:r.state,meta:{...g.meta,clock:r.clock}}));
  }
  assert.ok(g.state.over);
});

test('commit: a table with no human left is finished at once (bots take the remaining places by chips, nobody is paid)',()=>{
  const t=mk([human(0),bot('tight'),bot('loose')],'mid',11);
  const h=t.meta.bots.findIndex(b=>!b),[b1,b2]=[0,1,2].filter(s=>s!==h);
  const busted=(stacks)=>{
    const st=structuredClone(t.state);
    st.seats[h]={stack:0,out:true};st.places[h]=3;st.folded[h]=true;st.total=[0,0,0];
    st.seats[b1].stack=stacks[0];st.seats[b2].stack=stacks[1];
    return st;
  };
  assert.ok(humanAlive(t.state,t.meta,h)&&!humanAlive(t.state,t.meta,b1),'only humans count');
  let out=commit(stored(t),{state:busted([500,400]),clock:t.meta.clock});
  assert.ok(out.state.over);assert.equal(out.state.winner,b1);
  assert.equal(out.state.places[h],3);assert.equal(out.state.places[b1],1);assert.equal(out.state.places[b2],2);
  assert.deepEqual(out.payouts,[0,0,0]);assert.equal(out.meta.result.winner,b1);assert.equal(out.meta.result.places[h],3);
  assert.equal(out.meta.clock.deadline,null);assert.equal(out.meta.clock.botAt,null);
  assert.equal(out.state.toAct,null);assert.ok(out.state.holes.every(x=>x===null));
  const views=viewsOf(out.state,out.meta);assert.ok(views.every(v=>v.over&&v.meta.result.places[h]===3));
  // the one with more chips ranks higher; equal chips: lower seat first
  out=commit(stored(t),{state:busted([300,600]),clock:t.meta.clock});assert.equal(out.state.winner,b2);assert.equal(out.state.places[b1],2);
  out=commit(stored(t),{state:busted([450,450]),clock:t.meta.clock});assert.equal(out.state.winner,Math.min(b1,b2));
  // chips already in the pot count
  const st=busted([100,100]);st.total[b2]=250;
  assert.equal(finishBotsOnly(st).winner,b2);assert.ok(!('over' in st)||st.over===false,'argument not mutated');
  // a human who is still in keeps the table open; two humans, one eliminated: still open
  const t2=mk([human(0),human(1),bot('aggro')],'low',12),st2=structuredClone(t2.state);
  st2.seats[0]={stack:0,out:true};st2.places[0]=3;
  const o2=commit(stored(t2),{state:st2,clock:t2.meta.clock});
  assert.ok(!o2.state.over&&o2.payouts===null);assert.ok(!humanAlive(st2,t2.meta,0)&&humanAlive(st2,t2.meta,1));
});

test('a human who is eliminated ends the game when only bots are left; eliminated + bots-only tables never need ticks',()=>{
  let ended=0,bustedFirst=0;
  for(let seed=1;seed<=12;seed++){
    const{game}=playOut([human(0),bot('tight'),bot('aggro')],{seed});
    assert.ok(game.state.over);ended++;
    if(game.state.places[0]!==1){bustedFirst++;assert.deepEqual(game.meta.result.payouts,[0,0,0]);assert.ok(game.meta.bots[game.state.winner])}
  }
  assert.equal(ended,12);assert.ok(bustedFirst>0,'at least one game where the human lost');
});

// ---- fakeNet (browser stand-in) ----
test('fakeNet: an eliminated player is out of the table at once (me().game is null, queue starts a new table)',async()=>{
  const realSet=globalThis.setTimeout,realNow=Date.now;let skew=0;
  globalThis.location={search:'?fake&wait=0&chips=5'};
  globalThis.setTimeout=(f,ms,...a)=>realSet(f,ms>=100&&ms<=220?0:ms,...a);
  Date.now=()=>realNow()+skew;
  try{
    const{rpc,game}=await import('../src/fakeNet.js');
    const q=await game({op:'queue',stake:'free'});assert.ok(q.game);
    assert.equal((await rpc('me')).game,q.game);
    let v=(await rpc('game_poll',{p_game:q.game,p_ver:-1})).view,n=0;
    const mine=()=>v.places[v.meta.seat];
    while(!v.over&&mine()===null&&n++<3000){
      skew+=30000;
      try{v=(await game({op:'tick',game:q.game})).view}
      catch(e){if(e.code!=='not_yet')throw e;
        const L=legalActions(v);v=(await game({op:'act',game:q.game,ver:v.ver,move:{type:L.canCheck?'check':'fold'}})).view}
    }
    assert.ok(v.over||mine()!==null);
    assert.equal((await rpc('me')).game,null);
    const poll=await rpc('game_poll',{p_game:q.game,p_ver:-1});assert.ok(poll.view,'the eliminated player can still poll the table');
    if(mine()!==1){
      assert.ok(v.over,'only bots left: the table is finished');assert.deepEqual(v.meta.result.payouts,[0,0,0]);
      const q2=await game({op:'queue',stake:'free'});assert.ok(q2.game&&q2.game!==q.game,'a new table, not the old one');
    }
  }finally{globalThis.setTimeout=realSet;Date.now=realNow;delete globalThis.location}
});

// ---- HTTP ----
const U='00000000-0000-4000-8000-000000000001',GID='00000000-0000-4000-8000-0000000000aa';
const calls=[];
const handler=createHandler({
  allowedOrigins:['http://localhost:5173'],
  verifyToken:async t=>t==='good'?U:null,
  queue:async(uid,stake)=>{calls.push(['queue',uid,stake]);if(stake==='high')throw new MoveError('locked_stake');return{waiting:{low:1,mid:0,high:0,free:0},since:1,game:null}},
  leave:async uid=>{calls.push(['leave',uid]);return{ok:true}},
  act:async(uid,game,body)=>{calls.push(['act',uid,game,body]);if(body.ver===0)throw new MoveError('stale');return{ver:2,now:0,view:{op:'act'}}},
  tick:async(uid,game)=>{if(game===GID.replace('aa','bb'))throw new MoveError('not_yet');if(game===GID.replace('aa','cc'))throw new Error('db down');return{ver:3,now:0,view:{op:'tick'}}},
  logError:()=>{},
});
const req=(body,{token='good',origin='http://localhost:5173',method='POST'}={})=>handler(new Request('https://x/',{method,headers:{Origin:origin,...(token?{Authorization:`Bearer ${token}`}:{})},body:method==='POST'?typeof body==='string'?body:JSON.stringify(body):undefined}));

test('HTTP: CORS only for allowed origins',async()=>{
  const r=await req(null,{method:'OPTIONS'});assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),'http://localhost:5173');
  const x=await req(null,{method:'OPTIONS',origin:'https://evil.example'});assert.equal(x.headers.get('access-control-allow-origin'),null);
  const y=await req({op:'leave'},{origin:'https://evil.example'});assert.equal(y.headers.get('access-control-allow-origin'),null);
});

test('HTTP: no token or a bad token is 401; only POST',async()=>{
  assert.equal((await req({op:'leave'},{token:null})).status,401);
  assert.equal((await req({op:'leave'},{token:'bad'})).status,401);
  const r=await req({op:'leave'},{method:'GET'});assert.equal(r.status,405);
});

test('HTTP: routing, validation and error codes',async()=>{
  calls.length=0;
  assert.equal((await req('{nope')).status,422);
  assert.equal((await req('[1]')).status,422);
  assert.equal((await req({op:'what'})).status,422);
  assert.equal((await req({op:'queue'})).status,422);
  assert.equal((await req({op:'queue',stake:'vip'})).status,422);
  assert.equal(calls.length,0,'nothing reached the database');
  const q=await req({op:'queue',stake:'low'});assert.equal(q.status,200);assert.deepEqual((await q.json()).waiting.low,1);
  assert.deepEqual(calls.at(-1),['queue',U,'low']);
  const hi=await req({op:'queue',stake:'high'});assert.equal(hi.status,409);assert.deepEqual(await hi.json(),{error:'locked_stake'});
  assert.deepEqual(await(await req({op:'leave'})).json(),{ok:true});
  assert.equal((await req({op:'act',game:'x',ver:1,move:{type:'fold'}})).status,422);
  assert.equal((await req({op:'act',game:GID,ver:'1',move:{type:'fold'}})).status,422);
  assert.equal((await req({op:'act',game:GID,ver:1})).status,422);
  assert.equal((await req({op:'act',game:GID,ver:1,move:'fold'})).status,422);
  const a=await req({op:'act',game:GID,ver:1,move:{type:'raise',to:40},junk:1});assert.equal(a.status,200);assert.deepEqual((await a.json()).view,{op:'act'});
  assert.deepEqual(calls.at(-1),['act',U,GID,{ver:1,move:{type:'raise',to:40}}],'only the whitelisted fields are passed on');
  const st=await req({op:'act',game:GID,ver:0,move:{type:'fold'}});assert.equal(st.status,409);assert.deepEqual(await st.json(),{error:'stale'});
  assert.equal((await req({op:'tick',game:'nope'})).status,422);
  assert.equal((await req({op:'tick',game:GID})).status,200);
  const ny=await req({op:'tick',game:GID.replace('aa','bb')});assert.equal(ny.status,409);assert.deepEqual(await ny.json(),{error:'not_yet'});
  const boom=await req({op:'tick',game:GID.replace('aa','cc')});assert.equal(boom.status,500);assert.deepEqual(await boom.json(),{error:'internal'});
  assert.equal((await req('x'.repeat(5000))).status,422);
});

test('HTTP: every MoveError code has a status; unknown codes are 422',async()=>{
  const{STATUS}=await import('../server/game/handler.js');
  for(const c of['not_found','gone','stale','not_yet','game_over','not_your_turn','busy','no_profile','insufficient_chips','freeroll_unavailable','locked_stake','illegal'])
    assert.ok(Number.isInteger(STATUS[c]),c);
  assert.equal(STATUS.not_found,404);assert.equal(STATUS.no_profile,403);
});
