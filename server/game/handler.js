// Neon Function "game": HTTP behaviour (CORS, auth, routing). JWT checks and the database come in as deps so it can be unit-tested.
import{MoveError,STAKE_KEYS}from'./rules.js';

export const MAX_BODY=4096;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// MoveError code -> HTTP status (anything else is 422)
export const STATUS={not_found:404,no_profile:403,gone:409,stale:409,not_yet:409,game_over:409,already_out:409,not_your_turn:409,busy:409,
  insufficient_chips:409,freeroll_unavailable:409,illegal:422};

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
        case'retire':
          if(!(typeof body.game==='string'&&UUID.test(body.game)))return reply(422,{error:'malformed'});
          return reply(200,await deps.retire(uid,body.game));
        case'tick':
          if(!(typeof body.game==='string'&&UUID.test(body.game)))return reply(422,{error:'malformed'});
          return reply(200,await deps.tick(uid,body.game));
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
