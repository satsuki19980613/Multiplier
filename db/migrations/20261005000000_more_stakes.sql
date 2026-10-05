-- Stakes ULTRA (buy-in 2,000) and EXTREME (3,000), all stakes open from the start (2026-10-05 さつき). src/spin.js STAKES.

alter table public.queue drop constraint queue_stake_check;
alter table public.queue add constraint queue_stake_check check (stake in ('low', 'mid', 'high', 'ultra', 'extreme', 'free'));
alter table public.games drop constraint games_stake_check;
alter table public.games add constraint games_stake_check check (stake in ('low', 'mid', 'high', 'ultra', 'extreme', 'free'));

-- same as in 20261004000000_init.sql, with the buy-ins of the new stakes
create or replace function public.purge_old_games()
returns void language sql volatile security definer set search_path = '' as $$
  with d as (
    delete from public.games where updated_at < now() - interval '7 days' returning players, stake, status, state
  )
  update public.profiles p set chips = p.chips + r.amt
  from (
    select x.u as uid,
           sum(case d.stake when 'low' then 10 when 'mid' then 100 when 'high' then 1000 when 'ultra' then 2000 when 'extreme' then 3000
               else 0 end) as amt
    from d, unnest(d.players) with ordinality as x(u, i)
    where d.status = 'active' and x.u is not null and (d.state -> 'g' -> 'places' ->> (x.i - 1)::int) is null
    group by x.u
  ) r
  where p.uid = r.uid;
$$;
