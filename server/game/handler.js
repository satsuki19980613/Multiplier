// Neon Function "game": HTTP behaviour (CORS, auth, routing). JWT checks and the database come in as deps so it can be unit-tested.
import{MoveError}from'./rules.js';

export const MAX_BODY=4096;

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
      if(body.op==='match'){
        if(typeof body.target!=='string'||!/^[0-9a-f-]{36}$/i.test(body.target)||body.target===uid)return reply(422,{error:'malformed'});
        return reply(200,await deps.match(uid,body.target));
      }
      if(['act','timeout','resign'].includes(body.op)){
        if(typeof body.game!=='string'||!/^[0-9a-f-]{36}$/i.test(body.game))return reply(422,{error:'malformed'});
        return reply(200,await deps.play(uid,body.game,body));
      }
      return reply(422,{error:'malformed'});
    }catch(e){
      if(e instanceof MoveError){
        const st={not_found:404,gone:409,stale:409,not_yet:409,game_over:409,not_your_turn:409,busy:409,no_profile:403}[e.code]??422;
        return reply(st,{error:e.code,...(e.extra||{})});
      }
      log('game: unexpected error',e);
      return reply(500,{error:'internal'});
    }
  };
}
