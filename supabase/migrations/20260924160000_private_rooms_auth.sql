-- Contas permanentes e salas privadas. Aplicar antes de publicar a interface nova.
-- As mensagens antigas permanecem; a primeira conta que reivindicar o código
-- antigo recebe a sala e pode convidar a segunda pessoa pelo novo convite.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- Também permite iniciar em um projeto novo antes de importar o histórico.
create table if not exists public.messages_chat (
  id uuid primary key default gen_random_uuid(),
  room text not null,
  author text not null,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_rooms (
  id text primary key default gen_random_uuid()::text,
  title text not null check (char_length(title) between 1 and 60),
  owner_id uuid not null references auth.users(id) on delete cascade,
  invite_code uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id text not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists room_members_user_id_idx on public.room_members(user_id);
create index if not exists messages_chat_room_created_idx on public.messages_chat(room, created_at desc);
alter table public.messages_chat add column if not exists user_id uuid references auth.users(id) on delete set null;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages_chat'
    ) then
    alter publication supabase_realtime add table public.messages_chat;
  end if;
end;
$$;

-- SECURITY DEFINER quebra a recursão entre as políticas de salas e membros.
create or replace function private.is_room_member(p_room_id text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.room_members m
    where m.room_id = p_room_id and m.user_id = (select auth.uid())
  );
$$;
revoke execute on function private.is_room_member(text) from public, anon;
grant execute on function private.is_room_member(text) to authenticated;

-- Garante que mensagens novas tenham o autor autenticado e que UPDATE não
-- altere a sala ou a identidade, inclusive nas mensagens antigas.
create or replace function private.enforce_message_identity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Migração administrativa conserva os autores originais sem criar contas falsas.
    if auth.role() = 'service_role' then return new; end if;
    new.user_id := auth.uid();
    select m.display_name into new.author
      from public.room_members m
      where m.room_id = new.room and m.user_id = new.user_id;
    if new.user_id is null or new.author is null then
      raise exception 'Você não participa desta sala';
    end if;
  else
    new.id := old.id;
    new.room := old.room;
    new.user_id := old.user_id;
    new.author := old.author;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
revoke execute on function private.enforce_message_identity() from public, anon, authenticated;
drop trigger if exists messages_chat_identity on public.messages_chat;
create trigger messages_chat_identity
before insert or update on public.messages_chat
for each row execute function private.enforce_message_identity();

alter table public.chat_rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.messages_chat enable row level security;

revoke all on public.chat_rooms from public, anon, authenticated;
revoke all on public.room_members from public, anon, authenticated;
revoke all on public.messages_chat from public, anon, authenticated;
grant select on public.chat_rooms to authenticated;
grant select on public.room_members to authenticated;
grant select, insert, update on public.messages_chat to authenticated;

-- Mesmo numa instalação de teste que já criou estas tabelas, nenhuma política
-- permissiva anterior deve ampliar o acesso.
do $$
declare p record;
begin
  for p in select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('chat_rooms', 'room_members', 'messages_chat')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end;
$$;

create policy "chat_rooms_members_read" on public.chat_rooms
for select to authenticated using (private.is_room_member(id));

create policy "room_members_members_read" on public.room_members
for select to authenticated using (private.is_room_member(room_id));

create policy "messages_chat_members_read" on public.messages_chat
for select to authenticated using (private.is_room_member(room));

create policy "messages_chat_members_insert" on public.messages_chat
for insert to authenticated with check (
  user_id = (select auth.uid()) and private.is_room_member(room)
);

-- Reações editam o conteúdo da mensagem; os dois membros precisam poder reagir.
-- O trigger impede troca de autor, sala e user_id.
create policy "messages_chat_members_update" on public.messages_chat
for update to authenticated
using (private.is_room_member(room))
with check (private.is_room_member(room));

create or replace function public.create_chat_room(p_title text, p_display_name text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare v_id text;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta'; end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 60 then raise exception 'Nome da sala inválido'; end if;
  if p_display_name is null or char_length(trim(p_display_name)) not between 1 and 40 then raise exception 'Nome de perfil inválido'; end if;
  insert into public.chat_rooms(title, owner_id)
    values (trim(p_title), auth.uid()) returning id into v_id;
  insert into public.room_members(room_id, user_id, display_name)
    values (v_id, auth.uid(), trim(p_display_name));
  return v_id;
end;
$$;

create or replace function public.join_chat_room(p_invite_code uuid, p_display_name text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare v_id text;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta'; end if;
  if p_display_name is null or char_length(trim(p_display_name)) not between 1 and 40 then raise exception 'Nome de perfil inválido'; end if;
  select r.id into v_id from public.chat_rooms r
    where r.invite_code = p_invite_code for update;
  if v_id is null then raise exception 'Convite inválido'; end if;
  if exists (select 1 from public.room_members m where m.room_id = v_id and m.user_id = auth.uid()) then
    return v_id;
  end if;
  if (select count(*) from public.room_members m where m.room_id = v_id) >= 2 then
    raise exception 'Esta sala já tem duas pessoas';
  end if;
  insert into public.room_members(room_id, user_id, display_name)
    values (v_id, auth.uid(), trim(p_display_name));
  return v_id;
end;
$$;

create or replace function public.claim_legacy_chat_room(p_room_id text, p_display_name text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare v_owner uuid;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta'; end if;
  if p_room_id is null or char_length(trim(p_room_id)) not between 1 and 128 or p_room_id <> trim(p_room_id) then
    raise exception 'Código antigo inválido';
  end if;
  if p_display_name is null or char_length(trim(p_display_name)) not between 1 and 40 then raise exception 'Nome de perfil inválido'; end if;
  -- Códigos automáticos de 10 caracteres podem pertencer a salas vazias.
  -- Códigos manuais só podem ser reivindicados se já tiverem histórico.
  if p_room_id !~ '^[0-9a-f]{10}$'
    and not exists (select 1 from public.messages_chat where room = p_room_id) then
    raise exception 'Conversa antiga não encontrada';
  end if;
  insert into public.chat_rooms(id, title, owner_id)
    values (p_room_id, 'Nossa sala', auth.uid()) on conflict (id) do nothing;
  select r.owner_id into v_owner from public.chat_rooms r where r.id = p_room_id for update;
  if v_owner <> auth.uid() and not exists (
    select 1 from public.room_members m where m.room_id = p_room_id and m.user_id = auth.uid()
  ) then
    raise exception 'Esta conversa já foi reivindicada. Peça o novo convite.';
  end if;
  insert into public.room_members(room_id, user_id, display_name)
    values (p_room_id, auth.uid(), trim(p_display_name)) on conflict do nothing;
  return p_room_id;
end;
$$;

revoke execute on function public.create_chat_room(text, text) from public, anon;
revoke execute on function public.join_chat_room(uuid, text) from public, anon;
revoke execute on function public.claim_legacy_chat_room(text, text) from public, anon;
grant execute on function public.create_chat_room(text, text) to authenticated;
grant execute on function public.join_chat_room(uuid, text) to authenticated;
grant execute on function public.claim_legacy_chat_room(text, text) to authenticated;

-- Digitação, presença e mensagem fixada usam o mesmo tópico privado da sala.
-- A política RESTRICTIVE também bloqueia políticas amplas preexistentes.
grant select, insert on realtime.messages to authenticated;
drop policy if exists "webchat_room_realtime_read" on realtime.messages;
drop policy if exists "webchat_room_realtime_write" on realtime.messages;
drop policy if exists "webchat_room_realtime_guard_read" on realtime.messages;
drop policy if exists "webchat_room_realtime_guard_write" on realtime.messages;
drop policy if exists "webchat_room_realtime_anon_read" on realtime.messages;
drop policy if exists "webchat_room_realtime_anon_write" on realtime.messages;
create policy "webchat_room_realtime_read" on realtime.messages
for select to authenticated using (
  extension in ('broadcast', 'presence')
  and left((select realtime.topic()), 5) = 'sala:'
  and private.is_room_member(substr((select realtime.topic()), 6))
);
create policy "webchat_room_realtime_write" on realtime.messages
for insert to authenticated with check (
  extension in ('broadcast', 'presence')
  and left((select realtime.topic()), 5) = 'sala:'
  and private.is_room_member(substr((select realtime.topic()), 6))
);
create policy "webchat_room_realtime_guard_read" on realtime.messages
as restrictive for select to authenticated using (
  left(coalesce((select realtime.topic()), ''), 5) <> 'sala:'
  or (extension in ('broadcast', 'presence') and private.is_room_member(substr((select realtime.topic()), 6)))
);
create policy "webchat_room_realtime_guard_write" on realtime.messages
as restrictive for insert to authenticated with check (
  left(coalesce((select realtime.topic()), ''), 5) <> 'sala:'
  or (extension in ('broadcast', 'presence') and private.is_room_member(substr((select realtime.topic()), 6)))
);
create policy "webchat_room_realtime_anon_read" on realtime.messages
as restrictive for select to anon using (
  left(coalesce((select realtime.topic()), ''), 5) <> 'sala:'
);
create policy "webchat_room_realtime_anon_write" on realtime.messages
as restrictive for insert to anon with check (
  left(coalesce((select realtime.topic()), ''), 5) <> 'sala:'
);
