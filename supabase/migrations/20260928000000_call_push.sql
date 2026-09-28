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
