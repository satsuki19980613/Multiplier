-- The play screen from PrivateMatch (2026-10-08 さつき): hand history, chat on private tables.
--   game_hands: finished hands of a game (the record the browsers copy into their own IndexedDB; holes = everybody's cards, the RPC returns
--               only the caller's). Written by the Function "game" on every save; deleted with the game (purge_old_games, 7 days).
--   game_chat:  chat on private tables (games.state->meta->room is set). Written by the Function (op chat) only; deleted with the game.
--   games.chat_seq: the latest chat sequence (kept apart from ver: a chat must not make a pending move stale).
--   game_poll: also returns chat (the latest seq). me(): also returns recent (games played in the last 3 days, for the history sync).
-- 20261004000000_init.sql and 20261005000000_more_stakes.sql are not rewritten.

alter table public.games add column chat_seq int not null default 0;

create table public.game_hands (
  game    uuid not null references public.games(id) on delete cascade,
  hand_no int  not null,
  rec     jsonb not null,     -- what everybody may see (src/tview.js recordOf: only the hands shown at showdown)
  holes   jsonb not null,     -- everybody's hole cards by seat: the RPC returns only the caller's
  primary key (game, hand_no)
);

create table public.game_chat (
  game       uuid not null references public.games(id) on delete cascade,
  seq        int  not null,                       -- per game, from 1 (games.chat_seq)
  seat       smallint not null,
  text       text not null,                       -- normalised (src/chat.js normalizeChat)
  created_at timestamptz not null default now(),
  primary key (game, seq)
);

alter table public.game_hands enable row level security;
alter table public.game_chat  enable row level security;
revoke all on table public.game_hands, public.game_chat from public, anonymous, authenticated;

-- same as in 20261004000000_init.sql, plus the latest chat seq
create or replace function public.game_poll(p_game uuid, p_ver int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.current_uid();
  g     record;
  pos   int;
begin
  select g0.players, g0.ver, g0.views, g0.chat_seq into g from public.games g0 where g0.id = p_game;
  if found and v_uid is not null then pos := array_position(g.players, v_uid); end if;
  if pos is null then perform public.fail('not_found'); end if;
  return jsonb_build_object('ver', g.ver, 'now', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
    'view', case when g.ver > coalesce(p_ver, -1) then g.views -> (pos - 1) end,
    'chat', coalesce(g.chat_seq, 0));
end $$;

-- finished hands after p_after (up to 200, oldest first), each with the caller's own hole cards as "hole"
create or replace function public.game_hands(p_game uuid, p_after int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.current_uid();
  pos   int;
begin
  select array_position(g.players, v_uid) into pos from public.games g where g.id = p_game;
  if pos is null or v_uid is null then perform public.fail('not_found'); end if;
  return coalesce((select jsonb_agg(h.rec || jsonb_build_object('hole', h.holes -> (pos - 1)) order by h.hand_no)
    from (select * from public.game_hands where game = p_game and hand_no > coalesce(p_after, 0) order by hand_no limit 200) h), '[]'::jsonb);
end $$;

-- chat after p_after (the newest 200, oldest first). at = epoch ms. Not a private table: []
create or replace function public.game_chat(p_game uuid, p_after int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid  uuid := public.current_uid();
  v_room text;
  pos    int;
begin
  select g.state -> 'meta' ->> 'room', array_position(g.players, v_uid) into v_room, pos from public.games g where g.id = p_game;
  if pos is null or v_uid is null then perform public.fail('not_found'); end if;
  if v_room is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('seq', c.seq, 'seat', c.seat, 'text', c.text,
                                                       'at', floor(extract(epoch from c.created_at) * 1000)::bigint) order by c.seq)
    from (select * from public.game_chat where game = p_game and seq > coalesce(p_after, 0) order by seq desc limit 200) c), '[]'::jsonb);
end $$;

-- same as in 20261004000000_init.sql, plus recent: the caller's games of the last 3 days ({ id }, newest first)
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
    'season', jsonb_build_object('id', v_s.id, 'endsAt', floor(extract(epoch from v_s.ends_at) * 1000)::bigint),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('id', r.id) order by r.updated_at desc)
      from (select g.id, g.updated_at from public.games g where g.players @> array[v_uid] and g.updated_at > now() - interval '3 days'
            order by g.updated_at desc limit 20) r), '[]'::jsonb));
end $$;

revoke all on function public.game_poll(uuid, int), public.game_hands(uuid, int), public.game_chat(uuid, int), public.me()
  from public, anonymous, authenticated;
grant execute on function public.game_poll(uuid, int), public.game_hands(uuid, int), public.game_chat(uuid, int), public.me() to authenticated;
