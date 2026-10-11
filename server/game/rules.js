// Multiplier game rules on top of the engine (docs/ARCHITECTURE.md §6): table creation (multiplier / prize / structure),
// the turn clock (turn time, time bank, strikes, sit-out), bot turns, applying a request to a stored game, hidden-info views,
// settlement. Pure functions only: no I/O, no clock reads (`now` and `rnd` come in), so fakeNet can run this in the browser.
//
// A stored game is `{ state, meta }`:
//   state = the engine state `g` (JSON, includes the deck: server only)
//   meta  = { stake, buyIn, multiplier, prize, room: code | null (private table), bots: [null | { persona }] x3 (private), clock, result,
//             fx: [slug | null] x3 | null (winner GIFs, private tables only), hostSeat (private), rematch (private, after the end) }
//   clock = { turnStart, deadline, timebank: [ms x3], strikes: [x3], botAt }
import{newGame,actor,applyAction,autoAction,forfeit,EngineError}from'../../src/engine.js';
import{viewFor}from'../../src/view.js';
import{STAKES,FREEROLL,drawMultiplier,structureFor}from'../../src/spin.js';
import{runoutMs,FX_MS}from'../../src/pace.js';
import{fxSeat,normalizeFx}from'../../src/fx.js';
import{normalizeChat,CHAT_MIN_INTERVAL_MS}from'../../src/chat.js';

export const TURN_MS=15000,TIMEBANK_MS=30000,GRACE_MS=1500,REVEAL_MS=3500,WHEEL_MS=6000,WHEEL_BIG_MS=9500;
/** time the client's multiplier wheel may take before the first turn clock starts (×100 and above run a ~8 s show) */
export const wheelMsFor=multiplier=>multiplier!=null&&multiplier>=100?WHEEL_BIG_MS:WHEEL_MS;
// a table starts as soon as MATCH_HUMANS players wait at a stake (the empty seat goes to a bot; 2026-10-05 さつき「2人でもマッチング」)
export const MATCH_HUMANS=2;
export const BOT_WAIT_MS=15000,QUEUE_FRESH_MS=6000,SITOUT_MS=1500,MAX_STRIKES=2;
export const BOT_THINK_MS=[900,2600];
export const STAKE_KEYS=[...Object.keys(STAKES),'free'];
// private tables: after the end the players may stay at the table and start a rematch (same stake, same people; an empty seat is a bot)
export const REMATCH_MS=10*60000,REMATCH_HOST_WAIT_MS=60000;

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

/** The three players of a new table: the humans ([{ uid, name }]) and bots for the empty seats (personas: src/bot.js PERSONAS; not
 *  imported here so the browser bundle, which uses rooms.js, does not carry the bot), seats shuffled.
 *  => [{ uid|null, name, bot: null|{persona} } x3] (what createTable takes) */
export function seatPlayers(humans,rnd,PERSONAS){
  const personas=shuffle(PERSONAS,rnd).slice(0,3-humans.length),bn=botNames(personas.length,rnd);
  return shuffle([
    ...humans.map(p=>({uid:p.uid,name:p.name,bot:null,fx:p.fx??null,host:!!p.host})),
    ...personas.map((pe,i)=>({uid:null,name:bn[i],bot:{persona:pe}})),
  ],rnd);
}

/** buy-in of a stake key (free = 0) */
export const buyInOf=stake=>stake==='free'?0:STAKES[stake].buyIn;

/** Can this player enter `stake`? Throws MoveError(insufficient_chips | freeroll_unavailable).
 *  p = { chips, frUsedToday } (frUsedToday = free-roll entries so far today in JST) */
export function checkEntry(p,stake){
  if(!STAKE_KEYS.includes(stake))throw new MoveError('illegal');
  if(stake==='free'){
    if(p.chips>=FREEROLL.eligibleBelow||p.frUsedToday>=FREEROLL.perDay)throw new MoveError('freeroll_unavailable');
    return;
  }
  if(p.chips<STAKES[stake].buyIn)throw new MoveError('insufficient_chips');
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

/** Create a table. players: [{ uid|null, name, bot: null|{persona}, fx?, host? } x3]. room: the code of a private table (null from the queue);
 *  only a private table keeps the players' winner GIFs (fx) and the host's seat. => { state, meta } (meta.clock starts after the wheel) */
// forceMultiplier: development/tests only (fakeNet &mult=); the server always draws
export function createTable({players,stake,now,rnd,room=null,forceMultiplier=null}){
  if(!Array.isArray(players)||players.length!==3)throw new Error('createTable: 3 players required');
  if(!STAKE_KEYS.includes(stake))throw new Error('createTable: bad stake '+stake);
  const free=stake==='free',buyIn=buyInOf(stake);
  const multiplier=free?null:forceMultiplier??drawMultiplier(stake,rnd);
  const prize=free?FREEROLL.prize:buyIn*multiplier;
  const{stack,levelMs}=structureFor(multiplier);
  const state=newGame({stack,levelMs,now,rnd,names:players.map(p=>p.name)});
  const meta={
    stake,buyIn,multiplier,prize,room,
    bots:players.map(p=>p.bot?{persona:p.bot.persona}:null),
    clock:{turnStart:now,deadline:null,timebank:[TIMEBANK_MS,TIMEBANK_MS,TIMEBANK_MS],strikes:[0,0,0],botAt:null},
    result:null,
    fx:room?players.map(p=>(p.bot?null:normalizeFx(p.fx??null))):null,
    hostSeat:room?Math.max(0,players.findIndex(p=>p.host)):null,
    rematch:null,
    moveVer:state.ver,   // the last version that changed the play (applyRequest: an older move is stale; meta-only steps do not move it)
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
  return clockAt(state,meta,{...c,timebank,strikes},now+revealBonus(before.state,state,meta));
}

/** Time the screen takes to show a finished hand before the next turn clock starts: the result (REVEAL_MS, which also covers dealing the next
 *  hand), the showdown run-out (src/pace.js runoutMs) and the winner's GIF (private tables). h = a finished hand (engine lastHand) */
export const revealMsOf=(h,fx)=>REVEAL_MS+runoutMs(h.runFrom)+(fxSeat(h,fx)!=null?FX_MS:0);
/** the hands that finished between `before` and `state` (usually one; hands all-in from the blinds can chain), oldest first */
export const finishedHands=(before,state)=>[...(state.prevHands||[]),state.lastHand].filter(h=>h&&h.handNo>=before.handNo&&(!before.lastHand||h.handNo>before.lastHand.handNo));
function revealBonus(before,state,meta){
  if(state.over||state.handNo===before.handNo)return 0;
  return finishedHands(before,state).reduce((t,h)=>t+revealMsOf(h,meta.fx),0);
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

// a step that only changes meta (seat state, GIF, rematch): the state gets a new version so that every seat's poll picks the views up.
// A move made against the version before it is still taken (commit keeps meta.moveVer at the last version that changed the play, see applyRequest)
function metaStep(game,patch){
  const g=clone(game.state);g.ver++;
  return{state:g,clock:patch.clock??game.meta.clock,meta:patch};
}
const humanSeat=(game,seat)=>Number.isInteger(seat)&&seat>=0&&seat<=2&&!game.meta.bots[seat];

// Away (sit out) / I'm back. Sitting out = MAX_STRIKES: the turn is played for the seat SITOUT_MS after it starts. Coming back gives the running
// turn its normal time again.
function seatState(game,seat,away,now){
  if(game.state.over)throw new MoveError('game_over');
  if(!humanSeat(game,seat))throw new MoveError('not_found');
  if(game.state.places[seat]!==null)throw new MoveError('already_out');
  const c=game.meta.clock,strikes=[...c.strikes];
  if(away===(strikes[seat]>=MAX_STRIKES))return metaStep(game,{clock:c});
  strikes[seat]=away?MAX_STRIKES:0;
  let deadline=c.deadline;
  if(actor(game.state)===seat)deadline=away?Math.min(c.deadline??Infinity,Math.max(c.turnStart??now,now)+SITOUT_MS):Math.max(c.turnStart+TURN_MS+c.timebank[seat],now+TURN_MS);
  return metaStep(game,{clock:{...c,strikes,deadline}});
}

// the winner GIF of a seat changed during the game (private tables only; elsewhere nothing happens)
function setFx(game,seat,fx){
  if(!humanSeat(game,seat))throw new MoveError('not_found');
  const m=game.meta;
  if(!m.room||!m.fx)return metaStep(game,{});
  const v=normalizeFx(fx??null);
  if(m.fx[seat]===v)return metaStep(game,{});
  const next=[...m.fx];next[seat]=v;
  return metaStep(game,{fx:next});
}

/** Who may start the rematch: the host while staying (or still possibly coming, up to REMATCH_HOST_WAIT_MS after the end), then the first
 *  seat that stayed. rm = meta.rematch. => seat | null */
export function rematchLeader(rm,now){
  if(!rm)return null;
  const host=rm.hostSeat;
  if(host!=null&&rm.stay.includes(host))return host;
  if(host!=null&&!rm.gone.includes(host)&&now<rm.endedAt+REMATCH_HOST_WAIT_MS)return host;
  return rm.stay.length?rm.stay[0]:null;
}
/** the rematch can still be joined / started */
export const rematchOpen=(rm,now)=>!!rm&&!rm.next&&now<rm.closesAt;

// after the end of a private table: stay for a rematch / leave (the seat cannot be in the rematch any more)
function stay(game,seat,now){
  const rm=game.meta.rematch;
  if(!humanSeat(game,seat))throw new MoveError('not_found');
  if(!rematchOpen(rm,now)||rm.gone.includes(seat))throw new MoveError('room_closed');
  if(rm.stay.includes(seat))return metaStep(game,{});
  return metaStep(game,{rematch:{...rm,stay:[...rm.stay,seat]}});
}
function depart(game,seat){
  const rm=game.meta.rematch;
  if(!humanSeat(game,seat))throw new MoveError('not_found');
  if(!rm||rm.next||rm.gone.includes(seat))return metaStep(game,{});
  return metaStep(game,{rematch:{...rm,stay:rm.stay.filter(s=>s!==seat),gone:[...rm.gone,seat]}});
}
/** The rematch can start now from `seat`: the leader, at least two seats staying (the leader counts as staying). Throws not_host /
 *  not_enough / room_closed. => the seats that stay (the caller included) */
export function rematchSeats(game,seat,now){
  const rm=game.meta.rematch;
  if(!humanSeat(game,seat))throw new MoveError('not_found');
  if(!rematchOpen(rm,now))throw new MoveError('room_closed');
  if(rematchLeader(rm,now)!==seat)throw new MoveError('not_host');
  const stayers=rm.stay.includes(seat)?rm.stay:[...rm.stay,seat];
  if(stayers.length<2)throw new MoveError('not_enough');
  return stayers;
}
/** the rematch has started (its game id; seats = the seats that are in it): those seats move there */
export function rematchStarted(game,next,seats){
  const rm=game.meta.rematch;
  return metaStep(game,{rematch:{...rm,next:{id:next,seats:[...seats]}}});
}

/** A chat message on a private table. lastAt = the seat's previous message time (null if none). => normalised text. Throws MoveError
 *  chat_closed (not a private table) / malformed / too_fast. Game state is not touched (chat has its own sequence). */
export function postChat(game,seat,text,lastAt,now){
  if(!Number.isInteger(seat)||seat<0||seat>2||game.meta.bots[seat])throw new MoveError('not_found');
  if(!game.meta.room)throw new MoveError('chat_closed');
  const t=normalizeChat(text);
  if(t==null)throw new MoveError('malformed');
  if(lastAt!=null&&now-lastAt<CHAT_MIN_INTERVAL_MS)throw new MoveError('too_fast');
  return t;
}

/** Apply a human's request. game = { state, meta }; req = { op:'act', ver, move } | { op:'retire' } | { op:'sitout' } | { op:'sitin' }
 *  | { op:'fx', fx } | { op:'stay' } | { op:'depart' }. => { state, clock, meta? (a patch of meta) }. Throws MoveError.
 *  The stored game is not mutated. */
export function applyRequest(game,seat,req,now){
  if(req&&req.op==='retire')return retire(game,seat,now);
  if(req&&(req.op==='sitout'||req.op==='sitin'))return seatState(game,seat,req.op==='sitout',now);
  if(req&&req.op==='fx')return setFx(game,seat,req.fx);
  if(req&&req.op==='stay')return stay(game,seat,now);
  if(req&&req.op==='depart')return depart(game,seat);
  if(!req||req.op!=='act')throw new MoveError('illegal');
  if(game.state.over)throw new MoveError('game_over');
  if(!Number.isInteger(seat)||seat<0||seat>2||game.meta.bots[seat])throw new MoveError('not_your_turn');
  // stale = the play changed since the version the move was made on (steps that only changed meta do not count)
  if(!Number.isInteger(req.ver)||req.ver>game.state.ver||req.ver<(game.meta.moveVer??game.state.ver))throw new MoveError('stale');
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
  return{stake:meta.stake,buyIn:meta.buyIn,multiplier:meta.multiplier,prize:meta.prize,room:meta.room??null,
    bot:meta.bots.map(Boolean),clock:meta.clock,result:meta.result,seat,fx:meta.fx??null,rematch:meta.rematch??null};
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
  const meta={...game.meta,...(step.meta||{}),clock:step.clock};
  let state=step.state;
  if(!step.meta)meta.moveVer=state.ver;
  if(game.state.over&&step.meta)return{state,meta,payouts:null};   // after the end only meta changes (stay / leave / rematch / GIF): nothing is paid again
  if(!state.over&&![0,1,2].some(s=>humanAlive(state,meta,s))){
    state=finishBotsOnly(state);
    meta.clock={...meta.clock,deadline:null,botAt:null};
  }
  if(!state.over)return{state,meta,payouts:null};
  const s=settle(state,meta);
  meta.result=s.result;
  // a private table can be played again by the people who stay (rematchLeader / rematchSeats)
  if(meta.room){
    // the end: the last hand's end, unless the game ended inside a hand that did not finish (a retire, only bots left)
    const lh=state.lastHand,endedAt=(lh&&lh.handNo===state.handNo?lh.endedAt:step.clock.turnStart)??lh?.endedAt??0;
    meta.rematch={stay:[],gone:[],next:null,hostSeat:meta.hostSeat??null,endedAt,closesAt:endedAt+REMATCH_MS};
  }
  return{state,meta,payouts:s.payouts};
}
