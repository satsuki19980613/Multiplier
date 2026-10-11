// Neon Function "game": HTTP behaviour (CORS, auth, routing). JWT checks and the database come in as deps so it can be unit-tested.
import{MoveError,STAKE_KEYS}from'./rules.js';
import{ROOM_STAKES,CODE_RE}from'./rooms.js';

export const MAX_BODY=4096;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// MoveError code -> HTTP status (anything else is 422)
export const STATUS={not_found:404,no_profile:403,gone:409,stale:409,not_yet:409,game_over:409,already_out:409,not_your_turn:409,busy:409,
  insufficient_chips:409,freeroll_unavailable:409,in_game:409,room_closed:409,room_full:409,not_host:409,not_enough:409,away:409,illegal:422};

const isUuid=x=>typeof x==='string'&&UUID.test(x);
// op -> [is the body well-formed?, call deps]
const OPS=new Map(Object.entries({
  queue:[b=>STAKE_KEYS.includes(b.stake),(d,uid,b)=>d.queue(uid,b.stake)],
  leave:[()=>true,(d,uid)=>d.leave(uid)],
  act:[b=>isUuid(b.game)&&Number.isInteger(b.ver)&&b.move&&typeof b.move==='object',(d,uid,b)=>d.act(uid,b.game,{ver:b.ver,move:b.move})],
  retire:[b=>isUuid(b.game),(d,uid,b)=>d.retire(uid,b.game)],
  tick:[b=>isUuid(b.game),(d,uid,b)=>d.tick(uid,b.game)],
  room_create:[b=>ROOM_STAKES.includes(b.stake),(d,uid,b)=>d.roomCreate(uid,b.stake)],
  room_peek:[b=>typeof b.code==='string'&&CODE_RE.test(b.code),(d,uid,b)=>d.roomPeek(uid,b.code)],
  room_join:[b=>typeof b.code==='string'&&CODE_RE.test(b.code),(d,uid,b)=>d.roomJoin(uid,b.code)],
  room_wait:[b=>isUuid(b.room),(d,uid,b)=>d.roomWait(uid,b.room)],
  room_start:[b=>isUuid(b.room),(d,uid,b)=>d.roomStart(uid,b.room)],
  room_leave:[b=>isUuid(b.room),(d,uid,b)=>d.roomLeave(uid,b.room)],
}));

// the uid of a valid "Bearer" token, else null
async function authUid(req,verifyToken){
  const m=/^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization')??'');
  if(!m)return null;
  try{return await verifyToken(m[1])}catch{return null}
}
// the JSON object of the body, or null when it is too long / not JSON / not an object
async function readBody(req){
  try{
    const t=await req.text();
    if(t.length>MAX_BODY)return null;
    const body=JSON.parse(t);
    return body&&typeof body==='object'?body:null;
  }catch{return null}
}

export function createHandler(deps){
  const allowed=new Set(deps.allowedOrigins);
  const log=deps.logError??((m,e)=>console.error(m,e));
  return async req=>{
    const origin=req.headers.get('Origin');
    const cors={Vary:'Origin'};
    if(origin&&allowed.has(origin))cors['Access-Control-Allow-Origin']=origin;
    const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});
    if(req.method!=='POST')return reply(405,{error:'method_not_allowed'});
    const uid=await authUid(req,deps.verifyToken);
    if(!uid)return reply(401,{error:'not_authenticated'});
    const body=await readBody(req),op=body&&OPS.get(body.op);
    if(!op?.[0](body))return reply(422,{error:'malformed'});
    try{
      return reply(200,await op[1](deps,uid,body));
    }catch(e){
      if(e instanceof MoveError){
        return reply(STATUS[e.code]??422,{error:e.code,...e.extra});
      }
      log('game: unexpected error',e);
      return reply(500,{error:'internal'});
    }
  };
}
