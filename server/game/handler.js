// Neon Function "game": HTTP behaviour (CORS, auth, routing). JWT checks and the database come in as deps so it can be unit-tested.
import{MoveError,STAKE_KEYS}from'./rules.js';
import{ROOM_STAKES,CODE_RE}from'./rooms.js';

export const MAX_BODY=4096;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// MoveError code -> HTTP status (anything else is 422)
export const STATUS={not_found:404,no_profile:403,gone:409,stale:409,not_yet:409,game_over:409,already_out:409,not_your_turn:409,busy:409,
  insufficient_chips:409,freeroll_unavailable:409,in_game:409,room_closed:409,room_full:409,not_host:409,not_enough:409,away:409,
  chat_closed:409,chat_full:409,too_fast:429,malformed:422,illegal:422};
// ops on the caller's game that take only { game }
const GAME_OPS={retire:'retire',tick:'tick',sitout:'sitout',sitin:'sitin',stay:'stay',depart:'depart',rematch:'rematch'};
// fx: a KLIPY slug, or null / missing (the value itself is normalised by the rules; only the type is checked here)
const fxOk=x=>x==null||(typeof x==='string'&&x.length<=200);

export function createHandler(deps){
  const allowed=new Set(deps.allowedOrigins);
  const log=deps.logError??((m,e)=>console.error(m,e));
  return async req=>{
    const origin=req.headers.get('Origin');
    const cors={Vary:'Origin'};if(origin&&allowed.has(origin))cors['Access-Control-Allow-Origin']=origin;
    const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});
    if(req.method!=='POST')return reply(405,{error:'method_not_allowed'});
    const m=/^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization')??'');
    let uid=null;if(m)try{uid=await deps.verifyToken(m[1])}catch{uid=null}
    if(!uid)return reply(401,{error:'not_authenticated'});
    let body;
    try{const t=await req.text();if(t.length>MAX_BODY)return reply(422,{error:'malformed'});body=JSON.parse(t)}catch{return reply(422,{error:'malformed'})}
    if(!body||typeof body!=='object')return reply(422,{error:'malformed'});
    try{
      switch(body.op){
        case'queue':
          if(!STAKE_KEYS.includes(body.stake))return reply(422,{error:'malformed'});
          return reply(200,await deps.queue(uid,body.stake));
        case'leave':
          return reply(200,await deps.leave(uid));
        case'act':
          if(!(typeof body.game==='string'&&UUID.test(body.game))||!Number.isInteger(body.ver)||!body.move||typeof body.move!=='object')return reply(422,{error:'malformed'});
          return reply(200,await deps.act(uid,body.game,{ver:body.ver,move:body.move}));
        case'retire':case'tick':case'sitout':case'sitin':case'stay':case'depart':case'rematch':
          if(!(typeof body.game==='string'&&UUID.test(body.game)))return reply(422,{error:'malformed'});
          return reply(200,await deps[GAME_OPS[body.op]](uid,body.game));
        case'fx':
          if(!(typeof body.game==='string'&&UUID.test(body.game))||!fxOk(body.fx))return reply(422,{error:'malformed'});
          return reply(200,await deps.fx(uid,body.game,body.fx??null));
        case'chat':
          if(!(typeof body.game==='string'&&UUID.test(body.game))||typeof body.text!=='string'||body.text.length>400)return reply(422,{error:'malformed'});
          return reply(200,await deps.chat(uid,body.game,body.text));
        case'room_create':
          if(!ROOM_STAKES.includes(body.stake)||!fxOk(body.fx))return reply(422,{error:'malformed'});
          return reply(200,await deps.roomCreate(uid,body.stake,body.fx??null));
        case'room_peek':
          if(!(typeof body.code==='string'&&CODE_RE.test(body.code)))return reply(422,{error:'malformed'});
          return reply(200,await deps.roomPeek(uid,body.code));
        case'room_join':
          if(!(typeof body.code==='string'&&CODE_RE.test(body.code))||!fxOk(body.fx))return reply(422,{error:'malformed'});
          return reply(200,await deps.roomJoin(uid,body.code,body.fx));
        case'room_wait':
        case'room_start':
        case'room_leave':
          if(!(typeof body.room==='string'&&UUID.test(body.room)))return reply(422,{error:'malformed'});
          return reply(200,await deps[{room_wait:'roomWait',room_start:'roomStart',room_leave:'roomLeave'}[body.op]](uid,body.room));
        default:
          return reply(422,{error:'malformed'});
      }
    }catch(e){
      if(e instanceof MoveError){
        return reply(STATUS[e.code]??422,{error:e.code,...(e.extra||{})});
      }
      log('game: unexpected error',e);
      return reply(500,{error:'internal'});
    }
  };
}
