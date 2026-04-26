do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_rooms';
    execute 'alter publication supabase_realtime add table public.chat_room_members';
    execute 'alter publication supabase_realtime add table public.chat_messages';
    execute 'alter publication supabase_realtime add table public.chat_message_mentions';
    execute 'alter publication supabase_realtime add table public.chat_message_attachments';
  end if;
exception
  when duplicate_object then null;
end
$$;

alter table public.chat_rooms replica identity full;
alter table public.chat_room_members replica identity full;
alter table public.chat_messages replica identity full;
alter table public.chat_message_mentions replica identity full;
alter table public.chat_message_attachments replica identity full;
