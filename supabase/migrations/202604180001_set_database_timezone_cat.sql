-- Keep the database session timezone on CAT while preserving correct timestamptz writes.
alter database postgres set timezone = 'Africa/Blantyre';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table if exists public.profiles
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table if exists public.workspaces
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table if exists public.projects
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table if exists public.tasks
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table if exists public.task_comments
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table if exists public.organization_invitations
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table if exists public.boards
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table if exists public.status
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table if exists public.notifications
  alter column created_at set default now();

alter table if exists public.task_comment_reactions
  alter column created_at set default now();

alter table if exists public.task_assignees
  alter column created_at set default now();

alter table if exists public.task_reminders
  alter column sent_at set default now(),
  alter column created_at set default now();

alter table if exists public.chat_rooms
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table if exists public.chat_room_members
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table if exists public.chat_messages
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table if exists public.chat_message_mentions
  alter column created_at set default now();

alter table if exists public.chat_message_attachments
  alter column created_at set default now();

alter table if exists public.notification_email_deliveries
  alter column created_at set default now(),
  alter column updated_at set default now();

create or replace function public.send_task_reminders()
returns table (
  inserted_reminders integer,
  inserted_notifications integer,
  dispatch_attempted integer,
  dispatch_queued integer,
  dispatch_failed integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_dispatch_url text := nullif(current_setting('app.settings.task_reminder_dispatch_url', true), '');
  v_dispatch_token text := nullif(current_setting('app.settings.task_reminder_dispatch_token', true), '');
  v_dispatch_attempted integer := 0;
  v_dispatch_queued integer := 0;
  v_dispatch_failed integer := 0;
  v_reminders integer := 0;
  v_notifications integer := 0;
  v_dispatch record;
begin
  create temp table tmp_inserted_reminders (
    id uuid,
    task_id uuid,
    user_id uuid,
    reminder_type text,
    due_at_snapshot timestamptz
  ) on commit drop;

  with tasks_filtered as (
    select
      t.id as task_id,
      t.due_at,
      t.assigned_to
    from public.tasks t
    left join public.status s on s.id = t.status_id
    where t.due_at is not null
      and t.completed_at is null
      and lower(coalesce(s.key, t.status, '')) not in ('done', 'completed', 'closed')
      and t.due_at > (v_now - interval '15 minutes')
      and t.due_at < (v_now + interval '24 hours' + interval '5 minutes')
  ),
  task_assignees_union as (
    select tf.task_id, tf.due_at, tf.assigned_to as user_id
    from tasks_filtered tf
    where tf.assigned_to is not null
    union
    select tf.task_id, tf.due_at, ta.assignee_id as user_id
    from tasks_filtered tf
    join public.task_assignees ta on ta.task_id = tf.task_id
  ),
  matched_rules as (
    select
      tu.task_id,
      tu.user_id,
      tu.due_at,
      case
        when tu.due_at >= (v_now + interval '24 hours') and tu.due_at < (v_now + interval '24 hours' + interval '5 minutes') then 'due_24h'
        when tu.due_at >= (v_now + interval '1 hour') and tu.due_at < (v_now + interval '1 hour' + interval '5 minutes') then 'due_1h'
        when tu.due_at > (v_now - interval '15 minutes') and tu.due_at <= v_now then 'overdue'
        else null
      end as reminder_type
    from task_assignees_union tu
  ),
  inserted_reminders as (
    insert into public.task_reminders (task_id, user_id, reminder_type, due_at_snapshot)
    select
      mr.task_id,
      mr.user_id,
      mr.reminder_type,
      mr.due_at
    from matched_rules mr
    where mr.reminder_type is not null
    on conflict (task_id, user_id, reminder_type, due_at_snapshot) do nothing
    returning id, task_id, user_id, reminder_type, due_at_snapshot
  )
  insert into tmp_inserted_reminders (id, task_id, user_id, reminder_type, due_at_snapshot)
  select id, task_id, user_id, reminder_type, due_at_snapshot
  from inserted_reminders;

  get diagnostics v_reminders = row_count;

  create temp table tmp_inserted_notifications (
    id uuid,
    recipient_id uuid,
    task_id uuid,
    metadata jsonb,
    created_at timestamptz
  ) on commit drop;

  with reminder_payloads as (
    select
      r.id as reminder_id,
      r.task_id,
      r.user_id,
      r.reminder_type,
      r.due_at_snapshot,
      t.title as task_title,
      case r.reminder_type
        when 'due_24h' then 'Task due in 24 hours'
        when 'due_1h' then 'Task due in 1 hour'
        when 'overdue' then 'Task is overdue'
      end as title,
      case r.reminder_type
        when 'due_24h' then format('"%s" is due in 24 hours.', t.title)
        when 'due_1h' then format('"%s" is due in 1 hour.', t.title)
        when 'overdue' then format('"%s" is overdue.', t.title)
      end as message
    from tmp_inserted_reminders r
    join public.tasks t on t.id = r.task_id
  ),
  inserted_notifications as (
    insert into public.notifications (recipient_id, actor_id, task_id, type, title, message, metadata)
    select
      rp.user_id,
      null::uuid,
      rp.task_id,
      'task',
      rp.title,
      rp.message,
      jsonb_build_object(
        'kind', 'task_reminder',
        'reminder_type', rp.reminder_type,
        'due_at_snapshot', rp.due_at_snapshot,
        'task_id', rp.task_id,
        'task_reminder_id', rp.reminder_id
      )
    from reminder_payloads rp
    returning id, recipient_id, task_id, metadata, created_at
  )
  insert into tmp_inserted_notifications (id, recipient_id, task_id, metadata, created_at)
  select id, recipient_id, task_id, metadata, created_at
  from inserted_notifications;

  get diagnostics v_notifications = row_count;

  update public.task_reminders tr
  set notification_id = n.id
  from tmp_inserted_notifications n
  where tr.id = (n.metadata ->> 'task_reminder_id')::uuid;

  if v_dispatch_url is not null and v_dispatch_token is not null then
    for v_dispatch in
      select
        n.id as notification_id,
        n.task_id,
        n.recipient_id,
        (n.metadata ->> 'reminder_type')::text as reminder_type,
        (n.metadata ->> 'due_at_snapshot')::timestamptz as due_at_snapshot,
        t.title as task_title
      from tmp_inserted_notifications n
      join public.tasks t on t.id = n.task_id
    loop
      v_dispatch_attempted := v_dispatch_attempted + 1;
      begin
        perform net.http_post(
          url := v_dispatch_url,
          headers := jsonb_strip_nulls(jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', case when v_dispatch_token is not null then 'Bearer ' || v_dispatch_token else null end
          )),
          body := jsonb_build_object(
            'notification_id', v_dispatch.notification_id,
            'task_id', v_dispatch.task_id,
            'recipient_id', v_dispatch.recipient_id,
            'reminder_type', v_dispatch.reminder_type,
            'task_title', v_dispatch.task_title,
            'due_at', v_dispatch.due_at_snapshot
          )
        );
        v_dispatch_queued := v_dispatch_queued + 1;
      exception when others then
        v_dispatch_failed := v_dispatch_failed + 1;
        raise warning 'send_task_reminders dispatch failed for notification %: %', v_dispatch.notification_id, sqlerrm;
      end;
    end loop;
  end if;

  inserted_reminders := coalesce(v_reminders, 0);
  inserted_notifications := coalesce(v_notifications, 0);
  dispatch_attempted := coalesce(v_dispatch_attempted, 0);
  dispatch_queued := coalesce(v_dispatch_queued, 0);
  dispatch_failed := coalesce(v_dispatch_failed, 0);

  return next;
end;
$$;
