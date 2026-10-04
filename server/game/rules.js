// Multiplier game rules on top of the engine (docs/ARCHITECTURE.md §6): table creation (multiplier / prize / structure),
// the turn clock (turn time, time bank, strikes, sit-out), bot turns, applying a request to a stored game, hidden-info views,
// settlement. Pure functions only: no I/O, no clock reads (`now` and `rnd` come in), so fakeNet can run this in the browser.
//
// A stored game is `{ state, meta }`:
//   state = the engine state `g` (JSON, includes the deck: server only)
//   meta  = { stake, buyIn, multiplier, prize, bots: [null | { persona }] x3 (private), clock, result }
//   clock = { turnStart, deadline, timebank: [ms x3], strikes: [x3], botAt }
import{newGame,actor,applyAction,autoAction,forfeit,EngineError}from'../../src/engine.js';
import{viewFor}from'../../src/view.js';
import{STAKES,FREEROLL,drawMultiplier,structureFor}from'../../src/spin.js';

export const TURN_MS=15000,TIMEBANK_MS=30000,GRACE_MS=1500,REVEAL_MS=3500,WHEEL_MS=6000,WHEEL_BIG_MS=9500;
/** time the client's multiplier wheel may take before the first turn clock starts (×100 and above run a ~8 s show) */
export const wheelMsFor=multiplier=>multiplier!=null&&multiplier>=100?WHEEL_BIG_MS:WHEEL_MS;
export const BOT_WAIT_MS=15000,QUEUE_FRESH_MS=6000,SITOUT_MS=1500,MAX_STRIKES=2;
export const BOT_THINK_MS=[900,2600];
export const STAKE_KEYS=['low','mid','high','free'];

export class MoveError extends Error{
  constructor(code,extra){super(code);this.code=code;this.extra=extra}
}

const clone=x=>structuredClone(x);
export function shuffle(a,rnd){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}

// Bot display names: common first names from several countries, unrelated to the persona (2026-10-04 さつき「ありそうな外国人の名前」).
// The UI marks bot seats with a "Bot" text tag from meta.bot.
export const BOT_NAMES=['Liam','Noah','Oliver','Lucas','Mateo','Leo','Hugo','Elias','Felix','Jonas','Luca','Marco','Diego','Pablo','Rafael',
  'Mason','Ethan','Owen','Jack','Henry','Emma','Olivia','Sophia','Mia','Chloe','Lena','Clara','Sofia','Lucia','Elena',
  'Nora','Ava','Isla','Maya','Zoe','Hanna','Ingrid','Freya','Aria','Julia'];
/** n different bot names */
export const botNames=(n,rnd)=>shuffle(BOT_NAMES,rnd).slice(0,n);

/** buy-in of a stake key (free = 0) */
export const buyInOf=stake=>stake==='free'?0:STAKES[stake].buyIn;

/** Can this player enter `stake`? Throws MoveError(locked_stake | insufficient_chips | freeroll_unavailable).
 *  p = { chips, frUsedToday } (frUsedToday = free-roll entries so far today in JST) */
export function checkEntry(p,stake){
  if(!STAKE_KEYS.includes(stake))throw new MoveError('illegal');
  if(stake==='free'){
    if(p.chips>=FREEROLL.eligibleBelow||p.frUsedToday>=FREEROLL.perDay)throw new MoveError('freeroll_unavailable');
    return;
  }
  const s=STAKES[stake];
  if(p.chips<s.minChips||p.chips<s.buyIn)throw new MoveError(s.minChips>s.buyIn?'locked_stake':'insufficient_chips');
}

// a deterministic "random" in [0,1) from small integers (bot think time must be the same wherever it is computed)
function hash01(...xs){let h=2166136261;for(const x of xs){h^=x|0;h=Math.imul(h,16777619);h^=h>>>15}return((h>>>0)%100000)/100000}
const thinkMs=(ver,seat)=>Math.round(BOT_THINK_MS[0]+hash01(ver,seat,7)*(BOT_THINK_MS[1]-BOT_THINK_MS[0]));

const isBot=(meta,seat)=>Boolean(meta.bots[seat]);
const isSitOut=(clock,seat)=>clock.strikes[seat]>=MAX_STRIKES;

// the clock for whoever acts next in `state`, starting at `at`
function clockAt(state,meta,clock,at){
  if(state.over)return{...clock,turnStart:at,deadline:null,botAt:null};
  const a=actor(state);
  if(a===null||a===undefined)return{...clock,turnStart:at,deadline:null,botAt:null};
  if(isBot(meta,a))return{...clock,turnStart:at,deadline:at+TURN_MS+TIMEBANK_MS,botAt:at+thinkMs(state.ver,a)};
  const deadline=isSitOut(clock,a)?at+SITOUT_MS:at+TURN_MS+clock.timebank[a];
  return{...clock,turnStart:at,deadline,botAt:null};
}

/** Create a table. players: [{ uid|null, name, bot: null|{persona} } x3]. => { state, meta } (meta.clock starts after the wheel) */
// forceMultiplier: development/tests only (fakeNet &mult=); the server always draws
export function createTable({players,stake,now,rnd,forceMultiplier=null}){
  if(!Array.isArray(players)||players.length!==3)throw new Error('createTable: 3 players required');
  if(!STAKE_KEYS.includes(stake))throw new Error('createTable: bad stake '+stake);
  const free=stake==='free',buyIn=buyInOf(stake);
  const multiplier=free?null:forceMultiplier??drawMultiplier(stake,rnd);
  const prize=free?FREEROLL.prize:buyIn*multiplier;
  const{stack,levelMs}=structureFor(multiplier);
  const state=newGame({stack,levelMs,now,rnd,names:players.map(p=>p.name)});
  const meta={
    stake,buyIn,multiplier,prize,
    bots:players.map(p=>p.bot?{persona:p.bot.persona}:null),
    clock:{turnStart:now,deadline:null,timebank:[TIMEBANK_MS,TIMEBANK_MS,TIMEBANK_MS],strikes:[0,0,0],botAt:null},
    result:null,
  };
  meta.clock=clockAt(state,meta,meta.clock,now+wheelMsFor(multiplier));
  return{state,meta};
}

const MOVES=['fold','check','call','raise'];
function toEngineMove(m){
  if(!m||typeof m!=='object'||!MOVES.includes(m.type))throw new MoveError('illegal');
  if(m.type==='raise'){if(!Number.isInteger(m.to))throw new MoveError('illegal');return{type:'raise',to:m.to}}
  return{type:m.type};
}
function engineCall(fn){
  try{return fn()}catch(e){
    if(e instanceof MoveError)throw e;
    if(e instanceof EngineError)throw new MoveError(['not_your_turn','game_over'].includes(e.code)?e.code:'illegal');
    throw new MoveError('illegal');
  }
}

// the clock after `seat` acted at `now` (kind: 'act' = a real move, 'timeout' = a substitute move for a human, 'bot')
function afterMove(before,state,now,seat,kind){
  const meta=before.meta,c=before.meta.clock;
  const timebank=[...c.timebank],strikes=[...c.strikes];
  if(kind==='act'){
    const excess=Math.max(0,now-c.turnStart-TURN_MS);
    timebank[seat]=Math.max(0,timebank[seat]-excess);
    strikes[seat]=0;
  }else if(kind==='timeout'&&strikes[seat]<MAX_STRIKES){
    strikes[seat]++;timebank[seat]=0;
  }
  const bonus=!state.over&&state.handNo!==before.state.handNo?REVEAL_MS:0;
  return clockAt(state,meta,{...c,timebank,strikes},now+bonus);
}

// a human retires: the seat leaves the tournament at once (see engine forfeit). Works on any turn. The buy-in is not refunded and nothing is paid.
function retire(game,seat,now){
  if(game.state.over)throw new MoveError('game_over');
  if(!Number.isInteger(seat)||seat<0||seat>2||game.meta.bots[seat])throw new MoveError('not_found');
  if(game.state.places[seat]!==null)throw new MoveError('already_out');
  const before=game.state,g=clone(before);
  engineCall(()=>forfeit(g,seat,now));
  // the player to act (and so the running turn clock) stays as it is unless the retire changed the hand
  const same=!g.over&&actor(g)===actor(before)&&g.handNo===before.handNo&&g.street===before.street;
  return{state:g,clock:same?game.meta.clock:afterMove(game,g,now,seat,'retire')};
}

/** Apply a human's request. game = { state, meta }; req = { op:'act', ver, move } or { op:'retire' }. => { state, clock }. Throws MoveError.
 *  The stored game is not mutated. */
export function applyRequest(game,seat,req,now){
  if(req&&req.op==='retire')return retire(game,seat,now);
  if(!req||req.op!=='act')throw new MoveError('illegal');
  if(game.state.over)throw new MoveError('game_over');
  if(!Number.isInteger(seat)||seat<0||seat>2||game.meta.bots[seat])throw new MoveError('not_your_turn');
  if(req.ver!==game.state.ver)throw new MoveError('stale');
  if(actor(game.state)!==seat)throw new MoveError('not_your_turn');
  const move=toEngineMove(req.move),g=clone(game.state);
  engineCall(()=>applyAction(g,seat,move,now));
  return{state:g,clock:afterMove(game,g,now,seat,'act')};
}

/** Advance a game by one step if something is due: the bot to act has passed botAt (the bot plays), or a human has passed
 *  deadline + GRACE (substitute move, strike +1; a sitting-out human is handled SITOUT_MS after the turn starts).
 *  Throws MoveError('not_yet') if nothing is due, 'game_over' if finished. => { state, clock } */
export function tick(game,now,{botMove,rnd=Math.random}={}){
  if(game.state.over)throw new MoveError('game_over');
  const seat=actor(game.state),{meta}=game,c=meta.clock;
  if(seat===null||seat===undefined)throw new MoveError('not_yet');
  const g=clone(game.state);
  if(isBot(meta,seat)){
    if(now<(c.botAt??0))throw new MoveError('not_yet');
    let ok=false;
    try{
      const mv=botMove(viewFor(game.state,seat),seat,{persona:meta.bots[seat].persona,rnd});
      applyAction(g,seat,toEngineMove(mv),now);ok=true;
    }catch{/* a broken bot move never stalls the table */}
    if(!ok){const g2=clone(game.state);autoAction(g2,seat,now);return{state:g2,clock:afterMove(game,g2,now,seat,'bot')}}
    return{state:g,clock:afterMove(game,g,now,seat,'bot')};
  }
  const due=c.deadline===null?Infinity:isSitOut(c,seat)?c.deadline:c.deadline+GRACE_MS;
  if(now<due)throw new MoveError('not_yet');
  engineCall(()=>autoAction(g,seat,now));
  return{state:g,clock:afterMove(game,g,now,seat,'timeout')};
}

/** the public part of meta for one seat */
export function publicMeta(meta,seat){
  return{stake:meta.stake,buyIn:meta.buyIn,multiplier:meta.multiplier,prize:meta.prize,
    bot:meta.bots.map(Boolean),clock:meta.clock,result:meta.result,seat};
}

/** the three views (what each seat may see) */
export function viewsOf(state,meta){
  return[0,1,2].map(seat=>({...viewFor(state,seat),meta:publicMeta(meta,seat)}));
}

/** At the end of a game: the winner takes the prize if human (a bot's win removes the chips). Buy-ins were paid at the start.
 *  => { payouts: [chips x3], result } where result = { stake, buyIn, multiplier, prize, places, winner, payouts } (the DB layer adds `after`) */
export function settle(state,meta){
  const winner=state.winner;
  const payouts=[0,1,2].map(s=>s===winner&&!meta.bots[s]?meta.prize:0);
  return{payouts,result:{stake:meta.stake,buyIn:meta.buyIn,multiplier:meta.multiplier,prize:meta.prize,
    places:[...state.places],winner,payouts}};
}

/** Is this seat a human who is still in the tournament (not eliminated)? */
export const humanAlive=(state,meta,seat)=>!meta.bots[seat]&&state.places[seat]===null;

/** When no human is left (only bots remain) nobody is waiting for the table: finish it at once. The bots get the remaining
 *  places by chips (including chips already in the pot; ties: lower seat first), the first of them is the winner and, being a bot,
 *  is paid nothing. Returns a new state (the argument is not mutated). */
export function finishBotsOnly(state){
  const g=clone(state);
  const left=[0,1,2].filter(s=>g.places[s]===null)
    .sort((a,b)=>(g.seats[b].stack+g.total[b])-(g.seats[a].stack+g.total[a])||a-b);
  left.forEach((s,i)=>{g.places[s]=i+1});
  g.winner=left[0];g.over=true;g.toAct=null;g.holes=[null,null,null];
  g.log.push({text:'{'+left[0]+'} wins the tournament'});
  return g;
}

/** Fold a step ({state, clock} from applyRequest / tick) into the stored game: new meta, and when the game ended its result.
 *  A table with no human left is ended here (see finishBotsOnly).
 *  => { state, meta, payouts|null }. The caller credits `payouts`, may set meta.result.after, then calls viewsOf. */
export function commit(game,step){
  const meta={...game.meta,clock:step.clock};
  let state=step.state;
  if(!state.over&&![0,1,2].some(s=>humanAlive(state,meta,s))){
    state=finishBotsOnly(state);
    meta.clock={...meta.clock,deadline:null,botAt:null};
  }
  if(!state.over)return{state,meta,payouts:null};
  const s=settle(state,meta);
  meta.result=s.result;
  return{state,meta,payouts:s.payouts};
}
