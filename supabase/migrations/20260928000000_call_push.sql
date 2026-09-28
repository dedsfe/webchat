-- Assinaturas de push pertencem a uma conta e só o servidor pode lê-las.
create table if not exists public.call_push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists call_push_subscriptions_user_idx on public.call_push_subscriptions(user_id);
alter table public.call_push_subscriptions enable row level security;
revoke all on public.call_push_subscriptions from public, anon, authenticated;

-- A linha também limita convites push repetidos para a mesma chamada.
create table if not exists public.call_push_alerts (
  id uuid primary key,
  room_id text not null references public.chat_rooms(id) on delete cascade,
  caller_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists call_push_alerts_room_created_idx on public.call_push_alerts(room_id, created_at desc);
alter table public.call_push_alerts enable row level security;
revoke all on public.call_push_alerts from public, anon, authenticated;

-- Segredo limitado a estes RPCs; não concede acesso administrativo ao projeto.
create table if not exists private.call_push_config (
  id boolean primary key default true check (id),
  secret text not null
);
revoke all on private.call_push_config from public, anon, authenticated;

create or replace function public.call_push_subscription(
  p_secret text, p_endpoint text, p_p256dh text, p_auth text, p_remove boolean
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from private.call_push_config where secret = p_secret) then
    raise exception 'Não autorizado';
  end if;
  if p_remove then
    delete from public.call_push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
  else
    insert into public.call_push_subscriptions(endpoint, user_id, p256dh, auth)
      values (p_endpoint, auth.uid(), p_p256dh, p_auth)
      on conflict (endpoint) do update set user_id = excluded.user_id,
        p256dh = excluded.p256dh, auth = excluded.auth, updated_at = now();
  end if;
end;
$$;

create or replace function public.call_push_start(p_secret text, p_call_id uuid, p_room_id text)
returns table(endpoint text, p256dh text, auth_key text, caller_name text)
language plpgsql security definer set search_path = '' as $$
declare v_target uuid; v_name text;
begin
  if auth.uid() is null or not exists (select 1 from private.call_push_config where secret = p_secret) then
    raise exception 'Não autorizado';
  end if;
  select m.display_name into v_name from public.room_members m
    where m.room_id = p_room_id and m.user_id = auth.uid();
  if v_name is null or (select count(*) from public.room_members where room_id = p_room_id) <> 2 then
    raise exception 'Sala inválida';
  end if;
  select m.user_id into v_target from public.room_members m
    where m.room_id = p_room_id and m.user_id <> auth.uid();
  if exists (select 1 from public.call_push_alerts a where a.room_id = p_room_id
    and a.caller_id = auth.uid() and a.ended_at is null and a.created_at > now() - interval '45 seconds') then
    return;
  end if;
  insert into public.call_push_alerts(id, room_id, caller_id, target_id)
    values (p_call_id, p_room_id, auth.uid(), v_target)
    on conflict (id) do nothing;
  if not found then return; end if;
  return query select s.endpoint, s.p256dh, s.auth, v_name
    from public.call_push_subscriptions s where s.user_id = v_target;
end;
$$;

create or replace function public.call_push_end(p_secret text, p_call_id uuid, p_room_id text)
returns table(endpoint text, p256dh text, auth_key text)
language plpgsql security definer set search_path = '' as $$
declare v_alert public.call_push_alerts%rowtype;
begin
  if auth.uid() is null or not exists (select 1 from private.call_push_config where secret = p_secret) then
    raise exception 'Não autorizado';
  end if;
  select * into v_alert from public.call_push_alerts a
    where a.id = p_call_id and a.room_id = p_room_id for update;
  if not found or auth.uid() not in (v_alert.caller_id, v_alert.target_id) then
    raise exception 'Chamada inválida';
  end if;
  if v_alert.ended_at is not null then return; end if;
  update public.call_push_alerts set ended_at = now() where id = p_call_id;
  return query select s.endpoint, s.p256dh, s.auth
    from public.call_push_subscriptions s where s.user_id = v_alert.target_id;
end;
$$;

create or replace function public.call_push_remove_expired(p_secret text, p_endpoint text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from private.call_push_config where secret = p_secret) then
    raise exception 'Não autorizado';
  end if;
  delete from public.call_push_subscriptions where endpoint = p_endpoint;
end;
$$;

revoke execute on function public.call_push_subscription(text,text,text,text,boolean) from public, anon;
revoke execute on function public.call_push_start(text,uuid,text) from public, anon;
revoke execute on function public.call_push_end(text,uuid,text) from public, anon;
revoke execute on function public.call_push_remove_expired(text,text) from public, anon;
grant execute on function public.call_push_subscription(text,text,text,text,boolean) to authenticated;
grant execute on function public.call_push_start(text,uuid,text) to authenticated;
grant execute on function public.call_push_end(text,uuid,text) to authenticated;
grant execute on function public.call_push_remove_expired(text,text) to authenticated;
