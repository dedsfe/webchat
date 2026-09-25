-- Sinalização de voz isolada do canal de mensagens. Só membros da sala podem
-- ouvir e publicar convites, SDP e candidatos ICE. Áudio não passa pelo banco.
drop policy if exists "webchat_call_realtime_read" on realtime.messages;
drop policy if exists "webchat_call_realtime_write" on realtime.messages;
drop policy if exists "webchat_call_realtime_guard_read" on realtime.messages;
drop policy if exists "webchat_call_realtime_guard_write" on realtime.messages;
drop policy if exists "webchat_call_realtime_anon_read" on realtime.messages;
drop policy if exists "webchat_call_realtime_anon_write" on realtime.messages;

create policy "webchat_call_realtime_read" on realtime.messages
for select to authenticated using (
  extension = 'broadcast'
  and left((select realtime.topic()), 5) = 'call:'
  and private.is_room_member(substr((select realtime.topic()), 6))
);
create policy "webchat_call_realtime_write" on realtime.messages
for insert to authenticated with check (
  extension = 'broadcast'
  and left((select realtime.topic()), 5) = 'call:'
  and private.is_room_member(substr((select realtime.topic()), 6))
);
create policy "webchat_call_realtime_guard_read" on realtime.messages
as restrictive for select to authenticated using (
  left(coalesce((select realtime.topic()), ''), 5) <> 'call:'
  or (extension = 'broadcast' and private.is_room_member(substr((select realtime.topic()), 6)))
);
create policy "webchat_call_realtime_guard_write" on realtime.messages
as restrictive for insert to authenticated with check (
  left(coalesce((select realtime.topic()), ''), 5) <> 'call:'
  or (extension = 'broadcast' and private.is_room_member(substr((select realtime.topic()), 6)))
);
create policy "webchat_call_realtime_anon_read" on realtime.messages
as restrictive for select to anon using (
  left(coalesce((select realtime.topic()), ''), 5) <> 'call:'
);
create policy "webchat_call_realtime_anon_write" on realtime.messages
as restrictive for insert to anon with check (
  left(coalesce((select realtime.topic()), ''), 5) <> 'call:'
);
