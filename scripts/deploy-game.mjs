// Deploy the Neon Function "game": npm run deploy:game -- --branch <dev|production>
// The invocation URL goes to VITE_GAME_URL (.env.development / .env.production) and public/_headers (production).
import{branchArg,neon}from'./neon.mjs';

const ORIGINS={
  dev:['http://localhost:5180','http://localhost:4180'],
  production:['https://multiplier.pages.dev','http://localhost:5180','http://localhost:4180'],
};
const branch=branchArg();
const origins=(process.env.ALLOWED_ORIGINS?.split(',')??ORIGINS[branch]??ORIGINS.dev).join(',');
const out=await neon('functions','deploy','game','--branch',branch,'--src','server/game/index.js','--runtime','nodejs24','--env',`ALLOWED_ORIGINS=${origins}`,'--output','json');
const url=(out.match(/https:\/\/[^"\s]+compute[^"\s]+/)||[])[0];
console.log(url?`配備しました（${branch}）: ${url}`:out);
