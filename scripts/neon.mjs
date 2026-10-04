// Neon project shared by the scripts. The connection string (with password) is fetched on demand and never printed.
import{spawn}from'node:child_process';
import{resolve}from'node:path';

export const PROJECT=process.env.NEON_PROJECT_ID??'summer-hat-89673886';
export const ROOT=resolve(import.meta.dirname,'..');
const NEONCTL=resolve(ROOT,'node_modules/neonctl/bin/cli.js');

export function run(cmd,args,{env}={}){
  return new Promise((ok,fail)=>{
    const p=spawn(cmd,args,{stdio:['ignore','pipe','pipe'],env:{...process.env,...env}});
    let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',fail);
    p.on('close',code=>code===0?ok(out):fail(new Error(err.trim()||`${cmd} exit ${code}`)));
  });
}
export const neon=(...args)=>run(process.execPath,[NEONCTL,...args,'--project-id',PROJECT]);
export function branchArg(){
  const i=process.argv.indexOf('--branch');const b=i>0?process.argv[i+1]:null;
  if(!b){console.error('--branch <dev|production> が必要です');process.exit(2)}
  return b;
}
export async function connectionString(branch){
  const url=(await neon('connection-string',branch,'--role-name','neondb_owner')).trim();
  if(!url.startsWith('postgres'))throw new Error(`接続文字列を取得できません（ブランチ ${branch}）`);
  return url.replace('sslmode=require','sslmode=verify-full');
}
