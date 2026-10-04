-- Multiplier: profiles (nickname, chips, free-roll count), queue (players waiting for a table), games (server-side state),
-- seasons (half-yearly, JST 4/1 and 10/1) and hall_of_fame (records only).
-- The browser never touches the tables. It calls only the RPC functions granted to `authenticated` at the end.
-- Moves and matching go through the Neon Function "game", which connects as the database owner.

-- the caller's user id: the `sub` of the Neon Auth JWT that the Data API puts in request.jwt.claims
create or replace function public.current_uid()
returns uuid language sql stable set search_path = '' as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;

create or replace function public.fail(p_code text)
returns void language plpgsql immutable set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = p_code;
end $$;

create table public.profiles (
  uid           uuid primary key references neon_auth."user"(id) on delete cascade,
  nickname      text not null check (char_length(nickname) between 1 and 16),
  chips         bigint not null default 10000 check (chips >= 0),
  freeroll_day  date,                          -- the JST date freeroll_used counts for
  freeroll_used int  not null default 0,
  played        int  not null default 0,       -- games finished this season (the ranking lists players with played > 0)
  created_at    timestamptz not null default now()
);
create unique index profiles_nickname_key on public.profiles (lower(nickname));
create index profiles_chips_idx on public.profiles (chips desc) where played > 0;

create table public.queue (
  uid     uuid primary key references public.profiles(uid) on delete cascade,
  stake   text not null check (stake in ('low', 'mid', 'high', 'free')),
  since   timestamptz not null default now(),   -- when the caller started waiting (kept while the stake stays the same)
  seen_at timestamptz not null default now()    -- last call; fresh = within 6 seconds
);
create index queue_stake_idx on public.queue (stake, since);

create table public.games (
  id          uuid primary key,
  players     uuid[] not null check (cardinality(players) = 3),   -- a bot's seat is null
  stake       text not null check (stake in ('low', 'mid', 'high', 'free')),
  multiplier  int,                                                 -- null for the free-roll
  prize       bigint not null,
  status      text not null default 'active' check (status in ('active', 'over')),
  state       jsonb not null,            -- { g: engine state incl. the deck, meta: incl. bot personas }: never returned to a browser
  ver         int  not null,
  views       jsonb not null,            -- [view for seat 0, 1, 2]: what each seat may see
  deadline_ms bigint,                    -- epoch ms by which the player to act must act
  bot_at_ms   bigint,                    -- epoch ms from which the bot to act may play
  winner      smallint,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index games_players_active on public.games using gin (players) where status = 'active';
create index games_updated_idx on public.games (updated_at);

create table public.seasons (
  id        text primary key,            -- '2026-H2' = 2026-10-01 .. 2027-04-01 JST, '2027-H1' = 2027-04-01 .. 2027-10-01 JST
  starts_at timestamptz not null,
  ends_at   timestamptz not null,
  closed    boolean not null default false
);
insert into public.seasons (id, starts_at, ends_at)
  values ('2026-H2', '2026-10-01 00:00:00+09', '2027-04-01 00:00:00+09');

create table public.hall_of_fame (
  season   text not null references public.seasons(id),
  rank     int  not null,
  nickname text not null,
  chips    bigint not null,
  primary key (season, rank)
);

alter table public.profiles    enable row level security;
alter table public.queue       enable row level security;
alter table public.games       enable row level security;
alter table public.seasons     enable row level security;
alter table public.hall_of_fame enable row level security;
revoke all on table public.profiles, public.queue, public.games, public.seasons, public.hall_of_fame from public, anonymous, authenticated;

-- Delete games 7 days after their last change (finished or abandoned). Buy-ins of abandoned (still active) games are given back
-- to the players who were still in the tournament.
-- No scheduler: this runs when the app is used (me()).
create or replace function public.purge_old_games()
returns void language sql volatile security definer set search_path = '' as $$
  with d as (
    delete from public.games where updated_at < now() - interval '7 days' returning players, stake, status, state
  )
  update public.profiles p set chips = p.chips + r.amt
  from (
    select x.u as uid, sum(case d.stake when 'low' then 10 when 'mid' then 100 when 'high' then 1000 else 0 end) as amt
    from d, unnest(d.players) with ordinality as x(u, i)
    where d.status = 'active' and x.u is not null and (d.state -> 'g' -> 'places' ->> (x.i - 1)::int) is null
    group by x.u
  ) r
  where p.uid = r.uid;
$$;

-- Close the season whose end has passed: record the top 10 in hall_of_fame, reset everybody to 10,000 chips and the free-roll count,
-- then open the next season(s). Runs once (advisory lock); anybody who loses the race just skips.
create or replace function public.season_rollover()
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  s       public.seasons;
  n_start timestamptz;
  n_end   timestamptz;
  n_jst   timestamp;
begin
  if not exists (select 1 from public.seasons where not closed and ends_at <= now()) then return; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('season_rollover', 0)) then return; end if;
  select * into s from public.seasons where not closed and ends_at <= now() order by starts_at limit 1 for update;
  if not found then return; end if;

  insert into public.hall_of_fame (season, rank, nickname, chips)
    select s.id, t.rk, t.nickname, t.chips
    from (select p.nickname, p.chips, (row_number() over (order by p.chips desc, p.created_at, p.uid))::int as rk
          from public.profiles p where p.played > 0) t
    where t.rk <= 10
    on conflict do nothing;
  update public.profiles set chips = 10000, freeroll_day = null, freeroll_used = 0, played = 0;
  update public.seasons set closed = true where id = s.id;

  -- next season(s): skipped ones (nobody opened the app for a whole season) are created closed, without records
  n_start := s.ends_at;
  loop
    n_jst := n_start at time zone 'Asia/Tokyo';
    n_end := (n_jst + interval '6 months') at time zone 'Asia/Tokyo';
    insert into public.seasons (id, starts_at, ends_at, closed)
      values (to_char(n_jst, 'YYYY') || case when extract(month from n_jst) = 4 then '-H1' else '-H2' end, n_start, n_end, n_end <= now())
      on conflict do nothing;
    exit when n_end > now();
    n_start := n_end;
  end loop;
end $$;

-- the signed-in player's profile (created on first call with a random nickname), balance, free-roll allowance, active game and season.
-- Also purges old games and rolls the season over when it is due.
create or replace function public.me()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := public.current_uid();
  v_p    public.profiles;
  v_game uuid;
  v_s    public.seasons;
  v_used int;
  n      int := 0;
begin
  if v_uid is null or not exists (select 1 from neon_auth."user" u where u.id = v_uid) then
    perform public.fail('not_authenticated');
  end if;
  perform public.purge_old_games();
  perform public.season_rollover();
  select * into v_p from public.profiles where uid = v_uid;
  while not found loop
    n := n + 1;
    if n > 20 then perform public.fail('nickname_exhausted'); end if;
    insert into public.profiles (uid, nickname)
      values (v_uid, 'Player-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4)))
      on conflict do nothing;
    select * into v_p from public.profiles where uid = v_uid;
  end loop;
  -- the table the player is still playing at (an eliminated player is free to queue again)
  select g.id into v_game from public.games g
    where g.status = 'active' and g.players @> array[v_uid]
      and (g.state -> 'g' -> 'places' ->> (array_position(g.players, v_uid) - 1)) is null
    limit 1;
  select * into v_s from public.seasons where not closed order by starts_at limit 1;
  v_used := case when v_p.freeroll_day = (now() at time zone 'Asia/Tokyo')::date then v_p.freeroll_used else 0 end;
  return jsonb_build_object(
    'nickname', v_p.nickname,
    'chips', v_p.chips,
    'freeroll', jsonb_build_object('used', v_used, 'left', greatest(0, 3 - v_used), 'eligible', v_p.chips < 10 and v_used < 3),
    'game', v_game,
    'season', jsonb_build_object('id', v_s.id, 'endsAt', floor(extract(epoch from v_s.ends_at) * 1000)::bigint));
end $$;

create or replace function public.set_nickname(p_name text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := public.current_uid();
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_uid is null then perform public.fail('not_authenticated'); end if;
  -- the robot mark is reserved for bots
  if char_length(v_name) < 1 or char_length(v_name) > 16 or v_name ~ '[[:cntrl:]]' or position(E'\U0001F916' in v_name) > 0 then
    perform public.fail('nickname_invalid');
  end if;
  begin
    update public.profiles set nickname = v_name where uid = v_uid;
  exception when unique_violation then
    perform public.fail('nickname_taken');
  end;
  if not found then perform public.fail('no_profile'); end if;
  return jsonb_build_object('nickname', v_name);
end $$;

-- the caller's view of a game; the view itself only when it is newer than p_ver
create or replace function public.game_poll(p_game uuid, p_ver int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.current_uid();
  g     record;
  pos   int;
begin
  select g0.players, g0.ver, g0.views into g from public.games g0 where g0.id = p_game;
  if found and v_uid is not null then pos := array_position(g.players, v_uid); end if;
  if pos is null then perform public.fail('not_found'); end if;
  return jsonb_build_object('ver', g.ver, 'now', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
    'view', case when g.ver > coalesce(p_ver, -1) then g.views -> (pos - 1) end);
end $$;

-- this season: top 100 by chips (players who finished at least one game) and the caller's own row
create or replace function public.ranking()
returns jsonb language sql stable security definer set search_path = '' as $$
  with r as (
    select p.uid, p.nickname, p.chips, rank() over (order by p.chips desc) as rk
    from public.profiles p where p.played > 0
  )
  select jsonb_build_object(
    'season', (select jsonb_build_object('id', s.id, 'endsAt', floor(extract(epoch from s.ends_at) * 1000)::bigint)
               from public.seasons s where not s.closed order by s.starts_at limit 1),
    'top', coalesce((select jsonb_agg(jsonb_build_object('rank', t.rk, 'nickname', t.nickname, 'chips', t.chips,
              'me', t.uid = public.current_uid()) order by t.rk, t.nickname)
            from (select * from r order by rk, nickname limit 100) t), '[]'::jsonb),
    'me', (select jsonb_build_object('rank', r.rk, 'nickname', r.nickname, 'chips', r.chips) from r where r.uid = public.current_uid()));
$$;

-- past seasons' top 10 (newest first)
create or replace function public.hall_of_fame()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('season', x.season, 'top', x.top) order by x.starts_at desc), '[]'::jsonb)
  from (
    select s.id as season, s.starts_at,
           (select jsonb_agg(jsonb_build_object('rank', h.rank, 'nickname', h.nickname, 'chips', h.chips) order by h.rank)
            from public.hall_of_fame h where h.season = s.id) as top
    from public.seasons s where exists (select 1 from public.hall_of_fame h where h.season = s.id)
  ) x;
$$;

revoke all on function public.current_uid(), public.fail(text), public.purge_old_games(), public.season_rollover(),
  public.me(), public.set_nickname(text), public.game_poll(uuid, int), public.ranking(), public.hall_of_fame()
  from public, anonymous, authenticated;
grant execute on function public.me(), public.set_nickname(text), public.game_poll(uuid, int),
  public.ranking(), public.hall_of_fame() to authenticated;
