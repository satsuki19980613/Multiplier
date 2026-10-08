/**
 * Neon Function "game" (Multiplier). Deploy: npm run deploy:game -- --branch <branch>
 * Neon sets DATABASE_URL (database owner), NEON_AUTH_JWKS_URL and NEON_AUTH_BASE_URL. ALLOWED_ORIGINS comes from --env.
 */
import{attachDatabasePool}from'@neon/functions';
import{createRemoteJWKSet,jwtVerify}from'jose';
import pg from'pg';
import{createHandler}from'./handler.js';
import{makeDb}from'./db.js';

const env=n=>{const v=process.env[n];if(!v)throw new Error(`missing env ${n}`);return v};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const pool=new pg.Pool({connectionString:env('DATABASE_URL'),max:3});
attachDatabasePool(pool);
const jwks=createRemoteJWKSet(new URL(env('NEON_AUTH_JWKS_URL')));
const issuer=new URL(env('NEON_AUTH_BASE_URL')).origin;
const db=makeDb(pool);

const handler=createHandler({
  allowedOrigins:(process.env.ALLOWED_ORIGINS??'').split(',').map(s=>s.trim()).filter(Boolean),
  async verifyToken(token){
    const{payload}=await jwtVerify(token,jwks,{issuer});
    if(payload.role!=='authenticated')return null;
    return typeof payload.sub==='string'&&UUID.test(payload.sub)?payload.sub:null;
  },
  queue:db.queue,
  leave:db.leave,
  act:db.act,
  retire:db.retire,
  tick:db.tick,
  roomCreate:db.roomCreate,
  roomPeek:db.roomPeek,
  roomJoin:db.roomJoin,
  roomWait:db.roomWait,
  roomStart:db.roomStart,
  roomLeave:db.roomLeave,
  logError(m,e){console.error(m,e instanceof Error?`${e.name}: ${e.message}`:String(e))},
});

export default{fetch:handler};
