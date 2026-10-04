import{proxyAuth}from'../../../src/authProxy.js';

/**
 * Cloudflare Pages Functions: relay /api/auth/* to the production Neon Auth so the session cookie is first-party.
 * Production Neon Auth URL (same as VITE_NEON_AUTH_URL in .env.production; a public address).
 * If it changes, update .env.production and public/_headers too.
 */
export const UPSTREAM='https://ep-wild-term-b3paj7ze.neonauth.c-4.ap-southeast-1.aws.neon.tech/neondb/auth';

export const onRequest=ctx=>{
  const p=ctx.params.path;
  return proxyAuth(ctx.request,UPSTREAM,Array.isArray(p)?p.join('/'):(p??''));
};
