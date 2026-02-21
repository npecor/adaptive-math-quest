create table if not exists public.leaderboard_players (
  user_id text primary key,
  username text not null,
  username_key text not null unique,
  avatar_id text not null,
  all_time_stars integer not null default 0,
  best_run_stars integer not null default 0,
  trophies_earned integer not null default 0,
  extensions_solved integer not null default 0,
  high_score integer not null default 0,
  is_bot boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leaderboard_players_all_time_idx
  on public.leaderboard_players (all_time_stars desc, best_run_stars desc, updated_at asc);

create index if not exists leaderboard_players_best_run_idx
  on public.leaderboard_players (best_run_stars desc, all_time_stars desc, updated_at asc);

create index if not exists leaderboard_players_trophies_idx
  on public.leaderboard_players (trophies_earned desc, extensions_solved desc, all_time_stars desc, updated_at asc);

create or replace function public.set_leaderboard_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists leaderboard_players_set_updated_at on public.leaderboard_players;
create trigger leaderboard_players_set_updated_at
before update on public.leaderboard_players
for each row
execute function public.set_leaderboard_updated_at();
