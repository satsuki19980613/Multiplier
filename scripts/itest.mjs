// Integration test against a Neon branch (dev only): `npm run db:migrate -- --branch dev` first, then `node scripts/itest.mjs --branch dev`.
// Test users queue, get matched (three humans / humans + bots / free-roll), play whole games through the server's database layer
// (makeDb) with the bot picking each human's moves from that human's own view, and the chips, prizes, ranking, season roll-over
// and purge are checked. RPCs are called the way the Data API calls them (role authenticated + request.jwt.claims).
// The test users are removed at the end. Refuses to run on production. It also exercises the season roll-over, which resets EVERY
// player's chips on that branch (dev data only).
// (ITEST_DATABASE_URL=postgres://… runs it against any database that has the migration applied, e.g. a local one.)
import pg from'pg';
import{makeDb}from'../server/game/db.js';
import{botMove}from'../src/bot.js';
import{legalActions}from'../src/engine.js';
import{BOT_WAIT_MS}from'../server/game/rules.js';

let pool;
if(process.env.ITEST_DATABASE_URL)pool=new pg.Pool({connectionString:process.env.ITEST_DATABASE_URL,max:8});
else{
  const{branchArg,connectionString}=await import('./neon.mjs');
  const branch=branchArg();if(branch==='production'){console.error('production では実行しない');process.exit(2)}
  pool=new pg.Pool({connectionString:await connectionString(branch),max:8});
}
const U=Array.from({length:7},(_,i)=>`00000000-0000-4000-8000-0000000000a${i+1}`);
const ok=(c,m)=>{if(!c)throw new Error('FAIL '+m);console.log('ok  '+m)};
const codeOf=async f=>{try{await f()}catch(e){return e.code&&!/^[0-9A-Z]{5}$/.test(e.code)?e.code:e.message}return null};
async function rpc(uid,sql,args=[]){
  const c=await pool.connect();
  try{await c.query('begin');await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid,role:'authenticated'})]);
    const r=await c.query(sql,args);await c.query('commit');return r.rows[0]?Object.values(r.rows[0])[0]:null}
  catch(e){await c.query('rollback');throw e}finally{c.release()}
}
const skew={v:0};
const db=makeDb(pool,{now:()=>Date.now()+skew.v});
const clean=async()=>{
  await pool.query('delete from public.games where players && $1::uuid[]',[U]);
  await pool.query('delete from neon_auth."user" where id=any($1::uuid[])',[U]);
};
const me=uid=>rpc(uid,'select public.me()');
const chipsOf=async uid=>Number((await pool.query('select chips from public.profiles where uid=$1',[uid])).rows[0].chips);
const setChips=(uid,n)=>pool.query('update public.profiles set chips=$2 where uid=$1',[uid,n]);
const closeGames=()=>pool.query("update public.games set status='over' where status='active' and players && $1::uuid[]",[U]);
const agedQueue=()=>pool.query('update public.queue set since=now()-make_interval(secs => $1::float8/1000+1) where uid=any($2::uuid[])',[BOT_WAIT_MS,U]);
const freshQueue=()=>pool.query('delete from public.queue where uid=any($1::uuid[])',[U]);

// plays a game to the end. Humans move (the bot logic on their own view); bots / time-outs are driven by tick with a skewed clock.
async function playOut(game,humans,label,{fold=false}={}){
  let steps=0,views;
  const poll=async()=>{views={};for(const u of humans)views[u]=(await rpc(u,'select public.game_poll($1,-1)',[game])).view};
  await poll();
  while(!views[humans[0]].over&&steps++<4000){
    skew.v+=20000;   // time passes (blinds go up), so even a passive bot pair ends the game
    const v0=views[humans[0]],seat=v0.toAct;
    const h=humans.find(u=>views[u].meta.seat===seat);
    if(h&&!v0.meta.bot[seat]){
      const mv=fold?{type:legalActions(views[h]).canCheck?'check':'fold'}:botMove(views[h],seat,{persona:'tight',rnd:Math.random});
      if(steps===3){const c=await codeOf(()=>db.act(h,game,{ver:views[h].ver-1,move:mv}));ok(c==='stale','stale version is refused')}
      await db.act(h,game,{ver:views[h].ver,move:mv});
    }else{
      skew.v+=60000;
      await db.tick(humans[0],game);
    }
    await poll();
    if(fold&&humans.length===1){   // eliminated and only bots left: the table must already be over in the database
      const v=views[humans[0]];
      if(v.places[v.meta.seat]!==null){
        const st=(await pool.query('select status from public.games where id=$1',[game])).rows[0].status;
        ok(st==='over'&&v.over,'eliminated human, only bots left: the table is finished at once');
        break;
      }
    }
  }
  ok(views[humans[0]].over,`${label}: game over after ${steps} steps`);
  return views;
}

try{
  await clean();
  await pool.query(`insert into neon_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt")
    select u,'t','t'||i||'@example.test',false,now(),now() from unnest($1::uuid[]) with ordinality as x(u,i)`,[U]);

  // ---- access ----
  ok(await codeOf(()=>rpc(U[0],'select count(*) from public.games'))!==null,'authenticated cannot read games directly');
  ok(await codeOf(()=>rpc(U[0],'select count(*) from public.profiles'))!==null,'authenticated cannot read profiles directly');
  for(const f of['purge_old_games()','season_rollover()','current_uid()'])
    ok(await codeOf(()=>rpc(U[0],`select public.${f}`))!==null,`players cannot call ${f}`);

  // ---- profile ----
  const m0=await me(U[0]);
  ok(/^Player-[0-9A-F]{4}$/.test(m0.nickname)&&m0.chips===10000&&m0.game===null,'me() creates a profile '+m0.nickname);
  ok(m0.freeroll.used===0&&m0.freeroll.left===3&&m0.freeroll.eligible===false,'free-roll not available at 10,000 chips');
  ok(m0.season.id==='2026-H2'&&m0.season.endsAt===Date.parse('2027-04-01T00:00:00+09:00'),'season 2026-H2 ends 2027-04-01 JST');
  for(let i=1;i<U.length;i++)await me(U[i]);
  for(let i=0;i<U.length;i++)ok((await rpc(U[i],'select public.set_nickname($1)',['ItestP'+i])).nickname==='ItestP'+i,'set_nickname P'+i);
  ok(/nickname_taken/.test(await codeOf(()=>rpc(U[1],'select public.set_nickname($1)',['itestp0']))),'nickname unique (case-insensitive)');
  ok(/nickname_invalid/.test(await codeOf(()=>rpc(U[1],'select public.set_nickname($1)',['🤖 Fake']))),'the robot mark is reserved');
  ok(/nickname_invalid/.test(await codeOf(()=>rpc(U[1],'select public.set_nickname($1)',['x'.repeat(17)]))),'nickname length');

  // ---- two humans: the table starts at once, a bot takes the third seat ----
  let r=await db.queue(U[0],'low');ok(r.game===null&&r.waiting.low===1&&typeof r.since==='number','first player waits (1 waiting)');
  r=await db.queue(U[0],'low');ok(r.game===null&&r.waiting.low===1,'repeat call keeps the entry');
  r=await db.queue(U[1],'low');const g0=r.game;ok(!!g0&&r.since===null,'second player starts the table at once');
  ok((await db.queue(U[0],'low')).game===g0,'the first player is taken to that table');
  const g0r=(await pool.query('select players from public.games where id=$1',[g0])).rows[0];
  ok(g0r.players.filter(Boolean).length===2&&g0r.players.includes(U[0])&&g0r.players.includes(U[1]),'two humans + one bot (null seat)');
  ok(await chipsOf(U[0])===9990&&await chipsOf(U[1])===9990,'both paid the buy-in');
  await closeGames();
  for(const u of U)await setChips(u,10000);

  // ---- three humans: two already waiting when a third comes (e.g. they queued in the same instant) => one table of three ----
  await pool.query("insert into public.queue(uid,stake) select unnest($1::uuid[]),'low'",[[U[0],U[1]]]);
  r=await db.queue(U[2],'low');const g1=r.game;ok(!!g1&&r.since===null,'three waiting players sit at one table');
  ok((await db.queue(U[0],'low')).game===g1&&(await db.queue(U[1],'mid')).game===g1,'a player at a table gets that table from queue');
  ok(await chipsOf(U[0])===9990&&await chipsOf(U[1])===9990&&await chipsOf(U[2])===9990,'buy-ins were paid');
  ok((await me(U[0])).game===g1,'me() shows the table');
  const gr=(await pool.query('select players,stake,multiplier,prize,status,ver from public.games where id=$1',[g1])).rows[0];
  ok(gr.players.every(Boolean)&&gr.status==='active'&&Number(gr.prize)===10*gr.multiplier,`table: ${gr.multiplier}x, prize ${gr.prize}`);
  ok((await pool.query('select count(*)::int n from public.queue where uid=any($1::uuid[])',[U])).rows[0].n===0,'queue entries removed');
  ok(/not_found/.test(await codeOf(()=>rpc(U[3],'select public.game_poll($1,-1)',[g1]))),'outsiders cannot poll a table');
  const v=await rpc(U[0],'select public.game_poll($1,-1)',[g1]);
  const txt=JSON.stringify(v.view);
  ok(!txt.includes('"deck"')&&!txt.includes('"seed"')&&v.view.holes.filter(Boolean).length===1,'view hides the deck and the other hole cards');
  ok((await rpc(U[0],'select public.game_poll($1,$2)',[g1,v.view.ver])).view===null,'poll with the same ver returns no view');
  const before=[U[0],U[1],U[2]].map(Number);void before;
  const views=await playOut(g1,[U[0],U[1],U[2]],'3 humans');
  const res=views[U[0]].meta.result,prize=res.prize;
  const total=(await Promise.all([U[0],U[1],U[2]].map(chipsOf))).reduce((a,b)=>a+b,0);
  ok(total===3*10000-30+prize,`chips: 30 buy-in paid, prize ${prize} paid to the winner (total ${total})`);
  ok(res.after.every((x,i)=>x===null||typeof x==='number')&&res.payouts.filter(x=>x>0).length===1,'result has payouts and balances');
  ok((await me(U[0])).game===null,'no table after the game');
  const rk=await rpc(U[0],'select public.ranking()');
  ok(rk.top.length===3&&rk.me&&rk.top.some(t=>t.me)&&rk.season.id==='2026-H2','ranking lists the three players');
  ok(rk.top.every((t,i)=>i===0||rk.top[i-1].chips>=t.chips),'ranking sorted by chips');

  // ---- concurrent queueing: six players at the same time => two tables, nobody in two ----
  // 'busy' (lock timeout) means "call again", as the client does. Far from the database (e.g. GitHub's runners and the
  // Singapore branch) the transactions are slow enough for six concurrent calls to time out on each other's locks.
  const queueRetry=async u=>{for(let i=0;;i++){try{return await db.queue(u,'mid')}catch(e){if(e.code!=='busy'||i>=10)throw e}}};
  await Promise.all(U.slice(0,6).map(queueRetry));
  const rs=await Promise.all(U.slice(0,6).map(queueRetry));
  // the client keeps polling while it waits; far from the database a waiter's entry can go stale (QUEUE_FRESH_MS) before the
  // other's call, so two may still be waiting after two rounds. Poll again until at most one is left.
  const waiters=async()=>(await pool.query('select uid from public.queue where uid=any($1::uuid[])',[U])).rows.map(r=>r.uid);
  for(let k=0,w=await waiters();w.length>1&&k<10;k++,w=await waiters())await Promise.all(w.map(queueRetry));
  // Counted from the database, not from the replies: a player told "waiting" may be seated by a later call in the same round.
  // Any two waiting humans start a table, so at most one is left waiting. Far from the database the rounds are slow enough
  // for that one to pass BOT_WAIT_MS and get a table with two bots, so one table may have a single human.
  const seats=(await pool.query("select id,players from public.games where status='active' and players && $1::uuid[]",[U])).rows
    .map(g=>({id:g.id,humans:g.players.filter(Boolean)}));
  const act=seats.flatMap(g=>g.humans);
  const waitingNow=(await pool.query('select count(*)::int n from public.queue where uid=any($1::uuid[])',[U])).rows[0].n;
  ok(rs.every(x=>!x.game||seats.some(g=>g.id===x.game&&g.humans.length)),'every table a player was sent to exists');
  ok(new Set(act).size===act.length,`nobody sits at two tables (${seats.map(g=>g.humans.length).join('+')} humans)`);
  ok(act.length+waitingNow===6&&waitingNow<=1,`six concurrent players: ${act.length} seated, ${waitingNow} waiting`);
  ok(seats.filter(g=>g.humans.length<2).length<=1&&seats.length>=2,'at most one table without a second human');
  await freshQueue();
  await closeGames();
  for(const u of U)await setChips(u,10000);

  // ---- humans + bots ----
  await freshQueue();
  await db.queue(U[0],'low');
  r=await db.queue(U[1],'low');const g2=r.game;ok(!!g2,'two humans: a bot fills the table at once');
  const g2r=(await pool.query('select players from public.games where id=$1',[g2])).rows[0];
  ok(g2r.players.filter(Boolean).length===2&&g2r.players.includes(U[0])&&g2r.players.includes(U[1]),'two humans + one bot (null seat)');
  const v2=(await rpc(U[0],'select public.game_poll($1,-1)',[g2])).view;
  const bn=v2.names.filter((n,i)=>v2.meta.bot[i]);
  ok(bn.length===1&&v2.meta.bot.filter(Boolean).length===1,'one bot seat (flagged in meta.bot) '+bn);
  ok((await db.queue(U[0],'low')).game===g2,'the other waiter is taken to the table too');
  await playOut(g2,[U[0],U[1]],'2 humans + bot');
  await closeGames();

  await freshQueue();
  await db.queue(U[2],'low');
  await agedQueue();
  const g3=(await db.queue(U[2],'low')).game;ok(!!g3,'a lone player gets two bots');
  const v3=(await rpc(U[2],'select public.game_poll($1,-1)',[g3])).view;
  const bn3=v3.names.filter((n,i)=>v3.meta.bot[i]);
  ok(bn3.length===2&&bn3[0]!==bn3[1],'two different bot names '+bn3);
  const c3=await chipsOf(U[2]);
  const views3=await playOut(g3,[U[2]],'1 human + 2 bots (human time-outs and bots, driven by tick)');
  const res3=views3[U[2]].meta.result;
  ok(await chipsOf(U[2])===c3+res3.payouts[views3[U[2]].meta.seat],'a human winner gets the prize; a bot win pays nothing');
  ok((await db.tick(U[2],g3).catch(e=>e.code))==='game_over','tick on a finished table is game_over');
  ok((await db.act(U[2],g3,{ver:1,move:{type:'fold'}}).catch(e=>e.code))==='game_over','act on a finished table is game_over');
  await closeGames();

  // a human who always folds is eliminated at some point; with only bots left the table ends at once
  await freshQueue();for(const u of U)await setChips(u,10000);
  await db.queue(U[5],'low');await agedQueue();
  const g4=(await db.queue(U[5],'low')).game;
  const v4=await playOut(g4,[U[5]],'always-folding human + 2 bots',{fold:true});
  ok(v4[U[5]].meta.result!==null&&v4[U[5]].meta.result.after[v4[U[5]].meta.seat]===await chipsOf(U[5]),'result of the finished table has the balance');
  await closeGames();

  // an eliminated human on a table that is still running: free to queue again, can still watch
  await freshQueue();for(const u of U)await setChips(u,10000);
  await db.queue(U[0],'low');await db.queue(U[1],'low');await agedQueue();
  const g5=(await db.queue(U[0],'low')).game;
  const seat0=(await pool.query('select players from public.games where id=$1',[g5])).rows[0].players.indexOf(U[0]);
  await pool.query(`update public.games set state=jsonb_set(state,'{g,places}',(state->'g'->'places')||'[]'::jsonb) where id=$1`,[g5]);
  await pool.query(`update public.games set state=jsonb_set(state,array['g','places',$2::text],'3') where id=$1`,[g5,String(seat0)]);
  ok((await me(U[0])).game===null&&(await me(U[1])).game===g5,'me().game: only for a player who is still in');
  ok((await rpc(U[0],'select public.game_poll($1,-1)',[g5])).view!==null,'the eliminated player can still watch (game_poll)');
  ok(await codeOf(()=>db.act(U[0],g5,{ver:0,move:{type:'fold'}}))!=='game_over','the table is still active for the eliminated player');
  r=await db.queue(U[0],'low');ok(r.game===null&&r.waiting.low===1,'the eliminated player can queue again (no old table returned)');
  ok((await db.queue(U[1],'low')).game===g5,'a player still in is taken back to the table');
  await freshQueue();await closeGames();

  // ---- entry rules ----
  await freshQueue();
  await setChips(U[3],5);
  ok(await codeOf(()=>db.queue(U[3],'low'))==='insufficient_chips','5 chips: Low is refused');
  ok(await codeOf(()=>db.queue(U[3],'high'))==='insufficient_chips','5 chips: High is refused');
  await setChips(U[4],2999);
  ok(await codeOf(()=>db.queue(U[4],'extreme'))==='insufficient_chips','2,999 chips: Extreme is refused');
  ok(await codeOf(()=>db.queue(U[1],'free'))==='freeroll_unavailable','10,000 chips: free-roll refused');
  ok(await codeOf(()=>db.queue(U[1],'vip'))==='illegal','unknown stake');
  const m3=await me(U[3]);ok(m3.freeroll.eligible&&m3.freeroll.left===3,'free-roll is available at 5 chips');
  await setChips(U[4],3000);
  await db.queue(U[4],'extreme');await pool.query("update public.queue set since=now()-interval '1 minute' where uid=$1",[U[4]]);
  const gh=(await db.queue(U[4],'extreme')).game;ok(!!gh&&await chipsOf(U[4])===0,'Extreme is open from the start and costs 3,000');
  await closeGames();

  // ---- free-roll: three a day ----
  for(let i=1;i<=3;i++){
    await db.queue(U[3],'free');await pool.query("update public.queue set since=now()-interval '1 minute' where uid=$1",[U[3]]);
    const gf=(await db.queue(U[3],'free')).game;ok(!!gf,`free-roll ${i} starts`);
    const vf=(await rpc(U[3],'select public.game_poll($1,-1)',[gf])).view;
    ok(vf.meta.multiplier===null&&vf.meta.prize===500&&vf.meta.buyIn===0,'free-roll: no multiplier, prize 500');
    ok(await chipsOf(U[3])===5,'free-roll costs nothing');
    await closeGames();
  }
  ok((await me(U[3])).freeroll.left===0,'free-roll count used up');
  ok(await codeOf(()=>db.queue(U[3],'free'))==='freeroll_unavailable','4th free-roll of the day is refused');
  await pool.query("update public.profiles set freeroll_day=freeroll_day-1 where uid=$1",[U[3]]);
  ok((await me(U[3])).freeroll.left===3,'the count resets on the next JST day');

  // ---- leave ----
  await freshQueue();
  await db.queue(U[0],'low');ok((await db.leave(U[0])).ok===true,'leave');
  ok((await db.queue(U[1],'low')).waiting.low===1,'a player who left is not counted');
  ok((await pool.query('select count(*)::int n from public.queue where uid=$1',[U[0]])).rows[0].n===0,'queue entry deleted');
  await freshQueue();

  // ---- stale queue entries are not matched ----
  await pool.query("insert into public.queue(uid,stake,seen_at) select unnest($1::uuid[]),'low',now()-interval '10 seconds'",[[U[0],U[1]]]);
  r=await db.queue(U[2],'low');ok(r.game===null&&r.waiting.low===1,'entries not seen for 6 s do not count');
  await freshQueue();

  // ---- purge: 7 days after the last change; an abandoned active table gives the buy-ins back ----
  for(const u of U.slice(0,3))await setChips(u,10000);
  await db.queue(U[0],'low');const gp=(await db.queue(U[1],'low')).game;
  const gold=(await pool.query(`insert into public.games(id,players,stake,multiplier,prize,status,state,ver,views,updated_at)
    values(gen_random_uuid(),$1::uuid[],'low',2,20,'over','{}',1,'[]',now()-interval '8 days') returning id`,[[U[4],null,null]])).rows[0].id;
  await pool.query("update public.games set updated_at=now()-interval '8 days' where id=$1",[gp]);
  const c0=await chipsOf(U[0]);
  await me(U[0]);
  const left=(await pool.query('select id from public.games where id=any($1::uuid[])',[[gp,gold]])).rows;
  ok(left.length===0,'me() deletes games untouched for 7 days');
  ok(await chipsOf(U[0])===c0+10&&await chipsOf(U[1])===9990+10,'buy-ins of the abandoned table were given back');
  ok((await me(U[0])).game===null,'abandoned table no longer blocks the player');

  // ---- season roll-over ----
  await pool.query("update public.profiles set played=1 where uid=any($1::uuid[])",[U]);
  for(let i=0;i<U.length;i++)await setChips(U[i],20000-i*1000);
  await pool.query("update public.seasons set id='2026-H1',starts_at='2026-04-01 00:00+09',ends_at='2026-10-01 00:00+09' where id='2026-H2'");
  const mr=await me(U[0]);
  ok(mr.season.id==='2026-H2'&&mr.chips===10000&&mr.freeroll.used===0,'season rolled over: new season 2026-H2, chips back to 10,000');
  const hall=await rpc(U[0],'select public.hall_of_fame()');
  ok(hall.length===1&&hall[0].season==='2026-H1'&&hall[0].top.length>=1,'hall of fame records the closed season');
  const mine=hall[0].top.filter(t=>/^ItestP/.test(t.nickname));
  ok(mine.length>=1&&mine[0].chips>=mine[mine.length-1].chips&&hall[0].top.every((t,i)=>t.rank===i+1)&&hall[0].top.length<=10,'top 10 by chips, rank 1..n');
  ok((await pool.query("select count(*)::int n from public.seasons where not closed")).rows[0].n===1,'exactly one open season');
  const rk2=await rpc(U[0],'select public.ranking()');ok(rk2.top.length===0&&rk2.me===null,'ranking starts empty after the reset (nobody has played yet)');
  // put the seasons back (the roll-over created a new 2026-H2 identical to the original)
  await pool.query("delete from public.hall_of_fame where season='2026-H1'");
  await pool.query("delete from public.seasons where id='2026-H1'");
}finally{await clean();await pool.end()}
console.log('すべて成功');
