-- Private tables (2026-10-08 さつき): a host picks a stake and shares a 6-digit room code; friends join by the code.
-- Only the Neon Function "game" touches this table (as the database owner). server/game/rooms.js has the rules.

create table public.rooms (
  id         uuid primary key,
  code       text not null check (code ~ '^[0-9]{6}$'),
  stake      text not null check (stake in ('low', 'mid', 'high', 'ultra', 'extreme')),
  host       uuid not null references public.profiles(uid) on delete cascade,
  members    jsonb not null,          -- [{ uid, name, seenAt }] in join order (the host first)
  status     text not null default 'waiting' check (status in ('waiting', 'started', 'closed')),
  game       uuid,                    -- the table it started (games.id)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()   -- every lobby poll; a waiting room nobody polls (ROOM_GONE_MS) is closed by the next room_create
);
-- a code is unique among the rooms still waiting
create unique index rooms_code_waiting on public.rooms (code) where status = 'waiting';
create index rooms_code_idx on public.rooms (code, created_at desc);
create index rooms_updated_idx on public.rooms (updated_at);

alter table public.rooms enable row level security;
revoke all on table public.rooms from public, anonymous, authenticated;
