-- Infinite survival mode: preserve v0.1 attempts during rollout and validate
-- v0.2 scores from the event ledger plus server-measured survival time.

alter table public.game_attempts
  drop constraint if exists game_attempts_completion_time,
  drop constraint if exists game_attempts_submitted_score,
  drop constraint if exists game_attempts_validated_score,
  drop constraint if exists game_attempts_zones_completed_check;

alter table public.player_records
  drop constraint if exists player_records_best_completion_time_ms_check,
  drop constraint if exists player_records_best_score_check,
  drop constraint if exists player_records_best_zones_completed_check;

alter table public.game_attempts
  alter column score_submitted type bigint,
  alter column score_validated type bigint,
  alter column zones_completed type bigint,
  alter column completion_time_ms type bigint;

alter table public.player_records
  alter column best_score type bigint,
  alter column best_zones_completed type bigint,
  alter column best_completion_time_ms type bigint;

alter table public.game_attempts
  add constraint game_attempts_completion_time check (completion_time_ms is null or completion_time_ms >= 0),
  add constraint game_attempts_submitted_score check (score_submitted is null or score_submitted >= 0),
  add constraint game_attempts_validated_score check (score_validated is null or score_validated >= 0),
  add constraint game_attempts_zones_completed_check check (zones_completed >= 0);

alter table public.player_records
  add constraint player_records_best_completion_time_ms_check check (best_completion_time_ms is null or best_completion_time_ms >= 0),
  add constraint player_records_best_score_check check (best_score >= 0),
  add constraint player_records_best_zones_completed_check check (best_zones_completed >= 0);

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
  if p_game_version is distinct from 'neon-trial-0.1.0'
     and p_game_version is distinct from 'neon-trial-0.2.0' then
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

drop function if exists public.submit_attempt(uuid, text, jsonb, integer, integer, integer, boolean, integer);

create function public.submit_attempt(
  p_attempt_id uuid,
  p_game_version text,
  p_events jsonb,
  p_score_submitted bigint,
  p_deaths integer,
  p_zones_completed bigint,
  p_completed boolean,
  p_completion_time_ms bigint
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
  v_event_at bigint;
  v_event_x bigint;
  v_number integer;
  v_expected_x integer;
  v_points integer;
  v_score bigint := 0;
  v_death_count integer := 0;
  v_previous_at bigint := -1;
  v_seen text[] := array[]::text[];
  v_reason text;
  v_server_elapsed bigint;
  v_record_updated boolean := false;
  v_best_score bigint;
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

  if p_game_version is distinct from v_attempt.game_version
     or (p_game_version is distinct from 'neon-trial-0.1.0' and p_game_version is distinct from 'neon-trial-0.2.0') then
    v_reason := 'unsupported_game_version';
  elsif coalesce(jsonb_typeof(p_events), 'null') <> 'array' then
    v_reason := 'invalid_event_list';
  elsif jsonb_array_length(p_events) > 128 then
    v_reason := 'invalid_event_list';
  elsif p_score_submitted is null or p_score_submitted < 0
     or p_deaths is null or p_deaths < 0 or p_deaths > 100
     or p_zones_completed is null or p_zones_completed < 0
     or p_completed is distinct from true
     or p_completion_time_ms is null or p_completion_time_ms < 0 then
    v_reason := 'invalid_attempt_summary';
  elsif p_game_version = 'neon-trial-0.1.0'
     and (p_score_submitted > 3000 or p_zones_completed <> 4 or p_completion_time_ms > 7200000) then
    v_reason := 'invalid_attempt_summary';
  elsif p_game_version = 'neon-trial-0.2.0' and p_deaths <> 4 then
    v_reason := 'life_count_mismatch';
  else
    v_server_elapsed := floor(extract(epoch from (clock_timestamp() - v_attempt.started_at)) * 1000)::bigint;
    if p_game_version = 'neon-trial-0.1.0'
       and (v_server_elapsed < 8000 or v_server_elapsed > 7200000 or abs(v_server_elapsed - p_completion_time_ms) > 120000) then
      v_reason := 'invalid_attempt_duration';
    elsif p_game_version = 'neon-trial-0.2.0' and abs(v_server_elapsed - p_completion_time_ms) > 120000 then
      v_reason := 'invalid_attempt_duration';
    end if;
  end if;

  if v_reason is null then
    for v_event in select value from jsonb_array_elements(p_events) loop
      v_event_type := v_event ->> 'event';
      v_key := v_event ->> 'key';
      if v_event_type is null or v_key is null or char_length(v_key) > 48
         or coalesce((v_event ->> 'at_ms') !~ case when p_game_version = 'neon-trial-0.1.0' then '^[0-9]{1,8}$' else '^[0-9]{1,16}$' end, true)
         or coalesce((v_event ->> 'x') !~ '^[0-9]{1,10}$', true) then
        v_reason := 'malformed_event';
        exit;
      end if;
      v_event_at := (v_event ->> 'at_ms')::bigint;
      v_event_x := (v_event ->> 'x')::bigint;
      if v_event_at < v_previous_at or v_event_at > p_completion_time_ms
         or v_event_x < 0
         or (p_game_version = 'neon-trial-0.1.0' and v_event_x > 4200)
         or (p_game_version = 'neon-trial-0.2.0' and v_event_x > 2147483647)
         or v_key = any(v_seen) then
        v_reason := 'invalid_event_order_or_duplicate';
        exit;
      end if;
      v_previous_at := v_event_at;
      v_seen := array_append(v_seen, v_key);
      v_points := 0;

      if v_event_type = 'crystal' and v_key ~ '^crystal:c([1-9]|1[0-6])$' then
        v_number := substring(v_key from 'c([0-9]+)')::integer;
        if v_event_x < ((v_number - 1) / 4) * 1000
           or (v_number <= 12 and v_event_x >= ((v_number - 1) / 4 + 1) * 1000)
           or (v_number > 12 and v_event_x >= ((v_number - 1) / 4 + 1) * 1000 + 200) then
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
      elsif v_event_type = 'death'
         and ((p_game_version = 'neon-trial-0.1.0' and v_key ~ '^death:[1-9][0-9]?$')
           or (p_game_version = 'neon-trial-0.2.0' and v_key ~ '^death:[1-4]$')) then
        v_number := substring(v_key from '([0-9]+)$')::integer;
        v_death_count := v_death_count + 1;
        if v_number <> v_death_count then v_reason := 'invalid_death_sequence'; exit; end if;
        v_points := -50;
      elsif p_game_version = 'neon-trial-0.1.0' and v_event_type = 'finish' and v_key = 'finish:complete' then
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
  if v_reason is null and p_game_version = 'neon-trial-0.1.0' then
    if v_score <> p_score_submitted then v_reason := 'score_mismatch'; end if;
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
  elsif v_reason is null and p_game_version = 'neon-trial-0.2.0'
     and v_score + floor(p_completion_time_ms / 1000)::bigint <> p_score_submitted then
    v_reason := 'score_mismatch';
  end if;

  if v_reason is not null then
    update public.game_attempts set submitted_at = clock_timestamp(),
      score_submitted = case when p_score_submitted >= 0 then p_score_submitted else null end,
      deaths = greatest(0, least(coalesce(p_deaths, 0), 100)), completed = coalesce(p_completed, false),
      zones_completed = greatest(0, coalesce(p_zones_completed, 0)), events = null,
      validation_status = 'rejected', validation_reason = v_reason
      where id = p_attempt_id;
    return jsonb_build_object('accepted', false, 'reason', v_reason);
  end if;

  if p_game_version = 'neon-trial-0.2.0' then
    v_score := v_score + floor(p_completion_time_ms / 1000)::bigint;
  end if;
  update public.game_attempts set submitted_at = clock_timestamp(), score_submitted = p_score_submitted,
    score_validated = v_score, deaths = p_deaths, zones_completed = p_zones_completed,
    completed = true, completion_time_ms = v_server_elapsed, events = p_events,
    validation_status = 'validated', validation_reason = null
    where id = p_attempt_id;

  insert into public.player_records as r (player_id, best_score, best_zones_completed, best_completion_time_ms, best_attempt_id, updated_at)
    values (v_uid, v_score, p_zones_completed, v_server_elapsed, p_attempt_id, clock_timestamp())
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

revoke all on function public.submit_attempt(uuid, text, jsonb, bigint, integer, bigint, boolean, bigint) from public, anon, authenticated;
grant execute on function public.submit_attempt(uuid, text, jsonb, bigint, integer, bigint, boolean, bigint) to authenticated;
