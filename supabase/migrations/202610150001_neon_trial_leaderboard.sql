-- NEON TRIAL MVP leaderboard. Public clients can read only the ranking RPC;
-- all profile, attempt, and record writes go through authenticated functions.

create table if not exists public.player_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null,
  nickname_normalized text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_profiles_nickname_length check (char_length(nickname) between 3 and 16)
);

create table if not exists public.game_attempts (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.player_profiles (id) on delete cascade,
  game_version text not null,
  started_at timestamptz not null default clock_timestamp(),
  submitted_at timestamptz,
  score_submitted integer,
  score_validated integer,
  zones_completed smallint not null default 0 check (zones_completed between 0 and 4),
  deaths smallint not null default 0 check (deaths between 0 and 100),
  completed boolean not null default false,
  completion_time_ms integer,
  validation_status text not null default 'started' check (validation_status in ('started', 'validated', 'rejected')),
  validation_reason text,
  events jsonb,
  constraint game_attempts_submitted_score check (score_submitted is null or score_submitted between 0 and 3000),
  constraint game_attempts_validated_score check (score_validated is null or score_validated between 0 and 3000),
  constraint game_attempts_completion_time check (completion_time_ms is null or completion_time_ms between 0 and 7200000)
);

create table if not exists public.player_records (
  player_id uuid primary key references public.player_profiles (id) on delete cascade,
  best_score integer not null check (best_score between 0 and 3000),
  best_zones_completed smallint not null check (best_zones_completed between 0 and 4),
  best_completion_time_ms integer check (best_completion_time_ms between 0 and 7200000),
  best_attempt_id uuid not null references public.game_attempts (id) on delete cascade,
  updated_at timestamptz not null default now()
);

create index if not exists game_attempts_player_started_idx on public.game_attempts (player_id, started_at desc);
create index if not exists game_attempts_status_submitted_idx on public.game_attempts (validation_status, submitted_at desc);
create index if not exists player_records_score_order_idx on public.player_records (best_score desc, player_id asc);

alter table public.player_profiles enable row level security;
alter table public.game_attempts enable row level security;
alter table public.player_records enable row level security;

revoke all on table public.player_profiles from anon, authenticated;
revoke all on table public.game_attempts from anon, authenticated;
revoke all on table public.player_records from anon, authenticated;
grant select on table public.player_profiles to authenticated;

drop policy if exists "players can read their own profile" on public.player_profiles;
create policy "players can read their own profile"
  on public.player_profiles for select to authenticated
  using (id = (select auth.uid()));

create or replace function public.claim_nickname(p_nickname text)
returns table (nickname text, nickname_normalized text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_nickname text;
  v_normalized text;
  v_current text;
  v_updated_at timestamptz;
begin
  if v_uid is null or (auth.jwt() ->> 'is_anonymous') is distinct from 'true' then
    raise exception 'anonymous identity required' using errcode = '42501';
  end if;

  v_nickname := normalize(regexp_replace(btrim(coalesce(p_nickname, '')), '[[:space:]]+', ' ', 'g'), NFC);
  v_normalized := lower(normalize(v_nickname, NFC));
  if char_length(v_nickname) < 3 or char_length(v_nickname) > 16
     or v_nickname !~ '^[[:alnum:]_][[:alnum:]_ ]{1,14}[[:alnum:]_]$'
     or v_nickname ~ '[[:space:]]{2}' then
    raise exception 'invalid nickname' using errcode = '22023';
  end if;
  if v_normalized ~ '(^|[_ ])(admin|administrator|moderator|support|system|official)([_ ]|$)'
     or v_normalized ~ '(fuck|shit|bitch|cunt|asshole|nazi|rape)' then
    raise exception 'reserved nickname' using errcode = '22023';
  end if;

  select p.nickname, p.updated_at into v_current, v_updated_at
    from public.player_profiles as p where p.id = v_uid;
  if found and lower(normalize(v_current, NFC)) = v_normalized then
    return query select v_current, v_normalized;
    return;
  end if;
  if found and v_updated_at > clock_timestamp() - interval '1 minute' then
    raise exception 'nickname changes are rate limited' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.player_profiles as p where p.nickname_normalized = v_normalized and p.id <> v_uid) then
    raise exception 'nickname already in use' using errcode = '23505';
  end if;

  insert into public.player_profiles as p (id, nickname, nickname_normalized)
    values (v_uid, v_nickname, v_normalized)
    on conflict (id) do update set
      nickname = excluded.nickname,
      nickname_normalized = excluded.nickname_normalized,
      updated_at = clock_timestamp();
  return query select v_nickname, v_normalized;
exception
  when unique_violation then
    raise exception 'nickname already in use' using errcode = '23505';
end;
$$;

create or replace function public.start_attempt(p_game_version text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_attempt_id uuid;
begin
  if v_uid is null or (auth.jwt() ->> 'is_anonymous') is distinct from 'true' then
    raise exception 'anonymous identity required' using errcode = '42501';
  end if;
  if p_game_version <> 'neon-trial-0.1.0' then
    raise exception 'unsupported game version' using errcode = '22023';
  end if;
  if not exists (select 1 from public.player_profiles as p where p.id = v_uid) then
    raise exception 'profile required' using errcode = 'P0002';
  end if;
  if (select count(*) from public.game_attempts as a
      where a.player_id = v_uid and a.started_at > clock_timestamp() - interval '1 minute') >= 5 then
    raise exception 'attempt start rate limit exceeded' using errcode = 'P0001';
  end if;
  insert into public.game_attempts (player_id, game_version)
    values (v_uid, p_game_version) returning id into v_attempt_id;
  return v_attempt_id;
end;
$$;

create or replace function public.submit_attempt(
  p_attempt_id uuid,
  p_game_version text,
  p_events jsonb,
  p_score_submitted integer,
  p_deaths integer,
  p_zones_completed integer,
  p_completed boolean,
  p_completion_time_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_attempt public.game_attempts%rowtype;
  v_event jsonb;
  v_event_type text;
  v_key text;
  v_event_at integer;
  v_event_x integer;
  v_number integer;
  v_expected_x integer;
  v_points integer;
  v_score integer := 0;
  v_death_count integer := 0;
  v_previous_at integer := -1;
  v_seen text[] := array[]::text[];
  v_reason text;
  v_server_elapsed integer;
  v_record_updated boolean := false;
  v_best_score integer;
  v_position bigint;
begin
  if v_uid is null or (auth.jwt() ->> 'is_anonymous') is distinct from 'true' then
    raise exception 'anonymous identity required' using errcode = '42501';
  end if;
  select * into v_attempt from public.game_attempts as a
    where a.id = p_attempt_id and a.player_id = v_uid for update;
  if not found then
    raise exception 'attempt not found' using errcode = '42501';
  end if;
  if v_attempt.validation_status = 'validated' then
    select r.best_score into v_best_score from public.player_records as r where r.player_id = v_uid;
    select ranked.position into v_position from (
      select r.player_id, rank() over (order by r.best_score desc) as position
        from public.player_records as r
    ) as ranked where ranked.player_id = v_uid;
    return jsonb_build_object('accepted', true, 'recordUpdated', false, 'bestScore', v_best_score, 'position', v_position, 'duplicate', true);
  elsif v_attempt.validation_status <> 'started' then
    return jsonb_build_object('accepted', false, 'reason', 'attempt_already_rejected');
  end if;

  if p_game_version is distinct from v_attempt.game_version or p_game_version is distinct from 'neon-trial-0.1.0' then
    v_reason := 'unsupported_game_version';
  elsif coalesce(jsonb_typeof(p_events), 'null') <> 'array' then
    v_reason := 'invalid_event_list';
  elsif jsonb_array_length(p_events) > 128 then
    v_reason := 'invalid_event_list';
  elsif p_score_submitted is null or p_score_submitted < 0 or p_score_submitted > 3000
     or p_deaths is null or p_deaths < 0 or p_deaths > 100
     or p_zones_completed is distinct from 4 or p_completed is distinct from true
     or p_completion_time_ms is null or p_completion_time_ms < 0 or p_completion_time_ms > 7200000 then
    v_reason := 'invalid_attempt_summary';
  else
    v_server_elapsed := floor(extract(epoch from (clock_timestamp() - v_attempt.started_at)) * 1000)::integer;
    if v_server_elapsed < 8000 or v_server_elapsed > 7200000 or abs(v_server_elapsed - p_completion_time_ms) > 120000 then
      v_reason := 'invalid_attempt_duration';
    end if;
  end if;

  if v_reason is null then
    for v_event in select value from jsonb_array_elements(p_events) loop
      v_event_type := v_event ->> 'event';
      v_key := v_event ->> 'key';
      if v_event_type is null or v_key is null or char_length(v_key) > 48
         or coalesce((v_event ->> 'at_ms') !~ '^[0-9]{1,8}$', true)
         or coalesce((v_event ->> 'x') !~ '^[0-9]{1,4}$', true) then
        v_reason := 'malformed_event';
        exit;
      end if;
      v_event_at := (v_event ->> 'at_ms')::integer;
      v_event_x := (v_event ->> 'x')::integer;
      if v_event_at < v_previous_at or v_event_at > p_completion_time_ms
         or v_event_x < 0 or v_event_x > 4200 or v_key = any(v_seen) then
        v_reason := 'invalid_event_order_or_duplicate';
        exit;
      end if;
      v_previous_at := v_event_at;
      v_seen := array_append(v_seen, v_key);
      v_points := 0;

      if v_event_type = 'crystal' and v_key ~ '^crystal:c([1-9]|1[0-6])$' then
        v_number := substring(v_key from 'c([0-9]+)')::integer;
        if v_event_x < ((v_number - 1) / 4) * 1000 or v_event_x >= ((v_number - 1) / 4 + 1) * 1000 + case when v_number > 12 then 200 else 0 end then
          v_reason := 'crystal_outside_zone'; exit;
        end if;
        v_points := 25;
      elsif v_event_type = 'target' and v_key ~ '^target:t[12]$' then
        v_expected_x := case when v_key = 'target:t1' then 3550 else 4050 end;
        if abs(v_event_x - v_expected_x) > 150 then v_reason := 'target_out_of_range'; exit; end if;
        v_points := 50;
      elsif v_event_type = 'section' and v_key ~ '^section:[1-3]$' then
        v_number := substring(v_key from '([0-9]+)$')::integer;
        if v_event_x < v_number * 1000 then v_reason := 'section_not_reached'; exit; end if;
        v_points := 100;
      elsif v_event_type = 'zone' and v_key ~ '^zone:[0-3]$' then
        v_number := substring(v_key from '([0-9]+)$')::integer;
        if v_event_x < (v_number + 1) * 1000 then v_reason := 'zone_not_reached'; exit; end if;
        v_points := 250;
      elsif v_event_type = 'death' and v_key ~ '^death:[1-9][0-9]?$' then
        v_number := substring(v_key from '([0-9]+)$')::integer;
        v_death_count := v_death_count + 1;
        if v_number <> v_death_count then v_reason := 'invalid_death_sequence'; exit; end if;
        v_points := -50;
      elsif v_event_type = 'finish' and v_key = 'finish:complete' then
        if v_event_x < 4130 then v_reason := 'finish_not_reached'; exit; end if;
        v_points := 1000;
      else
        v_reason := 'unknown_event';
        exit;
      end if;
      v_score := greatest(0, v_score + v_points);
    end loop;
  end if;

  if v_reason is null and v_death_count <> p_deaths then v_reason := 'death_count_mismatch'; end if;
  if v_reason is null and v_score <> p_score_submitted then v_reason := 'score_mismatch'; end if;
  if v_reason is null and not ('finish:complete' = any(v_seen)) then v_reason := 'missing_finish_event'; end if;
  if v_reason is null then
    for v_number in 1..3 loop
      if not (('section:' || v_number::text) = any(v_seen)) then v_reason := 'missing_section_event'; exit; end if;
    end loop;
  end if;
  if v_reason is null then
    for v_number in 0..3 loop
      if not (('zone:' || v_number::text) = any(v_seen)) then v_reason := 'missing_zone_event'; exit; end if;
    end loop;
  end if;

  if v_reason is not null then
    update public.game_attempts set submitted_at = clock_timestamp(),
      score_submitted = case when p_score_submitted between 0 and 3000 then p_score_submitted else null end,
      deaths = greatest(0, least(coalesce(p_deaths, 0), 100)), completed = coalesce(p_completed, false),
      zones_completed = greatest(0, least(coalesce(p_zones_completed, 0), 4)), events = null,
      validation_status = 'rejected', validation_reason = v_reason
      where id = p_attempt_id;
    return jsonb_build_object('accepted', false, 'reason', v_reason);
  end if;

  update public.game_attempts set submitted_at = clock_timestamp(), score_submitted = p_score_submitted,
    score_validated = v_score, deaths = p_deaths, zones_completed = p_zones_completed,
    completed = true, completion_time_ms = v_server_elapsed, events = p_events,
    validation_status = 'validated', validation_reason = null
    where id = p_attempt_id;

  insert into public.player_records as r (player_id, best_score, best_zones_completed, best_completion_time_ms, best_attempt_id, updated_at)
    values (v_uid, v_score, 4, v_server_elapsed, p_attempt_id, clock_timestamp())
    on conflict (player_id) do update set
      best_score = excluded.best_score,
      best_zones_completed = excluded.best_zones_completed,
      best_completion_time_ms = excluded.best_completion_time_ms,
      best_attempt_id = excluded.best_attempt_id,
      updated_at = clock_timestamp()
    where excluded.best_score > r.best_score;
  v_record_updated := found;
  select r.best_score into v_best_score from public.player_records as r where r.player_id = v_uid;
  select ranked.position into v_position from (
    select r.player_id, rank() over (order by r.best_score desc) as position
      from public.player_records as r
  ) as ranked where ranked.player_id = v_uid;
  return jsonb_build_object('accepted', true, 'recordUpdated', v_record_updated, 'bestScore', v_best_score, 'position', v_position);
end;
$$;

create or replace function public.rank_page(p_offset integer, p_limit integer)
returns table (position bigint, nickname text, best_score integer)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select rank() over (order by r.best_score desc) as place,
      r.player_id, p.nickname, r.best_score
    from public.player_records as r
    join public.player_profiles as p on p.id = r.player_id
  )
  select ranked.place, ranked.nickname, ranked.best_score
    from ranked
    order by ranked.best_score desc, ranked.player_id asc
    offset greatest(0, least(coalesce(p_offset, 0), 100000))
    limit greatest(1, least(coalesce(p_limit, 10), 51));
$$;

create or replace function public.my_rank()
returns table (position bigint, nickname text, best_score integer)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select rank() over (order by r.best_score desc) as place,
      r.player_id, p.nickname, r.best_score
    from public.player_records as r
    join public.player_profiles as p on p.id = r.player_id
  )
  select ranked.place, ranked.nickname, ranked.best_score
    from ranked
    where ranked.player_id = auth.uid();
$$;

revoke all on function public.claim_nickname(text) from public, anon, authenticated;
revoke all on function public.start_attempt(text) from public, anon, authenticated;
revoke all on function public.submit_attempt(uuid, text, jsonb, integer, integer, integer, boolean, integer) from public, anon, authenticated;
revoke all on function public.rank_page(integer, integer) from public, anon, authenticated;
revoke all on function public.my_rank() from public, anon, authenticated;

grant execute on function public.claim_nickname(text) to authenticated;
grant execute on function public.start_attempt(text) to authenticated;
grant execute on function public.submit_attempt(uuid, text, jsonb, integer, integer, integer, boolean, integer) to authenticated;
grant execute on function public.rank_page(integer, integer) to anon, authenticated;
grant execute on function public.my_rank() to authenticated;
