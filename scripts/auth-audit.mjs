// Counts personal data from the login that is still in the database (read only): node scripts/auth-audit.mjs --branch <branch>
// Fails if any row still has it (also an invitation with an email: the app never invites, so any is unexpected), or if a scrub trigger (db/migrations/20261011000000_auth_scrub.sql) is missing or disabled.
// Also prints the tables and columns of neon_auth (names only, never values), so a column Neon adds later gets noticed.
// (AUDIT_DATABASE_URL=postgres://… runs it against any database, e.g. the local one in CI.)
import{appendFileSync}from'node:fs';
import pg from'pg';

let url=process.env.AUDIT_DATABASE_URL,label='AUDIT_DATABASE_URL';
if(!url){const{branchArg,connectionString}=await import('./neon.mjs');label=branchArg();url=await connectionString(label)}
const client=new pg.Client({connectionString:url});
await client.connect();
let failed=0;
const lines=[`### 認証の個人の情報（${label}）`,'','| 確認 | 結果 | 件数 |','|---|---|---|'];
function check(name,ok,n){
  if(!ok)failed++;
  lines.push(`| ${name} | ${ok?'OK':'**NG**'} | ${n} |`);
  console.log(`${ok?'ok  ':'NG  '} ${name} — ${n}`);
}
try{
  const{rows:[n]}=await client.query(`select
    (select count(*) from neon_auth."user")::int users,
    (select count(*) from neon_auth."user" where email <> id::text||'@multiplier.invalid')::int email,
    (select count(*) from neon_auth."user" where name <> 'Player' or image is not null)::int profile,
    (select count(*) from neon_auth.account where "idToken" is not null or "accessToken" is not null or "refreshToken" is not null)::int tokens,
    (select count(*) from neon_auth.session where "ipAddress" is not null or "userAgent" is not null)::int sessions,
    (select count(*) from neon_auth.invitation where email is not null)::int invitations,
    (select count(*) from pg_trigger t join pg_proc p on p.oid=t.tgfoid
      where not t.tgisinternal and t.tgenabled<>'D' and p.pronamespace='public'::regnamespace
        and (t.tgrelid::regclass::text,p.proname) in (('neon_auth."user"','auth_user_scrub'),('neon_auth.account','auth_account_scrub'),('neon_auth.session','auth_session_scrub')))::int triggers`);
  check('メールアドレスが残っている利用者',n.email===0,`${n.email} / ${n.users}`);
  check('表示名・画像が残っている利用者',n.profile===0,`${n.profile} / ${n.users}`);
  check('Google のトークンが残っているアカウント',n.tokens===0,n.tokens);
  check('IP アドレス・ブラウザの種類が残っているセッション',n.sessions===0,n.sessions);
  check('メールアドレスが入っている組織への招待（アプリは使わない）',n.invitations===0,n.invitations);
  check('置き換えのトリガーが 3 つとも有効',n.triggers===3,n.triggers);
  const cols=await client.query(`select table_name t,string_agg(column_name,', ' order by ordinal_position) c
    from information_schema.columns where table_schema='neon_auth' group by 1 order by 1`);
  lines.push('','| neon_auth の表 | 列 |','|---|---|',...cols.rows.map(r=>`| ${r.t} | ${r.c} |`),'');
  for(const r of cols.rows)console.log(`neon_auth.${r.t}: ${r.c}`);
}finally{await client.end()}
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
process.exit(failed?1:0);
