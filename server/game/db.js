// Database side of the game server (runs as the database owner through DATABASE_URL). One request = one transaction.
//   queue : advisory lock per stake -> profiles locked in uid order -> matching / bot fill -> buy-in -> INSERT games
//   leave : delete from the queue
//   act / retire / tick : the games row is locked (for update); on the last move the prize is credited in the same transaction
// Lock order everywhere: season lock -> stake lock -> profiles (sorted by uid, FOR NO KEY UPDATE) ; act: games row -> profiles.
import{randomUUID}from'node:crypto';
import{
  MoveError,STAKE_KEYS,QUEUE_FRESH_MS,BOT_WAIT_MS,MATCH_HUMANS,
  botNames,buyInOf,checkEntry,shuffle,createTable,applyRequest,tick,viewsOf,commit,
}from'./rules.js';
import{botMove as defaultBotMove,PERSONAS}from'../../src/bot.js';

const LOCK_TIMEOUT='5s';
const FRESH='seen_at > now() - make_interval(secs => $1::float8 / 1000)';

// a better random than Math.random for shuffling decks (53 bits)
const secureRnd=()=>{const a=crypto.getRandomValues(new Uint32Array(2));return((a[0]>>>5)*67108864+(a[1]>>>6))/9007199254740992};

async function tx(pool,fn){
  const c=await pool.connect();
  try{
    await c.query('begin');
    await c.query(`set local lock_timeout='${LOCK_TIMEOUT}'`);
    const r=await fn(c);
    await c.query('commit');
    return r;
  }catch(e){
    await c.query('rollback').catch(()=>{});
    // lock timeout / deadlock / serialization failure: the caller just retries
    if(e&&['55P03','40P01','40001'].includes(e.code))throw new MoveError('busy');
    throw e;
  }finally{c.release()}
}

const num=x=>x===null||x===undefined?null:Number(x);

export function makeDb(pool,deps={}){
  const now=deps.now??Date.now,rnd=deps.rnd??secureRnd,botMove=deps.botMove??defaultBotMove;

  // counts of fresh waiting players per stake
  async function waitingCounts(c){
    const r=await c.query(`select stake,count(*)::int as n from public.queue where ${FRESH} group by stake`,[QUEUE_FRESH_MS]);
    const w=Object.fromEntries(STAKE_KEYS.map(k=>[k,0]));for(const x of r.rows)w[x.stake]=x.n;
    return w;
  }

  // write a step of a game back: credit the prize if it ended, store state / meta / views. Returns what the caller replies.
  async function save(c,row,seat,step){
    const out=commit({state:row.g,meta:row.meta},step),{state,meta}=out;
    if(out.payouts){
      const humans=row.players.map((u,i)=>({u,i})).filter(x=>x.u).sort((a,b)=>a.u<b.u?-1:a.u>b.u?1:0);
      await c.query('select 1 from public.profiles where uid=any($1::uuid[]) order by uid for no key update',[humans.map(h=>h.u)]);
      const after=[null,null,null];
      for(const h of humans){
        const r=await c.query('update public.profiles set chips=chips+$2,played=played+1 where uid=$1 returning chips',[h.u,out.payouts[h.i]]);
        after[h.i]=r.rows[0]?num(r.rows[0].chips):null;
      }
      meta.result={...meta.result,after};
    }
    const views=viewsOf(state,meta);
    await c.query(`update public.games set state=$2,ver=$3,views=$4,deadline_ms=$5,bot_at_ms=$6,status=$7,winner=$8,updated_at=now() where id=$1`,
      [row.id,JSON.stringify({g:state,meta}),state.ver,JSON.stringify(views),meta.clock.deadline,meta.clock.botAt,state.over?'over':'active',state.over?state.winner:null]);
    return{ver:state.ver,now:now(),view:views[seat]};
  }

  async function loadGame(c,uid,gameId){
    const r=await c.query('select id,players,status,state from public.games where id=$1 for update',[gameId]);
    const row=r.rows[0];
    const seat=row?row.players.indexOf(uid):-1;
    if(seat<0)throw new MoveError('not_found');
    if(row.status!=='active')throw new MoveError('game_over');
    return{seat,row:{id:row.id,players:row.players,g:row.state.g,meta:row.state.meta}};
  }

  return{
    // enter the queue of a stake (or refresh the entry). Returns the waiting counts and, when a table was made for the caller (or the
    // caller already has one in progress), its id.
    queue:(uid,stake)=>tx(pool,async c=>{
      if(!STAKE_KEYS.includes(stake))throw new MoveError('illegal');
      await c.query('select public.season_rollover()');
      await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',['queue:'+stake]);
      const reply=async(game,since)=>({waiting:await waitingCounts(c),since,game,now:now()});

      // lock the profiles that may take part (the caller and the earliest waiting players) in uid order
      const oth=await c.query(`select uid from public.queue where stake=$2 and uid<>$3 and ${FRESH} order by since,uid limit 3`,[QUEUE_FRESH_MS,stake,uid]);
      const set=[uid,...oth.rows.map(r=>r.uid)].sort();
      const pr=await c.query(`select uid,nickname,chips,freeroll_used,(freeroll_day=(now() at time zone 'Asia/Tokyo')::date) as fr_today
        from public.profiles where uid=any($1::uuid[]) order by uid for no key update`,[set]);
      const P=new Map(pr.rows.map(r=>[r.uid,{uid:r.uid,nickname:r.nickname,chips:Number(r.chips),frUsedToday:r.fr_today?r.freeroll_used:0}]));
      if(!P.has(uid))throw new MoveError('no_profile');

      // already at a table: go there
      // (a player who has been eliminated from a table that is still running is free to queue again)
      const act=await c.query("select id,players,state->'g'->'places' as places from public.games where status='active' and players && $1::uuid[]",[set]);
      const seated=act.rows.flatMap(r=>r.players.map((u,i)=>u&&r.places[i]===null?{u,id:r.id}:null).filter(Boolean));
      const mine=seated.find(x=>x.u===uid);
      if(mine){await c.query('delete from public.queue where uid=$1',[uid]);return reply(mine.id,null)}
      const busy=new Set(seated.map(x=>x.u));

      checkEntry(P.get(uid),stake);
      const q=await c.query(`insert into public.queue as q(uid,stake) values($1,$2)
        on conflict (uid) do update set seen_at=now(),stake=excluded.stake,since=case when q.stake=excluded.stake then q.since else now() end
        returning (extract(epoch from since)*1000)::float8 as since_ms,(extract(epoch from now()-since)*1000)::float8 as waited_ms`,[uid,stake]);
      const since=q.rows[0].since_ms,waited=q.rows[0].waited_ms;

      // the (up to) three earliest fresh waiters; anybody who can no longer enter is dropped from the queue
      const fresh=await c.query(`select uid from public.queue where stake=$2 and ${FRESH} order by since,uid limit 4`,[QUEUE_FRESH_MS,stake]);
      const group=[];
      for(const r of fresh.rows){
        const p=P.get(r.uid);
        let okp=Boolean(p)&&!busy.has(r.uid);
        if(okp)try{checkEntry(p,stake)}catch{okp=false}
        if(okp){if(group.length<3)group.push(p)}
        else if(r.uid!==uid)await c.query('delete from public.queue where uid=$1',[r.uid]);
      }
      const self=group.includes(P.get(uid));
      // MATCH_HUMANS players make a table at once; a lone player gets bots after BOT_WAIT_MS
      if(group.length<MATCH_HUMANS&&!(self&&waited>=BOT_WAIT_MS))return reply(null,since);

      // make the table: humans first, bots to fill, seats shuffled
      const personas=shuffle(PERSONAS,rnd).slice(0,3-group.length),bn=botNames(personas.length,rnd);
      const players=shuffle([
        ...group.map(p=>({uid:p.uid,name:p.nickname,bot:null})),
        ...personas.map((pe,i)=>({uid:null,name:bn[i],bot:{persona:pe}})),
      ],rnd);
      const t=createTable({players,stake,now:now(),rnd});
      const humans=group.map(p=>p.uid);
      if(stake==='free'){
        await c.query(`update public.profiles set freeroll_used=case when freeroll_day=(now() at time zone 'Asia/Tokyo')::date then freeroll_used+1 else 1 end,
          freeroll_day=(now() at time zone 'Asia/Tokyo')::date where uid=any($1::uuid[])`,[humans]);
      }else{
        await c.query('update public.profiles set chips=chips-$2 where uid=any($1::uuid[])',[humans,buyInOf(stake)]);
      }
      const id=randomUUID(),views=viewsOf(t.state,t.meta);
      await c.query(`insert into public.games(id,players,stake,multiplier,prize,status,state,ver,views,deadline_ms,bot_at_ms)
        values($1,$2::uuid[],$3,$4,$5,'active',$6,$7,$8,$9,$10)`,
        [id,players.map(p=>p.uid),stake,t.meta.multiplier,t.meta.prize,JSON.stringify({g:t.state,meta:t.meta}),t.state.ver,JSON.stringify(views),t.meta.clock.deadline,t.meta.clock.botAt]);
      await c.query('delete from public.queue where uid=any($1::uuid[])',[humans]);
      return reply(self?id:null,self?null:since);
    }),

    leave:uid=>tx(pool,async c=>{
      await c.query('delete from public.queue where uid=$1',[uid]);
      return{ok:true};
    }),

    // a move by a player at the table
    act:(uid,gameId,body)=>tx(pool,async c=>{
      const{seat,row}=await loadGame(c,uid,gameId);
      const step=applyRequest({state:row.g,meta:row.meta},seat,{op:'act',ver:body.ver,move:body.move},now());
      return save(c,row,seat,step);
    }),

    // the player leaves the tournament now (buy-in stays spent). Works on any turn; the game row is saved like after a move, which frees the
    // player (places set) and finishes a table that has no human left.
    retire:(uid,gameId)=>tx(pool,async c=>{
      const{seat,row}=await loadGame(c,uid,gameId);
      const step=applyRequest({state:row.g,meta:row.meta},seat,{op:'retire'},now());
      return save(c,row,seat,step);
    }),

    // advance the table by one step when something is due (a bot's turn, a time-out). Any human at the table may call it.
    tick:(uid,gameId)=>tx(pool,async c=>{
      const{seat,row}=await loadGame(c,uid,gameId);
      const step=tick({state:row.g,meta:row.meta},now(),{botMove,rnd});
      return save(c,row,seat,step);
    }),
  };
}
